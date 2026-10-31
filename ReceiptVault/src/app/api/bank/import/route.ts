import { NextResponse } from "next/server";
import { requireUser, clientIp } from "@/lib/auth";
import { handler } from "@/lib/http";
import { importStatement } from "@/bank/import";

export const maxDuration = 300;

/** multipart: file (CSV, PDF or photo), currency, last4, dayFirst ("1"/"0"), name. */
export const POST = handler(async (req: Request) => {
  const user = await requireUser({ write: true });
  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "Choose a statement file" }, { status: 400 });
  const currency = String(form.get("currency") || "").toUpperCase();
  const last4 = String(form.get("last4") || "");
  const dayFirst = form.get("dayFirst");
  try {
    const result = await importStatement({
      file: { name: file.name, data: Buffer.from(await file.arrayBuffer()) },
      name: String(form.get("name") || "") || undefined,
      currency: /^[A-Z]{3}$/.test(currency) ? currency : undefined,
      accountLast4: /^\d{4}$/.test(last4) ? last4 : undefined,
      dayFirst: dayFirst == null || dayFirst === "" ? undefined : dayFirst === "1",
      actor: { type: "user", id: user.id, ip: await clientIp() },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
});
