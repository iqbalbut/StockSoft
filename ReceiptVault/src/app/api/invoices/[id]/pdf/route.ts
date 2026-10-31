import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { loadInvoice, invoicePdf, issuedPdf } from "@/invoices/invoices";

/** Issued invoices return the frozen original; drafts render a watermarked preview. */
export const GET = handler(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireUser();
  const r = await loadInvoice((await params).id);
  if (!r) return new Response("Not found", { status: 404 });
  const pdf = (r.inv.status !== "draft" && (await issuedPdf(r.inv))) || (await invoicePdf(r.inv, r.lines, r.client, await getSettings()));
  return new Response(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${r.inv.number ?? "draft-invoice"}.pdf"`, "cache-control": "private, no-store" },
  });
});
