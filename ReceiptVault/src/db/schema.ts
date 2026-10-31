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
  bigint,
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
    defaultIsBillable: boolean("default_is_billable"),
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
      enum: ["camera", "upload", "zip", "gmail", "drive", "webhook", "whatsapp", "seed", "invoice"],
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

    // Payment tracking for vendor bills (payables) and sales invoices (receivables).
    paidAt: date("paid_at"),
    paidAmount: money("paid_amount"),
    paymentRef: text("payment_ref"),
    remindedAt: ts("reminded_at"),
    // Billable expense re-invoiced to the client (Phase 3 links the invoice).
    rebilledAt: date("rebilled_at"),
    // Economy (Message Batches API) extraction.
    economy: boolean("economy").notNull().default(false),
    aiBatchId: uuid("ai_batch_id"),

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

/**
 * Single-entry ledger of approved business transactions. Postings are never edited: a change to an
 * approved document reverses the old entry and posts a new one, so history stays reconstructable.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    entryDate: date("entry_date").notNull(),
    kind: text("kind", { enum: ["expense", "revenue"] }).notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    amount: money("amount").notNull(), // original currency; negative for reversals
    currency: text("currency").notNull(),
    amountUsd: money("amount_usd"),
    fxRate: numeric("fx_rate", { precision: 20, scale: 10 }),
    taxAmount: money("tax_amount"),
    isBillable: boolean("is_billable").notNull().default(false),
    clientId: uuid("client_id").references(() => clients.id),
    reversalOf: bigint("reversal_of", { mode: "number" }),
    reversed: boolean("reversed").notNull().default(false),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("ledger_doc_idx").on(t.documentId), index("ledger_date_idx").on(t.entryDate)],
);

/** Outbound webhooks (n8n, Zapier): signed with HMAC-SHA256. */
export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: jsonb("events").$type<string[]>().notNull(),
  active: boolean("active").notNull().default(true),
  lastStatus: text("last_status"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Anthropic Message Batches submitted for economy extraction. */
export const aiBatches = pgTable("ai_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  anthropicId: text("anthropic_id"),
  documentIds: jsonb("document_ids").$type<string[]>().notNull(),
  status: text("status", { enum: ["submitted", "ended", "failed"] }).notNull().default("submitted"),
  error: text("error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  endedAt: ts("ended_at"),
});

/** An imported bank or card statement (CSV, or PDF read by Claude). The original file is kept encrypted. */
export const statements = pgTable("statements", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  accountLabel: text("account_label"),
  accountLast4: text("account_last4"),
  currency: text("currency").notNull(),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  sourceFormat: text("source_format", { enum: ["csv", "pdf"] }).notNull(),
  storageKey: text("storage_key"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const MATCH_STATUSES = ["unmatched", "suggested", "matched", "ignored"] as const;

export const bankTransactions = pgTable(
  "bank_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    statementId: uuid("statement_id")
      .notNull()
      .references(() => statements.id),
    txnDate: date("txn_date").notNull(),
    description: text("description").notNull(),
    amount: money("amount").notNull(), // negative = money out (debit), positive = money in
    currency: text("currency").notNull(),
    // Same account + date + amount + description = same transaction (re-imported overlapping statements).
    fingerprint: text("fingerprint").notNull(),
    matchStatus: text("match_status", { enum: MATCH_STATUSES }).notNull().default("unmatched"),
    documentId: uuid("document_id").references(() => documents.id),
    matchScore: real("match_score"),
    matchedBy: text("matched_by"), // "auto" or a user id
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bank_txn_fingerprint_idx").on(t.fingerprint),
    index("bank_txn_doc_idx").on(t.documentId),
    index("bank_txn_date_idx").on(t.txnDate),
  ],
);

/** Outgoing invoices issued by the company. Issuing one creates its sales-invoice document (receivables, ledger). */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number"), // assigned on issue: PREFIX-YYYY-NNN
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    status: text("status", { enum: ["draft", "issued", "void"] }).notNull().default("draft"),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date").notNull(),
    currency: text("currency").notNull(),
    taxRate: numeric("tax_rate", { precision: 6, scale: 3 }).notNull().default("0"),
    subtotal: money("subtotal").notNull().default("0"),
    tax: money("tax").notNull().default("0"),
    total: money("total").notNull().default("0"),
    notes: text("notes"),
    documentId: uuid("document_id").references(() => documents.id),
    sentAt: ts("sent_at"),
    sentTo: text("sent_to"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("invoices_number_idx").on(t.number)],
);

export const invoiceLines = pgTable("invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id),
  position: integer("position").notNull(),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull().default("1"),
  unitPrice: money("unit_price").notNull(),
  amount: money("amount").notNull(),
  // Re-billed expense this line came from (marked rebilled when the invoice is issued).
  sourceDocumentId: uuid("source_document_id").references(() => documents.id),
});

/** Atomic counters (invoice numbering per year). */
export const counters = pgTable("counters", {
  key: text("key").primaryKey(),
  value: integer("value").notNull(),
});
