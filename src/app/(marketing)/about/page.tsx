import type { Metadata } from "next";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-semibold tracking-tight">About Rankora</h1>
      <div data-reveal-children="blur" className="mt-6 space-y-4 text-ink-2">
        <p>
          Rankora is an SEO platform for teams who want to understand their search performance, fix what matters and show
          progress over time — without black-box scores or made-up numbers.
        </p>
        <p>
          It combines a server-side site crawler and transparent scoring engine with first-party data from Google Search
          Console and Google Analytics 4, plus pluggable providers for keyword, SERP and backlink data.
        </p>
        <h2 className="pt-4 text-xl font-semibold text-ink">Principles</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>Every metric shows where it came from. Demo data is always labelled as demo data.</li>
          <li>Scores are computed from stored, documented rule checks — never estimated.</li>
          <li>Customer data is isolated per organization at the database level.</li>
          <li>Integrations request the minimum, read-only permissions they need.</li>
        </ul>
      </div>
    </article>
  );
}
