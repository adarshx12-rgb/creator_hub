import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

export type CaptionProvider = "self_hosted" | "supadata";
export type CaptionEnvironment = Record<string, string | undefined>;
export type CaptionFailureCode = "quota" | "auth" | "blocked" | "rate_limited" | "unavailable" | "setup" | "temporary" | "invalid";
export class CaptionFailure extends Error {
  code: CaptionFailureCode;
  cooldownMs: number;
  retryable: boolean;
  constructor(code: CaptionFailureCode, message: string, cooldownMs = 0, retryable = false) {
    super(message);
    this.code = code; this.cooldownMs = cooldownMs; this.retryable = retryable;
  }
}

function retryAfter(response: Response) {
  const header = response.headers.get("retry-after");
  const milliseconds = header && /^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header ?? "") - Date.now();
  return Number.isFinite(milliseconds) ? Math.min(86400000, Math.max(1000, milliseconds)) : 60000;
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  if (response.status === 402) throw new CaptionFailure("quota", "Supadata credits are exhausted.", 6 * 3600000);
  if ([401, 403].includes(response.status)) throw new CaptionFailure("auth", "Supadata rejected its API key or access.", 3600000);
  if (response.status === 429) throw new CaptionFailure("rate_limited", "Supadata is rate limited.", retryAfter(response));
  if ([204, 206, 404].includes(response.status)) throw new CaptionFailure("unavailable", "Supadata has no captions for this video.");
  if (!response.ok) throw new CaptionFailure("temporary", "Supadata caption retrieval failed.", 60000, response.status >= 500);
  // Bound the response while streaming; content-length alone is not trustworthy.
  const reader = response.body?.getReader();
  if (!reader) throw new CaptionFailure("invalid", "Supadata returned no caption data.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 16 * 1024 * 1024) throw new CaptionFailure("invalid", "Supadata caption response is too large.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new CaptionFailure("invalid", "Supadata returned invalid caption data.");
  return data as Record<string, unknown>;
}

export async function fetchSupadata(videoId: string, signal: AbortSignal, env: CaptionEnvironment): Promise<unknown> {
  signal.throwIfAborted();
  if (!env.SUPADATA_API_KEY?.trim()) throw new CaptionFailure("setup", "Supadata is not configured.");
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(90000)]);
  const params = new URLSearchParams({ url: `https://www.youtube.com/watch?v=${videoId}`, mode: "native", text: "false" });
  if (env.TRANSCRIPT_LANGUAGE?.trim()) params.set("lang", env.TRANSCRIPT_LANGUAGE.trim());
  const base = "https://api.supadata.ai/v1/transcript";
  const get = async (url: string) => responseJson(await fetch(url, {
    headers: { "x-api-key": env.SUPADATA_API_KEY! }, signal: bounded, cache: "no-store", redirect: "error",
  }));
  try {
    let data = await get(`${base}?${params}`);
    if (data.jobId !== undefined) {
      if (typeof data.jobId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(data.jobId)) throw new CaptionFailure("invalid", "Supadata returned an invalid job.");
      const jobId = data.jobId;
      for (let attempt = 0; attempt < 25; attempt++) {
        await delay(3000, undefined, { signal: bounded });
        data = await get(`${base}/${encodeURIComponent(jobId)}`);
        if (data.status === "failed") throw new CaptionFailure("unavailable", "Supadata could not retrieve this video's captions.");
        if (data.status === "completed") return data.result ?? data;
      }
      throw new CaptionFailure("temporary", "Supadata caption job timed out.", 60000);
    }
    return data;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof CaptionFailure) throw error;
    throw new CaptionFailure("temporary", "Supadata could not be reached or returned invalid data.", 60000, !bounded.aborted);
  }
}

const LocalReply = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), transcript: z.unknown() }),
  z.object({ ok: z.literal(false), code: z.enum(["blocked", "unavailable", "setup", "temporary", "invalid"]) }),
]);

export function transcriptPython(env: CaptionEnvironment = process.env) {
  if (env.TRANSCRIPT_PYTHON?.trim()) return env.TRANSCRIPT_PYTHON.trim();
  const local = join(process.cwd(), ".data", "transcript-venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  return existsSync(local) ? local : process.platform === "win32" ? "python" : "python3";
}

export async function fetchSelfHosted(videoId: string, signal: AbortSignal, env: CaptionEnvironment): Promise<unknown> {
  signal.throwIfAborted();
  // Pass only OS runtime settings and extractor configuration, never analysis or Supadata keys.
  const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) =>
    /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|LANG|LC_ALL|SSL_CERT_FILE|REQUESTS_CA_BUNDLE)$/i.test(key)
    || ["TRANSCRIPT_PROXY_URL", "TRANSCRIPT_LANGUAGE"].includes(key)));
  const output = await new Promise<string>((resolve, reject) => {
    execFile(transcriptPython(env), ["-X", "utf8", join(process.cwd(), "scripts", "fetch-transcript.py"), videoId], {
      env: { ...childEnv, NODE_ENV: process.env.NODE_ENV }, windowsHide: true, signal, timeout: 45000, maxBuffer: 16 * 1024 * 1024, encoding: "utf8",
    }, (error, stdout) => {
      if (signal.aborted) return reject(signal.reason);
      if (error) return reject(new CaptionFailure(error.code === "ENOENT" ? "setup" : "temporary",
        error.code === "ENOENT" ? "Install the local caption worker's Python environment." : "Local caption extraction failed or timed out.", 60000, error.code !== "ENOENT"));
      resolve(stdout);
    });
  });
  const parsed = LocalReply.safeParse(JSON.parse(output));
  if (!parsed.success) throw new CaptionFailure("invalid", "Local caption worker returned invalid data.");
  if (parsed.data.ok) return parsed.data.transcript;
  const code = parsed.data.code;
  const messages = {
    blocked: "YouTube blocked the local caption connection. Configure or check TRANSCRIPT_PROXY_URL.",
    unavailable: "Existing captions are unavailable or this video is restricted.",
    setup: "Install the local caption dependencies and check TRANSCRIPT_PYTHON / TRANSCRIPT_PROXY_URL.",
    temporary: "Local caption retrieval encountered a network error.",
    invalid: "Local caption worker received invalid caption data.",
  };
  throw new CaptionFailure(code, messages[code], ["setup", "blocked", "temporary"].includes(code) ? 60000 : 0,
    code === "temporary" || code === "blocked");
}

export function fetchCaptionProvider(provider: CaptionProvider, videoId: string, signal: AbortSignal, env: CaptionEnvironment) {
  return provider === "supadata" ? fetchSupadata(videoId, signal, env) : fetchSelfHosted(videoId, signal, env);
}
