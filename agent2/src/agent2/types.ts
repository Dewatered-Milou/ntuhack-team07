export type Speaker = "patient" | "caregiver" | "agent" | "clinician" | "unknown";

export type NormalizedEvent = {
  event_id: string;
  timestamp_original: string;
  timestamp_utc: string;
  speaker: Speaker;
  text_original: string;
  source: string;
  validation_status: "valid" | "warning";
};

export type EvidenceItem = {
  text: string;
  evidence_event_ids: string[];
};

export type Agent2Summary = {
  format_version: "summary-1.0";
  generated_at: string;
  language: "zh-TW";
  status: "complete" | "partial" | "insufficient_data" | "failed";
  time_range: {
    start: string;
    end: string;
  };
  summary: EvidenceItem;
  key_points: EvidenceItem[];
  recent_changes: EvidenceItem[];
  patient_questions: EvidenceItem[];
  attention: {
    level: "routine" | "review" | "urgent" | "unknown";
    label: string;
    text: string;
    evidence_event_ids: string[];
  };
  provenance: {
    source_event_ids: string[];
    model: string;
    prompt_version: "summary-v1.0";
  };
};

export type Agent2ApiResult = {
  patient_name: string;
  source_mode: "agent1" | "manual" | "demo";
  ai_mode: "openai" | "reference_demo" | "safe_fallback";
  warnings: string[];
  events: NormalizedEvent[];
  summary: Agent2Summary;
  request_id: string;
};
