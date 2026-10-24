# Admin Sign-in and Audit

The admin page (`/admin`) and all admin and ingest API routes require sign-in with a one-time code sent by email. Every source change is recorded in an audit log.

## Sign-in

1. The admin enters an email address. If it is on the allowlist, a 6-digit code is emailed. The response is the same either way, so the form can't be used to discover who is allowed.
2. The code expires after 10 minutes and allows 5 attempts. A new code can be requested once a minute. Codes are stored only as hashes.
3. A correct code starts a 30-day session, held in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). **Sign out** ends it.
4. On first sign-in the admin must enter first name, last name, and phone number before doing anything else, so every audit entry has a name on it.
5. The allowlist is checked on every request. Removing an address or domain from `ADMIN_ALLOWLIST` and redeploying revokes access immediately.

## Configuration

| Variable | Purpose |
|---|---|
| `NEON_DATABASE_URL` | Required. Admins, codes, sessions, and the audit log are stored in Neon. |
| `ADMIN_ALLOWLIST` | Comma-separated, case-insensitive. `pat@example.org` allows one address. `example.org` or `@example.org` allows every address on that domain, but not its subdomains. |
| `RESEND_API_KEY` | Resend key with sending access to the sending domain. |
| `EMAIL_FROM` | Sender, e.g. `Acme Concierge <concierge@mail.example.org>`. Must be on a domain verified in the same Resend account. |

If `RESEND_API_KEY` or `EMAIL_FROM` is unset outside production, the code is printed to the server log as `[dev] Admin login code for …`. In production the request fails.

One verified Resend domain can serve several projects; give each project its own API key and sender name.

Setup steps are in [DEPLOY.md](../DEPLOY.md) steps 4–5.

## Audit log

| Action | Recorded when |
|---|---|
| `added` | A file is uploaded or a URL is ingested that wasn't already a source |
| `updated` | A file is re-uploaded under the same name, or a URL is re-ingested or refreshed |
| `removed` | A source is deleted |

Each entry stores the time, the source name and key, the URL if any, and the admin's name and email at the time of the change. The **Audit** tab shows the latest 200 entries; **Download all (CSV)** exports everything. `npm run sync-sources` is not audited.

## API

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/admin/auth/request` | POST `{ email }` | none | Email a code if the address is allowed |
| `/api/admin/auth/verify` | POST `{ email, code }` | none | Exchange the code for a session cookie |
| `/api/admin/auth/logout` | POST | cookie | End the session |
| `/api/admin/me` | GET, PUT `{ firstName, lastName, phone }` | cookie; profile may be incomplete | Read or complete the profile |
| `/api/admin/documents` | GET | admin | List sources |
| `/api/admin/documents/[filename]` | DELETE | admin | Delete a source |
| `/api/admin/documents/[filename]/refresh` | POST | admin | Re-fetch a URL source |
| `/api/admin/log` | GET `?filter=all\|rated\|unrated`, `?download=true` | admin | Query log, or 30-day CSV |
| `/api/admin/log/[id]` | DELETE | admin | Permanently delete one logged question and answer |
| `/api/admin/audit` | GET, `?download=true` | admin | Audit log, or full CSV |
| `/api/ingest` | POST multipart `file` | admin | Upload a PDF or DOCX |
| `/api/ingest/url` | POST `{ url }` | admin | Ingest a web page |

"admin" means a valid session, an allowlisted email, and a complete profile. Otherwise the route returns `401`, or `403` with `code: "profile_incomplete"`.
