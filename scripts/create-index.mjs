// scripts/create-index.mjs
import { Pinecone } from "@pinecone-database/pinecone";

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

await pc.createIndex({
  name: "oysa-docs",
  dimension: 1536,
  metric: "cosine",
  spec: {
    serverless: {
      cloud: "aws",
      region: "us-east-1",
    },
  },
});

console.log("Index created.");