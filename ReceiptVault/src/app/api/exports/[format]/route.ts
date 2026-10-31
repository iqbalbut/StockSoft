import { NextResponse } from "next/server";
import { requireUser, clientIp } from "@/lib/auth";
import { handler } from "@/lib/http";
import { audit } from "@/lib/audit";
import { yearData } from "@/reports/data";
import { ledgerCsv, workbook, xeroCsv, qboBankCsv, qboInvoicesCsv } from "@/reports/exports";

const CSV = "text/csv; charset=utf-8";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** /api/exports/{ledger.csv|ledger.xlsx|xero-bills.csv|xero-sales.csv|qbo-invoices.csv|qbo-bank-PKR.csv}?year=2026 */
export const GET = handler(async (req: Request, { params }: { params: Promise<{ format: string }> }) => {
  const user = await requireUser();
  const { format } = await params;
  const year = Number(new URL(req.url).searchParams.get("year")) || new Date().getFullYear();
  const y = await yearData(year);
  let body: string | Buffer, type = CSV;
  if (format === "ledger.csv") body = ledgerCsv(y);
  else if (format === "ledger.xlsx") (body = await workbook(y)), (type = XLSX);
  else if (format === "xero-bills.csv") body = xeroCsv(y, "bills");
  else if (format === "xero-sales.csv") body = xeroCsv(y, "sales");
  else if (format === "qbo-invoices.csv") body = qboInvoicesCsv(y);
  else if (/^qbo-bank-[A-Z]{3}\.csv$/.test(format)) body = qboBankCsv(y, format.slice(9, 12));
  else return NextResponse.json({ error: "Unknown export" }, { status: 404 });
  await audit({ type: "user", id: user.id, ip: await clientIp() }, "report", String(year), "exported", { format });
  return new Response(typeof body === "string" ? "﻿" + body : new Uint8Array(body), {
    headers: { "content-type": type, "content-disposition": `attachment; filename="${format.replace(/(\.\w+)$/, `-${year}$1`)}"`, "cache-control": "no-store" },
  });
});
