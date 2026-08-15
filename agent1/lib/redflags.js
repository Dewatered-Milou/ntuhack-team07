// 紅旗分級引擎——刻意用「規則表＋純函式」而非 LLM：安全判斷必須可預測、可審核。
// 規則內容在 data/redflags.json，由醫學生修訂；這裡只負責執行。

const LEVEL_ORDER = { green: 0, yellow: 1, red: 2 };

function matches(rule, report) {
  const v = report[rule.field];
  switch (rule.op) {
    case "gte":
      return typeof v === "number" && v >= rule.value;
    case "eq":
      return v === rule.value;
    case "includes":
      if (Array.isArray(v)) return v.some((item) => String(item).includes(rule.value));
      if (typeof v === "string") return v.includes(rule.value);
      return false;
    default:
      return false;
  }
}

function evaluate(report, rules) {
  const hits = rules.filter((r) => matches(r, report));
  let level = "green";
  for (const h of hits) {
    if (LEVEL_ORDER[h.level] > LEVEL_ORDER[level]) level = h.level;
  }
  return { level, hits: hits.map((h) => ({ id: h.id, level: h.level, message: h.message })) };
}

module.exports = { evaluate };
