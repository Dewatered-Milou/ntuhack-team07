import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/status/route.ts";

test("reports an unconfigured OpenAI key without making a network request", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = async () => {
    throw new Error("status route must not fetch without a key");
  };

  try {
    const response = await GET();
    const payload = await response.json();
    assert.equal(payload.openai_configured, false);
    assert.equal(payload.openai_connected, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("verifies a configured key without exposing it", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousModel = process.env.AGENT2_OPENAI_MODEL;
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "sk-test-placeholder";
  process.env.AGENT2_OPENAI_MODEL = "gpt-test-model";
  let authorization = "";
  let requestedUrl = "";
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get("authorization") || "";
    return Response.json({ id: "gpt-test-model" });
  };

  try {
    const response = await GET();
    const payload = await response.json();
    assert.equal(payload.openai_configured, true);
    assert.equal(payload.openai_connected, true);
    assert.equal(payload.model, "gpt-test-model");
    assert.match(requestedUrl, /\/v1\/models\/gpt-test-model$/);
    assert.equal(authorization, "Bearer sk-test-placeholder");
    assert.doesNotMatch(JSON.stringify(payload), /sk-test-placeholder/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.AGENT2_OPENAI_MODEL;
    else process.env.AGENT2_OPENAI_MODEL = previousModel;
  }
});
