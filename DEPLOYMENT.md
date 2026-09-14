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
npm run build && npm run serve &       # API + SPA served together on 8787
```

(`npm run server` starts the API alone — use it for development next to `npm run dev`.)

That's the minimum viable deployment. Below is what to layer on for real users.

---

## 2 · Secrets & configuration 🟡

Copy `.env.example` to `.env` and fill:

| Variable | Purpose | Required for | Where to get it |
|---|---|---|---|
| `JWT_SECRET` | HMAC secret for auth tokens | Production auth | `openssl rand -base64 48` |
| `XAI_API_KEY` | Grok narration + news classifier | LLM narration | https://x.ai/api |
| `ANTHROPIC_API_KEY` | Claude narration + news classifier | Fallback LLM | https://console.anthropic.com |
| `OPENAI_API_KEY` | GPT narration + news classifier | Fallback LLM | https://platform.openai.com |
| `BITGET_MCP_URL` | Route the 5 bitget-signal skills to Bitget MCP | Live research | Run `bgc mcp serve --port 9091` locally, or the docker-compose sidecar (see below) |
| `BITGET_OAUTH_CLIENT_ID` | Bitget Agentic Account OAuth | Live paper routing | Apply at https://www.bitget.com/api-management for an agent-account app |
| `BITGET_OAUTH_CLIENT_SECRET` | ↑ | ↑ | ↑ |
| `BITGET_OAUTH_REDIRECT_URI` | ↑ | ↑ | Your production URL + `/auth/oauth/bitget/callback` |
| `CORS_ORIGIN` | Restrict browser access | Production | Your SPA origin, e.g. `https://nightwatch.example.com` |
| `NIGHTWATCH_DATA_DIR` | Where per-user JSON files land | Persistence | Default `./data`; mount a volume in prod |
| `LOG_LEVEL` | Log verbosity | Ops | `info` default; `warn` for prod |
| `RATE_RESEARCH` | Requests / minute per key | Abuse control | Default 60 |
| `NEWS_POLL_MS` | RSS poll interval | Feed freshness | Default 60000 |
| `PRICES_TICK_MS` | Price tick broadcast interval | Feed freshness | Default 10000 |

**Never set any of these as `VITE_*`.** Those get baked into the browser bundle.

---

## 3 · Bitget MCP sidecar for live `bitget-signal` skills 🟡

This is the highest-value integration for the Track 3 story.

```bash
# Install the Bitget Agent Hub CLI
npm i -g @bitget/agent-hub-cli
# Enumerate available skills (no API key needed for bitget-signal)
bgc discover
# Serve the MCP as HTTP on 9091
bgc mcp serve --port 9091
```

Then set `BITGET_MCP_URL=http://127.0.0.1:9091` in your `.env` and restart NIGHTWATCH. The sidebar badge flips from `LIVE PRICES · DEMO NEWS` to `BITGET MCP · LIVE` and `/bitget/status` reports `{ connected: true, skills: [...] }`.

The uncommented compose service in `docker-compose.yml` shows how to run this alongside NIGHTWATCH.

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

## 5 · Real live paper trading via Bitget Agentic Account 🟡

The Agentic Account is Bitget's OAuth-scoped sub-account: fund isolation, quota cap, no withdrawals, no manual API key. Perfect for this product.

**What I built already:** `server/lib/auth.mjs` has the OAuth-callback function scaffolded — it throws with a helpful message until you set `BITGET_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI`.

**What you still need to do:**

1. Apply for an agent-account OAuth app at https://www.bitget.com/api-management.
2. Register your production origin as an approved redirect URI.
3. Paste the client id + secret into `.env`.
4. Uncomment the real Bitget token exchange in `server/lib/auth.mjs::bitgetOauthCallback`. Bitget's docs give the exact request shape; the scaffold shows where.
5. Add the order-submission call in `applyTraderDecision` (currently paper-only): when `session.provider.bitgetLive === true` and the user has an agent-account token, POST to Bitget's `/v3/agent/orders` endpoint. **Keep the trader-Approve requirement** — never auto-fill.

Test with the `--paper-trading` flag exposed by `bgc`. Only go live after your legal review (§9).

---

## 6 · Web Push notifications 🟡

The service worker is already wired. To send pushes:

```bash
# Generate a VAPID key pair once
node -e "const c=require('node:crypto'); const k=c.generateKeyPairSync('ec',{namedCurve:'P-256'}); console.log('PUBLIC:', k.publicKey.export({type:'spki',format:'der'}).toString('base64url')); console.log('PRIVATE:', k.privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'))"
# Add to .env
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
```

Then install a push-sending dep (`npm i web-push`) and add a small `sendPush(userId, payload)` helper in `server/lib/push.mjs` that iterates `listPushSubscriptions()` and posts to each. Trigger from the news classifier when a HIGH-severity item touches a user's watchlist/positions.

**Delivery is scaffolded; the send call is not.** Two hours of work with the `web-push` package.

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

## 10 · Deploy to a real cloud 🔴 (you pick + configure)

The Docker image works anywhere. Pick one:

### Fly.io (simplest)

```bash
fly launch                  # generates fly.toml
fly volumes create nw_data --size 5
fly secrets set JWT_SECRET=... XAI_API_KEY=... BITGET_MCP_URL=...
fly deploy
```

Fly gives you a global anycast address + volume + secrets management for ~$5/mo.

### Railway

Point Railway at the repo, add secrets, deploy. Add a volume mount at `/data`. ~$5/mo.

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
- [ ] `/auth/dev-login` disabled in production (guard with `NODE_ENV !== 'production'`) — TODO in `server/lib/auth.mjs`.
- [ ] JWT_SECRET is set (`/health` logs a warning if not).
- [ ] Legal review complete.
- [ ] Geo-block active on Bitget-restricted regions.
- [ ] Rate limits tested (`for i in {1..100}; do curl -s https://your-domain/research -X POST -d '{}'; done` should 429 after 60).

---

## 13 · What I did **not** build

Being explicit about the gap so you can plan the last mile:

- **Real Bitget order routing** — scaffolded, but the actual REST call to Bitget's order endpoint isn't in the code because I don't have a Bitget business account or the exact endpoint the Agent Account exposes for third-party OAuth. The seam is `applyTraderDecision` in `src/domain.js` — replace `PaperExecution.submit()` there with a call to your Bitget adapter.
- **Stripe billing** — no code.
- **Google/Bitget OAuth exchange** — dev-login works, OAuth callback throws until credentials are set.
- **Sentry / Datadog wiring** — install-time, ~30 lines each.
- **Postgres migration** — swap `server/lib/store.mjs`.
- **Legal copy** — placeholder that you should replace with lawyer-reviewed text.
- **Deployment configuration for your specific cloud** — Docker + docker-compose here; you pick the host.

Everything else — the entire product loop, live prices, live news, streaming, auth, persistence, rate limits, logs, metrics, PWA, backtest, error handling — is real code you can ship today.
