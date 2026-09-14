# NIGHTWATCH AI · Bitget AI Base Camp Hackathon S2

**Track:** AI Trading Desk
**Sub-theme:** Information Extraction & Signal Generation
**Signature surface:** Decision stress-testing (Thesis Lab)
**Secondary surfaces:** Personalized research workbench · Post-trade review · Execution assistance

---

## Project Description

### 1. Thesis

Traders in 7×24 markets are drowning in unstructured signal. Overnight earnings prints, cross-asset macro shifts, on-chain flow, and social sentiment all move the tape before the desk can read a single headline. Every existing chat assistant summarizes — none of them extract a *structured, actionable* signal with a challenged thesis, an invalidation, and an execution plan you can approve or kill.

NIGHTWATCH AI is a natural-language AI trading research workstation. The trader types a question in plain English; NIGHTWATCH classifies the intent, invokes the five official Bitget `bitget-signal` research skills, extracts signal from unstructured news + tape + macro + sentiment, and produces a structured report with a directional signal, supporting evidence, contradicting evidence, risks, invalidation conditions, historical analogs, and a suggested execution plan. The trader always makes the final decision.

The hackathon-critical claim: *AI extracts, synthesizes, and challenges; the trader decides.* Autonomous fills look impressive in demos and fail the Track 3 contract.

### 2. Target user and product value

Discretionary traders in tokenized U.S. mega-cap tech and crypto majors ($5k–$100k paper-equivalent) who want to compress unstructured overnight information into an approvable insight in about 90 seconds. Not autonomous-agent users; not backtest-first quants.

Value delivered:

- **Compress information.** Ask *"Why is NVDA moving?"* → structured report with news gap, volume z-score, RSI, sentiment, macro regime, net edge, invalidation.
- **Stress-test decisions.** Thesis Lab surface takes any free-text thesis and returns a steelman, counter-thesis, 5 stress tests, and a confidence delta.
- **Understand portfolio impact.** *"How does $2k long BTC affect my book?"* → Δ exposure, Δ beta, sector mix, cap check.
- **Learn from decisions.** Post-trade review compares original thesis vs actual outcome, calls out missed risks, and surfaces recurring patterns.

### 3. Validation data and key metrics (targeted)

- Complete research task time: <90s from question to decision-ready report on the Research page.
- Decision refusal: NO_TRADE reports have no fill path; `applyTraderDecision` throws on approve — covered by unit test.
- Portfolio impact accuracy: exposure, beta, and sector mix computed deterministically off the paper book — covered by unit test.
- Thesis Lab confidence delta is monotonic (never rises after stress test) — covered by unit test.
- Test coverage: 89 `node:test` cases across intent routing, skill pack, live-data paths, signal, report, thesis, portfolio, review, session migration, alerts, sharing, playbooks, paper accounts.

Distribution target: 50 overnight discretionary traders in month one; retention measured as *"ran a second research task in 7 days."*

### 4. Progress

Built and runnable:

- Universe of 18 assets (8 crypto majors + 10 tokenized U.S. mega-caps) with **real live prices** — crypto via Bitget spot pairs, equities via Bitget's R-prefixed tokenized-stock pairs (RNVDAUSDT etc.). Seeded values remain only as the offline-demo fallback and are stamped `DEMO`.
- 5 research skills matching the official Bitget `bitget-signal` skill vocabulary: `news-briefing`, `market-intel`, `technical-analysis`, `sentiment-analyst`, `macro-analyst`.
- Deterministic signal synthesis: direction, confidence, expected edge, friction, risk adjustment, net edge, status, catalyst, composite score.
- Full research report with signal, supporting evidence, contradicting evidence, risks, invalidation, analogs, suggested execution plan.
- Thesis Lab: steelman + counter-thesis + market-pricing take + 5 stress tests + invalidation + confidence delta + verdict.
- Portfolio impact simulator: Δ exposure, Δ beta, crypto weight, sector mix, cap check.
- Post-trade review comparing thesis vs outcome, surfacing missed risks and recurring patterns.
- Opportunity scan across watchlist or full universe.
- Paper-only, trader-gated execution. Never routes live orders.
- Optional Node HTTP adapter (`server/desk-adapter.mjs`) with `/research`, `/bitget/status`, `/health`. Rewrites narration via xAI grok / Anthropic Claude / OpenAI GPT if a key is set on the server. Model keys never touch the browser.
- SPA UI: Research (hero) · Markets · Signals · Thesis Lab · Portfolio · History · Settings.
- Session persistence via `localStorage` with automatic migration from prior v1/v2 sessions.

Not yet built:

- Live Bitget MCP proxy. The seam exists (`BITGET_MCP_URL` env var; `/bitget/status` probe; SPA switches from `DEMO · SIMULATED` to `BITGET MCP · LIVE` when connected). Next step is a first-party sidecar that calls `bgc mcp` and forwards `SkillResult` payloads verbatim.
- Live Bitget order routing — deliberately out of scope for Track 3.

### 5. Deliverables

- **Accessible demo:** `npm install && npm run dev` — no keys required.
- **Repository:** this project (README.md, SUBMISSION.md, `src/`, `server/desk-adapter.mjs`).
- **Tests:** `npm test` — 89 tests (domain, backtest, live-data, platform, playbooks).
- **Static build:** `npm run build` — deploys to any static host, `base: './'` so GitHub Pages works.
- **Optional server adapter:** `npm run server` — enables LLM narration rewrite and Bitget MCP proxy.

### 6. Take on AI trading

The useful split isn't *"AI vs human,"* it's *"AI extracts and challenges; the trader decides."* Autonomous fills look impressive in a demo and fail the Track 3 contract. NIGHTWATCH is built so the judge can watch the desk refuse to trade — the sit-out is a first-class outcome.

Two more design commitments worth naming:

- **Visible research process.** Every research run streams the five skills with confidence and source, so the reader sees the tool invocations and the evidence, not just the conclusion. This is the demo.
- **Skill schema portability.** The `SkillResult` shape emitted by the local skill pack is identical to what a Bitget MCP response would produce, so replacing the local skill body with a live Bitget MCP proxy is a server-side swap — the UI contract never changes.

---

## Role of the LLM in your project

- **Local structured skill pack** (default). `src/domain.js` produces deterministic, seeded `SkillResult` artifacts for all 5 Bitget research skills, so the demo runs credential-free and is fully reproducible.
- **Optional server adapter** (`server/desk-adapter.mjs`) can rewrite the report `summary` and `reasoning` fields through xAI grok (`XAI_API_KEY`, `grok-4-fast` default), Anthropic Claude (`ANTHROPIC_API_KEY`, `claude-sonnet-4-5` default), or OpenAI GPT (`OPENAI_API_KEY`, `gpt-5` default). Numbers, tickers, verdicts, and invalidation prices are never rewritten.
- **Optional Bitget MCP proxy.** With `BITGET_MCP_URL` set, the adapter probes the Bitget Agent Hub `bitget-signal` sidecar and reports the connection state to the SPA. If the sidecar returns skill outputs matching the same `SkillResult` shape, they can be forwarded verbatim.
- The browser never holds any provider key.

If Qwen credits were used during implementation, they were used as a coding assistant, not as the in-product research engine.

---

## Track → sub-theme

AI Trading Desk → **Information Extraction & Signal Generation**
(Signature surface: **Decision stress-testing** — Thesis Lab. Secondary: Personalized research workbench + Post-trade review.)
