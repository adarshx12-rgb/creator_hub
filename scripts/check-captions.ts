import { join } from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createTranscriptFetcher } from "../lib/analysis/transcript.ts";

const [videoId, durationText, ...flags] = process.argv.slice(2);
const local = flags.includes("--local");
const fresh = flags.includes("--fresh");
const repeatFlag = flags.find((flag) => flag.startsWith("--repeat="));
const repeat = repeatFlag ? Number(repeatFlag.split("=")[1]) : 1;
const duration = Number(durationText);
if (!/^[A-Za-z0-9_-]{11}$/.test(videoId ?? "") || !Number.isFinite(duration) || duration <= 0 || duration > 7200 || !Number.isInteger(repeat) || repeat < 1 || repeat > 10
  || flags.some((flag) => !["--local", "--fresh"].includes(flag) && !/^--repeat=\d+$/.test(flag))) {
  console.error("Usage: npm run captions:check -- VIDEO_ID DURATION_SECONDS [--local] [--fresh] [--repeat=1..10]");
  process.exitCode = 1;
} else {
  // Isolate diagnostic state from the running worker's single-writer directory.
  const report = [];
  await mkdir(join(process.cwd(), ".data"), { recursive: true });
  for (let attempt = 0; attempt < repeat; attempt++) {
    const root = fresh ? await mkdtemp(join(process.cwd(), ".data", "caption-audit-"))
      : join(process.cwd(), ".data", local ? "caption-check-local" : "caption-check");
    const fetchCaptions = createTranscriptFetcher({ root,
      env: () => local ? { ...process.env, SUPADATA_API_KEY: "", TRANSCRIPT_SELF_HOSTED: "1" } : process.env,
    });
    const started = Date.now();
    const result = await fetchCaptions(videoId, duration, AbortSignal.timeout(215000));
    const entry = { attempt: attempt + 1, ok: Boolean(result.transcript), provider: result.provider, cached: result.cached,
      language: result.transcript?.language, cues: result.transcript?.segments.length, notice: result.notice, elapsedMs: Date.now() - started };
    report.push(entry);
    console.log(JSON.stringify(entry));
    if (fresh) await writeFile(join(root, "audit.json"), JSON.stringify({ videoId, at: new Date().toISOString(), ...entry }, null, 2));
  }
  const failures = report.filter((entry) => !entry.ok).length;
  console.log(JSON.stringify({ attempts: repeat, failures, fresh, note: "A finite test measures observed failures; it cannot prove zero future failures." }));
  if (failures) process.exitCode = 1;
}
