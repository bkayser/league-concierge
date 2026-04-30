// Re-sync the Neon sources table from the Pinecone headers namespace.
//
// Under normal operation this script should never be necessary. The ingest
// and delete routes keep the two stores in sync automatically, and any source
// cited in chat that is missing from the Neon table is auto-registered in-band
// by logInteraction().
//
// When you DO need this script:
//   - Bootstrapping a fresh Neon database against an existing Pinecone index
//     (i.e. documents were ingested before NEON_DATABASE_URL was configured)
//   - Recovering from a Neon database loss or replacement
//   - Correcting stub rows that were auto-created with placeholder metadata
//     (file_size_bytes = 0, mime_type = 'application/octet-stream')
//
// It is safe to re-run at any time. Existing rows are refreshed via
// ON CONFLICT DO UPDATE and is_active is reset to true.
//
// Run: npm run sync-sources
import { Pinecone } from "@pinecone-database/pinecone";
import { neon } from "@neondatabase/serverless";

if (!process.env.PINECONE_API_KEY) {
  throw new Error("PINECONE_API_KEY is not set in .env.local");
}
if (!process.env.NEON_DATABASE_URL) {
  throw new Error("NEON_DATABASE_URL is not set in .env.local");
}

const indexName = process.env.PINECONE_INDEX_NAME ?? "oysa-docs";
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index(indexName);
const sql = neon(process.env.NEON_DATABASE_URL);

// 1. List all header IDs from Pinecone
const idsResponse = await index.namespace("headers").listPaginated();
const ids = (idsResponse.vectors ?? [])
  .map((v) => v.id)
  .filter((id) => typeof id === "string");

if (ids.length === 0) {
  console.log("No documents found in Pinecone headers namespace — nothing to sync.");
  process.exit(0);
}

console.log(`Found ${ids.length} document(s) in Pinecone. Syncing to Neon…\n`);

// 2. Fetch full metadata for all headers in one call
const fetched = await index.namespace("headers").fetch({ ids });
const records = Object.values(fetched.records ?? {});

let synced = 0;
let skipped = 0;

for (const record of records) {
  const m = record.metadata;
  if (typeof m?.filename !== "string" || typeof m?.originalFilename !== "string") {
    console.warn(`  ⚠ Skipping record with missing filename metadata: ${record.id}`);
    skipped++;
    continue;
  }

  // URL headers store sourceType:"url" and url but no mimeType field.
  // Derive mime_type from sourceType so URL sources are identifiable in the DB.
  const mimeType = m.sourceType === "url"
    ? "text/html"
    : (typeof m.mimeType === "string" ? m.mimeType : "application/octet-stream");
  const url = typeof m.url === "string" ? m.url : null;

  await sql`
    INSERT INTO sources
      (filename, original_filename, upload_date, file_size_bytes, file_size_display, mime_type, total_chunks, url)
    VALUES
      (
        ${m.filename},
        ${m.originalFilename},
        ${typeof m.uploadDate === "string" ? m.uploadDate : new Date().toISOString()},
        ${typeof m.fileSizeBytes === "number" ? m.fileSizeBytes : 0},
        ${typeof m.fileSizeDisplay === "string" ? m.fileSizeDisplay : "unknown"},
        ${mimeType},
        ${typeof m.totalChunks === "number" ? m.totalChunks : 0},
        ${url}
      )
    ON CONFLICT (filename) DO UPDATE SET
      original_filename = EXCLUDED.original_filename,
      upload_date       = EXCLUDED.upload_date,
      file_size_bytes   = EXCLUDED.file_size_bytes,
      file_size_display = EXCLUDED.file_size_display,
      mime_type         = EXCLUDED.mime_type,
      total_chunks      = EXCLUDED.total_chunks,
      url               = EXCLUDED.url,
      is_active         = true
  `;
  console.log(`  ✓ ${m.originalFilename}`);
  synced++;
}

console.log(`\nDone. ${synced} synced, ${skipped} skipped.`);
