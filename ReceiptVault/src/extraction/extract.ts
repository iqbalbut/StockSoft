import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam, BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { env, isDemo } from "@/lib/env";
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_USER_TEXT } from "./prompt";
import { EXTRACTION_JSON_SCHEMA, ExtractionSchema, type Extraction } from "./schema";
import { preparePage, type Page } from "./preprocess";
import { sanitizeExtraction } from "./sanitize";
import { mockExtract } from "./mock";

export type ExtractionResult = {
  extraction: Extraction;
  model: string;
  attempts: number;
  usage?: { input: number; output: number; cacheRead: number };
};

/** Errors that retrying the same input will not fix (refusal, unreadable file). */
export class PermanentExtractionError extends Error {}

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ apiKey: env().ANTHROPIC_API_KEY, maxRetries: 4 }));

export const extractionMode = () => (env().ANTHROPIC_API_KEY ? "claude" : isDemo() ? "mock" : "disabled");

export async function extractDocument(pages: Page[], hint: { filename: string }): Promise<ExtractionResult> {
  const mode = extractionMode();
  if (mode === "mock") return { extraction: mockExtract(hint.filename), model: "demo-mock", attempts: 1 };
  if (mode === "disabled") throw new Error("ANTHROPIC_API_KEY is not set (and DEMO_MODE is off).");

  const content: BetaContentBlockParam[] = [];
  for (const page of pages.slice(0, 20)) {
    const p = await preparePage(page);
    content.push(
      p.kind === "pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.data.toString("base64") } }
        : p.kind === "text"
          ? { type: "document", source: { type: "text", media_type: "text/plain", data: p.text } }
          : { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data.toString("base64") } },
    );
  }
  content.push({ type: "text", text: EXTRACTION_USER_TEXT });

  const messages: BetaMessageParam[] = [{ role: "user", content }];
  const e = env();
  const maxAttempts = e.EXTRACTION_MAX_ATTEMPTS;
  let lastError = "";
  const usage = { input: 0, output: 0, cacheRead: 0 };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await getClient().beta.messages.create({
      model: e.EXTRACTION_MODEL,
      max_tokens: 16000,
      // Server-side fallback re-runs a safety-declined request on Anthropic's recommended model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: e.EXTRACTION_EFFORT, format: { type: "json_schema", schema: EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown> } },
      system: [{ type: "text", text: EXTRACTION_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages,
    });
    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;
    usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;

    if (response.stop_reason === "refusal") {
      throw new PermanentExtractionError("The model declined to process this document.");
    }
    const text = response.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");

    let problem: string;
    if (response.stop_reason === "max_tokens") {
      problem = "Output was cut off. Return the complete JSON object, with at most 30 line items.";
    } else {
      try {
        const parsed = ExtractionSchema.safeParse(JSON.parse(text));
        if (parsed.success) {
          return { extraction: sanitizeExtraction(parsed.data), model: response.model, attempts: attempt, usage };
        }
        problem = `The JSON failed validation: ${parsed.error.issues
          .slice(0, 8)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}. Return a corrected JSON object.`;
      } catch {
        problem = "That was not valid JSON. Return only the JSON object.";
      }
    }
    lastError = problem;
    // Append-only retry: keep the model's previous turn unchanged and add the correction after it.
    messages.push({ role: "assistant", content: response.content as BetaContentBlockParam[] });
    messages.push({ role: "user", content: problem });
  }
  throw new Error(`Extraction failed validation after ${maxAttempts} attempts: ${lastError}`);
}
