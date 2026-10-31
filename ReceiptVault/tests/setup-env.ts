import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Isolated, offline environment: in-memory Postgres, temp file store, mock extractor.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rv-test-"));
process.env.PGLITE_DIR = "memory://";
process.env.STORAGE_LOCAL_DIR = dir;
process.env.DEMO_MODE = "true";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DATABASE_URL;
