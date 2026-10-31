// Next.js startup hook. In WORKER_MODE=inline (default; required for embedded PGlite) the queue worker runs
// inside the web server process, so a single `npm start` / container does everything.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if ((process.env.WORKER_MODE ?? "inline") !== "inline") return;
  const { getDb } = await import("@/db");
  const { startWorker } = await import("@/worker/worker");
  await getDb();
  startWorker();
}
