# OYSA RAG Chatbot

A Retrieval-Augmented Generation (RAG) chatbot for the Oregon Youth Soccer Association. Allows members to query operational documents and competition rules via a chat interface embedded on [oregonyouthsoccer.org](https://oregonyouthsoccer.org).

## Architecture Overview

```
oregonyouthsoccer.org
  └── <iframe src="https://chat.oregonyouthsoccer.org">
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
| Vector database | Pinecone serverless | Free tier, `oysa-docs` index |
| Frontend framework | Next.js (App Router) | React 19, TypeScript — all files `.ts`/`.tsx` |

## Key Design Decisions

- **OpenAI for embeddings only.** Embedding vectors are stored permanently in Pinecone. OpenAI's `text-embedding-3-small` is the stable long-term choice. Do not swap embedding providers without re-ingesting the entire corpus.
- **Anthropic Claude for generation only.** Claude is used exclusively for chat response synthesis. It is not used for embeddings. Claude was chosen over GPT-4o for its stronger tendency to stay within provided context and decline gracefully when the answer isn't in the documents.
- **Embedding model is fixed at `text-embedding-3-small` / 1536 dimensions.** The Pinecone index dimension is set to 1536 to match. This cannot be changed without destroying and recreating the index and re-embedding all documents.
- **CORS is avoided by using an iframe embed.** The chat UI is served from Vercel (eventually at `chat.oregonyouthsoccer.org` via CNAME). The parent site drops in a single `<iframe>` tag. All fetch calls are same-origin within the iframe context.
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
│   ├── auth.ts               # requireAdmin() — x-admin-password header check
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
PINECONE_INDEX_NAME=oysa-docs      # Pinecone index name
ADMIN_PASSWORD=...                 # Simple password for admin UI access
GENERATION_MODEL=claude-sonnet-4-6 # Anthropic model string — verify at https://docs.anthropic.com
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

- Production URL: `chat.oregonyouthsoccer.org` (CNAME → Vercel deployment)
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

1. `npm run dev` → open `http://localhost:3000/admin`, enter `ADMIN_PASSWORD`, upload a small known PDF
2. Open `http://localhost:3000`, ask a question whose answer is in that PDF — confirm a reply with the document cited as a source chip
3. Delete the document from `/admin`, ask the same question — confirm a graceful "I don't have information about that" response
4. *(Fresh Pinecone project only — the existing `oysa-docs` index is already provisioned):* `npm run create-index`

## License

All rights reserved.
