# ReceiptVault: document & invoice automation for AiNetworks LLC

Snap, forward or drop a receipt. ReceiptVault reads it with Claude, categorises it for a US small business, converts it to USD at the historical rate, checks for duplicates, and either files it automatically or puts it in a one-thumb review queue. Originals are encrypted and kept for 7 years with a full audit trail.

**Status: all three phases built.**
1. Capture, AI extraction and the review queue.
2. Rules, ledger, bills with reminders, clients, weekly digest, webhooks and economy mode.
3. Bank/card statement matching, the year-end tax package, CSV/Excel/QuickBooks/Xero exports, branded invoices, and accountant access.

See [docs/PLAN.md](docs/PLAN.md) for assumptions, known limits and the phone test checklists.

| Doc | |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | Assumptions, phases, limits, phone test checklists |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture diagram, data model, stack choices |
| [docs/EXTRACTION.md](docs/EXTRACTION.md) | Prompt, JSON schema, routing rule, the 10 test cases |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | VPS + Docker, Railway, Vercel; Gmail/Drive; webhooks; security |
| [docs/BACKLOG_MODE.md](docs/BACKLOG_MODE.md) | Processing 200+ old receipts in one session |

## Run the demo locally (2 minutes, no accounts needed)

Requires Node 20.9+.

```bash
cd ReceiptVault
npm install
npm run fixtures            # draws the 10 sample receipts (already committed; safe to re-run)
DEMO_MODE=true npm run seed # demo user + 10 documents through the real pipeline
DEMO_MODE=true npm run dev
```

Open http://localhost:3000 and sign in with the pre-filled demo account (`demo@ainetworks.example` / `demo-receipts-2026`). Without `ANTHROPIC_API_KEY`, extraction returns sample data so you can try the whole flow for free. Add the key to `.env` to read real receipts. To use it from your phone on the same Wi-Fi, open `http://<your-computer-ip>:3000`.

The demo uses an embedded Postgres (PGlite) in `./data`; delete that folder to start over. Production uses a real PostgreSQL via `DATABASE_URL`.

## Commands

| | |
|---|---|
| `npm run dev` / `npm run build` / `npm start` | Next.js app (the queue worker runs inside it by default) |
| `npm run worker` | Standalone worker, for `WORKER_MODE=external` |
| `npm test` | Unit + pipeline tests (offline, in-memory DB) |
| `npm run eval:extraction` | Live accuracy eval of the 10 test cases against Claude (needs `ANTHROPIC_API_KEY`) |
| `npm run db:generate` | New migration after editing `src/db/schema.ts` (applied automatically on boot) |
| `npm run seed` | Demo data |

## Layout

```
src/
  app/            pages (dashboard, capture, upload, review, records, settings) and API routes
  components/     UI (review queue, capture with offline queue, bulk upload, field editor)
  extraction/     prompt, JSON schema, Claude call, preprocessing, sanitising, test cases, demo mock
  pipeline/       ingest, process, routing rules, duplicates, FX, naming, job queue, ledger, payables, rules, digest, webhooks, economy batches
  bank/           statement CSV parser, PDF statement reading, matching engine
  reports/        year data, PDF writer, exports (CSV/Excel/Xero/QuickBooks), tax package
  invoices/       outgoing invoices: drafts, numbering, PDF, email, void
  ingest/         Gmail and Drive pollers
  worker/         queue worker
  db/             Drizzle schema + client (Postgres or embedded PGlite)
  lib/            env, auth, crypto (AES-GCM, scrypt, TOTP), storage, audit, settings
drizzle/          SQL migrations
fixtures/images/  the 10 test-case images
fixtures/statements/ demo bank/card CSV statements
tests/            vitest suites
```
