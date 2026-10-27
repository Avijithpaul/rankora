/**
 * Report export architecture. Every exporter turns the same frozen snapshot
 * into a file, so exports always match the on-screen report.
 *
 *   json — machine-readable snapshot (available)
 *   csv  — key metrics, one row per metric (available)
 *   pdf  — planned: a renderer service loads the printable report page with a
 *          short-lived signed token and returns a PDF (e.g. headless Chromium).
 *          Until PDF_RENDERER_URL is configured, users print the report page
 *          with the browser's "Save as PDF".
 */
import { csvCell } from "@/lib/keywords/csv";
import { isUnavailable, REPORT_LABEL, type Metric, type ReportSnapshot } from "./compose";

export type ExportFormat = "json" | "csv" | "pdf";

export interface ExportFile {
  contentType: string;
  filename: string;
  body: string | Uint8Array;
}

export interface ReportExporter {
  format: ExportFormat;
  label: string;
  available(): boolean;
  render(report: { id: string; title: string; snapshot: ReportSnapshot }): Promise<ExportFile>;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "report";
const fileBase = (r: { title: string; snapshot: ReportSnapshot }) => `${slug(r.title)}${r.snapshot.website.isDemo ? "-DEMO-DATA" : ""}`;

/** Flattens a snapshot into metric rows (section, metric, current, previous, change, source). */
export function metricRows(s: ReportSnapshot): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  const m = (section: string, name: string, v: Metric, source: string) => rows.push([section, name, v.current, v.previous, v.change === null ? null : Math.round(v.change * 10000) / 10000, source]);
  if (s.audit && !isUnavailable(s.audit) && s.audit.audit) {
    const a = s.audit.audit;
    rows.push(["Site audit", "Score", a.score, s.audit.previous?.score ?? null, null, s.audit.source]);
    rows.push(["Site audit", "Critical issues", a.critical, null, null, s.audit.source]);
    rows.push(["Site audit", "Pages analyzed", a.pagesAnalyzed, null, null, s.audit.source]);
  }
  if (s.search && !isUnavailable(s.search)) for (const [k, v] of Object.entries(s.search.totals)) m("Search performance", k, v, s.search.source);
  if (s.traffic && !isUnavailable(s.traffic)) for (const [k, v] of Object.entries(s.traffic.totals)) m("Organic traffic", k, v, s.traffic.source);
  if (s.rankings && !isUnavailable(s.rankings)) {
    m("Keyword rankings", "averagePosition", s.rankings.averagePosition, s.rankings.source);
    for (const d of s.rankings.distribution) rows.push(["Keyword rankings", d.bucket, d.current, d.previous, null, s.rankings.source]);
  }
  if (s.tasks && !isUnavailable(s.tasks)) for (const [k, v] of Object.entries(s.tasks)) if (k !== "source") rows.push(["SEO tasks", k, v as number, null, null, "tasks"]);
  return rows;
}

export const jsonExporter: ReportExporter = {
  format: "json",
  label: "JSON",
  available: () => true,
  async render(r) {
    return { contentType: "application/json; charset=utf-8", filename: `${fileBase(r)}.json`, body: JSON.stringify({ id: r.id, title: r.title, ...r.snapshot }, null, 2) };
  },
};

export const csvExporter: ReportExporter = {
  format: "csv",
  label: "CSV (metrics)",
  available: () => true,
  async render(r) {
    const s = r.snapshot;
    const head = [
      ["Report", `${REPORT_LABEL[s.type]}${s.website.isDemo ? " (DEMO DATA)" : ""}`],
      ["Website", s.website.domain],
      ["Period", `${s.period.from} to ${s.period.to}`],
      ["Compared with", s.period.compareFrom ? `${s.period.compareFrom} to ${s.period.compareTo}` : "none"],
      ["Generated", s.generatedAt],
      [],
      ["section", "metric", "current", "previous", "change", "source"],
    ];
    const lines = [...head, ...metricRows(s)].map((row) => row.map((c) => csvCell(c === null || c === undefined ? "" : String(c))).join(","));
    return { contentType: "text/csv; charset=utf-8", filename: `${fileBase(r)}.csv`, body: `${lines.join("\r\n")}\r\n` };
  },
};

export const pdfExporter: ReportExporter = {
  format: "pdf",
  label: "PDF",
  available: () => Boolean(process.env.PDF_RENDERER_URL),
  async render() {
    // Intentionally not implemented without a renderer: see the module comment.
    throw new Error("PDF export needs PDF_RENDERER_URL (renderer service). Use Print → Save as PDF meanwhile.");
  },
};

export const EXPORTERS: Record<ExportFormat, ReportExporter> = { json: jsonExporter, csv: csvExporter, pdf: pdfExporter };
