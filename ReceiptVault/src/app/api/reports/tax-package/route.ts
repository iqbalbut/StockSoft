import { requireUser, clientIp } from "@/lib/auth";
import { handler } from "@/lib/http";
import { audit } from "@/lib/audit";
import { taxPackage } from "@/reports/tax-package";

export const maxDuration = 300;

/** ZIP for the accountant (owner and accountant roles). */
export const GET = handler(async (req: Request) => {
  const user = await requireUser();
  const year = Number(new URL(req.url).searchParams.get("year")) || new Date().getFullYear() - 1;
  const zip = await taxPackage(year);
  await audit({ type: "user", id: user.id, ip: await clientIp() }, "report", String(year), "tax_package_downloaded", { bytes: zip.length });
  return new Response(new Uint8Array(zip), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="tax-package-${year}.zip"`, "cache-control": "no-store" },
  });
});
