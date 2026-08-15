require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");

const { evaluate } = require("./lib/redflags");
const llm = require("./lib/llm");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(__dirname, p), "utf8"));
const patients = readJSON("data/patients.json");
const education = readJSON("data/education.json");
const redflagRules = readJSON("data/redflags.json").rules;
const triage = readJSON("data/triage.json");
const hospitals = readJSON("data/hospitals.json");

// 檢傷級數 → 緊急處置卡（1–4 級顯示；5 級與 0 不顯示）
function buildEmergency(level) {
  if (!level || level < 1 || level > 4) return null;
  const cfg = triage.levels.find((l) => l.level === level);
  if (!cfg) return null;
  return {
    level,
    name: cfg.name,
    wait: cfg.wait,
    severity: cfg.severity,
    advice: cfg.advice,
    source: triage.source,
    contacts: cfg.contacts.map((id) => hospitals.find((h) => h.id === id)).filter(Boolean),
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

app.get("/api/patients", (_req, res) => {
  res.json(patients.map(({ id, name, nickname, surgery, phase }) => ({ id, name, nickname, surgery, phase })));
});

app.get("/api/patient/:id", (req, res) => {
  const p = getPatient(req.params.id);
  if (!p) return res.status(404).json({ error: "patient not found" });
  res.json(p);
});

// 病人端聊天：載入個人病歷＋衛教資料，回答附引用與「需醫師確認」標註
app.post("/api/chat", async (req, res) => {
  const { patientId, question, history } = req.body || {};
  const patient = getPatient(patientId);
  if (!patient || !question) return res.status(400).json({ error: "patientId and question required" });
  try {
    const result = await llm.answerQuestion({ patient, education, question, history });
    const now = new Date().toISOString();
    // 每一次諮詢問答都留下時間點與完整內容，納入醫師端資料包
    consultations[patientId].push({
      timestamp: now,
      question,
      answer: result.answer,
      citations: result.citations || [],
      needs_doctor_confirmation: result.needs_doctor_confirmation,
      triage_level: result.triage_level,
    });
    if (result.needs_doctor_confirmation) {
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
    res.json({ ...result, cited, emergency: buildEmergency(result.triage_level) });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CareLoop demo → http://localhost:${PORT}`);
  const label = { openai: `GPT API（${llm.MODEL}）`, anthropic: `Claude API（${llm.MODEL}）`, mock: "離線示範模式（未設定金鑰）" };
  console.log(`LLM 模式：${label[llm.MODE] || llm.MODE}`);
});
