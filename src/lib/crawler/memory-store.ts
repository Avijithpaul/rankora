/** In-memory CrawlStore used by tests and the local CLI. */
import type { CrawlStore, NewLink, PendingPage, QueueEntry, SavedPage } from "./types";
import { normalizeUrl } from "./url";

export interface MemoryPage {
  id: string;
  url: string;
  depth: number;
  attempts: number;
  state: "pending" | "fetched" | "failed" | "skipped";
  foundInSitemap: boolean;
  foundViaLink: boolean;
  lastError?: string;
  saved?: SavedPage;
  order: number;
}

export interface MemoryLink extends NewLink {
  sourcePageId: string;
  targetStatus: number | null;
  targetError: string | null;
}

export class MemoryCrawlStore implements CrawlStore {
  pages = new Map<string, MemoryPage>(); // keyed by normalized URL
  links: MemoryLink[] = [];
  private seq = 0;

  async countPages() {
    return this.pages.size;
  }
  async countFetched() {
    return [...this.pages.values()].filter((p) => p.state !== "pending").length;
  }
  async enqueue(entries: QueueEntry[]) {
    let added = 0;
    for (const e of entries) {
      const url = normalizeUrl(e.url);
      if (!url || this.pages.has(url)) continue;
      this.pages.set(url, {
        id: `p${++this.seq}`,
        url,
        depth: e.depth,
        attempts: 0,
        state: "pending",
        foundInSitemap: Boolean(e.foundInSitemap),
        foundViaLink: Boolean(e.foundViaLink),
        order: this.seq,
      });
      added++;
    }
    return added;
  }
  async markFound(urls: string[], how: "sitemap" | "link") {
    for (const u of urls) {
      const p = this.pages.get(normalizeUrl(u) ?? u);
      if (p) {
        if (how === "sitemap") p.foundInSitemap = true;
        else p.foundViaLink = true;
      }
    }
  }
  async nextPending(limit: number): Promise<PendingPage[]> {
    return [...this.pages.values()]
      .filter((p) => p.state === "pending")
      .sort((a, b) => a.depth - b.depth || a.order - b.order)
      .slice(0, limit)
      .map((p) => ({ id: p.id, url: p.url, depth: p.depth, attempts: p.attempts }));
  }
  private byId(id: string) {
    const p = [...this.pages.values()].find((x) => x.id === id);
    if (!p) throw new Error(`unknown page ${id}`);
    return p;
  }
  async savePage(id: string, page: SavedPage) {
    const p = this.byId(id);
    p.state = page.fetchState;
    p.attempts = page.attempts;
    p.saved = page;
  }
  async retryLater(id: string, attempts: number, error: string) {
    const p = this.byId(id);
    p.attempts = attempts;
    p.lastError = error;
    p.order = ++this.seq; // move to the back of its depth level
  }
  async saveLinks(pageId: string, links: NewLink[]) {
    for (const l of links) this.links.push({ ...l, sourcePageId: pageId, targetStatus: null, targetError: null });
  }
  async uncheckedExternalTargets(limit: number) {
    const out: string[] = [];
    for (const l of this.links) {
      if (!l.isInternal && l.targetStatus === null && l.targetError === null && !out.includes(l.targetUrl)) out.push(l.targetUrl);
      if (out.length >= limit) break;
    }
    return out;
  }
  async setExternalStatus(targetUrl: string, status: number | null, error: string | null) {
    for (const l of this.links) {
      if (l.targetUrl === targetUrl) {
        l.targetStatus = status;
        l.targetError = error ?? (status === null ? "unknown error" : null);
      }
    }
  }
}
