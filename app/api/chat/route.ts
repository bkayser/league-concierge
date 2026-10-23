import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages";
import type { NextRequest } from "next/server";
import { after } from "next/server";

import { anthropic, getIndex } from "@/lib/clients";
import { isLoggingEnabled, logInteraction } from "@/lib/db";
import { embedText } from "@/lib/embed";
import { buildSystemPrompt } from "@/lib/prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

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

  const { messages: rawMessages, session_id: rawSessionId } =
    (body as { messages?: unknown; session_id?: unknown }) ?? {};

  if (!isValidMessages(rawMessages)) {
    return json(400, {
      error:
        'Expected { messages: [{role, content}] } with at least one message ending in a user turn.',
    });
  }

  const messages: ClientMessage[] = rawMessages;
  const latestUserMessage = messages[messages.length - 1].content;

  // Use the provided session_id or generate a fallback so every interaction
  // has a valid UUID even when called from old clients that don't send it.
  const sessionId =
    typeof rawSessionId === "string" && rawSessionId.length > 0
      ? rawSessionId
      : crypto.randomUUID();

  const startTime = Date.now();

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

  // Deduplicate by normalized filename (the unique key) so each document
  // appears at most once, preserving both names for logging and display.
  const sourceMeta = [
    ...new Map(
      results.matches
        .filter(
          (m) =>
            typeof m.metadata?.filename === "string" &&
            typeof m.metadata?.originalFilename === "string",
        )
        .map((m) => [
          m.metadata!.filename as string,
          {
            filename: m.metadata!.filename as string,
            originalFilename: m.metadata!.originalFilename as string,
            totalChunks:
              typeof m.metadata?.totalChunks === "number"
                ? (m.metadata.totalChunks as number)
                : undefined,
          },
        ]),
    ).values(),
  ];
  // Human-readable list for the response payload and UI source chips
  const sources = sourceMeta.map((s) => s.originalFilename);

  const systemPrompt = buildSystemPrompt(contextBlock);
  const interactionId = crypto.randomUUID();

  let claudeResponse: Awaited<ReturnType<typeof anthropic.messages.create>>;
  try {
    claudeResponse = await anthropic.messages.create({
      model,
      // Newer models think by default and thinking tokens count against
      // max_tokens, so leave headroom beyond the visible answer.
      max_tokens: 8000,
      // Low effort keeps thinking short for FAQ-style chat answers.
      output_config: { effort: "low" },
      system: systemPrompt,
      messages: messages as MessageParam[],
    });
  } catch (err) {
    console.error("Claude API call failed:", err);
    return json(502, {
      error: "Failed to generate a response. Please try again.",
    });
  }

  if (claudeResponse.stop_reason === "refusal") {
    console.warn("Claude declined the request:", claudeResponse.stop_details);
    return json(200, {
      reply:
        "Sorry, I can't help with that one. Try rephrasing, or contact the league office.",
      sources: [],
      interactionId,
    });
  }

  // Thinking blocks may precede the answer, so join the text blocks rather
  // than assuming content[0] is text.
  const replyText = claudeResponse.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!replyText) {
    console.error("Unexpected Claude response format:", claudeResponse.content);
    return json(500, { error: "Unexpected response format from Claude." });
  }
  if (claudeResponse.stop_reason === "max_tokens") {
    console.warn("Claude reply truncated at max_tokens");
  }

  const latencyMs = Date.now() - startTime;
  const responsePayload = { reply: replyText, sources, interactionId };

  if (isLoggingEnabled()) {
    // Use after() so Vercel keeps the function context alive until the DB
    // write completes — a bare .catch() promise is frozen when the response
    // is sent, causing the INSERT to never execute on Vercel serverless.
    after(
      logInteraction({
        id: interactionId,
        sessionId,
        prompt: latestUserMessage,
        response: replyText,
        sources: sourceMeta,
        modelVersion: model,
        chunksRetrieved: results.matches.length,
        latencyMs,
      }).catch((err) => console.error("Interaction log write failed:", err)),
    );
  }

  return json(200, responsePayload);
}
