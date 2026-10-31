import type { Extraction, ConfidenceField } from "./schema";
import { CONFIDENCE_FIELDS } from "./schema";

/**
 * The 10 extraction test cases. Each case has:
 * - `render`: what `npm run fixtures` draws into fixtures/images/<id>.jpg (synthetic, so the eval is reproducible).
 *   Drop a real photo at fixtures/images/<id>.jpg to evaluate on real paper instead.
 * - `expected`: ground truth graded by `npm run eval:extraction` against the live model.
 * - `simulated`: a realistic model response, used by demo mode and by the unit tests of the
 *   routing / duplicate / FX pipeline (so those tests run offline and for free).
 * - `expectedRoute`: where the pipeline must send it.
 */
export type TestCase = {
  id: string;
  title: string;
  filename: string;
  render: { lines: string[]; rtl?: boolean; handwritten?: boolean; width?: number; effect?: "blur" | "fade" | "none" };
  expected: Partial<Pick<Extraction, "document_type" | "vendor_name" | "document_date" | "currency" | "total" | "tax" | "category" | "is_business" | "is_billable" | "due_date" | "card_last4">>;
  simulated: Extraction;
  expectedRoute: "auto_approve" | "review" | "duplicate";
  expectedReasons?: string[];
  /** For the duplicate case: id of the case it duplicates. */
  duplicateOf?: string;
};

const conf = (base: number, overrides: Partial<Record<ConfidenceField, number>> = {}) =>
  Object.fromEntries(CONFIDENCE_FIELDS.map((f) => [f, overrides[f] ?? base])) as Record<ConfidenceField, number>;

const base = {
  issued_by_us: false,
  vendor_tax_id: null,
  document_number: null,
  due_date: null,
  subtotal: null,
  tax: null,
  tip: null,
  payment_method: "card" as const,
  card_last4: null,
  line_items: [],
  client_reference: null,
  is_business: true,
  is_billable: false,
  notes: "",
  language: "en",
  image_quality: "good" as const,
};

