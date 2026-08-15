import { detectWarningSigns } from "./safety";
import type { Agent2Summary, NormalizedEvent } from "./types";

export function createSafeFallback(events: NormalizedEvent[], model = "not-configured"): Agent2Summary {
  const detected = detectWarningSigns(events);
  const sourceEvents = events.filter((event) => event.speaker === "patient" || event.speaker === "caregiver");
  const first = sourceEvents[0] ?? events[0];
  const start = events[0]?.timestamp_utc ?? new Date().toISOString();
  const end = events.at(-1)?.timestamp_utc ?? start;
  const evidenceIds = detected.warningSigns.flatMap((item) => item.evidence_event_ids);

  return {
    format_version: "summary-1.0",
    generated_at: new Date().toISOString(),
    language: "zh-TW",
    status: "partial",
    time_range: { start, end },
    summary: {
      text: first ? `尚未完成AI摘要。首筆回報：${shorten(first.text_original, 120)}` : "資料不足，請檢視來源時間軸。",
      evidence_event_ids: first ? [first.event_id] : [],
    },
    key_points: [],
    recent_changes: [],
    patient_questions: [],
    attention: {
      level: detected.urgency === "emergency_warning" ? "urgent" : detected.urgency === "urgent_review" ? "review" : "unknown",
      label: detected.urgency === "routine" ? "尚未完成注意力分類" : "偵測到需核對的回報",
      text: detected.warningSigns.map((item) => item.text).join("；") || "摘要服務未連線，請直接查看來源事件。",
      evidence_event_ids: [...new Set(evidenceIds)],
    },
    provenance: {
      source_event_ids: events.map((event) => event.event_id),
      model,
      prompt_version: "summary-v1.0",
    },
  };
}

function shorten(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}
