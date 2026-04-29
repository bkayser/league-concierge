import Anthropic from "@anthropic-ai/sdk";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "missing-openai-api-key",
});

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "missing-anthropic-api-key",
});

export const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY ?? "missing-pinecone-api-key",
});

export function getIndex() {
  return pinecone.index(process.env.PINECONE_INDEX_NAME ?? "oysa-docs");
}
