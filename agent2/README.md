# CuriLoop — Agent 2

CuriLoop Agent 2 is a clinician-facing timeline summary assistant. It obtains time-series patient dialogue from Agent 1, validates and orders the events, then shows a concise, traceable Traditional Chinese summary beside the existing clinical system.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
cd agent2
npm install
npm run dev
```

Open `http://localhost:3000`.

The app works immediately with the synthetic **陳怡安（虛構）** semaglutide dose-escalation scenario documented in `reference/demo-example.md`. Select **REFERENCE DEMO** to load the complete reference result without an API key. To test a specific payload, expand **使用自訂Agent 1測試JSON** and paste an MVP or extensible time-series payload.

Summary v1.0 follows `reference/summary-format.json`. It contains only an overall summary, important points, recent changes, patient questions, an attention label, and source links. Professional chart content stays in the main system.

## Enable OpenAI

Set `OPENAI_API_KEY` in the workspace-root `.env`, leave `PROVIDER` blank, then restart both local servers. Agent 1 and Agent 2 share this environment file. The key is read only by server-side code and must never be added to client code or committed. Agent 2 verifies API/model access through `/api/status` without returning the key to the browser.

Optional:

```text
AGENT2_OPENAI_MODEL=gpt-4o-mini
```

## Connect Agent 1

Set:

```text
AGENT1_API_URL=http://127.0.0.1:3001/api/agent2/timeline
AGENT1_API_TOKEN=optional-token
```

Agent 2 sends a server-side `POST` request containing `{ "patient_name": "..." }`. See `agent2.md` for the complete contract and production considerations.

## Checks

```bash
npm run build
npm run test:unit
npm run lint
```

## Clinical-use boundary

This prototype organizes information for clinician review. It does not establish a diagnosis, prescribe treatment, replace clinical judgment, or write into a medical record. Do not use real patient data until authentication, authorization, audit, retention, security, institutional privacy, and clinical-safety reviews are complete.
