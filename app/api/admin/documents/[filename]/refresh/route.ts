import type { NextRequest } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { getIndex } from "@/lib/clients";
import { ingestUrl, UrlIngestError } from "@/lib/ingest-url";

export const runtime = "nodejs";
export const maxDuration = 60;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
): Promise<Response> {
  const authError = requireAdmin(request);
  if (authError) return authError;

  const { filename } = await params;
  const decoded = decodeURIComponent(filename);
  const headerId = `header::${decoded}`;

  const headerNs = getIndex().namespace("headers");
  const fetched = await headerNs.fetch({ ids: [headerId] });
  const header = (fetched.records ?? {})[headerId];

  if (!header) {
    return json(404, { error: "Source not found." });
  }

  if (header.metadata?.sourceType !== "url") {
    return json(400, {
      error: "This source is a file and cannot be refreshed via URL.",
    });
  }

  const url = header.metadata.url as string;
  if (!url) {
    return json(500, { error: "Source URL is missing from metadata." });
  }

  try {
    const result = await ingestUrl(url);
    return json(200, { ok: true, ...result });
  } catch (err) {
    if (err instanceof UrlIngestError) {
      return json(err.status, { error: err.message });
    }
    throw err;
  }
}
