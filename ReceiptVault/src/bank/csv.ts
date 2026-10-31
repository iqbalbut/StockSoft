/** RFC 4180-ish CSV parser (quoted fields, escaped quotes, CRLF, ; or , or tab delimiters). */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(field), (field = "");
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const iso = (y: number, m: number, d: number) =>
  m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y < 100 ? 2000 + y : y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;

/** Parses common bank date formats. `dayFirst` resolves 03/04/2026 (UK/PK: 3 April; US: March 4). */
export function parseDate(raw: string, dayFirst: boolean): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3})[A-Za-z]*[-/. ,]+(\d{2,4})/);
  if (m) return iso(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  m = s.match(/^([A-Za-z]{3})[A-Za-z]*\.? (\d{1,2}),? (\d{4})/);
  if (m) return iso(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return dayFirst ? iso(+m[3], +m[2], +m[1]) : iso(+m[3], +m[1], +m[2]);
  return null;
}

/** "1,234.50", "(45.00)", "45.00 DR", "-45", "PKR 4,500" → signed number (DR/parentheses = negative). */
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) (neg = true), (s = s.slice(1, -1));
  if (/\bDR\b|\bDebit\b/i.test(s)) neg = true;
  s = s.replace(/\b(CR|DR|Credit|Debit)\b/gi, "").replace(/[A-Za-z$£€₨]/g, "").replace(/[,\s]/g, "");
  if (s.startsWith("-")) (neg = !neg), (s = s.slice(1));
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

export type ParsedTxn = { date: string; description: string; amount: number };
export type CsvParseResult = { transactions: ParsedTxn[]; skipped: number; columns: Record<string, string>; dayFirst: boolean };

const find = (headers: string[], re: RegExp) => headers.findIndex((h) => re.test(h));

/**
 * Maps a bank's CSV export to transactions. Detects the header row and the date / description / amount
 * (or separate debit + credit) columns, and the date order from the data when unambiguous.
 */
export function readStatementCsv(text: string, opts: { dayFirst?: boolean } = {}): CsvParseResult {
  const rows = parseCsv(text);
  const headerIdx = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /amount|debit|credit|withdraw|deposit/i.test(c)));
  if (headerIdx < 0) throw new Error("Couldn't find a header row with Date and Amount (or Debit/Credit) columns");
  const headers = rows[headerIdx].map((h) => h.trim().toLowerCase());
  const col = {
    date: find(headers, /^(transaction |txn |posting |value |booking )?date|^date/),
    desc: find(headers, /description|narration|details|particulars|payee|merchant|memo|reference|remarks/),
    amount: find(headers, /^amount|amount$|^amount \(|transaction amount/),
    debit: find(headers, /debit|withdraw|money out|paid out/),
    credit: find(headers, /credit|deposit|money in|paid in/),
  };
  if (col.date < 0 || col.desc < 0 || (col.amount < 0 && col.debit < 0)) throw new Error("Couldn't identify the date, description and amount columns");
  const data = rows.slice(headerIdx + 1);

  // Date order: any first part > 12 ⇒ day-first; any second part > 12 ⇒ month-first.
  let dayFirst = opts.dayFirst ?? true;
  for (const r of data) {
    const m = (r[col.date] ?? "").trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    if (+m[1] > 12) dayFirst = true;
    else if (+m[2] > 12) dayFirst = false;
    else continue;
    break; // the data settles it, overriding the default
  }

  const transactions: ParsedTxn[] = [];
  let skipped = 0;
  for (const r of data) {
    const date = parseDate(r[col.date] ?? "", dayFirst);
    let amount: number | null = null;
    if (col.amount >= 0) amount = parseAmount(r[col.amount] ?? "");
    else {
      const debit = parseAmount(r[col.debit] ?? "");
      const credit = col.credit >= 0 ? parseAmount(r[col.credit] ?? "") : null;
      if (debit) amount = -Math.abs(debit);
      else if (credit) amount = Math.abs(credit);
    }
    const description = (r[col.desc] ?? "").trim().replace(/\s+/g, " ");
    if (!date || amount == null || amount === 0 || !description) {
      skipped++;
      continue;
    }
    transactions.push({ date, description: description.slice(0, 300), amount });
  }
  return {
    transactions,
    skipped,
    dayFirst,
    columns: Object.fromEntries(Object.entries(col).filter(([, i]) => i >= 0).map(([k, i]) => [k, rows[headerIdx][i]])),
  };
}
