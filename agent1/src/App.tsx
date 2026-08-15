import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { LogOut } from "lucide-react";

import { AiResponseWriter } from "@/components/ui/ai-response-writer";
import { PromptBox } from "@/components/ui/chatgpt-prompt-input";
import { Separator } from "@/components/ui/separator";
import LoginScreen from "./LoginScreen";

type AssistantMode = "lifestyle" | "nutrition";

type Patient = {
  id: string;
  name: string;
  nickname: string;
  phase: string;
  surgery: { name: string };
};

type Citation = { id: string; title: string; source: string };
type Contact = { phone: string; name: string; hours: string; note: string };
type Conclusion = {
  level: number;
  label: string;
  detail: string;
  clinic?: string;
  contacts: Contact[];
};
type ChatApiResponse = {
  answer?: string;
  cited?: Citation[];
  needs_doctor_confirmation?: boolean;
  conclusion?: Conclusion | null;
  error?: string;
};
type HistoryItem = { role: "user" | "assistant"; content: string };
type ChatMessage = {
  id: string;
  role: "user" | "ai" | "thinking";
  text: string;
  cited?: Citation[];
  needsConfirm?: boolean;
  conclusion?: Conclusion | null;
  animate?: boolean;
};
const ASSISTANT_MODES: Record<
  AssistantMode,
  { label: string; greeting: (patient: Patient) => string }
> = {
  lifestyle: {
    label: "生活追蹤模式",
    greeting: (patient) =>
      `${patient.nickname}您好，我是您的照護助理。${patient.phase === "treatment" ? "療程期間" : "手術後"}有任何不舒服或想詢問的事情，都可以直接告訴我。我的回答會依據您的病歷與醫院衛教資料整理。`,
  },
  nutrition: {
    label: "營養諮詢模式",
    greeting: (patient) =>
      `${patient.nickname}您好，我是您的營養與生活教練，可以陪您聊聊體重、飲食、運動、睡眠、注射或副作用；如果身體不舒服，也可以直接告訴我。`,
  },
};

const PROMPT_MODES = [
  {
    value: "lifestyle",
    label: "生活追蹤模式",
    description: "術後、療程與日常症狀照護問答",
  },
  {
    value: "nutrition",
    label: "營養諮詢模式",
    description: "飲食、運動、睡眠與生活型態討論",
  },
];

const SUGGESTIONS: Record<string, string[]> = {
  p1: ["我什麼時候可以恢復吃可化凝？", "傷口有點紅腫正常嗎？", "我可以開始做哪些復健運動？"],
  p2: ["拔牙後可以漱口嗎？", "臉腫到什麼程度要回診？", "抗生素可以提早停嗎？"],
  p3: ["我的排糖藥什麼時候可以恢復吃？", "體重變重、走路會喘要注意什麼？", "胸口傷口痛可以吃止痛藥嗎？"],
  p4: ["抗血小板藥漏吃一次怎麼辦？", "手腕的瘀青正常嗎？", "多久之後可以提重物？"],
  p5: ["傷口越來越痛還流出黃黃的液體怎麼辦？", "發燒到幾度要去急診？", "抗生素忘記吃可以補吃嗎？"],
  p6: ["打完針一直想吐正常嗎？", "這週日晚上有事沒辦法打針怎麼辦？", "體重是不是掉太慢了？"],
};

