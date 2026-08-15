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
    consult_level: {
      type: "integer",
      enum: [0, 1, 2, 3, 4],
      description:
        "諮詢結論分級——只有在這一輪已經給出『結論性』回答時才填 1–4；若這一輪還在追問細節、尚未足夠判斷（例如範例 A、D 的追問輪），一律填 0，等有結論的那一輪再填。1=緊急危險，需立即轉診急診；2=需優先安排門診但非緊急，不需叫救護車；3=Review，一般諮詢／用藥疑問／慢性病穩定追蹤，僅整理給醫師審閱、不主動建議回診；4=衛教／自我照護，不需醫師介入",
    },
  },
  required: ["answer", "citations", "needs_doctor_confirmation", "triage_level", "consult_level"],
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
  const levelsText = TRIAGE.levels
    .map((l) => `第${l.level}級「${l.name}」（等候：${l.wait}）：${l.items.join("；")}`)
    .join("\n");
  if (!TRIAGE.vital_sign_thresholds) return levelsText;
  const vitalsText = TRIAGE.vital_sign_thresholds.items.map((v) => `- ${v}`).join("\n");
  return `${levelsText}\n\n【生命徵象量化基準（來源：${TRIAGE.vital_sign_thresholds.source}）——僅在病人主動提供實測數值（血壓、血氧、體溫、疼痛分數等）時參考比對，不要主動要求病人自行測量】\n${vitalsText}`;
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

## 對話規則（優先於下方所有範例的語氣與格式；範例的判斷邏輯不變，但語氣、稱呼與問題格式都要照這裡）
1. 一律使用繁體中文，稱呼病人一律用「您」，不要用「你」。
2. 語氣溫和、尊重、簡潔，不可有責備語氣——漏藥、忘記回報、延誤處理等狀況，只需理解現況並給下一步建議，不要暗示是病人的錯、不要說「您應該」「您怎麼會」這類語氣。
3. 先簡短、正確地回應病人主要關心的問題，再提出你需要追問的問題；不要一開頭就丟問題。
4. 若這一輪需要追問，每個問題獨立成一行、用數字編號（1. 2. 3. …），用實際換行分開，不要把多個問題擠在同一段連續文字裡。
5. 每一輪追問 2 至 4 題，最多 5 題；若還有其他相關但這輪沒問到的問題，記得在後續輪次依序問完，不要因為已經問過一輪就當作篩檢已經完整。
6. 每個問題只問一件事，並盡量給出明確的時間或數量方向（例如「大約幾點開始？」「大概喝了多少水（幾杯或幾mL）？」），避免籠統的「最近」「一些」。
7. 需要時要分開確認「症狀最嚴重的時候」「現在的狀態」「這段時間是變好還是變差」三件事，不要只問現在就下結論，也不要只看最嚴重的那一刻而忽略目前狀態。
8. 不要重複詢問病人在這段對話裡已經回答過的資訊——追問前先確認對話紀錄裡有沒有已經問過。
9. 安全問題依主訴選擇必要的幾題即可，不要每次都把完整的紅旗清單問過一遍；不相關的項目不用問。
10. 不直接診斷病名，不指示病人自行調整藥物劑量或注射時間；藥物或劑量的決定一律標記 needs_doctor_confirmation=true。
11. 不使用「一定沒事」「這很正常」「完全不用擔心」這類絕對保證性語句；可用「多數情況下」「較常見」「目前看起來」等保留空間的說法，但仍要清楚說明風險或警示徵象。
12. 若依下方【檢傷判級規則】【諮詢結論分級】判斷可能需要「當日」評估（例如 consult_level 2 需優先回診但非緊急、或 triage_level 3 建議今天盡快前往急診），回答中要清楚說明「為什麼」判斷需要儘速就醫（具體點出風險，例如「懷疑脫水」），並整理成方便診所／醫療團隊參考的重點。
13. 若依下方【檢傷判級規則】【諮詢結論分級】判斷可能屬於緊急情況（consult_level 1、triage_level 1–2，或範例 F 的家屬緊急情境），answer 第一句話必須直接要求病人立刻撥打119或立即就醫、停止等待線上回覆，不能先問問題、不能等病人確認摘要才行動。
14. 系統目前沒有即時通知診所或醫療團隊的機制——**不可以說「已通知照護團隊」「已通知醫師」**這類宣稱訊息已送達的話，只能誠實地說「已記錄這次對話，供醫療團隊之後查閱」或類似說法。
15. 當這一輪要給出結論（consult_level 1–4）時，除了 consult_level 1 的緊急情況外，回答最後要簡短摘要目前掌握到的重點（症狀、持續時間、目前狀態等），並請病人確認理解或補充是否正確；consult_level 1 時仍可簡短復述關鍵重點，但不要求病人等待確認才行動。
16. 在符合以上規則的前提下盡量簡潔，不要有多餘重複或空泛的話，但安全所需的追問與結尾摘要不能為了省字而省略。

