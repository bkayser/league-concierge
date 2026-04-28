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
| Generation | Anthropic Claude Sonnet | claude-sonnet-4-5 |
| Vector database | Pinecone serverless | Free tier, `oysa-docs` index |
| Frontend framework | Next.js (App Router) | React, TypeScript optional |

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
│   ├── page.jsx              # Public chat widget UI
│   ├── admin/
│   │   └── page.jsx          # Password-protected document management UI
│   └── api/
│       ├── chat/
│       │   └── route.js      # POST: messages[] → retrieve → generate → reply
│       └── ingest/
│           └── route.js      # POST: file upload → chunk → embed → upsert to Pinecone
├── lib/
│   ├── clients.js            # Singleton instances: OpenAI, Anthropic, Pinecone
│   └── embed.js              # embedText(text) → float[1536] via OpenAI
├── scripts/
│   └── create-index.mjs     # One-time Pinecone index creation (run once, then archive)
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
5. Claude response streamed back to UI

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
- Metadata stored per vector: `{ filename, chunkIndex, totalChunks, text }`
- Namespace: use `production` namespace in Pinecone (allows future `staging` namespace)

## Deployment

- Production URL: `chat.oregonyouthsoccer.org` (CNAME → Vercel deployment)
- Every push to `main` triggers automatic Vercel redeploy
- Environment variables managed in Vercel dashboard (never in source)

## License

All rights reserved.