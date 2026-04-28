import type { NextRequest } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { ingestUrl, UrlIngestError } from "@/lib/ingest-url";
import {
  ensureIndexReady,
  IndexNotReadyError,
} from "@/lib/pinecone-readiness";

export const runtime = "nodejs";
export const maxDuration = 60;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    await ensureIndexReady();
  } catch (err) {
    if (err instanceof IndexNotReadyError) {
      return json(503, { error: err.message });
    }
    throw err;
  }

  let body: { url?: unknown };
  try {
    body = (await request.json()) as { url?: unknown };
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const { url } = body;
  if (!url || typeof url !== "string") {
    return json(400, { error: 'Missing required field: "url".' });
  }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return json(400, { error: "Only HTTP and HTTPS URLs are supported." });
  }

  try {
    new URL(url);
  } catch {
    return json(400, { error: "Invalid URL format." });
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
