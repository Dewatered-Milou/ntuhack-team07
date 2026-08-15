const express = require("express");
const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { evaluate } = require("./lib/redflags");
const llm = require("./lib/llm");

const app = express();
app.use(express.json());
const frontendDirectory = fs.existsSync(path.join(__dirname, "dist"))
  ? path.join(__dirname, "dist")
  : path.join(__dirname, "public");
app.use(express.static(frontendDirectory));

const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(__dirname, p), "utf8"));
const patients = readJSON("data/patients.json");
const education = readJSON("data/education.json");
const redflagRules = readJSON("data/redflags.json").rules;
const triage = readJSON("data/triage.json");
const hospitals = readJSON("data/hospitals.json");

// 諮詢結論分級（consult_level 1–4）→ 對話框呈現設定。
// 這是「這則諮詢最後該怎麼被處理」的分流，跟 triage_level（急診檢傷細節）是兩個維度：
// Level 1–2 沿用 triage_level 的官方檢傷表 advice／等候時間／聯絡電話（較具體、可動作）；
// Level 3（Review）／4（衛教）沒有對應的檢傷表項目，用固定文案，且不附緊急聯絡電話——
// 這兩級本來就不要求病人做任何事，附電話號碼反而像在暗示「這也很急」。
const pickContact = (ids) => ids.map((id) => hospitals.find((h) => h.id === id)).filter(Boolean);

// 診所資訊：取代原本的官方來源引用——病人看到「該就醫」的卡片時，更需要知道要找誰、
// 什麼時候已經有排定的回診，而不是分級依據的公文出處。
const clinicInfo = (patient) => `${patient.surgery.surgeon}｜下次回診 ${patient.surgery.next_visit}`;

function buildConclusion(consultLevel, triageLevel, patient) {
  if (!consultLevel || consultLevel < 1 || consultLevel > 4) return null;

  if (consultLevel === 1) {
    const cfg = triage.levels.find((l) => l.level === (triageLevel === 1 ? 1 : 2));
    return {
      level: 1,
      label: "緊急・請立即就醫",
      detail: cfg ? cfg.advice : "這屬於危急狀況，請立刻撥打 119 或由家人立即送急診，不要等待或觀察。",
      clinic: clinicInfo(patient),
      contacts: pickContact(["ems", "er"]),
    };
  }
  if (consultLevel === 2) {
    const cfg = triage.levels.find((l) => l.level === (triageLevel === 3 || triageLevel === 4 ? triageLevel : 3));
    return {
      level: 2,
      label: "建議儘速安排回診",
      detail: cfg ? cfg.advice : "建議儘速安排門診評估，不需要叫救護車；若症狀突然加重，請改撥 119。",
      clinic: clinicInfo(patient),
      contacts: pickContact(["team", "er"]),
    };
  }
  if (consultLevel === 3) {
    return {
      level: 3,
      label: "已整理送醫師審閱",
      detail: "這則諮詢屬於一般性問題，已整理進醫師端的照護諮詢紀錄。是否需要回診、調整用藥或僅需衛教回覆，將由醫師審閱後決定，目前不需要你採取任何行動。",
      clinic: clinicInfo(patient),
      contacts: [],
    };
  }
  // consultLevel === 4
  return {
    level: 4,
    label: "衛教資訊・可自我照護",
    detail: "這是一般衛教資訊，供你自我照護參考，不需要醫師介入。若狀況有變化，仍可隨時再詢問，或使用「每日回報」記錄。",
    clinic: clinicInfo(patient),
    contacts: [],
  };
}

// Demo 用 in-memory 資料：重啟即重置回種子資料，方便反覆彩排。
const reports = readJSON("data/seed-reports.json");
for (const pid of Object.keys(reports)) {
  reports[pid] = reports[pid].map((r) => ({ ...r, flag: evaluate(r, redflagRules) }));
}
// 照護諮詢歷史：每一次問答都留下完整時間點（ISO 8601），供醫師端系統調閱分析
const consultations = readJSON("data/seed-consultations.json");
for (const p of patients) consultations[p.id] = consultations[p.id] || [];
const pendingQuestions = Object.fromEntries(patients.map((p) => [p.id, []]));

const getPatient = (id) => patients.find((p) => p.id === id);

function normalizePatientName(value) {
  return String(value || "")
    .replace(/[（(]虛構[）)]/g, "")
    .trim();
}

function formatReportForTimeline(report) {
  const details = [
    Number.isFinite(report.pain) ? `疼痛 ${report.pain}/10` : null,
    Number.isFinite(report.temp) ? `體溫 ${report.temp}°C` : null,
    Array.isArray(report.wound) && report.wound.length ? `傷口：${report.wound.join("、")}` : null,
    `服藥：${report.meds_taken ? "有按時服用" : "未按時服用或未確認"}`,
    report.mood ? `心情：${report.mood}` : null,
    report.note ? `補充：${report.note}` : null,
  ].filter(Boolean);
  return `每日回報：${details.join("；")}`;
}

