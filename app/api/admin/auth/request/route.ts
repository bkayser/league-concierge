import type { NextRequest } from "next/server";

import { isAllowedEmail, issueOtp, normalizeEmail } from "@/lib/auth";
import { isLoggingEnabled } from "@/lib/db";
import { sendLoginCode } from "@/lib/email";

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

  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  if (typeof body.email !== "string" || !body.email.includes("@")) {
    return json(400, { error: "Please enter a valid email address." });
  }
  const email = normalizeEmail(body.email);

  // Same response whether or not the address is allowed, so the endpoint
  // cannot be used to probe the allowlist.
  if (!isAllowedEmail(email)) {
    return json(200, { ok: true });
  }

  try {
    const issued = await issueOtp(email);
    if (!issued.ok) {
      return json(429, {
        error: "A code was just sent. Please wait a minute before requesting another.",
      });
    }
    await sendLoginCode(email, issued.code);
  } catch (err) {
    console.error("Failed to issue admin login code:", err);
    return json(502, { error: "Could not send the sign-in code. Please try again." });
  }

  return json(200, { ok: true });
}
