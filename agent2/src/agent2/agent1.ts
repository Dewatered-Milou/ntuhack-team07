import { REFERENCE_DEMO_PATIENT_NAME, REFERENCE_DEMO_TIMELINE } from "./demo";

export type Agent1SourceMode = "agent1" | "manual" | "demo";

export async function getPatientTimeline(
  patientName: string,
  manualTimeSeries: unknown,
  requestId: string,
): Promise<{ timeSeries: unknown; sourceMode: Agent1SourceMode; warnings: string[] }> {
  if (manualTimeSeries !== undefined && manualTimeSeries !== null) {
    return { timeSeries: manualTimeSeries, sourceMode: "manual", warnings: [] };
  }

  const agent1Url = readEnv("AGENT1_API_URL");
  if (!agent1Url) {
    if (patientName !== REFERENCE_DEMO_PATIENT_NAME) {
      throw new Error("Agent 1 尚未設定；請使用參考Demo或手動測試JSON。");
    }
    return {
      timeSeries: REFERENCE_DEMO_TIMELINE,
      sourceMode: "demo",
      warnings: ["Agent 1 尚未連線，目前載入陳怡安（虛構）的合成參考資料。"],
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const token = readEnv("AGENT1_API_TOKEN");
    const response = await fetch(agent1Url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ patient_name: patientName }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Agent 1 回應 ${response.status}`);
    return { timeSeries: await response.json(), sourceMode: "agent1", warnings: [] };
  } finally {
    clearTimeout(timeout);
  }
}

function readEnv(name: string) {
  return typeof process !== "undefined" ? process.env[name]?.trim() : undefined;
}
