import type { NextRequest } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { getSourceAudit, getSourceAuditCsv } from "@/lib/db";

export const runtime = "nodejs";

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);

  if (searchParams.get("download") === "true") {
    let csv: string;
    try {
      csv = await getSourceAuditCsv();
    } catch (err) {
      console.error("getSourceAuditCsv failed:", err);
      return json(502, { error: "Failed to generate CSV." });
    }

    const date = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="oysa-source-audit-${date}.csv"`,
      },
    });
  }

  try {
    const entries = await getSourceAudit();
    return Response.json({ entries });
  } catch (err) {
    console.error("getSourceAudit failed:", err);
    return json(502, { error: "Failed to load audit log." });
  }
}
