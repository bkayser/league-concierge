# League Concierge

A Retrieval-Augmented Generation (RAG) chatbot that lets an organization's members ask questions about its operational documents and competition rules through a chat widget embedded on the organization's website.

## About this project

League Concierge was built for the [Oregon Youth Soccer Association](https://oregonyouthsoccer.org) (OYSA), where it runs at `footy.oregonyouthsoccer.org` as "Footy," a Sasquatch mascot who answers questions from OYSA's rulebooks and policies. The code is released under the [MIT License](LICENSE). You are welcome to fork it and stand it up for your own organization, or just clone it to read and run locally. The OYSA deployment is the reference installation; this repository is not a generic product and makes no attempt to hide its origin. See [Rebranding a fork](#rebranding-a-fork) for what to change.

### Trademarks and mascot

The MIT License covers the code only. The following are **not** licensed and must be replaced in any fork:

- The OYSA name and the OYSA shield logo (`app/icon.png`, `app/favicon.ico`), which belong to the Oregon Youth Soccer Association.
- The Footy mascot: the image (`public/footy.png`) and the persona text in `lib/prompt.ts`.

### Data handling

End users are anonymous. The chat UI generates a session UUID in browser memory on page load; it is not stored in a cookie, `localStorage`, or `sessionStorage`, and it resets on refresh.

- With `NEON_DATABASE_URL` **unset** (the default), nothing about a conversation is persisted. Messages go to OpenAI (embedding of the latest question), Pinecone (retrieval), and Anthropic (generation) and are subject to those providers' data policies.
- With `NEON_DATABASE_URL` **set**, every chat turn is logged to your Postgres database: the user's message, the model's reply, the documents cited, the session UUID, and any thumbs-up/down rating with its optional comment. The admin UI exposes this log. See [docs/LOGGING_SETUP.md](docs/LOGGING_SETUP.md).

If you deploy this, post a privacy notice on the page that embeds the widget. That notice is the deployer's responsibility; it is not part of this repository.

### Security notes for deployers

- The admin UI and ingest endpoints require sign-in with an emailed one-time code. Only addresses or domains listed in `ADMIN_ALLOWLIST` can sign in. Source changes are audited per admin. See [docs/ADMIN_AUTH.md](docs/ADMIN_AUTH.md). Serve only over HTTPS.
- `/api/chat` and `/api/rate` are unauthenticated by design, and each chat call spends OpenAI and Anthropic credit. Put a rate limit in front of them (Vercel Firewall rules work) before linking from a public page.
- `/api/ingest/url` fetches an arbitrary URL supplied by the admin. It is admin-only, but keep `ADMIN_ALLOWLIST` tight accordingly.

## Architecture Overview

```
your-org.example  (oregonyouthsoccer.org for OYSA)
  └── <iframe src="https://chat.your-org.example">
        └── Next.js app (hosted on Vercel)
              ├── Public chat UI
              ├── Password-protected admin UI
              └── API routes (serverless functions)
                    ├── /api/chat     → retrieve + generate
                    └── /api/ingest   → upload + embed + store
                          ├── OpenAI text-embedding-3-small (embeddings)
                          ├── Anthropic Claude Sonnet (generation)
                          └── Pinecone serverless (vector storage)
```

## Tech Stack

| Role | Service | Notes |
|---|---|---|
| Hosting / serverless functions | Vercel | Free/Pro tier |
| Embeddings | OpenAI `text-embedding-3-small` | 1536 dimensions, cosine similarity |
| Generation | Anthropic Claude Sonnet | model string in `GENERATION_MODEL` env var |
| Vector database | Pinecone serverless | Free tier; index name from `PINECONE_INDEX_NAME` (`oysa-docs` for OYSA) |
| Frontend framework | Next.js (App Router) | React 19, TypeScript — all files `.ts`/`.tsx` |

## Key Design Decisions

- **OpenAI for embeddings only.** Embedding vectors are stored permanently in Pinecone. OpenAI's `text-embedding-3-small` is the stable long-term choice. Do not swap embedding providers without re-ingesting the entire corpus.
- **Anthropic Claude for generation only.** Claude is used exclusively for chat response synthesis. It is not used for embeddings. Claude was chosen over GPT-4o for its stronger tendency to stay within provided context and decline gracefully when the answer isn't in the documents.
- **Embedding model is fixed at `text-embedding-3-small` / 1536 dimensions.** The Pinecone index dimension is set to 1536 to match. This cannot be changed without destroying and recreating the index and re-embedding all documents.
- **CORS is avoided by using an iframe embed.** The chat UI is served from Vercel (for OYSA at `footy.oregonyouthsoccer.org` via CNAME). The parent site drops in a single `<iframe>` tag; allowed parent origins are set in `next.config.ts` via `frame-ancestors`. All fetch calls are same-origin within the iframe context.
- **Multi-turn conversation context** is maintained by sending full message history to Claude on each request. Only the latest user message is embedded for Pinecone retrieval.

## Project Structure

```
/
├── app/
│   ├── page.tsx              # Public chat widget UI
│   ├── admin/
│   │   └── page.tsx          # Password-protected document management UI
│   └── api/
│       ├── chat/
│       │   └── route.ts      # POST: messages[] → retrieve → generate → reply
│       ├── ingest/
│       │   └── route.ts      # POST: file upload → chunk → embed → upsert to Pinecone
│       └── admin/
│           └── documents/
│               ├── route.ts              # GET: list documents
│               └── [filename]/
│                   └── route.ts          # DELETE: remove document + chunks
├── lib/
│   ├── audit.ts              # auditSourceChange() — source add/update/remove log
│   ├── auth.ts               # requireAdmin(), email OTP, sessions, allowlist
│   ├── email.ts              # sendLoginCode() via Resend
│   ├── chunk.ts              # chunkText() — token-based text chunking
│   ├── clients.ts            # Singleton instances: OpenAI, Anthropic, Pinecone
│   ├── embed.ts              # embedText(text) → float[1536] via OpenAI
│   ├── extract.ts            # extractText() — PDF and DOCX text extraction
│   ├── format.ts             # formatBytes(), normalizeFilename()
│   ├── pinecone-readiness.ts # ensureIndexReady() — cached index health check
│   └── prompt.ts             # buildSystemPrompt() — Claude system prompt builder
├── scripts/
│   ├── create-index.mjs     # One-time Pinecone index creation (idempotent)
│   ├── smoke-embed.mjs      # Smoke test: OpenAI embeddings API
│   ├── smoke-pinecone.mjs   # Smoke test: Pinecone index shape
│   └── smoke-claude.mjs     # Smoke test: Anthropic API + GENERATION_MODEL validity
├── .env.local                # Local dev secrets (gitignored)
└── .cursorrules              # Cursor agent instructions
```

## Environment Variables

```bash
OPENAI_API_KEY=sk-proj-...         # OpenAI — embeddings only
ANTHROPIC_API_KEY=sk-ant-...       # Anthropic — generation only
PINECONE_API_KEY=...               # Pinecone vector DB
PINECONE_INDEX_NAME=oysa-docs      # Pinecone index name (oysa-docs is OYSA's; use your own)
GENERATION_MODEL=claude-sonnet-5-5 # Anthropic model string — verify at https://docs.anthropic.com
NEON_DATABASE_URL=postgresql://... # Required for admin; enables interaction logging
ADMIN_ALLOWLIST=pat@example.org,example.org  # Admin emails and/or whole domains
RESEND_API_KEY=re_...              # Resend sending key for the verified domain
EMAIL_FROM="Ask Footy <askfooty@bravoking.net>"  # Sender on a Resend-verified domain
```

## RAG Pipeline

### Ingest (run when documents are added/updated)

1. Admin uploads PDF or Word document via `/admin` UI
2. `/api/ingest` extracts text, splits into ~400 token chunks with overlap
3. Each chunk is embedded via OpenAI `text-embedding-3-small` → 1536-dim vector
4. Vector + chunk text + metadata (filename, chunk index) upserted to Pinecone

### Query (every user message)

1. User message received at `/api/chat` with full conversation history
2. Latest user message embedded via OpenAI → query vector
3. Pinecone queried for top 5 most similar chunks (cosine similarity)
4. Retrieved chunks + conversation history sent to Claude with system prompt
5. Claude response returned to UI with source citations

## System Prompt Constraints

The Claude system prompt must enforce:
- Answer only from provided document context
- Decline gracefully if the answer is not in the documents
- Cite the source document when possible (e.g. "According to the 2024 OYSA Competition Rules...")
- Never fabricate rules, eligibility requirements, dates, or fees

## Admin UI Requirements

The admin interface must be usable by a **non-technical administrator**. Requirements:
- Simple password authentication (no OAuth, no user accounts)
- Upload a document (PDF or Word) with a single button
- View list of currently indexed documents with upload date
- Delete a document from the index
- No terminal, no CLI, no technical knowledge required

## Embedding Strategy

- Chunk size: ~400 tokens
- Chunk overlap: ~50 tokens (to avoid cutting context at boundaries)
- Metadata stored per chunk vector: `{ filename, originalFilename, chunkIndex, totalChunks, text }`
- Metadata stored per header vector: `{ filename, originalFilename, uploadDate, fileSizeBytes, fileSizeDisplay, mimeType, totalChunks, chunkIds, uploadedBy }`
- Namespace: use `production` namespace for chunks, `headers` namespace for document metadata

## Deployment

- Production URL for OYSA: `footy.oregonyouthsoccer.org` (CNAME → Vercel deployment)
- Every push to `main` triggers automatic Vercel redeploy
- Environment variables managed in Vercel dashboard (never in source)

## Local Verification

Run all three smoke checks in sequence to confirm every external service is reachable before developing or deploying:

```bash
npm run smoke
```

This runs:
1. `smoke-embed.mjs` — calls OpenAI `text-embedding-3-small`, asserts a 1536-element array of finite floats
2. `smoke-pinecone.mjs` — calls `describeIndex`, asserts `dimension === 1536` and `metric === "cosine"`
3. `smoke-claude.mjs` — sends a minimal request to Anthropic, reads the model from `GENERATION_MODEL`, and asserts a non-empty text reply back. **Fails immediately if `GENERATION_MODEL` is unset or the model string is invalid** — this is the most common first-deploy failure.

### Manual end-to-end flow

Run once after any significant change to the ingest or chat pipeline:

1. `npm run dev` → open `http://localhost:3000/admin`, sign in with an allowlisted email (without Resend configured, the code is printed in the dev server log), upload a small known PDF
2. Open `http://localhost:3000`, ask a question whose answer is in that PDF — confirm a reply with the document cited as a source chip
3. Delete the document from `/admin`, ask the same question — confirm a graceful "I don't have information about that" response
4. *(Fresh Pinecone project only — OYSA's `oysa-docs` index is already provisioned):* `npm run create-index`

## Rebranding a fork

Branding is plain strings and three image files; there is no config layer. Everything OYSA-specific is listed here.

| File | What to change |
|---|---|
| `lib/prompt.ts` | The Footy persona paragraph, the "contact OYSA directly" fallback, and the example out-of-scope reply |
| `app/page.tsx` | Page heading, mascot `<img>` and alt text, greeting, input placeholder, footer disclaimer |
| `app/admin/page.tsx` | "OYSA Document Admin" heading (two places), CSV download filename |
| `app/layout.tsx` | `<title>` and meta description |
| `next.config.ts` | `frame-ancestors` origins: the site(s) allowed to embed the widget |
| `lib/clients.ts`, `lib/pinecone-readiness.ts`, `scripts/create-index.mjs`, `scripts/smoke-pinecone.mjs`, `scripts/sync-sources.mjs` | The `?? "oysa-docs"` fallback index name. Setting `PINECONE_INDEX_NAME` everywhere makes this moot, but change the fallbacks so a missing env var cannot point at the wrong index |
| `lib/extract.ts` | The `OYSABot/1.0` User-Agent sent when ingesting from a URL |
| `app/api/admin/log/route.ts` | CSV download filename |
| `app/icon.png`, `app/favicon.ico` | OYSA shield logo; replace with your own |
| `public/footy.png` | Mascot image; replace or remove along with the mascot references above |
| `README.md`, `DEPLOY.md`, `.cursorrules`, `docs/LOGGING_SETUP.md` | Prose that names OYSA as the example deployment |

A find across the tree for `OYSA`, `oregonyouthsoccer`, and `Footy` catches all of the above.

## License

[MIT](LICENSE). Copyright (c) 2026 William Kayser. See [Trademarks and mascot](#trademarks-and-mascot) for what the license does not cover.