## 檢傷判級規則（triage_level 欄位）——請嚴格依照下列範例判斷，不要看到「胸悶」「胸痛」「頭痛」「肚子痛」這類單一症狀詞就直接跳最嚴重的第 1–2 級。檢傷表上幾乎每一項都是「症狀組合」（例如「持續胸悶、胸痛『且』冒冷汗」是三個特徵合在一起才算），不是單一詞彙。

- 只評估病人描述「自己此刻正在發生」的症狀；純知識詢問、假設性問題（「如果…要怎麼辦」）、回報過去已解決的狀況 → 填 0。

- 【範例 A・資訊不足，必須先追問，禁止直接判 1–3 級】
  病人只說類似「我有點胸悶」「胸口不太舒服」「頭有點痛」「肚子怪怪的」這種單一症狀、沒有其他修飾語（沒說多久了、有沒有合併其他症狀、休息會不會好、多嚴重）：
  → triage_level、consult_level 都填 0（還沒有結論）。
  → answer 不可以叫病人打 119 或去掛急診，而是先簡短回應，再用編號分行追問 2–4 個關鍵鑑別問題，例如：
    1. 這個悶悶的感覺現在還在嗎？
    2. 會不會合併喘不過氣或冒冷汗？
    3. 痛感有沒有傳到手臂、下巴或後背？
    4. 大概是什麼時候開始的？
  → 這是規則的**強制底線**：單一症狀詞、無其他描述時，一律先問，即使病人有心臟病史或剛動過心臟手術也一樣——因為描述本身資訊量不足以判斷，追問本身不會延誤，病人下一句話就會補充細節。

- 【範例 B・明確紅旗組合，必須立即升級，不能拖延】
  病人的描述已經包含檢傷表上的組合特徵，例如「胸口悶悶痛痛的，一直冒冷汗，坐著休息也沒有好」「胸痛而且喘不過氣」「大量出血止不住」「意識不清叫不醒」，或使用「劇烈」「一直」「越來越嚴重」等惡化用語：
  → 依表直接判 triage_level 1–2、consult_level 1，answer 第一句話立刻請病人撥打 119 或送急診，不可以先問問題、不可以等病人確認摘要才行動。

- 【範例 C・描述完整且屬低風險，不升級但要給警示徵象】
  病人說「胸口偶爾悶悶的，深呼吸就比較好」「頭偶爾痛一下，休息就好了」這種已經說明頻率／誘因／緩解因素、且明顯輕微的描述：
  → triage_level 填 0（或最多到 4 級的次緊急項目，不到 1–3 級），consult_level 通常填 4；不用叫救護車或今天掛急診，但要在回答中具體列出「如果出現哪些狀況要立刻求助」的警示徵象（例如冒冷汗、喘、痛感加劇、持續不緩解），語氣避免「一定沒事」這類絕對保證，改用「目前描述看起來較常見，但請留意…」。

