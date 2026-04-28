import { decode, encode } from "gpt-tokenizer";

export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
}

const DEFAULT_CHUNK_SIZE = 400;
const DEFAULT_OVERLAP = 50;

export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = opts.overlap ?? DEFAULT_OVERLAP;

  if (chunkSize <= 0) {
    throw new Error("chunkSize must be a positive integer");
  }
  if (overlap < 0 || overlap >= chunkSize) {
    throw new Error("overlap must satisfy 0 <= overlap < chunkSize");
  }

  const tokens = encode(text);
  if (tokens.length === 0) return [];

  const chunks: string[] = [];
  const stride = chunkSize - overlap;

  for (let start = 0; start < tokens.length; start += stride) {
    const end = Math.min(start + chunkSize, tokens.length);
    chunks.push(decode(tokens.slice(start, end)));
    if (end >= tokens.length) break;
  }

  return chunks;
}
