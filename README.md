# Healthcare Information System — Ver2

Ver2 combines the newest Agent 1 patient experience with the existing Agent 2 clinician summary panel. The source directories `ntuhack-team07/` and `ntuhack-team07-ver1/` remain independent and unchanged.

## Structure

```text
ntuhack-team07-ver2/
├── .env.example       # Shared environment template
├── agent1/            # New patient UI, lifestyle/nutrition modes, timeline API
└── agent2/            # Clinician-side time-series summary panel
```

## Modes

- Agent 1 assistant mode: `lifestyle` or `nutrition`, selected from the new UI.
- Agent 1 model provider: OpenAI, Anthropic, or the offline demo provider.
- Agent 2 model provider: OpenAI when configured, otherwise a clearly labelled safe fallback/reference demo.
- Nutrition-mode conversations are intentionally excluded from the Agent 2 clinician data bundle.

## Environment

Copy `.env.example` to `.env` and add the server-side key. Both agents load this shared file.
For the local Cloudflare/Vite runtime, `agent2/.env` is an ignored symbolic link to this same root file, so there is still only one credential source.

```text
OPENAI_API_KEY=
AGENT1_OPENAI_MODEL=gpt-5-mini
AGENT2_OPENAI_MODEL=gpt-4o-mini
AGENT1_PORT=3001
AGENT2_PORT=3000
AGENT1_API_URL=http://127.0.0.1:3001/api/agent2/timeline
AGENT1_API_TOKEN=
```

Do not put credentials in browser code or commit `.env`.

## Run locally

In separate terminals:

```bash
cd agent1
npm install
npm start
```

```bash
cd agent2
npm install
npm run dev
```

- Agent 1 patient UI: `http://localhost:3001`
- Agent 2 clinician panel: `http://localhost:3000`

Agent 2 sends `{ "patient_name": "..." }` to Agent 1's `POST /api/agent2/timeline` endpoint and receives a timestamped, source-faithful event list.

## Safety boundary

This is a synthetic-data prototype for information organization. It does not diagnose, prescribe, replace clinician judgement, or write into a medical record. Production use still requires authentication, authorization, audit, privacy, retention, and clinical-safety review.
