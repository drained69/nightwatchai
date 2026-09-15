# Bitget relay worker

Bitget's Cloudflare WAF blocks most datacenter egress IPs (including Railway's)
with `{"cloudflare":"block"}` 403s. This tiny Cloudflare Worker reverse-proxies
Bitget's **public market-data** endpoints; because it egresses from
Cloudflare's own network, Bitget's WAF lets it through.

- GET only
- Only `/api/v2/spot/market/*` and `/api/v2/mix/market/*` (no trading endpoints)
- Optional shared-secret (`x-relay-key` header) so it can't be abused as an open proxy
- Free tier is plenty: 100k req/day vs ~30–60k/day from one NIGHTWATCH deployment

## Deploy (dashboard, no tools needed — ~5 minutes)

1. Create a free account at https://dash.cloudflare.com (if you don't have one).
2. Go to **Workers & Pages → Create → Create Worker**.
3. Name it (e.g. `bitget-relay`) and click **Deploy** with the hello-world stub.
4. Click **Edit code**, replace everything with the contents of `relay/worker.js`, click **Deploy**.
5. Add the shared secret: **Settings → Variables & Secrets → Add**:
   - Type: **Secret**, name `RELAY_KEY`, value: output of `openssl rand -base64 32`.
   (The `env.RELAY_KEY` reference in the worker picks this up automatically.)
6. Note the Worker URL, e.g. `https://bitget-relay.yourname.workers.dev`.
7. Test it from your laptop:
   ```bash
   curl -H "x-relay-key: <your key>" \
     "https://bitget-relay.yourname.workers.dev/api/v2/spot/market/tickers?symbol=BTCUSDT"
   ```
   You should get `{"code":"00000","msg":"success",...}`.

## Deploy (wrangler CLI)

```bash
npm i -g wrangler
wrangler login
cd relay
wrangler deploy worker.js --name bitget-relay --compatibility-date 2026-01-01
wrangler secret put RELAY_KEY     # paste: openssl rand -base64 32
```

## Wire NIGHTWATCH to it

Set these on your hosting platform (Railway: service → Variables):

```
BITGET_BASE_URL=https://bitget-relay.yourname.workers.dev
BITGET_RELAY_KEY=<the same secret you set as RELAY_KEY on the Worker>
```

Then redeploy the service. Verify with:

```bash
curl https://<your-app>/health          # universe.total should be > 0
curl https://<your-app>/prices/live | head -c 300
```

## Notes

- The server sends the `x-relay-key` header on every Bitget request only when
  `BITGET_RELAY_KEY` is set (see `server/providers/bitget.mjs`).
- If you skip `RELAY_KEY` on the Worker, the relay is public — anyone who finds
  the URL can consume your Worker quota. Set it.
- Bitget's own per-IP rate limit (20 req/s) still applies to the Worker's
  egress. NIGHTWATCH's polling pattern stays well under it.
