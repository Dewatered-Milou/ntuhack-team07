import type { Agent2Summary, NormalizedEvent } from "./types";

export const REFERENCE_DEMO_PATIENT_NAME = "陳怡安（虛構）";

export const REFERENCE_DEMO_TIMELINE = {
  schema_version: "1.0",
  patient_id: "DEMO-GLP1-001",
  encounter_id: "DEMO-GLP1-001-20260815",
  timezone: "Asia/Taipei",
  events: [
    {
      event_id: "evt_demo_001",
      timestamp: "2026-08-14T18:00:00+08:00",
      speaker: "clinician",
      type: "clinical_context",
      text: "39歲女性，身高162 cm，semaglutide減重療程第9週；起始體重88.0 kg，第8週82.4 kg，本次升階前82.3 kg。共病為控制穩定的高血壓，使用amlodipine 5 mg/day；無糖尿病。患者自述無胰臟炎、膽結石、MTC或MEN2病史。",
      source: "synthetic_demo_record",
    },
    {
      event_id: "evt_demo_002",
      timestamp: "2026-08-14T20:00:00+08:00",
      speaker: "patient",
      type: "dialogue",
      text: "我昨晚第一次從0.5 mg升到1.0 mg，照原本固定時間打semaglutide。施打前體重82.3公斤，當時沒有明顯不舒服。",
      source: "agent_1",
    },
    {
      event_id: "evt_demo_003",
      timestamp: "2026-08-15T14:05:00+08:00",
      speaker: "patient",
      type: "dialogue",
      text: "今天早上8點到下午2點吐了4次，喝水也會噁心。今天量81.7公斤，從治療前88公斤降下來，這是不是代表藥很有效？下星期還要繼續打1 mg嗎？",
      source: "agent_1",
    },
    {
      event_id: "evt_demo_004",
      timestamp: "2026-08-15T14:08:00+08:00",
      speaker: "agent",
      type: "dialogue",
      text: "請確認目前是否仍在嘔吐、今日飲水量、腹痛程度與位置、是否向背部延伸、嘔吐物是否帶血、是否發燒或昏倒、站立是否頭暈，以及最後一次排尿時間與尿色。",
      source: "agent_1",
    },
    {
      event_id: "evt_demo_005",
      timestamp: "2026-08-15T14:12:00+08:00",
      speaker: "patient",
      type: "dialogue",
      text: "最近3小時沒有再吐，但今天只能慢慢喝大約300 mL。肚子只有一點悶痛，大概2分，沒有延伸到背部。沒有吐血、沒有發燒，也沒有昏倒或意識不清。站起來會頭暈，差不多9小時沒尿，早上的尿很深。我沒有糖尿病，也沒有使用胰島素或其他降血糖藥。",
      source: "agent_1",
    },
  ],
} as const;

export function createReferenceDemoSummary(events: NormalizedEvent[]): Agent2Summary {
  const first = events[0]?.timestamp_utc ?? new Date().toISOString();
  const last = events.at(-1)?.timestamp_utc ?? first;

  return {
    format_version: "summary-1.0",
    generated_at: new Date().toISOString(),
    language: "zh-TW",
    status: "complete",
    time_range: { start: first, end: last },
    summary: {
      text: "Semaglutide療程第9週，昨晚首次由0.5 mg升至1.0 mg。今日08:00–14:00回報嘔吐4次，最近3小時未再嘔吐，但今日僅飲水約300 mL；另回報站立頭暈、深色尿及約9小時未排尿。腹部輕微悶痛2/10、無背部放射，並否認吐血、發燒、昏倒或意識不清。患者詢問下週是否繼續1.0 mg。",
      evidence_event_ids: ["evt_demo_002", "evt_demo_003", "evt_demo_005"],
    },
    key_points: [
      { text: "Semaglutide療程第9週，首次由0.5 mg升至1.0 mg。", evidence_event_ids: ["evt_demo_001", "evt_demo_002"] },
      { text: "今日08:00–14:00嘔吐4次；最近3小時未再嘔吐，今日飲水約300 mL。", evidence_event_ids: ["evt_demo_003", "evt_demo_005"] },
      { text: "回報腹部悶痛2/10且無背部放射；否認吐血、發燒、昏倒或意識不清。", evidence_event_ids: ["evt_demo_005"] },
      { text: "回報站立頭暈、早晨尿色深且約9小時未排尿。", evidence_event_ids: ["evt_demo_005"] },
    ],
    recent_changes: [
      { text: "Semaglutide由0.5 mg升至1.0 mg後，隔日出現4次嘔吐。", evidence_event_ids: ["evt_demo_002", "evt_demo_003"] },
      { text: "患者回報體重由升階前82.3 kg變為今日81.7 kg。", evidence_event_ids: ["evt_demo_002", "evt_demo_003"] },
      { text: "嘔吐最近3小時已停止，但飲水與排尿仍減少。", evidence_event_ids: ["evt_demo_005"] },
    ],
    patient_questions: [
      { text: "今日體重變化是否代表藥物有效？", evidence_event_ids: ["evt_demo_003"] },
      { text: "下週是否繼續施打semaglutide 1.0 mg？", evidence_event_ids: ["evt_demo_003"] },
    ],
    attention: {
      level: "urgent",
      label: "建議優先核對",
      text: "回報反覆嘔吐、飲水約300 mL、站立頭暈、深色尿及約9小時未排尿。此標示僅整理原始回報，不代表診斷或處置決定。",
      evidence_event_ids: ["evt_demo_003", "evt_demo_005"],
    },
    provenance: {
      source_event_ids: events.map((event) => event.event_id),
      model: "reference-demo",
      prompt_version: "summary-v1.0",
    },
  };
}
