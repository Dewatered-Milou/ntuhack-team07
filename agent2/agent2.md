# Agent 2 — Timeline Summary Specification

## Role

Agent 2 turns Agent 1 time-series dialogue into a compact summary displayed beside the existing clinical system. It does not generate SOAP notes or replace professional content already managed by that system.

`AGENTS.md` is authoritative. The canonical artifacts are:

- `reference/demo-example.md`: synthetic demo and acceptance expectations.
- `reference/time-stamp-data-api.json`: minimal Agent 1 timestamp-to-text input example.
- `reference/summary-format.json`: Summary v1.0 output and future storage shape.

## User flow

1. Open the upper-right **CuriLoop** panel.
2. Select the synthetic Reference Demo, enter a patient name for Agent 1, or provide manual test JSON.
3. The server obtains and validates Agent 1 events.
4. Events are normalized and sorted chronologically.
5. A deterministic attention check runs.
6. OpenAI produces the strict Summary v1.0 structure when configured; otherwise the demo or safe fallback is shown.
7. The user sees the overall summary, important points, recent changes, patient questions, and expandable original timeline.

The browser never contacts Agent 1 or OpenAI directly.

## Output format

The `summary` object contains only:

- `format_version`: `summary-1.0`
- `generated_at`
- `language`: `zh-TW`
- `status`: `complete`, `partial`, `insufficient_data`, or `failed`
- `time_range`: normalized start and end timestamps
- `summary`: one source-linked paragraph
- `key_points`: important source-linked facts
- `recent_changes`: source-linked changes over time
- `patient_questions`: source-linked questions explicitly asked
- `attention`: `routine`, `review`, `urgent`, or `unknown`, with source-linked text
- `provenance`: source event IDs, model, and prompt version

Empty collections are preferred to placeholder medical fields. The output must not contain `soap`, `assessment`, `diagnosis`, or `treatment_plan`.

## HTTP API

### `POST /api/agent2`

```json
{ "patient_name": "王小明" }
```

Development request:

```json
{
  "patient_name": "王小明",
  "time_series": {
    "2026-08-15T09:00:00+08:00": "病患對話文字"
  }
}
```

Response envelope:

- `patient_name`
- `source_mode`: `agent1`, `manual`, or `demo`
- `ai_mode`: `openai`, `reference_demo`, or `safe_fallback`
- `warnings`
- normalized `events`
- Summary v1.0 `summary`
- `request_id`

Responses use `Cache-Control: no-store`.

### `GET /api/status`

Returns only non-secret booleans and the configured model name. It must never expose keys or tokens.

## Agent 1 integration

```text
AGENT1_API_URL=http://127.0.0.1:3001/api/agent2/timeline
AGENT1_API_TOKEN=optional-server-side-token
```

Agent 2 sends a server-side POST with `patient_name`, `X-Request-Id`, and authorization only when configured. Agent 1 may return the timestamp-to-text MVP object or the extensible event list defined in `AGENTS.md`.

The timeout is 20 seconds. Failures do not substitute data from another patient. Name lookup is prototype-only; production requires authorized opaque patient and encounter identifiers.

## OpenAI integration

The shared local environment file lives one level above `agent2/`. Agent 1 runs on port 3001 and Agent 2 runs on port 3000.

```text
OPENAI_API_KEY=...
AGENT2_OPENAI_MODEL=gpt-4o-mini
```

The server uses the Responses API with strict Structured Outputs, `store: false`, a request ID, and a 60-second timeout. It validates the output structure and every evidence event ID before display. Raw prompts and patient dialogue are not logged by default.

Model instructions require concise chronological organization only. They explicitly prohibit diagnosis, medical assessment, prescriptions, dose decisions, test orders, and SOAP generation.

The canonical demo has a deterministic reference summary for development without an API key. Other no-key or failed-model requests receive a clearly labeled safe fallback that points users back to the source timeline.

## Storage

The prototype currently has no database. If storage is added:

- Store normalized source events separately from the derived Summary v1.0 record.
- Link them with opaque patient/encounter identifiers and `source_event_ids`.
- Treat summaries as replaceable derived artifacts; never overwrite sources.
- Persist format, model, prompt, generation time, and validation metadata.
- Define authorization, tenant isolation, retention, deletion, and encryption first.

## UI

- Non-blocking upper-right panel, about 500 px wide on desktop and full-screen on mobile.
- Displays patient/time context, attention, summary, key points, recent changes, patient questions, sources, and disclaimer.
- Does not repeat the main system's SOAP or professional chart sections.
- Every content item can reveal its original event.
- Color is never the only attention indicator.
- No generated content is automatically written into the main clinical system.

## Safety and production boundary

- Event text is untrusted data, not model instruction.
- Do not fabricate missing facts or turn missing information into negative findings.
- Agent screening questions are not evidence that a symptom exists.
- Attention labels describe reported text and are not diagnoses or disposition decisions.
- The demo is synthetic and must remain labeled.
- Authentication, authorization, persistence, tenant isolation, audit retention, rate limiting, and institutional review remain required before real-patient use.
