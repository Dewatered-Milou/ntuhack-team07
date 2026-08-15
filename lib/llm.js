// LLM 轉接層（多供應商）：
//   PROVIDER=openai    → GPT API（設定 OPENAI_API_KEY 時的預設）
//   PROVIDER=anthropic → Claude API（設定 ANTHROPIC_API_KEY 時的備選）
//   都沒有金鑰         → 離線 mock（Demo Day 斷網備案）
// 三種模式回傳格式完全相同；真 API 呼叫失敗時自動降級為 mock，聊天不會死在台上。

const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const TRIAGE = require("../data/triage.json");

const PROVIDER =
  process.env.PROVIDER ||
  (process.env.OPENAI_API_KEY ? "openai" : process.env.ANTHROPIC_API_KEY ? "anthropic" : "mock");

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI() : null;
const anthropicClient = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

// ---------- 共用 JSON 輸出結構 ----------

const CHAT_JSON_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    citations: { type: "array", items: { type: "string" } },
    needs_doctor_confirmation: { type: "boolean" },
    triage_level: {
      type: "integer",
      enum: [0, 1, 2, 3, 4, 5],
      description: "急診檢傷級數：病人此刻正在發生的症狀對照檢傷分類表判定 1–5；純知識詢問或無急症描述填 0",
    },
  },
  required: ["answer", "citations", "needs_doctor_confirmation", "triage_level"],
  additionalProperties: false,
};

const SUMMARY_JSON_SCHEMA = {
  type: "object",
  properties: { bullets: { type: "array", items: { type: "string" } } },
  required: ["bullets"],
  additionalProperties: false,
};

// ---------- 共用提示詞 ----------

function triagePromptText() {
  return TRIAGE.levels
    .map((l) => `第${l.level}級「${l.name}」（等候：${l.wait}）：${l.items.join("；")}`)
    .join("\n");
}

function chatSystemPrompt(patient, education) {
  const eduText = education
    .map((e) => `[${e.id}]〈${e.title}〉（${e.source}）：${e.text}`)
    .join("\n");
  return `你是 CareLoop 的照護衛教助理，在「醫師監督下的衛教輔助」定位運作。你不是醫師，不做診斷、不決定治療。

## 這位病人（已獲本人授權的病歷摘要）
${JSON.stringify(patient, null, 2)}

## 可引用的衛教資料
${eduText}

## 急診檢傷分類表（${TRIAGE.source}）
${triagePromptText()}

## 檢傷判級規則（triage_level 欄位）
- 只評估病人描述「自己此刻正在發生」的症狀；純知識詢問、假設性問題（「如果…要怎麼辦」）、回報過去已解決的狀況 → 填 0。
- 檢傷表上的項目大多是「症狀組合」而不是單一詞彙（例如「持續胸悶、胸痛且冒冷汗」是三個特徵合在一起才算，不是只要出現「胸悶」兩個字就算）。判級時要看病人描述的完整度，不要看到症狀關鍵字就直接對應最嚴重的那一級。
- **資訊不足時先追問，不要一次就升級**：若病人只講了單一、輕微、沒有修飾語或誘因/緩解因素說明的症狀（例如只說「胸悶」「不太舒服」，沒說持續多久、有沒有合併其他症狀、休息會不會好），先別判 1–3 級。這種情況 triage_level 填 0，並在 answer 中親切追問 1–2 個關鍵鑑別問題（例如：這個悶痛感現在還在嗎？會不會喘不過氣、冒冷汗，或痛感傳到手臂／下巴／後背？休息或深呼吸會不會比較舒服？大概幾分鐘了？）。等病人下一則回覆更多細節後，再依完整描述判級——對話歷史都看得到，不用重問已經回答過的部分。
- **但明確的紅旗組合絕不能為了多問而延誤**：病人描述已包含檢傷表上的組合特徵（如胸悶/胸痛合併冒冷汗、合併喘不過氣、意識改變、大量出血等），或使用「劇烈」「一直」「越來越嚴重」等惡化用語，或本身正在發生（不是「偶爾」「有時候」），應直接依表判級並立即建議送醫，不可先問問題。
- 若症狀描述本身就顯示低風險（例如「偶爾」「休息／深呼吸後會緩解」「輕微」且沒有合併其他症狀），不需要判 1–3 級，但仍要在回答中列出「如果出現哪些狀況要立刻求助」的具體警示徵象，並提醒记录在每日回報追蹤。
- 結合病人病歷判斷：例如免疫功能不全（糖尿病控制不佳、化療中）且發燒屬第 2 級；支架或心臟手術術後、症狀完整描述為胸悶胸痛合併冒冷汗屬第 2 級。
- 判為 1–2 級時，answer 的第一句話必須是請他立刻撥打 119 或立即送急診，之後才做簡短說明；判為 3 級時，第一句話建議今天盡快前往急診。系統會依級數自動附上聯絡電話卡片，你不需要在文字中列電話號碼。

## 回答規則
1. 用繁體中文、白話（國中生能懂），200 字以內，語氣溫暖但不裝熟。
2. 回答必須針對「這位病人」個人化：主動連結他的手術、共病、用藥（例如提到他實際在吃的藥名）。
3. citations 填入你實際引用的衛教資料 id（如 "E2"）；沒有引用就填空陣列。不可捏造資料內容。answer 文字中不要出現 E1、E2 這類代號——來源只放在 citations 欄位，介面會自動顯示成標籤。
4. 凡涉及臨床決策——恢復或調整用藥、劑量、是否需要回診、症狀是否嚴重——needs_doctor_confirmation 設為 true，並在回答中明說「這需要由你的醫師確認」。
5. 若病人描述疑似紅旗症狀（高燒、傷口裂開滲液、大量出血、劇烈疼痛），先建議他立刻用「每日回報」記錄並聯絡醫療團隊或回診，不要只給衛教。
6. 不確定的事直說不確定，寧可保守。`;
}