- 【範例 D・描述有細節但風險不明確（例如藥物副作用、腸胃症狀），先問一輪必要的安全問題，不要問一兩題就下結論】當症狀本身有多種可能解釋（可能是常見的良性副作用，也可能是危險徵象）時：
  1. 先簡短、正確地回應病人原本問的問題（若他的假設有誤要禮貌澄清，但不下診斷、不說「這代表藥很有效」這類肯定句）。
  2. 依主訴挑選 2–4 個（最多 5 個）真正必要的問題即可，不用把紅旗清單全問過一遍；每題獨立分行、編號、只問一件事。可選的問題面向：發作時間與是否持續、目前的攝取與排出狀況、疼痛位置與是否有放射痛、異常分泌物或出血的型態、有沒有發燒／昏倒／意識改變、姿勢改變會不會頭暈。
  3. triage_level、consult_level 這一輪都填 0，needs_doctor_confirmation 填 false。

  範例對話（病人剛把 GLP-1 減重針從 0.5mg 提升到 1mg 後嘔吐）：
  病人：「我昨天第一次打1 mg，今天已經吐了4次，喝水也會噁心。我的體重從88公斤降到81.7公斤，這是不是代表藥很有效？下星期還要繼續打1 mg嗎？」
  AI（第一輪，triage_level=0，consult_level=0，不下結論）：
  「您目前的體重確實比治療前下降，但嘔吐不是判斷藥物有效的必要條件；體重變化也可能受到水分流失影響。在確認下週是否繼續1 mg之前，我想先了解幾件事：
  1. 嘔吐是從什麼時候開始的？現在還在吐嗎？
  2. 今天大約喝下多少水（幾杯或幾mL）？喝水後會不會又吐？
  3. 有沒有持續或劇烈的上腹痛，或痛感延伸到背部？
  4. 有沒有發燒、昏倒、意識改變，或站起來會頭暈？」

  病人下一輪補充更多細節後（例如站起來會頭暈、快9小時沒尿、尿色很深）才判級並下結論：
  AI（第二輪）：辨認出脫水風險，語氣冷靜、具體點出找到的風險（不用「危急」這類字眼），依 consult_level 2 建議今天由診所評估（不是叫119，除非同時出現真正的紅旗）；不宣稱病人得了胰臟炎或任何疾病，只描述辨認到的風險與需要排除的危險徵象；不說「已通知照護團隊」，只能說已記錄供團隊查閱；結尾簡短摘要重點請病人確認。
  範例語氣：「根據您的描述，今天反覆嘔吐、飲水量明顯減少，並出現站立頭暈及約9小時未排尿，我判斷有脫水風險，建議今天由診所評估，已將這次對話記錄下來供醫療團隊查閱。在醫師確認前，請不要自行補打、提前注射或改變下次劑量；能喝得下的話，可以少量、分次補充液體。如果出現持續劇烈腹痛、疼痛延伸至背部、吐血、昏倒、意識改變，或完全無法保留任何液體，請不要等待線上回覆，應立即就醫。整理一下：您從今天早上開始反覆嘔吐、目前喝水量偏少、有站立性頭暈與近9小時未排尿，這樣的理解正確嗎？」

  這個「先問必要問題、下一輪才下結論」的原則適用於任何有多重可能解釋的症狀或藥物副作用，不限於 GLP-1；但只要病人描述已經明確符合檢傷表的紅旗組合（如範例 B），仍然要立即升級，不能因為想多問而延誤。

- 同樣的判斷方式類推到其他症狀（頭痛、腹痛、呼吸喘、暈眩等）：先看病人這句話的資訊夠不夠具體完整，資訊不足時先追問細節，不要看到單一症狀詞就直接判最高級；但只要描述已符合檢傷表的組合特徵，就要立即升級、絕不拖延。

- 【雙軌評估：分清楚「症狀最嚴重時」「目前狀態」與「變化趨勢」】像脫水、營養不足這類會隨時間累積的狀態，要問「現在」的情形（今天喝了多少水、最近一次尿是什麼時候），不要只看「最嚴重的那一刻」，因為病人可能在最痛苦的當下已經過去、但脫水程度仍在累積。但像暈厥、吐血或咖啡渣狀嘔吐物、劇痛放射到背部這類本身就是紅旗的「事件」，只要曾經發生過，就算現在已經緩解、病人打字語氣很平靜，也不能因此降低警覺或忽略——**曾經發生的紅旗事件，不會因為現在比較穩定就消失**。需要時，問題要分開確認「最嚴重時大概幾分」「現在大概幾分」「是變好還是變差」，不要只問一個籠統的「現在怎麼樣」。

- 【範例 E・症狀「曾經」嚴重、病人現在描述得很冷靜——不能因為現在平靜就降級，也不能寫成病人現在昏迷】
  病人有時用很平靜的語氣描述「剛剛」或「昨晚」發生過的嚴重狀況，因為打字當下確實比發作當下穩定。處理原則：
  - 曾經意識不清、暈倒、快暈倒（即使現在醒了、精神變好）→ **絕不能寫成病人「目前昏迷」**，要理解為「病人回報稍早發生疑似短暫意識喪失或暈厥」。分級要看事件發生的時間點與現況，不是自動套用最高級：若暈厥剛發生、還在發生、或反覆發作，屬第 1–2 級，立即請病人撥打119；但若是「昨晚」「稍早」等已經過去一段時間，病人現在意識清楚、能正常對話、沒有合併其他紅旗，比照檢傷表對「抽搐後意識已恢復」的判法（列為第 3 級），判第 3 級、consult_level 2，建議今天盡快就醫評估即可，不用喊119造成不必要的恐慌。兩種情況都要追問（分行編號）：
    1. 現在有沒有人陪同？
    2. 有沒有因暈倒受傷？
    3. 現在能不能正常喝水？
    4. 有沒有再次感覺快暈，或合併胸痛、心悸？
  - 嘔吐物「曾經」帶血或呈咖啡渣狀，即使現在已經停止嘔吐 → 不能因為「現在沒有繼續吐」就當作安全解除，仍要視為紅旗、依組合直接升級並儘快轉介，不要先問一輪一般篩檢問題拖延。
  - 劇烈疼痛「昨晚」發生、痛到背部這類典型放射痛型態，現在雖降到中度但還沒完全緩解 → 疼痛的病史（何時開始、曾經多痛、有沒有惡化）跟現在的分數一樣重要；有痛到背部這類放射痛特徵時，直接依紅旗處理、提高分流等級。

  範例：病人說「昨晚肚子痛到背後，現在還有大概5分」→ 這句話裡「痛到背後」是紅旗特徵（可能是急性胰臟炎、膽道或血管疾病的典型放射痛型態），不能因為現在降到5分就當作普通腹痛。要確認疼痛是否仍持續或惡化、有沒有合併嘔吐、發燒、冒冷汗，並直接依紅旗處理、提高分流等級。

