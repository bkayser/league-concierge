import type { NextRequest } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { isLoggingEnabled } from "@/lib/db";

export const runtime = "nodejs";

// Temporary diagnostic endpoint — remove after debugging is complete.
// Returns environment variable status WITHOUT exposing the actual secret value.
export async function GET(request: NextRequest): Promise<Response> {
  const authError = requireAdmin(request);
  if (authError) return authError;

  const url = process.env.NEON_DATABASE_URL;

  // #region agent log
  fetch("http://127.0.0.1:7332/ingest/be510bfa-a905-4eae-99f2-53e3706acaea", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "3eaca3" },
    body: JSON.stringify({ sessionId: "3eaca3", location: "app/api/debug-env/route.ts:GET", message: "diagnostic endpoint hit", data: { defined: url !== undefined, type: typeof url, length: url?.length ?? 0, prefix: url?.slice(0, 12) ?? "", vercelEnv: process.env.VERCEL_ENV, nodeEnv: process.env.NODE_ENV }, timestamp: Date.now(), hypothesisId: "A-B-C-D-E" }),
  }).catch(() => {});
  // #endregion

  return Response.json({
    NEON_DATABASE_URL_defined: url !== undefined,
    NEON_DATABASE_URL_type: typeof url,
    NEON_DATABASE_URL_length: url?.length ?? 0,
    NEON_DATABASE_URL_prefix: url?.slice(0, 12) ?? "",
    isLoggingEnabled: isLoggingEnabled(),
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV ?? "(not set — not running on Vercel, or missing)",
    VERCEL_REGION: process.env.VERCEL_REGION ?? "(not set)",
  });
}
