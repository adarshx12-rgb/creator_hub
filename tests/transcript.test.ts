import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTranscriptFetcher } from "../lib/analysis/transcript.ts";
import { CaptionFailure, fetchSupadata, fetchSelfHosted } from "../lib/analysis/transcript-providers.ts";
import type { CaptionEnvironment, CaptionProvider, fetchCaptionProvider } from "../lib/analysis/transcript-providers.ts";
import { parseNativeTranscript } from "../lib/analysis/transcript-format.ts";
import { captionRecovery, captionRetryDue } from "../lib/analysis/caption-recovery.ts";
import type { AnalysisProgress } from "../lib/analysis/shared.ts";

const raw = { lang: "hi", content: [{ offset: 1000, duration: 2000, text: "A real caption format" }] };
const signal = () => new AbortController().signal;
const id = (number: number) => String(number).padStart(11, "0");
const temporaryRoots: string[] = [];
after(async () => {
  for (const root of temporaryRoots) {
    assert.ok(root.startsWith(join(tmpdir(), "momentscout-captions-")));
    await rm(root, { recursive: true, force: true });
  }
});

async function harness(provider: typeof fetchCaptionProvider, config: CaptionEnvironment = { SUPADATA_API_KEY: "test" }) {
  const root = await mkdtemp(join(tmpdir(), "momentscout-captions-"));
  temporaryRoots.push(root);
  let clock = Date.now();
  const options = { root, env: () => config, fetchProvider: provider, now: () => clock,
    sleep: async (ms: number, abort: AbortSignal) => { abort.throwIfAborted(); clock += ms; }, log: () => {} };
  return { root, config, fetch: createTranscriptFetcher(options), restart: () => createTranscriptFetcher(options), advance: (ms: number) => { clock += ms; } };
}

test("alternate providers across requests and restarts; concurrent duplicates use cached timed captions", async () => {
  const calls: CaptionProvider[] = [];
  const h = await harness(async (provider) => { calls.push(provider); return raw; });
  const [a, b] = await Promise.all([h.fetch(id(1), 120, signal()), h.fetch(id(1), 120, signal())]);
  assert.equal(a.provider, "self_hosted");
  assert.equal(b.cached, true);
  assert.deepEqual(a.transcript, b.transcript);
  assert.equal((await h.restart()(id(2), 120, signal())).provider, "supadata");
  assert.equal((await h.fetch(id(3), 120, signal())).provider, "self_hosted");
  assert.deepEqual(calls, ["self_hosted", "supadata", "self_hosted"]);
  h.config.TRANSCRIPT_LANGUAGE = "en";
  await h.fetch(id(1), 120, signal());
  assert.equal(calls.length, 4, "language preferences get independent cache entries");
  h.advance(86400001);
  await h.fetch(id(1), 120, signal());
  assert.equal(calls.length, 5, "expired captions are fetched again");
});

test("quota exhaustion falls back immediately and persists; cooldown expiry or a new key re-enables Supadata", async () => {
  const calls: CaptionProvider[] = [];
  const h = await harness(async (provider) => {
    calls.push(provider);
    if (provider === "supadata") throw new CaptionFailure("quota", "Supadata credits are exhausted.", 21600000);
    return raw;
  });
  await h.fetch(id(1), 120, signal());
  assert.equal((await h.fetch(id(2), 120, signal())).provider, "self_hosted");
  const restarted = h.restart();
  await restarted(id(3), 120, signal());
  await restarted(id(4), 120, signal());
  assert.equal(calls.filter((p) => p === "supadata").length, 1);
  h.advance(21600001);
  await restarted(id(5), 120, signal());
  await restarted(id(6), 120, signal());
  assert.equal(calls.filter((p) => p === "supadata").length, 2);
  h.config.SUPADATA_API_KEY = "new-test-secret";
  await restarted(id(7), 120, signal());
  await restarted(id(8), 120, signal());
  assert.equal(calls.filter((p) => p === "supadata").length, 3);
  assert.doesNotMatch(await readFile(join(h.root, "providers.json"), "utf8"), /new-test-secret/);
});

test("blocked local connections retry through a configured gateway, then fall back; missing captions do not disable a provider", async () => {
  let local = 0;
  const h = await harness(async (provider) => {
    if (provider === "self_hosted") { local++; throw new CaptionFailure("blocked", "Blocked", 60000, true); }
    return raw;
  }, { SUPADATA_API_KEY: "key", TRANSCRIPT_PROXY_URL: "http://test:secret@gateway.example:8000" });
  assert.equal((await h.fetch(id(1), 120, signal())).provider, "supadata");
  assert.equal(local, 3);
  assert.doesNotMatch(await readFile(join(h.root, "providers.json"), "utf8"), /test:secret/);
  await h.fetch(id(2), 120, signal());
  await h.fetch(id(3), 120, signal());
  assert.equal(local, 3, "blocked connection cools down across jobs");
  const missing = await harness(async () => { throw new CaptionFailure("unavailable", "No captions"); });
  const result = await missing.fetch(id(1), 120, signal());
  assert.equal(result.transcript, null);
  assert.match(result.notice!, /No captions/);
  assert.deepEqual(JSON.parse(await readFile(join(missing.root, "providers.json"), "utf8")).cooldowns, {});
});

