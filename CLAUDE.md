@AGENTS.md

# League Concierge

RAG chatbot that answers an organization's members from its own documents, embedded on the organization's website via iframe. Next.js 16 (App Router) on Vercel; OpenAI embeddings, Pinecone vectors, Anthropic Claude generation, Neon Postgres, Resend email. Built for OYSA (Oregon Youth Soccer Association); forks rebrand it for other organizations.

Human-facing docs: [README.md](README.md) (overview, rebranding), [DEPLOY.md](DEPLOY.md) (setup runbook), [docs/ADMIN_AUTH.md](docs/ADMIN_AUTH.md), [docs/DATABASE.md](docs/DATABASE.md). Read DEPLOY.md before helping with setup.

## Setting up a fork for a new organization

Gather these from the user before editing anything:

- Organization name, and the bot's name and persona (or "no persona")
- Website origin(s) that will embed the widget (for `frame-ancestors`)
- Chat subdomain (e.g. `chat.example.org`)
- Admin emails or domains for `ADMIN_ALLOWLIST`
- Pinecone index name (never reuse `oysa-docs`)
- Logo/icon and mascot image, or whether to drop the mascot

Then:

1. **Rebrand.** Work through the table in README "Rebranding a fork". Finish with `git grep -niE 'oysa|oregon|footy|sasquatch|askfooty'` and resolve every hit outside the README's attribution. Replace or remove `app/icon.png`, `app/favicon.ico`, and `public/footy.png`; OYSA's marks are not licensed. Change the `"oysa-docs"` fallbacks too, so a missing env var can't point at the wrong index.
2. **Rewrite `lib/prompt.ts`** for the new organization. Keep the rules: answer only from context, never invent rules, fees, dates, or eligibility, cite the source document, and direct unanswerable questions to the organization.
3. **Provision.** The user creates accounts and puts keys in `.env.local` themselves (DEPLOY.md steps 1–2). Then run `npm run create-index`, have the user apply the SQL in docs/DATABASE.md in the Neon SQL Editor (or apply it with `psql` if available), run `npm run migrate-admin-auth`, and run `npm run smoke`.
4. **Verify locally** with the flow in DEPLOY.md step 6. Without Resend configured, the sign-in code appears in the dev server log.
5. **Deploy.** The user imports the repo in Vercel and sets env vars; you can guide them or use the Vercel CLI/MCP if it's linked. Remind them to add a firewall rate limit on `/api/chat` (DEPLOY.md step 9) that `app/privacy/page.tsx` is rewritten for the new organization, and that `PRIVACY_CONTACT_EMAIL` is set in Vercel.

Documents are added through the `/admin` UI, not by scripts.

Steps that only the user can do: creating accounts and API keys, DNS records (Resend domain verification, chat CNAME), and pasting secrets. Never ask for secret values in chat, never print `.env.local`, never commit it (`.env*` is gitignored; `.worktreeinclude` copies it into Claude Code worktrees).

## Commands

```bash
npm run dev                 # localhost:3000, /admin
npm run lint
npm run build               # type-checks; run before declaring work done
npm run smoke               # live checks: OpenAI, Pinecone index shape, GENERATION_MODEL
npm run create-index        # idempotent
npm run migrate-admin-auth  # idempotent
npm run sync-sources        # rebuild Neon `sources` from Pinecone headers
```

Scripts read `.env.local` via `node --env-file`. There is no test suite; verify with lint, build, smoke, and the manual flow in DEPLOY.md step 6.

`next dev` has run away to over 100 GB of memory in this repo before, crashing the machine. Run it in the background, watch its memory, and kill it if it passes a few GB.

## Architecture invariants

### Embeddings and Pinecone

- Embedding model is `text-embedding-3-small`, 1536 dimensions, cosine, in `lib/embed.ts`. Changing it means creating a new index and re-ingesting every source. Don't change it without saying so explicitly.
- Two namespaces, never mixed:
  - `production`: one record per chunk, ID `{filename}::chunk::{i}`. Chat queries only this namespace.
  - `headers`: one record per source, ID `header::{filename}`. Its vector is chunk 0's embedding (Pinecone requires one). Its `chunkIds` metadata is the authority for which chunks to delete.
