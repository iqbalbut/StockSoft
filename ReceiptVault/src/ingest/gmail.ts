import { env } from "@/lib/env";
import { ingest, type IncomingFile } from "@/pipeline/ingest";
import { gfetch, b64url } from "./google";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

type Part = { partId?: string; mimeType: string; filename?: string; body?: { attachmentId?: string; data?: string; size?: number }; parts?: Part[] };
type Message = { id: string; payload: Part; snippet?: string };

async function labelId(name: string, create: boolean): Promise<string | null> {
  const { labels } = await gfetch<{ labels: { id: string; name: string }[] }>(`${API}/labels`);
  const found = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  if (!create) return null;
  const created = await gfetch<{ id: string }>(`${API}/labels`, { method: "POST", body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }) });
  return created.id;
}

function walk(part: Part, out: Part[] = []): Part[] {
  out.push(part);
  for (const p of part.parts ?? []) walk(p, out);
  return out;
}

const ACCEPT = /^(image\/(jpeg|png|webp|gif)|application\/(pdf|zip|x-zip-compressed|octet-stream))$/;

/**
 * Pulls messages under the Gmail label (default "Receipts"): every attachment becomes a document; an email
 * with no attachment (typical HTML e-receipt) is ingested as its body text. Processed messages move to
 * "Receipts/Processed", and source refs make re-polls idempotent.
 */
export async function pollGmail(): Promise<number> {
  const e = env();
  const inbox = await labelId(e.GMAIL_LABEL, false);
  if (!inbox) throw new Error(`Gmail label "${e.GMAIL_LABEL}" not found. Create it and add a filter that applies it.`);
  const done = await labelId(e.GMAIL_DONE_LABEL, true);
  const list = await gfetch<{ messages?: { id: string }[] }>(`${API}/messages?labelIds=${inbox}&maxResults=50`);
  let count = 0;
  for (const { id } of list.messages ?? []) {
    const msg = await gfetch<Message>(`${API}/messages/${id}?format=full`);
    const parts = walk(msg.payload);
    const files: IncomingFile[] = [];
    for (const p of parts) {
      if (!p.filename || !p.body?.attachmentId || !ACCEPT.test(p.mimeType)) continue;
      const att = await gfetch<{ data: string }>(`${API}/messages/${id}/attachments/${p.body.attachmentId}`);
      files.push({ name: p.filename, data: b64url(att.data) });
    }
    if (!files.length) {
      const body = parts.find((p) => p.mimeType === "text/html" && p.body?.data) ?? parts.find((p) => p.mimeType === "text/plain" && p.body?.data);
      if (body?.body?.data) files.push({ name: `email-${id}.${body.mimeType === "text/html" ? "html" : "txt"}`, data: b64url(body.body.data) });
    }
    for (const [i, f] of files.entries()) {
      const r = await ingest({ files: [f], source: "gmail", sourceRef: `${id}:${i}`, actor: { type: "system", id: "gmail" } });
      count += r.documents.length;
    }
    await gfetch(`${API}/messages/${id}/modify`, { method: "POST", body: JSON.stringify({ addLabelIds: [done], removeLabelIds: [inbox] }) });
  }
  return count;
}
