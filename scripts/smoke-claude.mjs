// Smoke test: verify Anthropic API is reachable and GENERATION_MODEL is valid.
// Run: node --env-file=.env.local scripts/smoke-claude.mjs
//
// This check surfaces a typo'd or stale model string immediately, before
// the chat route hits a hard error from Anthropic in dev or production.
import Anthropic from "@anthropic-ai/sdk";

const model = process.env.GENERATION_MODEL;
if (!model) {
  throw new Error(
    "GENERATION_MODEL is not set in .env.local. " +
      "Set it to the canonical model string from https://docs.anthropic.com",
  );
}

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set in .env.local");
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

console.log(`Calling Anthropic API (model: ${model})…`);

const response = await anthropic.messages.create({
  model,
  // Thinking tokens count against max_tokens on newer models.
  max_tokens: 2000,
  output_config: { effort: "low" },
  system: "You are a helpful assistant. Reply very briefly.",
  messages: [{ role: "user", content: 'Say "smoke test OK" and nothing else.' }],
});

// Thinking blocks may precede the answer, so look for text anywhere.
const text = response.content
  .filter((b) => b.type === "text")
  .map((b) => b.text)
  .join("")
  .trim();
if (!text) {
  throw new Error(
    `Expected a non-empty text reply, got: ${JSON.stringify(response.content)}`,
  );
}

console.log(`✓ Claude OK — model: "${model}", replied: "${text}"`);
