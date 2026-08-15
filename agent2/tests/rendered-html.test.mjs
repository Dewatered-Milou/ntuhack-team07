import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html", host: "localhost" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function callApi(body) {
  delete process.env.OPENAI_API_KEY;
  delete process.env.AGENT1_API_URL;
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("api-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/api/agent2", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost" },
      body: JSON.stringify(body),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the CuriLoop Agent 2 application", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /CuriLoop/);
  assert.doesNotMatch(html, /Clinote AI/);
  assert.match(html, /病患時序摘要/);
  assert.match(html, /病患諮詢/);
  assert.doesNotMatch(html, /REFERENCE DEMO/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /Your site is taking shape/);
  assert.doesNotMatch(html, /(?:\/Users\/|\/home\/|[A-Za-z]:\\).*?\.vinext/);
  assert.doesNotMatch(html, /\.vinext\/fonts/);
});

test("starter preview is removed and project metadata is present", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Agent2App/);
  assert.match(layout, /og\.png/);
  assert.match(layout, /zh-Hant-TW/);
  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(packageJson, /"name": "curiloop-agent2"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await access(new URL("../public/og.png", import.meta.url));
  await access(templateRoot);
});

test("reference demo works end to end without Agent 1 or an OpenAI key", async () => {
  const response = await callApi({ patient_name: "陳怡安（虛構）" });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.source_mode, "demo");
  assert.equal(payload.ai_mode, "reference_demo");
  assert.equal(payload.events.length, 5);
  assert.equal(payload.summary.format_version, "summary-1.0");
  assert.equal(payload.summary.attention.level, "urgent");
  assert.match(payload.summary.patient_questions[1].text, /1\.0 mg/);
  assert.equal("soap" in payload.summary, false);
});

test("summary view provides a clear patient-switch action", async () => {
  const app = await readFile(new URL("../app/Agent2App.tsx", import.meta.url), "utf8");
  assert.match(app, /病患姓名/);
  assert.match(app, /分析病患諮詢/);
  assert.doesNotMatch(app, /把散落的對話/);
  assert.doesNotMatch(app, /REFERENCE DEMO/);
  assert.match(app, /更換病患/);
  assert.match(app, /setResult\(null\)/);
  assert.match(app, /setPatientName\(""\)/);
});

test("an arbitrary name is not silently paired with the reference demo", async () => {
  const response = await callApi({ patient_name: "測試病患" });
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.match(payload.error, /Agent 1 尚未設定/);
  assert.equal(payload.summary, undefined);
});
