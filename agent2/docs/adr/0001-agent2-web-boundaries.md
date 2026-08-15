# ADR 0001: Agent 2 Web and Integration Boundaries

- Status: Accepted for prototype
- Date: 2026-08-15

## Context

Agent 2 must appear at the upper-right of a clinician's desktop workflow, obtain a patient dialogue timeline from an independently developed Agent 1, and organize the result with OpenAI into a concise, traceable summary. Professional chart content stays in the main system. Agent 1's final API is not yet available.

## Decision

1. Implement Agent 2 as a responsive web side panel in the repository's Cloudflare-compatible vinext application.
2. Route every external call through server endpoints. The browser does not receive OpenAI or Agent 1 credentials.
3. Isolate Agent 1 behind a single adapter configured with `AGENT1_API_URL` and an optional server-side token.
4. Accept the repository's MVP timestamp-to-text object and the extensible event array.
5. Use the OpenAI Responses API with a strict Structured Output schema and `store: false`.
6. Keep deterministic input validation, warning-sign pre-checking, evidence validation, and safe fallback outside the model call.
7. Provide synthetic and manual JSON modes until Agent 1 is available. These modes are visibly labeled and are not silent substitutes for production data.
8. Store no patient data in this prototype.

## Consequences

- Agent 1 can be replaced without changing the UI or summary pipeline.
- Credentials remain server-side.
- The application remains usable for integration work without Agent 1 or an OpenAI key, but the safe fallback is intentionally only a partial summary.
- Using a patient name as the lookup key is accepted only for the prototype. Production must use an authorized opaque patient or encounter identifier.
- Real clinical deployment still requires authentication, authorization, rate limiting, audit policy, clinical validation, and institutional privacy/security approval.
