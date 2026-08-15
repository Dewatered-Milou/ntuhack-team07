# CareLoop — 雙向 AI 醫病溝通平台（Hackathon Demo 骨架）

術前–術後照護楔子的三畫面 demo：**病人端照護問答**（個人病歷 grounding＋來源引用）→ **每日症狀回報**（結構化＋紅旗規則分級）→ **醫師端門診前 30 秒摘要**。

## 快速開始

```bash
cd careloop-demo
npm install
npm start        # → http://localhost:3000
```

- **接上 GPT API**：`copy .env.example .env`，填入主辦提供的 `OPENAI_API_KEY` 後重啟，聊天與醫師摘要即走 GPT（預設 `gpt-5-mini`，可用 `OPENAI_MODEL` 換）。跑 `node scripts/check-llm.js` 一鍵驗證串接是否成功。
- **不設定金鑰也能跑**：自動進入「離線示範模式」，聊天與摘要用內建的個人化 mock 回答；**真 API 呼叫失敗也會自動降級 mock**，聊天不會死在台上——這就是 Demo Day 的斷網備案，請至少用它彩排一次。
- 也支援 Claude API 作為備選（填 `ANTHROPIC_API_KEY`；兩把都填時 OpenAI 優先，可用 `PROVIDER` 強制指定）。
- 回報資料存在記憶體，**重啟伺服器即重置回種子資料**，方便反覆彩排。

## 檔案地圖（誰改哪裡）

| 檔案 | 內容 | 負責人 |
|---|---|---|
| `data/patients.json` | 合成病人（王阿姨 TKA 術後＋柏睿智齒術後） | **醫學生 A**：補齊臨床細節、確認合理性 |
| `data/education.json` | 衛教知識片段（聊天引用來源） | **醫學生 A**：換成醫院公開衛教單原文並補來源 |
| `data/redflags.json` | 紅旗分級規則表（綠/黃/紅） | **醫學生 A**：審核修訂閾值與訊息 |
| `data/triage.json` | 急診檢傷分類表（數位化自衛福部《檢傷分類民眾衛教版》）＋各級處置建議 | **醫學生 A**：審核 advice 文字與級數判斷規則 |
| `data/hospitals.json` | 緊急聯絡資訊（119／急診／照護團隊專線） | 換成真實醫院公開急診電話 |
| `data/seed-reports.json` | 種子回報資料（讓時間軸開場不空白） | 醫學生 A / 牙醫系（第二病例） |
| `data/seed-consultations.json` | 種子照護諮詢紀錄（含時間點，讓醫師端資料包開場不空白） | 醫學生 A |
| `lib/llm.js` | LLM 轉接層：系統提示詞、JSON schema、mock 備案 | **網媒所**：調 prompt、加功能 |
| `lib/redflags.js` | 規則引擎（純函式，不經 LLM——安全判斷可審核） | **資管系** |
| `server.js` | API：/api/chat、/api/report、/api/reports、/api/summary、/api/export | 資管系＋網媒所 |
| `public/` | 三分頁前端（聊天／回報／醫師摘要＋疼痛趨勢圖） | 網媒所（聊天）＋資管系（醫師端）＋**牙醫系**（文案白話化走查） |

## Demo 劇本（對應 6 分鐘 pitch 的 2.5 分鐘實機操作）

1. **病人端**：選「王秀蘭」→ 點快速提問「我什麼時候可以恢復吃可化凝？」→ 展示回答引用她實際的用藥（Warfarin）、來源標籤、「需醫師確認・已加入回診問題清單」徽章。
   - **急症導流加碼**：切到「洪玉梅」（支架術後）輸入「我現在胸口悶痛一直冒冷汗」→ AI 依衛福部檢傷分類判定第 2 級「危急」，回答第一句就叫她打 119，並跳出紅色處置卡（一鍵撥打 119／急診電話）。講點：分級依據是官方檢傷表，不是 AI 自由發揮；知識性問題不會誤觸發。
2. **每日回報**：填一筆「疼痛 6、體溫 37.8、傷口紅腫」→ 即時跳出黃色注意與原因；切到時間軸展示 8 天恢復軌跡。
3. **醫師端**（收尾畫面）：切到醫師端 → 30 秒摘要條列＋疼痛趨勢圖（黃/紅日期的資料點會變色）＋病人累積的待答問題清單——「醫師門診前 30 秒掌握 90 天」。
4. 加碼：切換到「陳柏睿」展示同一平台跨科（牙科 episode）。

**備援**：預錄一段以上流程的影片（牙醫系負責，17:30 前完成）。

## 醫師端資料包（/api/export）

把單一病人的**照護諮詢歷史（每筆含 ISO 8601 時間點）＋每日回報歷史**打包成結構化 JSON，供醫師端／醫院系統調閱分析：

```
GET /api/export/:patientId                       # 全部歷史
GET /api/export/:patientId?from=2026-08-11&to=2026-08-13   # 日期區間（含頭尾）
```

回傳格式（`resource_type: "careloop.patient_history_bundle"`，`version: "1.0"`）：

- `generated_at`：打包時間
- `patient`：病歷摘要（合成資料）
- `consultations`：`count`、`needs_doctor_confirmation_count`、`records[]`——每筆含 `timestamp`（時間點）、`question`、`answer`、`citations`、`needs_doctor_confirmation`、`triage_level`
- `daily_reports`：`count`、`stats`（與醫師端摘要同一套確定性統計）、`records[]`（含紅旗分級結果；當日新增的回報另含 `timestamp`）
- `pending_questions`：病人累積的待答問題（含時間點）

醫師端分頁也有「⬇ 下載資料包（JSON）」按鈕可直接下載，並新增「照護諮詢紀錄（含時間點）」卡片供回診前回顧。每一次 `/api/chat` 問答都會即時寫入諮詢歷史（demo 為 in-memory，重啟重置回種子資料）。

## 接下來可加的功能（報告「功能點子庫」）

- Teach-back：AI 衛教後請病人「用自己的話說一次」
- 台語語音介面（Web Speech API）
- 回診議程生成（把 pendingQuestions 整理成「這次想問的三件事」）
- 健康存摺檔案匯入（示範病人授權資料流）

## 合規紅線（簡報必講）

全部資料為**合成病歷**；產品定位為**醫師監督下的衛教輔助**（非診斷、非醫材）；紅旗判斷用**可審核的規則表**而非 LLM；正式版資料架構走**病人自主授權**（健康存摺 SDK／FHIR）。
