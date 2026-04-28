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
  max_tokens: 64,
  system: "You are a helpful assistant. Reply very briefly.",
  messages: [{ role: "user", content: 'Say "smoke test OK" and nothing else.' }],
});

const block = response.content[0];
if (!block || block.type !== "text") {
  throw new Error(
    `Expected a text content block, got: ${JSON.stringify(block)}`,
  );
}
if (!block.text.trim()) {
  throw new Error("Claude returned an empty text block");
}

console.log(`✓ Claude OK — model: "${model}", replied: "${block.text.trim()}"`);