function summaryPrompt(patient, stats, questions) {
  return `你是 CareLoop 的醫師端摘要產生器。以下是病人 ${patient.name}（${patient.surgery.name}，手術日 ${patient.surgery.date}）過去回報的統計與待答問題，請用醫師視角寫出最多 4 條重點，每條 35 字以內、可直接口頭轉述，先講最需要醫師注意的事。

統計：${JSON.stringify(stats)}
病人累積想問的問題：${JSON.stringify(questions)}`;
}

const SAFE_REFUSAL_REPLY = {
  answer: "這個問題我沒辦法在這裡回答，建議直接聯絡你的醫療團隊詢問。",
  citations: [],
  needs_doctor_confirmation: true,
  triage_level: 0,
};

// ---------- OpenAI（GPT API） ----------

async function openaiJSON({ system, messages, schemaName, schema }) {
  const completion = await openaiClient.chat.completions.create({
    model: OPENAI_MODEL,
    max_completion_tokens: 2048,
    messages: [{ role: "system", content: system }, ...messages],
    response_format: {
      type: "json_schema",
      json_schema: { name: schemaName, strict: true, schema },
    },
  });
  const msg = completion.choices[0].message;
  if (msg.refusal) return null; // 交由呼叫端給安全回覆
  return JSON.parse(msg.content);
}

// ---------- Anthropic（Claude API） ----------

async function anthropicJSON({ system, messages, schema }) {
  const response = await anthropicClient.beta.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    ...(system ? { system } : {}),
    messages,
  });
  if (response.stop_reason === "refusal") return null;
  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  return JSON.parse(text);
}

// ---------- 對外介面 ----------

