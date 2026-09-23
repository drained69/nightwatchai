# NIGHTWATCH AI · Bitget AI Base Camp Hackathon S2

**Track:** AI Trading Desk
**Sub-theme:** Information Extraction & Signal Generation
**Signature surface:** Decision stress-testing (Thesis Lab)
**Secondary surfaces:** Personalized research workbench · Post-trade review · Execution assistance

**Live:** https://nightwatchai.watch
**Repo:** https://github.com/drained69/nightwatchai

---

## Project Description

### 1. Thesis

Traders in 7×24 markets are drowning in unstructured signal. Overnight earnings prints, cross-asset macro shifts, on-chain flow, and social sentiment all move the tape before the desk can read a single headline. Every existing chat assistant summarizes — none of them extract a *structured, actionable* signal with a challenged thesis, an invalidation, and an execution plan you can approve or kill.

NIGHTWATCH AI is a natural-language AI trading research workstation. The trader types a question in plain English; NIGHTWATCH classifies the intent, invokes the five official Bitget `bitget-signal` research skills against real Bitget market data, extracts signal from unstructured news + tape + macro + sentiment, and produces a structured report with a directional signal, supporting evidence, contradicting evidence, an 8-category risk breakdown, direction-aware invalidation conditions, historical analogs, and a suggested execution plan. The trader always makes the final decision.

The hackathon-critical claim: *AI extracts, synthesizes, and challenges; the trader decides.* Autonomous fills look impressive in demos and fail the Track 3 contract.

### 2. Target user and product value

Discretionary traders in tokenized U.S. mega-cap tech and crypto majors ($5k–$100k paper-equivalent) who want to compress unstructured overnight information into an approvable insight in about 90 seconds. Not autonomous-agent users; not backtest-first quants.

Value delivered:

- **Compress information.** Ask *"Why is NVDA moving?"* → structured report with news gap, volume z-score, RSI, sentiment, macro regime, net edge, direction-aware invalidation.
- **Stress-test decisions.** Thesis Lab surface takes any free-text thesis and returns a steelman, counter-thesis, 5 stress tests, and a confidence delta.
- **Understand portfolio impact.** *"How does $2k long BTC affect my book?"* → Δ exposure, Δ beta, sector mix, cap check.
- **Learn from decisions.** Post-trade review compares original thesis vs actual outcome, calls out missed risks, and surfaces recurring patterns.
- **Act on the verdict.** Approve into a server-authoritative paper book that marks to the live Bitget tape, or route the same order live through Bitget's UTA v3 API into an isolated Agentic Account — every route gated by an explicit per-order confirm plus a one-click kill switch.

### 3. Validation data and key metrics

- Complete research task time: <90s from question to decision-ready report on the Research page.
- Decision refusal: NO_TRADE reports have no fill path; `applyTraderDecision` throws on approve — covered by unit test.
- Portfolio impact accuracy: exposure, beta, and sector mix computed deterministically off the paper book — covered by unit test.
- Thesis Lab confidence delta is monotonic (never rises after stress test) — covered by unit test.
- Paper capital ledger: APPROVE reserves notional server-side, CLOSE releases + credits realized P&L, both idempotent by position id — covered by manual end-to-end verification and exercised in the live product.
- Test coverage: 119 `node:test` cases across intent routing, skill pack, live-data paths, signal synthesis, direction-aware invalidation, report generation, thesis, portfolio, review, session migration, JWT, RSS ingestion, alerts, sharing, playbooks, and paper accounts.

Distribution target: 50 overnight discretionary traders in month one; retention measured as *"ran a second research task in 7 days."*

### 4. Progress — what's actually live

Everything below is running in production today at nightwatchai.watch, not scaffolded:

- **18-asset universe with real live prices.** 8 crypto majors + 10 tokenized U.S. mega-caps via Bitget's R-prefixed pairs (`RNVDAUSDT` etc.). Sourced from both Bitget's public REST (ticker, candles, orderbook) and a live public **WebSocket** tick stream — sub-second cadence, auto-reconnect with heartbeat.
- **5 research skills** matching the official Bitget `bitget-signal` skill vocabulary: `news-briefing`, `market-intel`, `technical-analysis`, `sentiment-analyst`, `macro-analyst`.
- **Bitget Signal MCP — real, live, connected.** A Streamable-HTTP MCP client against Bitget's hosted signal MCP (the same endpoint `@bitget-ai/bitget-signal` registers into Claude Code / Cursor / Windsurf). 19 tools reachable and callable both server-side and directly by the trader via a "Run MCP" button on each research skill chip.
- **Direction-aware signal synthesis:** direction, confidence, expected edge (derived from real ATR), friction (real Bitget spot spread), risk adjustment, net edge, status, catalyst, composite score. Trader-configurable gates (minimum confidence, minimum net edge) with three one-click presets — Aggressive, Balanced, Conservative.
- **Deepened research report:** regime signals grid (7 dimensions), skill-by-skill confidence breakdown, catalyst with primary print + supporting headlines, live wire tape with tagged assets, situation, short-term and long-term thesis with drivers, 8-category risk taxonomy, direction-aware invalidation with a structural stop price, 4 stress tests, historical analogs, and a suggested execution plan with a 6-bullet management runbook.
- **Live news wire — 17 feeds**, including Bitget's own announcement RSS, SEC 8-K, per-CIK SEC Form 4 for all 10 equities, CoinDesk, CoinTelegraph, The Block, Yahoo Finance, CNBC.
- **Server-authoritative paper account.** APPROVE reserves the trade's notional from free capital into allocated capital; CLOSE releases the reservation and credits realized P&L — both idempotent by position id, both real state on the server, not a client-side simulation.
- **Live order routing — shipped, opt-in, off by default.** Bitget Agent Hub OAuth flow authorizes the operator's isolated **Agentic Account**; approved reports get a "Route to Agentic Account (LIVE)" button that submits real orders through Bitget's **Unified Trading Account (UTA v3)** API. Gated by an explicit per-order confirm modal plus server-side `confirm: true`; one-click kill switch cancels every open order and revokes authorization.
- **Thesis Lab:** steelman + counter-thesis + 5 stress tests + invalidation + confidence delta + verdict.
- **Portfolio impact simulator:** Δ exposure, Δ beta, crypto weight, sector mix, cap check.
- **Post-trade review** comparing thesis vs outcome, surfacing missed risks and recurring patterns.
- **Alpha of the Day** — AI-authored daily brief on the tokenized-equity universe, auto-generated 02:00 UTC, opt-in email delivery via Resend.
- **Plain-English alerts**, Web Push, downloadable PNG research cards, public signal accuracy ledger, backtester on cached real Bitget candles.
- Combined production server (`server/static-serve.mjs`): SPA + full API on one port, `/health` + `/metrics` for uptime.
- Passwordless email OTP sign-in (Resend); session state follows the account across devices.

### 5. Deliverables

- **Accessible demo:** live at https://nightwatchai.watch (email OTP sign-in — see demo video for the full walkthrough). Local dev: `npm install && npm run server && npm run dev` — no keys required.
- **Repository:** https://github.com/drained69/nightwatchai — `README.md`, `SUBMISSION.md`, `DEPLOYMENT.md`, `src/`, `server/`.
- **Tests:** `npm test` — 119 `node:test` cases (domain, backtest, live-data, platform, playbooks, paper accounts, alerts, sharing).
- **Static build:** `npm run build` — combined production server via `npm start`.
- **Server adapter:** `npm run server` — enables LLM narration, Bitget WebSocket + Signal MCP clients, and (when OAuth credentials are provisioned) live Agentic Account routing.

### 6. Take on AI trading

The useful split isn't *"AI vs human,"* it's *"AI extracts and challenges; the trader decides."* Autonomous fills look impressive in a demo and fail the Track 3 contract. NIGHTWATCH is built so the judge can watch the desk refuse to trade — the sit-out is a first-class outcome, and the trader's own risk-profile presets shape exactly when that happens.

Two more design commitments worth naming:

- **Visible research process.** Every research run streams the five skills with confidence and source, so the reader sees the tool invocations and the evidence, not just the conclusion — including a live, on-demand MCP call the trader can trigger themselves per skill.
- **Real execution has real boundaries.** Live routing exists, but only inside Bitget's own Agentic Account isolation model — a dedicated agent-only sub-account, capped by Agent Hub's own daily limits, gated by a per-order confirm, and killable in one click. Paper trading is the default in every code path where that authorization isn't present.

---

## Role of the LLM in your product

- **Qwen 3.8** (via Bitget's hackathon endpoint) narrates every research report — summary, reasoning, short-horizon thesis, long-horizon thesis. Numbers, tickers, verdicts, and invalidation prices are never rewritten by the LLM; it only rewrites prose. Fallback chain to xAI grok, Anthropic Claude, or OpenAI GPT if a key is set on the server.
- **Local deterministic skill pack** is the fallback when no adapter is running or the LLM key is absent — the app degrades honestly to seeded values stamped `DEMO`, never silently.
- **Bitget Signal MCP** is a live, running integration, not a stub: a real Streamable-HTTP MCP client handshakes with Bitget's hosted signal server and exposes 19 tools, invocable both server-side (research pipeline) and directly by the trader (per-skill "Run MCP" button).
- The browser never holds any provider key. All LLM and Bitget credentials live server-side.

Qwen credits were used both as a coding assistant during implementation and as the in-product research-narration engine — the live deployment calls Qwen 3.8 directly for every research report.

---

## Track → sub-theme

AI Trading Desk → **Information Extraction & Signal Generation**
(Signature surface: **Decision stress-testing** — Thesis Lab. Secondary: Personalized research workbench + Post-trade review + Execution assistance via Agentic Account routing.)
