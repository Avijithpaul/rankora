/**
 * robots.txt parser and matcher (RFC 9309):
 *  - groups of user-agent lines followed by allow/disallow rules
 *  - the most specific matching group wins (exact product token, else "*")
 *  - the longest matching rule wins; on a tie, Allow wins
 *  - "*" wildcard and "$" end anchor are supported
 */

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsTxt {
  groups: { agents: string[]; rules: RobotsRule[]; crawlDelay?: number }[];
  sitemaps: string[];
}

export function parseRobots(text: string): RobotsTxt {
  const groups: RobotsTxt["groups"] = [];
  const sitemaps: string[] = [];
  let current: RobotsTxt["groups"][number] | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (!current) continue;
    if (field === "allow" || field === "disallow") {
      // An empty Disallow means "allow everything" and adds no rule.
      if (value) current.rules.push({ allow: field === "allow", pattern: value });
    } else if (field === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  return { groups, sitemaps };
}

function groupFor(robots: RobotsTxt, userAgent: string) {
  const ua = userAgent.toLowerCase();
  const specific = robots.groups.filter((g) => g.agents.some((a) => a !== "*" && ua.includes(a)));
  if (specific.length) return specific;
  return robots.groups.filter((g) => g.agents.includes("*"));
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + body + (anchored ? "$" : ""));
}

/** Whether `pathWithQuery` (e.g. "/a/b?x=1") may be crawled by `userAgent`. */
export function isAllowed(robots: RobotsTxt | null, userAgent: string, pathWithQuery: string): boolean {
  if (!robots) return true;
  const rules = groupFor(robots, userAgent).flatMap((g) => g.rules);
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!patternToRegex(rule.pattern).test(pathWithQuery)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

/** True when robots.txt blocks the whole site for this agent ("Disallow: /" without an overriding Allow). */
export function blocksEverything(robots: RobotsTxt | null, userAgent: string): boolean {
  return !isAllowed(robots, userAgent, "/");
}

export function crawlDelaySeconds(robots: RobotsTxt | null, userAgent: string): number | null {
  if (!robots) return null;
  const delays = groupFor(robots, userAgent)
    .map((g) => g.crawlDelay)
    .filter((d): d is number => d !== undefined);
  return delays.length ? Math.max(...delays) : null;
}
