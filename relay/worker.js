/**
 * NIGHTWATCH AI · Bitget relay worker for Cloudflare.
 *
 * Why: Bitget's Cloudflare WAF blocks many datacenter egress IPs
 * (Railway, Fly, etc.) with a bare `{"cloudflare":"block"}` 403. Requests
 * that egress from Cloudflare's own network (i.e. from a Worker) reach
 * api.bitget.com normally.
 *
 * What this is: a transparent, read-only, path-restricted reverse proxy for
 * Bitget PUBLIC market-data endpoints:
 *   /api/v2/spot/market/*   (tickers, candles, orderbook)
 *   /api/v2/mix/market/*    (perp funding rate, open interest)
 *
 * What this is NOT: an open proxy. GET only, market-data paths only, and —
 * if you set the RELAY_KEY secret — requests must carry a matching
 * `x-relay-key` header or they are rejected.
 *
 * Deploy: see relay/README.md. Then point the server at it:
 *   BITGET_BASE_URL=https://<your-worker>.<your-subdomain>.workers.dev
 *   BITGET_RELAY_KEY=<the same secret you set on the Worker>
 */

const UPSTREAM = 'https://api.bitget.com'

const ALLOWED_PREFIXES = [
  '/api/v2/spot/market/',
  '/api/v2/mix/market/',
]

const UPSTREAM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 NightwatchAI/1.1 (research; +https://nightwatchai.watch)',
  'Accept': 'application/json',
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET') {
      return new Response('method not allowed', { status: 405 })
    }

    const url = new URL(request.url)
    if (!ALLOWED_PREFIXES.some(p => url.pathname.startsWith(p))) {
      return new Response('not found', { status: 404 })
    }

    // Optional shared-secret guard. Set RELAY_KEY via:
    //   wrangler secret put RELAY_KEY     (or dashboard → Settings → Variables)
    const relayKey = request.headers.get('x-relay-key')
    if (env?.RELAY_KEY && relayKey !== env.RELAY_KEY) {
      return new Response('forbidden', { status: 403 })
    }

    const upstream = UPSTREAM + url.pathname + url.search
    try {
      const res = await fetch(upstream, {
        method: 'GET',
        headers: UPSTREAM_HEADERS,
        cf: { cacheTtl: 0 },
      })
      const body = await res.arrayBuffer()
      return new Response(body, {
        status: res.status,
        headers: {
          'content-type': res.headers.get('content-type') || 'application/json',
          'cache-control': 'no-store',
          'x-relay-upstream-status': String(res.status),
        },
      })
    } catch (err) {
      return new Response(JSON.stringify({ error: 'upstream fetch failed', detail: String(err) }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      })
    }
  },
}
