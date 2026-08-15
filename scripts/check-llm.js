// 貼上金鑰後跑這支確認串接成功：node scripts/check-llm.js
// 成功會印出目前供應商、模型與一則真實回答；失敗會印出錯誤原因（金鑰、模型名、額度）。
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const llm = require("../lib/llm");

(async () => {
  console.log(`供應商：${llm.MODE}｜模型：${llm.MODEL}`);
  if (llm.MODE === "mock") {
    console.log("尚未設定金鑰（.env 填 OPENAI_API_KEY 後重跑）——目前為離線 mock 模式，demo 仍可運作。");
  }
  const patients = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/patients.json"), "utf8"));
  const education = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/education.json"), "utf8"));
  const result = await llm.answerQuestion({
    patient: patients[0],
    education,
    question: "我什麼時候可以恢復吃可化凝？",
  });
  console.log("回答：", result.answer);
  console.log("引用：", result.citations, "｜需醫師確認：", result.needs_doctor_confirmation, "｜mode：", result.mode);
  if (result.mode === "mock-fallback") {
    console.log("⚠ API 呼叫失敗已降級 mock——請看上方警告訊息檢查金鑰或模型名稱。");
  }
})();