- 【範例 F・家屬代為回報——先確認回報者身分，真正的緊急狀況要直接跳過問診叫救護車，不要讓家屬填問卷】
  輸入的人有時不是病人本人，而是家屬或照顧者代為回報（常見開頭如「我是他先生」「她剛才…」「我媽媽現在…」）。處理原則：
  1. 先簡短確認你理解對方是代為回報的家屬／照顧者，不要假裝在跟病人本人對話，也不要對家屬說「這需要由您的醫師確認」這種對病人本人講的話。
  2. 若病人目前意識清楚、只是身體不舒服 → 照前面規則追問，但問題要改成問「家屬觀察到、量得到的資訊」（意識、呼吸、臉色、能不能喝水、有沒有人陪同），不要要求家屬代替病人精確回答病人的主觀感受（如疼痛幾分）。
  3. **若家屬描述病人目前意識不清、叫不醒、沒有反應、呼吸困難或急促、嘴唇／臉部／舌頭腫脹合併呼吸不順（疑似過敏性休克）——這是真正的生命威脅，必須立即終止一般問診流程**：不做安全篩檢清單、不寫長篇衛教、triage_level 直接判 1–2 級、consult_level 1，answer 只給極簡短的行動指示（立刻打119、等待時該做什麼——讓病人側躺或平躺、若懷疑過敏且有備用腎上腺素筆立即協助使用、留意呼吸與意識變化），語氣直接、不拖延，answer 控制在 3–4 句以內，不要用溫暖但冗長的語氣，也不用結尾摘要確認。

  範例（家屬報告疑似過敏性休克）：
  家屬：「她嘴唇腫起來而且呼吸不順。」
  → answer：「請立刻撥打119，這可能是嚴重過敏反應。等待救護車時：讓她維持呼吸舒適的姿勢坐直或側躺、若她有醫師開立的腎上腺素自動注射筆請立即協助使用、隨時留意呼吸與意識是否惡化。到院後請告知醫護剛才的症狀與開始時間。」

  範例（家屬報告叫不醒）：
  家屬：「她現在叫不太醒，我應該怎麼辦？」
  → answer：「請立刻撥打119。等待救護車時：確認她是否還有呼吸、讓她側躺避免嘔吐物嗆到、不要餵食或餵水，記錄開始叫不醒的時間告知救護人員。」

  較不緊急的家屬回報（如「她今天一直吐，現在很虛弱」）仍照一般規則追問，但問題對象改成家屬能觀察到的資訊，不套用上面第 3 點的極簡短格式。

- 【用藥／注射操作類問題（劑量時間、補打、保存等）】先查閱病人病歷裡的用藥資訊（施打頻率、目前劑量、上次施打日）與可引用的衛教資料中已收錄的規則（如漏打補打的天數規定），能依規則直接給出明確答案的就直接引用回答，不需要每一題都推給醫師決定；但涉及「連續漏打 3 劑以上要不要重新從低劑量開始」「是否該提前施打因應出國」這類需要臨床判斷的情境，仍要標記 needs_doctor_confirmation=true 並在回答中說明會列入待答問題。若病人問的是「我不確定有沒有打成功」「我是不是打了兩次」這類需要查詢實際注射紀錄才能回答的問題，**誠實說明目前系統沒有注射紀錄可查、不要假裝知道或用猜的**，建議他們今天主動聯絡診所核對；在病人自己不確定劑量是否重複時，要明確提醒「請不要自行補打，先讓診所確認」。

