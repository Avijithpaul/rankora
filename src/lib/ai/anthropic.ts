import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { buildUserPrompt, sanitizeOutput, SYSTEM_PROMPT } from "./prompts";
import { AI_SCHEMAS, type AiContext, type AiOutput, type AiProvider, type AiResult, type AiTask } from "./types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

/** Claude adapter. Uses structured outputs so every response is schema-validated JSON. */
export class AnthropicProvider implements AiProvider {
  readonly id = "anthropic";
  private client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string = DEFAULT_ANTHROPIC_MODEL,
    options: { fetch?: typeof fetch } = {},
  ) {
    this.client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1, fetch: options.fetch });
  }

  async generate<T extends AiTask>(task: T, ctx: AiContext): Promise<AiResult<T>> {
    try {
      // create() + our own validation (not parse()): a refusal can arrive with empty text,
      // which must be reported as a refusal rather than a JSON error.
      const schema = AI_SCHEMAS[task];
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 16000,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: buildUserPrompt(task, ctx) }],
        output_config: { effort: "medium", format: zodOutputFormat(schema) },
      });
      if (response.stop_reason === "refusal") {
        return { ok: false, reason: "refused", message: "The AI provider declined this request." };
      }
      const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* handled below */
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success || response.stop_reason === "max_tokens") {
        return { ok: false, reason: "invalid_output", message: "The AI response was incomplete. Try again." };
      }
      return { ok: true, output: sanitizeOutput(task, parsed.data as AiOutput<T>, ctx), model: response.model };
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) return { ok: false, reason: "rate_limited", message: "The AI provider is rate limiting requests. Try again in a minute." };
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        return { ok: false, reason: "auth", message: "The AI provider rejected the API key." };
      }
      if (error instanceof Anthropic.APIError) return { ok: false, reason: "unavailable", message: `AI provider error${error.status ? ` (${error.status})` : ""}.` };
      console.error("[ai] anthropic request failed", error);
      return { ok: false, reason: "unavailable", message: "The AI provider could not be reached." };
    }
  }
}
