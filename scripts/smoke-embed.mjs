// Smoke test: verify OpenAI embeddings API is reachable and returns correct shape.
// Run: node --env-file=.env.local scripts/smoke-embed.mjs
import OpenAI from "openai";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EXPECTED_DIMENSION = 1536;

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set in .env.local");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

console.log(`Calling OpenAI embeddings API (model: ${EMBEDDING_MODEL})…`);

const response = await openai.embeddings.create({
  model: EMBEDDING_MODEL,
  input: "hello world",
});

const embedding = response.data[0].embedding;

if (!Array.isArray(embedding)) {
  throw new Error(`Expected an array, got: ${typeof embedding}`);
}
if (embedding.length !== EXPECTED_DIMENSION) {
  throw new Error(
    `Expected ${EXPECTED_DIMENSION} dimensions, got ${embedding.length}`,
  );
}
if (!embedding.every((n) => Number.isFinite(n))) {
  throw new Error("Embedding contains non-finite values (NaN or Infinity)");
}

console.log(`✓ Embedding OK — ${embedding.length} finite floats returned.`);
