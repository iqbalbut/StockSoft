"use client";
import { useState } from "react";
import { CATEGORIES, DOC_TYPES, PAYMENT_METHODS } from "@/extraction/schema";
import type { ClientDoc } from "@/pipeline/queries";
import { categoryLabel, money } from "./format";

type FieldDef = {
  key: keyof ClientDoc & string;
  label: string;
  conf?: string;
  type: "text" | "date" | "money" | "currency" | "select" | "bool";
  options?: { value: string; label: string }[];
};

const FIELDS: FieldDef[] = [
  { key: "vendorName", label: "Vendor", conf: "vendor_name", type: "text" },
  { key: "total", label: "Total", conf: "total", type: "money" },
  { key: "currency", label: "Currency", conf: "currency", type: "currency" },
  { key: "docDate", label: "Date", conf: "document_date", type: "date" },
  { key: "category", label: "Category", conf: "category", type: "select", options: Object.entries(CATEGORIES).map(([value, v]) => ({ value, label: v.label })) },
  { key: "docType", label: "Type", conf: "document_type", type: "select", options: DOC_TYPES.map((d) => ({ value: d, label: d.replace(/_/g, " ") })) },
  { key: "isBusiness", label: "Business expense", conf: "is_business", type: "bool" },
  { key: "isBillable", label: "Billable to client", conf: "is_billable", type: "bool" },
  { key: "clientRef", label: "Client / project", conf: "client_reference", type: "text" },
  { key: "tax", label: "Tax", conf: "tax", type: "money" },
  { key: "tip", label: "Tip", conf: "tip", type: "money" },
  { key: "subtotal", label: "Subtotal", conf: "subtotal", type: "money" },
  { key: "dueDate", label: "Due date", conf: "due_date", type: "date" },
  { key: "docNumber", label: "Invoice / receipt #", conf: "document_number", type: "text" },
  { key: "paymentMethod", label: "Paid by", conf: "payment_method", type: "select", options: PAYMENT_METHODS.map((p) => ({ value: p, label: p.replace(/_/g, " ") })) },
  { key: "cardLast4", label: "Card last 4", conf: "card_last4", type: "text" },
  { key: "vendorTaxId", label: "Vendor tax ID", conf: "vendor_tax_id", type: "text" },
  { key: "notes", label: "Notes", type: "text" },
];

const CURRENCY_OPTIONS = ["USD", "PKR", "AED", "GBP", "EUR", "SAR", "CAD", "AUD"];

function ConfDot({ c }: { c: number | undefined }) {
  if (c == null) return null;
  const color = c >= 0.9 ? "bg-emerald-500" : c >= 0.7 ? "bg-amber-500" : "bg-rose-500";
  return <span title={`${Math.round(c * 100)}% confidence`} className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} />;
}

function display(f: FieldDef, doc: ClientDoc) {
  const v = doc[f.key] as unknown;
  if (f.type === "bool") return v == null ? "—" : v ? "Yes" : "No";
  if (f.type === "money") return v == null ? "—" : money(v as string, doc.currency);
  if (f.key === "category") return categoryLabel(v as string);
  if (f.type === "select") return f.options?.find((o) => o.value === v)?.label ?? (v as string) ?? "—";
  return (v as string) || "—";
}

/** Tap-to-edit field list with per-field confidence dots. Saves each field on change. */
export function DocumentFields({
  doc,
  readOnly,
  onSaved,
  compact,
}: {
  doc: ClientDoc;
  readOnly?: boolean;
  onSaved: (doc: ClientDoc) => void;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [error, setError] = useState("");
  const conf = doc.fieldConfidence ?? {};
  const fields = compact ? FIELDS.filter((f) => !["notes", "vendorTaxId", "cardLast4", "subtotal", "tip"].includes(f.key) || (conf[f.conf ?? ""] ?? 1) < 0.9) : FIELDS;

  async function save(f: FieldDef, raw: string | boolean) {
    setError("");
    let value: unknown = raw;
    if (f.type === "bool") value = raw === true || raw === "true";
    else if (raw === "") value = null;
    else if (f.type === "money") value = String(raw).replace(/[, ]/g, "");
    const res = await fetch(`/api/documents/${doc.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ [f.key]: value }) });
    const data = await res.json();
    if (!res.ok) {
      setError(data.issues?.[0]?.message ? `${f.label}: ${data.issues[0].message}` : data.error);
      return;
    }
    setEditing(null);
    onSaved({ ...doc, ...data, files: doc.files });
  }

  return (
    <div>
      <ul className="divide-y line">
        {fields.map((f) => {
          const c = f.conf ? conf[f.conf] : undefined;
          const isEditing = editing === f.key;
          return (
            <li key={f.key} className="py-2">
              <button
                type="button"
                disabled={readOnly}
                onClick={() => {
                  if (f.type === "bool") return void save(f, !(doc[f.key] as boolean));
                  setEditing(f.key);
                  setDraft(doc[f.key] == null ? "" : String(doc[f.key]));
                }}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <span className="flex items-center gap-2 text-sm muted">
                  <ConfDot c={c} />
                  {f.label}
                </span>
                {!isEditing && <span className={`max-w-[60%] truncate text-right text-[15px] font-medium ${c != null && c < 0.9 ? "text-amber-600 dark:text-amber-400" : ""}`}>{display(f, doc)}</span>}
              </button>
              {isEditing && (
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save(f, draft);
                  }}
                >
                  {f.type === "select" || f.type === "currency" ? (
                    <select className="input" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}>
                      {f.type === "currency" && <option value="">—</option>}
                      {(f.options ?? CURRENCY_OPTIONS.map((c) => ({ value: c, label: c }))).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="input"
                      autoFocus
                      type={f.type === "date" ? "date" : "text"}
                      inputMode={f.type === "money" ? "decimal" : undefined}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                  )}
                  <button className="btn btn-primary">Save</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>✕</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-2 text-sm text-rose-500">{error}</p>}
    </div>
  );
}
