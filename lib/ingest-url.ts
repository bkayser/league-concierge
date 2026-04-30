import pLimit from "p-limit";

import { chunkText } from "@/lib/chunk";
import { getIndex } from "@/lib/clients";
import { isLoggingEnabled, upsertSource } from "@/lib/db";
import { embedText } from "@/lib/embed";
import { extractFromUrl } from "@/lib/extract";
import { formatBytes, normalizeUrl } from "@/lib/format";

const BATCH_SIZE = 100;
const CHUNK_IDS_SIZE_LIMIT = 35_000;

export interface UrlIngestResult {
  filename: string;
  url: string;
  pageTitle: string;
  totalChunks: number;
}

export class UrlIngestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "UrlIngestError";
  }
}

export async function ingestUrl(url: string): Promise<UrlIngestResult> {
  let text: string;
  let pageTitle: string;
  try {
    ({ text, title: pageTitle } = await extractFromUrl(url));
  } catch (err) {
    throw new UrlIngestError(
      `Failed to fetch or parse the URL: ${err instanceof Error ? err.message : String(err)}`,
      422,
    );
  }

  if (text.trim().length < 100) {
    throw new UrlIngestError(
      "The page does not contain enough readable text to index.",
      422,
    );
  }

  const filename = normalizeUrl(url);
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new UrlIngestError("No text content found on the page.", 422);
  }

  const chunkIds = chunks.map((_, i) => `${filename}::chunk::${i}`);
  if (JSON.stringify(chunkIds).length >= CHUNK_IDS_SIZE_LIMIT) {
    throw new UrlIngestError(
      "This page has too many chunks. Try using a more specific URL.",
      413,
    );
  }

  const limit = pLimit(5);
  let embeddings: number[][];
  try {
    embeddings = await Promise.all(
      chunks.map((chunk) => limit(() => embedText(chunk))),
    );
  } catch (err) {
    console.error("Embedding failed:", err);
    throw new UrlIngestError(
      "Failed to embed page content. Please try again.",
      502,
    );
  }

  const index = getIndex();
  const headerId = `header::${filename}`;

  // Delete any existing records for this URL before upserting fresh ones
  const existingFetch = await index
    .namespace("headers")
    .fetch({ ids: [headerId] });
  const existingHeader = existingFetch.records[headerId];
  if (existingHeader) {
    const existingChunkIds =
      (existingHeader.metadata?.chunkIds as string[] | undefined) ?? [];
    if (existingChunkIds.length > 0) {
      await index
        .namespace("production")
        .deleteMany({ ids: existingChunkIds });
    }
    await index.namespace("headers").deleteOne({ id: headerId });
  }

  const chunkRecords = chunks.map((chunkContent, i) => ({
    id: chunkIds[i],
    values: embeddings[i],
    metadata: {
      type: "chunk",
      filename,
      originalFilename: pageTitle,
      sourceType: "url",
      url,
      chunkIndex: i,
      totalChunks: chunks.length,
      text: chunkContent,
    },
  }));

  for (let i = 0; i < chunkRecords.length; i += BATCH_SIZE) {
    await index
      .namespace("production")
      .upsert({ records: chunkRecords.slice(i, i + BATCH_SIZE) });
  }

  await index.namespace("headers").upsert({
    records: [
      {
        id: headerId,
        values: embeddings[0],
        metadata: {
          type: "header",
          filename,
          originalFilename: pageTitle,
          sourceType: "url",
          url,
          pageTitle,
          uploadDate: new Date().toISOString(),
          totalChunks: chunks.length,
          chunkIds,
          uploadedBy: "admin",
        },
      },
    ],
  });

  if (isLoggingEnabled()) {
    const fileSizeBytes = Buffer.byteLength(text, "utf8");
    upsertSource({
      filename,
      originalFilename: pageTitle,
      uploadDate: new Date().toISOString(),
      fileSizeBytes,
      fileSizeDisplay: formatBytes(fileSizeBytes),
      mimeType: "text/html",
      totalChunks: chunks.length,
      url,
    }).catch((err) => console.error("Source registry sync failed:", err));
  }

  return { filename, url, pageTitle, totalChunks: chunks.length };
}
