// One-time sync of Pinecone headers → Neon sources table.
// Safe to re-run: existing rows are refreshed via ON CONFLICT DO UPDATE,
// which also corrects any stub rows created by the auto-register path.
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

  await sql`
    INSERT INTO sources
      (filename, original_filename, upload_date, file_size_bytes, file_size_display, mime_type, total_chunks)
    VALUES
      (
        ${m.filename},
        ${m.originalFilename},
        ${typeof m.uploadDate === "string" ? m.uploadDate : new Date().toISOString()},
        ${typeof m.fileSizeBytes === "number" ? m.fileSizeBytes : 0},
        ${typeof m.fileSizeDisplay === "string" ? m.fileSizeDisplay : "unknown"},
        ${typeof m.mimeType === "string" ? m.mimeType : "application/octet-stream"},
        ${typeof m.totalChunks === "number" ? m.totalChunks : 0}
      )
    ON CONFLICT (filename) DO UPDATE SET
      original_filename = EXCLUDED.original_filename,
      upload_date       = EXCLUDED.upload_date,
      file_size_bytes   = EXCLUDED.file_size_bytes,
      file_size_display = EXCLUDED.file_size_display,
      mime_type         = EXCLUDED.mime_type,
      total_chunks      = EXCLUDED.total_chunks,
      is_active         = true
  `;
  console.log(`  ✓ ${m.originalFilename}`);
  synced++;
}

console.log(`\nDone. ${synced} synced, ${skipped} skipped.`);