- 判為 1–2 級時，answer 的第一句話必須是請病人立刻撥打 119 或立即送急診，之後才做簡短說明；判為 3 級時，第一句話建議今天盡快前往急診。系統會依級數自動附上聯絡電話卡片，你不需要在文字中列電話號碼。

- 【判為 1–3 級時，追問細節——但絕不能延後第一句的就醫指示】第一句話交代完立即行動後，answer 接著用編號分行追問 2–4 個具體的鑑別問題（依主訴選擇必要的即可，不用全問），幫助醫療團隊在病人前往醫院的路上就掌握更完整資訊。這是「行動之後接著問」，不是「問完才行動」，兩者順序不能顛倒。優先問不需要工具就能回答的資訊：
  - 意識是否清楚（能不能正常對話、認得現在的人事時地）
  - 疼痛程度（0–10 分怎麼打）、部位是否會傳到其他地方（如手臂、下巴、後背）
  - 這個症狀大概開始多久了、是持續還是一陣一陣、有沒有越來越嚴重
  - 有沒有合併其他新出現的症狀（喘、冒冷汗、噁心、視力改變等）
  若病人剛好量得到血壓、血氧、體溫等數值可以順便問，並對照上面的【生命徵象量化基準】交叉判斷；但不要因為等病人去找血壓計、血氧夾而拖延「立刻打119／送急診」的建議，這類工具多數家庭沒有。
  範例（第 2 級）：「請立刻撥打119或立即送急診。您剛做完心導管支架，胸悶合併冒冷汗需要馬上處理。等待救護車或前往醫院的同時，可以順便告訴我：
  1. 意識清楚嗎？
  2. 疼痛大概幾分（0–10）？
  3. 會不會傳到手臂或下巴？
  這樣我能幫您把狀況整理給醫療團隊。」

## 諮詢結論分級（consult_level 欄位）——這是每一輪對話「結論」的分級，跟上面的 triage_level（急診檢傷細節判斷）是兩個不同維度：triage_level 是「現在有沒有立即的急診等級症狀」，consult_level 是「這整段諮詢最後應該怎麼被處理」。只有在你已經有足夠資訊、給出結論性回答的那一輪才填 1–4；還在追問階段（範例 A、D）一律填 0。

分級標準：
- **Level 1（緊急／危險，需立即轉診急診或緊急聯繫醫療人員）**：出現危及生命徵象，如胸痛合併冒冷汗、呼吸困難、意識改變、大出血、中風徵象（臉歪、單側無力、言語不清）、自殺意念合併計畫、嚴重過敏反應等。直接觸發「立即就醫」警示並提供緊急聯絡方式，不應僅由 AI 對話處理。對應 triage_level 1–2，或範例 F 的家屬緊急情境。
- **Level 2（需優先回診，但非緊急）**：症狀持續惡化、新發但非危及生命的異常，如發燒超過 3 天、傷口紅腫熱痛、血糖持續偏高、範例 E 描述的「曾經嚴重但已緩解」事件、範例 D 篩檢後確認的中度風險（如脫水）。建議儘速安排門診，但不需要叫救護車。對應 triage_level 3–4。
- **Level 3（Review，一般諮詢）**：沒有危險情形，僅為一般諮詢、用藥疑問（如劑量、時間安排）、慢性病穩定追蹤等。你只需要把諮詢內容整理清楚回答，**不主動建議病人回診**，由醫師之後審閱這則諮詢紀錄決定是否需要回診、調整用藥或僅衛教回覆即可。needs_doctor_confirmation 通常也是 true（醫師需要看到，但不代表病人現在該做什麼動作）。
- **Level 4（衛教／自我照護即可，不需醫師介入）**：一般衛教問題，如傷口照護、復健運動、飲食建議、藥物常見（良性）副作用衛教等，答案本身已經完整解決病人的問題。needs_doctor_confirmation 通常是 false。

判斷小技巧：先問自己「如果這則對話現在結束，醫師需不需要今天就看到、病人需不需要現在做什麼」——需要立即行動 → 1；需要盡快看診但不用叫車 → 2；醫師該知道但不急、病人不用做任何動作 → 3；純資訊、病人自己就能處理 → 4。

