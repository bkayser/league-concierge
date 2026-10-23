import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { getDb, isLoggingEnabled } from "@/lib/db";

// ---- Constants ----------------------------------------------------------

export const SESSION_COOKIE = "admin_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

// ---- Types --------------------------------------------------------------

export interface AdminUser {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
}

export function isProfileComplete(user: AdminUser): boolean {
  return Boolean(user.first_name && user.last_name && user.phone);
}

export function displayName(user: AdminUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---- Allowlist ----------------------------------------------------------

// ADMIN_ALLOWLIST is comma separated. An entry containing "@" with a local
// part is an exact address ("pat@example.org"); anything else is a domain
// ("example.org" or "@example.org") and admits every address on it.
// Subdomains are not matched implicitly.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAllowedEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return false;
  const domain = normalized.slice(at + 1);

  const entries = (process.env.ADMIN_ALLOWLIST ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  return entries.some((entry) => {
    const entryAt = entry.indexOf("@");
    if (entryAt > 0) return entry === normalized;
    return entry.replace(/^@/, "") === domain;
  });
}

// ---- Hashing ------------------------------------------------------------

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashOtp(email: string, code: string): string {
  return sha256(`${normalizeEmail(email)}:${code}`);
}

// ---- OTP ----------------------------------------------------------------

export type OtpIssueResult =
  | { ok: true; code: string }
  | { ok: false; reason: "cooldown" };

export async function issueOtp(email: string): Promise<OtpIssueResult> {
  const sql = getDb();
  const normalized = normalizeEmail(email);

  const existing = (await sql`
    SELECT created_at FROM admin_otps WHERE email = ${normalized} LIMIT 1
  `) as { created_at: string }[];
  if (
    existing[0] &&
    Date.now() - new Date(existing[0].created_at).getTime() < OTP_RESEND_COOLDOWN_MS
  ) {
    return { ok: false, reason: "cooldown" };
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  await sql`
    INSERT INTO admin_otps (email, code_hash, expires_at, attempts, created_at)
    VALUES (${normalized}, ${hashOtp(normalized, code)}, ${expiresAt}, 0, now())
    ON CONFLICT (email) DO UPDATE SET
      code_hash  = EXCLUDED.code_hash,
      expires_at = EXCLUDED.expires_at,
      attempts   = 0,
      created_at = now()
  `;
  return { ok: true, code };
}

// Returns true and consumes the code when it matches. Each wrong guess
// counts against OTP_MAX_ATTEMPTS; past that the code is dead.
export async function verifyOtp(email: string, code: string): Promise<boolean> {
  const sql = getDb();
  const normalized = normalizeEmail(email);

  const rows = (await sql`
    UPDATE admin_otps SET attempts = attempts + 1
    WHERE email = ${normalized} AND expires_at > now() AND attempts < ${OTP_MAX_ATTEMPTS}
    RETURNING code_hash
  `) as { code_hash: string }[];
  if (rows.length === 0) return false;

  const expected = Buffer.from(rows[0].code_hash, "hex");
  const actual = Buffer.from(hashOtp(normalized, code.trim()), "hex");
  if (!timingSafeEqual(expected, actual)) return false;

  await sql`DELETE FROM admin_otps WHERE email = ${normalized}`;
  return true;
}

// ---- Users and sessions -------------------------------------------------

export async function upsertAdminOnLogin(email: string): Promise<AdminUser> {
  const sql = getDb();
  const rows = (await sql`
    INSERT INTO admin_users (email, last_login_at)
    VALUES (${normalizeEmail(email)}, now())
    ON CONFLICT (email) DO UPDATE SET last_login_at = now()
    RETURNING id, email, first_name, last_name, phone
  `) as AdminUser[];
  return rows[0];
}

export async function updateAdminProfile(
  userId: string,
  profile: { firstName: string; lastName: string; phone: string },
): Promise<AdminUser> {
  const sql = getDb();
  const rows = (await sql`
    UPDATE admin_users
    SET first_name = ${profile.firstName}, last_name = ${profile.lastName}, phone = ${profile.phone}
    WHERE id = ${userId}::uuid
    RETURNING id, email, first_name, last_name, phone
  `) as AdminUser[];
  return rows[0];
}

export async function createSession(
  userId: string,
): Promise<{ token: string; expires: Date }> {
  const sql = getDb();
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  // Logins are rare, so sweeping expired sessions here is cheap enough to
  // avoid needing a scheduled job.
  await sql`DELETE FROM admin_sessions WHERE expires_at < now()`;
  await sql`
    INSERT INTO admin_sessions (token_hash, user_id, expires_at)
    VALUES (${sha256(token)}, ${userId}::uuid, ${expires.toISOString()})
  `;
  return { token, expires };
}

export async function deleteSession(token: string): Promise<void> {
  const sql = getDb();
  await sql`DELETE FROM admin_sessions WHERE token_hash = ${sha256(token)}`;
}

export function sessionCookie(token: string, expires: Date): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expires.toUTCString()}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readSessionToken(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}

async function getSessionUser(token: string): Promise<AdminUser | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT u.id, u.email, u.first_name, u.last_name, u.phone
    FROM admin_sessions s
    JOIN admin_users u ON u.id = s.user_id
    WHERE s.token_hash = ${sha256(token)} AND s.expires_at > now()
    LIMIT 1
  `) as AdminUser[];
  return rows[0] ?? null;
}

// ---- Route guard --------------------------------------------------------

// Resolves the signed-in admin from the session cookie. The allowlist is
// re-checked on every request so removing an address from ADMIN_ALLOWLIST
// revokes access immediately. Unless allowIncompleteProfile is set, admins
// who have not yet supplied name and phone are refused, so every audited
// action carries a real name.
export async function requireAdmin(
  req: Request,
  opts: { allowIncompleteProfile?: boolean } = {},
): Promise<{ admin: AdminUser; error?: never } | { admin?: never; error: Response }> {
  if (!isLoggingEnabled()) {
    return {
      error: jsonResponse(500, {
        error: "Server misconfigured: NEON_DATABASE_URL is required for admin access",
      }),
    };
  }

  const token = readSessionToken(req);
  if (!token) return { error: jsonResponse(401, { error: "Unauthorized" }) };

  let admin: AdminUser | null;
  try {
    admin = await getSessionUser(token);
  } catch (err) {
    console.error("Session lookup failed:", err);
    return { error: jsonResponse(502, { error: "Database unavailable" }) };
  }

  if (!admin || !isAllowedEmail(admin.email)) {
    return { error: jsonResponse(401, { error: "Unauthorized" }) };
  }

  if (!opts.allowIncompleteProfile && !isProfileComplete(admin)) {
    return {
      error: jsonResponse(403, { error: "Profile incomplete", code: "profile_incomplete" }),
    };
  }

  return { admin };
}
