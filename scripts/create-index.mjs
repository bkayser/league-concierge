// One-time Pinecone index creation. Safe to re-run — handles ALREADY_EXISTS gracefully.
// Run: node --env-file=.env.local scripts/create-index.mjs
import { Pinecone } from "@pinecone-database/pinecone";

if (!process.env.PINECONE_API_KEY) {
  throw new Error("PINECONE_API_KEY is not set in .env.local");
}

const indexName = process.env.PINECONE_INDEX_NAME ?? "oysa-docs";
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

console.log(`Creating Pinecone index "${indexName}"…`);

try {
  await pc.createIndex({
    name: indexName,
    dimension: 1536,
    metric: "cosine",
    spec: {
      serverless: {
        cloud: "aws",
        region: "us-east-1",
      },
    },
  });
  console.log(`✓ Index "${indexName}" created.`);
} catch (err) {
  // Pinecone throws when the index already exists — treat as success.
  if (err?.message?.includes("ALREADY_EXISTS") || err?.status === 409) {
    console.log(`✓ Index "${indexName}" already exists — nothing to do.`);
  } else {
    throw err;
  }
}
