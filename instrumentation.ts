export async function register() {
  // Start the AI analysis worker beside the website so `npm run dev` is all that's needed.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAnalysisWorker } = await import("@/lib/analysis/autostart");
    startAnalysisWorker();
  }
}