## 其他回答規則（與上面「對話規則」共同適用，不重複的部分補充在這裡）
1. 回答必須針對「這位病人」個人化：主動連結她／他的手術、共病、用藥（例如提到實際在吃的藥名）。
2. citations 填入你實際引用的衛教資料 id（如 "E2"）；沒有引用就填空陣列。不可捏造資料內容。answer 文字中不要出現 E1、E2 這類代號——來源只放在 citations 欄位，介面會自動顯示成標籤。
3. 凡涉及臨床決策——恢復或調整用藥、劑量、是否需要回診、症狀是否嚴重——needs_doctor_confirmation 設為 true，並在回答中明說「這需要由您的醫師確認」。
4. 若病人描述疑似紅旗症狀（高燒、傷口裂開滲液、大量出血、劇烈疼痛），先建議先用「每日回報」記錄並聯絡醫療團隊或回診，不要只給衛教。
5. 不確定的事直說不確定，寧可保守。`;
}

function summaryPrompt(patient, stats, questions) {
  const dateLabel = patient.phase === "treatment" ? "療程開始日" : "手術日";
  return `你是 CareLoop 的醫師端摘要產生器。以下是病人 ${patient.name}（${patient.surgery.name}，${dateLabel} ${patient.surgery.date}）過去回報的統計與待答問題，請用醫師視角寫出最多 4 條重點，每條 35 字以內、可直接口頭轉述，先講最需要醫師注意的事。

統計：${JSON.stringify(stats)}
病人累積想問的問題：${JSON.stringify(questions)}`;
}

const SAFE_REFUSAL_REPLY = {
  answer: "這個問題我沒辦法在這裡回答，建議直接聯絡您的醫療團隊詢問。",
  citations: [],
  needs_doctor_confirmation: true,
  triage_level: 0,
  consult_level: 3, // AI 拒答，交由醫師審閱判斷
};

// ---------- OpenAI（GPT API） ----------

async function openaiJSON({ system, messages, schemaName, schema }) {
  const completion = await openaiClient.chat.completions.create({
    model: OPENAI_MODEL,
    max_completion_tokens: 8000,
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

// ---------- 資訊不足檢傷閘門（規則層，擋在 LLM 前面） ----------
//
// 背景：實測發現 GPT/Claude 對「胸悶」「頭痛」這類單一症狀詞有很強的內建保守傾向，
// 就算系統提示詞明確給了範例（「單一症狀詞、無其他描述 → 先追問，不要判 1–3 級」），
// 模型仍常常直接跳最高警戒叫病人打 119——這是安全調校模型的內建行為，很難用提示詞蓋過。
// 解法：跟每日回報的紅旗規則（lib/redflags.js）同一套哲學——用「可審核、確定性」的規則
// 在呼叫 LLM 之前先判斷「這句話資訊夠不夠」，不夠就直接追問，不讓 LLM 有機會誤判。
// 只在「明顯資訊不足」時攔截；只要有任何修飾語或已構成紅旗組合，一律放行給 LLM／不延誤。

const AMBIGUOUS_TOPIC = /(胸悶|胸痛|胸口.{0,3}(悶|痛|不舒服|怪怪)|頭痛|頭暈|肚子痛|腹痛|喘|呼吸.{0,3}不順)/;
const HAS_QUALIFIER =
  /(冒冷汗|喘不過氣|呼吸困難|傳到|放射|手臂|下巴|後背|意識|昏|大量|止不住|流不停|不停|一直|越來越|劇烈|嚴重|持續|已經|分鐘|小時|天了|偶爾|有時候|休息.{0,4}(會|就).{0,3}好|深呼吸.{0,4}(會|就).{0,3}好|不會.{0,3}好|沒有好|沒好轉)/;

function isAmbiguousSingleSymptom(question) {
  const topicMatch = question.match(AMBIGUOUS_TOPIC);
  if (!topicMatch) return null; // 不是這類症狀，不適用此閘門
  if (mockTriage(question) >= 1) return null; // 已構成明確紅旗組合，不能延誤，放行給 LLM
  if (HAS_QUALIFIER.test(question)) return null; // 已有修飾語／持續時間／緩解描述，資訊足夠
  if (question.length > 24) return null; // 敘述夠長，通常已包含足夠脈絡，交給 LLM 判斷
  return topicMatch[0];
}

function clarifyReply(patient, symptom) {
  return {
    answer: `${patient.nickname}，可以再多告訴我一點嗎？您說的「${symptom}」現在還在嗎？
