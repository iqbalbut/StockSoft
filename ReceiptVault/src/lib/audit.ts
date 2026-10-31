import { getDb, schema } from "@/db";

export type Actor = { type: "user" | "system" | "ai"; id?: string | null; ip?: string | null };

export async function audit(
  actor: Actor,
  entity: string,
  entityId: string,
  action: string,
  changes?: Record<string, unknown>,
) {
  const db = await getDb();
  await db.insert(schema.auditLog).values({
    actorType: actor.type,
    actorId: actor.id ?? null,
    ip: actor.ip ?? null,
    entity,
    entityId,
    action,
    changes: changes ?? null,
  });
}

/** Field-level diff for the audit trail. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    const a = before[k] ?? null;
    const b = after[k] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = { from: a, to: b };
  }
  return out;
}
