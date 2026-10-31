import { env } from "@/lib/env";
import { ingest, alreadyIngested } from "@/pipeline/ingest";
import { googleToken, gfetch } from "./google";

type DriveFile = { id: string; name: string; mimeType: string };

/** Ingests new files dropped into the watched Drive folder (read-only scope; file ids keep it idempotent). */
export async function pollDrive(): Promise<number> {
  const folder = env().DRIVE_FOLDER_ID;
  if (!folder) return 0;
  const q = encodeURIComponent(`'${folder.replace(/'/g, "")}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`);
  let pageToken = "";
  let count = 0;
  do {
    const page = await gfetch<{ files: DriveFile[]; nextPageToken?: string }>(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType)&pageSize=100&orderBy=createdTime${pageToken ? `&pageToken=${pageToken}` : ""}`,
    );
    for (const f of page.files) {
      if (f.mimeType.startsWith("application/vnd.google-apps")) continue; // Google Docs etc.
      if (await alreadyIngested("drive", f.id)) continue;
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, {
        headers: { authorization: `Bearer ${await googleToken()}` },
      });
      if (!res.ok) continue;
      const r = await ingest({ files: [{ name: f.name, data: Buffer.from(await res.arrayBuffer()) }], source: "drive", sourceRef: f.id, actor: { type: "system", id: "drive" } });
      count += r.documents.length;
    }
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return count;
}
