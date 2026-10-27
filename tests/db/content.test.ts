import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asService, asUser, createTestDb, createUser } from "./harness";

const A = "00000000-0000-4000-8000-0000000000e1";
const B = "00000000-0000-4000-8000-0000000000e2";
let db: PGlite;
let orgA: string;
let siteA: string;
let job: string;

type Row = { url: string; clicks: number | null; impressions: number | null; avg_position: string | null; page_views: number | null; open_issues: number; keywords: number; total_count: number; gsc_source: string | null; ga_source: string | null };

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, A);
  await createUser(db, B);
  orgA = await asUser(db, A, async (tx) => (await tx.query<{ id: string }>(`select public.create_organization('C A', 'c-a') as id`)).rows[0].id);
  await asUser(db, B, (tx) => tx.query(`select public.create_organization('C B', 'c-b')`));
  siteA = await asUser(db, A, async (tx) =>
    (await tx.query<{ id: string }>(`insert into public.websites (organization_id, name, domain, base_url) values ($1,'A','a.example','https://a.example/') returning id`, [orgA])).rows[0].id,
  );
  await asService(db, async (tx) => {
    job = (await tx.query<{ id: string }>(`insert into public.crawl_jobs (organization_id, website_id, status) values ($1,$2,'completed') returning id`, [orgA, siteA])).rows[0].id;
    await tx.query(
      `insert into public.crawl_pages (organization_id, crawl_job_id, website_id, url, normalized_url, fetch_state, status_code, depth, word_count) values
       ($1,$2,$3,'https://a.example/','https://a.example/','fetched',200,0,800),
       ($1,$2,$3,'https://a.example/boots?x=1','https://a.example/boots?x=1','fetched',200,1,150),
       ($1,$2,$3,'https://a.example/old','https://a.example/old','fetched',404,1,null),
       ($1,$2,$3,'https://a.example/queue','https://a.example/queue','pending',null,2,null)`,
      [orgA, job, siteA],
    );
    await tx.query(
      `insert into public.search_console_pages (organization_id, website_id, date, page, source, clicks, impressions, ctr, position) values
       ($1,$2,'2026-10-01','https://a.example/boots?x=1','gsc',3,100,0.03,8), ($1,$2,'2026-10-02','https://a.example/boots?x=1','gsc',7,300,0.02,12),
       ($1,$2,'2026-10-01','https://a.example/','gsc',1,10,0.1,3), ($1,$2,'2026-09-01','https://a.example/','gsc',500,900,0.5,1)`,
      [orgA, siteA],
    );
    await tx.query(
      `insert into public.analytics_pages (organization_id, website_id, date, page_path, is_landing, source, users, sessions, engaged_sessions, page_views) values
       ($1,$2,'2026-10-01','/boots',false,'ga4',4,5,3,9), ($1,$2,'2026-10-01','/boots',true,'ga4',40,50,30,90), ($1,$2,'2026-10-01','/',false,'ga4',1,1,1,2)`,
      [orgA, siteA],
    );
    const issue = (
      await tx.query<{ id: string }>(
        `insert into public.seo_issues (organization_id, website_id, rule_id, fingerprint, title, explanation, recommendation, severity) values ($1,$2,'page.thin','page.thin','t','e','r','warning') returning id`,
        [orgA, siteA],
      )
    ).rows[0].id;
    await tx.query(`insert into public.seo_issue_pages (issue_id, organization_id, url) values ($1,$2,'https://a.example/boots?x=1')`, [issue, orgA]);
  });
  await asUser(db, A, (tx) =>
    tx.query(
      `insert into public.keywords (organization_id, website_id, keyword, normalized_keyword, country_code, language_code, target_url) values ($1,$2,'boots','boots','US','en','https://a.example/boots?x=1')`,
      [orgA, siteA],
    ),
  );
}, 60_000);

const explore = (user: string | null, extra = "") =>
  asUser(db, user, (tx) => tx.query<Row>(`select * from public.page_explorer($1,$2,'2026-10-01','2026-10-31'${extra})`, [siteA, job]));

