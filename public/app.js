/* CareLoop demo 前端：分頁切換、病人端聊天、每日回報、醫師端摘要 */

const $ = (sel) => document.querySelector(sel);
const state = { patientId: null, patients: [], history: [] };

const SUGGESTIONS = {
  p1: ["我什麼時候可以恢復吃可化凝？", "傷口有點紅腫正常嗎？", "我可以開始做哪些復健運動？"],
  p2: ["拔牙後可以漱口嗎？", "臉腫到什麼程度要回診？", "抗生素可以提早停嗎？"],
  p3: ["我的排糖藥什麼時候可以恢復吃？", "體重變重、走路會喘要注意什麼？", "胸口傷口痛可以吃止痛藥嗎？"],
  p4: ["抗血小板藥漏吃一次怎麼辦？", "手腕的瘀青正常嗎？", "多久之後可以提重物？"],
  p5: ["傷口越來越痛還流出黃黃的液體怎麼辦？", "發燒到幾度要去急診？", "抗生素忘記吃可以補吃嗎？"],
  p6: ["打完針一直想吐正常嗎？", "這週日晚上有事沒辦法打針怎麼辦？", "體重是不是掉太慢了？"],
};
const LEVEL_LABEL = { green: "● 綠｜穩定", yellow: "● 黃｜注意", red: "● 紅｜警示" };

/* ---------- 初始化 ---------- */

async function init() {
  const patients = await (await fetch("/api/patients")).json();
  state.patients = patients;
  const sel = $("#patient-select");
  sel.innerHTML = patients
    .map((p) => `<option value="${p.id}">${p.name}｜${p.surgery.name}</option>`)
    .join("");
  sel.addEventListener("change", () => switchPatient(sel.value));
  switchPatient(patients[0].id);

  document.querySelectorAll("nav.tabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      $("#panel-" + btn.dataset.panel).classList.add("active");
      if (btn.dataset.panel === "doctor") loadDoctor();
      if (btn.dataset.panel === "report") loadTimeline();
    });
  });

  $("#chat-form").addEventListener("submit", onChatSubmit);
  $("#report-form").addEventListener("submit", onReportSubmit);
  $("#export-btn").addEventListener("click", onExport);
}

function switchPatient(id) {
  state.patientId = id;
  state.history = [];
  const p = state.patients.find((x) => x.id === id);
  $("#chat-title").textContent = `照護問答 — ${p.nickname}（${p.surgery.name}）`;
  $("#chat-log").innerHTML = "";
  addBubble("ai", `${p.nickname}你好，我是你的照護助理。${p.phase === "treatment" ? "療程期間" : "手術後"}有任何不舒服或想問的，隨時跟我說；我的回答都會依據你的病歷和醫院的衛教資料。`, []);
  $("#chat-suggestions").innerHTML = (SUGGESTIONS[id] || [])
    .map((q) => `<button type="button">${q}</button>`)
    .join("");
  $("#chat-suggestions").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => { $("#chat-input").value = b.textContent; onChatSubmit(new Event("submit")); })
  );
  loadTimeline();
  if ($("#panel-doctor").classList.contains("active")) loadDoctor();
}

/* ---------- 病人端聊天 ---------- */

const CONCLUSION_CHIP_LABEL = { 3: "已送醫師審閱", 4: "衛教資訊" };

function addBubble(role, text, cited, needsConfirm, conclusion) {
  const div = document.createElement("div");
  div.className = "bubble " + role;
  div.textContent = text;
  if (role === "ai") {
    const badges = document.createElement("div");
    badges.className = "badges";
    if (cited && cited.length) {
      const chip = document.createElement("span");
      chip.className = "chip cite";
      chip.textContent = "來源：" + cited.map((c) => c.title).join("、");
      chip.title = cited.map((c) => c.source).join("\n");
      badges.appendChild(chip);
    }
    if (needsConfirm) {
      const chip = document.createElement("span");
      chip.className = "chip confirm";
      chip.textContent = "需醫師確認・已加入回診問題清單";
      badges.appendChild(chip);
    }
    // 結論 Level 3（Review）／4（衛教）：只加一顆小標籤，不另起卡片——這兩級不需要病人做任何事
    if (conclusion && (conclusion.level === 3 || conclusion.level === 4)) {
      const chip = document.createElement("span");
      chip.className = "chip level-" + conclusion.level;
      chip.textContent = CONCLUSION_CHIP_LABEL[conclusion.level];
      chip.title = conclusion.detail + (conclusion.clinic ? `｜你的診所：${conclusion.clinic}` : "");
      badges.appendChild(chip);
    }
    if (badges.children.length) div.appendChild(badges);
  }
  $("#chat-log").appendChild(div);
  $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
}

