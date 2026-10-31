import Link from "next/link";
import type { Doc } from "@/pipeline/queries";
import { money, categoryLabel, STATUS_STYLE, STATUS_LABEL } from "./format";

export function DocRow({ doc }: { doc: Doc }) {
  return (
    <Link href={`/documents/${doc.id}`} className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{doc.vendorName ?? doc.originalFilename}</div>
        <div className="truncate text-xs muted">
          {doc.docDate ?? "no date"} · {categoryLabel(doc.category)} · {doc.source}
        </div>
      </div>
      <div className="text-right">
        <div className="font-semibold tabular-nums">{money(doc.total, doc.currency)}</div>
        <span className={`chip ${STATUS_STYLE[doc.status]}`}>{STATUS_LABEL[doc.status]}</span>
      </div>
    </Link>
  );
}