async function answerQuestion({ patient, education, question, history = [] }) {
  const system = chatSystemPrompt(patient, education);
  const messages = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: question },
  ];

  if (PROVIDER === "mock") return mockAnswer({ patient, question });

  try {
    let result;
    if (PROVIDER === "openai") {
      result = await openaiJSON({ system, messages, schemaName: "chat_reply", schema: CHAT_JSON_SCHEMA });
    } else {
      result = await anthropicJSON({ system, messages, schema: CHAT_JSON_SCHEMA });
    }
    if (!result) return { ...SAFE_REFUSAL_REPLY, mode: PROVIDER };
    if (!Number.isInteger(result.triage_level) || result.triage_level < 0 || result.triage_level > 5) {
      result.triage_level = 0;
    }
    return { ...result, mode: PROVIDER };
  } catch (err) {
    console.warn(`[llm] ${PROVIDER} 呼叫失敗，降級 mock：`, err.message);
    return { ...mockAnswer({ patient, question }), mode: "mock-fallback" };
  }
}

async function summarize({ patient, stats, questions }) {
  if (PROVIDER === "mock") return mockSummary({ patient, stats, questions });

  const messages = [{ role: "user", content: summaryPrompt(patient, stats, questions) }];
  try {
    let result;
    if (PROVIDER === "openai") {
      result = await openaiJSON({
        system: "你是醫療照護平台的摘要產生器，只輸出符合 schema 的 JSON。",
        messages,
        schemaName: "doctor_summary",
        schema: SUMMARY_JSON_SCHEMA,
      });
    } else {
      result = await anthropicJSON({ messages, schema: SUMMARY_JSON_SCHEMA });
    }
    if (!result) return { ...mockSummary({ patient, stats, questions }), mode: "mock-fallback" };
    return { ...result, mode: PROVIDER };
  } catch (err) {
    console.warn(`[llm] ${PROVIDER} 摘要失敗，降級 mock：`, err.message);
    return { ...mockSummary({ patient, stats, questions }), mode: "mock-fallback" };
  }
}

// ---------- 離線 mock（斷網備案；回答內容仍個人化自病歷資料） ----------

// 關鍵字版檢傷判級（離線備案用；線上模式由 LLM 對照完整分類表判定）
function mockTriage(q) {
  if (/(沒有呼吸|心跳停止|發紫|發青|叫不醒|完全沒反應|抽搐.*(不停|沒有意識)|意識不清)/.test(q)) return 1;
  if (/((胸悶|胸痛).*(冒冷汗|喘)|冒冷汗.*(胸悶|胸痛)|喘不過氣|呼吸困難|(大量|不止|止不住).*(出血|流血)|(出血|流血).*(不止|止不住)|嘔血|吐血|黑便|突然看不(到|清)|講話.*不清楚|半邊.*無力)/.test(q)) return 2;
  if (/(走.*就喘|吐個不停|一直吐|拉個不停|腹瀉不止|腫脹變形|疑似骨折|咖啡色嘔吐)/.test(q)) return 3;
  if (/((滲液|流膿|黃黃的液體).*(發燒|越來越)|(發燒|越來越痛).*(滲液|流膿|黃黃的液體)|蜂窩性組織炎)/.test(q)) return 4;
  return 0;
}

