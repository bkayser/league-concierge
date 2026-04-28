const ADMIN_PASSWORD_HEADER = "x-admin-password";

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function requireAdmin(req: Request): Response | null {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return jsonResponse(500, {
      error: "Server misconfigured: ADMIN_PASSWORD is not set",
    });
  }

  const provided = req.headers.get(ADMIN_PASSWORD_HEADER);
  if (provided !== expected) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  return null;
}
