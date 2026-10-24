import type { NextRequest } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { deleteInteraction, isLoggingEnabled } from "@/lib/db";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Permanently deletes one interaction and its source citations.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  if (!isLoggingEnabled()) {
    return json(404, { error: "Not found." });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return json(400, { error: "Invalid interaction ID." });
  }

  try {
    const deleted = await deleteInteraction(id);
    if (!deleted) return json(404, { error: "Interaction not found." });
    return json(200, { ok: true });
  } catch (err) {
    console.error("deleteInteraction failed:", err);
    return json(502, { error: "Failed to delete interaction." });
  }
}
