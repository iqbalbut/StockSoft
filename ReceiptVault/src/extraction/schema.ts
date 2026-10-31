import { z } from "zod";

export const DOC_TYPES = [
  "expense_receipt",
  "vendor_bill",
  "sales_invoice",
  "bank_statement",
  "contract",
  "other",
] as const;

/**
 * Expense categories aligned to IRS Schedule C lines (plus common SaaS-company splits).
 * `label` is what the UI shows; `scheduleC` is the line used in the year-end tax package.
 */
export const CATEGORIES = {
  advertising_marketing: { label: "Advertising & marketing", scheduleC: "Line 8 Advertising" },
  vehicle: { label: "Car & truck", scheduleC: "Line 9 Car and truck expenses" },
  contractors: { label: "Contractors / freelancers", scheduleC: "Line 11 Contract labor" },
  insurance: { label: "Insurance", scheduleC: "Line 15 Insurance" },
  professional_fees: { label: "Legal & professional fees", scheduleC: "Line 17 Legal and professional services" },
  office_expenses: { label: "Office expenses", scheduleC: "Line 18 Office expense" },
  rent_lease: { label: "Rent / lease / coworking", scheduleC: "Line 20 Rent or lease" },
  repairs_maintenance: { label: "Repairs & maintenance", scheduleC: "Line 21 Repairs and maintenance" },
  supplies: { label: "Supplies", scheduleC: "Line 22 Supplies" },
  taxes_licenses: { label: "Taxes & licenses", scheduleC: "Line 23 Taxes and licenses" },
  travel: { label: "Travel (air, hotel, transport)", scheduleC: "Line 24a Travel" },
  meals: { label: "Business meals (50%)", scheduleC: "Line 24b Deductible meals" },
  utilities: { label: "Utilities", scheduleC: "Line 25 Utilities" },
  software_saas: { label: "Software & SaaS", scheduleC: "Line 27a Other: Software & subscriptions" },
  telecom_internet: { label: "Phone & internet", scheduleC: "Line 27a Other: Telecom" },
  bank_fees: { label: "Bank & payment fees", scheduleC: "Line 27a Other: Bank fees" },
  education_training: { label: "Education & training", scheduleC: "Line 27a Other: Education" },
  equipment: { label: "Equipment & hardware", scheduleC: "Line 13 Depreciation / Sec. 179" },
  shipping_postage: { label: "Shipping & postage", scheduleC: "Line 27a Other: Shipping" },
  dues_subscriptions: { label: "Dues & memberships", scheduleC: "Line 27a Other: Dues" },
  revenue: { label: "Revenue (sales invoice)", scheduleC: "Line 1 Gross receipts" },
  other: { label: "Other / uncategorised", scheduleC: "Line 27a Other" },
} as const;
export type Category = keyof typeof CATEGORIES;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as [Category, ...Category[]];

export const CURRENCIES = ["USD", "PKR", "AED", "GBP", "EUR"] as const;

export const PAYMENT_METHODS = ["card", "cash", "bank_transfer", "wallet", "cheque", "unknown"] as const;

/** Fields that carry an individual confidence score. */
export const CONFIDENCE_FIELDS = [
  "document_type",
  "vendor_name",
  "vendor_tax_id",
  "document_number",
  "document_date",
  "due_date",
  "currency",
  "subtotal",
  "tax",
  "tip",
  "total",
  "payment_method",
  "card_last4",
  "line_items",
  "client_reference",
  "category",
  "is_business",
  "is_billable",
] as const;
export type ConfidenceField = (typeof CONFIDENCE_FIELDS)[number];

/** A field missing any one of these cannot be auto-approved. */
export const CRITICAL_FIELDS: ConfidenceField[] = ["document_type", "vendor_name", "document_date", "currency", "total", "category"];

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(s)), "invalid date");

const amount = z.number().finite().nullable();

