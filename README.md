# NIGHTWATCH AI

**Trade the information, not just the chart.**

An AI trading research workbench **for event-driven and information-heavy traders** — the ones who move on earnings, macro prints, breaking news and overnight tape, not just candlestick patterns. Real Bitget tape · AI-authored desk analysis grounded on real facts · natural-language research · single-symbol Analysis workbench · stress-tested theses · portfolio impact · magic-link email sign-in · one-click copy-to-paper-portfolio.

**AI researches → AI analyzes → AI explains → HUMAN makes the final trading decision.**

Live at **[nightwatchai.up.railway.app](https://nightwatchai.up.railway.app)** (custom domain migration in progress to `nightwatchai.watch`).

| | |
|---|---|
| **Universe** | 18 assets — 8 crypto majors + 10 tokenized U.S. mega-caps, **all with real live Bitget prices** (crypto via BTCUSDT-style spot pairs, equities via Bitget's R-prefixed tokenized-stock pairs like `RNVDAUSDT`) |
| **Live tape** | Bitget public REST (spot ticker, 1h candles, 15-level orderbook) — refreshed every 10s, stale-while-revalidate cache so transient outages degrade honestly |
| **Live news** | CoinDesk · The Block · CoinTelegraph · SEC 8-K · Yahoo Finance · CNBC RSS ingester with dedup by content hash + Qwen-classified per-ticker impact |
| **Live macro** | DXY · S&P 500 · Nasdaq · VIX · UST10Y via Yahoo Finance — drives the `macro-analyst` skill and risk-regime read |
| **AI narration** | Qwen3.8-max via Bitget's hosted endpoint (fallback chain: Qwen → xAI → Anthropic → OpenAI, first key wins) with word-boundary keyword-heuristic fallback |
| **Analysis workbench** | Single-symbol `/analysis/{SYMBOL}` bundles Bitget ticker + indicators + book depth + cross-venue positioning + macro + symbol-tagged news, then Qwen writes a 4-part desk analysis with a verdict + entry/stop/target + invalidation |
| **Cross-venue positioning** | Binance + OKX + Bitget perp funding + open interest, aggregated per asset with per-venue table showing Bitget as home venue |
| **Streaming** | Server-Sent Events for prices + news — no client polling |
| **Auth** | Passwordless email OTP via Resend (6-digit code, 10-min TTL, scrypt-hashed, timing-safe verify). HS256 JWT scopes every request to the account so watchlist, positions, reports and paper capital follow the email across devices |
| **Persistence** | Per-user JSON files under `./data/` (drop-in Postgres path in `DEPLOYMENT.md`) |
| **Persistence** | Per-user JSON files under `./data/` (drop-in Postgres path in `DEPLOYMENT.md`) |
| **Trading** | Paper only by default. Live routing wiring documented in `DEPLOYMENT.md §5` |
| **Deploy** | One Dockerfile, one `docker compose up`, `./data` volume, `/health` + `/metrics` |
| **Live positioning** | Binance + OKX + Bitget perp funding + open interest, aggregated per asset (crypto) |
| **Live sentiment** | Crypto Fear & Greed + BTC network hash + best-effort Farside ETF net flows |
| **Signal proof** | Public /signals/history with rolling hit-rate resolved against real prices |
| **Signal quality** | Backtester runs on cached real Bitget candles (deep-paged ~2000×1h per asset); precision/recall/lift |
| **Portfolio Copilot** | Real-candle BTC correlation per position, factor clusters, concentration warnings |
| **Alerts** | Plain-English → structured rule (LLM or heuristic), fires push + SSE on match |
| **Persona** | Risk profile + style biases composite threshold + skill weights + risk adjustment |
| **Web Push** | Auto-generated VAPID, subscribe from UI, HIGH-relevance news fires push |
| **Sharing** | Any report → signed public URL, 30-day expiry, view counter |
| **Playbooks** | Public, published strategies with real-price paper PnL — the GetAgent Studio parallel, no real user funds |
| **Paper accounts** | Every user gets $10,000 virtual capital; allocate/unfollow flows to any Playbook |
| **Leaderboard** | Public ranking by followers / capital / live P&L / backtest return |
| **The Assayer** | AI chat companion that drafts Playbooks from plain-English prompts |
| **Live trading** | Bitget Agentic Account OAuth flow + trader-gated live order path + kill switch (opt-in only; paper-only by default) |
| **Copy to paper** | Every research report shows a top-of-page **Action Summary** card — verdict, plan (entry/stop/target/size/friction), one-click **COPY TO PAPER PORTFOLIO**, plus REJECT / SIT OUT / TRADE ON BITGET |
| **Tests** | 93 `node:test` cases across domain + backtest + live-data paths + JWT + RSS + store + alerts + sharing + copilot |

---

## The core loop

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

## Product surfaces

| Page | Purpose |
|---|---|
| **Research** | Natural-language terminal. Streams the 5-skill research process live and renders a structured report. |
| **News** | Live news tape with AI impact analysis per asset. High-relevance items trigger toast + push. |
| **Markets** | 18-asset scanner with live prices, class filter, watchlist toggle, one-click research. |
| **Signals** | All signals + last opportunity scan. |
| **Thesis Lab** | Signature stress-testing surface. Submit any thesis, get steelman + counter + 5 stress tests + confidence delta. |
| **Portfolio** | Paper book (trader-approved fills only) + Δ exposure / Δ beta / sector mix simulator. |
| **Backtest** | Replays skill pack + signal engine over synthetic or live candles; reports precision/recall/lift. |
| **History** | Every research report, decision, review, and session log. |
| **Settings** | Trader profile, watchlist, Bitget MCP connection status with setup steps. |

---

## Quick start (2 minutes, no keys required)

```bash
git clone <this repo>
cd nightwatch-ai
npm install

# With the adapter (live Bitget prices, real news, real macro — no keys needed):
npm run server &                 # API on http://127.0.0.1:8787
npm run dev                      # SPA on http://localhost:5173, auto-proxies to the API
# open printed http://localhost:5173

# Fully local demo (no adapter running): same command — the SPA falls back to
# the seeded offline deck and stamps everything DEMO · SIMULATED.
```

## Production-style local run (one command)

```bash
docker compose up --build
# open http://localhost:8787
```

Everything on one port: SPA + API + live data + persistence at `./data/`.

## Tests + build

```bash
npm test           # 89 node:test cases
npm run build      # static dist/
```

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
│   auth.mjs     dev-login + Bitget OAuth callback scaffold  │
│   store.mjs    per-user JSON file store                    │
│   llm.mjs      xAI / Anthropic / OpenAI JSON completion    │
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

## Bitget integration

Three seams — each is honest about what's live vs simulated:

1. **Public prices + candles + indicators + books.** Direct HTTPS to `api.bitget.com` for all 18 assets — crypto spot pairs and the R-prefixed tokenized-equity pairs. No auth required. Runs by default when you `npm run server`. The server builds a live universe (real price, 24h/7d change, ATR, RSI, volume z-score, spread) and injects it into every research, thesis, execution-help and scan call, alongside real wire news and a real macro snapshot (DXY/SPX/NDX/VIX/UST10Y via Yahoo).
2. **`bitget-signal` skills.** Skills compute from the live context above by default; seeded deterministic values remain only as the offline fallback (clearly stamped `DEMO`). Wire `BITGET_MCP_URL` to point at Bitget's Agent Hub MCP sidecar (`bgc mcp serve --port 9091`) and the badge flips to `BITGET MCP · LIVE`. Skill schemas match.
3. **Live paper trading via Agentic Account.** OAuth callback scaffolded in `server/lib/auth.mjs`; final Bitget order call lives in `applyTraderDecision`. Enable when you provision `BITGET_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI`. Trader Approve is always required.

Full setup for each in `DEPLOYMENT.md`.

## Data honesty

The sidebar badge tells you exactly what you're looking at, in real time:

- `BITGET MCP · LIVE` — MCP sidecar reachable, skills live
- `LIVE FEED · PRICES + NEWS` — real prices and real news, local skill pack
- `LIVE PRICES · DEMO NEWS` — RSS temporarily unreachable
- `LIVE NEWS · DEMO PRICES` — Bitget rate-limited us
- `DEMO · SIMULATED DATA` — no adapter attached, everything from the seeded deck

Reports are stamped `DEMO` or `LIVE` at generation time. No hidden state.

---

## Endpoints (adapter)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/health` | Liveness + wired providers | — |
| GET | `/metrics` | Prometheus text format | — |
| GET | `/bitget/status` | MCP sidecar connection | — |
| GET | `/prices/live` | Snapshot of live tickers for all 18 assets | — |
| GET | `/prices/stream` | SSE stream of ticker updates | — |
| GET | `/prices/indicators/:symbol` | Real EMA/RSI/ATR/trend/support/resistance from Bitget candles | — |
| GET | `/positioning/:symbol` | Aggregated funding + OI across Binance/OKX/Bitget | — |
| GET | `/book/:symbol` | Bitget spot order-book depth + spread bps (crypto + equities) | — |
| GET | `/marketintel/:symbol` | Fear & Greed + ETF flows + BTC network stats | — |
| GET | `/macro` | Real DXY · SPX · NDX · VIX · UST10Y + risk regime | — |
| GET | `/news/live?limit=60` | Deduped live news items (cross-source collapsed) | — |
| GET | `/news/stream` | SSE stream of news items | — |
| POST | `/research` | Full engine dispatch, live-enhanced when possible | — (rate limited) |
| GET | `/signals/history?limit=100` | Public signal ledger with resolved outcomes | — |
| GET | `/signals/stats` | Rolling accuracy / hit-rate by symbol | — |
| GET | `/history/status` | Cached-candle warm status per crypto ticker | — |
| GET | `/history/:symbol` | Cached hourly candles for the symbol | — |
| POST | `/backtest/live` | Backtest against cached real Bitget candles | — |
| POST | `/history/warm` | Force-refresh the candle cache | — |
| POST | `/auth/dev-login` | Local dev login | disabled in prod unless `ALLOW_DEV_LOGIN=1` |
| GET | `/auth/oauth/bitget/start` | Bitget Agentic Account authorize URL | — |
| POST | `/auth/oauth/bitget/callback` | Exchange OAuth code for agent-account token | JWT |
| GET | `/trading/status` | Live-trading connection state per user | JWT |
| POST | `/trading/order` | Submit live agent-account order (trader-gated) | JWT + `confirm:true` |
| POST | `/trading/kill` | Cancel all open orders + revoke token | JWT |
| GET | `/session` | Load per-user persistent session | JWT |
| PATCH | `/session` | Merge patch into session | JWT |
| GET | `/vapid/public-key` | Web Push VAPID public key | — |
| POST | `/push/subscribe` | Save Web Push subscription | JWT |
| POST | `/push/test` | Send a test push to the current user | JWT |
| GET | `/alerts` | List user alerts | JWT |
| POST | `/alerts` | Create an alert (plain-English or structured) | JWT |
| POST | `/alerts/parse` | Preview alert parse without saving | JWT |
| DELETE | `/alerts/:id` | Delete alert | JWT |
| POST | `/alerts/:id/reset` | Reset a fired alert so it can fire again | JWT |
| POST | `/share/report` | Create signed share URL for any report | JWT |
| GET | `/share/report/:token` | Read a shared report (public) | — |
| POST | `/copilot/portfolio` | Correlation + factor + sector analysis of a book | — |
| GET | `/copilot/correlation/:symbol` | 30-day correlation of symbol vs BTC | — |

## Human-in-the-loop guarantees

| Path | Trader action | Can fill? |
|---|---|---|
| Report SIGNAL | **APPROVE** / Reject | Yes, paper — after Approve |
| Report NO_TRADE | Acknowledge sit-out | No, ever |
| Portfolio exposure > cap | Impact card flags `BREACHES CAP` | No auto-fill |
| `settings.paperOnly !== true` | — | `applyTraderDecision` throws |

Live routing is disabled by default. Model provider keys stay on the server. The trader owns every fill.

## Real live data proof

Everything below runs live on a fresh checkout with `npm install && npm run server`:

- **Bitget public prices** — real spot tickers for all 18 assets (crypto majors + tokenized equities via Bitget R-pairs), refreshed every 10s.
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

## What's left before real users

See **`DEPLOYMENT.md`** for the full checklist. The short version:

- ✅ **Built and working:** everything above, plus SSE streams, auth (dev), per-user persistence, rate limiting, structured logs, health/metrics, PWA + service worker + Web Push, error boundary, legal disclaimer, backtest, plain-English alerts, report sharing, persona-tuned signals, Bitget Agentic Account OAuth scaffold, Docker + docker-compose, deployment guide.
- 🟡 **Scaffolded, needs your credentials:** LLM narration + LLM alert parser (paste any of `XAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`), Bitget MCP proxy (run `bgc mcp serve`), Bitget Agentic Account OAuth (`BITGET_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI` + `BITGET_LIVE_ENABLED=1`), production `JWT_SECRET`.
- 🔴 **Requires you (I can't do these from a code session):** cloud host (Fly / Railway / AWS), Postgres migration when you scale past ~1k DAU, Sentry sign-up, Stripe billing wiring, legal review, geo-block config, DNS + TLS.

Every 🔴 item has a step-by-step recipe in `DEPLOYMENT.md`.

## Project layout

```
src/
  domain.js            engine — universe, skills, signal, report, thesis, portfolio, review
  domain.test.js       36 domain tests
  backtest.js          precision/recall/lift over synthetic or real candles (per-bar no-lookahead indicators)
  backtest.test.js     4 backtest tests
  main.jsx             SPA (Research · News · Markets · Signals · Thesis Lab · Portfolio · Backtest · History · Settings · Explore · Leaderboard · Assayer)
  styles.css           institutional dark terminal design
  ui/
    ErrorBoundary.jsx  panic screen + wipe-session fallback
    Disclaimer.jsx     not-investment-advice modal + persistent footer
    useLiveStream.js   SSE subscription hook
    usePush.js         Web Push subscribe + test
    MarketPulse.jsx    live BTC/ETH/F&G strip
    GetAgentPages.jsx  Explore · Leaderboard · Assayer · Playbook detail · paper account

server/
  adapter.mjs          composed HTTP + SSE server
  static-serve.mjs     production combined SPA + API on one port
  market-context.mjs   live universe builder — real prices/indicators/news/macro injected into every engine call
  live-enhance.mjs     report overlay — positioning, book depth, intel, real friction
  history.mjs          deep-paged real candle cache (18 assets)
  providers/
    bitget.mjs         real Bitget REST — tickers, candles, books, RSI/EMA/ATR (crypto + R-pair equities), retry + stale shelf
    news.mjs           RSS ingest (6 feeds), dedup, LLM + word-boundary heuristic classifier
    macro.mjs          real DXY/SPX/NDX/VIX/UST10Y via Yahoo Finance
    crossvenue.mjs     Binance+OKX+Bitget perp funding/OI, spot book depth stats
    marketintel.mjs    Fear & Greed, ETF flows (best-effort), BTC network stats
    bitget-trading.mjs Agentic-Account OAuth + live order path (opt-in)
  lib/
    log.mjs · sse.mjs · ratelimit.mjs · jwt.mjs · auth.mjs · store.mjs · llm.mjs · push.mjs
    lib.test.mjs       10 platform tests
    tier2.test.mjs     10 tests (alerts · sharing · copilot)
    getagent.test.mjs  13 tests (playbooks · allocations · paper · leaderboard)
    live-data.test.mjs 16 tests (symbol map · classifier · live skills · live signal · backtest)

public/                manifest.webmanifest · sw.js · icon-192.png · icon-512.png
data/                  per-user JSON (git-ignored, docker-volume in prod)

Dockerfile · docker-compose.yml · .env.example
DEPLOYMENT.md          full production checklist
SUBMISSION.md          hackathon submission text
```

NIGHTWATCH watches the markets. It does not trade them unless you do.
