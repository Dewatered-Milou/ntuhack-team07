/* CareLoop demo 前端：分頁切換、病人端聊天、每日回報、醫師端摘要 */

const $ = (sel) => document.querySelector(sel);
const state = { patientId: null, patients: [], history: [], assistantMode: "lifestyle" };

// 引擎小字用的簡短顯示名稱；沒對到的話就把 model id 轉大寫當備援，不會顯示空白。
const MODEL_SHORT_NAME = { "gpt-5-mini": "GPT MINI", "gpt-5": "GPT 5", "claude-opus-5": "CLAUDE OPUS" };
const shortModelName = (id) => MODEL_SHORT_NAME[id] || (id || "").toUpperCase();

// 兩種對話人格——切換的是系統提示詞，不是底層 LLM 供應商（供應商顯示在選單下方的小字）。
const ASSISTANT_MODES = {
  lifestyle: {
    label: "生活追蹤模式",
    greeting: (p) => `${p.nickname}你好，我是你的照護助理。${p.phase === "treatment" ? "療程期間" : "手術後"}有任何不舒服或想問的，隨時跟我說；我的回答都會依據你的病歷和醫院的衛教資料。`,
  },
  nutrition: {
    label: "營養諮詢模式",
    greeting: (p) => `${p.nickname}您好，我是您的營養與生活教練，可以陪您聊聊體重、飲食、運動、睡眠、注射或副作用；如果身體有不舒服，也可以直接跟我說，我會視情況判斷需不需要盡快就醫。`,
  },
};

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
      if (btn.dataset.panel === "report") loadTimeline();
    });
  });

  $("#chat-form").addEventListener("submit", onChatSubmit);
  $("#report-form").addEventListener("submit", onReportSubmit);
}

function switchPatient(id) {
  state.patientId = id;
  renderChatIntro();
  loadTimeline();
}

// 換病人、換對話模式都要重置聊天紀錄（系統提示詞整個不一樣，不能把舊模式的對話歷史帶進新模式）
// 並換上對應人格的開場白；建議提問只在生活追蹤模式顯示，避免術後衛教快速提問出現在營養教練的語境下。
function renderChatIntro() {
  state.history = [];
  const p = state.patients.find((x) => x.id === state.patientId);
  const mode = ASSISTANT_MODES[state.assistantMode];
  $("#mode-dot").classList.toggle("nutrition", state.assistantMode === "nutrition");
  $("#chat-title").textContent = `照護問答 — ${p.nickname}（${p.surgery.name}）`;
  $("#chat-log").innerHTML = "";
  addBubble("ai", mode.greeting(p), []);
  const suggestions = state.assistantMode === "lifestyle" ? SUGGESTIONS[p.id] || [] : [];
  $("#chat-suggestions").innerHTML = suggestions.map((q) => `<button type="button">${q}</button>`).join("");
  $("#chat-suggestions").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => { $("#chat-input").value = b.textContent; onChatSubmit(new Event("submit")); })
  );
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
  thinking.className = "bubble ai thinking";
  thinking.innerHTML = `<span class="thinking-text">思考中</span><span class="thinking-dots"><span></span><span></span><span></span></span>`;
  $("#chat-log").appendChild(thinking);
  $("#chat-log").scrollTop = $("#chat-log").scrollHeight;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientId: state.patientId, question, history: state.history, assistantMode: state.assistantMode }),
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

/* ---------- 模型模式（輸入框下方的 MODEL MODE 選單）----------
   選單本身切的是「對話人格」（生活追蹤／營養諮詢），純前端狀態，換人格就重置聊天並換開場白。
   底層 LLM 供應商（GPT／Claude／離線）改成選單下方的小字顯示，不再由病人端切換。 */

async function initModelMode() {
  const sel = $("#model-mode-select");
  sel.innerHTML = Object.entries(ASSISTANT_MODES).map(([value, m]) => `<option value="${value}">${m.label}</option>`).join("");
  sel.value = state.assistantMode;
  sel.addEventListener("change", () => {
    state.assistantMode = sel.value;
    renderChatIntro();
  });

  const engineEl = $("#model-mode-engine");
  try {
    const { mode, models } = await (await fetch("/api/mode")).json();
    const label = mode === "openai" ? shortModelName(models.openai) : mode === "anthropic" ? shortModelName(models.anthropic) : "離線示範模式";
    engineEl.textContent = label;
  } catch {
    engineEl.textContent = "";
  }
}

/* ---------- 啟動 ---------- */

init().then(initModelMode);