// 結論 Level 1（緊急危險）／2（優先回診非緊急）才起獨立卡片：
// Level 1 大紅卡、Level 2 中橙卡，兩者都附聯絡電話；Level 3／4 由 addBubble 的小標籤處理，不叫這支。
function addConclusionCard(conclusion) {
  const card = document.createElement("div");
  card.className = "conclusion level-" + conclusion.level;
  const contacts = conclusion.contacts
    .map(
      (c) => `
      <a class="contact" href="tel:${c.phone.replace(/-/g, "")}">
        <span class="c-phone">${c.phone}</span>
        <span class="c-name">${c.name}</span>
        <span class="c-note">${c.hours}｜${c.note}</span>
      </a>`
    )
    .join("");
  card.innerHTML = `
    <div class="cc-head">${conclusion.level === 1 ? "⚠ " : ""}${conclusion.label}</div>
    <div class="cc-detail">${conclusion.detail}</div>
    ${contacts ? `<div class="cc-contacts">${contacts}</div>` : ""}
    ${conclusion.clinic ? `<div class="cc-src">你的診所：${conclusion.clinic}</div>` : ""}`;
  $("#chat-log").appendChild(card);
  $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
}

async function onChatSubmit(e) {
  e.preventDefault();
  const input = $("#chat-input");
  const question = input.value.trim();
  if (!question) return;
  input.value = "";
  addBubble("user", question);
  const thinking = document.createElement("div");
  thinking.className = "bubble ai";
  thinking.textContent = "…";
  $("#chat-log").appendChild(thinking);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientId: state.patientId, question, history: state.history }),
    });
    const data = await res.json();
    thinking.remove();
    if (data.error) { addBubble("ai", "系統忙碌中，請再試一次。（" + data.error + "）", []); return; }
    addBubble("ai", data.answer, data.cited, data.needs_doctor_confirmation, data.conclusion);
    if (data.conclusion && data.conclusion.level <= 2) addConclusionCard(data.conclusion);
    state.history.push({ role: "user", content: question });
    state.history.push({ role: "assistant", content: data.answer });
  } catch (err) {
    thinking.remove();
    addBubble("ai", "連線失敗，請確認伺服器是否啟動。", []);
  }
}

/* ---------- 每日回報 ---------- */

async function onReportSubmit(e) {
  e.preventDefault();
  const wound = Array.from(document.querySelectorAll("#f-wound input:checked")).map((c) => c.value);
  const body = {
    patientId: state.patientId,
    pain: $("#f-pain").value,
    temp: $("#f-temp").value,
    wound,
    meds_taken: $("#f-meds").checked,
    mood: $("#f-mood").value,
  };
  const res = await fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const { report } = await res.json();
  const el = $("#report-result");
  el.innerHTML = `<span class="pill ${report.flag.level}">${LEVEL_LABEL[report.flag.level]}</span> ` +
    (report.flag.hits[0] ? report.flag.hits[0].message : "已記錄，狀況穩定");
  loadTimeline();
}

async function loadTimeline() {
  const list = await (await fetch("/api/reports/" + state.patientId)).json();
  $("#timeline").innerHTML = list.slice().reverse().map((r) => `
    <li>
      <span class="date">${r.date}</span>
      <span class="pill ${r.flag.level}">${LEVEL_LABEL[r.flag.level]}</span>
      <span>疼痛 ${r.pain}｜${r.temp}°C${r.wound.length ? "｜" + r.wound.join("、") : ""}${r.meds_taken ? "" : "｜未服藥"}${r.note ? "｜" + r.note : ""}</span>
      ${r.flag.hits.length ? `<span class="flag-msgs">${r.flag.hits.map((h) => h.message).join("；")}</span>` : ""}
    </li>`).join("");
}

/* ---------- 醫師端摘要 ---------- */

async function loadDoctor() {
  const [data, bundle] = await Promise.all([
    fetch("/api/summary/" + state.patientId).then((r) => r.json()),
    fetch("/api/export/" + state.patientId).then((r) => r.json()),
  ]);
  const p = data.patient;
  $("#doctor-title").textContent = `門診前 30 秒摘要 — ${p.name}（${p.age}歲，${p.surgery.name}）`;
  $("#doctor-sub").textContent = `${p.phase === "treatment" ? "療程開始" : "手術日"} ${p.surgery.date}｜回診 ${p.surgery.next_visit}｜共病：${p.comorbidities.join("、") || "無"}｜摘要模式：${data.mode}`;
  $("#doctor-bullets").innerHTML = data.bullets.map((b) => `<li>${b}</li>`).join("");

  const s = data.stats;
  $("#stat-row").innerHTML = `
    <div class="stat"><div class="v">${s.days}</div><div class="l">回報天數</div></div>
    <div class="stat"><div class="v">${s.avgPain ?? "–"}</div><div class="l">平均疼痛</div></div>
    <div class="stat ${s.redCount ? "alert" : ""}"><div class="v">${s.redCount}</div><div class="l">紅色警示次數</div></div>
    <div class="stat"><div class="v">${s.yellowCount}</div><div class="l">黃色注意次數</div></div>
    <div class="stat"><div class="v">${s.adherence ?? "–"}%</div><div class="l">服藥依從</div></div>`;

  drawPainChart(data.reports);
  $("#pain-table").innerHTML =
    "<tr><th>日期</th><th>疼痛</th><th>體溫</th><th>分級</th></tr>" +
    data.reports.map((r) => `<tr><td>${r.date}</td><td>${r.pain}</td><td>${r.temp}</td><td>${LEVEL_LABEL[r.flag.level]}</td></tr>`).join("");

  $("#q-list").innerHTML = data.questions.length
    ? data.questions.map((q) => `<li>${q.date}｜${q.question}</li>`).join("")
    : `<li class="hint">（尚無）</li>`;

  const consults = bundle.consultations.records;
  $("#consult-list").innerHTML = consults.length
    ? consults.slice().reverse().map((c) => `
      <li>
        <span class="date">${fmtTime(c.timestamp)}</span>｜${c.question}
        ${c.needs_doctor_confirmation ? `<span class="chip confirm">需醫師確認</span>` : ""}
        <details><summary class="hint">AI 當時的回答</summary><span class="hint">${c.answer}</span></details>
      </li>`).join("")
    : `<li class="hint">（尚無）</li>`;
}