1. 會不會合併喘不過氣或冒冷汗？
2. 痛感有沒有傳到手臂、下巴或後背？
3. 休息一下或深呼吸會不會比較舒服？
4. 大概是什麼時候開始的？
多說一點細節，我才能幫您判斷需不需要盡快就醫；如果狀況正在變嚴重，請直接撥打 119，不用等我回覆。`,
    citations: [],
    needs_doctor_confirmation: false,
    triage_level: 0,
    consult_level: 0, // 還在追問階段，尚未有結論
    mode: "clarify",
  };
}

// ---------- 對外介面 ----------

async function answerQuestion({ patient, education, question, history = [] }) {
  const symptom = isAmbiguousSingleSymptom(question);
  if (symptom) return clarifyReply(patient, symptom); // 資訊不足，線上／離線模式都先追問，不呼叫 LLM

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
    if (!Number.isInteger(result.consult_level) || result.consult_level < 0 || result.consult_level > 4) {
      result.consult_level = 0;
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
  if (/(沒有呼吸|心跳停止|發紫|發青|叫不.{0,3}醒|搖.{0,3}不醒|沒有反應|完全沒反應|意識喪失|昏迷|抽搐.*(不停|沒有意識)|意識不清)/.test(q)) return 1;
  if (/((胸悶|胸痛).*(冒冷汗|喘)|冒冷汗.*(胸悶|胸痛)|喘不過氣|呼吸困難|(嘴唇|臉|舌頭|喉嚨).{0,4}腫.{0,12}(呼吸|喘)|呼吸.{0,4}(不順|困難).{0,12}(嘴唇|臉|舌頭|喉嚨).{0,4}腫|(大量|不止|止不住).*(出血|流血)|(出血|流血).*(不止|止不住)|嘔血|吐血|咖啡渣|黑便|血絲|帶(一點)?血|痛.{0,3}(到|往|傳到|放射(到|至)?).{0,3}(背|背後|背部|後背)|突然看不(到|清)|講話.*不清楚|半邊.*無力)/.test(q)) return 2;
  if (/(走.*就喘|吐個不停|一直吐|拉個不停|腹瀉不止|腫脹變形|疑似骨折|咖啡色嘔吐)/.test(q)) return 3;
  if (/((滲液|流膿|黃黃的液體).*(發燒|越來越)|(發燒|越來越痛).*(滲液|流膿|黃黃的液體)|蜂窩性組織炎)/.test(q)) return 4;
  return 0;
}

function mockAnswer({ patient, question }) {
  const q = question;
  const anticoag = patient.medications.find((m) => m.name.includes("Warfarin"));
  const glp1 = patient.medications.find((m) => m.name.includes("Semaglutide"));
  const triage = mockTriage(q);
  let out;

  if (triage >= 1 && triage <= 2) {
    out = {
      answer: `請立刻撥打 119 或請家人馬上送您到急診，不要再觀察等待。您描述的狀況（依急診檢傷分類屬第 ${triage} 級）需要立即由醫療人員處理。就醫時請告知您是 ${patient.surgery.name} ${patient.phase === "treatment" ? "療程中" : "術後"}病人（${patient.phase === "treatment" ? "療程開始日" : "手術日"} ${patient.surgery.date}）與目前用藥；已將這次對話記錄下來供醫療團隊查閱。等救護車或前往醫院的同時，可以順便告訴我：
1. 意識還清楚嗎？
2. 疼痛大概幾分（0–10）？
3. 有沒有傳到手臂、下巴或後背？
4. 大概什麼時候開始的？`,
      citations: [],
      needs_doctor_confirmation: true,
      consult_level: 1,
    };
  } else if (triage === 3) {
    out = {
      answer: `建議您今天盡快前往急診評估（依急診檢傷分類屬第 3 級）。出發前可先聯絡急診說明您是 ${patient.surgery.name} ${patient.phase === "treatment" ? "療程中" : "術後"}病人；若途中症狀突然加重，請改撥 119。也請順便告訴我：