app.get("/api/patients", (_req, res) => {
  res.json(patients.map(({ id, name, nickname, surgery, phase }) => ({ id, name, nickname, surgery, phase })));
});

app.get("/api/patient/:id", (req, res) => {
  const p = getPatient(req.params.id);
  if (!p) return res.status(404).json({ error: "patient not found" });
  res.json(p);
});

// 病人端聊天：載入個人病歷＋衛教資料，回答附引用與「需醫師確認」標註
// assistantMode：生活追蹤模式（"lifestyle"，預設）／營養諮詢模式（"nutrition"）——切換的是系統提示詞人格，
// 不是 LLM 供應商；供應商仍由 lib/llm.js 的 currentProvider 決定。
app.post("/api/chat", async (req, res) => {
  const { patientId, question, history, assistantMode } = req.body || {};
  const patient = getPatient(patientId);
  if (!patient || !question) return res.status(400).json({ error: "patientId and question required" });
  const resolvedAssistantMode = assistantMode === "nutrition" ? "nutrition" : "lifestyle";
  try {
    const result = await llm.answerQuestion({ patient, education, question, history, assistantMode: resolvedAssistantMode });
    const now = new Date().toISOString();
    // 每一次諮詢問答都留下時間點與完整內容，納入醫師端資料包——營養諮詢模式不用打包對話資料
    if (resolvedAssistantMode !== "nutrition") {
      consultations[patientId].push({
        timestamp: now,
        question,
        answer: result.answer,
        assistant_mode: resolvedAssistantMode,
        citations: result.citations || [],
        needs_doctor_confirmation: result.needs_doctor_confirmation,
        triage_level: result.triage_level,
        consult_level: result.consult_level,
      });
    }
    if (resolvedAssistantMode !== "nutrition" && result.needs_doctor_confirmation) {
      (pendingQuestions[patientId] = pendingQuestions[patientId] || []).push({
        date: now.slice(0, 10),
        timestamp: now,
        question,
      });
    }
    const cited = (result.citations || [])
      .map((id) => education.find((e) => e.id === id))
      .filter(Boolean)
      .map(({ id, title, source }) => ({ id, title, source }));
    res.json({ ...result, cited, conclusion: buildConclusion(result.consult_level, result.triage_level, patient) });
  } catch (err) {
    console.error("chat error:", err.message);
    res.status(500).json({ error: "LLM 呼叫失敗：" + err.message });
  }
});

// 症狀回報：結構化儲存＋紅旗規則引擎即時分級
app.post("/api/report", (req, res) => {
  const { patientId, pain, temp, wound, meds_taken, mood, note } = req.body || {};
  const patient = getPatient(patientId);
  if (!patient) return res.status(400).json({ error: "patientId required" });
  const now = new Date().toISOString();
  const report = {
    date: now.slice(0, 10),
    timestamp: now,
    pain: Number(pain),
    temp: Number(temp),
    wound: Array.isArray(wound) ? wound : [],
    meds_taken: Boolean(meds_taken),
    mood: mood || "普通",
    note: note || "",
  };
  report.flag = evaluate(report, redflagRules);
  reports[patientId] = reports[patientId] || [];
  reports[patientId].push(report);
  res.json({ report });
});

app.get("/api/reports/:patientId", (req, res) => {
  res.json(reports[req.params.patientId] || []);
});

// 每日回報的確定性統計（摘要與資料包共用）
function computeStats(list) {
  const pains = list.map((r) => r.pain);
  return {
    days: list.length,
    firstPain: pains[0] ?? null,
    lastPain: pains[pains.length - 1] ?? null,
    avgPain: pains.length ? Number((pains.reduce((a, b) => a + b, 0) / pains.length).toFixed(1)) : null,
    painTrend: pains.length >= 2 ? (pains[pains.length - 1] < pains[0] ? "down" : "flat_or_up") : "unknown",
    redCount: list.filter((r) => r.flag.level === "red").length,
    yellowCount: list.filter((r) => r.flag.level === "yellow").length,
    adherence: list.length ? Math.round((list.filter((r) => r.meds_taken).length / list.length) * 100) : null,
    maxTemp: list.length ? Math.max(...list.map((r) => r.temp)) : null,
  };
}

