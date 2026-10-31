import { z } from "zod";

// All configuration comes from the environment. Nothing secret is ever hard-coded.
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default("./data/pglite"),

  SESSION_SECRET: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./data/files"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.string().default("true"),

  ANTHROPIC_API_KEY: z.string().optional(),
  EXTRACTION_MODEL: z.string().default("claude-opus-5-5"),
  EXTRACTION_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  EXTRACTION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),

  DEMO_MODE: z.string().default("false"),
  WORKER_MODE: z.enum(["inline", "external"]).default("inline"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(3),

  INGEST_API_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  GMAIL_LABEL: z.string().default("Receipts"),
  GMAIL_DONE_LABEL: z.string().default("Receipts/Processed"),
  DRIVE_FOLDER_ID: z.string().optional(),
  INGEST_POLL_MINUTES: z.coerce.number().int().min(1).default(10),

  // smtp://user:pass@smtp.example.com:587 (or smtps://…:465). Empty = digest/reminder emails are skipped.
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("ReceiptVault <receipts@localhost>"),
  // Economy mode: submit backlog extraction through the Message Batches API (50% cheaper, slower).
  BATCH_POLL_SECONDS: z.coerce.number().int().min(30).default(120),

  FX_API_BASE: z.string().default("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

export const isDemo = () => env().DEMO_MODE === "true";

/** Secrets are mandatory in production; demo/dev fall back to clearly-labelled dev values. */
export function secret(name: "SESSION_SECRET" | "ENCRYPTION_KEY"): string {
  const value = env()[name];
  if (value) return value;
  if (env().NODE_ENV === "production" && !isDemo()) {
    throw new Error(`${name} must be set in production. See .env.example.`);
  }
  // Deterministic dev-only fallbacks so `npm run dev` works out of the box.
  return name === "SESSION_SECRET"
    ? "dev-only-session-secret-change-me-0123456789"
    : "ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzJieXRlcyE="; // 32 bytes, base64
}

export function resetEnvCache() {
  cached = null;
}
