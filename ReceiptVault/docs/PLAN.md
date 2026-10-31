# Plan, assumptions and phase checklists

## Assumptions (tell me if any are wrong)
1. **Single company, small team.** One owner (you) plus, later, a read-only accountant. Not multi-tenant.
2. **US books in USD.** Every document keeps its original currency and amount; USD is computed at the historical rate on the document date (free daily rates from the fawazahmed0 currency API, cached in the database).
3. **Categories follow IRS Schedule C lines** (with Software/SaaS, Telecom and Bank fees split out under "Other expenses"). If your CPA files differently (e.g. Form 1065/1120 for a multi-member or C-corp LLC), the mapping is one table in `src/extraction/schema.ts`.
4. **Meals are recorded at 100%;** the 50% deduction limit is applied in the year-end tax package (Phase 3), not on each receipt.
5. **"Claimed" means approved into the records.** Reimbursement to you personally (accountable plan) is a Phase 2 add-on if you pay business costs from personal cards.
6. **Retention: 7 years** from the end of the document's year; nothing is ever hard-deleted inside that window.
7. **Accuracy is measured, not promised.** Auto-approval relies on the model's per-field confidence, which is self-reported. The live eval (`npm run eval:extraction`) reports *silent errors* (confident and wrong), and you should run it on a sample of your real receipts before trusting auto-approval. Until then, keep the threshold at 90%+ and the amount limit on.
8. **WhatsApp intake goes through n8n** (or any bot) posting to the webhook, rather than a built-in WhatsApp Business integration, which needs Meta business verification.
9. **Model:** Claude Opus 5.5 (`claude-opus-5-5`) at medium effort. You can switch to a cheaper model with `EXTRACTION_MODEL`, but re-run the eval if you do.

## Phases

### Phase 1 (this delivery): capture, extraction, review queue ✅
Capture (PWA camera with offline queue, multi-page, batch mode; bulk upload incl. ZIP; Gmail label; Drive folder; webhook for n8n/WhatsApp) · Claude vision extraction with strict schema, validation and retry · confidence-based routing · one-thumb review queue · encrypted originals · audit trail · auth with TOTP 2FA and an accountant role · dashboard · demo mode.

Pulled forward from Phase 2 because routing needs them: exact + fuzzy **duplicate detection**, **historical FX to USD**, **vendor rules that learn** from your corrections, **auto-rename** `YYYY-MM-DD_Vendor_Amount_CUR.ext`.

Honest limits in Phase 1:
- No true perspective de-skew on the phone. The server auto-rotates, trims the background and boosts contrast; Claude reads moderately skewed photos fine, but very angled shots should be retaken.
- iPhone HEIC files uploaded *directly* (not via the camera screen) are rejected with a clear message; the Capture screen converts them to JPEG automatically.
- The live extraction eval has not been run yet (no API key in the build environment).

### Phase 2 (this delivery): rules, ledger, payables, digest ✅
- **Vendor rules editor** (Rules): category, business/personal, billable, client per vendor. Saving a rule fills that vendor's documents in review and auto-approves the ones it fully resolves. Corrections in review still teach rules automatically.
- **Ledger** (Ledger): approved business documents post automatically; edits and rejections reverse and repost, never overwrite. Cash or accrual basis in Settings.
- **Bills & invoices** (Bills): unpaid vendor bills sorted by due date (overdue in red), unpaid sales invoices, *Mark paid* with date/amount/reference, undo.
- **Reminders**: daily at 09:00, by email and webhook, for bills due within N days or overdue.
- **Clients & billable expenses** (Clients): receipts mentioning a client's name or code ("Acme Retail project", "PO BWA-114") are linked automatically; per-client list of expenses to re-invoice with *Mark as re-invoiced*.
- **Weekly digest** (Mondays 09:00): "X documents processed, Y need review, Z claimable", plus bills due, by email and the `digest.weekly` webhook (WhatsApp via n8n).
- **Outgoing webhooks** for n8n/Zapier, HMAC-signed, with retries.
- **Economy mode** for backlogs: Message Batches API at 50% of the cost; failed or invalid batch results fall back to the real-time path.

Phase 2 limits:
- Changing the accounting basis applies to new postings only; it doesn't rewrite earlier entries.
- Re-invoicing is a manual "mark as re-invoiced" until Phase 3 generates the invoice.
- Reminders and the digest need SMTP for email; without it they go to webhooks only.

### Phase 3 (this delivery): bank matching, reports, exports, invoicing ✅
- **Bank & card statements** (Bank): import CSV (columns, date order and debit/credit layouts detected automatically) or PDF/photo (read by Claude). Overlapping imports don't duplicate. Matching is automatic and handles a USD card charged for a PKR/AED receipt. Ambiguous pairs are suggested for one-tap confirmation. Gaps are flagged both ways: charges without receipts, and receipts not on any statement. A matched bill or invoice is marked paid.
- **Year-end tax package** (Reports): a ZIP with:
  - a summary PDF: IRS Schedule C totals with meals at 50%, monthly totals, the full ledger, and every receipt as an appendix page;
  - an Excel workbook whose receipt column links to the original files;
  - a ledger CSV, the Xero/QuickBooks import files, and all original receipts with their standard names.
- **Exports**: ledger CSV, Excel workbook, Xero bills and sales invoices, QuickBooks Online bank transactions (per currency) and invoices. Account codes are configurable. Direct API sync goes through n8n (see DEPLOYMENT).
- **Invoices**:
  - Branded PDF with automatic numbering (AIN-2026-001…).
  - Lines entered by hand, or pulled in from a client's billable expenses with an optional markup.
  - Issue, email with the PDF attached, void.
  - Issued invoices flow into receivables, the ledger and the tax package.
