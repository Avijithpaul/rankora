import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { EXPORTERS, type ExportFormat } from "@/lib/reports/export";
import type { ReportSnapshot } from "@/lib/reports/compose";

/** Download a stored report: ?format=json | csv | pdf (pdf answers 501 until a renderer is configured). */
export async function GET(request: Request, ctx: RouteContext<"/api/reports/[reportId]/export">) {
  const { reportId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await getUser())) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const format = (new URL(request.url).searchParams.get("format") ?? "json") as ExportFormat;
  const exporter = EXPORTERS[format];
  if (!exporter) return NextResponse.json({ error: "Unknown format" }, { status: 400 });
  // read as the user: RLS returns other tenants' reports as not found
  const supabase = await createClient();
  const { data: report } = await supabase.from("reports").select("id, title, snapshot").eq("id", reportId).maybeSingle();
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!exporter.available()) {
    return NextResponse.json({ error: `${exporter.label} export is not configured on this server. Open the report and use Print → Save as PDF.` }, { status: 501 });
  }
  const file = await exporter.render({ id: report.id, title: report.title, snapshot: report.snapshot as unknown as ReportSnapshot });
  return new NextResponse(file.body as BodyInit, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
