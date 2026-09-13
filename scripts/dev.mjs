// Starts the website and the AI analysis worker together. Ctrl+C stops both.
// Extra arguments go to `next dev`, e.g. `npm run dev:all -- -p 3100`.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let shuttingDown = false;

function start(name, args, { required }) {
  const child = spawn(process.execPath, args, { stdio: "inherit" });
  child.on("exit", (code) => {
    if (shuttingDown) return;
    if (required) {
      console.log(`[dev] ${name} exited (${code ?? "signal"}); stopping.`);
      shutdown(code ?? 1);
    } else {
      // The website still works without AI analysis, e.g. when GEMINI_API_KEY is not set yet.
      console.log(`[dev] ${name} exited (${code ?? "signal"}). The website keeps running; AI analysis stays queued until the worker runs.`);
    }
  });
  return child;
}

const children = [
  start("website", [require.resolve("next/dist/bin/next"), "dev", ...process.argv.slice(2)], { required: true }),
  start("analysis worker", [
    "--experimental-strip-types",
    ...(existsSync(".env.local") ? ["--env-file=.env.local"] : []),
    "scripts/analysis-worker.ts",
  ], { required: false }),
];

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGINT");
  process.exitCode = code;
}

for (const event of ["SIGINT", "SIGTERM"]) process.on(event, () => shutdown(0));
