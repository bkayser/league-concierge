# Deployment Runbook — League Concierge

Step-by-step guide for deploying the application to Vercel for the first time and for verifying a successful deployment. Follow the steps in order — each one isolates a different failure surface.

---

## Prerequisites

Before starting:

- All feature PRs are merged to `main`.
- You have a Vercel account and the project is imported or linked (see Step 1).
- You have the values for all required environment variables listed in Step 2.
- A Pinecone index exists for your deployment (for OYSA this is `oysa-docs`, already provisioned). If setting up a brand-new Pinecone project, run `npm run create-index` locally first.
- **Optional — interaction logging:** If you want to enable logging, you also need a Neon Postgres database with the schema already applied. See [docs/LOGGING_SETUP.md](docs/LOGGING_SETUP.md) for the full setup guide.

---

## Step 1 — Link the repository to Vercel

**Option A — Vercel dashboard (recommended for first time)**

1. Go to [vercel.com/new](https://vercel.com/new).
2. Click **Import Git Repository** and select `league-concierge`.
3. Leave the framework preset as **Next.js** (auto-detected).
4. Do **not** deploy yet — continue to Step 2 to add environment variables first.

**Option B — Vercel CLI**

```bash
npm install -g vercel   # install CLI globally (not as a project dependency)
vercel link             # follow prompts to link to an existing project
```

---

## Step 2 — Add environment variables in Vercel

Add all variables in the Vercel project dashboard under **Settings → Environment Variables**. Set each variable for **Production**, **Preview**, and **Development** environments unless noted otherwise.

### Required

| Variable | Where to get the value |
|---|---|
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `PINECONE_API_KEY` | [app.pinecone.io](https://app.pinecone.io) → project → API Keys |
| `PINECONE_INDEX_NAME` | Your Pinecone index name (`oysa-docs` for the OYSA deployment) |
| `NEON_DATABASE_URL` | Neon project dashboard → **Connection string** (pooled). Required for admin sign-in and the audit log; also enables interaction logging. See [docs/LOGGING_SETUP.md](docs/LOGGING_SETUP.md). |
| `ADMIN_ALLOWLIST` | Comma-separated admin emails and/or domains (e.g. `pat@example.org,example.org`). See [docs/ADMIN_AUTH.md](docs/ADMIN_AUTH.md). |
| `RESEND_API_KEY` | [resend.com](https://resend.com/api-keys) → API Keys → sending access, restricted to the sending domain |
| `EMAIL_FROM` | Sender for sign-in codes on a domain verified in Resend, e.g. `Ask Footy <askfooty@bravoking.net>` |
| `GENERATION_MODEL` | Current canonical value: `claude-sonnet-5-5` — verify at [docs.anthropic.com/en/docs/models-overview](https://docs.anthropic.com/en/docs/models-overview) before setting |

> **Note on `GENERATION_MODEL`:** Anthropic returns a hard `404` for an invalid model string. If the chat endpoint returns errors immediately after deployment, this is the most likely cause. See the Troubleshooting section below.

### Neon and interaction logging

Without `NEON_DATABASE_URL` the chat still works, but nobody can sign in to the admin UI. With it set, all chat interactions are logged, the sources registry is enabled, and the admin UI gains a Log tab. Run `npm run migrate-admin-auth` once to create the admin and audit tables.

**Alternatively, via CLI:**

```bash
vercel env add OPENAI_API_KEY
vercel env add ANTHROPIC_API_KEY
vercel env add PINECONE_API_KEY
vercel env add PINECONE_INDEX_NAME
vercel env add GENERATION_MODEL
vercel env add NEON_DATABASE_URL
vercel env add ADMIN_ALLOWLIST
vercel env add EMAIL_FROM
vercel env add RESEND_API_KEY
```

---

## Step 3 — Trigger the first production deployment

**Option A — push to main (automatic)**

```bash
git push origin main
```

Vercel picks up the push and deploys automatically.

**Option B — CLI**

```bash
vercel --prod
```

Watch the build log in the Vercel dashboard. A successful build shows all routes in the output:

```
Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /admin
├ ƒ /api/admin/documents
├ ƒ /api/admin/documents/[filename]
├ ƒ /api/admin/documents/[filename]/refresh
├ ƒ /api/admin/log
├ ƒ /api/chat
├ ƒ /api/ingest
├ ƒ /api/ingest/url
└ ƒ /api/rate
```

---

## Step 4 — Post-deploy verification

Run these checks **in order** — each one isolates a different failure surface.

Replace `<deployment>.vercel.app` with your actual Vercel deployment URL throughout.

### 4a — Admin sign-in (confirms Neon, Resend, allowlist + Pinecone credentials)

Open `https://<deployment>.vercel.app/admin`, enter an allowlisted email, and sign in with the emailed code. On first sign-in you'll be asked for your name and phone. The Documents tab should then load.

| Symptom | Meaning |
|---|---|
| No email arrives | Address isn't in `ADMIN_ALLOWLIST`, or `EMAIL_FROM` isn't on a Resend-verified domain (check the Resend dashboard logs) |
| "Could not send the sign-in code" | `RESEND_API_KEY`/`EMAIL_FROM` missing, or the admin tables don't exist — run `npm run migrate-admin-auth` |
| Signed in, but documents fail to load | Pinecone credentials are wrong or missing — check `PINECONE_API_KEY` and `PINECONE_INDEX_NAME` |

### 4b — Chat endpoint (confirms GENERATION_MODEL is valid)

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hello"}]}' \
  https://<deployment>.vercel.app/api/chat
```

| Response | Meaning |
|---|---|
| `200` + `{ "reply": "...", "sources": [...], "interactionId": "..." }` | ✓ Chat endpoint working, model string valid |
| `404` or `500` | Almost certainly `GENERATION_MODEL` is unset or invalid — see Troubleshooting |

### 4c — CSP frame-ancestors header (confirms iframe embedding will work)

```bash
curl -sI https://<deployment>.vercel.app/ | grep -i content-security-policy
```

Expected output (exact spacing may vary; the origins come from `next.config.ts` and must match the site that embeds the iframe — shown here for OYSA):

```
content-security-policy: frame-ancestors 'self' https://oregonyouthsoccer.org https://www.oregonyouthsoccer.org;
```

### 4d — Logging and audit

While signed in to `/admin`, the **Query Log** and **Audit** tabs should load. Upload or delete a test document and confirm it shows up on the Audit tab with your name.
| `502` | Neon connection failed — check the connection string and that the schema migration has been run |

After a successful chat (step 4b), re-run this check to confirm an interaction row was written.

---

## Step 5 — Configure custom domain (first time only)

1. In the Vercel project, go to **Settings → Domains**.
2. Add your chat subdomain (for OYSA: `chat.oregonyouthsoccer.org`).
3. Vercel displays a CNAME record. Add it at your DNS provider:
   - **Type:** `CNAME`
   - **Name:** `chat`
   - **Value:** `cname.vercel-dns.com` (or the value Vercel shows)
4. Wait for DNS propagation (usually a few minutes, up to 48 hours).
5. Repeat the Step 4 checks against the custom domain once it is live.

---

## Troubleshooting

### Chat returns `404` or `500`

The most likely cause is an invalid `GENERATION_MODEL` value. Check Vercel function logs:

1. Vercel dashboard → project → **Functions** tab
2. Select the `/api/chat` function
3. View recent invocations — the log will show the exact error from Anthropic

A bad model string is fixed entirely in the **Vercel Environment Variables UI** — no code change required. After updating the value, trigger a redeploy:

```bash
vercel --prod --force   # no-op redeploy to pick up the new env var
```

Or push an empty commit:

```bash
git commit --allow-empty -m "chore: trigger redeploy"
git push origin main
```

Verify the correct model string at [docs.anthropic.com/en/docs/models-overview](https://docs.anthropic.com/en/docs/models-overview).

### Admin returns `401`

The session is missing or expired (30 days), or the admin's email is no longer covered by `ADMIN_ALLOWLIST`. Sign in again, or fix the allowlist and redeploy.

### Admin returns `500`

Pinecone credentials are incorrect. Verify `PINECONE_API_KEY` is the API key for the correct Pinecone project, and `PINECONE_INDEX_NAME` exactly matches the index name in that project (case-sensitive; `oysa-docs` for OYSA).

### `/api/admin/log` returns `502`

The Neon connection failed. Common causes:

- `NEON_DATABASE_URL` is set but the connection string is incorrect or from the wrong project
- The schema migration has not been run — see [docs/LOGGING_SETUP.md](docs/LOGGING_SETUP.md)
- The Neon project is on the free tier and was suspended due to inactivity — open the Neon console to wake it; it resumes within a few seconds

### Documents list is empty after enabling `NEON_DATABASE_URL`

The sources table is empty because documents were ingested before `NEON_DATABASE_URL` was configured. Run:

```bash
npm run sync-sources
```

This reads all header records from Pinecone and upserts them into the Neon `sources` table. Safe to re-run. See [docs/LOGGING_SETUP.md](docs/LOGGING_SETUP.md) for details.

### `maxDuration` limit hit on ingest

`/api/ingest` has `maxDuration = 60` (seconds). The **Hobby** tier on Vercel supports up to 60s for Functions — should be sufficient. If large documents time out, upgrade to **Pro** (300s limit) or split the document before uploading.

### Cross-region latency on Pinecone queries

If chat responses feel slow, pin the Vercel Functions to the same region as the Pinecone index (`us-east-1` → Vercel region `iad1`). Add to the relevant route files:

```ts
export const preferredRegion = "iad1";
```

This is a follow-up optimisation — not required for v1.
