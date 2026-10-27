/**
 * Content Optimizer analysis. Deterministic, rule-based and pure: the same
 * document, keyword and term list always produce the same result. Every check
 * records what it measured, the threshold it used and why it matters, so the
 * score is fully explainable. Nothing here calls an AI model.
 */
import { THRESHOLDS } from "@/lib/audit/analyze";
import type { ContentDocument } from "./document";

export const CONTENT_SCORING_VERSION = "2026.10-c1";

export type CheckStatus = "pass" | "warn" | "fail" | "info";
export type CheckCategory = "metadata" | "headings" | "placement" | "structure" | "length" | "links" | "semantic" | "readability";

export interface ContentCheck {
  id: string;
  category: CheckCategory;
  label: string;
  status: CheckStatus;
  /** relative importance in the score; info checks are not scored */
  weight: number;
  /** what was measured, in plain words */
  detail: string;
  /** what to do about it (empty when passing) */
  recommendation: string;
}

export type TermSourceKind = "saved_keyword" | "search_console" | "user";

export interface SemanticTerm {
  term: string;
  source: TermSourceKind;
  /** e.g. GSC impressions, used only for ordering and display */
  weight?: number | null;
}

export interface TermCoverage extends SemanticTerm {
  found: boolean;
  occurrences: number;
}

export interface ReadabilityStats {
  sentences: number;
  avgSentenceWords: number;
  longSentenceShare: number;
  avgSyllablesPerWord: number;
  /** Flesch Reading Ease; only computed for English content */
  fleschReadingEase: number | null;
  avgParagraphWords: number;
  longParagraphs: number;
}

export interface ContentAnalysis {
  version: string;
  keyword: string;
  score: number;
  checks: ContentCheck[];
  stats: {
    words: number;
    keywordOccurrences: number;
    keywordDensity: number;
    firstOccurrenceWord: number | null;
    headings: { h1: number; h2: number; h3plus: number; skips: number };
    paragraphs: number;
    lists: number;
    images: number;
    imagesMissingAlt: number;
    internalLinks: number;
    externalLinks: number;
  };
  readability: ReadabilityStats;
  terms: TermCoverage[];
  topTerms: { term: string; count: number }[];
  recommendations: { checkId: string; priority: "high" | "medium" | "low"; text: string }[];
}

export const CONTENT_THRESHOLDS = {
  titleMin: THRESHOLDS.titleMin,
  titleMax: THRESHOLDS.titleMax,
  descriptionMin: THRESHOLDS.descriptionMin,
  descriptionMax: THRESHOLDS.descriptionMax,
  minWords: 300,
  goodWords: 600,
  introWords: 100,
  densityMin: 0.005,
  densityMax: 0.025,
  densityStuffing: 0.035,
  longSentenceWords: 25,
  maxAvgSentenceWords: 20,
  longParagraphWords: 150,
  minInternalLinks: 2,
  termCoverageGood: 0.6,
  termCoverageMin: 0.3,
} as const;

const T = CONTENT_THRESHOLDS;

const STOPWORDS = new Set(
  "a an and are as at be but by for from has have how i in is it its of on or that the this to was what when where which who why will with you your vs".split(" "),
);

/** Lowercased word tokens (letters/digits, inner apostrophes and hyphens kept). */
export function tokenize(s: string): string[] {
  return (s.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).map((w) => w.replace(/’/g, "'"));
}

/** Very light plural folding so "shoe" matches "shoes"; deliberately conservative. */
export function fold(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) return word.slice(0, -1);
  return word;
}

const folded = (s: string) => tokenize(s).map(fold);

/** Folded keyword words without stopwords, e.g. "best boots for hiking" → [best, boot, hiking]. */
export const significantTokens = (s: string) => folded(s).filter((t) => !STOPWORDS.has(t));

/** Number of times the token sequence `needle` occurs in `hay`. */
export function countPhrase(hay: string[], needle: string[]): number {
  if (!needle.length || needle.length > hay.length) return 0;
  let n = 0;
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    n++;
  }
  return n;
}

function firstPhraseIndex(hay: string[], needle: string[]): number | null {
  for (let i = 0; i <= hay.length - needle.length; i++) {
    if (needle.every((t, j) => hay[i + j] === t)) return i;
  }
  return null;
}

