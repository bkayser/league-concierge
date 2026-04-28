# Deployment Runbook — OYSA RAG Chatbot

Step-by-step guide for deploying the application to Vercel for the first time and for verifying a successful deployment. Follow the steps in order — each one isolates a different failure surface.

---

## Prerequisites

Before starting:

- All feature PRs (Phases 1–7) are merged to `main`.
- You have a Vercel account and the project is imported or linked (see Step 1).
- You have the values for all six environment variables listed in Step 2.
- The `oysa-docs` Pinecone index is already provisioned (confirmed). If setting up a brand-new Pinecone project, run `npm run create-index` locally first.

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

Add all six variables in the Vercel project dashboard under **Settings → Environment Variables**. Set each variable for **Production**, **Preview**, and **Development** environments unless noted otherwise.

| Variable | Where to get the value |
|---|---|
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `PINECONE_API_KEY` | [app.pinecone.io](https://app.pinecone.io) → project → API Keys |
| `PINECONE_INDEX_NAME` | `oysa-docs` (the live index name) |
| `ADMIN_PASSWORD` | Choose a strong password for the admin UI |
| `GENERATION_MODEL` | Current canonical value: `claude-sonnet-4-6` — verify at [docs.anthropic.com/en/docs/models-overview](https://docs.anthropic.com/en/docs/models-overview) before setting |

> **Note on `GENERATION_MODEL`:** Anthropic returns a hard `404` for an invalid model string. If the chat endpoint returns errors immediately after deployment, this is the most likely cause. See the Troubleshooting section below.

**Alternatively, via CLI:**

```bash
vercel env add OPENAI_API_KEY
vercel env add ANTHROPIC_API_KEY
vercel env add PINECONE_API_KEY
vercel env add PINECONE_INDEX_NAME
vercel env add ADMIN_PASSWORD
vercel env add GENERATION_MODEL
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

Watch the build log in the Vercel dashboard. A successful build shows all seven routes in the output:

```
Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /admin
├ ƒ /api/admin/documents
├ ƒ /api/admin/documents/[filename]
├ ƒ /api/chat
└ ƒ /api/ingest
```

---

## Step 4 — Post-deploy verification

Run these checks **in order** — each one isolates a different failure surface.

Replace `<deployment>.vercel.app` with your actual Vercel deployment URL throughout.

### 4a — Admin endpoint (confirms ADMIN_PASSWORD + Pinecone credentials)

```bash
curl -s \
  -H "x-admin-password: <your-ADMIN_PASSWORD>" \
  https://<deployment>.vercel.app/api/admin/documents
```

| Response | Meaning |
|---|---|
| `200` + `{ "documents": [] }` or a populated array | ✓ Admin endpoint working, Pinecone credentials valid |
| `401` | `ADMIN_PASSWORD` is wrong or missing in Vercel env — check the variable name and value |
| `500` | Pinecone credentials are wrong or missing — check `PINECONE_API_KEY` and `PINECONE_INDEX_NAME` |

### 4b — Chat endpoint (confirms GENERATION_MODEL is valid)

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hello"}]}' \
  https://<deployment>.vercel.app/api/chat
```

| Response | Meaning |
|---|---|
| `200` + `{ "reply": "...", "sources": [] }` | ✓ Chat endpoint working, model string valid |
| `404` or `500` | Almost certainly `GENERATION_MODEL` is unset or invalid — see Troubleshooting |

### 4c — CSP frame-ancestors header (confirms iframe embedding will work)

```bash
curl -sI https://<deployment>.vercel.app/ | grep -i content-security-policy
```

Expected output (exact spacing may vary):

```
content-security-policy: frame-ancestors 'self' https://oregonyouthsoccer.org https://www.oregonyouthsoccer.org;
```

---

## Step 5 — Configure custom domain (first time only)

1. In the Vercel project, go to **Settings → Domains**.
2. Add `chat.oregonyouthsoccer.org`.
3. Vercel displays a CNAME record. Add it at your DNS provider:
   - **Type:** `CNAME`
   - **Name:** `chat`
   - **Value:** `cname.vercel-dns.com` (or the value Vercel shows)
4. Wait for DNS propagation (usually a few minutes, up to 48 hours).
5. Repeat the Step 4 checks using `https://chat.oregonyouthsoccer.org` once the domain is live.

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

`ADMIN_PASSWORD` in the Vercel environment does not match what you typed in the admin UI. Update the value in **Settings → Environment Variables** and redeploy.

### Admin returns `500`

Pinecone credentials are incorrect. Verify `PINECONE_API_KEY` is the API key for the correct Pinecone project, and `PINECONE_INDEX_NAME` is exactly `oysa-docs` (case-sensitive).

### `maxDuration` limit hit on ingest

`/api/ingest` has `maxDuration = 60` (seconds). The **Hobby** tier on Vercel supports up to 60s for Functions — should be sufficient. If large documents time out, upgrade to **Pro** (300s limit) or split the document before uploading.

### Cross-region latency on Pinecone queries

If chat responses feel slow, pin the Vercel Functions to the same region as the Pinecone index (`us-east-1` → Vercel region `iad1`). Add to the relevant route files:

```ts
export const preferredRegion = "iad1";
```

This is a follow-up optimisation — not required for v1.
