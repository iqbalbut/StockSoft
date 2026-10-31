# Deployment

Three options; all use the same image/code. Whichever you pick: generate secrets, set `APP_URL` to the HTTPS address, and **back up `ENCRYPTION_KEY` somewhere separate from the database** (password manager). Without it the stored documents cannot be decrypted.

```bash
openssl rand -base64 48   # SESSION_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -hex 32      # INGEST_API_KEY
```

## Option A: one VPS with Docker (recommended: ~$6–12/month, everything in one place)

Any Ubuntu 24.04 VPS with 2 GB RAM (Hetzner, DigitalOcean, Lightsail).

```bash
git clone https://github.com/iqbalbut/StockSoft.git && cd StockSoft/ReceiptVault
cp .env.example .env && nano .env      # secrets, ANTHROPIC_API_KEY, POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD
docker compose up -d --build
```

HTTPS with Caddy (automatic Let's Encrypt), `/etc/caddy/Caddyfile`:

```
receipts.example.com {
  request_body { max_size 60MB }
  reverse_proxy 127.0.0.1:3000
}
```

Backups (nightly cron): `docker compose exec -T db pg_dump -U receiptvault receiptvault | gzip > db-$(date +%F).sql.gz` and mirror the MinIO volume (or point `S3_*` at Backblaze B2 / Cloudflare R2 and enable bucket versioning there instead of running MinIO).

## Option B: Railway

1. New project → Deploy from GitHub repo → set **Root directory** `ReceiptVault` (the Dockerfile is detected).
2. Add a PostgreSQL plugin; set `DATABASE_URL=${{Postgres.DATABASE_URL}}`.
3. Storage: create a Cloudflare R2 (or Backblaze B2) bucket and set `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_BUCKET`, keys, `S3_REGION=auto` for R2.
4. Add the other variables from `.env.example`. Keep `WORKER_MODE=inline`.

## Option C: Vercel + Supabase

Works, with one caveat: Vercel functions don't run background loops, so set `WORKER_MODE=external` and run the worker elsewhere (`npm run worker` on Railway/Fly/a $5 VPS, same env vars). Use Supabase's Postgres connection string (session pooler) as `DATABASE_URL` and Supabase Storage's S3 endpoint for `S3_*`. Raise the function body limit for bulk uploads or upload from the Capture/Upload screens, which already send files in ≤20 MB chunks.

## First run

Open the site → you're sent to **/setup** to create the owner account (only possible while no user exists) → Settings → turn on **two-factor authentication**.

## Google: Gmail label + Drive folder (optional)

1. Google Cloud Console → new project → enable **Gmail API** and **Google Drive API**.
2. OAuth consent screen: External, add yourself as a test user (or publish for your Workspace).
3. Credentials → OAuth client ID → *Web application*, redirect URI `https://developers.google.com/oauthplayground`.
4. In the [OAuth Playground](https://developers.google.com/oauthplayground): gear icon → *Use your own OAuth credentials*; authorize scopes `https://www.googleapis.com/auth/gmail.modify` and `https://www.googleapis.com/auth/drive.readonly`; exchange for tokens; copy the **refresh token**.
5. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and `DRIVE_FOLDER_ID` (the ID at the end of the folder URL).
6. In Gmail create the label **Receipts** and a filter (e.g. from `*@uber.com`, subject contains "receipt" or "invoice", or emails you send to `you+receipts@gmail.com`) that applies it. Processed messages move to **Receipts/Processed**.

Polling runs every `INGEST_POLL_MINUTES` (default 10); Settings → *Check Gmail / Drive now* forces a run.

## n8n / WhatsApp / email-forwarding intake

`POST /api/ingest/webhook` with `Authorization: Bearer $INGEST_API_KEY`:

```json
{ "source": "whatsapp", "sourceRef": "wamid.HBg…", "files": [{ "filename": "receipt.jpg", "contentBase64": "…" }] }
```

`sourceRef` makes retries idempotent. An n8n flow *WhatsApp Trigger → Download media → HTTP Request* gives you forward-to-bot intake without changing this app. Multipart (`files[]`) is accepted too, so Postmark/Mailgun inbound webhooks can post attachments directly.

## Weekly digest and bill reminders

- Email: set `SMTP_URL` and `MAIL_FROM`. For Gmail use an app password: `smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465`.
- Schedule: the digest goes out Mondays at 09:00 and reminders daily at 09:00 in the time zone set in Settings (default Asia/Karachi). Reminders cover unpaid bills due within N days (default 3) and overdue ones, once per bill per day.
- Settings → *Preview this week* / *Send now* to check it.

## Outgoing webhooks: digest on WhatsApp, Slack, Sheets…

Settings → *Outgoing webhooks* → paste an n8n Webhook-node URL and pick events. The secret is shown once.

Each request has headers `x-receiptvault-event`, `x-receiptvault-delivery` (unique id, for de-duplication), `x-receiptvault-timestamp` and `x-receiptvault-signature: sha256=<hex>`, where the hex is HMAC-SHA256 of `"<timestamp>.<raw body>"` with your secret. Verify it in n8n with a *Crypto* node (HMAC, SHA256, hex) and an *IF* node, and reject timestamps older than 5 minutes. Failed deliveries (non-2xx) retry with backoff for about an hour.

WhatsApp digest: *Webhook* (event `digest.weekly`) → *WhatsApp Business Cloud: Send message* with `{{$json.data.text}}` as the body. Bill reminders work the same way with `bill.due_soon`.

## QuickBooks Online and Xero

Reports gives you the files, and the tax package contains them too.
- **Xero bills / sales invoices:** Business → Bills to pay (or Invoices) → Import → upload the CSV. Account codes come from Settings → Company & invoicing → *Account codes* (Xero's default chart preset). Each line's tracking column carries the client for billable expenses.
- **QuickBooks Online:** Banking → Upload transactions → the 3-column `qbo-bank-<CUR>.csv` (one per currency, since QBO bank accounts are single-currency). The category is in the description so a bank rule can file it. For sales, use Sales → Import invoices with `qbo-invoices.csv`.
- **Direct API sync** is not built in. Use the `document.approved` webhook in n8n with n8n's QuickBooks or Xero node (create Purchase / Bill / Invoice) if you want records to appear there automatically. This avoids storing accounting-system OAuth tokens in ReceiptVault.

## Accountant access

Settings → *Accountant access* → add their email and a temporary password (share it privately). Accountants can see everything and download exports and the tax package; every write endpoint returns 403. *Revoke* ends their sessions immediately.

## Security checklist

- HTTPS only (HSTS header is sent). Sessions are HTTP-only cookies; login and 2FA are rate-limited.
- Every file is AES-256-GCM encrypted by the app before storage; S3 uploads additionally request SSE. Originals are written once (`If-None-Match: *` / exclusive create) and never modified or deleted.
- No full card or bank numbers are stored: the prompt forbids them, and a Luhn/IBAN mask runs on all free-text output.
- Secrets live only in environment variables; `.env` is git-ignored.
- Accountant role (read-only) is enforced on every write endpoint.