/** Validation applied to the model's JSON (structured outputs guarantee the shape; this guarantees the semantics). */
export const ExtractionSchema = z.object({
  document_type: z.enum(DOC_TYPES),
  issued_by_us: z.boolean(),
  language: z.string(),
  image_quality: z.enum(["good", "fair", "poor"]),
  vendor_name: z.string().nullable(),
  vendor_tax_id: z.string().nullable(),
  document_number: z.string().nullable(),
  document_date: isoDate.nullable(),
  due_date: isoDate.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  subtotal: amount,
  tax: amount,
  tip: amount,
  total: amount,
  payment_method: z.enum(PAYMENT_METHODS),
  card_last4: z.string().regex(/^\d{4}$/).nullable(),
  line_items: z.array(
    z.object({
      description: z.string(),
      quantity: z.number().nullable(),
      unit_price: z.number().nullable(),
      amount: z.number().nullable(),
    }),
  ),
  client_reference: z.string().nullable(),
  category: z.enum(CATEGORY_KEYS),
  is_business: z.boolean(),
  is_billable: z.boolean(),
  confidence: z.object(
    Object.fromEntries(CONFIDENCE_FIELDS.map((f) => [f, z.number().min(0).max(1)])) as Record<
      ConfidenceField,
      z.ZodNumber
    >,
  ),
  notes: z.string(),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, "null"], ...extra });

/**
 * JSON Schema sent to the API as `output_config.format`. Kept to the subset structured outputs supports
 * (no numeric bounds, every property required, additionalProperties false); bounds are enforced by Zod above.
 */
export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "document_type", "issued_by_us", "language", "image_quality", "vendor_name", "vendor_tax_id",
    "document_number", "document_date", "due_date", "currency", "subtotal", "tax", "tip", "total",
    "payment_method", "card_last4", "line_items", "client_reference", "category", "is_business",
    "is_billable", "confidence", "notes",
  ],
  properties: {
    document_type: { type: "string", enum: [...DOC_TYPES] },
    issued_by_us: { type: "boolean", description: "True only if AiNetworks LLC is the issuer (an outgoing sales invoice)." },
    language: { type: "string", description: "Primary language code(s) of the document, e.g. 'en', 'ur', 'en+ur', 'ar'." },
    image_quality: { type: "string", enum: ["good", "fair", "poor"] },
    vendor_name: nullable("string", { description: "Merchant/issuer name as printed, in Latin script. For Urdu names give a romanised name." }),
    vendor_tax_id: nullable("string", { description: "NTN/STRN/TRN/VAT/EIN exactly as printed." }),
    document_number: nullable("string"),
    document_date: nullable("string", { description: "Transaction/issue date, YYYY-MM-DD." }),
    due_date: nullable("string", { description: "Payment due date, YYYY-MM-DD, bills/invoices only." }),
    currency: nullable("string", { description: "ISO 4217 code: USD, PKR, AED, GBP, EUR, or another ISO code." }),
    subtotal: nullable("number"),
    tax: nullable("number", { description: "Total tax (GST/VAT/sales tax/FED). Sum if several lines." }),
    tip: nullable("number"),
    total: nullable("number", { description: "Final amount paid or payable, including tax and tip." }),
    payment_method: { type: "string", enum: [...PAYMENT_METHODS] },
    card_last4: nullable("string", { description: "Last 4 digits of the card ONLY. Never output more digits." }),
    line_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "quantity", "unit_price", "amount"],
        properties: {
          description: { type: "string" },
          quantity: nullable("number"),
          unit_price: nullable("number"),
          amount: nullable("number"),
        },
      },
    },
    client_reference: nullable("string", { description: "Client, project, PO or job reference if printed or handwritten on the document." }),
    category: { type: "string", enum: [...CATEGORY_KEYS] },
    is_business: { type: "boolean" },
    is_billable: { type: "boolean", description: "True only if the document indicates the cost is re-billable to a named client." },
    confidence: {
      type: "object",
      additionalProperties: false,
      required: [...CONFIDENCE_FIELDS],
      properties: Object.fromEntries(CONFIDENCE_FIELDS.map((f) => [f, { type: "number" }])),
    },
    notes: { type: "string", description: "Short notes on anything uncertain, illegible, or inconsistent. Empty string if none." },
  },
} as const;
