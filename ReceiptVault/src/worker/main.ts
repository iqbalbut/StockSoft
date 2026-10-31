import { getDb } from "@/db";
import { startWorker } from "./worker";

// Dedicated worker process (WORKER_MODE=external): `npm run worker`.
await getDb();
startWorker();
