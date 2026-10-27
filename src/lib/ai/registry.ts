import "server-only";
import { aiConfig } from "@/lib/env";
import { AnthropicProvider } from "./anthropic";
import type { AiProvider } from "./types";

/** Returns the configured AI provider, or null — the UI then shows "AI provider not connected". */
export function aiProvider(): AiProvider | null {
  const cfg = aiConfig();
  return cfg ? new AnthropicProvider(cfg.apiKey, cfg.model) : null;
}
