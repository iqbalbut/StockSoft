import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, clientIp } from "@/lib/auth";
import { handler } from "@/lib/http";
import { getSettings, saveSettings } from "@/lib/settings";
import { audit, diff } from "@/lib/audit";

const Patch = z
  .object({
    autoApproveConfidence: z.number().min(0.5).max(1),
    reviewAmountUsd: z.number().min(0).max(1_000_000),
    retentionYears: z.number().int().min(7, "Tax records are kept at least 7 years").max(30),
    duplicateDayWindow: z.number().int().min(0).max(30),
    duplicateAmountTolerancePct: z.number().min(0).max(10),
    companyName: z.string().min(1).max(120),
  })
  .partial()
  .strict();

export const GET = handler(async () => {
  await requireUser();
  return NextResponse.json(await getSettings());
});

export const PATCH = handler(async (req: Request) => {
  const user = await requireUser({ write: true });
  const patch = Patch.parse(await req.json());
  const before = await getSettings();
  const after = await saveSettings(patch);
  await audit({ type: "user", id: user.id, ip: await clientIp() }, "settings", "app", "updated", diff(before, after));
  return NextResponse.json(after);
});