type Match = "exact" | "partial" | "none";

/** exact = the whole phrase appears; partial = every significant keyword word appears somewhere. */
export function keywordMatch(text: string | null | undefined, keyword: string): Match {
  if (!text) return "none";
  const hay = folded(text);
  const kw = folded(keyword);
  if (countPhrase(hay, kw) > 0) return "exact";
  const significant = kw.filter((t) => !STOPWORDS.has(t));
  if (significant.length && significant.every((t) => hay.includes(t))) return "partial";
  return "none";
}

export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = stripped.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

function splitSentences(paragraphs: string[]): string[] {
  const out: string[] = [];
  for (const p of paragraphs) {
    for (const s of p.split(/(?<=[.!?…])\s+(?=[\p{Lu}\p{N}"“'(])/u)) {
      if (tokenize(s).length) out.push(s);
    }
  }
  return out;
}

export function readability(doc: ContentDocument, isEnglish: boolean): ReadabilityStats {
  const blocks = doc.paragraphs.length ? doc.paragraphs : doc.text ? [doc.text] : [];
  const sentences = splitSentences(blocks);
  const sentenceLengths = sentences.map((s) => tokenize(s).length);
  const words = blocks.flatMap((b) => tokenize(b));
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  const avgSentenceWords = sentences.length ? words.length / sentences.length : 0;
  const avgSyllablesPerWord = words.length ? syllables / words.length : 0;
  const paragraphWords = doc.paragraphs.map((p) => tokenize(p).length);
  const flesch = isEnglish && words.length >= 30 ? 206.835 - 1.015 * avgSentenceWords - 84.6 * avgSyllablesPerWord : null;
  return {
    sentences: sentences.length,
    avgSentenceWords: round(avgSentenceWords, 1),
    longSentenceShare: sentences.length ? round(sentenceLengths.filter((l) => l > T.longSentenceWords).length / sentences.length, 3) : 0,
    avgSyllablesPerWord: round(avgSyllablesPerWord, 2),
    fleschReadingEase: flesch === null ? null : round(Math.max(0, Math.min(100, flesch)), 1),
    avgParagraphWords: paragraphWords.length ? round(paragraphWords.reduce((a, b) => a + b, 0) / paragraphWords.length, 1) : 0,
    longParagraphs: paragraphWords.filter((n) => n > T.longParagraphWords).length,
  };
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const pct = (n: number) => `${round(n * 100, 1)}%`;

/** Most frequent meaningful words and two-word phrases — descriptive only. */
export function topTerms(text: string, limit = 15): { term: string; count: number }[] {
  const toks = tokenize(text);
  const counts = new Map<string, number>();
  for (let i = 0; i < toks.length; i++) {
    const a = toks[i];
    if (a.length > 2 && !STOPWORDS.has(a) && !/^\d+$/.test(a)) counts.set(a, (counts.get(a) ?? 0) + 1);
    const b = toks[i + 1];
    if (b && !STOPWORDS.has(a) && !STOPWORDS.has(b) && a.length > 2 && b.length > 2) {
      const k = `${a} ${b}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts]
    .filter(([term, c]) => c >= (term.includes(" ") ? 2 : 3))
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

export function termCoverage(text: string, terms: SemanticTerm[]): TermCoverage[] {
  const hay = folded(text);
  const seen = new Set<string>();
  const out: TermCoverage[] = [];
  for (const t of terms) {
    const needle = folded(t.term);
    const key = needle.join(" ");
    if (!needle.length || seen.has(key)) continue;
    seen.add(key);
    const occurrences = countPhrase(hay, needle);
    out.push({ ...t, found: occurrences > 0, occurrences });
  }
  return out;
}

export interface AnalyzeOptions {
  keyword: string;
  /** website language; readability formulas are only applied to English */
  language?: string | null;
  terms?: SemanticTerm[];
}

export function analyzeContent(doc: ContentDocument, opts: AnalyzeOptions): ContentAnalysis {
  const keyword = opts.keyword.trim().replace(/\s+/g, " ");
  const kw = folded(keyword);
  const bodyTokens = folded(doc.text);
  const words = bodyTokens.length;
  const occurrences = countPhrase(bodyTokens, kw);
  const density = words ? (occurrences * kw.length) / words : 0;
  const first = firstPhraseIndex(bodyTokens, kw);
  const lang = (opts.language ?? doc.lang ?? "en").toLowerCase();
  const isEnglish = lang.startsWith("en");

  const h1s = doc.headings.filter((h) => h.level === 1);
  const subheadings = doc.headings.filter((h) => h.level === 2 || h.level === 3);
  let skips = 0;
  for (let i = 1; i < doc.headings.length; i++) if (doc.headings[i].level - doc.headings[i - 1].level > 1) skips++;
  const internal = doc.links.filter((l) => l.internal);
  const external = doc.links.filter((l) => !l.internal);
  const missingAlt = doc.images.filter((i) => i.alt === null).length;
  const read = readability(doc, isEnglish);
  // the target keyword itself is measured by the placement checks, not as a related term
  const terms = termCoverage(doc.text, (opts.terms ?? []).filter((t) => folded(t.term).join(" ") !== kw.join(" ")));

  const checks: ContentCheck[] = [];
  const add = (c: ContentCheck) => checks.push(c);

  // --- metadata -------------------------------------------------------------
  const titleLen = doc.title?.length ?? 0;
  add({
    id: "title_length",
    category: "metadata",
    label: "Title tag length",
    weight: 6,
    status: !doc.title ? "fail" : titleLen < T.titleMin || titleLen > T.titleMax ? "warn" : "pass",
    detail: doc.title ? `${titleLen} characters (recommended ${T.titleMin}–${T.titleMax}).` : "No title found.",
    recommendation: !doc.title
      ? "Add a unique, descriptive title tag that contains the target keyword."
      : titleLen > T.titleMax
        ? "Shorten the title so it is not truncated in search results; keep the keyword near the start."
        : titleLen < T.titleMin
          ? "Expand the title with a benefit or qualifier so it describes the page fully."
          : "",
  });
  const titleMatch = keywordMatch(doc.title, keyword);
  const titleFront = doc.title ? firstPhraseIndex(folded(doc.title), kw) : null;
  add({
    id: "title_keyword",
    category: "metadata",
    label: "Keyword in title",
    weight: 10,
    status: titleMatch === "exact" ? "pass" : titleMatch === "partial" ? "warn" : "fail",
    detail:
      titleMatch === "exact"
        ? `The title contains “${keyword}”${titleFront !== null && titleFront <= 2 ? " near the start" : ""}.`
        : titleMatch === "partial"
          ? "The title contains the keyword's words, but not as the exact phrase."
          : "The title does not contain the target keyword.",
    recommendation: titleMatch === "exact" ? "" : `Use the exact phrase “${keyword}” in the title, ideally near the beginning.`,
  });
  const descLen = doc.metaDescription?.length ?? 0;
  add({
    id: "meta_length",
    category: "metadata",
    label: "Meta description length",
    weight: 4,
    status: !doc.metaDescription ? "fail" : descLen < T.descriptionMin || descLen > T.descriptionMax ? "warn" : "pass",
    detail: doc.metaDescription ? `${descLen} characters (recommended ${T.descriptionMin}–${T.descriptionMax}).` : "No meta description found.",
    recommendation: !doc.metaDescription
      ? "Write a meta description that summarises the page and invites the click; search engines may show it as the snippet."
      : descLen > T.descriptionMax
        ? "Shorten the meta description so the important part is not cut off."
        : descLen < T.descriptionMin
          ? "Expand the meta description with the page's main benefit and a call to action."
          : "",
  });
  const descMatch = keywordMatch(doc.metaDescription, keyword);
  add({
    id: "meta_keyword",
    category: "metadata",
    label: "Keyword in meta description",
    weight: 4,
    status: descMatch === "exact" ? "pass" : descMatch === "partial" ? "warn" : "fail",
    detail: descMatch === "exact" ? "The meta description contains the keyword." : descMatch === "partial" ? "Only some keyword words appear in the meta description." : "The meta description does not mention the keyword.",
    recommendation: descMatch === "exact" ? "" : "Mention the keyword naturally in the meta description — search engines bold matching terms in snippets.",
  });

  // --- headings -------------------------------------------------------------
  add({
    id: "h1_single",
    category: "headings",
    label: "One H1 heading",
    weight: 5,
    status: h1s.length === 1 && h1s[0].text ? "pass" : h1s.length === 0 ? "fail" : "warn",
    detail: h1s.length === 0 ? "No H1 heading found." : `${h1s.length} H1 heading${h1s.length > 1 ? "s" : ""} found.`,
    recommendation: h1s.length === 1 && h1s[0].text ? "" : h1s.length === 0 ? "Add a single H1 that states the page topic (in a draft, start a line with “# ”)." : "Keep one H1 for the main topic and turn the others into H2s.",
  });
  const h1Match = h1s.reduce<Match>((best, h) => {
    const m = keywordMatch(h.text, keyword);
    return m === "exact" || best === "exact" ? "exact" : m === "partial" || best === "partial" ? "partial" : "none";
  }, "none");
  add({
    id: "h1_keyword",
    category: "headings",
    label: "Keyword in H1",
    weight: 7,
    status: h1Match === "exact" ? "pass" : h1Match === "partial" ? "warn" : "fail",
    detail: h1Match === "exact" ? "The H1 contains the keyword." : h1Match === "partial" ? "The H1 contains the keyword's words but not the exact phrase." : "The H1 does not contain the keyword.",
    recommendation: h1Match === "exact" ? "" : "Include the keyword (or a close variant) in the H1.",
  });
  const subWithKw = subheadings.filter((h) => keywordMatch(h.text, keyword) !== "none").length;
  add({
    id: "subheadings",
    category: "headings",
    label: "Subheadings structure the content",
    weight: 5,
    status: words < T.minWords ? (subheadings.length ? "pass" : "info") : subheadings.length >= 2 ? "pass" : subheadings.length === 1 ? "warn" : "fail",
    detail: `${subheadings.length} H2/H3 subheading${subheadings.length === 1 ? "" : "s"} for ${words} words.`,
    recommendation: words >= T.minWords && subheadings.length < 2 ? "Break the content into sections with descriptive H2 subheadings — they help readers scan and help search engines understand subtopics." : "",
  });
  add({
    id: "subheading_keyword",
    category: "headings",
    label: "Keyword or variant in a subheading",
    weight: 3,
    status: subheadings.length === 0 ? "info" : subWithKw > 0 ? "pass" : "warn",
    detail: subheadings.length === 0 ? "No subheadings to check." : `${subWithKw} of ${subheadings.length} subheadings reference the keyword.`,
    recommendation: subheadings.length && !subWithKw ? "Use the keyword or a close variant in at least one H2 where it reads naturally." : "",
  });
  add({
    id: "heading_order",
    category: "headings",
    label: "Heading levels in order",
    weight: 2,
    status: doc.headings.length < 2 ? "info" : skips === 0 ? "pass" : "warn",
    detail: skips ? `${skips} jump${skips > 1 ? "s" : ""} of more than one level (e.g. H2 → H4).` : "No skipped heading levels.",
    recommendation: skips ? "Do not skip heading levels; nest H3 under H2, H4 under H3." : "",
  });

  // --- keyword placement ------------------------------------------------------
  add({
    id: "keyword_intro",
    category: "placement",
    label: `Keyword in the first ${T.introWords} words`,
    weight: 6,
    status: first !== null && first < T.introWords ? "pass" : first !== null ? "warn" : "fail",
    detail: first === null ? "The exact keyword never appears in the body." : `First used at word ${first + 1}.`,
    recommendation: first !== null && first < T.introWords ? "" : "Mention the keyword in the opening paragraph so readers and search engines immediately see the topic.",
  });
  add({
    id: "keyword_density",
    category: "placement",
    label: "Keyword frequency",
    weight: 5,
    status: occurrences === 0 ? "fail" : density > T.densityStuffing ? "fail" : density > T.densityMax || density < T.densityMin ? "warn" : "pass",
    detail: `${occurrences} exact use${occurrences === 1 ? "" : "s"} in ${words} words (${pct(density)}; guideline ${pct(T.densityMin)}–${pct(T.densityMax)}).`,
    recommendation:
      occurrences === 0
        ? "Use the exact keyword in the body text."
        : density > T.densityStuffing
          ? "The keyword is repeated so often it may read as keyword stuffing; replace some uses with synonyms or pronouns."
          : density > T.densityMax
            ? "Slightly reduce repetitions of the keyword and use related terms instead."
            : density < T.densityMin
              ? "Use the keyword a little more often where it reads naturally."
              : "",
  });
  if (doc.url) {
    let slug = "";
    try {
      slug = decodeURIComponent(new URL(doc.url).pathname);
    } catch {
      slug = doc.url;
    }
    const slugMatch = keywordMatch(slug.replace(/[-_/]+/g, " "), keyword);
    add({
      id: "keyword_url",
      category: "placement",
      label: "Keyword in URL",
      weight: 3,
      status: slugMatch === "none" ? "warn" : "pass",
      detail: slugMatch === "none" ? `The URL path “${slug}” does not contain the keyword.` : "The URL path contains the keyword's words.",
      recommendation: slugMatch === "none" ? "For new pages, use a short, readable slug that contains the keyword. Changing an existing URL needs a 301 redirect." : "",
    });
  }

  // --- length & structure ------------------------------------------------------
  add({
    id: "word_count",
    category: "length",
    label: "Content length",
    weight: 8,
    status: words < T.minWords ? "fail" : words < T.goodWords ? "warn" : "pass",
    detail: `${words} words. Below ${T.minWords} is usually too thin to cover a topic; ${T.goodWords}+ gives room for depth.`,
    recommendation: words < T.goodWords ? "Expand the content with sections that answer the questions a searcher for this keyword has. Length alone does not rank — coverage does." : "",
  });
  add({
    id: "paragraph_length",
    category: "structure",
    label: "Paragraph length",
    weight: 3,
    status: doc.paragraphs.length === 0 ? "info" : read.longParagraphs === 0 ? "pass" : "warn",
    detail: `${doc.paragraphs.length} paragraphs, ${read.longParagraphs} longer than ${T.longParagraphWords} words (average ${read.avgParagraphWords}).`,
    recommendation: read.longParagraphs ? "Split very long paragraphs; short paragraphs are easier to read on mobile." : "",
  });
  add({
    id: "lists",
    category: "structure",
    label: "Lists for scannable content",
    weight: 2,
    status: words < T.goodWords ? "info" : doc.lists > 0 ? "pass" : "warn",
    detail: `${doc.lists} list${doc.lists === 1 ? "" : "s"}.`,
    recommendation: words >= T.goodWords && doc.lists === 0 ? "Where content is a sequence or a set of options, present it as a bulleted or numbered list." : "",
  });
  add({
    id: "image_alt",
    category: "structure",
    label: "Images have alt text",
    weight: 3,
    status: doc.images.length === 0 ? "info" : missingAlt === 0 ? "pass" : "warn",
    detail: doc.images.length === 0 ? "No images." : `${doc.images.length} images, ${missingAlt} without an alt attribute.`,
    recommendation: missingAlt ? "Describe each meaningful image in its alt attribute (use alt=\"\" only for decorative images)." : "",
  });

  // --- links ----------------------------------------------------------------
  add({
    id: "internal_links",
    category: "links",
    label: "Internal links",
    weight: 5,
    status: internal.length >= T.minInternalLinks ? "pass" : internal.length > 0 ? "warn" : "fail",
    detail: `${internal.length} internal and ${external.length} external links in the content.`,
    recommendation: internal.length >= T.minInternalLinks ? "" : `Link to at least ${T.minInternalLinks} related pages on your site with descriptive anchor text.`,
  });
  const genericAnchors = doc.links.filter((l) => /^(click here|here|read more|more|link|this)$/i.test(l.anchor)).length;
  add({
    id: "anchor_text",
    category: "links",
    label: "Descriptive anchor text",
    weight: 2,
    status: doc.links.length === 0 ? "info" : genericAnchors === 0 ? "pass" : "warn",
    detail: `${genericAnchors} link${genericAnchors === 1 ? "" : "s"} with generic anchors such as “click here”.`,
    recommendation: genericAnchors ? "Replace generic anchors with words that describe the linked page." : "",
  });

  // --- semantic coverage --------------------------------------------------------
  const scoredTerms = terms.slice(0, 40);
  const found = scoredTerms.filter((t) => t.found).length;
  const coverage = scoredTerms.length ? found / scoredTerms.length : 0;
  add({
    id: "semantic_coverage",
    category: "semantic",
    label: "Related term coverage",
    weight: scoredTerms.length ? 8 : 0,
    status: !scoredTerms.length ? "info" : coverage >= T.termCoverageGood ? "pass" : coverage >= T.termCoverageMin ? "warn" : "fail",
    detail: scoredTerms.length
      ? `${found} of ${scoredTerms.length} related terms appear (${pct(coverage)}). Terms come from your saved keywords, Search Console queries and terms you entered.`
      : "No related terms available. Connect Search Console, save related keywords, or enter terms to measure topical coverage.",
    recommendation: scoredTerms.length && coverage < T.termCoverageGood ? "Cover the missing related terms where they genuinely fit — they reflect what searchers look for around this topic." : "",
  });

  // --- readability --------------------------------------------------------------
  add({
    id: "sentence_length",
    category: "readability",
    label: "Sentence length",
    weight: 4,
    status: read.sentences < 3 ? "info" : read.avgSentenceWords <= T.maxAvgSentenceWords && read.longSentenceShare <= 0.25 ? "pass" : "warn",
    detail: `Average ${read.avgSentenceWords} words per sentence; ${pct(read.longSentenceShare)} of sentences are longer than ${T.longSentenceWords} words.`,
    recommendation: read.avgSentenceWords > T.maxAvgSentenceWords || read.longSentenceShare > 0.25 ? "Shorten long sentences; aim for an average under 20 words." : "",
  });
  const fre = read.fleschReadingEase;
  add({
    id: "reading_ease",
    category: "readability",
    label: "Reading ease (Flesch)",
    weight: fre === null ? 0 : 3,
    status: fre === null ? "info" : fre >= 50 ? "pass" : fre >= 30 ? "warn" : "fail",
    detail:
      fre === null
        ? isEnglish
          ? "Not enough text to estimate reading ease."
          : "The Flesch formula only applies to English; it is not computed for this language."
        : `Score ${fre} of 100 (higher is easier; 60–70 is plain English). Estimated with a syllable heuristic.`,
    recommendation: fre !== null && fre < 50 ? "Use shorter words and sentences, and explain jargon." : "",
  });

  const scored = checks.filter((c) => c.status !== "info" && c.weight > 0);
  const total = scored.reduce((n, c) => n + c.weight, 0);
  const earned = scored.reduce((n, c) => n + c.weight * (c.status === "pass" ? 1 : c.status === "warn" ? 0.5 : 0), 0);
  const score = total ? round((earned / total) * 100, 1) : 0;

  const recommendations = checks
    .filter((c) => (c.status === "fail" || c.status === "warn") && c.recommendation)
    .sort((a, b) => (a.status === b.status ? b.weight - a.weight : a.status === "fail" ? -1 : 1))
    .map((c) => ({
      checkId: c.id,
      priority: (c.status === "fail" && c.weight >= 5 ? "high" : c.status === "fail" || c.weight >= 5 ? "medium" : "low") as "high" | "medium" | "low",
      text: c.recommendation,
    }));

  return {
    version: CONTENT_SCORING_VERSION,
    keyword,
    score,
    checks,
    stats: {
      words,
      keywordOccurrences: occurrences,
      keywordDensity: round(density, 4),
      firstOccurrenceWord: first === null ? null : first + 1,
      headings: { h1: h1s.length, h2: doc.headings.filter((h) => h.level === 2).length, h3plus: doc.headings.filter((h) => h.level >= 3).length, skips },
      paragraphs: doc.paragraphs.length,
      lists: doc.lists,
      images: doc.images.length,
      imagesMissingAlt: missingAlt,
      internalLinks: internal.length,
      externalLinks: external.length,
    },
    readability: read,
    terms,
    topTerms: topTerms(doc.text),
    recommendations,
  };
}