const CONCLUSION_CHIP_LABEL: Record<number, string> = {
  3: "已送醫師審閱",
  4: "衛教資訊",
};

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function AiMessageCard({ message }: { message: ChatMessage }) {
  const [visibleText, setVisibleText] = useState(message.animate ? "" : message.text);

  useEffect(() => {
    if (!message.animate) {
      setVisibleText(message.text);
      return;
    }
    let index = 0;
    setVisibleText("");
    const characters = Array.from(message.text);
    const timer = window.setInterval(() => {
      index = Math.min(index + 3, characters.length);
      setVisibleText(characters.slice(0, index).join(""));
      if (index >= characters.length) window.clearInterval(timer);
    }, 24);
    return () => window.clearInterval(timer);
  }, [message.animate, message.text]);

  const responding = visibleText.length < message.text.length;

  return (
    <div className="ai-response-shell text-card-foreground bg-card ring-foreground/10 w-full max-w-2xl rounded-xl p-4 text-sm shadow-xs ring-1">
      <p className="ai-response-label mb-3 font-medium">
        {responding ? "CuriLoop 正在回覆…" : "CuriLoop"}
      </p>
      <Separator className="mb-3 opacity-70" />
      <AiResponseWriter text={visibleText} className="h-40" />
      {(message.cited?.length || message.needsConfirm || (message.conclusion && message.conclusion.level >= 3)) ? (
        <div className="badges" aria-label="回覆來源與狀態">
          {message.cited?.length ? (
            <span className="chip cite" title={message.cited.map((item) => item.source).join("\n")}>
              來源：{message.cited.map((item) => item.title).join("、")}
            </span>
          ) : null}
          {message.needsConfirm ? <span className="chip confirm">需醫師確認・已加入回診問題清單</span> : null}
          {message.conclusion && message.conclusion.level >= 3 ? (
            <span
              className={`chip level-${message.conclusion.level}`}
              title={`${message.conclusion.detail}${message.conclusion.clinic ? `｜您的診所：${message.conclusion.clinic}` : ""}`}
            >
              {CONCLUSION_CHIP_LABEL[message.conclusion.level]}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ConclusionCard({ conclusion }: { conclusion: Conclusion }) {
  return (
    <div className={`conclusion level-${conclusion.level}`} role={conclusion.level === 1 ? "alert" : "status"}>
      <div className="cc-head">{conclusion.level === 1 ? "⚠ " : ""}{conclusion.label}</div>
      <div className="cc-detail">{conclusion.detail}</div>
      {conclusion.contacts.length ? (
        <div className="cc-contacts">
          {conclusion.contacts.map((contact) => (
            <a className="contact" href={`tel:${contact.phone.replaceAll("-", "")}`} key={`${contact.phone}-${contact.name}`}>
              <span className="c-phone">{contact.phone}</span>
              <span className="c-name">{contact.name}</span>
              <span className="c-note">{contact.hours}｜{contact.note}</span>
            </a>
          ))}
        </div>
      ) : null}
      {conclusion.clinic ? <div className="cc-src">您的診所：{conclusion.clinic}</div> : null}
    </div>
  );
}

export default function App() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientId, setPatientId] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("lifestyle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [question, setQuestion] = useState("");
  const [engineLabel, setEngineLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [promptResetKey, setPromptResetKey] = useState(0);
  const chatLogRef = useRef<HTMLDivElement>(null);

  const currentPatient = useMemo(
    () => patients.find((patient) => patient.id === patientId),
    [patientId, patients],
  );

  useEffect(() => {
    void fetch("/api/patients")
      .then((response) => response.json())
      .then((items: Patient[]) => {
        setPatients(items);
      });
    void fetch("/api/mode")
      .then((response) => response.json())
      .then(({ mode, models }: { mode: string; models: Record<string, string> }) => {
        const model = mode === "openai" ? models.openai : mode === "anthropic" ? models.anthropic : "";
        setEngineLabel(mode === "mock" ? "離線示範模式" : model || "");
      })
      .catch(() => setEngineLabel(""));
  }, []);

  useEffect(() => {
    if (!currentPatient) return;
    setHistory([]);
    setMessages([
      {
        id: id(),
        role: "ai",
        text: ASSISTANT_MODES[assistantMode].greeting(currentPatient),
        animate: false,
      },
    ]);
  }, [assistantMode, currentPatient]);

  useEffect(() => {
    if (chatLogRef.current) chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
  }, [messages]);

  async function submitQuestion(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !patientId || submitting) return;
    setQuestion("");
    setPromptResetKey((current) => current + 1);
    setSubmitting(true);
    const thinkingId = id();
    setMessages((items) => [
      ...items,
      { id: id(), role: "user", text: trimmed },
      { id: thinkingId, role: "thinking", text: "思考中" },
    ]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, question: trimmed, history, assistantMode }),
      });
      const data = (await response.json()) as ChatApiResponse;
      const answer = data.error ? `系統忙碌中，請再試一次。（${data.error}）` : data.answer || "目前沒有可顯示的回覆。";
      setMessages((items) => [
        ...items.filter((item) => item.id !== thinkingId),
        {
          id: id(),
          role: "ai",
          text: answer,
          cited: data.cited,
          needsConfirm: data.needs_doctor_confirmation,
          conclusion: data.conclusion,
          animate: !data.error,
        },
      ]);
      if (!data.error) {
        setHistory((items) => [
          ...items,
          { role: "user", content: trimmed },
          { role: "assistant", content: answer },
        ]);
      }
    } catch {
      setMessages((items) => [
        ...items.filter((item) => item.id !== thinkingId),
        { id: id(), role: "ai", text: "連線失敗，請確認伺服器是否啟動。", animate: false },
      ]);
    } finally {
      setSubmitting(false);
    }
  }

  function onChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitQuestion(question);
  }

  function login(patient: string) {
    setPatientId(patient);
    setLoggedIn(true);
  }

  function logout() {
    setLoggedIn(false);
    setPatientId("");
    setMessages([]);
    setHistory([]);
    setQuestion("");
    setAssistantMode("lifestyle");
    setPromptResetKey((current) => current + 1);
  }

  if (!loggedIn) return <LoginScreen patients={patients} onLogin={login} />;

  const suggestions = assistantMode === "lifestyle" ? SUGGESTIONS[patientId] || [] : [];

  return (
    <div className="patient-app">
      <header>
        <div className="logo brand-wordmark">CuriLoop</div>
        <div className="patient-session">
          <span><strong>{currentPatient?.name}</strong><small>{currentPatient?.surgery.name}</small></span>
          <button type="button" onClick={logout} aria-label="登出 Demo 帳號">
            <LogOut aria-hidden="true" />
            登出
          </button>
        </div>
      </header>

      <main>
        <section id="panel-chat">
          <div className="card">
            <h2>照護問答{currentPatient ? ` — ${currentPatient.nickname}（${currentPatient.surgery.name}）` : ""}</h2>
            <p className="hint">回答依據您的個人病歷與醫院衛教資料；涉及臨床決策時會清楚標示需由醫師確認。</p>
            <div id="chat-log" ref={chatLogRef}>
              {messages.map((message) => {
                if (message.role === "user") return <div className="bubble user" key={message.id}>{message.text}</div>;
                if (message.role === "thinking") {
                  return (
                    <div className="bubble ai thinking" key={message.id} aria-live="polite">
                      <span className="thinking-text">思考中</span>
                      <span className="thinking-dots" aria-hidden="true"><span /><span /><span /></span>
                    </div>
                  );
                }
                return (
                  <div className="ai-message-group" key={message.id}>
                    <AiMessageCard message={message} />
                    {message.conclusion && message.conclusion.level <= 2 ? <ConclusionCard conclusion={message.conclusion} /> : null}
                  </div>
                );
              })}
            </div>
            <div className="prompt-composer">
              <form id="chat-form" onSubmit={onChatSubmit}>
                <PromptBox
                  id="chat-prompt-input"
                  value={question}
                  onValueChange={setQuestion}
                  modes={PROMPT_MODES}
                  selectedMode={assistantMode}
                  onModeChange={(mode) => setAssistantMode(mode as AssistantMode)}
                  engineLabel={engineLabel}
                  resetKey={promptResetKey}
                  disabled={submitting}
                  placeholder="輸入您的問題…"
                  autoComplete="off"
                  aria-label="輸入照護問題"
                />
              </form>
              <div className="suggestions" aria-label="快速提問">
                {suggestions.map((suggestion) => (
                  <button type="button" key={suggestion} onClick={() => void submitQuestion(suggestion)} disabled={submitting}>{suggestion}</button>
                ))}
              </div>
            </div>
          </div>
        </section>

      </main>

      <footer>CuriLoop hackathon demo・全部為合成示範資料，非真實病歷・衛教輔助定位，非醫療診斷</footer>
    </div>
  );
}