/* ---------- 醫師端資料包匯出 ---------- */

// ISO 時間戳 → 「YYYY-MM-DD HH:mm」（顯示為瀏覽器本地時間）
function fmtTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function onExport() {
  try {
    const bundle = await (await fetch("/api/export/" + state.patientId)).json();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `careloop_${state.patientId}_${bundle.generated_at.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    $("#export-result").textContent =
      `已打包 ${bundle.consultations.count} 筆照護諮詢＋${bundle.daily_reports.count} 筆每日回報`;
  } catch {
    $("#export-result").textContent = "打包失敗，請確認伺服器是否啟動。";
  }
}

/* 疼痛趨勢折線圖：單一序列、細線、資料點可 hover，附表格替代檢視 */
function drawPainChart(reports) {
  const svg = $("#pain-chart");
  const tip = $("#chart-tip");
  const W = 640, H = 220, L = 36, R = 16, T = 14, B = 30;
  const n = reports.length;
  svg.innerHTML = "";
  if (n === 0) return;

  const x = (i) => (n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (1 - v / 10) * (H - T - B);
  const ns = "http://www.w3.org/2000/svg";
  const el = (tag, attrs) => {
    const node = document.createElementNS(ns, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  };

  for (let v = 0; v <= 10; v += 2) {
    svg.appendChild(el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: "#e7ece8", "stroke-width": 1 }));
    const label = el("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end", "font-size": 10, fill: "#8a938e" });
    label.textContent = v;
    svg.appendChild(label);
  }

  const pts = reports.map((r, i) => [x(i), y(r.pain)]);
  svg.appendChild(el("polyline", {
    points: pts.map((p) => p.join(",")).join(" "),
    fill: "none", stroke: "#1e6b52", "stroke-width": 2,
    "stroke-linejoin": "round", "stroke-linecap": "round",
  }));

  reports.forEach((r, i) => {
    const dotColor = r.flag.level === "red" ? "#b3261e" : r.flag.level === "yellow" ? "#b45309" : "#1e6b52";
    svg.appendChild(el("circle", { cx: pts[i][0], cy: pts[i][1], r: 4, fill: dotColor, stroke: "#ffffff", "stroke-width": 2 }));
    const tick = el("text", { x: pts[i][0], y: H - 10, "text-anchor": "middle", "font-size": 9, fill: "#8a938e" });
    tick.textContent = r.date.slice(5);
    svg.appendChild(tick);
  });

  const last = reports[n - 1];
  const lastLabel = el("text", { x: pts[n - 1][0], y: pts[n - 1][1] - 10, "text-anchor": "middle", "font-size": 11, "font-weight": 700, fill: "#1d2420" });
  lastLabel.textContent = last.pain;
  svg.appendChild(lastLabel);

  svg.onmousemove = (evt) => {
    const rect = svg.getBoundingClientRect();
    const mx = ((evt.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(pts[i][0] - mx) < Math.abs(pts[best][0] - mx)) best = i;
    const r = reports[best];
    tip.style.display = "block";
    tip.style.left = (pts[best][0] / W) * rect.width + "px";
    tip.style.top = (pts[best][1] / H) * rect.height + "px";
    tip.textContent = `${r.date}｜疼痛 ${r.pain} 分｜${r.temp}°C`;
  };
  svg.onmouseleave = () => { tip.style.display = "none"; };
}

/* ---------- 啟動 ---------- */

init().then(async () => {
  try {
    const res = await fetch("/api/summary/" + state.patientId);
    const { mode } = await res.json();
    const label = { openai: "GPT API 連線中", anthropic: "Claude API 連線中", mock: "離線示範模式", "mock-fallback": "API 異常・已降級離線模式" };
    $("#mode-badge").textContent = label[mode] || mode;
  } catch { $("#mode-badge").textContent = "離線"; }
});
