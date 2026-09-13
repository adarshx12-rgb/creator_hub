import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import * as schemas from "../lib/analysis/schema.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analysisWindows, validateWindow, mergeSegments, CreateAnalysisSchema } from "../lib/analysis/schema.ts";
import type { AnalysisSegment, AnalysisJob } from "../lib/analysis/schema.ts";
import { analyzeWindow } from "../lib/analysis/gemini.ts";

const topic: AnalysisSegment = { startSeconds: 10, endSeconds: 30, title: "Training habits", summary: "The speaker discusses regular practice.", kind: "topic", confidence: "medium", evidence: [{ atSeconds: 15, source: "speech", description: "Discussion of practicing consistently." }] };
const event: AnalysisSegment = { ...topic, kind: "kill", evidence: [{ atSeconds: 15, source: "kill_feed", description: "A new elimination appears in the kill feed." }] };
const window = { start: 0, inputStart: 0, end: 120 };
const output = (segments: AnalysisSegment[]) => ({ inspectedWholeWindow: true, segments });

test("full-video windows cover every second, include boundary context and reject unlimited inputs", () => {
  for (const mode of ["topics", "gameplay"] as const) {
    const windows = analysisWindows(7200, mode);
    assert.equal(windows[0].start, 0);
    assert.equal(windows.at(-1)!.end, 7200);
    for (let i = 1; i < windows.length; i++) {
      assert.equal(windows[i].start, windows[i - 1].end);
      assert.equal(windows[i].inputStart, windows[i].start - 8);
    }
  }
  assert.equal(analysisWindows(601, "topics").at(-1)!.end, 601);
  for (const value of [0, -1, NaN, Infinity, 7201]) assert.throws(() => analysisWindows(value, "topics"));
});

test("analysis input cannot inject a remote URL, provider or fabricated duration", () => {
  assert.equal(CreateAnalysisSchema.safeParse({ provider: "youtube", videoId: "abcdefghijk", mode: "gameplay" }).success, true);
  for (const extra of [{ provider: "twitch" }, { videoId: "https://localhost/private" }, { durationSeconds: 10 }]) {
    assert.equal(CreateAnalysisSchema.safeParse({ provider: "youtube", videoId: "abcdefghijk", mode: "topics", ...extra }).success, false);
  }
});

test("out-of-window, reversed and unsupported evidence timestamps are rejected", () => {
  assert.equal(validateWindow(output([topic]), window, "topics").length, 1);
  for (const patch of [{ startSeconds: -1 }, { startSeconds: 35 }, { endSeconds: 121 }, { evidence: [{ ...topic.evidence[0], atSeconds: 40 }] }]) {
    assert.throws(() => validateWindow(output([{ ...topic, ...patch }]), window, "topics"));
  }
  assert.throws(() => validateWindow({ inspectedWholeWindow: false, segments: [] }, window, "topics"));
});

test("game events require visual evidence and aces require a banner or kill feed", () => {
  assert.equal(validateWindow(output([event]), window, "gameplay").length, 1);
  assert.throws(() => validateWindow(output([{ ...event, evidence: topic.evidence }]), window, "gameplay"));
  assert.throws(() => validateWindow(output([{ ...event, kind: "ace", evidence: [{ ...event.evidence[0], source: "visual" }] }]), window, "gameplay"));
  assert.equal(validateWindow(output([{ ...event, kind: "ace" }]), window, "gameplay").length, 1);
});

test("events crossing chunk boundaries survive and duplicates are removed", () => {
  const crossing = { ...event, startSeconds: 116, endSeconds: 125, evidence: [{ ...event.evidence[0], atSeconds: 123 }] };
  assert.equal(validateWindow(output([crossing]), { start: 120, inputStart: 112, end: 240 }, "gameplay").length, 1);
  assert.equal(mergeSegments([event], [event, crossing]).length, 2);
});

