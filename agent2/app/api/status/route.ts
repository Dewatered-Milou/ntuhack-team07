export const runtime = "edge";

export async function GET() {
  const apiKey = readEnv("OPENAI_API_KEY");
  const model = readEnv("AGENT2_OPENAI_MODEL") || readEnv("OPENAI_MODEL") || "gpt-4o-mini";
  const connection = apiKey
    ? await verifyOpenAIConnection(apiKey, model)
    : { connected: false, message: "尚未設定OPENAI_API_KEY。" };

  return Response.json({
    openai_configured: Boolean(apiKey),
    openai_connected: connection.connected,
    openai_message: connection.message,
    agent1_configured: Boolean(readEnv("AGENT1_API_URL")),
    model,
  }, { headers: { "Cache-Control": "no-store" } });
}

async function verifyOpenAIConnection(apiKey: string, model: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (response.ok) return { connected: true, message: "OpenAI API連線成功。" };
    return { connected: false, message: `OpenAI API連線失敗（HTTP ${response.status}）。` };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "OpenAI API連線逾時。"
      : "無法連線至OpenAI API。";
    return { connected: false, message };
  } finally {
    clearTimeout(timeout);
  }
}

function readEnv(name: string) {
  return typeof process !== "undefined" ? process.env[name]?.trim() : undefined;
}
