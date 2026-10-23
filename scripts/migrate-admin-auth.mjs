// Creates the admin auth and source audit tables. Idempotent: safe to re-run.
//   npm run migrate-admin-auth
import { neon } from "@neondatabase/serverless";

if (!process.env.NEON_DATABASE_URL) {
  console.error("NEON_DATABASE_URL is not set.");
  process.exit(1);
}

const sql = neon(process.env.NEON_DATABASE_URL);

const statements = [
  `CREATE TABLE IF NOT EXISTS admin_users (
     id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     email         TEXT NOT NULL UNIQUE,
     first_name    TEXT,
     last_name     TEXT,
     phone         TEXT,
     created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
     last_login_at TIMESTAMPTZ
   )`,
  `CREATE TABLE IF NOT EXISTS admin_otps (
     email      TEXT PRIMARY KEY,
     code_hash  TEXT NOT NULL,
     expires_at TIMESTAMPTZ NOT NULL,
     attempts   SMALLINT NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
     token_hash TEXT PRIMARY KEY,
     user_id    UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
     expires_at TIMESTAMPTZ NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS source_audit (
     id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     action        TEXT NOT NULL CHECK (action IN ('added', 'updated', 'removed')),
     filename      TEXT NOT NULL,
     source_name   TEXT NOT NULL,
     url           TEXT,
     admin_user_id UUID REFERENCES admin_users(id),
     admin_email   TEXT NOT NULL,
     admin_name    TEXT NOT NULL,
     created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS admin_sessions_user_id_idx ON admin_sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS admin_sessions_expires_at_idx ON admin_sessions(expires_at)`,
  `CREATE INDEX IF NOT EXISTS source_audit_created_at_idx ON source_audit(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS source_audit_filename_idx ON source_audit(filename)`,
];

for (const statement of statements) {
  await sql.query(statement);
}
console.log(`Applied ${statements.length} statements.`);
