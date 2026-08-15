import { getPatientTimeline } from "../../../src/agent2/agent1";
import { InputValidationError, normalizeTimeSeries } from "../../../src/agent2/normalize";
import { summarizeWithOpenAI } from "../../../src/agent2/openai";
import type { Agent2ApiResult } from "../../../src/agent2/types";

export const runtime = "edge";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const body = await request.json() as { patient_name?: unknown; time_series?: unknown };
    const patientName = typeof body.patient_name === "string" ? body.patient_name.trim() : "";
    if (!patientName || patientName.length > 80) {
      return jsonError("請輸入 1–80 字的病患姓名。", 400, requestId);
    }

    const agent1 = await getPatientTimeline(patientName, body.time_series, requestId);
    const normalized = normalizeTimeSeries(agent1.timeSeries);
    const generated = await summarizeWithOpenAI(normalized.events, requestId, {
      referenceDemo: agent1.sourceMode === "demo",
    });

    const result: Agent2ApiResult = {
      patient_name: patientName,
      source_mode: agent1.sourceMode,
      ai_mode: generated.aiMode,
      warnings: [...agent1.warnings, ...normalized.warnings, ...generated.warnings],
      events: normalized.events,
      summary: generated.summary,
      request_id: requestId,
    };
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InputValidationError) {
      return Response.json(
        { error: error.message, details: error.details, request_id: requestId },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }
    const message = error instanceof SyntaxError
      ? "JSON 格式無法解析。"
      : error instanceof Error && error.message.startsWith("Agent 1 尚未設定")
        ? error.message
      : error instanceof Error && error.message.startsWith("Agent 1 回應")
        ? "目前無法取得 Agent 1 的病患資料。"
        : "暫時無法產生摘要，請稍後再試。";
    const status = error instanceof Error && error.message.startsWith("Agent 1 尚未設定") ? 503 : 500;
    return jsonError(message, status, requestId);
  }
}

function jsonError(error: string, status: number, requestId: string) {
  return Response.json(
    { error, request_id: requestId },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
