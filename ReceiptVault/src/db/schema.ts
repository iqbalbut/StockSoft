import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  numeric,
  boolean,
  jsonb,
  date,
  real,
  index,
  uniqueIndex,
  primaryKey,
  bigserial,
} from "drizzle-orm/pg-core";

// Money columns are numeric(18,4) and surface as strings in JS so we never lose precision.
const money = (name: string) => numeric(name, { precision: 18, scale: 4 });
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash").notNull(),
  // owner = full access; accountant = read-only + export (Phase 3 exports).
  role: text("role", { enum: ["owner", "accountant"] }).notNull().default("owner"),
  totpSecretEnc: text("totp_secret_enc"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  sessionVersion: integer("session_version").notNull().default(1),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  code: text("code"),
  email: text("email"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").references(() => clients.id),
  name: text("name").notNull(),
  code: text("code"),
});

export const vendors = pgTable(
  "vendors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    taxId: text("tax_id"),
    // Learned defaults: set when the owner corrects a field for this vendor.
    defaultCategory: text("default_category"),
    defaultIsBusiness: boolean("default_is_business"),
    defaultClientId: uuid("default_client_id").references(() => clients.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("vendors_normalized_name_idx").on(t.normalizedName)],
);

export const batches = pgTable("batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  source: text("source").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const DOCUMENT_STATUSES = [
  "queued",
  "processing",
  "needs_review",
  "approved",
  "rejected",
  "duplicate",
  "failed",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: text("status", { enum: DOCUMENT_STATUSES }).notNull().default("queued"),
    source: text("source", {
      enum: ["camera", "upload", "zip", "gmail", "drive", "webhook", "whatsapp", "seed"],
    }).notNull(),
    sourceRef: text("source_ref"), // e.g. Gmail message id / Drive file id (idempotent ingestion)
    batchId: uuid("batch_id").references(() => batches.id),
    originalFilename: text("original_filename").notNull(),
    archivedFilename: text("archived_filename"), // YYYY-MM-DD_Vendor_Amount_CUR.ext
    sha256: text("sha256").notNull(), // hash of the first page / original file

    // Extracted + classified fields (the editable "current truth").
    docType: text("doc_type"),
    vendorId: uuid("vendor_id").references(() => vendors.id),
    vendorName: text("vendor_name"),
    vendorTaxId: text("vendor_tax_id"),
    docNumber: text("doc_number"),
    docDate: date("doc_date"),
    dueDate: date("due_date"),
    currency: text("currency"),
    subtotal: money("subtotal"),
    tax: money("tax"),
    tip: money("tip"),
    total: money("total"),
    paymentMethod: text("payment_method"),
    cardLast4: text("card_last4"),
    category: text("category"),
    isBusiness: boolean("is_business"),
    isBillable: boolean("is_billable"),
    clientRef: text("client_ref"),
    clientId: uuid("client_id").references(() => clients.id),
    projectId: uuid("project_id").references(() => projects.id),
    language: text("language"),
    notes: text("notes"),

    // USD conversion at the historical rate on doc_date (original amounts are kept above).
    fxRate: numeric("fx_rate", { precision: 20, scale: 10 }),
    fxDate: date("fx_date"),
    totalUsd: money("total_usd"),

    // Routing metadata.
    fieldConfidence: jsonb("field_confidence").$type<Record<string, number>>(),
    overallConfidence: real("overall_confidence"),
    reviewReasons: jsonb("review_reasons").$type<string[]>().notNull().default([]),
    duplicateOfId: uuid("duplicate_of_id"),
    rawExtraction: jsonb("raw_extraction"),
    extractionModel: text("extraction_model"),
    error: text("error"),

    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: ts("approved_at"),
    autoApproved: boolean("auto_approved").notNull().default(false),
    retainUntil: date("retain_until"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("documents_status_idx").on(t.status),
    index("documents_sha_idx").on(t.sha256),
    index("documents_vendor_date_idx").on(t.vendorId, t.docDate),
    uniqueIndex("documents_source_ref_idx").on(t.source, t.sourceRef),
  ],
);

/** Every page/file of a document. The original bytes are stored encrypted and never modified. */
export const documentFiles = pgTable(
  "document_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    pageNo: integer("page_no").notNull().default(1),
    kind: text("kind", { enum: ["original", "processed"] }).notNull().default("original"),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("document_files_doc_idx").on(t.documentId)],
);

export const lineItems = pgTable("line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id),
  position: integer("position").notNull(),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }),
  unitPrice: money("unit_price"),
  amount: money("amount"),
});

export const fxRates = pgTable(
  "fx_rates",
  {
    rateDate: date("rate_date").notNull(),
    currency: text("currency").notNull(),
    // Units of `currency` per 1 USD.
    perUsd: numeric("per_usd", { precision: 20, scale: 10 }).notNull(),
    source: text("source").notNull(),
  },
  (t) => [primaryKey({ columns: [t.rateDate, t.currency] })],
);

/** Append-only audit trail: who/what changed each record and when. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorType: text("actor_type", { enum: ["user", "system", "ai"] }).notNull(),
    actorId: text("actor_id"),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    changes: jsonb("changes"),
    ip: text("ip"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_entity_idx").on(t.entity, t.entityId)],
);

/** Postgres-backed job queue (SELECT ... FOR UPDATE SKIP LOCKED). */
export const jobs = pgTable(
  "jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status", { enum: ["pending", "running", "done", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(4),
    runAt: ts("run_at").notNull().defaultNow(),
    lockedAt: ts("locked_at"),
    lastError: text("last_error"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("jobs_pick_idx").on(t.status, t.runAt)],
);

/** Cursor state for Gmail / Drive pollers. */
export const ingestState = pgTable("ingest_state", {
  source: text("source").primaryKey(),
  cursor: text("cursor"),
  lastRunAt: ts("last_run_at"),
  lastError: text("last_error"),
});
