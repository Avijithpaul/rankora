export const CATEGORY_LABEL: Record<string, string> = {
  crawlability: "Crawlability",
  indexability: "Indexability",
  on_page: "On-page",
  content: "Content",
  links: "Links",
  performance: "Performance",
  mobile: "Mobile",
  structured_data: "Structured data",
  social: "Social",
  security: "Security",
};

export function statusTone(code: number | null, state: string) {
  if (state === "failed") return "critical" as const;
  if (state === "skipped" || state === "pending") return "neutral" as const;
  if (!code) return "neutral" as const;
  if (code >= 400) return "critical" as const;
  if (code >= 300) return "warning" as const;
  return "success" as const;
}
