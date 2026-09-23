# NIGHTWATCH AI · Deployment Guide

A step-by-step checklist to take NIGHTWATCH AI from `npm run dev` on your laptop to a real production deployment that real users can trust. Each item is either **do-it-yourself** (I've already built the code; you flip an env var) or **needs your account** (I can't do this from a code session — you'll have to sign up and paste the resulting key).

Legend: ✅ scaffolded and working today · 🟡 scaffolded, needs your credentials · 🔴 out of scope for this session, must be done by you.

---

## 0 · Pre-flight

Node 20+ is required. Run `node --version`. Everything else is `npm install`.

```bash
git clone <this repo>
cd nightwatch-ai
npm install
cp .env.example .env
```

---

## 1 · Local production run (5 min) ✅

```bash
docker compose up --build
```

Then open `http://localhost:8787`. You get:

- The SPA and the API on one origin (no CORS gymnastics).
- Real Bitget public prices for all 18 assets (crypto + tokenized equities) refreshed every 10s.
- Real news from CoinDesk, TheBlock, CoinTelegraph, SEC 8-K, Yahoo Finance, CNBC (`NEWS_ENABLED=1`).
- Real macro tape (DXY, S&P 500, Nasdaq, VIX, UST10Y) via Yahoo Finance.
- Heuristic news classifier (LLM classifier kicks in as soon as you set an LLM key).
- JWT auth with dev-login (`POST /auth/dev-login {email}` — the compose file sets `ALLOW_DEV_LOGIN=1` for beta; replace with real auth before taking on users).
- Session persistence at `./data/`.
- `/health`, `/metrics`, `/macro`, `/bitget/status` all live.

If you don't want Docker:

```bash
npm run build && npm start &           # API + SPA served together on 8787
```

(`npm run server` starts the API alone — use it for development next to `npm run dev`.)

That's the minimum viable deployment. Below is what to layer on for real users.

---

## 2 · Secrets & configuration 🟡

Copy `.env.example` to `.env` and fill:

| Variable | Purpose | Required for | Where to get it |
|---|---|---|---|
| `JWT_SECRET` | HMAC secret for auth tokens | Production auth | `openssl rand -base64 48` |
| `QWEN_API_KEY` | Qwen narration + news classifier (first-priority provider) | LLM narration | Bitget hackathon endpoint |
| `XAI_API_KEY` | Grok narration + news classifier | Fallback LLM | https://x.ai/api |
| `ANTHROPIC_API_KEY` | Claude narration + news classifier | Fallback LLM | https://console.anthropic.com |
| `OPENAI_API_KEY` | GPT narration + news classifier | Fallback LLM | https://platform.openai.com |
| `BITGET_MCP_ENABLED` | Set to `0` to disable the Signal MCP client entirely | Optional | — |
| `BITGET_MCP_URL` | Override the Bitget Signal MCP endpoint | Optional — defaults to Bitget's own hosted MCP, no setup needed | Only set this if you're running a private sidecar |
| `BITGET_WS_ENABLED` | Set to `0` to disable the public WebSocket client (REST-only fallback) | Optional | — |
| `BITGET_BASE_URL` | Point Bitget REST calls at the Cloudflare Worker relay (`relay/`) instead of `api.bitget.com` | Optional — only needed if your host's IPs get WAF-blocked by Bitget | See `relay/README.md` |
| `BITGET_RELAY_KEY` | Shared secret sent as `x-relay-key` when using the relay | Required if `BITGET_BASE_URL` points at the relay | Set when you deploy the Worker |
| `BITGET_OAUTH_CLIENT_ID` | Agent Hub OAuth for the operator's Agentic Account | Live UTA v3 order routing | Apply at https://www.bitget.com/api-management for an Agent Hub app |
| `BITGET_OAUTH_CLIENT_SECRET` | ↑ | ↑ | ↑ |
| `BITGET_OAUTH_REDIRECT_URI` | ↑ | ↑ | Your production URL + `/auth/oauth/bitget/callback` |
| `BITGET_LIVE_ENABLED` | Set to `1` to actually enable order routing (in addition to the OAuth vars above) | Live UTA v3 order routing | — |
| `RESEND_API_KEY` | Email OTP sign-in + Alpha of the Day delivery | Email | https://resend.com |
| `EMAIL_FROM` | Domain-verified sender address | Production email | Resend dashboard |
| `APP_URL` | Absolute URL used in email links | Recommended for email | Your production URL |
| `CORS_ORIGIN` | Restrict browser access | Production | Your SPA origin, e.g. `https://nightwatch.example.com` |
| `NIGHTWATCH_DATA_DIR` | Where per-user JSON files land | Persistence | Default `./data`; mount a volume in prod |
| `LOG_LEVEL` | Log verbosity | Ops | `info` default; `warn` for prod |
| `RATE_RESEARCH` | Requests / minute per key | Abuse control | Default 60 |
| `NEWS_POLL_MS` | RSS poll interval | Feed freshness | Default 60000 |
| `PRICES_TICK_MS` | Price tick broadcast interval (fallback cadence when WS is down) | Feed freshness | Default 10000 |

**Never set any of these as `VITE_*`.** Those get baked into the browser bundle.

---

## 3 · Bitget Signal MCP — works out of the box 🟢

Unlike earlier revisions of this doc, **no sidecar setup is required.** `server/providers/bitget-mcp.mjs` is a real Streamable-HTTP MCP client that connects directly to Bitget's own hosted signal MCP (`datahub.noxiaohao.com/mcp` — the same endpoint the official `@bitget-ai/bitget-signal` npm package registers into Claude Code / Cursor / Windsurf) on boot, with no credentials needed. 19 tools are reachable immediately.

Verify it's connected:

```bash
curl http://localhost:8787/bitget/status
# { "connected": true, "model": "market-data-mcp", "skills": [...19 tools...] }
```

The sidebar shows `BITGET MCP · LIVE` once the handshake completes (usually 1-3 seconds after boot). If you want to point at a **private** MCP sidecar instead of Bitget's hosted one, set `BITGET_MCP_URL` to override the default — but for the hackathon deployment, leave it unset.

---

## 4 · Persistence upgrade path 🔴

Ships with per-user JSON files under `./data/`. Adequate for beta up to ~10,000 users; not for load.

**Upgrade to Postgres** when you cross ~1000 daily active users:

- Add `pg` to package.json.
- Replace `server/lib/store.mjs` with a Postgres-backed implementation exporting the same functions (`loadSessionFor`, `patchSessionFor`, `createUser`, etc). Every caller uses the same interface — this is a drop-in swap.
- Add a migration file with the schema:

```sql
CREATE TABLE users        (id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT, provider TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);
CREATE TABLE reports      (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), symbol TEXT, question TEXT, artifact JSONB, created_at TIMESTAMPTZ);
CREATE TABLE decisions    (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), report_id TEXT, action TEXT, at TIMESTAMPTZ);
CREATE TABLE positions    (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), asset TEXT, direction TEXT, notional NUMERIC, entry_price NUMERIC, stop_price NUMERIC, target_price NUMERIC, status TEXT, pnl NUMERIC, closed_at TIMESTAMPTZ, opened_at TIMESTAMPTZ);
CREATE TABLE reviews      (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), position_id TEXT, artifact JSONB, created_at TIMESTAMPTZ);
CREATE TABLE watchlist    (user_id TEXT REFERENCES users(id), symbol TEXT, PRIMARY KEY (user_id, symbol));
CREATE TABLE preferences  (user_id TEXT PRIMARY KEY REFERENCES users(id), payload JSONB);
CREATE TABLE news_alerts  (user_id TEXT REFERENCES users(id), news_id TEXT, dismissed_at TIMESTAMPTZ, PRIMARY KEY (user_id, news_id));
CREATE TABLE push_subs    (user_id TEXT PRIMARY KEY REFERENCES users(id), endpoint TEXT, keys JSONB);
```

- Set `DATABASE_URL` and start.

---

## 5 · Live order routing via Bitget Agentic Account (UTA v3) 🟡

The Agentic Account is Bitget's OAuth-scoped sub-account: fund isolation, quota cap, no withdrawals, no manual API key. The full flow is built and wired — this section is just the credential checklist to turn it on.

**Already built and shipped** in `server/providers/bitget-trading.mjs`:
`buildAuthorizeUrl` · `exchangeCodeForToken` · `refreshAccessToken` · `storeUserToken` · `getValidAccessToken` · `submitLiveOrder` (routes through Bitget's UTA v3 API) · `killSwitch` (cancel-all + revoke). Wired end-to-end into `server/adapter.mjs` (`/auth/oauth/bitget/start`, `/auth/oauth/bitget/callback`, `/trading/status`, `/trading/order`, `/trading/kill`) and into the SPA — a "Connect Agentic Account" button and a "Route to Agentic Account (LIVE)" button with a per-order confirm modal, both in Settings and on every approved research report.

`isLiveEnabled()` gates the whole path: it returns `false` — and every code path stays paper-only — until **both** `BITGET_LIVE_ENABLED=1` **and** the three OAuth vars below are set. This is a deliberate double-gate so a stray env var can't silently turn on live trading.

**What you need to do to turn it on:**

1. Apply for an Agent Hub OAuth app at https://www.bitget.com/api-management.
2. Register your production origin as an approved redirect URI.
3. Paste `BITGET_OAUTH_CLIENT_ID`, `BITGET_OAUTH_CLIENT_SECRET`, `BITGET_OAUTH_REDIRECT_URI` into `.env`.
4. Set `BITGET_LIVE_ENABLED=1`.
5. Restart. `GET /trading/status` (JWT-authed) now reports `liveEnabled: true`; the "Connect Agentic Account" button appears in Settings.

Per-order Trader Approve is enforced both client-side (confirm modal) and server-side (`confirm: true` required in the request body) — this cannot be bypassed by a client bug. Test with a small notional first. Only take on real user funds after your legal review (§9).

---

## 6 · Web Push notifications 🟡

**Fully built and shipped** — `server/lib/push.mjs` uses the `web-push` package to deliver real pushes via `sendPush(userId, payload)` and `deliverToAll(payload)`. The news pipeline calls `shouldPushForUser()` on every ingested item and fires a push automatically when a HIGH-relevance headline touches a user's watchlist or open positions. Nothing left to wire — this section is just how to configure your own VAPID keys instead of the auto-generated ones.

VAPID keys auto-generate on first boot if you don't set your own (`server/lib/push.mjs` calls `webpush.generateVAPIDKeys()` as a fallback). To pin your own for a stable production identity:

```bash
# Generate a VAPID key pair once
node -e "const c=require('node:crypto'); const k=c.generateKeyPairSync('ec',{namedCurve:'P-256'}); console.log('PUBLIC:', k.publicKey.export({type:'spki',format:'der'}).toString('base64url')); console.log('PRIVATE:', k.privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'))"
# Add to .env
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
```

Without pinned keys, subscriptions break on every restart (the auto-generated key pair changes) — pin these before you have real subscribers.

---

## 7 · Observability 🔴 (you must sign up)

`/metrics` is Prometheus-compatible. Point Grafana Cloud / Prometheus at it.

For error tracking:

- Sign up at https://sentry.io.
- Add `SENTRY_DSN` to `.env`.
- Install `@sentry/node` on the server + `@sentry/react` on the SPA.
- Wrap `ErrorBoundary` and call `Sentry.captureException` in `componentDidCatch`.

Structured logs already ship to stdout as JSON. Point any log shipper (Loki, Datadog, CloudWatch) at your container's stdout.

---

## 8 · Rate limiting & DDoS 🟡

In-process sliding-window limiter is on. For real traffic put NIGHTWATCH behind Cloudflare (free tier is fine). Cloudflare does IP-level DDoS + you keep our per-user limits for LLM cost control.

---

## 9 · Legal, compliance, geo 🔴 (must be done by you)

**Do not skip this section.** Financial-adjacent products need real legal review.

- **Not investment advice disclaimer** — Already displayed as a modal on first launch and as a persistent footer. Have a lawyer confirm the wording is defensible in your target jurisdictions.
- **Geo-block Bitget-restricted regions.** Options:
  - Cloudflare: create a WAF rule blocking traffic from US, UK, and any other jurisdictions where Bitget doesn't operate.
  - Cloud provider: use their edge geolocation to reject.
  - Application: read `CF-IPCountry` header in a middleware and reject with a 403 for restricted regions.
- **Terms of use + privacy policy + cookie banner** — required in most jurisdictions.
- **GDPR/CCPA data-request handler** — `GET /me/export` and `DELETE /me` endpoints must be built and documented. The JSON store makes this ~40 lines of code.
- **MiFID II** (EU), **SFC** (HK), **MAS** (SG) — talk to a lawyer before charging money in those markets.

---

## 10 · Deploy to a real cloud

The Docker image works anywhere. This hackathon's live deployment (https://nightwatchai.watch) runs on **Railway** — that path is verified and running today. The others below are equally viable but untested by this project.

### Railway ✅ (what's actually running in production)

```bash
railway up
```

Point Railway at the repo, add the secrets from §2 in the Railway dashboard, add a volume mount at `/data`, then attach your custom domain under the service's Settings → Domains. ~$5/mo. Bitget's WAF blocks some shared datacenter IP ranges — if you see 403s on Bitget REST calls from your Railway deployment, route through the Cloudflare Worker relay in `relay/` (`BITGET_BASE_URL` + `BITGET_RELAY_KEY`).

### Fly.io 🔴 (untested alternative)

```bash
fly launch                  # generates fly.toml
fly volumes create nw_data --size 5
fly secrets set JWT_SECRET=... QWEN_API_KEY=... RESEND_API_KEY=...
fly deploy
```

Fly gives you a global anycast address + volume + secrets management for ~$5/mo.

### AWS ECS / Fargate

- Push the image to ECR.
- Create a task definition using the image.
- Mount an EFS volume at `/data`.
- Front with an ALB.
- Add secrets via Secrets Manager.
- Route53 for DNS.

### Kubernetes

- One deployment.
- One service (ClusterIP).
- Ingress with TLS from cert-manager.
- Persistent volume claim mounted at `/data`.

Every one of these is straightforward because the container is single-process and single-port.

---

## 11 · Billing 🔴 (Stripe)

Not built. Add:

1. `POST /billing/checkout` — creates a Stripe Checkout Session for the selected plan.
2. `POST /billing/webhook` — receives Stripe events, sets `user.tier` in the store.
3. Middleware on `/research` and `/news/stream` that checks `user.tier` against a plan matrix.

A junior can wire this in a day using Stripe's official Node SDK.

---

## 12 · Monitoring checklist for launch day

- [ ] `curl https://your-domain/health` returns `{ ok: true }` and `uptimeSec > 0`.
- [ ] `curl https://your-domain/prices/live | jq '.tickers.BTC.last'` returns a plausible number.
- [ ] `curl https://your-domain/news/live | jq '.count'` returns > 0 within 2 minutes of boot.
- [ ] `curl https://your-domain/metrics | grep nightwatch_requests_total` climbs as you use the SPA.
- [ ] Sentry receives a test error (`throw` in a dev build).
- [ ] Web Push notification arrives on your device.
- [ ] `/auth/dev-login` disabled in production — already guarded in `server/adapter.mjs` (`NODE_ENV === 'production' && ALLOW_DEV_LOGIN !== '1'` → 403); just confirm you haven't set `ALLOW_DEV_LOGIN=1` on your production env.
- [ ] JWT_SECRET is set (`/health` logs a warning if not).
- [ ] Legal review complete.
- [ ] Geo-block active on Bitget-restricted regions.
- [ ] Rate limits tested (`for i in {1..100}; do curl -s https://your-domain/research -X POST -d '{}'; done` should 429 after 60).

---

## 13 · What I did **not** build

Being explicit about the real gap so you can plan the last mile. (Live Bitget order routing, the Signal MCP client, the WebSocket tick stream, and Web Push delivery are all fully built and shipped — see §3, §5, and §6 above; they used to be listed here as gaps in an earlier revision of this doc, they aren't anymore.)

- **Stripe billing** — no code.
- **Sentry / Datadog wiring** — install-time, ~30 lines each.
- **Postgres migration** — swap `server/lib/store.mjs`.
- **Legal copy** — the disclaimer modal + footer text is real copy, not a placeholder, but you should still have a lawyer confirm it's defensible in your target jurisdictions.
- **Deployment configuration for your specific cloud** — Docker + docker-compose here; you pick the host. The live deployment for this hackathon runs on Railway with a custom domain — see §10.

Everything else — the entire product loop, live prices, live news, streaming, auth, persistence, rate limits, logs, metrics, PWA, backtest, error handling — is real code you can ship today.
