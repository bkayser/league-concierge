import type { NextRequest } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { getIndex } from "@/lib/clients";
import { getSources, isLoggingEnabled } from "@/lib/db";

export async function GET(request: NextRequest): Promise<Response> {
  const authError = requireAdmin(request);
  if (authError) return authError;

  if (isLoggingEnabled()) {
    // #region agent log
    let rows;
    try {
      rows = await getSources();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[debug-3eaca3] getSources threw:", msg);
      fetch("http://127.0.0.1:7332/ingest/be510bfa-a905-4eae-99f2-53e3706acaea", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "3eaca3" }, body: JSON.stringify({ sessionId: "3eaca3", location: "api/admin/documents/route.ts:getSources", message: "getSources threw", data: { error: msg }, timestamp: Date.now(), hypothesisId: "F-G-H-I" }) }).catch(() => {});
      return new Response(JSON.stringify({ error: "Database error: " + msg }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    // #endregion
    const documents = rows.map((row) => ({
      filename: row.filename,
      originalFilename: row.original_filename,
      uploadDate: row.upload_date,
      fileSizeBytes: row.file_size_bytes,
      fileSizeDisplay: row.file_size_display,
      mimeType: row.mime_type,
      totalChunks: row.total_chunks,
      sourceType: row.mime_type === "text/html" ? "url" : "file",
      useCount: row.use_count ?? 0,
    }));
    return Response.json({ documents });
  }

  const headerNs = getIndex().namespace("headers");

  // List all IDs in the headers namespace (single call — corpus is ~50 docs max)
  const idsResponse = await headerNs.listPaginated();
  const ids = (idsResponse.vectors ?? [])
    .map((v) => v.id)
    .filter((id): id is string => typeof id === "string");

  if (ids.length === 0) {
    return Response.json({ documents: [] });
  }

  const fetched = await headerNs.fetch({ ids });

  const documents = Object.values(fetched.records ?? {})
    .map((r) => r.metadata)
    .filter(Boolean)
    .sort((a, b) => {
      const bDate = typeof b?.uploadDate === "string" ? b.uploadDate : "";
      const aDate = typeof a?.uploadDate === "string" ? a.uploadDate : "";
      return bDate.localeCompare(aDate);
    });

  return Response.json({ documents });
}
