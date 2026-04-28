// Smoke test: verify Pinecone index exists with the expected configuration.
// Run: node --env-file=.env.local scripts/smoke-pinecone.mjs
import { Pinecone } from "@pinecone-database/pinecone";

const EXPECTED_DIMENSION = 1536;
const EXPECTED_METRIC = "cosine";

if (!process.env.PINECONE_API_KEY) {
  throw new Error("PINECONE_API_KEY is not set in .env.local");
}

const indexName = process.env.PINECONE_INDEX_NAME ?? "oysa-docs";
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

console.log(`Describing Pinecone index "${indexName}"…`);

const info = await pc.describeIndex(indexName);
const { dimension, metric } = info;

if (dimension !== EXPECTED_DIMENSION) {
  throw new Error(`Expected dimension ${EXPECTED_DIMENSION}, got ${dimension}`);
}
if (metric !== EXPECTED_METRIC) {
  throw new Error(`Expected metric "${EXPECTED_METRIC}", got "${metric}"`);
}

console.log(
  `✓ Pinecone index OK — name: "${indexName}", dimension: ${dimension}, metric: ${metric}.`,
);