// 醫師端門診前摘要：確定性統計＋LLM 重點條列
app.get("/api/summary/:patientId", async (req, res) => {
  const patient = getPatient(req.params.patientId);
  if (!patient) return res.status(404).json({ error: "patient not found" });
  const list = reports[req.params.patientId] || [];
  const questions = pendingQuestions[req.params.patientId] || [];
  const stats = computeStats(list);

  try {
    const { bullets, mode } = await llm.summarize({ patient, stats, questions });
    res.json({ patient, stats, bullets, questions, reports: list, mode });
  } catch (err) {
    console.error("summary error:", err.message);
    res.status(500).json({ error: "LLM 呼叫失敗：" + err.message });
  }
});

// 醫師端資料包：打包「照護諮詢（含時間點）＋每日回報」歷史，供醫師端系統調閱分析。
// 可用 ?from=YYYY-MM-DD&to=YYYY-MM-DD 篩選區間（含頭尾）。
// timestamp 一律為 ISO 8601，取前 10 碼即為日期，可直接與 from/to 做字串比較。
app.get("/api/export/:patientId", (req, res) => {
  const patient = getPatient(req.params.patientId);
  if (!patient) return res.status(404).json({ error: "patient not found" });

  const { from, to } = req.query;
  const inRange = (dateStr) => (!from || dateStr >= from) && (!to || dateStr <= to);

  const consultationList = (consultations[patient.id] || []).filter((c) =>
    inRange(String(c.timestamp).slice(0, 10))
  );
  const reportList = (reports[patient.id] || []).filter((r) => inRange(r.date));
  const questionList = (pendingQuestions[patient.id] || []).filter((q) => inRange(q.date));

  res.json({
    resource_type: "careloop.patient_history_bundle",
    version: "1.0",
    generated_at: new Date().toISOString(),
    range: { from: from || null, to: to || null },
    patient,
    consultations: {
      count: consultationList.length,
      needs_doctor_confirmation_count: consultationList.filter((c) => c.needs_doctor_confirmation).length,
      records: consultationList,
    },
    daily_reports: {
      count: reportList.length,
      stats: computeStats(reportList),
      records: reportList,
    },
    pending_questions: questionList,
  });
});

// Agent 2 專用的最小化時間軸介面。只輸出病人原始提問與每日回報，
// 不把 Agent 1 生成答案、營養模式對話或模型資訊誤當成病人陳述。
app.post("/api/agent2/timeline", (req, res) => {
  const configuredToken = process.env.AGENT1_API_TOKEN;
  if (configuredToken) {
    const suppliedToken = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (suppliedToken !== configuredToken) return res.status(401).json({ error: "unauthorized" });
  }

  const requestedName = normalizePatientName(req.body?.patient_name);
  const requestedId = String(req.body?.patient_id || "").trim();
  const patient = patients.find(
    (candidate) =>
      (requestedId && candidate.id === requestedId) ||
      (requestedName && normalizePatientName(candidate.name) === requestedName)
  );
  if (!patient) return res.status(404).json({ error: "patient not found" });

  const consultationEvents = (consultations[patient.id] || [])
    .filter((item) => item.assistant_mode !== "nutrition")
    .map((item, index) => ({
      event_id: `consultation_${patient.id}_${index + 1}`,
      timestamp: item.timestamp,
      speaker: "patient",
      type: "dialogue",
      text: item.question,
      source: "agent_1_lifestyle_consultation",
    }));
  const reportEvents = (reports[patient.id] || []).map((item, index) => ({
    event_id: `report_${patient.id}_${index + 1}`,
    timestamp: item.timestamp || `${item.date}T12:00:00+08:00`,
    speaker: "patient",
    type: "daily_report",
    text: formatReportForTimeline(item),
    source: "agent_1_daily_report",
  }));
  const events = [...consultationEvents, ...reportEvents].sort(
    (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
  );

  res.json({
    schema_version: "1.0",
    patient_id: patient.id,
    encounter_id: `agent1_${patient.id}_timeline`,
    timezone: "Asia/Taipei",
    events,
  });
});

// 模型模式：讀取／切換目前使用的 LLM 供應商（GPT API／Claude API／離線示範模式）。
// 給前端輸入框下方的「MODEL MODE」下拉選單用，方便 Demo 現場臨時切換，不需重啟伺服器。
app.get("/api/mode", (_req, res) => {
  res.json(llm.getStatus());
});

app.post("/api/mode", (req, res) => {
  const { mode } = req.body || {};
  try {
    res.json(llm.setProvider(mode));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function startServer(port = Number(process.env.AGENT1_PORT || process.env.PORT || 3001)) {
  const server = app.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    console.log(`CuriLoop Agent 1 → http://localhost:${actualPort}`);
    const status = llm.getStatus();
    const label = {
      openai: `GPT API（${status.model}）`,
      anthropic: `Claude API（${status.model}）`,
      mock: "離線示範模式",
    };
    console.log(`LLM 模式：${label[status.mode] || status.mode}`);
  });
  return server;
}

if (require.main === module) startServer();

module.exports = { app, startServer };
