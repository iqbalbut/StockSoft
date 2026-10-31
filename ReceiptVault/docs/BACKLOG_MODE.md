# Backlog mode: 200+ old receipts in one sitting

Expect about **60–90 minutes for 200 paper receipts**, most of it photographing. The AI does the reading while you shoot; you only touch what it isn't sure about.

## 0. Before you start (5 min, once)
- Settings → check the rules. For an old backlog, a **$500 review limit** and **90% confidence** are sensible. Raise the confidence to 95% for the first batch if you want to see more of the AI's work.
- Sort the pile roughly by year if you can (helps you spot gaps); don't bother sorting by type.
- Cost check: roughly **$0.03–0.08 per document** with the default model and effort (an estimate, not yet measured; the first `npm run eval:extraction` prints real token usage). Budget about **$6–16 for 200**, or roughly half that with Economy mode.

## 1. Paper receipts: phone, Batch mode (40–60 min)
1. Open the app → **Capture** → **Batch: 1 photo = 1 receipt**.
2. Lay receipts on a **dark, plain surface** (dark table, black folder) with good light, phone flat above. The server crops the background and boosts faded thermal paper.
3. Snap, next receipt, snap. Don't wait: each photo is compressed and uploaded in the background. With no signal, they queue on the phone and upload later ("X waiting to upload").
4. Long receipts or multi-page bills: switch to **Multi-page document**, snap each part, tap **Done**.
5. Crumpled thermal slips: flatten under a book for a minute; tilt slightly to kill glare.

## 2. Digital files: one ZIP (5 min, and half price)
- Download every PDF/receipt from email, Drive, airline/hotel sites, Careem/Uber, into one folder → zip it → **Upload** → drop the ZIP → name the batch (e.g. "2025 backlog") → **Upload and process**.
- Tick **Economy mode** for anything that isn't urgent: extraction goes through the Message Batches API at **half the AI cost**, and results arrive within about an hour (24 h at most) instead of seconds. Anything the batch can't finish cleanly is retried in real time automatically.
- The progress panel shows *Uploaded*, *Processed by AI*, and the split auto-filed / to review / failed. You can close the page; processing continues on the server.
- Exact re-uploads are skipped instantly (same file hash) and never billed twice.

## 3. Review (15–25 min for ~200)
Typically 20–40% of an old backlog needs a look (blur, handwriting, foreign currency without a printed code, amounts over your limit).
- **Review** tab. One card per document, photo on top.
- **Swipe right / Approve** if it's right. **Tap any orange field** to fix it (orange = below 90% confidence; the dot shows red < 70%, amber < 90%). **Swipe left / Skip** to come back later. **Reject** for non-business or junk.
- **Duplicates**: the card links to the earlier copy. *Discard* if it's the same purchase, *Approve* if it's genuinely separate.
- **Teach it once**: if you change a vendor's category (e.g. "Daraz" → Office expenses) or mark it personal, every future receipt from that vendor gets the same treatment automatically.

## 4. Find what's missing with your bank statements (10 min)
- On your bank and card websites, export each statement for the backlog period as **CSV** (PDF works too; Claude reads it).
- **Bank → Import a statement**, once per account. Receipts are matched automatically; bills found on the statement are marked paid.
- **Charges without a receipt:** search your email for those, or snap them if you still have the paper. Bank fees, ATM withdrawals and transfers: tap *No receipt needed*.
- **Receipts not on any statement:** usually a different card, or a wrong amount or date. Open the record and fix it.

## 5. Check the result (5 min)
- **Dashboard**: claimed vs. not-yet-claimed, spend by category and month.
- **Records → Failed**: open any failures, tap **Re-read** (temporary API errors) or fix by hand.
- **Reports → tax-package-YEAR.zip** is what you send your accountant (or add them as an accountant user so they can download it themselves).
- Every record has its original (download button), a standard file name like `2025-03-14_LahoreGrillHouse_5508.40_PKR.jpg`, the USD amount at that day's rate, and a full audit trail.

## Tips
- Old PKR/AED receipts are converted at the **historical rate on the receipt date**, not today's. If a rate can't be found, the document waits for review rather than guessing.
- Paper you can now shred? Keep originals until your accountant confirms; the app keeps the images for 7 years either way.
