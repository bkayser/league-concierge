import type { NextRequest } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { getDb, isLoggingEnabled } from "@/lib/db";

export const runtime = "nodejs";

// Temporary diagnostic endpoint — remove after debugging is complete.
// Returns environment variable status and database connectivity WITHOUT exposing secrets.
export async function GET(request: NextRequest): Promise<Response> {
  const authError = requireAdmin(request);
  if (authError) return authError;

  const url = process.env.NEON_DATABASE_URL;

  // Probe the database directly: try a simple query that works even with no tables
  let dbProbe: { ok: boolean; error?: string; tablesFound?: string[] } = { ok: false };
  if (url) {
    try {
      const sql = getDb();
      // List which of the expected tables actually exist
      const rows = await sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('sources', 'interactions', 'interaction_sources')
      ` as { table_name: string }[];
      dbProbe = { ok: true, tablesFound: rows.map((r) => r.table_name) };
    } catch (err) {
      dbProbe = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // #region agent log
  fetch("http://127.0.0.1:7332/ingest/be510bfa-a905-4eae-99f2-53e3706acaea", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "3eaca3" },
    body: JSON.stringify({ sessionId: "3eaca3", location: "app/api/debug-env/route.ts:GET-v2", message: "diagnostic v2", data: { envDefined: url !== undefined, envLength: url?.length ?? 0, envPrefix: url?.slice(0, 12) ?? "", dbProbe, vercelEnv: process.env.VERCEL_ENV }, timestamp: Date.now(), hypothesisId: "F-G-H-I" }),
  }).catch(() => {});
  // #endregion

  return Response.json({
    NEON_DATABASE_URL_defined: url !== undefined,
    NEON_DATABASE_URL_type: typeof url,
    NEON_DATABASE_URL_length: url?.length ?? 0,
    NEON_DATABASE_URL_prefix: url?.slice(0, 12) ?? "",
    isLoggingEnabled: isLoggingEnabled(),
    database: dbProbe,
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV ?? "(not set)",
    VERCEL_REGION: process.env.VERCEL_REGION ?? "(not set)",
  });
}
