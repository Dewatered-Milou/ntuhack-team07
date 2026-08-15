import type { EvidenceItem, NormalizedEvent } from "./types";

const WARNING_PATTERNS: Array<{ pattern: RegExp; label: string; urgency: 1 | 2 }> = [
  { pattern: /呼吸困難|喘不過氣|無法呼吸/, label: "回報可能有呼吸困難", urgency: 2 },
  { pattern: /胸痛|胸口劇痛|胸悶冒冷汗/, label: "回報可能有胸部警訊", urgency: 2 },
  { pattern: /意識不清|失去意識|昏倒|叫不醒/, label: "回報可能有意識狀態改變", urgency: 2 },
  { pattern: /單側無力|嘴歪|說話不清/, label: "回報可能有急性神經學警訊", urgency: 2 },
  { pattern: /大量出血|血流不止/, label: "回報可能有大量出血", urgency: 2 },
  { pattern: /想自殺|想死|傷害自己/, label: "回報可能有自我傷害風險", urgency: 2 },
  { pattern: /吐了?\s*\d+\s*次|嘔吐\s*\d+\s*次|一直吐|反覆嘔吐/, label: "回報反覆嘔吐", urgency: 1 },
  { pattern: /\d+\s*小時.{0,5}(沒尿|未排尿)|尿色.{0,3}深|尿很深|站(起來|立).{0,4}頭暈/, label: "回報可能有體液不足警訊", urgency: 1 },
  { pattern: /持續高燒|劇烈頭痛/, label: "回報需要儘速檢視的症狀", urgency: 1 },
];

export function detectWarningSigns(events: NormalizedEvent[]): {
  urgency: "routine" | "urgent_review" | "emergency_warning";
  warningSigns: EvidenceItem[];
} {
  let maxUrgency: 0 | 1 | 2 = 0;
  const warningSigns: EvidenceItem[] = [];

  for (const event of events) {
    // Agent turns often contain screening questions (for example, "是否昏倒").
    // They are not reports that the sign is present and must not trigger urgency.
    if (event.speaker === "agent") continue;
    for (const candidate of WARNING_PATTERNS) {
      if (!candidate.pattern.test(event.text_original)) continue;
      if (isClearlyNegated(event.text_original, candidate.pattern)) continue;
      maxUrgency = Math.max(maxUrgency, candidate.urgency) as 1 | 2;
      warningSigns.push({
        text: candidate.label,
        evidence_event_ids: [event.event_id],
      });
    }
  }

  return {
    urgency: maxUrgency === 2 ? "emergency_warning" : maxUrgency === 1 ? "urgent_review" : "routine",
    warningSigns: deduplicateWarnings(warningSigns),
  };
}

function isClearlyNegated(text: string, pattern: RegExp): boolean {
  const match = text.match(pattern);
  if (!match?.index) return false;
  const prefix = text.slice(Math.max(0, match.index - 6), match.index);
  return /沒有|無|否認|未出現|不會/.test(prefix);
}

function deduplicateWarnings(items: EvidenceItem[]) {
  const grouped = new Map<string, Set<string>>();
  for (const item of items) {
    const ids = grouped.get(item.text) ?? new Set<string>();
    item.evidence_event_ids.forEach((id) => ids.add(id));
    grouped.set(item.text, ids);
  }
  return [...grouped].map(([text, ids]) => ({ text, evidence_event_ids: [...ids] }));
}
