/**
 * CSV import/export for keywords (RFC 4180). Pure, unit tested.
 * Import accepts keyword definitions only — metrics are never imported, they
 * must come from a connected provider.
 */
import { COUNTRIES, LANGUAGES } from "@/lib/locales";
import { isValidKeyword, normalizeKeyword } from "./utils";

export const MAX_IMPORT_ROWS = 500;

/** Parse CSV text into rows of cells. Handles quotes, escaped quotes, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === "") quoted = true;
    else if (c === "," || c === ";" || c === "\t") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export interface ImportRow {
  keyword: string;
  countryCode: string;
  languageCode: string;
  device: "desktop" | "mobile";
  targetUrl: string | null;
  group: string | null;
}

export interface ImportResult {
  rows: ImportRow[];
  errors: { line: number; message: string }[];
  truncated: boolean;
}

const HEADER_ALIASES: Record<string, keyof ImportRow> = {
  keyword: "keyword",
  keywords: "keyword",
  query: "keyword",
  country: "countryCode",
  country_code: "countryCode",
  language: "languageCode",
  language_code: "languageCode",
  device: "device",
  target_url: "targetUrl",
  "target url": "targetUrl",
  url: "targetUrl",
  group: "group",
  list: "group",
};

const countries = new Set<string>(COUNTRIES.map((c) => c.code));
const languages = new Set<string>(LANGUAGES.map((l) => l.code));

/**
 * Validate imported rows. A header row is optional; without one the first
 * column is the keyword. Defaults come from the website's market.
 */
export function readKeywordImport(text: string, defaults: { countryCode: string; languageCode: string }): ImportResult {
  const table = parseCsv(text);
  const errors: ImportResult["errors"] = [];
  if (table.length === 0) return { rows: [], errors: [{ line: 1, message: "The file is empty" }], truncated: false };

  const first = table[0].map((h) => h.trim().toLowerCase());
  const hasHeader = first.some((h) => HEADER_ALIASES[h] === "keyword");
  const cols: (keyof ImportRow | null)[] = hasHeader ? first.map((h) => HEADER_ALIASES[h] ?? null) : ["keyword"];
  const body = hasHeader ? table.slice(1) : table;
  const truncated = body.length > MAX_IMPORT_ROWS;
  const seen = new Set<string>();
  const rows: ImportRow[] = [];

  body.slice(0, MAX_IMPORT_ROWS).forEach((cells, idx) => {
    const line = idx + (hasHeader ? 2 : 1);
    const get = (k: keyof ImportRow) => {
      const i = cols.indexOf(k);
      return i >= 0 ? (cells[i] ?? "").trim() : "";
    };
    const keyword = normalizeKeyword(get("keyword"));
    if (!isValidKeyword(keyword)) return errors.push({ line, message: "Missing or invalid keyword" });
    const countryCode = (get("countryCode") || defaults.countryCode).toUpperCase();
    if (!countries.has(countryCode)) return errors.push({ line, message: `Unsupported country "${countryCode}"` });
    const languageCode = (get("languageCode") || defaults.languageCode).toLowerCase();
    if (!languages.has(languageCode)) return errors.push({ line, message: `Unsupported language "${languageCode}"` });
    const deviceRaw = (get("device") || "desktop").toLowerCase();
    if (deviceRaw !== "desktop" && deviceRaw !== "mobile") return errors.push({ line, message: `Device must be desktop or mobile` });
    const target = get("targetUrl");
    let targetUrl: string | null = null;
    if (target) {
      try {
        const u = new URL(target);
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
        targetUrl = u.toString();
      } catch {
        return errors.push({ line, message: "Target URL is not a valid http(s) URL" });
      }
    }
    const key = `${keyword}|${countryCode}|${languageCode}|${deviceRaw}`;
    if (seen.has(key)) return errors.push({ line, message: "Duplicate keyword in file" });
    seen.add(key);
    const group = get("group").slice(0, 80) || null;
    rows.push({ keyword, countryCode, languageCode, device: deviceRaw, targetUrl, group });
  });
  return { rows, errors, truncated };
}

/**
 * Escape one cell. Cells that start with = + - @ (or tab/CR) are prefixed with
 * an apostrophe to prevent formula injection when opened in spreadsheet apps.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return "﻿" + [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
