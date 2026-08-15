const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

const { startServer } = require("../server");

let server;
let baseUrl;

before(async () => {
  server = startServer(0);
  if (!server.listening) await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test("新版 UI 保留雙助理模式選擇", async () => {
  const html = await (await fetch(baseUrl)).text();
  assert.match(html, /id="root"/);
  const scriptPath = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
  assert.ok(scriptPath);
  const clientBundle = await (await fetch(`${baseUrl}${scriptPath}`)).text();
  assert.match(clientBundle, /切換對話模式/);
  assert.match(clientBundle, /生活追蹤模式/);
  assert.match(clientBundle, /圖片僅在本機預覽/);
  assert.match(clientBundle, /語音功能尚未開放/);
  assert.match(clientBundle, /CuriLoop 正在回覆/);
  assert.match(clientBundle, /開始您的/);
  assert.match(clientBundle, /Demo 模式不執行真實身分驗證/);
  assert.match(clientBundle, /登出 Demo 帳號/);
  assert.match(clientBundle, /CuriLoop/);
  assert.doesNotMatch(clientBundle, /CareLoop/);
  assert.match(clientBundle, /重述醫病關係/);
  assert.match(clientBundle, /專屬於每個人的健康照護助手/);
  assert.doesNotMatch(clientBundle, /Demo patient portal/);

  const response = await fetch(`${baseUrl}/api/mode`);
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.ok(Array.isArray(status.available));
  assert.ok(status.available.includes("mock"));
});

test("Agent 2 時間軸依時間排序且只保留病人來源內容", async () => {
  const response = await fetch(`${baseUrl}/api/agent2/timeline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ patient_name: "陳怡安" }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.events.length > 0);
  assert.deepEqual(
    payload.events.map((event) => event.timestamp),
    payload.events.map((event) => event.timestamp).sort((a, b) => new Date(a) - new Date(b))
  );
  assert.ok(payload.events.every((event) => event.speaker === "patient"));
  assert.ok(payload.events.every((event) => !/回答：/.test(event.text)));
});

test("營養模式對話不進入醫師資料包或待答問題", async () => {
  await fetch(`${baseUrl}/api/mode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "mock" }),
  });

  const beforeExport = await (await fetch(`${baseUrl}/api/export/p1`)).json();
  const beforeTimeline = await (
    await fetch(`${baseUrl}/api/agent2/timeline`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patient_id: "p1" }),
    })
  ).json();

  const chatResponse = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      patientId: "p1",
      question: "我今天早餐吃了什麼比較好？",
      history: [],
      assistantMode: "nutrition",
    }),
  });
  assert.equal(chatResponse.status, 200);

  const afterExport = await (await fetch(`${baseUrl}/api/export/p1`)).json();
  const afterTimeline = await (
    await fetch(`${baseUrl}/api/agent2/timeline`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patient_id: "p1" }),
    })
  ).json();
  assert.equal(afterExport.consultations.count, beforeExport.consultations.count);
  assert.equal(afterExport.pending_questions.length, beforeExport.pending_questions.length);
  assert.equal(afterTimeline.events.length, beforeTimeline.events.length);
});
