import type { NextRequest } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { getLog, getLogCsv, isLoggingEnabled } from "@/lib/db";

export const runtime = "nodejs";

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  const authError = requireAdmin(request);
  if (authError) return authError;

  // 404 is the client-side feature flag: logging disabled → hide Log tab
  if (!isLoggingEnabled()) {
    return json(404, { error: "Not found." });
  }

  const { searchParams } = new URL(request.url);
  const download = searchParams.get("download") === "true";
  const rawFilter = searchParams.get("filter") ?? "all";
  const filter =
    rawFilter === "rated" || rawFilter === "unrated" ? rawFilter : "all";

  if (download) {
    let csv: string;
    try {
      csv = await getLogCsv();
    } catch (err) {
      console.error("getLogCsv failed:", err);
      return json(502, { error: "Failed to generate CSV." });
    }

    const date = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="oysa-log-${date}.csv"`,
      },
    });
  }

  try {
    const interactions = await getLog({ filter });
    // #region agent log
    fetch("http://127.0.0.1:7332/ingest/be510bfa-a905-4eae-99f2-53e3706acaea", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "3eaca3" }, body: JSON.stringify({ sessionId: "3eaca3", location: "api/admin/log/route.ts:getLog", message: "getLog succeeded", data: { rowCount: interactions.length }, timestamp: Date.now(), hypothesisId: "F-G" }) }).catch(() => {});
    // #endregion
    return Response.json({ interactions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[debug-3eaca3] getLog threw:", msg);
    // #region agent log
    fetch("http://127.0.0.1:7332/ingest/be510bfa-a905-4eae-99f2-53e3706acaea", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "3eaca3" }, body: JSON.stringify({ sessionId: "3eaca3", location: "api/admin/log/route.ts:getLog-catch", message: "getLog threw", data: { error: msg }, timestamp: Date.now(), hypothesisId: "F-G-H-I" }) }).catch(() => {});
    // #endregion
    return json(502, { error: "Failed to load interaction log. Detail: " + msg });
  }
}
