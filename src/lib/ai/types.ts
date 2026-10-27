/**
 * Optional AI suggestion architecture. Providers turn a content analysis into
 * *suggestions* that a person reviews and copies by hand — Rankora never
 * publishes or writes AI output to a website, and every stored result is
 * labelled as AI-generated.
 */
import { z } from "zod/v4";

export const AI_TASKS = ["titles", "meta_descriptions", "outline", "faqs", "improvements", "internal_links"] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const AI_TASK_LABEL: Record<AiTask, string> = {
  titles: "SEO titles",
  meta_descriptions: "Meta descriptions",
  outline: "Content outline",
  faqs: "FAQs",
  improvements: "Content improvements",
  internal_links: "Internal-link suggestions",
};

// Output schemas. Kept free of numeric/length constraints (enforced after parsing instead).
const textWithReason = z.object({ text: z.string(), rationale: z.string() });
export const AI_SCHEMAS = {
  titles: z.object({ suggestions: z.array(textWithReason) }),
  meta_descriptions: z.object({ suggestions: z.array(textWithReason) }),
  outline: z.object({
    sections: z.array(z.object({ heading: z.string(), level: z.number(), points: z.array(z.string()) })),
  }),
  faqs: z.object({ faqs: z.array(z.object({ question: z.string(), answer: z.string() })) }),
  improvements: z.object({ suggestions: z.array(z.object({ area: z.string(), suggestion: z.string(), rationale: z.string() })) }),
  internal_links: z.object({
    links: z.array(z.object({ target_url: z.string(), anchor_text: z.string(), placement: z.string(), rationale: z.string() })),
  }),
} satisfies Record<AiTask, z.ZodType>;

export type AiOutput<T extends AiTask> = z.infer<(typeof AI_SCHEMAS)[T]>;

export interface InternalLinkCandidate {
  url: string;
  title: string | null;
}

/** Everything a provider may see. Page text is untrusted data and is fenced in the prompt. */
export interface AiContext {
  website: { name: string; domain: string; language: string };
  keyword: string;
  sourceUrl: string | null;
  title: string | null;
  metaDescription: string | null;
  headings: { level: number; text: string }[];
  /** visible text, already truncated by the caller */
  text: string;
  wordCount: number;
  failingChecks: { label: string; detail: string }[];
  missingTerms: string[];
  linkCandidates: InternalLinkCandidate[];
  existingLinks: string[];
}

export interface AiSuggestionRecord<T extends AiTask = AiTask> {
  task: T;
  label: "AI suggestion";
  provider: string;
  model: string;
  generatedAt: string;
  output: AiOutput<T>;
}

export type AiResult<T extends AiTask> =
  | { ok: true; output: AiOutput<T>; model: string }
  | { ok: false; reason: "refused" | "invalid_output" | "rate_limited" | "auth" | "unavailable"; message: string };

export interface AiProvider {
  readonly id: string;
  readonly model: string;
  generate<T extends AiTask>(task: T, ctx: AiContext): Promise<AiResult<T>>;
}
