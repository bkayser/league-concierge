# Database (Neon Postgres)

Neon holds everything except the document vectors, which live in Pinecone:

| Table | Contents |
|---|---|
| `sources` | One row per document or web page; drives the admin Documents list |
| `interactions` | Every chat question and answer, with rating and latency |
| `interaction_sources` | Which sources each answer cited |
| `admin_users`, `admin_otps`, `admin_sessions` | Admin sign-in ([ADMIN_AUTH.md](ADMIN_AUTH.md)) |
| `source_audit` | Source change history |

`NEON_DATABASE_URL` must be the **pooled** connection string. Use the AWS `us-east-1` region, the same as Pinecone and Vercel's default.

## Schema

Two steps, both safe to re-run.

**1. Sources and chat log.** Run in the Neon SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS sources (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename          TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  upload_date       TIMESTAMPTZ NOT NULL DEFAULT now(),
  file_size_bytes   INTEGER NOT NULL,
  file_size_display TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  total_chunks      INTEGER NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  url               TEXT
);

CREATE TABLE IF NOT EXISTS interactions (
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

CREATE TABLE IF NOT EXISTS interaction_sources (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id UUID NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
  source_id      UUID NOT NULL REFERENCES sources(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sources_is_active_idx ON sources(is_active);
CREATE INDEX IF NOT EXISTS interactions_session_id_idx ON interactions(session_id);
CREATE INDEX IF NOT EXISTS interactions_created_at_idx ON interactions(created_at DESC);
CREATE INDEX IF NOT EXISTS interaction_sources_interaction_id_idx ON interaction_sources(interaction_id);
CREATE INDEX IF NOT EXISTS interaction_sources_source_id_idx ON interaction_sources(source_id);
```

**2. Admin and audit tables:**

```bash
npm run migrate-admin-auth
```

## What is logged

Each chat turn records the question, the answer, the cited sources, the model ID, the number of chunks retrieved, the response time, and the browser session ID. Ratings and comments are added when the user clicks thumbs-up or thumbs-down. IP addresses are not stored. The session ID lives only in page memory and resets on refresh.

Logging is always on when `NEON_DATABASE_URL` is set, and admin sign-in requires it, so logging can't be turned off separately.

## Maintenance

**Rebuilding `sources` from Pinecone.** The ingest and delete routes keep `sources` in sync. If the database is replaced, or documents were ingested before Neon was configured, run:

```bash
npm run sync-sources
```

It reads every document header from Pinecone and upserts it into `sources`. Safe to re-run.

**Pruning old chat history.** The Neon free tier is 0.5 GB, which a small organization will take years to fill. To prune:

```sql
DELETE FROM interactions WHERE created_at < now() - interval '1 year';
```

Deleting a source keeps its row with `is_active = false`, so past log entries still show what they cited (marked "deleted").
