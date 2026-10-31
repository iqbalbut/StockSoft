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

### Phase 2: classification rules, ledger, payables
Rules editor (vendor → category/client/billable), ledger entries on approval, payables list with due-date reminders and "mark paid", billable expenses attached to clients, weekly email digest ("X processed, Y need review, Z claimable"), outbound webhooks for n8n (`document.approved`, `bill.due`), Message Batches API for big backlogs (~50% cheaper).

### Phase 3: bank matching, reports, exports, invoicing
Bank/card statement upload (CSV/PDF) with auto-matching both ways, year-end tax package (PDF + Excel with linked receipt images), CSV/Excel/QuickBooks Online/Xero exports (and optional API sync), branded outgoing invoices with auto-numbering, PDF and email.

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