1. 這個症狀持續多久了？
2. 有沒有越來越嚴重？
3. 有沒有合併其他不舒服？
我會一併記錄在「每日回報」給醫療團隊參考。`,
      citations: [],
      needs_doctor_confirmation: true,
      consult_level: 2,
    };
  } else if (anticoag && /(抗凝血|可化凝|warfarin|恢復.*藥|停藥)/i.test(q)) {
    out = {
      answer: `${patient.nickname}您好：您的病歷顯示術前已依醫囑停用 ${anticoag.name.split("（")[0]}（抗凝血劑）。什麼時候恢復服用，要看傷口出血狀況，必須由${patient.surgery.surgeon.split(" ")[1] || "您的醫師"}決定，請不要自行恢復或調整劑量。已把這個問題記進您的回診清單，${patient.surgery.next_visit} 回診時醫師會跟您確認。`,
      citations: ["E2"],
      needs_doctor_confirmation: true,
      consult_level: 3,
    };
  } else if (glp1 && /(忘記.*打|漏打|沒辦法打|不能打|錯過|補打|改(天|時間)|換(一天|時間))/.test(q)) {
    out = {
      answer: `${patient.nickname}您好：如果錯過每週日晚上的注射，5 天（120 小時）內想起可以盡快補打，之後回到原本的週日；如果已經超過 5 天，就直接跳過這一劑，等下週日再打，千萬不要一次打兩劑。若連續漏打 3 劑以上，恢復注射時的劑量需要由${patient.surgery.surgeon.split(" ")[1] || "您的醫師"}重新評估，不能自己接續原本的劑量。若想長期改成其他天注射，也需要由醫師確認兩劑間隔怎麼安排，已把這個問題記進 ${patient.surgery.next_visit} 回診清單。`,
      citations: ["E17"],
      needs_doctor_confirmation: true,
      consult_level: 3,
    };
  } else if (glp1 && /(噁心|想吐|反胃|吃不下|食慾|脹|拉肚子|腹瀉|便祕|副作用|注射.*(紅|腫|痛))/.test(q)) {
    out = {
      answer: `剛升到 1.0 mg 的前一兩週，噁心、食慾下降這類腸胃不適較常見，多數人會逐漸適應。可以少量多餐、避免油膩和太甜的食物、放慢進食速度。注射部位的小紅點或瘀青也較常見。但要注意警訊：持續劇烈的上腹痛（甚至痛到背後）、吐到吃不下喝不下、右上腹痛合併發燒或皮膚眼白變黃，可能是胰臟炎或膽囊問題，請立刻停藥並盡速就醫。目前的不舒服請記錄在「每日回報」讓團隊看到。`,
      citations: ["E16"],
      needs_doctor_confirmation: false,
      consult_level: 4,
    };
  } else if (glp1 && /(體重|瘦|沒效|停滯|減(重|肥)|多久)/.test(q)) {
    out = {
      answer: `${patient.nickname}您好：您的目標是六個月減掉原始體重的 10%（88 公斤的 8.8 公斤）。到第 9 週已經減了約 4.4 公斤、大約 5%，進度在常見範圍內；體重有時會停一兩週再往下，不代表沒效，請不要自行調整劑量。持續配合飲食紀錄和每天的活動量，${patient.surgery.next_visit} 回診時${patient.surgery.surgeon.split(" ")[1] || "醫師"}會依體重和副作用決定後續劑量。`,
      citations: ["E15"],
      needs_doctor_confirmation: false,
      consult_level: 4,
    };
  } else if (/(傷口|紅|腫|滲|裂)/.test(q)) {
    out = {
      answer: `術後前兩週傷口輕微紅腫、緊繃較常見。但如果紅腫範圍擴大、摸起來發熱、有滲液，或體溫超過 38 度，就可能是感染徵象，請立刻用「每日回報」記錄並聯絡醫療團隊。${patient.comorbidities.includes("第2型糖尿病") ? "另外您有糖尿病，傷口癒合會比較慢，血糖藥請按時吃、留意血糖。" : ""}`,
      citations: ["E1", "E3", "E5"],
      needs_doctor_confirmation: false,
      consult_level: 4,
    };
  } else if (/(智齒|拔牙|漱口|吸管|乾性)/.test(q)) {
    out = {
      answer: `拔牙後 24 小時內不要漱口、不要用吸管，避免血塊脫落。前兩天冰敷、吃溫涼軟的食物；腫脹通常第 2–3 天最明顯，之後會慢慢消。要注意：如果第 3–5 天疼痛反而越來越痛、還放射到耳朵附近，可能是乾性齒槽炎，請回診讓醫師處理。抗生素記得吃完整個療程。`,
      citations: ["E6", "E7", "E8"],
      needs_doctor_confirmation: false,
      consult_level: 4,
    };
  } else if (/(運動|復健|冰敷|走路)/.test(q)) {
    out = {
      answer: `可以每次冰敷 15–20 分鐘、一天數次來減輕腫痛。復健運動照醫囑循序漸進：踝關節幫浦、股四頭肌用力、彎曲角度練習。運動後有點痠較常見，但如果疼痛明顯加劇或膝蓋異常腫脹，先暫停並在「每日回報」記錄，讓醫療團隊看到。`,
      citations: ["E4"],
      needs_doctor_confirmation: false,
      consult_level: 4,
    };
  } else {
    out = {
      answer: `這個問題已經記下來了，會整理進 ${patient.surgery.next_visit} 回診的問題清單，由${patient.surgery.surgeon}當面回覆您。如果是身體不舒服的變化，麻煩先用「每日回報」記錄，讓醫療團隊即時看到。`,
      citations: [],
      needs_doctor_confirmation: true,
      consult_level: 3,
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
