<div align="center">

# NIGHTWATCH AI

### Trade the information, not just the chart.

[![Live Demo](https://img.shields.io/badge/Live-nightwatchai.watch-0ea5e9?style=flat-square)](https://nightwatchai.watch)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Tests](https://img.shields.io/badge/tests-93%2F93%20passing-brightgreen?style=flat-square)](#testing)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ed?style=flat-square&logo=docker&logoColor=white)](docker-compose.yml)

An AI trading research workbench for **event-driven and information-heavy traders** — the ones who move on earnings, macro prints, breaking news, and overnight tape, not just candlestick patterns.

**AI researches → AI analyzes → AI explains → HUMAN makes the final trading decision.**

</div>

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [The Core Loop](#the-core-loop)
- [Product Surfaces](#product-surfaces)
- [Architecture](#architecture)
- [Bitget Integration](#bitget-integration)
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

NIGHTWATCH AI is a natural-language AI trading research workstation. The trader asks a question in plain English; NIGHTWATCH classifies the intent, invokes the five Bitget `bitget-signal` research skills, extracts signal from unstructured news + tape + macro + sentiment, and produces a structured research report with a directional signal, supporting and contradicting evidence, risks, invalidation conditions, historical analogs, and a suggested execution plan — which the trader can approve, reject, or sit out.

**Target users:** discretionary traders in tokenized U.S. mega-cap tech and crypto majors who want to compress unstructured overnight information into an approvable insight in about 90 seconds. Not autonomous-agent users; not backtest-first quants.

The hackathon-critical claim: *AI extracts, synthesizes, and challenges; the trader decides.* Autonomous fills look impressive in demos and fail the human-in-the-loop contract.

**Live at [nightwatchai.watch](https://nightwatchai.watch).**

---

## Key Features

### Market Data

| | |
|---|---|
| **Universe** | **10 tokenized U.S. mega-caps (primary)** via Bitget's R-prefixed pairs — `RNVDAUSDT`, `RTSLAUSDT`, `RAAPL…` etc. — plus 8 crypto majors kept as a correlation / macro-regime set. All 18 with real live Bitget spot prices, 1h candles and 15-level orderbook. |
| **Live tape** | Bitget public REST (spot ticker, 1h candles, 15-level orderbook) — refreshed every 10s, stale-while-revalidate cache so transient outages degrade honestly |
| **Cross-venue positioning** | Binance + OKX + Bitget perp funding + open interest, aggregated per asset with per-venue table showing Bitget as home venue |
| **Live macro** | DXY · S&P 500 · Nasdaq · VIX · UST10Y via Yahoo Finance — drives the `macro-analyst` skill and risk-regime read |
| **Live news** | CoinDesk · The Block · CoinTelegraph · SEC 8-K · Yahoo Finance · CNBC RSS ingester with dedup by content hash + Qwen-classified per-ticker impact |
| **Live sentiment** | Crypto Fear & Greed + BTC network hash + best-effort Farside ETF net flows |

### Research & AI

| | |
|---|---|
| **AI narration** | Qwen via Bitget's hosted endpoint (fallback chain: Qwen → xAI → Anthropic → OpenAI, first key wins) with word-boundary keyword-heuristic fallback |
| **Analysis workbench** | Single-symbol `/analysis/{SYMBOL}` bundles Bitget ticker + indicators + book depth + cross-venue positioning + macro + symbol-tagged news, then Qwen writes a 4-part desk analysis with verdict + entry/stop/target + invalidation |
| **Signal proof** | Public `/signals/history` with rolling hit-rate resolved against real prices |
| **Signal quality** | Backtester runs on cached real Bitget candles (deep-paged ~2000×1h per asset); precision / recall / lift |
| **Thesis Lab** | Signature stress-testing surface — submit any thesis, get steelman + counter + 5 stress tests + confidence delta |
| **Portfolio Copilot** | Real-candle BTC correlation per position, factor clusters, concentration warnings |
| **Persona** | Risk profile + style biases composite threshold + skill weights + risk adjustment |

### Trading

| | |
|---|---|
| **Paper only by default** | Every user gets $10,000 virtual capital; live routing wiring documented in `DEPLOYMENT.md §5` and is opt-in only |
| **Copy to paper** | Every research report shows a top-of-page **Action Summary** card — verdict, plan (entry/stop/target/size/friction), one-click **COPY TO PAPER PORTFOLIO**, plus REJECT / SIT OUT / TRADE ON BITGET |
| **Playbooks** | Public, published strategies with real-price paper PnL — no real user funds |
| **The Assayer** | AI chat companion that drafts Playbooks from plain-English prompts |
| **Live trading (opt-in)** | Bitget Agentic Account via Agent Hub OAuth, orders routed through the **UTA v3** (Unified Trading Account) API — orders land in an isolated agent-only sub-account (never the operator's main funds), each order gated by explicit approval, kill switch cancels every open order and revokes authorization one-click |

### Platform

| | |
|---|---|
| **Streaming** | Server-Sent Events for prices + news — no client polling |
| **Auth** | Passwordless email OTP via Resend (6-digit code, 10-min TTL, scrypt-hashed, timing-safe verify). HS256 JWT scopes every request to the account so watchlist, positions, reports and paper capital follow the email across devices |
| **Persistence** | Per-user JSON files under `./data/` (drop-in Postgres path in `DEPLOYMENT.md`) |
| **Alerts** | Plain-English → structured rule (LLM or heuristic), fires push + SSE on match |
| **Web Push** | Auto-generated VAPID, subscribe from UI, HIGH-relevance news fires push |
| **Sharing** | Any report → signed public URL, 30-day expiry, view counter |
| **Deploy** | One Dockerfile, one `docker compose up`, `./data` volume, `/health` + `/metrics` |
| **Tests** | 93 `node:test` cases across domain + backtest + live-data paths + JWT + RSS + store + alerts + sharing + copilot |

---

## The Core Loop

```
USER QUESTION
    ↓
NIGHTWATCH AI classifies intent
    ↓
Invokes the 5 bitget-signal skills (local pack or Bitget MCP proxy)
    news-briefing · market-intel · technical-analysis · sentiment-analyst · macro-analyst
    ↓
Extracts signal from unstructured news + tape + macro + sentiment
    ↓
Synthesizes: supporting / contradicting / risks / invalidation
    ↓
Generates actionable research report
    signal · confidence · catalyst · analogs · execution plan
    ↓
HUMAN DECIDES  (approve · reject · sit-out · amend)
```

---

## Product Surfaces

| Page | Purpose |
|---|---|
| **Alpha of the Day** | Daily AI brief on the tokenized U.S. stock universe (crypto out of scope). Sectors, unusual movements, ranked alpha candidates with short/long thesis, risks, invalidation. Auto-generated at 02:00 UTC; opt-in email delivery. |
| **Research** | Natural-language terminal. Streams the 5-skill research process live and renders a structured report. |
| **Analysis** | Single-symbol desk analysis: ticker + indicators + book + positioning + macro + news → Qwen 4-part writeup with verdict and levels. |
| **News** | Live news tape with AI impact analysis per asset. High-relevance items trigger toast + push. |
| **Markets** | 18-asset scanner with live prices, class filter, watchlist toggle, one-click research. |
| **Signals** | All signals + last opportunity scan. |
| **Thesis Lab** | Signature stress-testing surface. Submit any thesis, get steelman + counter + 5 stress tests + confidence delta. |
| **Portfolio** | Paper book (trader-approved fills only) + Δ exposure / Δ beta / sector mix simulator. |
| **Backtest** | Replays skill pack + signal engine over synthetic or live candles; reports precision/recall/lift. |
| **History** | Every research report, decision, review, and session log. |
| **Assayer** | AI chat companion that drafts Playbooks from plain-English prompts. |
| **Settings** | Trader profile, watchlist, Bitget MCP connection status with setup steps. |

---

## Alpha of the Day — Daily Brief

Every day at **02:00 UTC** the server scans the tokenized-stock universe and publishes an AI market intelligence brief. Crypto is explicitly out of scope — only tokenized U.S. equities (Bitget R-pairs) can become alpha candidates:

```
02:00 UTC
 → scan live universe (Bitget tokenized-equity R-pairs, macro, news store), crypto rows filtered out
 → rank alpha candidates (24h move · volume z-score · news attention)
 → for each finalist, run the same LocalNightwatchEngine.research the
   Research tab uses → produces situation / short-term thesis / long-term
   thesis / risks / invalidation / stress tests
 → persist to <DATA_DIR>/nightwatch02/briefs/YYYY-MM-DD.json
   and <DATA_DIR>/nightwatch02/latest.json
 → email every subscribed address (opt-in) with an HTML summary that
   links back to the Thesis Card
```

**Nothing is fabricated.** All prices, news items and timestamps come from the same real data pipeline as the Research tab. Missing data is reported as `null` and labeled in the UI/email. The brief carries an explicit disclaimer and never claims a guaranteed profit.

**Reliability.** The scheduler is timezone-aware, uses a single `setTimeout` (not per-minute polling), and catches up on boot: if the server was down at 02:00 UTC and today's brief file is missing, one is generated immediately.

**Email opt-in.** Users toggle "Send me the Alpha of the Day report every day" from the page itself. The subscription is keyed to the signed-in account email — no one can subscribe a stranger. Every email includes a one-click unsubscribe link (`GET /nightwatch/unsubscribe/:token`).

**Setup checklist:**

1. Set `RESEND_API_KEY` and (recommended) `EMAIL_FROM` to a domain-verified sender.
2. Set `APP_URL` to your public URL so email links resolve correctly.
3. In production, set `ADMIN_TOKEN` if you want to allow `POST /nightwatch/run`.
4. Optionally override `NIGHTWATCH_02_HOUR` / `NIGHTWATCH_02_MINUTE` — defaults `02` / `00` UTC.
5. Confirm `/health` reports `mailer.canDeliver: true` and `nightwatch02.enabled: true`.

Without `RESEND_API_KEY`, the toggle still records the preference (the brief still generates and is visible in the app) but no email is sent — `/health` and `/nightwatch/status` both surface this honestly (`mailer.provider: "log-only"`).

---

## Architecture

Two clean layers: the **engine** (`src/domain.js`, `src/backtest.js`) knows nothing about HTTP; the **adapter** (`server/`) wraps the engine with real data, streaming, auth, and persistence.

```
┌─────────────────────────  BROWSER  ─────────────────────────┐
│ src/main.jsx    Research · News · Markets · Signals · Thesis │
│                Lab · Portfolio · Backtest · History · Settings│
│ src/ui/        ErrorBoundary · Disclaimer · useLiveStream    │
│ src/domain.js  intent router · 5-skill pack · signal · report│
│                thesis · portfolio · review · paper execution │
│ src/backtest.js precision / recall / lift on historical data │
└──────────────────────────────────────────────────────────────┘
        │ SSE prices + news        │ HTTP /research + /session
        ↓                          ↓
┌────────────────────────  ADAPTER  ────────────────────────┐
│ server/adapter.mjs   /research /prices/* /news/* /session  │
│                      /auth/dev-login /push/subscribe       │
│                      /health /metrics /bitget/status       │
│ server/static-serve.mjs   Combined SPA + API on one port   │
│                                                            │
│ server/providers/                                          │
│   bitget.mjs   real REST — 18 assets: tickers, candles,    │
│                books, indicators (crypto + R-pair equities)│
│   news.mjs     RSS ingest + dedup + LLM/heuristic classify │
│   macro.mjs    real DXY · SPX · NDX · VIX · UST10Y (Yahoo) │
│   crossvenue.mjs Binance+OKX+Bitget perp funding/OI + book │
│   marketintel.mjs FnG · ETF flows · BTC network stats      │
│                                                            │
│ server/market-context.mjs live universe builder — real     │
│   prices/indicators/news/macro injected into every engine  │
│   call; seeded DEMO_UNIVERSE is fallback only              │
│                                                            │
│ server/lib/                                                │
│   log.mjs      JSON structured logger (pino-shape, no dep) │
│   sse.mjs      Server-Sent Events bus                      │
│   ratelimit.mjs sliding window per-key limiter             │
│   jwt.mjs      HS256 JWT sign/verify (no dep)              │
│   auth.mjs     dev-login + Agentic Account OAuth callback │
│   store.mjs    per-user JSON file store                    │
│   llm.mjs      Qwen / xAI / Anthropic / OpenAI completion  │
│   push.mjs     Web Push (VAPID auto-generated)             │
└────────────────────────────────────────────────────────────┘
        │
        ↓
┌───────────  EXTERNAL  ────────────────────────────┐
│ api.bitget.com      (prices/candles/books, 18 pk) │
│ fapi.binance.com · okx.com (perp funding/OI)      │
│ query1.finance.yahoo.com (DXY/indices/VIX/yields) │
│ api.alternative.me · blockchain.info (FnG, chain) │
│ RSS: CoinDesk · TheBlock · CoinTelegraph · SEC    │
│      8-K · Yahoo Finance · CNBC                   │
│ LLM providers (optional keys)                     │
│ Bitget MCP sidecar (optional)                     │
└───────────────────────────────────────────────────┘
```

**Tech stack:** Node.js 20+ (zero web-framework dependencies) · React 19 + Vite 8 · Server-Sent Events · JSON file persistence (Postgres drop-in) · Docker.

---

## Bitget Integration

Three seams — each is honest about what's live vs simulated:

1. **Public prices + candles + indicators + books.** Direct HTTPS to `api.bitget.com` for all 18 assets — the R-prefixed tokenized-equity pairs (primary universe) plus crypto spot pairs (correlation set). No auth required. Runs by default when you `npm run server`. The server builds a live universe (real price, 24h/7d change, ATR, RSI, volume z-score, spread) and injects it into every research, thesis, execution-help and scan call, alongside real wire news and a real macro snapshot (DXY/SPX/NDX/VIX/UST10Y via Yahoo).
2. **`bitget-signal` skills.** Skills compute from the live context above by default; seeded deterministic values remain only as the offline fallback (clearly stamped `DEMO`). Wire `BITGET_MCP_URL` to point at Bitget's Agent Hub MCP sidecar (`bgc mcp serve --port 9091`) and the badge flips to `BITGET MCP · LIVE`. Skill schemas match.
3. **Live routing via UTA v3 to your Bitget Agentic Account.** Approved research reports can be routed as real orders through Bitget's **Unified Trading Account (UTA v3)** API into the operator's Agentic Account — the isolated Agent Hub sub-account that's separate from their main funds. Agent Hub OAuth handshake in `server/providers/bitget-trading.mjs`, wired to the SPA via a "Connect Agentic Account" button in Settings and a per-report "Route to Agentic Account" confirm modal. Provision `BITGET_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI` + `BITGET_LIVE_ENABLED=1` to enable; per-order Trader Approve stays mandatory.

Full setup for each in [`DEPLOYMENT.md`](DEPLOYMENT.md).

---

## Data Honesty

The sidebar badge tells you exactly what you're looking at, in real time:

| Badge | Meaning |
|---|---|
| `BITGET MCP · LIVE` | MCP sidecar reachable, skills live |
| `LIVE FEED · PRICES + NEWS` | Real prices and real news, local skill pack |
| `LIVE PRICES · DEMO NEWS` | RSS temporarily unreachable |
| `LIVE NEWS · DEMO PRICES` | Bitget rate-limited us |
| `DEMO · SIMULATED DATA` | No adapter attached, everything from the seeded deck |

Reports are stamped `DEMO` or `LIVE` at generation time. No hidden state.

---

## Human-in-the-Loop Guarantees

| Path | Trader action | Can fill? |
|---|---|---|
| Report SIGNAL | **APPROVE** / Reject | Yes, paper — after Approve |
| Report NO_TRADE | Acknowledge sit-out | No, ever |
| Portfolio exposure > cap | Impact card flags `BREACHES CAP` | No auto-fill |
| `settings.paperOnly !== true` | — | `applyTraderDecision` throws |

Live routing is disabled by default. Model provider keys stay on the server. The trader owns every fill.

---

## Getting Started

### Prerequisites

- **Node.js ≥ 20** — check with `node --version`
- npm (bundled with Node)
- Docker (optional — only for the one-command production-style run)

### Development (2 minutes, no keys required)

```bash
git clone <this repo>
cd nightwatch-ai
npm install

# With the adapter (live Bitget prices, real news, real macro — no keys needed):
npm run server &                 # API on http://127.0.0.1:8787
npm run dev                      # SPA on http://localhost:5173, auto-proxies to the API
# open printed http://localhost:5173
```

Fully local demo (no adapter running): same command — the SPA falls back to the seeded offline deck and stamps everything `DEMO · SIMULATED`.

### Production-Style Local Run (one command)

```bash
docker compose up --build
# open http://localhost:8787
```

Everything on one port: SPA + API + live data + persistence at `./data/`.

Without Docker:

```bash
npm run build && npm start        # combined SPA + API on one port
```

---

## Configuration

Copy `.env.example` to `.env` and fill in what you need. Nothing is required to run locally with live public data.

| Variable | Purpose | Required |
|---|---|---|
| `JWT_SECRET` | HMAC secret for auth tokens (`openssl rand -base64 48`) | Production |
| `QWEN_API_KEY` | Qwen narration + news classifier (any OpenAI-compatible endpoint) | Optional |
| `XAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Fallback LLM providers (first key wins) | Optional |
| `BITGET_MCP_URL` | Route the 5 bitget-signal skills to the Bitget MCP sidecar | Optional |
| `BITGET_OAUTH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | Agent Hub OAuth for live routing to your isolated Agentic Account | Optional |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push notifications | Optional |
| `RESEND_API_KEY` | Real transactional email — sign-in codes AND the daily Alpha of the Day brief. Without it, both features fall back to server-log delivery only. | Required for email |
| `EMAIL_FROM` | `From:` address for outbound mail. Default `NIGHTWATCH AI <onboarding@resend.dev>`. Set to a domain-verified sender in Resend for production. | Optional |
| `APP_URL` | Absolute URL used in email links (open-in-app, unsubscribe). Default `http://localhost:8787`. | Recommended for email |
| `NIGHTWATCH_02_HOUR` / `NIGHTWATCH_02_MINUTE` | When the daily brief fires, in UTC. Defaults to `02` / `00`. | No |
| `NIGHTWATCH_02_ENABLED` | Set to `0` to disable the scheduler (still exposes `/nightwatch/run`). | No |
| `ADMIN_TOKEN` | In production, required in the `X-Admin-Token` header for `POST /nightwatch/run`. In development any authenticated user can trigger a run. | Production |
| `PORT` / `HOST` | Server bind (default `8787` / `0.0.0.0`) | No |
| `CORS_ORIGIN` | Restrict browser access in production | Production |
| `NIGHTWATCH_DATA_DIR` | Per-user JSON storage location (default `./data`) | No |
| `RATE_RESEARCH` | Research requests/min per key (default 60) | No |
| `NEWS_POLL_MS` / `PRICES_TICK_MS` | Feed refresh intervals | No |

> **Important:** never put a secret in a `VITE_*` variable — those are baked into the browser bundle. See the full annotated reference in [`.env.example`](.env.example) and the credential-locator table in [`DEPLOYMENT.md`](DEPLOYMENT.md).

---

## API Reference

### System

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/health` | Liveness + wired providers | — |
| GET | `/metrics` | Prometheus text format | — |
| GET | `/bitget/status` | MCP sidecar connection | — |

### Market Data

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/prices/live` | Snapshot of live tickers for all 18 assets | — |
| GET | `/prices/stream` | SSE stream of ticker updates | — |
| GET | `/prices/indicators/:symbol` | Real EMA/RSI/ATR/trend/support/resistance from Bitget candles | — |
| GET | `/positioning/:symbol` | Aggregated funding + OI across Binance/OKX/Bitget | — |
| GET | `/book/:symbol` | Bitget spot order-book depth + spread bps (crypto + equities) | — |
| GET | `/marketintel/:symbol` | Fear & Greed + ETF flows + BTC network stats | — |
| GET | `/macro` | Real DXY · SPX · NDX · VIX · UST10Y + risk regime | — |

### News & Research

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/news/live?limit=60` | Deduped live news items (cross-source collapsed) | — |
| GET | `/news/stream` | SSE stream of news items | — |
| POST | `/research` | Full engine dispatch, live-enhanced when possible | — (rate limited) |
| GET | `/signals/history?limit=100` | Public signal ledger with resolved outcomes | — |
| GET | `/signals/stats` | Rolling accuracy / hit-rate by symbol | — |

### History & Backtest

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/history/status` | Cached-candle warm status per crypto ticker | — |
| GET | `/history/:symbol` | Cached hourly candles for the symbol | — |
| POST | `/backtest/live` | Backtest against cached real Bitget candles | — |
| POST | `/history/warm` | Force-refresh the candle cache | — |

### Auth & Session

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/auth/dev-login` | Local dev login | Disabled in prod unless `ALLOW_DEV_LOGIN=1` |
| GET | `/auth/oauth/bitget/start` | Bitget Agentic Account authorize URL | — |
| POST | `/auth/oauth/bitget/callback` | Exchange Agent Hub code for Agentic Account token | JWT |
| GET | `/session` | Load per-user persistent session | JWT |
| PATCH | `/session` | Merge patch into session | JWT |

### Trading

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/trading/status` | Agentic Account authorization state per user | JWT |
| POST | `/trading/order` | Submit live order to the operator's Agentic Account (trader-gated) | JWT + `confirm:true` |
| POST | `/trading/kill` | Cancel all open orders + revoke token | JWT |

### Alerts, Push & Sharing

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
| POST | `/share/report` | Create signed share URL for any report | JWT |
| GET | `/share/report/:token` | Read a shared report | — |

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
| GET | `/nightwatch/status` | Scheduler + mailer state (next fire, last run, delivery config) | — |
| GET | `/nightwatch/subscription` | Current subscription state for the signed-in account | JWT |
| POST | `/nightwatch/subscription` | Enable / disable daily email (`{ email, enabled }`) | JWT |
| GET | `/nightwatch/unsubscribe/:token` | One-click unsubscribe from an email footer | — |
| POST | `/nightwatch/run` | Fire the pipeline immediately | JWT (dev) / `X-Admin-Token` (prod) |

---

## Testing

```bash
npm test           # 93 node:test cases
npm run build      # static dist/
```

The suite covers: intent routing, skill pack, live-data paths, signal synthesis, report generation, thesis stress-testing, portfolio impact, post-trade review, session migration, JWT, RSS ingestion, store, alerts, sharing, copilot, playbooks, paper accounts, and the backtester.

There is also a bundle-hygiene lint:

```bash
npm run lint:demo-strings   # fails the build if demo strings ship in dist/
```

---

## Real Live Data Proof

Everything below runs live on a fresh checkout with `npm install && npm run server`:

- **Bitget public prices** — real spot tickers for all 18 assets (10 tokenized U.S. equities via Bitget R-pairs + 8 crypto correlation set), refreshed every 10s.
- **Bitget indicators** — real EMA20/50, RSI14, ATR14, 48h swing support/resistance, volume z-score, 7d change computed from 200 hourly candles.
- **Cross-venue positioning** — real funding rate + open interest from Binance, OKX, and Bitget perp APIs, aggregated per asset with skew + crowding classification.
- **Bitget spot order book** — real bid/ask depth, spread in bps, depth imbalance — for equities too.
- **Live macro tape** — real DXY, S&P 500, Nasdaq, VIX, UST10Y via Yahoo Finance; drives the macro-analyst skill and the risk-regime read.
- **Crypto Fear & Greed Index** — real value from alternative.me.
- **BTC network stats** — real hash rate and 24h tx count from blockchain.info.
- **BTC/ETH ETF flows** — best-effort Farside CSV net flows (their CDN blocks hotlinking intermittently; the field degrades to null and the report says so).
- **News firehose** — real RSS from CoinDesk, TheBlock, CoinTelegraph, SEC 8-K, Yahoo Finance, CNBC with cross-source dedup by token overlap and word-boundary asset classification.
- **News classifier** — LLM-first (JSON schema) with heuristic fallback; every report cites the actual headlines with clickable URLs.
- **Signal history** — every LONG/SHORT signal recorded with its real entry price, resolved against real forward price 8h later, public hit-rate ledger.
- **Backtests** — deep-paged real Bitget candles (~1400–2000 hourly bars per asset) with per-bar no-lookahead indicators.
- **Portfolio Copilot** — Pearson correlation to BTC computed from cached real hourly returns, factor clustering, sector concentration warnings.

---

## Production Readiness

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for the full step-by-step checklist. The short version:

- ✅ **Built and working:** everything above, plus SSE streams, auth (dev), per-user persistence, rate limiting, structured logs, health/metrics, PWA + service worker + Web Push, error boundary, legal disclaimer, backtest, plain-English alerts, report sharing, persona-tuned signals, Bitget Agentic Account OAuth scaffold, Docker + docker-compose, deployment guide.
- 🟡 **Scaffolded, needs your credentials:** LLM narration + LLM alert parser (set any of `QWEN_API_KEY` / `XAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`), Bitget MCP proxy (run `bgc mcp serve`), Bitget Agentic Account OAuth (`BITGET_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI` + `BITGET_LIVE_ENABLED=1`), production `JWT_SECRET`.
- 🔴 **Requires an operator (not doable from a code session):** cloud host (Fly / Railway / AWS), Postgres migration when you scale past ~1k DAU, Sentry sign-up, Stripe billing wiring, legal review, geo-block config, DNS + TLS.

Every 🔴 item has a step-by-step recipe in [`DEPLOYMENT.md`](DEPLOYMENT.md).

---

## Project Structure

```
src/
  domain.js            engine — universe, skills, signal, report, thesis, portfolio, review
  domain.test.js       domain tests
  backtest.js          precision/recall/lift over synthetic or real candles (per-bar no-lookahead indicators)
  backtest.test.js     backtest tests
  main.jsx             SPA (Research · Analysis · News · Markets · Signals · Thesis Lab ·
                       Portfolio · Backtest · History · Assayer · Settings)
  styles.css           institutional dark terminal design
  ui/
    ErrorBoundary.jsx  panic screen + wipe-session fallback
    Disclaimer.jsx     not-investment-advice modal + persistent footer
    useLiveStream.js   SSE subscription hook
    usePush.js         Web Push subscribe + test
    MarketPulse.jsx    live BTC/ETH/F&G strip
    GetAgentPages.jsx  Assayer · Playbook detail · paper account

server/
  adapter.mjs          composed HTTP + SSE server
  static-serve.mjs     production combined SPA + API on one port
  market-context.mjs   live universe builder — real prices/indicators/news/macro
                       injected into every engine call
  live-enhance.mjs     report overlay — positioning, book depth, intel, real friction
  history.mjs          deep-paged real candle cache (18 assets)
  alerts.mjs · copilot.mjs · paper.mjs · playbooks.mjs · allocations.mjs ·
  assayer.mjs · sharing.mjs · signal-history.mjs
  providers/
    bitget.mjs         real Bitget REST — tickers, candles, books, RSI/EMA/ATR
                       (crypto + R-pair equities), retry + stale shelf
    news.mjs           RSS ingest (6 feeds), dedup, LLM + word-boundary heuristic classifier
    macro.mjs          real DXY/SPX/NDX/VIX/UST10Y via Yahoo Finance
    crossvenue.mjs     Binance+OKX+Bitget perp funding/OI, spot book depth stats
    marketintel.mjs    Fear & Greed, ETF flows (best-effort), BTC network stats
    bitget-trading.mjs Agentic Account OAuth + live order path (opt-in)
  lib/
    log.mjs · sse.mjs · ratelimit.mjs · jwt.mjs · auth.mjs · store.mjs ·
    llm.mjs · push.mjs
    lib.test.mjs       platform tests
    tier2.test.mjs     alerts · sharing · copilot tests
    getagent.test.mjs  playbooks · allocations · paper · assayer tests
    live-data.test.mjs symbol map · classifier · live skills · live signal · backtest tests

public/                manifest.webmanifest · sw.js · icons · logo
data/                  per-user JSON (git-ignored, docker-volume in prod)

Dockerfile · docker-compose.yml · .env.example
DEPLOYMENT.md          full production checklist
SUBMISSION.md          hackathon submission text
```

---

## Security Notes

- **Keys never touch the browser.** All provider keys live server-side; `VITE_*` variables are public by definition.
- **Paper-only by default.** `applyTraderDecision` throws unless `settings.paperOnly !== true`; live order submission additionally requires JWT auth + explicit `confirm:true`, and a kill-switch endpoint (`POST /trading/kill`) cancels all open orders and revokes the token.
- **Secrets hygiene.** `JWT_SECRET` generated via `openssl rand -base64 48`; OTP codes are scrypt-hashed with timing-safe verification; `.env` is git-ignored.
- **Rate limiting.** Sliding-window per-key limiter on expensive endpoints (LLM-backed research).
- **Geo/compliance.** Financial-adjacent: legal review and Bitget-restricted-region geo-blocking are required before onboarding real users — see `DEPLOYMENT.md §9`.

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

NIGHTWATCH watches the markets. It does not trade them unless you do.

This software is for research and education only. Nothing in it is investment advice, a recommendation, or an offer to buy or sell any financial instrument. Markets involve risk, including total loss of capital. Paper-trading results do not represent real-money performance. Do your own research and consult a licensed professional before making financial decisions.
