# League Concierge

A retrieval-augmented chatbot that answers members' questions from an organization's own documents: rulebooks, policies, and web pages. Members use it through a chat widget embedded in the organization's website. Administrators manage the documents through a web admin page; no command line is needed after setup.

It was built for the [Oregon Youth Soccer Association](https://oregonyouthsoccer.org) (OYSA), where it runs at `footy.oregonyouthsoccer.org` as "Footy," a Sasquatch mascot. The code is MIT-licensed and you are welcome to fork it for your own organization. The OYSA branding is not licensed; see [Rebranding a fork](#rebranding-a-fork).

## Features

- **Chat widget** served from its own subdomain and embedded with an `<iframe>`. Multi-turn conversation, answers cite their source documents, and users can rate answers thumbs-up/down with an optional comment.
- **Answers come only from your documents.** If the documents don't cover a question, the bot says so and points the user to the organization.
- **Admin page** (`/admin`):
  - **Documents**: upload PDF or Word (`.docx`) files, add up to 10 web page URLs at a time, refresh a web page, delete a source, and see how often each source has been cited.
  - **Query Log**: the 100 most recent questions and answers, filterable by rating, with a 30-day CSV export.
  - **Audit**: who added, updated, or removed each source, with a full CSV export.
- **Admin sign-in** with a one-time code emailed to addresses on an allowlist. No passwords.

## How it works

```
your-org.example
  └── <iframe src="https://chat.your-org.example">
        └── Next.js app on Vercel
              ├── /          public chat UI
              ├── /admin     admin UI (emailed-code sign-in)
              └── /api/*     serverless routes
                    ├── OpenAI text-embedding-3-small   embeddings
                    ├── Pinecone serverless             vector search
                    ├── Anthropic Claude                answer generation
                    ├── Neon Postgres                   admins, sources, chat log, audit
                    └── Resend                          sign-in code email
```

**Ingest.** Text is extracted from the file or web page, split into ~400-token chunks with 50-token overlap, embedded, and stored in Pinecone. The source is registered in Neon.

**Chat.** The latest question is embedded and the 5 closest chunks are retrieved. Those chunks and the full conversation go to Claude, which answers using only that context. The reply and the documents it drew on are returned to the widget and logged.

## Services you need

| Service | Used for |
|---|---|
| [Vercel](https://vercel.com) | Hosting |
| [OpenAI](https://platform.openai.com) | Embeddings only |
| [Anthropic](https://platform.claude.com) | Answer generation (the main per-use cost) |
| [Pinecone](https://www.pinecone.io) | Vector database |
| [Neon](https://neon.tech) | Postgres |
| [Resend](https://resend.com) | Sign-in code email |

All are required for a working deployment; free tiers are enough for a small organization except OpenAI and Anthropic, which bill per use. Chat runs without Neon, but nobody can sign in to add documents.

## Getting started

[DEPLOY.md](DEPLOY.md) walks through setup end to end: accounts, database, local run, Vercel deployment, embedding the widget, and troubleshooting.

Reference:

- [docs/ADMIN_AUTH.md](docs/ADMIN_AUTH.md): admin sign-in, allowlist, audit log
- [docs/DATABASE.md](docs/DATABASE.md): Neon schema, what is logged, maintenance

## Data handling

End users are anonymous. The chat page generates a session ID in browser memory when it loads; it is not stored in a cookie or browser storage and resets on refresh.

Every chat turn is stored in your Neon database: the question, the answer, the documents cited, the session ID, response time, and any rating and comment. IP addresses are not stored. There is no switch to turn chat logging off. Questions are also sent to OpenAI (to embed the question) and Anthropic (to generate the answer), and are subject to their data policies.

For administrators, the database stores email, name, phone number, sign-in times, and the audit trail of their source changes.

The chat page links to a privacy policy at `/privacy` (`app/privacy/page.tsx`). It is written for OYSA; rewrite it for your organization, including the contact address and effective date.

## Security

- `/api/chat` and `/api/rate` are public by design, and every chat call costs OpenAI and Anthropic credit. Add a rate limit (for example a Vercel Firewall rule) before linking the widget from a public page.
- Admin routes require a signed-in admin on `ADMIN_ALLOWLIST`. The URL ingest feature fetches any URL an admin enters, so keep the allowlist tight.
- The admin page cannot be framed; the chat page can be framed only by the origins listed in `next.config.ts`.

## Development

```bash
npm install
npm run dev            # http://localhost:3000 and /admin
npm run lint
npm run build
npm run smoke          # checks OpenAI, Pinecone, and Anthropic credentials
```

Scripts read `.env.local`. Without Resend configured, sign-in codes are printed to the dev server log.

```
app/
  page.tsx                       chat widget
  admin/page.tsx, AdminLogin.tsx admin UI and sign-in screens
  api/chat, api/rate             public chat and rating
  api/ingest, api/ingest/url     file and URL ingest (admin)
  api/admin/...                  documents, log, audit, auth, profile (admin)
  privacy/page.tsx               privacy policy linked from the chat footer
lib/
  prompt.ts      system prompt and bot persona
  clients.ts     OpenAI, Anthropic, Pinecone clients and index
  embed.ts       embeddings
  chunk.ts       token chunking
  extract.ts     PDF, DOCX, and HTML text extraction
  ingest-url.ts  URL ingest pipeline
  db.ts          Neon queries
  auth.ts        sign-in codes, sessions, allowlist, requireAdmin()
  audit.ts       source audit helper
  email.ts       Resend email
scripts/
  create-index.mjs        create the Pinecone index
  migrate-admin-auth.mjs  create admin and audit tables
  sync-sources.mjs        rebuild the Neon sources table from Pinecone
  smoke-*.mjs             credential checks
```

## Rebranding a fork

Branding is plain strings and image files; there is no configuration layer.

| File | What to change |
|---|---|
| `lib/prompt.ts` | Persona, tone, and the "contact OYSA" fallback |
| `app/page.tsx` | Heading, mascot image and alt text, greeting, input placeholder, footer disclaimer |
| `app/admin/page.tsx`, `app/admin/AdminLogin.tsx` | "OYSA Document Admin" heading; CSV download filenames in `page.tsx` |
| `app/api/admin/log/route.ts`, `app/api/admin/audit/route.ts` | CSV download filenames |
| `app/privacy/page.tsx` | Whole policy: organization, domain, contact email, date, data practices |
| `app/layout.tsx` | Page title and description |
| `lib/email.ts` | "Ask Footy" in the sign-in email subject and body |
| `lib/extract.ts` | `OYSABot/1.0` user agent for URL ingest |
| `next.config.ts` | `frame-ancestors`: the sites allowed to embed the widget |
| `lib/clients.ts`, `lib/pinecone-readiness.ts`, `scripts/*.mjs` | The `"oysa-docs"` fallback index name |
| `app/icon.png`, `app/favicon.ico`, `public/footy.png` | OYSA shield logo and mascot image |

Searching for `OYSA`, `oysa`, `Oregon`, and `Footy` finds all of them.

The OYSA name and shield logo belong to the Oregon Youth Soccer Association. The Footy mascot image and persona are also not covered by the license. Replace all of them in a fork.

## License

[MIT](LICENSE). Copyright (c) 2026 William Kayser. The license covers the code only, not the OYSA or Footy branding.
