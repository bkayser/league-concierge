import type { NextRequest } from "next/server";

import { clearedSessionCookie, deleteSession, readSessionToken } from "@/lib/auth";
import { isLoggingEnabled } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  const token = readSessionToken(request);
  if (token && isLoggingEnabled()) {
    await deleteSession(token).catch((err) =>
      console.error("Session delete failed:", err),
    );
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearedSessionCookie(),
    },
  });
}
