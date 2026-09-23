<div align="center">

# NIGHTWATCH AI

### An AI trading research desk for tokenized U.S. equities on Bitget.

[![Live](https://img.shields.io/badge/Live-nightwatchai.watch-0ea5e9?style=flat-square)](https://nightwatchai.watch)
[![Repo](https://img.shields.io/badge/GitHub-drained69%2Fnightwatchai-181717?style=flat-square&logo=github&logoColor=white)](https://github.com/drained69/nightwatchai)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Tests](https://img.shields.io/badge/tests-119%2F119%20passing-brightgreen?style=flat-square)](#testing)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ed?style=flat-square&logo=docker&logoColor=white)](docker-compose.yml)

**Trade the information, not just the chart.**
AI extracts and synthesizes; the trader owns every decision.

</div>

---

## For hackathon reviewers

| Item | Link |
|---|---|
| **Live product** (requires 30-second email sign-in) | https://nightwatchai.watch |
| **Public repo** | https://github.com/drained69/nightwatchai |
| **Track** | AI Trading Desk — Bitget AI Base Camp S2 |
| **Run record** | Full research-task walkthrough — see the demo video |

### 60-second verification (no sign-in required)

```bash
# 1. Bitget Signal MCP is live and reachable (19 tools)
curl -s https://nightwatchai.watch/bitget/status | jq '{connected, model, tools: (.skills|length)}'

# 2. Bitget public WebSocket is streaming (18/18 pairs)
curl -s https://nightwatchai.watch/bitget/ws-status | jq '{connected, cachedPairs, msgCount, ageMs}'

# 3. Live prices from the WS stream (equity R-pairs + crypto majors)
curl -s https://nightwatchai.watch/prices/live | jq '{stream, pairCount: (.tickers|length)}'

# 4. Live news wire including Bitget's own announcement feed
curl -s 'https://nightwatchai.watch/news/live?limit=200' \
  | jq '[.items[] | select(.source == "Bitget Announcements")] | length'
```

---

## Table of Contents

- [Overview](#overview)
- [What's Built](#whats-built)
- [Bitget Agent Hub Integration](#bitget-agent-hub-integration)
- [The Core Loop](#the-core-loop)
- [Product Surfaces](#product-surfaces)
- [Alpha of the Day](#alpha-of-the-day--daily-brief)
- [Architecture](#architecture)
- [Data Honesty](#data-honesty)
- [Human-in-the-Loop Guarantees](#human-in-the-loop-guarantees)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Testing](#testing)
- [Real Live Data Proof](#real-live-data-proof)
- [Production Readiness](#production-readiness)
- [Project Structure](#project-structure)
- [Security Notes](#security-notes)
- [Contributing](#contributing)
- [License](#license)
- [Disclaimer](#disclaimer)

---

## Overview

NIGHTWATCH AI is a browser-native AI research workbench built for **event-driven and information-heavy traders** — the ones who move on earnings prints, macro releases, breaking headlines and overnight tape, not just candlestick patterns.

A trader types a question in plain English ("*Why is NVDA moving right now?*"). NIGHTWATCH invokes five Bitget-signal research skills against live Bitget market data, cross-venue perp positioning, macro tape, and a real-time news wire; synthesizes the evidence into a structured desk report with a directional verdict, supporting and contradicting evidence, invalidation levels, stress tests and a suggested execution plan; and hands the trader an APPROVE / REJECT / SIT-OUT decision. Nothing routes without an explicit per-order confirm.

**Primary universe.** 10 tokenized U.S. mega-caps (`NVDA`, `TSLA`, `AAPL`, `MSFT`, `AMZN`, `GOOGL`, `META`, `AMD`, `COIN`, `MSTR`) traded on Bitget as R-prefixed spot pairs (`RNVDAUSDT`, `RTSLAUSDT`, …). 8 crypto majors (`BTC`, `ETH`, `SOL`, `BNB`, `XRP`, `DOGE`, `AVAX`, `ADA`) are kept as a macro-regime and correlation set.

**What NIGHTWATCH is not.** Not an autonomous trading agent. Not a signal-only chart tool. Not a paper simulator with fabricated fills. Every price, every headline, every indicator is sourced from a real live provider; every fill on the paper book marks-to-market against the live Bitget WebSocket tape; every live order routes through Bitget's Unified Trading Account (UTA v3) into an isolated Agentic Account with a per-order confirm and a one-click kill switch.

---

## What's Built

Grouped by product pillar. Every row below is live in production.

### Market data

| Capability | Implementation |
|---|---|
| **18-asset universe** | 10 tokenized U.S. equities (Bitget R-pairs) + 8 crypto majors, all with real live spot ticker, 1h candles, 15-level orderbook. |
| **Bitget public WebSocket** | `wss://ws.bitget.com/v2/ws/public` ticker channel subscribed to every mapped pair with auto-reconnect + 20-second heartbeat. Sub-second cadence; the tape shows a `BITGET WS` pill when the socket is fresh and falls back transparently to REST during reconnects. |
| **Bitget public REST** | Ticker, candles (paged to ~2000 bars per asset), and 15-level orderbook. Retry with exponential backoff; stale-while-revalidate cache so transient outages degrade honestly. |
| **Cross-venue perp positioning** | Binance + OKX + Bitget funding rates and open interest aggregated per asset with a per-venue table showing Bitget as the home venue. |
| **Live macro tape** | DXY · S&P 500 · Nasdaq · VIX · UST10Y via Yahoo Finance, drives the `macro-analyst` skill and risk-regime classification. |
| **Live news wire** | 17 feeds — CoinDesk · The Block · CoinTelegraph · **Bitget Announcements** · SEC 8-K · Yahoo Finance · CNBC · and per-CIK SEC Form 4 feeds for all 10 equities. LLM-classified per-ticker impact with heuristic fallback; cross-source dedup by content hash + token overlap. |
| **Live sentiment** | Crypto Fear & Greed Index, BTC network hash rate, best-effort BTC/ETH ETF net flows. |
| **Earnings calendar** | Nasdaq public earnings feed with consensus EPS + reporting date; surfaced on the Research hero and Analysis workbench. |

### Research & AI

| Capability | Implementation |
|---|---|
| **Five Bitget research skills** | `news-briefing` · `market-intel` · `technical-analysis` · `sentiment-analyst` · `macro-analyst` — the same skill IDs Bitget's `@bitget-ai/bitget-signal` package registers. |
| **Bitget Signal MCP (live client)** | Streamable HTTP MCP client against Bitget's hosted signal MCP (`datahub.noxiaohao.com/mcp`, the same one `@bitget-ai/bitget-signal` registers into Claude Code / Codex / OpenClaw). 19 real tools reachable — `crypto_market`, `defi_analytics`, `sentiment_index`, `technical_analysis`, `macro_indicators`, `cross_asset`, `derivatives_sentiment`, `news_feed`, and 11 more. Handles the full MCP handshake (`initialize` → `notifications/initialized` → `tools/list`), session IDs, SSE-framed responses, auto-reconnect. |
| **Skill chip → MCP invocation** | Each of the five skill chips on the Research page carries an `MCP · RUN <tool>` button that fires the matching MCP tool for the current symbol and renders the raw response inline. |
| **LLM narration** | Qwen 3.8 via Bitget's hackathon endpoint (fallback chain: Qwen → xAI → Anthropic → OpenAI, first key wins) with word-boundary keyword heuristics as the offline fallback. |
| **Analysis workbench** | `GET /analysis/{SYMBOL}` bundles ticker + indicators + orderbook + cross-venue positioning + macro + symbol-tagged news + earnings, then Qwen produces a four-part desk analysis (technical · flow · narrative · verdict) with concrete entry / stop / target / invalidation. |
| **Signal accuracy ledger** | Every LONG / SHORT signal recorded with entry price, resolved against real forward price at an 8-hour horizon, aggregate hit-rate at `/signals/stats`. |
| **Backtester** | Runs on cached real Bitget candles (deep-paged to ~2000 hourly bars per asset) with per-bar no-lookahead indicators; reports precision, recall, and lift. |
| **Thesis Lab** | Trader submits any thesis in plain English; the engine returns a steelman, a counter, five stress tests, and a pre-vs-post confidence delta. |
| **Portfolio Copilot** | Per-position Pearson correlation to BTC from cached real hourly returns, factor clustering, sector-concentration warnings. |
| **Persona-tuned signals** | Risk profile + trading style + horizon preferences fold into composite threshold, skill weights, sizing, and target multiple. |
| **One-click gate presets** | Settings → Trader profile ships three presets — Aggressive · demo-friendly, Balanced · out-of-box, Conservative · pro — each a single patch to risk profile, trading style, horizon, minimum confidence, minimum net edge, and max position size. |

### Trading

| Capability | Implementation |
|---|---|
| **Paper-first by default** | Every user starts with $10,000 of virtual capital. `applyTraderDecision` throws unless `settings.paperOnly !== true`. |
| **Server-authoritative capital ledger** | APPROVE reserves the trade's notional from `freeCapital` into `allocatedCapital` server-side; CLOSE releases the reservation and folds realized P&L into `totalPnl` in one atomic, idempotent operation. The Portfolio strip's PAPER CAPITAL / FREE / ALLOCATED numbers reflect every self-directed trade, not just followed Playbooks. |
| **Paper positions marked to real tape** | Every open paper position is marked to the live Bitget WebSocket price on every tick. Realized and unrealized P&L are computed from the real fills, not simulated. |
| **One-click "COPY TO PAPER PORTFOLIO"** | Every research report ships with an Action Summary card exposing verdict + plan + one-click paper approval, plus REJECT / SIT-OUT and a deep-link to trade on Bitget. |
| **Live routing (opt-in)** | `ROUTE TO AGENTIC ACCOUNT (LIVE)` button on approved reports routes real orders through **Bitget's Unified Trading Account (UTA v3)** API into the operator's **Agentic Account** — the isolated Agent Hub sub-account authorized via OAuth, separate from the operator's main funds and capped by daily limits set on Agent Hub. |
| **Per-order confirm modal** | Every live route requires an explicit trader confirm; the server route additionally requires `confirm: true` in the payload. |
| **Kill switch** | One button in Settings cancels every open Agentic Account order and revokes the OAuth authorization. Endpoint `POST /trading/kill` fires the same operation server-side. |
| **Playbooks + The Assayer** | Composable published strategies with real-price paper P&L; The Assayer is an AI chat companion that drafts Playbooks from plain-English prompts. |

### Platform

| Capability | Implementation |
|---|---|
| **Streaming everywhere** | Server-Sent Events for prices and news; WebSocket for Bitget tick data. No client-side polling. |
| **Passwordless auth** | Email OTP via Resend — 6-digit code, 10-minute TTL, scrypt-hashed with salt, timing-safe verify, 5-attempt limit. HS256 JWT scopes every request to the user; the same identity follows watchlist, positions, reports and paper capital across devices. |
| **Per-user persistence** | JSON files under `./data/` scoped per user id; drop-in Postgres path documented in `DEPLOYMENT.md`. |
| **Plain-English alerts** | LLM-parsed rule ("*Alert me when NVDA drops below 220*") evaluated every 15 seconds against the live tape; fires Web Push + SSE toast on match. |
| **Web Push notifications** | VAPID auto-generated on first boot; HIGH-relevance news items that touch the trader's watchlist or open book fire push. |
| **Report sharing** | Any report can be shared via a signed public URL with a 30-day expiry and a view counter. |
| **Rate limiting** | Sliding-window per-key limiter on expensive endpoints (LLM-backed research, admin routes). |
| **Deploy** | One Dockerfile, one `docker compose up`, `./data` bind-mount, `/health` + `/metrics` for uptime + Prometheus. |
| **Test suite** | 119 `node:test` cases covering domain, backtest, live-data paths, JWT, RSS, store, alerts, sharing, copilot, playbooks, paper accounts, and session migration. |

---

## Bitget Agent Hub Integration

The product treats Bitget as its first-party venue across seven integration seams. Every seam is live and independently verifiable.

### 1. Public market-data REST (all 18 assets)

Direct HTTPS to `api.bitget.com` for spot tickers, 1h candles, and 15-level orderbooks — for both crypto pairs and the R-prefixed tokenized-equity pairs. Feeds every price, indicator, and book depth surface in the app.

### 2. Public WebSocket tick stream

`wss://ws.bitget.com/v2/ws/public` ticker channel subscribed for all 18 mapped pairs; auto-reconnect with exponential backoff; 20-second heartbeat per Bitget spec; freshness gate so downstream consumers never serve arbitrarily-old ticks. The topbar `BITGET WS` pill flips to `BITGET REST` during reconnects for full transparency.

### 3. Bitget Signal MCP (Streamable HTTP client)

Real MCP client against Bitget's hosted Signal MCP at `datahub.noxiaohao.com/mcp` — the endpoint that `@bitget-ai/bitget-signal` registers into Claude Code / Codex / OpenClaw / Windsurf. Speaks MCP protocol: `initialize` → `notifications/initialized` → `tools/list` → `tools/call`, with SSE-framed responses, session-ID management, and auto-reconnect on session expiry. **19 real tools reachable** and callable via `POST /mcp/call`. Each of the five research-skill chips on the Research page invokes the matching MCP tool live.

### 4. Bitget Announcements in the news wire

Bitget's own announcement RSS (`bitget.com/support/rss`) is a first-class news source alongside CoinDesk, SEC 8-K, and Yahoo Finance. Delistings, deposit/withdrawal suspensions, campaign announcements, and R-pair events flow into `/news/live` tagged as `category: exchange`. This is a first-party venue signal no other news source in the pipeline can provide.

### 5. Agentic Account routing via UTA v3

Bitget Agent Hub's official OAuth flow drops the operator into their **Agentic Account** — a dedicated agent-only Bitget sub-account isolated from their main funds and capped by the daily limits they configure on Agent Hub. When the operator authorizes and `BITGET_LIVE_ENABLED=1` is set on the server, approved research reports gain a `ROUTE TO AGENTIC ACCOUNT (LIVE)` button that submits real orders through Bitget's **UTA v3** API. Per-order confirm modal + server-side `confirm: true` requirement + one-click kill switch (cancel-all + revoke). Paper trading remains the default in every code path where OAuth isn't provisioned.

### 6. Deep-linked venue CTAs

Every research report, analysis workbench header, and news card that references a symbol carries a deep link to the corresponding Bitget product page — `bitget.com/spot/{SYM}USDT` for crypto majors, `bitget.com/pre-market/stocks/{SYM}` for tokenized equities. Verified live.

### 7. Cloudflare Worker relay for cloud IP resilience

A companion Cloudflare Worker (`relay/worker.js`) transparently proxies Bitget's public market-data endpoints. Bitget's WAF blocks Railway / datacenter shared IPs with a bare `{"cloudflare":"block"}` 403; the relay egresses from Cloudflare's own network so the app reaches Bitget reliably from any cloud host. Path-restricted (public market data only), GET-only, shared-secret auth via `x-relay-key`. Toggled via `BITGET_BASE_URL` — swap direct↔relay without a code change.

---

## The Core Loop

```
                        USER QUESTION (plain English)
                                    │
                    intent classifier: research vs thesis
                                    │
                    ┌───────────────┴───────────────┐
                    ↓                               ↓
      RESEARCH pipeline                THESIS-LAB pipeline
                    │                               │
     five Bitget-signal research skills     steelman + counter-arguments
     news-briefing · market-intel · TA      + 5 concrete stress tests
     sentiment-analyst · macro-analyst      + confidence delta
                    │
     ├─ live Bitget WS + REST tape (18 assets)
     ├─ real macro (Yahoo Finance)
     ├─ real news (17 feeds, LLM-classified)
     ├─ cross-venue perp positioning (Binance + OKX + Bitget)
     ├─ symbol-tagged earnings (Nasdaq public API)
     └─ optional MCP delegation via Bitget Signal MCP (19 tools)
                    │
     signal synthesis: composite score, expected edge,
     estimated friction, risk adjustment, net edge
                    │
     structured research report:
       · regime signals grid (7 dimensions)
       · skill breakdown table with confidence bars
       · catalyst + primary print + supporting cast
       · live wire tape with per-item tagged assets
       · situation, short-term thesis, long-term thesis
       · what-would-change-this-thesis, stress tests
       · supporting + contradicting evidence
       · risks (8-category taxonomy)
       · invalidation (direction-aware price + conditions)
       · historical analogs
                    │
     suggested execution plan:
       entry · stop · target · notional · R:R · slice ladder
       + 6-bullet detailed runbook (sizing, order type,
         stop discipline, TP ladder, TIF, kill-switch)
                    │
       ┌────────────┴─────────────┐
       ↓                          ↓
   HUMAN DECIDES:            SIT-OUT: change-of-mind
   APPROVE (paper)           conditions rendered as
   APPROVE + ROUTE TO        entry gates for the next
   AGENTIC ACCOUNT (live)    scan
   REJECT
                    │
       APPROVE → position opens on the paper book, marks
       to real Bitget WS tape on every tick; decision
       + rationale stored in History; signal added to
       the public accuracy ledger
```

---

## Product Surfaces

| Page | Purpose |
|---|---|
| **Research** | Natural-language terminal. Streams the five-skill research process live and renders the full structured report (regime grid, skill breakdown, catalyst, live wire, thesis, invalidation, plan). |
| **Alpha of the Day** | AI-authored daily brief on the tokenized U.S. equity universe. Auto-generated at 02:00 UTC; opt-in email delivery. |
| **Analysis** | Single-symbol workbench. Ticker + indicators + spot book + cross-venue positioning + macro + symbol-tagged news + earnings → Qwen four-part desk writeup with concrete verdict and levels. |
| **News** | Live news tape with per-item impact analysis (relevance, direction, tagged assets, severity). |
| **Signals** | Every generated signal with resolved outcome, plus the last opportunity scan. |
| **Markets** | 18-asset scanner — live prices, class filter, watchlist toggle, one-click research. |
| **Thesis Lab** | Stress-test any trader-submitted thesis. Steelman + counter + five stress tests + pre-vs-post confidence delta. |
| **Portfolio** | Paper book (trader-approved fills only) marked to real WS tape; Δ-exposure / Δ-beta / sector-mix impact simulator. |
| **Backtest** | Replays the skill pack and signal engine over cached real Bitget candles; reports precision, recall, and lift. |
| **The Assayer** | AI chat companion that drafts Playbooks from plain-English prompts. |
| **History** | Every research report, trader decision, review, and session log. |
| **Settings** | Trader profile, watchlist, and the **Bitget integrations** panel — Signal MCP status (LIVE + tool catalog), Public WebSocket status (STREAMING + pair coverage), Agentic Account (UTA v3) authorization state + Connect / Kill switch controls. |

---

## Alpha of the Day — daily brief

Every day at **02:00 UTC** the server scans the tokenized-equity universe and publishes an AI market-intelligence brief. Crypto is explicitly out of scope for this brief — only Bitget R-pair equities can become alpha candidates.

```
02:00 UTC
 → scan the live universe (Bitget R-pair equities, macro tape, news store)
 → rank alpha candidates (24h move · volume z-score · news attention)
 → for each finalist, run the same LocalNightwatchEngine.research the
   Research tab uses → situation / short-term thesis / long-term
   thesis / risks / invalidation / stress tests
 → persist to <DATA_DIR>/nightwatch02/briefs/YYYY-MM-DD.json
   and <DATA_DIR>/nightwatch02/latest.json
 → email every opted-in subscriber with an HTML summary linking back
   to the shareable research card
```

Nothing is fabricated. Prices, headlines, and timestamps flow from the same real data pipeline as the Research tab. Missing data is reported as `null` and labeled in both the UI and the email.

**Reliability.** The scheduler is timezone-aware, uses a single `setTimeout` (not per-minute polling), and catches up on boot: if the server was down at 02:00 UTC and the day's brief file is missing, one generates immediately.

**Email opt-in.** Users toggle "Send me the Alpha of the Day report every day" from the page itself. The subscription is keyed to the signed-in account email — no one can subscribe a stranger. Every email includes a one-click unsubscribe link.

**Setup checklist.** Set `RESEND_API_KEY`, optionally set `EMAIL_FROM` to a domain-verified sender, set `APP_URL` to the public URL so email links resolve correctly. In production, set `ADMIN_TOKEN` to gate manual `POST /nightwatch/run`. Confirm `/health` reports `mailer.canDeliver: true` and `nightwatch02.enabled: true`.

---

## Architecture

Two clean layers. The **engine** (`src/domain.js`, `src/backtest.js`) knows nothing about HTTP; the **adapter** (`server/`) wraps the engine with real data providers, streaming transports, auth, and persistence.

```
┌─────────────────────────────── BROWSER ──────────────────────────────┐
│ React 19 + Vite 8 SPA                                                │
│ src/main.jsx    Research · Analysis · News · Markets · Signals ·    │
│                 Thesis Lab · Portfolio · Backtest · History ·        │
│                 Assayer · Alpha of the Day · Settings                │
│ src/ui/         ErrorBoundary · Disclaimer · MarketPulse ·           │
│                 AnalysisPage · ResearchCard · useLiveStream          │
│ src/domain.js   intent router · 5-skill pack · signal synthesis ·    │
│                 report generation · thesis · portfolio · review ·    │
│                 paper execution · direction-aware invalidation       │
│ src/backtest.js precision / recall / lift on historical bars         │
└──────────────────────────────────────────────────────────────────────┘
       │              │              │              │
       │ SSE prices   │ SSE news     │ HTTP research│ HTTP session
       ↓              ↓              ↓              ↓
┌────────────────────────────── ADAPTER ──────────────────────────────┐
│ server/adapter.mjs        /research · /prices/* · /news/* · /mcp/* ·│
│                           /auth/* · /session · /trading/* ·         │
│                           /health · /metrics · /bitget/status ·     │
│                           /analysis/{sym} · /earnings · /alerts ·   │
│                           /playbooks · /assayer · /share/report ·   │
│                           /nightwatch/* · /copilot/*                │
│ server/static-serve.mjs   Combined SPA + API on one port            │
│                                                                     │
│ server/providers/                                                   │
│   bitget.mjs              real REST — 18 assets: tickers, candles,  │
│                           books, indicators                         │
│   bitget-ws.mjs           real WS — tick stream, all 18 pairs,      │
│                           auto-reconnect + heartbeat + freshness    │
│   bitget-mcp.mjs          real MCP client — Streamable HTTP,        │
│                           session mgmt, 19 tools reachable          │
│   bitget-trading.mjs      Agent Hub OAuth + UTA v3 live order path  │
│   news.mjs                17-feed RSS ingester + LLM/heuristic      │
│                           classifier + Bitget Announcements         │
│   crossvenue.mjs          Binance + OKX + Bitget perp funding/OI    │
│   macro.mjs               DXY · SPX · NDX · VIX · UST10Y (Yahoo)    │
│   marketintel.mjs         Fear & Greed · ETF flows · BTC network    │
│   earnings.mjs            Nasdaq public earnings calendar           │
│                                                                     │
│ server/market-context.mjs live universe builder — real prices,      │
│                           indicators, news, macro injected into     │
│                           every engine call                         │
│                                                                     │
│ server/lib/                                                         │
│   log.mjs       JSON structured logger (pino-shape, zero deps)      │
│   sse.mjs       Server-Sent Events bus                              │
│   ratelimit.mjs sliding-window per-key limiter                      │
│   jwt.mjs       HS256 JWT sign/verify (zero deps)                   │
│   auth.mjs      email OTP + Agentic Account OAuth callback          │
│   store.mjs     per-user JSON file store                            │
│   llm.mjs       Qwen / xAI / Anthropic / OpenAI adapter             │
│   push.mjs      Web Push (VAPID auto-generated)                     │
│   mailer.mjs    Resend adapter (or log-only fallback)               │
└─────────────────────────────────────────────────────────────────────┘
       │
       ↓
┌─────────────────────────── EXTERNAL ───────────────────────────────┐
│ api.bitget.com                (18 pairs: spot / candles / book)    │
│ ws.bitget.com                 (public WS tick stream)              │
│ datahub.noxiaohao.com/mcp     (Bitget Signal MCP, 19 tools)        │
│ fapi.binance.com / okx.com    (cross-venue perp funding / OI)      │
│ query1.finance.yahoo.com      (DXY · indices · VIX · yields)       │
│ api.alternative.me            (Crypto Fear & Greed Index)          │
│ blockchain.info               (BTC network stats)                  │
│ api.nasdaq.com                (equity earnings consensus)          │
│ RSS: bitget.com/support · CoinDesk · The Block · CoinTelegraph ·   │
│      SEC 8-K + per-CIK Form 4 · Yahoo Finance · CNBC               │
│ LLM providers (optional keys — Qwen / xAI / Anthropic / OpenAI)    │
│ Resend (email OTP + Alpha of the Day, optional)                    │
└────────────────────────────────────────────────────────────────────┘
```

**Tech stack.** Node.js 20+ (zero web-framework dependencies) · React 19 + Vite 8 · Server-Sent Events + WebSocket · JSON file persistence (Postgres drop-in path documented) · Docker + docker-compose.

---

## Data Honesty

The sidebar and topbar tell the operator exactly what data they are looking at, in real time. Nothing is fabricated or seeded once the adapter is running.

| Badge | Meaning |
|---|---|
| Sidebar **BITGET MCP · LIVE** | Bitget Signal MCP handshake completed, 19 tools reachable |
| Topbar **BITGET WS** (green) | Public WebSocket streaming; ticker cadence sub-second |
| Topbar **BITGET REST** (amber) | WS reconnecting; REST polling as fallback |
| Live-pulse **LIVE FEED · PRICES + NEWS** | Real prices + real news, local skill pack |
| Live-pulse **LIVE PRICES · DEMO NEWS** | RSS temporarily unreachable |
| Live-pulse **LIVE NEWS · DEMO PRICES** | Bitget rate-limited us |
| Live-pulse **DEMO · SIMULATED DATA** | No adapter attached (offline SPA only) |

Every research report is stamped `DEMO` or `LIVE` at generation time. Missing fields render as `null` and the UI labels them as such.

---

## Human-in-the-Loop Guarantees

| Path | Trader action required | Can auto-fill? |
|---|---|---|
| Research report `SIGNAL` verdict | **APPROVE** or REJECT (per-report) | Paper — after Approve |
| Research report `NO_TRADE` verdict | Acknowledge sit-out | No, ever |
| Portfolio exposure > cap | Impact card flags `BREACHES CAP` | No auto-fill |
| `settings.paperOnly !== true` (default) | — | `applyTraderDecision` throws |
| Live UTA v3 route | Per-report confirm modal + server-side `confirm: true` | No — human approval every order |

Live routing is disabled by default. All model-provider keys stay on the server. The trader owns every fill.

---

## Getting Started

### Prerequisites

- **Node.js ≥ 20** — check with `node --version`
- npm (bundled with Node)
- Docker (optional — for the one-command production-style run)

### Development (2 minutes, no keys required)

```bash
git clone https://github.com/drained69/nightwatchai.git
cd nightwatchai
npm install

# With the adapter (live Bitget prices, real news, real macro — no keys required):
npm run server &            # API on http://127.0.0.1:8787
npm run dev                 # SPA on http://localhost:5173, proxies to the API
# open printed http://localhost:5173
```

Fully local demo without the adapter running: same command — the SPA falls back to a seeded offline deck and stamps everything `DEMO · SIMULATED`.

### Production-style local run (one command)

```bash
docker compose up --build
# open http://localhost:8787
```

Everything on one port: SPA + API + live data + persistence bind-mounted at `./data/`.

Without Docker:

```bash
npm run build && npm start   # combined SPA + API on one port
```

---

## Configuration

Copy `.env.example` to `.env` and fill in what you need. Nothing is required to run locally with live public data.

| Variable | Purpose | Required |
|---|---|---|
| `JWT_SECRET` | HMAC secret for auth tokens (`openssl rand -base64 48`) | Production |
| `QWEN_API_KEY` | Qwen narration + news classifier (any OpenAI-compatible endpoint) | Optional |
| `XAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Fallback LLM providers (first key wins) | Optional |
| `BITGET_MCP_URL` | Override the default Bitget Signal MCP endpoint (defaults to Bitget's hosted `datahub.noxiaohao.com/mcp`) | Optional |
| `BITGET_MCP_ENABLED` | Set to `0` to disable the MCP client entirely | Optional |
| `BITGET_WS_ENABLED` | Set to `0` to disable the Bitget WebSocket client (REST polling only) | Optional |
| `BITGET_BASE_URL` | Point Bitget REST calls at the Cloudflare Worker relay instead of `api.bitget.com` | Optional |
| `BITGET_RELAY_KEY` | Shared secret sent as `x-relay-key` when using the relay | Optional |
| `BITGET_OAUTH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | Agent Hub OAuth for live routing to the operator's Agentic Account | Optional |
| `BITGET_LIVE_ENABLED` | Set to `1` to enable live routing (in addition to OAuth credentials) | Optional |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push notifications | Optional |
| `RESEND_API_KEY` | Real transactional email (sign-in codes + Alpha of the Day). Without it both fall back to log-only delivery. | Required for email |
| `EMAIL_FROM` | `From:` address for outbound mail. Default `NIGHTWATCH AI <onboarding@resend.dev>`. Set to a domain-verified sender for production. | Optional |
| `APP_URL` | Absolute URL used in email links (open-in-app, unsubscribe). Default `http://localhost:8787`. | Recommended for email |
| `NIGHTWATCH_02_HOUR` / `NIGHTWATCH_02_MINUTE` | When the daily brief fires, in UTC. Default `02` / `00`. | No |
| `NIGHTWATCH_02_ENABLED` | Set to `0` to disable the daily brief scheduler. | No |
| `ADMIN_TOKEN` | In production, required in the `X-Admin-Token` header for `POST /nightwatch/run`. | Production |
| `PORT` / `HOST` | Server bind (default `8787` / `0.0.0.0`) | No |
| `CORS_ORIGIN` | Restrict browser access in production | Production |
| `NIGHTWATCH_DATA_DIR` | Per-user JSON storage location (default `./data`) | No |
| `RATE_RESEARCH` | Research requests per minute per key (default 60) | No |
| `NEWS_POLL_MS` / `PRICES_TICK_MS` | Feed refresh intervals | No |

> **Never** put a secret in a `VITE_*` variable — Vite bakes those into the browser bundle. Full annotated reference in [`.env.example`](.env.example); credential-locator table in [`DEPLOYMENT.md`](DEPLOYMENT.md).

---

## API Reference

### System

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/health` | Liveness + wired providers (LLM, Bitget MCP, Bitget WS, mailer, scheduler) | — |
| GET | `/metrics` | Prometheus text format | — |
| GET | `/bitget/status` | Bitget Signal MCP connection state + reachable tool list | — |
| GET | `/bitget/ws-status` | Bitget WebSocket state (connected, subscribed pairs, msg count, age) | — |
| GET | `/mcp/tools` | Full MCP tool catalog with input schemas | — |
| POST | `/mcp/call` | Invoke a Bitget Signal MCP tool by name with arguments | — (rate limited) |

### Market data

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/prices/live` | Snapshot of live tickers for all 18 assets + stream mode indicator | — |
| GET | `/prices/stream` | SSE stream of ticker updates | — |
| GET | `/prices/indicators/:symbol` | Real EMA20/50, RSI14, ATR14, trend, support/resistance from Bitget candles | — |
| GET | `/positioning/:symbol` | Aggregated funding + open interest across Binance / OKX / Bitget | — |
| GET | `/book/:symbol` | Bitget spot orderbook depth + spread bps + depth imbalance | — |
| GET | `/marketintel/:symbol` | Fear & Greed + ETF flows + BTC network stats | — |
| GET | `/macro` | Real DXY · SPX · NDX · VIX · UST10Y + risk-regime classification | — |
| GET | `/earnings?limit=5` | Upcoming Nasdaq consensus EPS earnings across the equity universe | — |
| GET | `/earnings/:symbol` | Single-symbol earnings calendar entry | — |
| GET | `/analysis/:symbol` | Bundle: ticker + indicators + book + positioning + macro + news + earnings + Qwen synthesis | — |

### News & research

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/news/live?limit=60` | Deduped live news items (cross-source collapsed) | — |
| GET | `/news/stream` | SSE stream of news items | — |
| POST | `/research` | Full engine dispatch, live-enhanced with real Bitget tape and cross-venue data | — (rate limited) |
| GET | `/signals/history?limit=100` | Public signal ledger with resolved outcomes | — |
| GET | `/signals/stats` | Rolling accuracy / hit-rate by symbol | — |

### History & backtest

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/history/status` | Cached-candle warm status per asset | — |
| GET | `/history/:symbol` | Cached hourly candles for the symbol | — |
| POST | `/backtest/live` | Backtest against cached real Bitget candles | — |
| POST | `/history/warm` | Force-refresh the candle cache | — |

### Auth & session

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/auth/request-code` | Send a 6-digit sign-in code by email | — (rate limited) |
| POST | `/auth/verify-code` | Verify the code and issue a JWT | — (rate limited) |
| POST | `/auth/dev-login` | Local dev login (disabled in production unless `ALLOW_DEV_LOGIN=1`) | — |
| GET | `/auth/oauth/bitget/start` | Bitget Agentic Account authorize URL | — |
| POST | `/auth/oauth/bitget/callback` | Exchange Agent Hub code for Agentic Account token | JWT |
| GET | `/session` | Load per-user persistent session | JWT |
| PATCH | `/session` | Merge patch into session | JWT |

### Trading (Agentic Account, UTA v3)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/trading/status` | Agentic Account authorization state per user | JWT |
| POST | `/trading/order` | Submit live order to the operator's Agentic Account (trader-gated) | JWT + `confirm:true` |
| POST | `/trading/kill` | Kill switch — cancel every open order + revoke authorization | JWT |

### Alerts, push & sharing

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/vapid/public-key` | Web Push VAPID public key | — |
| POST | `/push/subscribe` | Save Web Push subscription | JWT |
| POST | `/push/test` | Send a test push to the current user | JWT |
| GET | `/alerts` | List user alerts | JWT |
| POST | `/alerts` | Create an alert (plain-English or structured) | JWT |
| POST | `/alerts/parse` | Preview alert parse without saving | JWT |
| DELETE | `/alerts/:id` | Delete alert | JWT |
| POST | `/alerts/:id/reset` | Reset a fired alert so it can fire again | JWT |
| POST | `/share/report` | Create signed public URL for any report (30-day expiry) | JWT |
| GET | `/share/report/:token` | Read a shared report | — |

### Paper Account

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/paper` | Snapshot: starting/free/allocated capital, total P&L | JWT |
| POST | `/paper/reserve` | Reserve capital for an approved research position (idempotent by position id) | JWT |
| POST | `/paper/release` | Release reserved capital + credit realized P&L on close (idempotent by position id) | JWT |
| POST | `/paper/credit` | Legacy P&L-only credit, kept for backwards compatibility | JWT |
| POST | `/paper/reset` | Reset the account back to starting capital | JWT |

### Portfolio Copilot

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/copilot/portfolio` | Correlation + factor + sector analysis of a book | — |
| GET | `/copilot/correlation/:symbol` | 30-day correlation of symbol vs BTC | — |

### Alpha of the Day

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/nightwatch/latest` | Latest published daily brief (404 until first run) | — |
| GET | `/nightwatch/list?limit=14` | Dates of the last N briefs on disk | — |
| GET | `/nightwatch/:YYYY-MM-DD` | Read one historical brief by date | — |
| GET | `/nightwatch/status` | Scheduler + mailer state | — |
| GET | `/nightwatch/subscription` | Current subscription state for the signed-in account | JWT |
| POST | `/nightwatch/subscription` | Enable / disable daily email | JWT |
| GET | `/nightwatch/unsubscribe/:token` | One-click unsubscribe (email link) | — |
| POST | `/nightwatch/run` | Fire the pipeline immediately | JWT (dev) / `X-Admin-Token` (prod) |

---

## Testing

```bash
npm test            # 119 node:test cases
npm run build       # produces static dist/
```

The suite covers: intent routing, skill pack, live-data paths, signal synthesis, report generation, direction-aware invalidation, thesis stress-testing, portfolio impact, post-trade review, session migration, JWT, RSS ingestion (including Bitget Announcements), store, alerts, sharing, copilot, playbooks, paper accounts, and the backtester.

Bundle-hygiene lint:

```bash
npm run lint:demo-strings   # fails the build if demo strings ship in dist/
```

---

## Real Live Data Proof

Everything below runs live on a fresh checkout with `npm install && npm run server`:

- **Bitget public REST** — real spot tickers for all 18 assets (10 tokenized U.S. equities via Bitget R-pairs + 8 crypto correlation set), refreshed every 10 seconds.
- **Bitget public WebSocket** — real tick stream for all 18 pairs, sub-second cadence, auto-reconnect with heartbeat.
- **Bitget indicators** — real EMA20/50, RSI14, ATR14, 48h swing support/resistance, volume z-score, 7d change computed from 200 hourly candles.
- **Bitget spot orderbook** — real bid/ask depth, spread in bps, depth imbalance — for equities too.
- **Bitget Signal MCP** — real Streamable HTTP MCP client against Bitget's hosted signal MCP at `datahub.noxiaohao.com/mcp`; 19 real tools reachable.
- **Bitget Announcements** — real RSS from `bitget.com/support/rss` flowing into `/news/live` with `category: exchange`.
- **Cross-venue positioning** — real funding rate + open interest from Binance, OKX, and Bitget perp APIs, aggregated per asset with skew + crowding classification.
- **Live macro tape** — real DXY, S&P 500, Nasdaq, VIX, UST10Y via Yahoo Finance.
- **Crypto Fear & Greed Index** — real value from `alternative.me`.
- **BTC network stats** — real hash rate and 24h transaction count from `blockchain.info`.
- **BTC/ETH ETF flows** — best-effort Farside CSV net flows.
- **News firehose** — 17 real RSS feeds (CoinDesk · The Block · CoinTelegraph · Bitget Announcements · SEC 8-K · per-CIK SEC Form 4 for 10 equities · Yahoo Finance · CNBC) with cross-source dedup + LLM classification.
- **Signal history** — every LONG/SHORT signal recorded with entry price, resolved against real forward price at an 8-hour horizon; public hit-rate ledger.
- **Backtests** — deep-paged real Bitget candles (~1,400–2,000 hourly bars per asset) with per-bar no-lookahead indicators.
- **Portfolio Copilot** — Pearson correlation to BTC computed from cached real hourly returns.

---

## Production Readiness

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for the full step-by-step checklist. Short version:

- ✅ **Built and working:** everything documented above, plus SSE streams, WS tick stream, MCP client, email auth (OTP + Resend), per-user persistence, rate limiting, structured logs, health/metrics, PWA + service worker + Web Push, error boundary, legal disclaimer, backtest, plain-English alerts, report sharing, persona-tuned signals, Agent Hub OAuth scaffold with kill switch, Cloudflare Worker relay, Docker + docker-compose.
- 🟡 **Scaffolded, needs your credentials:** LLM keys (any of `QWEN_API_KEY` / `XAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`), Agent Hub OAuth for live routing (`BITGET_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI` + `BITGET_LIVE_ENABLED=1`), production `JWT_SECRET`, Resend API key for email delivery.
- 🔴 **Operator responsibilities (not doable from a code session):** cloud host, Postgres migration when scale > ~1k DAU, Sentry sign-up, legal review, geo-block configuration, DNS + TLS.

Every 🔴 item has a step-by-step recipe in [`DEPLOYMENT.md`](DEPLOYMENT.md).

---

## Project Structure

```
src/
  domain.js               engine — universe, skills, signal, report,
                          direction-aware invalidation, thesis,
                          portfolio, review, paper execution
  domain.test.js          domain tests
  backtest.js             precision/recall/lift over synthetic or real
                          candles (per-bar no-lookahead indicators)
  backtest.test.js        backtest tests
  main.jsx                SPA — 12 product surfaces
  styles.css              institutional dark terminal design
  ui/
    ErrorBoundary.jsx     panic screen + wipe-session fallback
    Disclaimer.jsx        not-investment-advice modal + persistent footer
    useLiveStream.js      SSE subscription hook
    usePush.js            Web Push subscribe + test
    MarketPulse.jsx       live BTC / ETH / F&G strip
    AnalysisPage.jsx      single-symbol workbench
    ResearchCard.jsx      downloadable PNG research card
    GetAgentPages.jsx     Assayer · Playbook detail · paper account
    Nightwatch02Page.jsx  Alpha of the Day surface

server/
  adapter.mjs             composed HTTP + SSE server
  static-serve.mjs        production combined SPA + API on one port
  market-context.mjs      live universe builder
  live-enhance.mjs        report overlay — positioning, book depth, intel
  history.mjs             deep-paged real candle cache (18 assets)
  paper.mjs               server-authoritative paper capital ledger —
                          idempotent reserve/release by position id,
                          atomic P&L credit on close
  alerts.mjs · copilot.mjs · playbooks.mjs · allocations.mjs ·
  assayer.mjs · sharing.mjs · signal-history.mjs
  nightwatch02.mjs        Alpha of the Day pipeline
  nightwatch02-scheduler.mjs · nightwatch02-subscriptions.mjs
  providers/
    bitget.mjs            real Bitget REST — tickers, candles, books,
                          indicators (crypto + R-pair equities), retry
                          + exponential backoff + stale-shelf cache
    bitget-ws.mjs         real Bitget WebSocket — tick stream for all
                          18 pairs, auto-reconnect + heartbeat
    bitget-mcp.mjs        real Bitget Signal MCP client — Streamable
                          HTTP transport, session mgmt, 19 tools
    bitget-trading.mjs    Agent Hub OAuth + UTA v3 live order path
                          + kill switch
    news.mjs              17-feed RSS ingester (incl. Bitget
                          Announcements + per-CIK SEC Form 4) with
                          dedup + LLM/heuristic classifier
    macro.mjs             real DXY / SPX / NDX / VIX / UST10Y (Yahoo)
    crossvenue.mjs        Binance + OKX + Bitget perp funding / OI
    marketintel.mjs       Fear & Greed · ETF flows · BTC network stats
    earnings.mjs          Nasdaq public earnings calendar
  lib/
    log.mjs · sse.mjs · ratelimit.mjs · jwt.mjs · auth.mjs · store.mjs ·
    llm.mjs · push.mjs · mailer.mjs
    lib.test.mjs          platform tests
    tier2.test.mjs        alerts · sharing · copilot tests
    getagent.test.mjs     playbooks · allocations · paper · assayer tests
    live-data.test.mjs    symbol map · classifier · live skills · live
                          signal · backtest tests

relay/
  worker.js               Cloudflare Worker relay for Bitget public
                          market data (WAF bypass)
  README.md

public/                   manifest.webmanifest · sw.js · icons · logo
data/                     per-user JSON (git-ignored, docker-volume in prod)

Dockerfile · docker-compose.yml · .env.example
DEPLOYMENT.md             full production checklist
SUBMISSION.md             hackathon submission text
```

---

## Security Notes

- **Provider keys never touch the browser.** All LLM and Bitget keys live server-side; `VITE_*` variables are public by definition.
- **Paper-first by default.** `applyTraderDecision` throws unless `settings.paperOnly !== true`. Live order submission additionally requires JWT auth + explicit `confirm: true`, and the kill-switch endpoint (`POST /trading/kill`) cancels every open order and revokes the OAuth authorization.
- **Isolated live routing.** When authorized, live orders route through Bitget's **UTA v3** API into the operator's **Agentic Account** — a dedicated agent-only sub-account isolated from the operator's main funds and capped by daily limits set on Agent Hub.
- **Secrets hygiene.** `JWT_SECRET` generated via `openssl rand -base64 48`; OTP codes are scrypt-hashed with a per-code salt and timing-safe verification; 5-attempt limit; 10-minute TTL; `.env` is git-ignored.
- **Rate limiting.** Sliding-window per-key limiter on expensive endpoints (LLM-backed research, admin routes, auth).
- **Geo / compliance.** Financial-adjacent: legal review and Bitget-restricted-region geo-blocking are required before onboarding real users — see `DEPLOYMENT.md §9`.

---

## Contributing

1. Fork the repository and create your branch from `main`.
2. Install dependencies: `npm install`.
3. Make your change with tests where applicable.
4. Run the full gate locally:

   ```bash
   npm test
   npm run build
   ```

5. Ensure new features degrade honestly — anything without live data behind it must be stamped `DEMO`.
6. Open a pull request describing the change and how you verified it.

---

## License

Released under the [MIT License](LICENSE) — Copyright (c) 2026 NIGHTWATCH AI.

---

## Disclaimer

**NIGHTWATCH watches the markets. It does not trade them unless you do.**

This software is for research and education only. Nothing in it is investment advice, a recommendation, or an offer to buy or sell any financial instrument. Markets involve risk, including total loss of capital. Paper-trading results do not represent real-money performance. Do your own research and consult a licensed professional before making financial decisions.
