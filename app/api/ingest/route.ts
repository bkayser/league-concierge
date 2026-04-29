import pLimit from "p-limit";
import type { NextRequest } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { chunkText } from "@/lib/chunk";
import { getIndex } from "@/lib/clients";
import { isLoggingEnabled, upsertSource } from "@/lib/db";
import { embedText } from "@/lib/embed";
import { extractText, SUPPORTED_MIME_TYPES } from "@/lib/extract";
import { formatBytes, normalizeFilename } from "@/lib/format";
import {
  ensureIndexReady,
  IndexNotReadyError,
} from "@/lib/pinecone-readiness";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_SIZE = 100;
const CHUNK_IDS_SIZE_LIMIT = 35_000;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    await ensureIndexReady();
  } catch (err) {
    if (err instanceof IndexNotReadyError) {
      return json(503, { error: err.message });
    }
    throw err;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json(400, { error: "Invalid form data." });
  }

  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof File)) {
    return json(400, {
      error: 'No file uploaded. Expected a field named "file".',
    });
  }

  const file = fileEntry;
  const originalFilename = file.name;
  const filename = normalizeFilename(file.name);
  const mimeType = file.type;

  if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
    return json(415, {
      error: `Unsupported file type: "${mimeType}". Please upload a PDF or .docx file.`,
    });
  }

  const arrayBuffer = await file.arrayBuffer();

  let rawText: string;
  try {
    rawText = await extractText(arrayBuffer, mimeType);
  } catch (err) {
    console.error("Text extraction failed:", err);
    return json(422, {
      error: "Failed to extract text from the uploaded file.",
    });
  }

  if (rawText.trim().length < 100) {
    return json(422, {
      error:
        "This PDF appears to be a scanned image and cannot be read. Please upload a text-based PDF.",
    });
  }

  const chunks = chunkText(rawText);
  if (chunks.length === 0) {
    return json(422, { error: "No text content found in the uploaded file." });
  }

  const chunkIds = chunks.map((_, i) => `${filename}::chunk::${i}`);
  if (JSON.stringify(chunkIds).length >= CHUNK_IDS_SIZE_LIMIT) {
    return json(413, {
      error:
        "This document has too many chunks to track in a single header record. Please split it into smaller files.",
    });
  }

  const limit = pLimit(5);
  let embeddings: number[][];
  try {
    embeddings = await Promise.all(
      chunks.map((chunk) => limit(() => embedText(chunk)))
    );
  } catch (err) {
    console.error("Embedding failed:", err);
    return json(502, {
      error: "Failed to embed document chunks. Please try again.",
    });
  }

  const index = getIndex();
  const headerId = `header::${filename}`;

  // ID-based delete-then-insert for re-upload: handles older records that
  // pre-date the chunkIds field, or corrupt metadata, without aborting.
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
    } else {
      console.error(
        "Header found for filename but chunkIds is empty or missing — skipping production namespace delete"
      );
    }
    await index.namespace("headers").deleteOne({ id: headerId });
  }

  // Upsert chunk records in batches of 100
  const chunkRecords = chunks.map((text, i) => ({
    id: chunkIds[i],
    values: embeddings[i],
    metadata: {
      type: "chunk",
      filename,
      originalFilename,
      chunkIndex: i,
      totalChunks: chunks.length,
      text,
    },
  }));

  for (let i = 0; i < chunkRecords.length; i += BATCH_SIZE) {
    await index
      .namespace("production")
      .upsert({ records: chunkRecords.slice(i, i + BATCH_SIZE) });
  }

  // Upsert header record (vector = first chunk's embedding)
  await index.namespace("headers").upsert({
    records: [
      {
        id: headerId,
        values: embeddings[0],
        metadata: {
          type: "header",
          filename,
          originalFilename,
          uploadDate: new Date().toISOString(),
          fileSizeBytes: file.size,
          fileSizeDisplay: formatBytes(file.size),
          mimeType,
          totalChunks: chunks.length,
          chunkIds,
          uploadedBy: "admin",
        },
      },
    ],
  });

  if (isLoggingEnabled()) {
    upsertSource({
      filename,
      originalFilename,
      uploadDate: new Date().toISOString(),
      fileSizeBytes: file.size,
      fileSizeDisplay: formatBytes(file.size),
      mimeType,
      totalChunks: chunks.length,
    }).catch((err) => console.error("Source registry sync failed:", err));
  }

  return json(200, { ok: true, filename, originalFilename, totalChunks: chunks.length });
}
