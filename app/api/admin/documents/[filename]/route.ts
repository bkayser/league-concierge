import type { NextRequest } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { getIndex } from "@/lib/clients";
import { isLoggingEnabled, softDeleteSource } from "@/lib/db";

export async function DELETE(
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
    return new Response(JSON.stringify({ error: "Document not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const chunkIds = (header.metadata?.chunkIds as string[] | undefined) ?? [];
  if (chunkIds.length > 0) {
    await getIndex().namespace("production").deleteMany({ ids: chunkIds });
  }
  await headerNs.deleteOne({ id: headerId });

  if (isLoggingEnabled()) {
    softDeleteSource(decoded).catch((err) =>
      console.error("Source soft-delete failed:", err),
    );
  }

  return Response.json({ ok: true });
}