- Delete by ID only: read `chunkIds` from the header, `deleteMany({ ids })` in `production`, then delete the header. Metadata-filter deletes aren't available on serverless Starter indexes. Orphaned chunks remain retrievable by chat.
- Re-ingesting a source deletes its old chunks and header first, then upserts in batches of 100.
- Ingest rejects a source whose `chunkIds` JSON is 35,000 characters or more (Pinecone's metadata limit is 40 KB).
- Chunking is 400 tokens with 50 overlap (`lib/chunk.ts`, `gpt-tokenizer`). Extracted text under 100 characters is rejected (scanned PDFs).
- `listPaginated()` is called once with no pagination loop (`sync-sources.mjs`, the documents route fallback). That assumes fewer than 100 sources; add pagination if a corpus outgrows that.

### Source naming

- `filename` is the normalized key: `normalizeFilename()` for files, `normalizeUrl()` (`url--…`) for web pages. It's used in Pinecone IDs, URL path segments, and as the unique key in Neon `sources`.
- `originalFilename` is display only: the uploaded name, or the page title for URLs. It's shown on source chips and in admin.
- URL sources also carry `sourceType: "url"` and `url` in Pinecone metadata, and `mime_type = 'text/html'` in Neon.
- File ingest (`app/api/ingest/route.ts`) and URL ingest (`lib/ingest-url.ts`) duplicate the pipeline. Change both together.

### Chat (`app/api/chat/route.ts`)

- Request is `{ messages: [{role, content}], session_id }`. Embed only the latest user message; send the full history to Claude. Retrieved chunks go in the system prompt (`lib/prompt.ts`), not in the messages.
- Top 5 chunks. Responses aren't streamed.
- Claude call: model from `GENERATION_MODEL`, `max_tokens: 8000`, `output_config: { effort: "low" }`. Thinking tokens count against `max_tokens`, and thinking blocks can precede text, so join all `text` blocks and never assume `content[0]`. Handle `stop_reason === "refusal"`. `scripts/smoke-claude.mjs` mirrors these parameters; keep it in step. Check current Anthropic docs (or the `claude-api` skill) before changing the call.
- Do post-response work with `after()` from `next/server`. A bare un-awaited promise can be frozen when the response is sent on Vercel. Writes the admin UI reads back immediately (`sources` upserts and soft-deletes) must be awaited instead, since the page refetches the list as soon as the response arrives.

### Neon, auth, and audit

- `isLoggingEnabled()` only means `NEON_DATABASE_URL` is set. Admin sign-in requires Neon, so in practice it's always true for a working deployment, and the Pinecone fallback in `GET /api/admin/documents` is effectively dead.
- Neon `sources` is the registry the admin list reads. Pinecone holds the content. Mutations write Pinecone first, then the audit log, then upsert or soft-delete in `sources`. Deletion sets `is_active = false` so log history keeps its citations.
- Every admin and ingest route starts with `const auth = await requireAdmin(request); if (auth.error) return auth.error;`. Use `{ allowIncompleteProfile: true }` only for profile routes. Call `auditSourceChange(auth.admin, …)` after any source add, update, or remove.
- Auth is hand-rolled (`lib/auth.ts`): emailed OTP, hashed codes and session tokens, allowlist re-checked every request. Don't add an auth library.
- Neon tagged-template queries can't be composed from fragments. Write each variant out in full (see `getLog` in `lib/db.ts`).
- There's no migration framework. `sources`/`interactions`/`interaction_sources` DDL lives only in docs/DATABASE.md. Admin tables live in `scripts/migrate-admin-auth.mjs`. Schema changes must be idempotent (`IF NOT EXISTS`) and update both places.

### Embedding and HTTP

- The widget is iframed. `next.config.ts` sets `frame-ancestors` on `/` and `'none'` on `/admin`. Don't add CORS headers or a script-tag embed.
- The chat session ID lives in React state only. Don't persist chat in cookies or browser storage unless asked.
- Chat and ingest routes set `runtime = "nodejs"` and `maxDuration = 60`.

## Conventions

- TypeScript throughout; import with `@/lib/...`. Use the shared clients and `getIndex()` from `lib/clients.ts` and `embedText()` from `lib/embed.ts`. Never construct SDK clients in routes.
- Route handlers return JSON with a local `json(status, body)` helper and user-readable `error` strings, since the admin is non-technical.
- `console.error` for caught failures; no debug logging in request paths.
- No RAG frameworks (LangChain etc.). Check `lib/` before adding a dependency.
- New env var: add it to DEPLOY.md steps 1–2, and to docs/ADMIN_AUTH.md if it's auth-related.
- When behavior changes, update the affected doc in the same change. Docs are for someone deciding whether to deploy this: concise and current, with no history or design justification.
