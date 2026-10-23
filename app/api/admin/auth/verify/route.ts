import type { NextRequest } from "next/server";

import {
  createSession,
  isAllowedEmail,
  isProfileComplete,
  normalizeEmail,
  sessionCookie,
  upsertAdminOnLogin,
  verifyOtp,
} from "@/lib/auth";
import { isLoggingEnabled } from "@/lib/db";

export const runtime = "nodejs";

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isLoggingEnabled()) {
    return json(500, {
      error: "Server misconfigured: NEON_DATABASE_URL is required for admin access",
    });
  }

  let body: { email?: unknown; code?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; code?: unknown };
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  if (typeof body.email !== "string" || typeof body.code !== "string") {
    return json(400, { error: 'Missing required fields: "email" and "code".' });
  }
  const email = normalizeEmail(body.email);
  const code = body.code.trim();

  if (!/^\d{6}$/.test(code) || !isAllowedEmail(email)) {
    return json(401, { error: "Invalid or expired code." });
  }

  try {
    if (!(await verifyOtp(email, code))) {
      return json(401, { error: "Invalid or expired code." });
    }

    const user = await upsertAdminOnLogin(email);
    const { token, expires } = await createSession(user.id);

    return new Response(
      JSON.stringify({ ok: true, user, profileComplete: isProfileComplete(user) }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": sessionCookie(token, expires),
        },
      },
    );
  } catch (err) {
    console.error("Admin login verification failed:", err);
    return json(502, { error: "Database unavailable" });
  }
}