- **Accountant access**: read-only users who can download exports and the tax package.

Phase 3 limits:
- **Direct QuickBooks/Xero API sync isn't built in.** Use the exports, or an n8n flow on `document.approved`.
- **PDF statements depend on Claude reading them.** CSV from the bank is exact, so prefer it; very long PDFs should be split by month.
- **Invoice PDFs use standard PDF fonts.** Text outside Latin-1 (e.g. Urdu) is replaced with "?". Client and line text should be in English.
- **The tax package uses Schedule C lines.** If AiNetworks files Form 1065 or 1120, your preparer maps the same categories to that form.

## Phase 1 test checklist (from your phone, ~15 minutes)
Deploy (docs/DEPLOYMENT.md) or run the demo, then on your phone:

1. **Install:** open the site → iPhone Share → *Add to Home Screen* / Android ⋮ → *Install app*. It opens straight to Capture.
2. **Sign up + 2FA:** create the owner account → Settings → *Turn on* 2FA → scan the QR → sign out and back in with the code.
3. **Single receipt:** Capture → snap a real restaurant receipt. Within ~30 s it appears on Home (*Latest documents*) as Approved or Needs review.
4. **Batch:** snap 5 receipts back to back without waiting. All 5 arrive.
5. **Offline:** turn on airplane mode → snap 2 receipts → "2 waiting to upload" → airplane mode off → they upload by themselves.
6. **Multi-page:** switch to *Multi-page document* → snap 2 pages → Done → one record with 2 page dots.
7. **Review:** Review tab → tap an orange field, fix it, Save → swipe right to approve → the badge count drops.
8. **Learning:** change a vendor's category in review → upload another receipt from the same vendor → it arrives with your category (confidence dot green).
9. **Duplicate:** photograph the same receipt again → it lands in Review as *Possible duplicate* with a link to the first one.
10. **Foreign currency:** a PKR or AED receipt shows ≈ USD on the card; the record shows the rate and date used.
11. **Records:** open any record → *Download original* → file name follows `YYYY-MM-DD_Vendor_Amount_CUR`; audit trail lists ingested → extracted → your edits → approved.
12. **Gmail (if connected):** label an emailed receipt *Receipts* → Settings → *Check Gmail now* → it appears within a minute and the email moves to *Receipts/Processed*.
13. **Dark mode:** switch the phone to dark mode; the app follows.

## Phase 2 test checklist (from your phone, ~15 minutes)
1. **Bills:** photograph or forward a utility/internet bill with a due date. It appears in **Bills to pay** (red if overdue).
2. **Mark paid:** tap *Mark paid* → keep today's date → add a reference → Save. It moves to *Recently paid*, and **Ledger** shows it dated today (cash basis).
3. **Ledger reversal:** open an approved receipt → change the total → Ledger shows the old line struck through, a reversal, and the new line. Net effect equals the new total.
4. **Clients:** Clients → add your real client with a short code. Write "for <CODE>" on a receipt, snap it → after approval it shows under that client's *To re-invoice*.
5. **Rules:** Rules → pick a vendor in review → set its category. "Applied to N in review" appears; if that was the only doubt, the item leaves the review queue on its own.
6. **Digest:** Settings → *Preview this week* (check the numbers match the dashboard) → *Send now* → email arrives (with SMTP set).
7. **WhatsApp/n8n:** add an n8n webhook for `digest.weekly` → *Send test* → n8n receives it; *last:* shows `200`.
8. **Reminders:** set a bill's due date to tomorrow (open it, tap Due date) → next morning at 09:00 you get the reminder (or check the n8n webhook).
9. **Economy mode:** Upload → tick *Economy mode* → upload 10 PDFs → they stay "Reading…" and complete within about an hour; the record's model shows "(batch)".

## Phase 3 test checklist (from your phone, ~15 minutes)
1. **Bank import:** on your bank's website, export last month as CSV → Bank → Import (pick the currency, add the last 4 digits) → it shows *N matched, M suggested*.
2. **Confirm / ignore:** open the statement → tap *Confirm match* on a suggestion → tap *No receipt needed* on a bank fee.
3. **Missing receipts:** Bank → *Charges without a receipt* lists the rest. Snap one of those receipts → tap *Re-run matching* → it matches.
4. **Card abroad:** a Dubai/London receipt paid with your USD card matches the card charge even though the amounts differ by FX.
5. **Invoice:** Clients → pick a client with billable expenses → *Create invoice from these* → *+ Billable expenses* (try 10% markup) → Save draft → *Preview PDF* (watermarked) → *Issue & email* to yourself. The number is AIN-YYYY-NNN and the email has the PDF attached.
6. **Invoice paid:** when the client pays, import the statement (or Bills → Invoices to collect → Mark paid). The invoice shows *Paid* and revenue appears in the Ledger.
7. **Tax package:** Reports → choose the year → download the ZIP → open `summary-YEAR.pdf` (totals, then one page per receipt) and `ledger-YEAR.xlsx` (receipt links open the files once the ZIP is extracted).
8. **Exports:** download *Xero: bills* or *QuickBooks: transactions* and do a test import into a Xero/QBO sandbox or demo company.
9. **Accountant:** Settings → Accountant access → add your CPA → sign in as them in a private window: they can download Reports but buttons that change data don't work.
