import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages";
import type { NextRequest } from "next/server";

import { anthropic, getIndex } from "@/lib/clients";
import { embedText } from "@/lib/embed";
import { buildSystemPrompt } from "@/lib/prompt";

export const runtime = "nodejs";
export const maxDuration = 30;

const TOP_K = 5;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface ClientMessage {
  role: "user" | "assistant";
  content: string;
}

function isValidMessages(value: unknown): value is ClientMessage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (m) =>
        m !== null &&
        typeof m === "object" &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    ) &&
    value[value.length - 1].role === "user"
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  const model = process.env.GENERATION_MODEL;
  if (!model) {
    return json(500, {
      error:
        "GENERATION_MODEL environment variable is not set. Check server configuration.",
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const { messages: rawMessages } =
    (body as { messages?: unknown }) ?? {};

  if (!isValidMessages(rawMessages)) {
    return json(400, {
      error:
        'Expected { messages: [{role, content}] } with at least one message ending in a user turn.',
    });
  }

  const messages: ClientMessage[] = rawMessages;
  const latestUserMessage = messages[messages.length - 1].content;

  // Embed only the latest user message for retrieval (not the full history)
  let queryVector: number[];
  try {
    queryVector = await embedText(latestUserMessage);
  } catch (err) {
    console.error("Embedding failed:", err);
    return json(502, { error: "Failed to process your message. Please try again." });
  }

  // Retrieve top-5 most relevant chunks from the production namespace
  const results = await getIndex().namespace("production").query({
    vector: queryVector,
    topK: TOP_K,
    includeMetadata: true,
  });

  // Build context block for the system prompt from retrieved chunks
  const contextBlock = results.matches
    .map((match) => {
      const filename = match.metadata?.originalFilename ?? match.metadata?.filename ?? "Unknown document";
      const text = match.metadata?.text ?? "";
      return `[Source: ${filename}]\n${text}`;
    })
    .join("\n\n---\n\n");

  // Deduplicate source filenames using originalFilename for human-readable citations
  const sources = [
    ...new Set(
      results.matches
        .map((m) => m.metadata?.originalFilename)
        .filter((v): v is string => typeof v === "string")
    ),
  ];

  const systemPrompt = buildSystemPrompt(contextBlock);

  let claudeResponse: Awaited<ReturnType<typeof anthropic.messages.create>>;
  try {
    claudeResponse = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages as MessageParam[],
    });
  } catch (err) {
    console.error("Claude API call failed:", err);
    return json(502, {
      error: "Failed to generate a response. Please try again.",
    });
  }

  const firstBlock = claudeResponse.content[0];
  if (!firstBlock || firstBlock.type !== "text") {
    console.error("Unexpected Claude response format:", claudeResponse.content);
    return json(500, { error: "Unexpected response format from Claude." });
  }

  return json(200, { reply: firstBlock.text, sources });
}
