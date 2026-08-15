import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createReferenceDemoSummary, REFERENCE_DEMO_TIMELINE } from "../src/agent2/demo.ts";
import { InputValidationError, normalizeTimeSeries } from "../src/agent2/normalize.ts";
import { detectWarningSigns } from "../src/agent2/safety.ts";

test("normalizes and chronologically sorts MVP time-series input", () => {
  const result = normalizeTimeSeries({
    "2026-08-15T09:00:00+08:00": "第二筆",
    "2026-08-14T23:30:00Z": "第一筆",
  });

  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].text_original, "第一筆");
  assert.equal(result.events[0].event_id, "evt_001");
  assert.equal(result.events[1].timestamp_utc, "2026-08-15T01:00:00.000Z");
});

test("preserves source text and original timestamp", () => {
  const timestamp = "2026-08-15T09:00:00+08:00";
  const text = "體溫 38.5°C，沒有胸痛。";
  const { events } = normalizeTimeSeries({ [timestamp]: text });

  assert.equal(events[0].timestamp_original, timestamp);
  assert.equal(events[0].text_original, text);
  assert.equal(events[0].speaker, "patient");
});

test("accepts extensible event input", () => {
  const { events } = normalizeTimeSeries({
    events: [{
      event_id: "agent1-42",
      timestamp: "2026-08-15T09:00:00+08:00",
      speaker: "caregiver",
      text: "照顧者回報病患今天食慾不佳。",
      source: "agent_1",
    }],
  });

  assert.equal(events[0].event_id, "agent1-42");
  assert.equal(events[0].speaker, "caregiver");
});

test("rejects timestamps without a timezone", () => {
  assert.throws(
    () => normalizeTimeSeries({ "2026-08-15T09:00:00": "缺少時區" }),
    (error) => error instanceof InputValidationError && error.details[0].includes("時區"),
  );
});

test("does not silently discard empty text", () => {
  assert.throws(
    () => normalizeTimeSeries({ "2026-08-15T09:00:00+08:00": "  " }),
    InputValidationError,
  );
});

test("canonical reference demo remains chronological and source-linked", () => {
  const { events } = normalizeTimeSeries(REFERENCE_DEMO_TIMELINE);
  const summary = createReferenceDemoSummary(events);
  const validIds = new Set(events.map((event) => event.event_id));

  assert.equal(events.length, 5);
  assert.deepEqual(events.map((event) => event.event_id), [
    "evt_demo_001", "evt_demo_002", "evt_demo_003", "evt_demo_004", "evt_demo_005",
  ]);
  assert.equal(summary.format_version, "summary-1.0");
  assert.equal(summary.attention.level, "urgent");
  assert.match(summary.summary.text, /0\.5 mg升至1\.0 mg/);
  assert.match(summary.summary.text, /約9小時未排尿/);
  assert.equal(summary.key_points.length, 4);
  assert.equal(summary.recent_changes.length, 3);
  assert.equal(summary.patient_questions.length, 2);
  assert.equal("soap" in summary, false);

  const evidenceItems = [summary.summary, ...summary.key_points, ...summary.recent_changes, ...summary.patient_questions];
  for (const entry of evidenceItems) {
    assert.ok(entry.evidence_event_ids.length > 0);
    entry.evidence_event_ids.forEach((id) => assert.ok(validIds.has(id), `unknown evidence id: ${id}`));
  }
  summary.attention.evidence_event_ids.forEach((id) => assert.ok(validIds.has(id), `unknown attention id: ${id}`));
});

test("deterministic safety layer detects vomiting and low-volume warning signs", () => {
  const { events } = normalizeTimeSeries(REFERENCE_DEMO_TIMELINE);
  const safety = detectWarningSigns(events);

  assert.equal(safety.urgency, "urgent_review");
  assert.ok(safety.warningSigns.some((item) => item.text.includes("反覆嘔吐")));
  assert.ok(safety.warningSigns.some((item) => item.text.includes("體液不足")));
  assert.ok(safety.warningSigns.every((item) => item.evidence_event_ids.every((id) => id.startsWith("evt_demo_"))));
  assert.ok(safety.warningSigns.every((item) => !item.evidence_event_ids.includes("evt_demo_004")));
});

test("summary reference defines the small Summary v1.0 storage contract", () => {
  const format = JSON.parse(readFileSync(new URL("../reference/summary-format.json", import.meta.url), "utf8"));

  assert.equal(format.format_version, "summary-1.0");
  assert.deepEqual(Object.keys(format), [
    "format_version", "generated_at", "language", "status", "time_range", "summary",
    "key_points", "recent_changes", "patient_questions", "attention", "provenance",
  ]);
  assert.equal("soap" in format, false);
  assert.equal(existsSync(new URL("../reference/soap-style.json", import.meta.url)), false);
});

test("timestamp API reference remains valid MVP input", () => {
  const input = JSON.parse(readFileSync(new URL("../reference/time-stamp-data-api.json", import.meta.url), "utf8"));
  const { events } = normalizeTimeSeries(input);

  assert.equal(events.length, 3);
  assert.ok(events.every((event) => event.speaker === "patient"));
  assert.ok(events.every((event) => event.timestamp_original.endsWith("+08:00")));
});
