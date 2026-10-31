import { NextResponse } from "next/server";
import { requireUser, clientIp } from "@/lib/auth";
import { handler } from "@/lib/http";
import { saveVendorRule, VendorRulePatch } from "@/pipeline/rules";

export const PATCH = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser({ write: true });
  const patch = VendorRulePatch.parse(await req.json());
  const result = await saveVendorRule((await params).id, patch, { type: "user", id: user.id, ip: await clientIp() });
  return NextResponse.json(result);
});
