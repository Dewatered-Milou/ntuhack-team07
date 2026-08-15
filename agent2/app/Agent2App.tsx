"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { REFERENCE_DEMO_TIMELINE } from "../src/agent2/demo";
import type { Agent2ApiResult, EvidenceItem } from "../src/agent2/types";

const DEMO_JSON = JSON.stringify(REFERENCE_DEMO_TIMELINE, null, 2);

type Status = {
  openai_configured: boolean;
  openai_connected: boolean;
  openai_message: string;
  agent1_configured: boolean;
  model: string;
};

export function Agent2App() {
  const [isOpen, setIsOpen] = useState(false);
  const [patientName, setPatientName] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [manualJson, setManualJson] = useState(DEMO_JSON);
  const [result, setResult] = useState<Agent2ApiResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    fetch("/api/status", { cache: "no-store" })
      .then((response) => response.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  async function requestSummary(name: string, timeSeries?: unknown) {
    setError("");
    setResult(null);
    setShowTimeline(false);
    setLoading(true);
    try {
      const response = await fetch("/api/agent2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_name: name,
          ...(timeSeries !== undefined ? { time_series: timeSeries } : {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        const detail = Array.isArray(payload.details) ? ` ${payload.details.join(" ")}` : "";
        throw new Error(`${payload.error || "無法產生摘要。"}${detail}`);
      }
      setResult(payload as Agent2ApiResult);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "目前無法產生摘要，請稍後再試。");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const name = patientName.trim();
    if (!name) {
      setError("請先輸入病患姓名。");
      return;
    }

    let timeSeries: unknown = undefined;
    if (manualMode) {
      try {
        timeSeries = JSON.parse(manualJson);
      } catch {
        setError("測試JSON格式不正確，請檢查逗號、引號與括號。");
        return;
      }
    }
    await requestSummary(name, timeSeries);
  }

  function revealEvidence(id: string) {
    setShowTimeline(true);
    setHighlightId(id);
    window.setTimeout(() => {
      document.getElementById(`source-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  return (
    <main className="ehr-shell">
      <DemoChart />

      {!isOpen && (
        <button className="assistant-launcher" onClick={() => setIsOpen(true)} aria-label="開啟CuriLoop病患諮詢分析">
          <span className="launcher-brand">CuriLoop</span>
          <span className="launcher-label">病患諮詢</span>
          <span className="launcher-dot" />
        </button>
      )}

      {isOpen && (
        <aside className="assistant-panel" aria-label="CuriLoop病患對話摘要">
          <header className="panel-header">
            <div className="brand-lockup">
              <div>
                <div className="brand-title">CuriLoop</div>
                <div className="brand-subtitle">病患時序摘要 · Summary 1.0</div>
              </div>
            </div>
            <div className="header-actions">
              <span
                className={`connection-dot ${status?.openai_connected ? "online" : "demo"}`}
                title={status?.openai_message || "正在確認OpenAI連線"}
              />
              <button className="icon-button" onClick={() => setIsOpen(false)} aria-label="收合摘要">×</button>
            </div>
          </header>

          <div className="panel-body">
            {!result && !loading && (
              <section className="lookup-view">
                <form onSubmit={handleSubmit} className="lookup-form compact">
                  <label htmlFor="patient-name">病患姓名</label>
                  <div className="name-field">
                    <span aria-hidden="true" className="field-icon">人</span>
                    <input
                      id="patient-name"
                      value={patientName}
                      onChange={(event) => setPatientName(event.target.value)}
                      placeholder="輸入病患姓名"
                      autoComplete="off"
                      maxLength={80}
                    />
                  </div>
                  <button className="primary-button" type="submit">
                    分析病患諮詢 <span aria-hidden="true">→</span>
                  </button>

                  <button
                    className="advanced-toggle"
                    type="button"
                    aria-expanded={manualMode}
                    onClick={() => setManualMode((value) => !value)}
                  >
                    <span>{manualMode ? "−" : "+"}</span> 使用自訂Agent 1測試JSON
                  </button>

                  {manualMode && (
                    <div className="manual-input">
                      <label htmlFor="manual-json">時序JSON（僅供開發測試）</label>
                      <textarea id="manual-json" value={manualJson} onChange={(event) => setManualJson(event.target.value)} spellCheck={false} />
                    </div>
                  )}
                </form>

                {error && <div className="error-card" role="alert"><strong>無法建立摘要</strong><span>{error}</span></div>}

                <div className="privacy-note">
                  <span className="shield" aria-hidden="true">✓</span>
                  <div><strong>只整理，不取代專業紀錄</strong><br />摘要不包含診斷、處方、調藥或自動寫入病歷。</div>
                </div>
              </section>
            )}

            {loading && <LoadingView patientName={patientName} />}
            {result && (
              <SummaryView
                result={result}
                showTimeline={showTimeline}
                highlightId={highlightId}
                onToggleTimeline={() => setShowTimeline((value) => !value)}
                onEvidence={revealEvidence}
                onReset={() => { setResult(null); setPatientName(""); setError(""); }}
              />
            )}
          </div>

          <footer className="panel-footer">
            <span>AI整理 · 可追溯原文 · 不寫入專業病歷</span>
            <span>{status?.openai_connected ? status.model : status?.openai_configured ? "OpenAI連線失敗" : "Reference Demo"}</span>
          </footer>
        </aside>
      )}
    </main>
  );
}

function SummaryView({
  result,
  showTimeline,
  highlightId,
  onToggleTimeline,
  onEvidence,
  onReset,
}: {
  result: Agent2ApiResult;
  showTimeline: boolean;
  highlightId: string | null;
  onToggleTimeline: () => void;
  onEvidence: (id: string) => void;
  onReset: () => void;
}) {
  const { summary } = result;
  const period = useMemo(() => {
    const start = formatDate(summary.time_range.start);
    const end = formatDate(summary.time_range.end);
    return start === end ? start : `${start} → ${end}`;
  }, [summary.time_range]);

  return (
    <section className="summary-view">
      <div className="summary-toolbar">
        <button onClick={onReset} className="text-button patient-switch">← 更換病患</button>
        <div className="source-badges">
          <span className={`mode-badge ${result.source_mode}`}>{sourceLabel(result.source_mode)}</span>
          <span className={`mode-badge ${result.ai_mode}`}>{aiModeLabel(result.ai_mode)}</span>
          <span className="mode-badge">Summary 1.0</span>
        </div>
      </div>

      {result.warnings.length > 0 && <div className="warning-strip">{result.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}

      <div className="patient-heading">
        <div><span className="eyebrow">PATIENT TIMELINE</span><h2>{result.patient_name}</h2></div>
        <div className="event-count"><strong>{result.events.length}</strong><span>筆事件</span></div>
      </div>
      <div className="period">涵蓋期間 · {period}</div>

      {summary.attention.level !== "routine" && (
        <div className={`priority-card attention-${summary.attention.level}`}>
          <div className="priority-heading"><span className="priority-dot" /><strong>{summary.attention.label}</strong></div>
          <p>{summary.attention.text}</p>
          <EvidenceChips ids={summary.attention.evidence_event_ids} onClick={onEvidence} />
        </div>
      )}

      <div className="brief-card">
        <span>摘要</span>
        <p>{summary.summary.text}</p>
        <EvidenceChips ids={summary.summary.evidence_event_ids} onClick={onEvidence} />
      </div>

      <SummaryList title="重點資訊" index="01" items={summary.key_points} emptyText="沒有另外整理出的重點。" onEvidence={onEvidence} />
      <SummaryList title="近期變化" index="02" items={summary.recent_changes} emptyText="目前沒有明確的時序變化。" onEvidence={onEvidence} />
      <SummaryList title="患者問題" index="03" items={summary.patient_questions} emptyText="患者沒有明確提出問題。" onEvidence={onEvidence} />

      <div className="summary-boundary">Agent 2只整理輸入內容；診斷、評估、處方及正式紀錄由原本系統與醫療人員處理。</div>

      <button className="timeline-toggle" onClick={onToggleTimeline} aria-expanded={showTimeline}>
        <span>來源時間軸</span><span>{showTimeline ? "收合 ↑" : `查看${result.events.length}筆原文 ↓`}</span>
      </button>

      {showTimeline && (
        <div className="source-timeline">
          {result.events.map((event) => (
            <article id={`source-${event.event_id}`} key={event.event_id} className={highlightId === event.event_id ? "highlight" : ""}>
              <div className="timeline-rail"><span /></div>
              <div>
                <time>{formatFullTime(event.timestamp_utc)}</time>
                <p>{event.text_original}</p>
                <small>{event.event_id} · {speakerLabel(event.speaker)}</small>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="disclaimer-card">
        <strong>閱讀摘要後仍可核對原文</strong>
        <p>AI摘要可能遺漏或誤解資訊，不是診斷、處方或正式病歷。</p>
        <span>產生於{formatFullTime(summary.generated_at)} · {summary.provenance.prompt_version}</span>
      </div>
    </section>
  );
}

function SummaryList({ title, index, items, emptyText, onEvidence }: { title: string; index: string; items: EvidenceItem[]; emptyText: string; onEvidence: (id: string) => void }) {
  return (
    <section className="summary-list-section">
      <header><span>{index}</span><h3>{title}</h3></header>
      <div className="summary-list-content">
        {items.length === 0 ? <p className="empty-summary">{emptyText}</p> : (
          <ul>{items.map((item) => <li key={`${item.text}-${item.evidence_event_ids.join("-")}`}><p>{item.text}</p><EvidenceChips ids={item.evidence_event_ids} onClick={onEvidence} /></li>)}</ul>
        )}
      </div>
    </section>
  );
}

function EvidenceChips({ ids, onClick }: { ids: string[]; onClick: (id: string) => void }) {
  if (!ids.length) return null;
  return <span className="evidence-chips">{ids.map((id) => <button key={id} type="button" onClick={() => onClick(id)} title={`查看來源${id}`}>{id.replace("evt_demo_", "#").replace("evt_", "#")}</button>)}</span>;
}

function LoadingView({ patientName }: { patientName: string }) {
  return <section className="loading-view" aria-live="polite"><div className="loading-orbit"><span>C</span></div><span className="eyebrow">ORGANIZING TIMELINE</span><h2>正在整理{patientName}的對話</h2><p>排序事件、整理重點並連結原文來源…</p><div className="loading-steps"><span className="done">取得Agent 1事件</span><span className="active">建立精簡摘要</span><span>核對來源連結</span></div></section>;
}

function DemoChart() {
  return (
    <div className="demo-chart" aria-hidden="true">
      <nav className="side-nav"><div className="hospital-mark">H</div>{["總覽", "候診", "病歷", "檢驗", "處方"].map((item, index) => <span className={index === 2 ? "active" : ""} key={item}><i>{index + 1}</i>{item}</span>)}</nav>
      <div className="chart-main">
        <header className="chart-top"><div><strong>醫美門診工作台</strong><span>體重管理 · 上午診</span></div><div className="doctor-avatar">陳</div></header>
        <section className="chart-patient"><div className="avatar-placeholder">測</div><div><small>SYNTHETIC PATIENT</small><h2>陳怡安（虛構）</h2><p>DEMO-GLP1-001 · 39歲女性 · 此畫面不含真實個資</p></div><button>編輯病歷</button></section>
        <div className="chart-grid">
          <section><header>本次看診紀錄 <span>待看診</span></header><div className="mock-label">主訴</div><div className="fake-input wide" /><div className="mock-label">現病史</div><div className="fake-lines"><i /><i /><i /><i /></div><div className="mock-label">評估與計畫</div><div className="fake-lines short"><i /><i /><i /></div></section>
          <aside><header>體重療程</header>{[["第9週", "首次升至1.0 mg"], ["第8週", "0.5 mg · 82.4 kg"], ["起始", "88.0 kg"]].map(([date, text]) => <article key={date}><time>{date}</time><strong>{text}</strong><p>合成療程紀錄</p></article>)}</aside>
        </div>
      </div>
    </div>
  );
}

function formatDate(value: string) { return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric" }).format(new Date(value)); }
function formatFullTime(value: string) { return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); }
function sourceLabel(mode: Agent2ApiResult["source_mode"]) { return mode === "agent1" ? "Agent 1" : mode === "manual" ? "測試JSON" : "合成情境"; }
function aiModeLabel(mode: Agent2ApiResult["ai_mode"]) { return mode === "openai" ? "OpenAI" : mode === "reference_demo" ? "參考摘要" : "安全降級"; }
function speakerLabel(value: string) { return { patient: "病患回報", caregiver: "照顧者回報", agent: "Agent追問", clinician: "既有背景", unknown: "來源不明" }[value] || "來源不明"; }
