import { spawn } from "node:child_process";
import { join } from "node:path";

/** Why the website should not start the analysis worker itself, or null when it should. */
export function autostartBlocker(env: Record<string, string | undefined>): string | null {
  if (["0", "false", "off"].includes((env.ANALYSIS_WORKER_AUTOSTART ?? "").trim().toLowerCase())) return "ANALYSIS_WORKER_AUTOSTART is off";
  if (!env.GEMINI_API_KEY) return "GEMINI_API_KEY is not set";
  if (env.NEXT_PHASE === "phase-production-build") return "the app is building";
  return null;
}

let started = false;

/**
 * Runs the analysis worker as its own Node process beside the website, so `npm run dev` is enough for
 * AI analysis; video work never runs inside a web request. The worker exits when this server does, and
 * if another worker already holds the lock it waits briefly (covering server restarts) before exiting.
 */
export function startAnalysisWorker() {
  if (started) return;
  const blocker = autostartBlocker(process.env);
  if (blocker) {
    if (process.env.NEXT_PHASE !== "phase-production-build") console.log(`[analysis] Worker not started: ${blocker}.`);
    return;
  }
  started = true;
  const child = spawn(process.execPath, ["--experimental-strip-types", join(process.cwd(), "scripts", "analysis-worker.ts")], {
    stdio: "inherit",
    env: { ...process.env, ANALYSIS_WORKER_PARENT_PID: String(process.pid) },
  });
  child.on("error", (error) => console.error(`[analysis] Could not start the analysis worker: ${error.message}`));
}
