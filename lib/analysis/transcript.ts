import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { parseNativeTranscript } from "./transcript-format.ts";
import type { NativeTranscript } from "./transcript-format.ts";
import { CaptionFailure, fetchCaptionProvider } from "./transcript-providers.ts";
import type { CaptionEnvironment, CaptionProvider } from "./transcript-providers.ts";
import type { AnalysisWindow } from "./schema.ts";
import type { TranscriptSection, TranscriptSegment } from "./shared.ts";

export { parseNativeTranscript } from "./transcript-format.ts";

const DAY = 86400000;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const Cooldown = z.object({ until: z.number().finite().nonnegative(), fingerprint: z.string(), reason: z.string().max(300), recoverable: z.boolean().optional() });
const State = z.object({
  next: z.enum(["self_hosted", "supadata"]),
  cooldowns: z.object({ self_hosted: Cooldown.optional(), supadata: Cooldown.optional() }),
});
type CaptionResult = { transcript: NativeTranscript | null; notice?: string; provider?: CaptionProvider; cached?: boolean; retryAt?: number };

type RouterOptions = {
  root: string;
  env?: () => CaptionEnvironment;
  fetchProvider?: typeof fetchCaptionProvider;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: (message: string) => void;
};

/** A single analysis worker owns this directory. Serialize extraction to avoid bursts and duplicate cache misses. */
export function createTranscriptFetcher(options: RouterOptions) {
  const env = options.env ?? (() => process.env);
  const request = options.fetchProvider ?? fetchCaptionProvider;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (async (ms, signal) => { await delay(ms, undefined, { signal }); });
  const log = options.log ?? ((message: string) => console.log(`[captions] ${message}`));
  const root = options.root;
  let pending = Promise.resolve();
  let lastRequestAt = -Infinity;

  async function save(name: string, value: unknown) {
    const temporary = join(root, `${name}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
      await rename(temporary, join(root, name));
    } finally { await rm(temporary, { force: true }).catch(() => undefined); }
  }

  async function cleanup() {
    const names = (await readdir(root)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
    const entries = await Promise.all(names.map(async (name) => ({ name, at: (await stat(join(root, name))).mtimeMs })));
    entries.sort((a, b) => b.at - a.at);
    await Promise.all(entries.filter((entry, index) => index >= 500 || now() - entry.at > DAY)
      .map((entry) => rm(join(root, entry.name), { force: true })));
  }

  async function run(videoId: string, duration: number, signal: AbortSignal): Promise<CaptionResult> {
    signal.throwIfAborted();
    const config = env();
    await mkdir(root, { recursive: true });
    const cacheName = `${digest(JSON.stringify([videoId, duration, config.TRANSCRIPT_LANGUAGE?.trim() ?? ""]))}.json`;
    try {
      const cached = JSON.parse(await readFile(join(root, cacheName), "utf8"));
      if (Number.isFinite(cached.at) && now() >= cached.at && now() - cached.at < DAY) {
        const transcript = parseNativeTranscript(cached.raw, duration);
        if (cached.provider === "supadata" || cached.provider === "self_hosted") {
          log(`${videoId}: cached ${cached.provider} captions`);
          return { transcript, provider: cached.provider, cached: true };
        }
      }
    } catch { /* Expired, absent or malformed cache: fetch fresh captions. */ }
    await cleanup().catch(() => log("Caption cache cleanup failed; continuing extraction."));
    const state = State.safeParse(await readFile(join(root, "providers.json"), "utf8").then(JSON.parse).catch(() => null));
    const current: z.infer<typeof State> = state.success ? state.data : { next: "self_hosted", cooldowns: {} };
    const enabled: CaptionProvider[] = [];
    if (!/^(0|false|off)$/i.test(config.TRANSCRIPT_SELF_HOSTED?.trim() ?? "")) enabled.push("self_hosted");
    if (config.SUPADATA_API_KEY?.trim()) enabled.push("supadata");
    const order = [current.next, current.next === "self_hosted" ? "supadata" : "self_hosted"] as CaptionProvider[];
    current.next = order[1];
    const persist = () => save("providers.json", current).catch(() => log("Could not persist caption provider state."));
    await persist();
    const failures: string[] = [];
    const recoveryTimes: number[] = [];
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(210000)]);
    try {
      for (const provider of order.filter((item) => enabled.includes(item))) {
        const fingerprint = digest(provider === "supadata" ? config.SUPADATA_API_KEY! : JSON.stringify([
          config.TRANSCRIPT_PYTHON ?? "", config.TRANSCRIPT_PROXY_URL ?? "",
        ]));
        const cooldown = current.cooldowns[provider];
        if (cooldown && cooldown.fingerprint === fingerprint && cooldown.until > now()) {
          failures.push(`${cooldown.reason} Next attempt after ${new Date(cooldown.until).toISOString()}.`);
          if (cooldown.recoverable) recoveryTimes.push(cooldown.until);
          continue;
        }
        delete current.cooldowns[provider];
        // A slow provider must leave enough time for the other provider to run.
        const providerSignal = AbortSignal.any([bounded, AbortSignal.timeout(90000)]);
        const attempts = provider === "self_hosted" && config.TRANSCRIPT_PROXY_URL ? 3 : 2;
        for (let attempt = 0; attempt < attempts; attempt++) {
          bounded.throwIfAborted();
          // At most one new caption attempt per second; analysis model requests use their own limiter.
          const gap = 1000 - (now() - lastRequestAt);
          if (gap > 0) await sleep(gap, bounded);
          lastRequestAt = now();
          try {
            const raw = await request(provider, videoId, providerSignal, config);
            bounded.throwIfAborted();
            let transcript: NativeTranscript;
            try { transcript = parseNativeTranscript(raw, duration); }
            catch { throw new CaptionFailure("invalid", `${provider} returned invalid or empty captions.`); }
            await save(cacheName, { at: now(), provider, raw }).catch(() => log("Could not cache captions; continuing analysis."));
            await persist();
            log(`${videoId}: ${provider} succeeded (${transcript.segments.length} cues)`);
            return { transcript, provider, cached: false };
          } catch (error) {
            bounded.throwIfAborted();
            const failure = providerSignal.aborted
              ? new CaptionFailure("temporary", `${provider} timed out; trying the next provider.`, 60000)
              : error instanceof CaptionFailure ? error : new CaptionFailure("temporary", `${provider} caption retrieval failed.`, 60000);
            log(`${videoId}: ${provider} ${failure.code} (attempt ${attempt + 1}/${attempts})`);
            if (failure.retryable && attempt + 1 < attempts) {
              await sleep(2000 * 2 ** attempt + Math.floor(Math.random() * 500), bounded);
              continue;
            }
            failures.push(failure.message);
            const recoverable = ["blocked", "temporary", "rate_limited", "quota"].includes(failure.code);
            if (recoverable) recoveryTimes.push(now() + Math.max(60000, failure.cooldownMs));
            if (failure.cooldownMs) current.cooldowns[provider] = {
              until: now() + failure.cooldownMs, fingerprint, reason: failure.message, recoverable,
            };
            await persist();
            break;
          }
        }
      }
    } catch {
      signal.throwIfAborted();
      failures.push("Caption retrieval timed out. Retry this analysis.");
      recoveryTimes.push(now() + 60000);
    }
    return { transcript: null, retryAt: recoveryTimes.length ? Math.min(...recoveryTimes) : undefined,
      notice: `Existing captions could not be retrieved. ${failures.join(" ") || "Enable the local worker or configure SUPADATA_API_KEY."}` };
  }

  return (videoId: string, duration: number, signal: AbortSignal): Promise<CaptionResult> => {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !Number.isFinite(duration) || duration <= 0) return Promise.reject(new Error("Invalid video ID or duration"));
    const task = pending.then(() => run(videoId, duration, signal));
    pending = task.then(() => undefined, () => undefined);
    // Cancellation should return immediately even when waiting behind another extraction.
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  };
}

let workerFetcher: ReturnType<typeof createTranscriptFetcher> | undefined;
/** Used only by the background worker; saved caption sections remain reusable on restart. */
export function fetchNativeTranscript(videoId: string, duration: number, signal: AbortSignal) {
  workerFetcher ??= createTranscriptFetcher({ root: join(process.env.ANALYSIS_DATA_DIR ? resolve(process.env.ANALYSIS_DATA_DIR) : join(process.cwd(), ".data", "analysis"), "captions") });
  return workerFetcher(videoId, duration, signal);
}

export function transcriptForWindow(native: { language: string; segments: TranscriptSegment[] }, window: AnalysisWindow): TranscriptSection {
  return { window: window.index, source: "youtube_captions", language: native.language,
    segments: native.segments.filter((cue) => cue.endSeconds > window.inputStart && cue.startSeconds < window.end)
      .map((cue) => ({ ...cue, startSeconds: Math.max(window.inputStart, cue.startSeconds), endSeconds: Math.min(window.end, cue.endSeconds) })),
  };
}

export function transcriptPrompt(section: TranscriptSection): string {
  return JSON.stringify({ source: section.source, language: section.language, cues: section.segments });
}
