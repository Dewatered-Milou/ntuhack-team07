const stringField = { type: "string" } as const;

const evidenceItem = {
  type: "object",
  additionalProperties: false,
  required: ["text", "evidence_event_ids"],
  properties: {
    text: stringField,
    evidence_event_ids: { type: "array", items: stringField },
  },
} as const;

export const agent2OutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "format_version",
    "generated_at",
    "language",
    "status",
    "time_range",
    "summary",
    "key_points",
    "recent_changes",
    "patient_questions",
    "attention",
    "provenance",
  ],
  properties: {
    format_version: { type: "string", enum: ["summary-1.0"] },
    generated_at: stringField,
    language: { type: "string", enum: ["zh-TW"] },
    status: {
      type: "string",
      enum: ["complete", "partial", "insufficient_data", "failed"],
    },
    time_range: {
      type: "object",
      additionalProperties: false,
      required: ["start", "end"],
      properties: { start: stringField, end: stringField },
    },
    summary: evidenceItem,
    key_points: { type: "array", items: evidenceItem },
    recent_changes: { type: "array", items: evidenceItem },
    patient_questions: { type: "array", items: evidenceItem },
    attention: {
      type: "object",
      additionalProperties: false,
      required: ["level", "label", "text", "evidence_event_ids"],
      properties: {
        level: { type: "string", enum: ["routine", "review", "urgent", "unknown"] },
        label: stringField,
        text: stringField,
        evidence_event_ids: { type: "array", items: stringField },
      },
    },
    provenance: {
      type: "object",
      additionalProperties: false,
      required: ["source_event_ids", "model", "prompt_version"],
      properties: {
        source_event_ids: { type: "array", items: stringField },
        model: stringField,
        prompt_version: { type: "string", enum: ["summary-v1.0"] },
      },
    },
  },
} as const;
