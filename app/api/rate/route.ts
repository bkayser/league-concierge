import type { NextRequest } from "next/server";

import { isLoggingEnabled, rateInteraction } from "@/lib/db";

export const runtime = "nodejs";

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function PATCH(request: NextRequest): Promise<Response> {
  if (!isLoggingEnabled()) {
    return json(404, { error: "Not found." });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const { interactionId, rating, comment } = (body as {
    interactionId?: unknown;
    rating?: unknown;
    comment?: unknown;
  }) ?? {};

  if (typeof interactionId !== "string" || interactionId.length === 0) {
    return json(400, { error: 'Missing required field: "interactionId".' });
  }

  if (rating !== 1 && rating !== -1) {
    return json(400, { error: '"rating" must be 1 or -1.' });
  }

  const commentValue =
    typeof comment === "string" && comment.length > 0 ? comment : null;

  let matched: boolean;
  try {
    matched = await rateInteraction({
      interactionId,
      rating: rating as 1 | -1,
      comment: commentValue,
    });
  } catch (err) {
    console.error("rateInteraction failed:", err);
    return json(502, { error: "Failed to save rating. Please try again." });
  }

  if (!matched) {
    return json(404, { error: "Interaction not found." });
  }

  return json(200, { ok: true });
}
