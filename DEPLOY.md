# Setup and Deployment

Do the steps in order. Steps 1–5 get the app running locally against real services; steps 6–9 put it on Vercel and embed it in your site.

## 1. Accounts and keys

| Variable | Where to get it |
|---|---|
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `ANTHROPIC_API_KEY` | [platform.claude.com](https://platform.claude.com) → API Keys |
| `GENERATION_MODEL` | A Claude model ID, e.g. `claude-sonnet-5-5`. See the [models overview](https://platform.claude.com/docs/en/models/overview). |
| `PINECONE_API_KEY` | [app.pinecone.io](https://app.pinecone.io) → your project → API Keys |
| `PINECONE_INDEX_NAME` | A name you choose, e.g. `acme-docs`. Step 3 creates it. |
| `NEON_DATABASE_URL` | Step 4 |
| `ADMIN_ALLOWLIST` | Comma-separated admin emails and/or domains, e.g. `pat@example.org,example.org`. See [docs/ADMIN_AUTH.md](docs/ADMIN_AUTH.md). |
| `RESEND_API_KEY`, `EMAIL_FROM` | Step 5. Optional for local development. |

## 2. Install and configure

```bash
git clone <your fork>
cd league-concierge
npm install
```

Create `.env.local` in the project root (it is gitignored):

```bash
OPENAI_API_KEY=sk-proj-...
ANTHROPIC_API_KEY=sk-ant-...
GENERATION_MODEL=claude-sonnet-5-5
PINECONE_API_KEY=...
PINECONE_INDEX_NAME=acme-docs
NEON_DATABASE_URL=postgresql://...
ADMIN_ALLOWLIST=you@example.org
RESEND_API_KEY=re_...
EMAIL_FROM="Acme Concierge <concierge@mail.example.org>"
```

## 3. Create the Pinecone index

```bash
npm run create-index
```

Creates a serverless index (AWS `us-east-1`, 1536 dimensions, cosine) named `PINECONE_INDEX_NAME`. Safe to re-run.

## 4. Create the Neon database

1. In the [Neon console](https://console.neon.tech), create a project in **AWS us-east-1**.
2. Copy the **pooled** connection string into `NEON_DATABASE_URL`.
3. Open the Neon **SQL Editor** and run the schema in [docs/DATABASE.md](docs/DATABASE.md#schema).
4. Create the admin and audit tables:

   ```bash
   npm run migrate-admin-auth
   ```

## 5. Set up email (Resend)

Skip this for local development; codes are printed to the dev server log instead.

1. In [Resend](https://resend.com/domains), add and verify a sending domain (region `us-east-1`).
2. Create an API key with **Sending access**, restricted to that domain.
3. Set `RESEND_API_KEY`, and set `EMAIL_FROM` to an address on that domain.

## 6. Verify locally

```bash
npm run smoke
npm run dev
```

`smoke` checks the OpenAI, Pinecone, and Anthropic credentials and the `GENERATION_MODEL` value. Then:

1. Open `http://localhost:3000/admin`, sign in with an allowlisted email, and fill in your name and phone.
2. Upload a small PDF.
3. Open `http://localhost:3000` and ask a question the PDF answers. The reply should cite it.
4. Check that the question appears on the admin **Query Log** tab and the upload on the **Audit** tab.

## 7. Deploy to Vercel

1. At [vercel.com/new](https://vercel.com/new), import your fork. Keep the Next.js preset. Don't deploy yet.
2. Under **Settings → Environment Variables**, add every variable from `.env.local` for Production and Preview. In production `RESEND_API_KEY` and `EMAIL_FROM` are required.
3. Deploy. After that, every push to `main` redeploys. Environment variable changes take effect on the next deployment.

Repeat the checks in step 6 against `https://<project>.vercel.app`. The chat API can also be checked directly:

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hello"}]}' \
  https://<project>.vercel.app/api/chat
```

Expect `200` with `{ "reply": ..., "sources": [...], "interactionId": ... }`.

## 8. Custom domain and embedding

1. In Vercel, **Settings → Domains**, add a subdomain such as `chat.example.org` and create the CNAME record it shows at your DNS provider.
2. In `next.config.ts`, set `frame-ancestors` to the origins of the site that will embed the widget, and deploy.
3. On your site, add:

   ```html
   <iframe src="https://chat.example.org" title="Ask our assistant"
           style="width:100%; height:700px; border:0"></iframe>
   ```

Confirm the header:

```bash
curl -sI https://chat.example.org/ | grep -i content-security-policy
```

## 9. Rate limiting

`/api/chat` is public and each call costs money. Before linking it from a public page, add a rate-limit rule for `/api/chat` and `/api/rate` under **Firewall** in the Vercel project.

## Troubleshooting

### Chat

| Response from `/api/chat` | Cause |
|---|---|
| `500` "GENERATION_MODEL environment variable is not set" | Set it and redeploy. |
| `502` "Failed to generate a response" | Anthropic rejected the call: bad `GENERATION_MODEL` or `ANTHROPIC_API_KEY`. The function log has Anthropic's error. |
| `502` "Failed to process your message" | OpenAI embedding failed: check `OPENAI_API_KEY`. |
| `500` with no message | Usually Pinecone: check `PINECONE_API_KEY` and `PINECONE_INDEX_NAME`. |

Function logs are in the Vercel dashboard under **Logs**, filtered to the route.

### Admin

| Symptom | Cause |
|---|---|
| No email arrives | The address isn't covered by `ADMIN_ALLOWLIST` (the page doesn't say so, by design), or `EMAIL_FROM` isn't on a verified Resend domain. Check Resend's logs. |
| "Could not send the sign-in code" | `RESEND_API_KEY` or `EMAIL_FROM` missing in production, or the admin tables don't exist (`npm run migrate-admin-auth`). |
| `500` "NEON_DATABASE_URL is required" | Set `NEON_DATABASE_URL`. |
| `502` "Database unavailable" | Neon connection string is wrong, the schema hasn't been applied, or a free-tier Neon project is suspended (open the console to wake it). |
| `401` | Session expired (30 days) or the email was removed from the allowlist. Sign in again. |
| Upload returns `503` "Vector index not ready" | The index named by `PINECONE_INDEX_NAME` doesn't exist in that Pinecone project. |
| Upload of a large document times out | Ingest routes have `maxDuration = 60`. Raise it in the route file (the Vercel plan limit is higher) or split the document. |
| Documents list empty but Pinecone has content | The Neon `sources` table is out of sync. Run `npm run sync-sources`. |
