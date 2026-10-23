# Admin Sign-in and Source Audit

The admin UI (`/admin`) and the ingest/admin API routes are protected by per-user sign-in with an emailed one-time code. Every source added, updated, or removed is recorded in an audit log, which you can view on the admin **Audit** tab.

---

## How it works

1. The admin enters their email. If the address is on the allowlist, the server emails a 6-digit code. The response looks the same whether or not the address is allowed, so the endpoint can't be used to probe the allowlist.
2. The code expires after 10 minutes and allows 5 attempts. A new code can be requested once a minute. Codes are stored only as SHA-256 hashes.
3. A correct code creates a session. The session token is stored in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production) and lasts 7 days. **Sign out** deletes it.
4. On first sign-in, the admin is asked for first name, last name, and phone number. Admin API routes refuse requests (`403 profile_incomplete`) until those are filled in, so every audit entry has a real name on it.
5. The allowlist is checked again on **every** request. Removing an address or domain from `ADMIN_ALLOWLIST` and redeploying revokes that admin's access immediately, even if their session hasn't expired.

### Audit log

| Action | Recorded when |
|---|---|
| `added` | A file is uploaded or a URL is ingested that wasn't already a source |
| `updated` | A file is re-uploaded under the same name, a URL is re-ingested, or a URL source is refreshed |
| `removed` | A source is deleted |

Each entry stores the time, the source name, the normalized filename/URL key, and the admin's name and email **as they were at the time of the action**. The Audit tab shows the latest 200 entries. **Download all (CSV)** exports the full history.

`npm run sync-sources` (the Pinecone→Neon backfill) is not audited. It runs from a developer machine, not as an admin.

---

## Environment variables

| Variable | Purpose |
|---|---|
| `NEON_DATABASE_URL` | **Required for admin access.** Users, codes, sessions, and the audit log live in Neon. Chat still works without it. |
| `ADMIN_ALLOWLIST` | Comma-separated emails and domains. `pat@example.org` allows that one address. `example.org` or `@example.org` allows any address on that domain (not its subdomains). Case-insensitive. |
| `RESEND_API_KEY` | A Resend API key with sending access, restricted to the sending domain. |
| `EMAIL_FROM` | Sender for the code emails. The domain must be verified in the same Resend account. |

Example:

```
ADMIN_ALLOWLIST=bill@example.com,oregonyouthsoccer.org
EMAIL_FROM=Ask Footy <askfooty@bravoking.net>
```

The OYSA deployment sends from `bravoking.net`, a domain shared by several small projects. The display name and local part identify which project sent the email.

`ADMIN_PASSWORD` is no longer used and can be removed from Vercel.

**Local development:** if `RESEND_API_KEY` or `EMAIL_FROM` is unset and `NODE_ENV` is not `production`, the code is printed to the dev server log as `[dev] Admin login code for …` instead of being emailed. In production a missing key fails the request with a `502`.

---

## Setup

1. **Verify a sending domain in Resend.** In the [Resend dashboard](https://resend.com/domains), add the domain (region `us-east-1`, alongside Vercel and Neon) and create the DNS records it lists. You only do this once per domain; other projects can reuse it.

2. **Create an API key** under **API Keys** with *Sending access*, restricted to that domain. Use one key per project so you can revoke one project's key without breaking the others.

3. **Set the variables** for Production, Preview, and Development:

   ```bash
   vercel env add RESEND_API_KEY
   vercel env add EMAIL_FROM
   vercel env add ADMIN_ALLOWLIST
   ```

   The Resend integration on the Vercel Marketplace would also work, but it requires a new Resend account (its free plan isn't available to members of an existing Resend team). Nothing in the code depends on it.

4. **Create the tables.** This is idempotent (`CREATE … IF NOT EXISTS`) and only adds tables:

   ```bash
   npm run migrate-admin-auth
   ```

   This creates `admin_users`, `admin_otps`, `admin_sessions`, and `source_audit`.

5. **Redeploy**, open `/admin`, and sign in with an allowlisted address.

---

## API

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/admin/auth/request` | POST `{ email }` | none | Email a code if the address is allowed |
| `/api/admin/auth/verify` | POST `{ email, code }` | none | Exchange the code for a session cookie |
| `/api/admin/auth/logout` | POST | cookie | Delete the session |
| `/api/admin/me` | GET / PUT `{ firstName, lastName, phone }` | cookie (profile may be incomplete) | Read or complete the profile |
| `/api/admin/audit` | GET (`?download=true` for CSV) | cookie | Source audit log |

All other `/api/admin/*` and `/api/ingest*` routes require a signed-in admin with a complete profile.