test("invalid captions trigger fallback; corrupt router state is recoverable; local-only works without a Supadata key", async () => {
  const h = await harness(async (provider) => provider === "self_hosted" ? { lang: "en", content: [] } : raw);
  await writeFile(join(h.root, "providers.json"), "truncated{");
  assert.equal((await h.fetch(id(1), 120, signal())).provider, "supadata");
  const local = await harness(async (provider) => { assert.equal(provider, "self_hosted"); return raw; }, {});
  assert.ok((await local.fetch(id(1), 120, signal())).transcript);
  for (const input of ["../../.env.local", "https://localhost/", "x"]) await assert.rejects(local.fetch(input, 120, signal()));
  assert.throws(() => parseNativeTranscript({ lang: "en", content: [] }, 120));
  assert.throws(() => parseNativeTranscript(raw, NaN));
});

test("cancellation interrupts active extraction and queued jobs without calling fallback or poisoning provider health", async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  let calls = 0;
  const h = await harness(async (_provider, _video, abort) => {
    calls++; started();
    return new Promise((_resolve, reject) => abort.addEventListener("abort", () => reject(abort.reason), { once: true }));
  });
  const first = new AbortController();
  const running = h.fetch(id(1), 120, first.signal);
  await ready;
  const second = new AbortController();
  const queued = h.fetch(id(2), 120, second.signal);
  second.abort();
  await assert.rejects(queued);
  first.abort();
  await assert.rejects(running);
  assert.equal(calls, 1);
});

test("Supadata status classification handles exhausted credits, rate limits, auth and unavailable captions", async () => {
  const original = globalThis.fetch;
  try {
    for (const [status, code] of [[402, "quota"], [429, "rate_limited"], [401, "auth"], [206, "unavailable"], [503, "temporary"]] as const) {
      globalThis.fetch = async () => Response.json({}, { status, headers: { "retry-after": "123" } });
      await assert.rejects(fetchSupadata(id(1), signal(), { SUPADATA_API_KEY: "key" }), (error: unknown) => {
        assert.ok(error instanceof CaptionFailure);
        assert.equal(error.code, code);
        if (status === 429) assert.equal(error.cooldownMs, 123000);
        if (status === 402) assert.equal(error.retryable, false);
        return true;
      });
    }
  } finally { globalThis.fetch = original; }
});

test("missing Python produces a redacted setup error instead of crashing the worker", async () => {
  await assert.rejects(fetchSelfHosted(id(1), signal(), { TRANSCRIPT_PYTHON: "missing-transcript-python-executable" }),
    (error: unknown) => error instanceof CaptionFailure && error.code === "setup");
});

test("temporary blocks schedule recovery across restart; permanent missing captions and setup errors do not", async () => {
  let blocked = true;
  const h = await harness(async () => {
    if (blocked) throw new CaptionFailure("blocked", "Blocked", 60000, true);
    return raw;
  }, {});
  const failed = await h.fetch(id(1), 120, signal());
  assert.ok(failed.retryAt);
  const restored = await h.restart()(id(1), 120, signal());
  assert.equal(restored.retryAt, failed.retryAt);
  blocked = false;
  h.advance(60001);
  assert.ok((await h.restart()(id(1), 120, signal())).transcript);
  for (const code of ["unavailable", "setup", "invalid"] as const) {
    const permanent = await harness(async () => { throw new CaptionFailure(code, "Cannot retrieve", code === "setup" ? 60000 : 0); }, {});
    assert.equal((await permanent.fetch(id(1), 120, signal())).retryAt, undefined);
    assert.equal((await permanent.restart()(id(1), 120, signal())).retryAt, undefined);
  }
});

test("scheduled recovery honors cooldowns, survives serialization, preserves model work and has a finite retry budget", () => {
  const now = Date.now();
  const created = new Date(now).toISOString();
  const initial = { retryRounds: 1, captionRetryCount: 0, completedWindows: [0] } as AnalysisProgress;
  const recovery = captionRecovery(initial, now + 3600000, created, now)!;
  assert.equal(recovery.status, "queued");
  const progress = JSON.parse(JSON.stringify({ ...initial, ...recovery }));
  assert.equal(captionRetryDue(progress, now), false);
  assert.equal(captionRetryDue(progress, now + 3600000), true);
  assert.deepEqual(progress.completedWindows, [0]);
  assert.equal(progress.retryRounds, 1);
  assert.equal(progress.captionRetryCount, 1);
  assert.equal(captionRecovery({ ...initial, captionRetryCount: 6 }, now, created, now), null);
  assert.equal(captionRecovery(initial, undefined, created, now), null);
  assert.equal(captionRecovery(initial, now + 86400000, created, now), null);
});
