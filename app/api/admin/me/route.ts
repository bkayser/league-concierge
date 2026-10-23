import type { NextRequest } from "next/server";

import { isProfileComplete, requireAdmin, updateAdminProfile } from "@/lib/auth";

export const runtime = "nodejs";

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireAdmin(request, { allowIncompleteProfile: true });
  if (auth.error) return auth.error;
  return json(200, { user: auth.admin, profileComplete: isProfileComplete(auth.admin) });
}

const MAX_NAME_LENGTH = 100;

export async function PUT(request: NextRequest): Promise<Response> {
  const auth = await requireAdmin(request, { allowIncompleteProfile: true });
  if (auth.error) return auth.error;

  let body: { firstName?: unknown; lastName?: unknown; phone?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";

  if (!firstName || !lastName || !phone) {
    return json(400, { error: "First name, last name, and phone are required." });
  }
  if (firstName.length > MAX_NAME_LENGTH || lastName.length > MAX_NAME_LENGTH) {
    return json(400, { error: "Names must be 100 characters or fewer." });
  }
  // Accept common formatting; require 10–15 digits overall.
  const digits = phone.replace(/\D/g, "");
  if (!/^[\d\s()+.-]+$/.test(phone) || digits.length < 10 || digits.length > 15) {
    return json(400, { error: "Please enter a valid phone number." });
  }

  try {
    const user = await updateAdminProfile(auth.admin.id, { firstName, lastName, phone });
    return json(200, { user, profileComplete: isProfileComplete(user) });
  } catch (err) {
    console.error("Profile update failed:", err);
    return json(502, { error: "Database unavailable" });
  }
}
