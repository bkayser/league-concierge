# Interaction Logging Setup

This guide covers enabling the optional interaction logging feature, which stores chat conversations in a Neon Postgres database and adds a **Log** tab to the admin UI.

---

## What it tracks

When enabled, every chat interaction is recorded with:

- The user's prompt and Claude's response
- Which documents were cited as sources
- The model version used
- End-to-end response latency (milliseconds)
- An optional thumbs-up / thumbs-down rating from the user, with a comment field for negative ratings
- An anonymous session ID (see Privacy below)

The admin UI gains a **Log** tab that shows the 100 most recent interactions, filterable by rating status, with a CSV export for the last 30 days.

The admin **Documents** page also gains a **Times cited** column showing how many logged interactions cited each document.

---

## Privacy

The logging feature is designed to be lightweight on personal data:

- **No IP address is stored.** Only the conversation content and metadata listed above are written.
- **No persistent user identity.** The session ID is a UUID generated in the browser when the page loads. It is held in React state only — it is never written to `localStorage`, `sessionStorage`, or a cookie. It resets on every page refresh.
- **No account or authentication** is required from end users. The session ID is purely a convenience grouping for the admin log view.

---

## Prerequisites

- A [Neon](https://neon.tech) account (free tier is sufficient).
- The `NEON_DATABASE_URL` environment variable set in both `.env.local` (local development) and Vercel (deployed environments).
- The database schema applied once against the Neon project (see below).

---

## Step 1 — Create a Neon project

1. Go to [console.neon.tech](https://console.neon.tech) and sign in or create a free account.
2. Click **New Project**.
3. Give it a name (e.g. `oysa-chatbot`), choose the **AWS us-east-1** region to minimize latency with Vercel and Pinecone, and click **Create project**.
4. On the project dashboard, find the **Connection string** panel. Select the **Pooled connection** option and copy the full string — it looks like:

   ```
   postgresql://user:password@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```

   This value is your `NEON_DATABASE_URL`.

---

## Step 2 — Run the schema migration

The migration only needs to be run once. Open the **SQL Editor** in the Neon project dashboard (or connect via `psql`) and run:

```sql
-- Sources registry: authoritative document list
CREATE TABLE sources (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename          TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  upload_date       TIMESTAMPTZ NOT NULL DEFAULT now(),
  file_size_bytes   INTEGER NOT NULL,
  file_size_display TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  total_chunks      INTEGER NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT true
);

-- Interaction log
CREATE TABLE interactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID NOT NULL,
  prompt           TEXT NOT NULL,
  response         TEXT NOT NULL,
  rating           SMALLINT CHECK (rating IN (-1, 1)),
  rating_comment   TEXT,
  model_version    TEXT NOT NULL,
  chunks_retrieved SMALLINT NOT NULL,
  latency_ms       INTEGER NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ
);

-- Sources cited per interaction
CREATE TABLE interaction_sources (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id UUID NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
  source_id      UUID NOT NULL REFERENCES sources(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON sources(filename);
CREATE INDEX ON sources(is_active);
CREATE INDEX ON interactions(session_id);
CREATE INDEX ON interactions(created_at DESC);
CREATE INDEX ON interaction_sources(interaction_id);
CREATE INDEX ON interaction_sources(source_id);
```

The migration is idempotent to the extent that re-running it against an empty database produces the same result. If you need to reset, drop the three tables first.

---

## Step 3 — Add `NEON_DATABASE_URL` to your environment

### Local development

Add to `.env.local` in the project root (create the file if it doesn't exist):

```
NEON_DATABASE_URL=postgresql://user:password@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require
```

Restart the dev server after adding the variable:

```bash
npm run dev
```

### Vercel (deployed environments)

1. In the Vercel project dashboard, go to **Settings → Environment Variables**.
2. Click **Add Variable**.
3. Name: `NEON_DATABASE_URL`
4. Value: paste the pooled connection string
5. Select **Production**, **Preview**, and **Development** — all three.
6. Click **Save**.
7. Redeploy for the variable to take effect:

   ```bash
   vercel --prod --force
   ```

---

## Step 4 — Populate the sources table

The `sources` table is kept in sync automatically by the ingest and delete routes going forward. But documents that were already in Pinecone before `NEON_DATABASE_URL` was configured need a one-time backfill.

Run from the project root (requires `.env.local` to be set):

```bash
npm run sync-sources
```

This reads every header record from the Pinecone `headers` namespace and upserts it into the `sources` table. It is safe to re-run at any time — existing rows are refreshed and no data is lost.

Expected output:

```
Found 38 document(s) in Pinecone. Syncing to Neon…

  ✓ 2024 Competition Rules.pdf
  ✓ Law 11 - Offside | IFAB
  …

Done. 38 synced, 0 skipped.
```

---

## Step 5 — Verify the feature is working

### Admin documents list

Log in to the admin UI. The Documents table should list all documents with a **Times cited** column. If the table is empty, re-run `npm run sync-sources`.

### Log tab

The **Log** tab appears next to the Documents tab once logging is active. After sending a test message in the chat UI, refresh the Log tab — the interaction should appear within a few seconds.

### API-level check

```bash
curl -s \
  -H "x-admin-password: <your-ADMIN_PASSWORD>" \
  https://<deployment>.vercel.app/api/admin/log
```

A `200` response with an `interactions` array confirms the Neon connection is working. A `404` means `NEON_DATABASE_URL` is not set. A `502` means the connection string is wrong or the schema migration has not been applied.

---

## Disabling logging

Remove `NEON_DATABASE_URL` from Vercel environment variables and redeploy. The app reverts to Pinecone-only mode automatically — no code changes required. The Log tab disappears, the Documents list falls back to Pinecone, and no new interactions are recorded. Existing data in Neon is unaffected.

To re-enable, add the variable back and redeploy.

---

## Storage headroom

The Neon free tier provides **0.5 GB** of storage. At a typical volume of fewer than 100 queries per day with short text fields, this corpus generates roughly **1–2 MB per month**. The free tier provides multiple years of headroom before any action is needed.

If storage does become a concern, old interactions can be pruned directly in the Neon SQL console:

```sql
-- Delete interactions older than 1 year (cascades to interaction_sources)
DELETE FROM interactions WHERE created_at < now() - interval '1 year';
```
