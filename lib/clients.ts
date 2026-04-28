import Anthropic from "@anthropic-ai/sdk";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";

export const openai = new OpenAI();

export const anthropic = new Anthropic();

export const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY ?? "",
});

export function getIndex() {
  return pinecone.index(process.env.PINECONE_INDEX_NAME ?? "oysa-docs");
}