function mockAnswer({ patient, question }) {
  const q = question;
  const anticoag = patient.medications.find((m) => m.name.includes("Warfarin"));
  const triage = mockTriage(q);
  let out;

  if (triage >= 1 && triage <= 2) {
    out = {
      answer: `請立刻撥打 119 或請家人馬上送你到急診，不要再觀察等待。你描述的狀況（依急診檢傷分類屬第 ${triage} 級）需要立即由醫療人員處理。就醫時請告知你是 ${patient.surgery.name} 術後病人（手術日 ${patient.surgery.date}）與目前用藥。我已通知照護團隊留意你的狀況。`,
      citations: [],
      needs_doctor_confirmation: true,
    };
  } else if (triage === 3) {
    out = {
      answer: `建議你今天盡快前往急診評估（依急診檢傷分類屬第 3 級）。出發前可先聯絡急診說明你是 ${patient.surgery.name} 術後病人；若途中症狀突然加重，請改撥 119。也請把這次狀況記錄在「每日回報」。`,
      citations: [],
      needs_doctor_confirmation: true,
    };
  } else if (anticoag && /(抗凝血|可化凝|warfarin|恢復.*藥|停藥)/i.test(q)) {
    out = {
      answer: `${patient.nickname}你好：你的病歷顯示術前已依醫囑停用 ${anticoag.name.split("（")[0]}（抗凝血劑）。什麼時候恢復服用，要看傷口出血狀況，必須由${patient.surgery.surgeon.split(" ")[1] || "你的醫師"}決定，請不要自行恢復或調整劑量。我已把這個問題記進你的回診清單，${patient.surgery.next_visit} 回診時醫師會跟你確認。`,
      citations: ["E2"],
      needs_doctor_confirmation: true,
    };
  } else if (/(傷口|紅|腫|滲|裂)/.test(q)) {
    out = {
      answer: `術後前兩週傷口輕微紅腫、緊繃是常見的。但如果紅腫範圍擴大、摸起來發熱、有滲液，或體溫超過 38 度，就可能是感染徵象，請立刻用「每日回報」記錄並聯絡醫療團隊。${patient.comorbidities.includes("第2型糖尿病") ? "另外你有糖尿病，傷口癒合會比較慢，血糖藥請按時吃、留意血糖。" : ""}`,
      citations: ["E1", "E3", "E5"],
      needs_doctor_confirmation: false,
    };
  } else if (/(智齒|拔牙|漱口|吸管|乾性)/.test(q)) {
    out = {
      answer: `拔牙後 24 小時內不要漱口、不要用吸管，避免血塊脫落。前兩天冰敷、吃溫涼軟的食物；腫脹通常第 2–3 天最明顯，之後會慢慢消。要注意：如果第 3–5 天疼痛反而越來越痛、還放射到耳朵附近，可能是乾性齒槽炎，請回診讓醫師處理。抗生素記得吃完整個療程。`,
      citations: ["E6", "E7", "E8"],
      needs_doctor_confirmation: false,
    };
  } else if (/(運動|復健|冰敷|走路)/.test(q)) {
    out = {
      answer: `可以每次冰敷 15–20 分鐘、一天數次來減輕腫痛。復健運動照醫囑循序漸進：踝關節幫浦、股四頭肌用力、彎曲角度練習。運動後有點痠是正常的，但如果疼痛明顯加劇或膝蓋異常腫脹，先暫停並在「每日回報」記錄，讓醫療團隊看到。`,
      citations: ["E4"],
      needs_doctor_confirmation: false,
    };
  } else {
    out = {
      answer: `這個問題我幫你記下來了，會整理進 ${patient.surgery.next_visit} 回診的問題清單，由${patient.surgery.surgeon}當面回覆你。如果是身體不舒服的變化，麻煩先用「每日回報」記錄，讓醫療團隊即時看到。`,
      citations: [],
      needs_doctor_confirmation: true,
    };
  }
  return { ...out, triage_level: triage, mode: "mock" };
}

function mockSummary({ stats, questions }) {
  const bullets = [];
  bullets.push(`疼痛 ${stats.firstPain}→${stats.lastPain} 分，${stats.painTrend === "down" ? "恢復趨勢良好" : "未見改善，需評估"}`);
  if (stats.redCount > 0) bullets.push(`期間出現 ${stats.redCount} 次紅色警示，請優先確認`);
  else if (stats.yellowCount > 0) bullets.push(`${stats.yellowCount} 次黃色注意（含體溫偏高／漏藥），已回穩`);
  bullets.push(`服藥依從 ${stats.adherence}%，共回報 ${stats.days} 天`);
  if (questions.length > 0) bullets.push(`病人累積 ${questions.length} 個待答問題，見下方清單`);
  return { bullets, mode: "mock" };
}

module.exports = {
  answerQuestion,
  summarize,
  MODE: PROVIDER,
  MODEL: PROVIDER === "openai" ? OPENAI_MODEL : PROVIDER === "anthropic" ? ANTHROPIC_MODEL : "-",
};