test("Gemini request uses actual video input, absolute clipping, higher gameplay FPS and strict output", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-only-key";
  try {
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /^https:\/\/generativelanguage.googleapis.com\/v1beta\/models\//);
      const body = JSON.parse(String(init?.body));
      const part = body.contents[0].parts[0];
      assert.equal(part.fileData.fileUri, "https://www.youtube.com/watch?v=abcdefghijk");
      assert.equal(part.videoMetadata.fps, 4);
      assert.equal(part.videoMetadata.endOffset, "120s");
      assert.equal(body.generationConfig.responseFormat.text.mimeType, "application/json");
      return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(output([event])) }] } }] });
    };
    const job = { videoId: "abcdefghijk", durationSeconds: 120, mode: "gameplay" } as AnalysisJob;
    assert.equal((await analyzeWindow(job, window))[0].kind, "kill");
    globalThis.fetch = async () => Response.json({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: JSON.stringify(output([event])) }] } }] });
    await assert.rejects(analyzeWindow(job, window), /did not finish/);
    globalThis.fetch = async () => new Response(null, { status: 429 });
    await assert.rejects(analyzeWindow(job, window), /quota or rate limit/);
  } finally { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey; }
});

const folder = await mkdtemp(join(tmpdir(), "momentscout-analysis-test-"));
process.env.ANALYSIS_DATA_DIR = folder;
const store = await import("../lib/analysis/store.ts");
after(async () => { await rm(folder, { recursive: true, force: true }); });

test("durable jobs restore completed windows after restart, with cancellation and safe IDs", async () => {
  const job = await store.createJob("owner-a", "abcdefghijk", "topics", 1200);
  const queued = await store.getProgress(job);
  assert.equal(queued.status, "queued");
  await store.writeProgress(job.id, { ...queued, status: "running", completedWindows: 1, coveredSeconds: 600, segments: [topic] });
  const restored = await store.getJob(job.id);
  assert.equal(restored!.owner, "owner-a");
  assert.equal((await store.getProgress(restored!)).coveredSeconds, 600);
  assert.equal((await store.getProgress(restored!)).completedWindows, 1);
  assert.equal(await store.getJob("../../.env.local"), null);
  await store.cancelJob(job.id);
  assert.equal((await store.getProgress(job)).status, "cancelled");
  assert.equal((await store.getProgress(job)).segments.length, 1);
});

test("API enforces owner isolation, CSRF protection, source eligibility and idempotent queuing", async () => {
  const require = createRequire(import.meta.url);
  let eligible = true;
  const dependencies: Record<string, unknown> = {
    "node:crypto": require("node:crypto"), "node:fs/promises": require("node:fs/promises"), "node:path": require("node:path"),
    "next/server": require("next/server"), "@/lib/analysis/schema": schemas, "@/lib/analysis/store": store,
    "@/lib/youtube": { getYoutubeVideo: async () => ({ durationSeconds: 120, capabilities: { canAnalyze: eligible } }) },
  };
  const code = ts.transpileModule(await readFile(new URL("../app/api/analysis/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const api: Record<string, (request: unknown) => Promise<Response>> = {};
  vm.runInNewContext(code, { exports: api, require: (name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`); return dependencies[name];
  }, Buffer, URL, process: { env: { GEMINI_API_KEY: "mock", YOUTUBE_API_KEY: "mock" } } });
  const token = "a".repeat(64);
  const owner = createHash("sha256").update(token).digest("hex");
  function request(method: string, suffix: string, body?: unknown, cookie = token, origin = "http://localhost:3000") {
    const url = `http://localhost:3000/api/analysis${suffix}`;
    const raw = new Request(url, { method, headers: { origin }, body: body ? JSON.stringify(body) : undefined });
    return { url, nextUrl: new URL(url), body: raw.body, headers: raw.headers, cookies: { get: () => cookie ? { value: cookie } : undefined } };
  }
  const job = await store.createJob(owner, "abcdefghijk", "topics", 120);
  assert.equal((await api.GET(request("GET", `?id=${job.id}`))).status, 200);
  assert.equal((await api.GET(request("GET", `?id=${job.id}`, undefined, "b".repeat(64)))).status, 404);
  assert.equal((await api.DELETE(request("DELETE", `?id=${job.id}`, undefined, "b".repeat(64)))).status, 404);
  assert.equal(await store.isCancelled(job.id), false);
  const input = { provider: "youtube", videoId: "abcdefghijk", mode: "topics" };
  assert.equal((await api.POST(request("POST", "", input, token, "https://evil.example"))).status, 403);
  const repeated = await api.POST(request("POST", "", input));
  assert.equal((await repeated.json()).id, job.id);
  assert.equal((await api.POST(request("POST", "", { ...input, provider: "twitch" }))).status, 400);
  await api.DELETE(request("DELETE", `?id=${job.id}`));
  eligible = false;
  assert.equal((await api.POST(request("POST", "", input))).status, 422);
  eligible = true;
  assert.equal((await api.POST(request("POST", "", input))).status, 202);
});
