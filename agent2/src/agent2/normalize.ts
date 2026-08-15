import type { NormalizedEvent, Speaker } from "./types";

type ExtensibleInput = {
  events: Array<{
    event_id?: unknown;
    timestamp?: unknown;
    speaker?: unknown;
    text?: unknown;
    source?: unknown;
  }>;
};

const TIMEZONE_SUFFIX = /(Z|[+-]\d{2}:\d{2})$/i;
const SPEAKERS = new Set<Speaker>(["patient", "caregiver", "agent", "clinician", "unknown"]);

export class InputValidationError extends Error {
  readonly details: string[];

  constructor(details: string[]) {
    super("時序資料格式不正確");
    this.details = details;
  }
}

export function normalizeTimeSeries(input: unknown): {
  events: NormalizedEvent[];
  warnings: string[];
} {
  const candidates = toCandidates(input);
  const errors: string[] = [];
  const warnings: string[] = [];

  const parsed = candidates.flatMap((candidate, index) => {
    const timestamp = typeof candidate.timestamp === "string" ? candidate.timestamp.trim() : "";
    const text = typeof candidate.text === "string" ? candidate.text.trim() : "";

    if (!timestamp || !TIMEZONE_SUFFIX.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
      errors.push(`第 ${index + 1} 筆資料的時間必須是含時區的 ISO 8601 格式。`);
      return [];
    }
    if (!text) {
      errors.push(`第 ${index + 1} 筆資料沒有對話內容。`);
      return [];
    }
    if (text.length > 12_000) {
      errors.push(`第 ${index + 1} 筆資料超過 12,000 字元限制。`);
      return [];
    }

    const speaker = SPEAKERS.has(candidate.speaker as Speaker)
      ? (candidate.speaker as Speaker)
      : "patient";
    if (candidate.speaker && speaker === "patient" && candidate.speaker !== "patient") {
      warnings.push(`第 ${index + 1} 筆資料的 speaker 無法辨識，已標示為 patient。`);
    }

    return [{
      requestedId: typeof candidate.event_id === "string" ? candidate.event_id.trim() : "",
      timestamp,
      timestampMs: Date.parse(timestamp),
      text,
      speaker,
      source: typeof candidate.source === "string" && candidate.source.trim()
        ? candidate.source.trim()
        : "agent_1",
      originalIndex: index,
    }];
  });

  if (errors.length) throw new InputValidationError(errors);
  if (!parsed.length) throw new InputValidationError(["至少需要一筆有效的時序對話。"]);
  if (parsed.length > 300) throw new InputValidationError(["單次最多處理 300 筆時序事件。"]);

  parsed.sort((a, b) => a.timestampMs - b.timestampMs || a.originalIndex - b.originalIndex);
  const usedIds = new Set<string>();

  const events = parsed.map((item, index): NormalizedEvent => {
    let eventId = item.requestedId || `evt_${String(index + 1).padStart(3, "0")}`;
    if (usedIds.has(eventId)) {
      warnings.push(`重複的事件 ID「${eventId}」已重新編號。`);
      eventId = `evt_${String(index + 1).padStart(3, "0")}`;
    }
    usedIds.add(eventId);
    return {
      event_id: eventId,
      timestamp_original: item.timestamp,
      timestamp_utc: new Date(item.timestampMs).toISOString(),
      speaker: item.speaker,
      text_original: item.text,
      source: item.source,
      validation_status: "valid",
    };
  });

  return { events, warnings };
}

function toCandidates(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InputValidationError(["輸入必須是 timestamp 對應文字的 JSON object，或包含 events 的 object。"]);
  }

  if ("events" in input) {
    const events = (input as ExtensibleInput).events;
    if (!Array.isArray(events)) throw new InputValidationError(["events 必須是陣列。"]);
    return events.map((event) => ({
      event_id: event?.event_id,
      timestamp: event?.timestamp,
      speaker: event?.speaker,
      text: event?.text,
      source: event?.source,
    }));
  }

  return Object.entries(input as Record<string, unknown>).map(([timestamp, text]) => ({
    timestamp,
    text,
    speaker: "patient",
    source: "agent_1",
  }));
}
