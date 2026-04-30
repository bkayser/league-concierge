import type { NextRequest } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { getIndex } from "@/lib/clients";
import { getSources, isLoggingEnabled } from "@/lib/db";

export async function GET(request: NextRequest): Promise<Response> {
  const authError = requireAdmin(request);
  if (authError) return authError;

  if (isLoggingEnabled()) {
    const rows = await getSources();
    const documents = rows.map((row) => ({
      filename: row.filename,
      originalFilename: row.original_filename,
      uploadDate: row.upload_date,
      fileSizeBytes: row.file_size_bytes,
      fileSizeDisplay: row.file_size_display,
      mimeType: row.mime_type,
      totalChunks: row.total_chunks,
      sourceType: row.mime_type === "text/html" ? "url" : "file",
      url: row.url ?? undefined,
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
