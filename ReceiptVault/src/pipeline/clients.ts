import { z } from "zod";
import { normalizeVendor } from "./naming";

type ClientLite = { id: string; name: string; code: string | null };

/**
 * Matches a printed/handwritten client reference ("for Acme project", "PO ACME-114") to a client by
 * code (whole word) or by name. Returns null when nothing matches or the match is ambiguous.
 */
export function matchClient(ref: string, clients: ClientLite[]): ClientLite | null {
  const text = ` ${normalizeVendor(ref)} `;
  const hits = clients.filter((c) => {
    const code = normalizeVendor(c.code);
    if (code && text.includes(` ${code} `)) return true;
    const name = normalizeVendor(c.name);
    if (!name) return false;
    // Full name, or its first word when distinctive (4+ letters): "Acme" matches "Acme Retail".
    const first = name.split(" ")[0];
    return text.includes(` ${name} `) || (first.length >= 4 && text.includes(` ${first} `));
  });
  return hits.length === 1 ? hits[0] : null;
}

export const ClientInput = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().max(30).nullable().optional(),
  email: z.union([z.email(), z.literal(""), z.null()]).optional(),
});