describe("url_path", () => {
  it("strips scheme, host, query and fragment", async () => {
    const r = await asUser(db, A, (tx) =>
      tx.query<{ a: string; b: string; c: string }>(`select public.url_path('https://a.example/boots?x=1#top') a, public.url_path('https://a.example') b, public.url_path('https://a.example/?q') c`),
    );
    expect(r.rows[0]).toEqual({ a: "/boots", b: "/", c: "/" });
  });
});

describe("page_explorer", () => {
  it("joins crawl pages with GSC (date range), GA4 (non-landing, by path), issues and keywords", async () => {
    const r = await explore(A);
    expect(r.rows.map((x) => x.url)).toEqual(["https://a.example/boots?x=1", "https://a.example/", "https://a.example/old"]);
    const boots = r.rows[0];
    expect(boots).toMatchObject({ clicks: 10, impressions: 400, avg_position: "11.00", page_views: 9, open_issues: 1, keywords: 1, gsc_source: "gsc", ga_source: "ga4", total_count: 3 });
    expect(r.rows[1]).toMatchObject({ clicks: 1, impressions: 10 }); // September row excluded
    expect(r.rows[2]).toMatchObject({ clicks: null, page_views: null, open_issues: 0, keywords: 0 });
  });

  it("filters, sorts and paginates", async () => {
    const notFound = await explore(A, `, null, '4xx'`);
    expect(notFound.rows.map((x) => x.url)).toEqual(["https://a.example/old"]);
    const search = await explore(A, `, 'boo'`);
    expect(search.rows).toHaveLength(1);
    const literal = await explore(A, `, '%'`);
    expect(literal.rows).toHaveLength(0); // wildcards are escaped
    const byPos = await explore(A, `, null, 'all', 'all', 'position'`);
    expect(byPos.rows[0].url).toBe("https://a.example/");
    const page2 = await explore(A, `, null, 'all', 'all', 'clicks', 1, 1`);
    expect(page2.rows.map((x) => x.url)).toEqual(["https://a.example/"]);
    expect(page2.rows[0].total_count).toBe(3);
  });

  it("is scoped by RLS and not callable anonymously", async () => {
    expect((await explore(B)).rows).toHaveLength(0);
    await expect(explore(null)).rejects.toThrow(/permission denied/);
  });
});

describe("content_analyses", () => {
  it("is written by the server only; members read and delete their organization's history", async () => {
    await expect(
      asUser(db, A, (tx) => tx.query(`insert into public.content_analyses (organization_id, website_id, target_keyword, source_type) values ($1,$2,'boots','draft')`, [orgA, siteA])),
    ).rejects.toThrow(/permission denied/);
    const id = await asService(db, async (tx) =>
      (
        await tx.query<{ id: string }>(
          `insert into public.content_analyses (organization_id, website_id, target_keyword, source_type, score, results, scoring_version, word_count, created_by)
           values ($1,$2,'boots','draft',72.5,'{}','2026.10-c1',420,$3) returning id`,
          [orgA, siteA, A],
        )
      ).rows[0].id,
    );
    expect((await asUser(db, B, (tx) => tx.query(`select id from public.content_analyses`))).rows).toHaveLength(0);
    await expect(asUser(db, A, (tx) => tx.query(`update public.content_analyses set score = 100 where id = $1`, [id]))).rejects.toThrow(/permission denied/);
    expect((await asUser(db, B, (tx) => tx.query(`delete from public.content_analyses where id = $1`, [id]))).affectedRows).toBe(0);
    expect((await asUser(db, A, (tx) => tx.query(`select id from public.content_analyses`))).rows).toHaveLength(1);
    expect((await asUser(db, A, (tx) => tx.query(`delete from public.content_analyses where id = $1`, [id]))).affectedRows).toBe(1);
  });

  it("requires a source URL for URL analyses", async () => {
    await expect(
      asService(db, (tx) => tx.query(`insert into public.content_analyses (organization_id, website_id, target_keyword, source_type) values ($1,$2,'boots','url')`, [orgA, siteA])),
    ).rejects.toThrow(/content_analyses_url_required/);
  });
});