export const TEST_CASES: TestCase[] = [
  {
    id: "01-saas-invoice-usd",
    title: "Clean SaaS invoice (USD, paid by card)",
    filename: "cloudnimbus-invoice-oct.pdf",
    render: {
      lines: [
        "CloudNimbus Inc.", "548 Market St, San Francisco CA", "", "INVOICE  #CN-2026-10-4471", "Date: Oct 01, 2026",
        "Bill to: AiNetworks LLC", "", "Pro plan (monthly)      49.00", "Subtotal                49.00", "Tax                      0.00",
        "TOTAL USD               49.00", "", "PAID - Visa •••• 4421",
      ],
    },
    expected: { document_type: "expense_receipt", vendor_name: "CloudNimbus Inc.", document_date: "2026-10-01", currency: "USD", total: 49, category: "software_saas", card_last4: "4421" },
    simulated: {
      ...base, document_type: "expense_receipt", vendor_name: "CloudNimbus Inc.", document_number: "CN-2026-10-4471",
      document_date: "2026-10-01", currency: "USD", subtotal: 49, tax: 0, total: 49, card_last4: "4421",
      line_items: [{ description: "Pro plan (monthly)", quantity: 1, unit_price: 49, amount: 49 }],
      category: "software_saas", confidence: conf(0.97, { client_reference: 0.95, is_billable: 0.92 }),
    },
    expectedRoute: "auto_approve",
  },
  {
    id: "02-restaurant-pkr",
    title: "Restaurant receipt, Lahore (PKR, GST, tip)",
    filename: "IMG_20260914_2141.jpg",
    render: {
      lines: [
        "LAHORE GRILL HOUSE", "MM Alam Road, Gulberg III, Lahore", "NTN: 4417823-6   STRN: 3277876154321", "", "Inv# 88213     14/09/2026 21:38",
        "Table 7   Guests: 3", "", "Chicken Karahi (Full)   3,200.00", "Garlic Naan x6             540.00", "Mint Margarita x3          750.00",
        "", "Sub Total               4,490.00", "GST 16%                   718.40", "Tip                       300.00", "GRAND TOTAL Rs.         5,508.40",
        "", "MasterCard ************7710", "Thank you! Visit again",
      ],
    },
    expected: { document_type: "expense_receipt", vendor_name: "Lahore Grill House", document_date: "2026-09-14", currency: "PKR", total: 5508.4, tax: 718.4, category: "meals", card_last4: "7710" },
    simulated: {
      ...base, document_type: "expense_receipt", vendor_name: "Lahore Grill House", vendor_tax_id: "NTN 4417823-6", document_number: "88213",
      document_date: "2026-09-14", currency: "PKR", subtotal: 4490, tax: 718.4, tip: 300, total: 5508.4, card_last4: "7710",
      line_items: [
        { description: "Chicken Karahi (Full)", quantity: 1, unit_price: 3200, amount: 3200 },
        { description: "Garlic Naan", quantity: 6, unit_price: 90, amount: 540 },
        { description: "Mint Margarita", quantity: 3, unit_price: 250, amount: 750 },
      ],
      category: "meals", confidence: conf(0.96, { is_business: 0.9, category: 0.93 }),
    },
    expectedRoute: "auto_approve",
  },
  {
    id: "03-blurry-cafe",
    title: "Blurry phone photo of a café receipt",
    filename: "blurry-coffee.jpg",
    render: {
      effect: "blur",
      lines: ["BEAN THERE CAFE", "F-7 Markaz, Islamabad", "", "12/09/2026", "", "Cappuccino x2      1,100", "Croissant            650", "", "TOTAL Rs          1,750", "CASH"],
    },
    expected: { document_type: "expense_receipt", currency: "PKR", total: 1750, category: "meals" },
    simulated: {
      ...base, document_type: "expense_receipt", vendor_name: "Bean There Cafe", document_date: "2026-09-12", currency: "PKR", total: 1750,
      payment_method: "cash", category: "meals", image_quality: "poor",
      notes: "Image is heavily blurred; total could be 1,750 or 1,150. Date digits are uncertain.",
      confidence: conf(0.6, { document_type: 0.9, currency: 0.85, total: 0.55, document_date: 0.5, vendor_name: 0.65 }),
    },
    expectedRoute: "review",
    expectedReasons: ["low_confidence"],
  },
  {
    id: "04-urdu-stationery",
    title: "Urdu-only stationery receipt with Urdu digits",
    filename: "urdu-receipt.jpg",
    render: {
      rtl: true,
      lines: ["مکتبہ علم و فن", "اردو بازار، لاہور", "", "تاریخ: ۰۳-۰۹-۲۰۲۶", "", "پرنٹر کاغذ (۵ رِیم)    ۶,۵۰۰", "فائل کور ۱۰ عدد       ۱,۲۰۰", "", "کل رقم: ۷,۷۰۰ روپے", "نقد"],
    },
    expected: { document_type: "expense_receipt", document_date: "2026-09-03", currency: "PKR", total: 7700, category: "office_expenses" },
    simulated: {
      ...base, document_type: "expense_receipt", vendor_name: "Maktaba Ilm-o-Fan", document_date: "2026-09-03", currency: "PKR", total: 7700,
      payment_method: "cash", language: "ur", category: "office_expenses",
      line_items: [
        { description: "Printer paper (5 reams)", quantity: 5, unit_price: 1300, amount: 6500 },
        { description: "File covers x10", quantity: 10, unit_price: 120, amount: 1200 },
      ],
      notes: "Vendor name printed in Urdu only (مکتبہ علم و فن); romanised. Date written day-month-year in Urdu digits.",
      confidence: conf(0.9, { vendor_name: 0.78, document_date: 0.88, category: 0.85 }),
    },
    expectedRoute: "review",
    expectedReasons: ["low_confidence"],
  },
  {
    id: "05-pkr-internet-bill",
    title: "PKR internet bill with due date (vendor bill → payables)",
    filename: "netlink-bill-sep-2026.pdf",
    render: {
      lines: [
        "NetLink Broadband (Pvt) Ltd", "NTN 7712093-1", "", "BILL FOR: AiNetworks LLC (Lahore office)", "Account: NL-0045521", "Bill date: 05-Oct-2026",
        "Due date: 20-Oct-2026", "", "Fiber 100 Mbps (Oct)      7,300.00", "FED 19.5%                 1,423.50", "", "PAYABLE BY DUE DATE  PKR  8,723.50",
        "After due date        PKR  9,223.50",
      ],
    },
    expected: { document_type: "vendor_bill", vendor_name: "NetLink Broadband (Pvt) Ltd", document_date: "2026-10-05", due_date: "2026-10-20", currency: "PKR", total: 8723.5, tax: 1423.5, category: "telecom_internet" },
    simulated: {
      ...base, document_type: "vendor_bill", vendor_name: "NetLink Broadband (Pvt) Ltd", vendor_tax_id: "NTN 7712093-1", document_number: "NL-0045521",
      document_date: "2026-10-05", due_date: "2026-10-20", currency: "PKR", subtotal: 7300, tax: 1423.5, total: 8723.5, payment_method: "unknown",
      line_items: [{ description: "Fiber 100 Mbps (Oct)", quantity: 1, unit_price: 7300, amount: 7300 }],
      category: "telecom_internet", confidence: conf(0.96),
    },
    expectedRoute: "auto_approve",
  },
  {
    id: "06-duplicate-of-02",
    title: "Duplicate: the Lahore Grill receipt again, emailed as a re-scan",
    filename: "Receipt-LahoreGrill-scan.jpg",
    duplicateOf: "02-restaurant-pkr",
    render: {
      effect: "fade",
      lines: [
        "LAHORE GRILL HOUSE", "MM Alam Road, Gulberg III, Lahore", "NTN: 4417823-6   STRN: 3277876154321", "", "Inv# 88213     14/09/2026 21:38",
        "", "Sub Total               4,490.00", "GST 16%                   718.40", "Tip                       300.00", "GRAND TOTAL Rs.         5,508.40",
      ],
    },
    expected: { vendor_name: "Lahore Grill House", document_date: "2026-09-14", currency: "PKR", total: 5508.4 },
    simulated: {
      ...base, document_type: "expense_receipt", vendor_name: "Lahore Grill House", vendor_tax_id: "NTN 4417823-6", document_number: "88213",
      document_date: "2026-09-14", currency: "PKR", subtotal: 4490, tax: 718.4, tip: 300, total: 5508.4, category: "meals", image_quality: "fair",
      confidence: conf(0.93),
    },
    expectedRoute: "duplicate",
    expectedReasons: ["duplicate_suspected"],
  },
  {
    id: "07-faded-thermal-aed",
    title: "Faded thermal taxi receipt, Dubai (AED)",
    filename: "dubai-taxi.jpg",
    render: {
      effect: "fade",
      lines: ["DUBAI TAXI CORPORATION", "TRN 100234567800003", "", "Trip: DXB T3 -> Business Bay", "Date 22/08/2026  08:14", "", "Fare           AED  71.43", "VAT 5%         AED   3.57", "TOTAL          AED  75.00", "", "Card ****9035"],
    },
    expected: { document_type: "expense_receipt", vendor_name: "Dubai Taxi Corporation", document_date: "2026-08-22", currency: "AED", total: 75, tax: 3.57, category: "travel" },
    simulated: {
      ...base, document_type: "expense_receipt", vendor_name: "Dubai Taxi Corporation", vendor_tax_id: "TRN 100234567800003",
      document_date: "2026-08-22", currency: "AED", subtotal: 71.43, tax: 3.57, total: 75, card_last4: "9035", category: "travel", image_quality: "fair",
      notes: "Thermal print is faded; card digits partly faint.",
      confidence: conf(0.92, { card_last4: 0.8, vendor_name: 0.95 }),
    },
    expectedRoute: "auto_approve",
  },
  {
    id: "08-handwritten-contractor",
    title: "Handwritten contractor receipt, billable to a client",
    filename: "handwritten-ali-design.jpg",
    render: {
      handwritten: true,
      lines: ["Received with thanks", "from AiNetworks LLC", "Rs 25,000/-", "for logo + UI design", "(Acme Retail project)", "", "Ali Raza", "10/9/26"],
    },
    expected: { document_type: "expense_receipt", currency: "PKR", total: 25000, category: "contractors", is_billable: true },
    simulated: {
      ...base, document_type: "expense_receipt", vendor_name: "Ali Raza", document_date: "2026-09-10", currency: "PKR", total: 25000,
      payment_method: "cash", category: "contractors", is_billable: true, client_reference: "Acme Retail project", image_quality: "fair",
      notes: "Handwritten. Date written 10/9/26, read as 10 September 2026 (Pakistani day/month order).",
      confidence: conf(0.85, { vendor_name: 0.8, document_date: 0.6, total: 0.9, is_billable: 0.85, client_reference: 0.82 }),
    },
    expectedRoute: "review",
    expectedReasons: ["low_confidence"],
  },
  {
    id: "09-sales-invoice-gbp",
    title: "Outgoing sales invoice issued by AiNetworks (GBP)",
    filename: "AIN-2026-031.pdf",
    render: {
      lines: [
        "AiNetworks LLC", "30 N Gould St, Sheridan WY 82801, USA", "", "INVOICE AIN-2026-031", "Issue date: 2 October 2026", "Due: 1 November 2026", "",
        "Bill to: Brightwater Analytics Ltd, London", "", "AI chatbot integration (Phase 1)   £3,200.00", "", "Total due              GBP 3,200.00",
      ],
    },
    expected: { document_type: "sales_invoice", vendor_name: "Brightwater Analytics Ltd", document_date: "2026-10-02", due_date: "2026-11-01", currency: "GBP", total: 3200, category: "revenue" },
    simulated: {
      ...base, document_type: "sales_invoice", issued_by_us: true, vendor_name: "Brightwater Analytics Ltd", document_number: "AIN-2026-031",
      document_date: "2026-10-02", due_date: "2026-11-01", currency: "GBP", total: 3200, payment_method: "bank_transfer", category: "revenue",
      line_items: [{ description: "AI chatbot integration (Phase 1)", quantity: 1, unit_price: 3200, amount: 3200 }],
      confidence: conf(0.97),
    },
    // Above the default $500 review threshold, so it is reviewed even at high confidence.
    expectedRoute: "review",
    expectedReasons: ["amount_over_threshold"],
  },
  {
    id: "10-uk-hotel-ambiguous-date",
    title: "UK hotel folio with an ambiguous 03/04 date, over the amount threshold",
    filename: "hotel-folio.pdf",
    render: {
      lines: ["THE KINGSWAY HOTEL", "Kingsway, London WC2B", "VAT Reg GB 284 1172 90", "", "Folio 55120   Date 03/04/2026", "", "3 nights @ £210.00     630.00", "City breakfast x3       54.00", "VAT incl. (20%)        114.00", "", "BALANCE PAID  GBP      684.00", "AMEX ***1009"],
    },
    expected: { document_type: "expense_receipt", vendor_name: "The Kingsway Hotel", document_date: "2026-04-03", currency: "GBP", total: 684, tax: 114, category: "travel" },
    simulated: {
      ...base, document_type: "expense_receipt", vendor_name: "The Kingsway Hotel", vendor_tax_id: "GB 284 1172 90", document_number: "55120",
      document_date: "2026-04-03", currency: "GBP", subtotal: 570, tax: 114, total: 684, card_last4: "1009", category: "travel",
      notes: "03/04/2026 read as 3 April 2026 (UK day/month order).",
      confidence: conf(0.95, { document_date: 0.75 }),
    },
    expectedRoute: "review",
    expectedReasons: ["low_confidence", "amount_over_threshold"],
  },
];
