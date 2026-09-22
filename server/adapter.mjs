#!/usr/bin/env node
/**
 * NIGHTWATCH AI · production adapter.
 *
 * Composes:
 *   - Bitget public prices + indicators           (server/providers/bitget.mjs)
 *   - News RSS ingester + LLM/heuristic classifier (server/providers/news.mjs)
 *   - LLM narration rewrite                        (server/lib/llm.mjs)
 *   - Auth + JWT + user store                      (server/lib/{auth,jwt,store}.mjs)
 *   - Rate limiting                                (server/lib/ratelimit.mjs)
 *   - Structured JSON logs                         (server/lib/log.mjs)
 *   - Server-Sent Events streams for news + prices (server/lib/sse.mjs)
 *
 * Endpoints:
 *   GET  /health                    liveness + wired providers
 *   GET  /metrics                   prometheus-style text
 *   GET  /bitget/status             MCP proxy availability
 *   GET  /prices/live               current live snapshot of mapped crypto tickers
 *   GET  /prices/stream             SSE stream of ticker updates
 *   GET  /news/live                 dedupe'd live news items (up to ?limit=60)
 *   GET  /news/stream               SSE stream of new news items
 *   POST /research                  { intent, question, asset, thesis, context }
 *   POST /auth/dev-login            { email, name } → { user, token }
 *   GET  /session                   requires bearer token
 *   PATCH /session                  requires bearer token, merges patch
 *   POST /push/subscribe            saves Web Push subscription
 */
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'

import { logger } from './lib/log.mjs'
import { makeRateLimiter, enforce } from './lib/ratelimit.mjs'
import { makeSseBus } from './lib/sse.mjs'
import { makeLlm } from './lib/llm.mjs'
import { requireAuth, devLogin, signup, login, publicUser, requestSignInCode, verifySignInCode } from './lib/auth.mjs'
import { loadSessionFor, patchSessionFor, savePushSubscription, paths } from './lib/store.mjs'
import { getAllTickers, getAllTickersLive, getTicker, computeIndicators } from './providers/bitget.mjs'
import { startBitgetWs, stopBitgetWs, getWsStatus } from './providers/bitget-ws.mjs'
import { startBitgetMcp, stopBitgetMcp, callMcpTool, listMcpTools, mcpStatus } from './providers/bitget-mcp.mjs'
import { getPositioning, getSpotBookDepth } from './providers/crossvenue.mjs'
import { getMarketIntelSnapshot } from './providers/marketintel.mjs'
import { getEarningsFor, getUpcomingEarnings, EQUITY_UNIVERSE as EARNINGS_UNIVERSE } from './providers/earnings.mjs'
import { makeNewsStore, FEEDS } from './providers/news.mjs'
import { liveEnhanceArtifact } from './live-enhance.mjs'
import { warmHistory, loadHistory, historyStatus, SUPPORTED as HISTORY_SUPPORTED } from './history.mjs'
import * as SignalHistory from './signal-history.mjs'
import { buildAuthorizeUrl, exchangeCodeForToken, isLiveEnabled, killSwitch, storeUserToken, submitLiveOrder } from './providers/bitget-trading.mjs'
import { publicKey as vapidPublicKey, deliverToAll as pushToAll, shouldPushForUser, sendPush as sendUserPush } from './lib/push.mjs'
import { analyzeNewsForUser, inferAsset } from '../src/domain.js'
import { loadSessionFor as loadUserSession, listUsers } from './lib/store.mjs'
import * as Alerts from './alerts.mjs'
import { shareReport, readSharedByToken } from './sharing.mjs'
import { analyzePortfolio, correlationToBtc } from './copilot.mjs'
import * as Playbooks from './playbooks.mjs'
import * as Allocations from './allocations.mjs'
import { paperSnapshot, resetPaperAccount, creditPnl, reserveForPosition, releaseAndCredit } from './paper.mjs'
import { chat as assayerChat } from './assayer.mjs'
import { buildLiveContext, liveUniverseStatus, getMacro } from './market-context.mjs'
import { mailerStatus } from './lib/mailer.mjs'
import { loadLatestBrief, loadBriefByDate, listBriefDates, _paths as nw02Paths } from './nightwatch02.mjs'
import { makeScheduler } from './nightwatch02-scheduler.mjs'
import { setSubscription, getSubscription, findByUnsubscribeToken, listActiveSubscribers } from './nightwatch02-subscriptions.mjs'

import { LocalNightwatchEngine, DEMO_UNIVERSE } from '../src/domain.js'
import { runBacktestFromCandles } from '../src/backtest.js'

/* -------------------------------------------------- config */

const PORT           = Number(process.env.PORT || 8787)
const HOST           = process.env.HOST || '0.0.0.0'
const BITGET_MCP_URL = process.env.BITGET_MCP_URL || ''
const CORS_ORIGIN    = process.env.CORS_ORIGIN || '*'
const NEWS_ENABLED   = process.env.NEWS_ENABLED !== '0'
const PRICES_TICK_MS = Number(process.env.PRICES_TICK_MS || 10_000)

/* -------------------------------------------------- boot */

fs.mkdirSync(paths.DATA_DIR, { recursive: true })

const engine   = new LocalNightwatchEngine()
const llm      = makeLlm()
const news     = makeNewsStore({ llm })
const newsBus  = makeSseBus('news')
const priceBus = makeSseBus('prices')

const rateResearch = makeRateLimiter({ windowMs: 60_000, max: Number(process.env.RATE_RESEARCH || 60), prefix: 'research' })
const rateAuth     = makeRateLimiter({ windowMs: 60_000, max: 20, prefix: 'auth' })
const rateGeneral  = makeRateLimiter({ windowMs: 60_000, max: 240, prefix: 'general' })

const metrics = {
  requests: 0,
  research_ok: 0,
  research_err: 0,
  llm_calls: 0,
  news_events: 0,
  price_ticks: 0,
  sse_clients: () => newsBus.size() + priceBus.size(),
  started: Date.now(),
}

if (NEWS_ENABLED) news.start()

// Bitget public WS — live tick + top-of-book updates for the 18-asset universe.
// Replaces the 10s REST poll whenever the socket has fresh data; REST is the
// cold-boot and reconnect fallback.
if (process.env.BITGET_WS_ENABLED !== '0') startBitgetWs()

// Bitget Signal MCP — connect to Bitget's hosted MCP sidecar so the research
// desk can delegate skills (technical-analysis, macro, sentiment, news) to
// first-party Bitget infrastructure instead of the local skill pack.
startBitgetMcp()

// History cache + auto-backtest of published Playbooks so Explore + detail views
// has real numbers on first render. Runs in the background so boot is fast.
;(async () => {
  try {
    const results = await warmHistory()
    logger.info({ results }, 'history cache warmed')
    // Auto-backtest every published playbook we have history for.
    let backtested = 0
    for (const p of Playbooks.listPlaybooks({ publishedOnly: true, limit: 500 })) {
      try { Playbooks.backtestPlaybook(p.id); backtested++ } catch { /* skip symbols without history */ }
    }
    logger.info({ backtested }, 'playbooks auto-backtested')
  } catch (err) { logger.warn({ err: err.message }, 'boot warm failed') }
})()

// Signal history evaluator
SignalHistory.startEvaluator()
// Alerts evaluator
Alerts.startEvaluator({ sendPush: sendUserPush })
// Alpha of the Day daily brief scheduler (02:00 UTC by default). The scheduler
// runs in-process, is timezone-aware, and catches up on boot if today's brief
// window has already passed and no brief file exists yet.
const nw02 = makeScheduler({ newsStore: news, engine })
nw02.start()

// Playbook runtime — evaluate published playbooks against live context every 60s
async function playbookCtx(asset) {
  const [tickers, positioning, intel, ind] = await Promise.all([
    getAllTickers().catch(() => null),
    getPositioning(asset).catch(() => null),
    getMarketIntelSnapshot(asset).catch(() => null),
    computeIndicators(asset).catch(() => null),
  ])
  const t = tickers?.[asset]
  const btc = tickers?.BTC
  return {
    price: t?.last ?? null,
    change24h: t?.changePct24h ?? null,
    btc24hChange: btc?.changePct24h ?? null,
    rsi14: ind?.rsi14 ?? null,
    ema20: ind?.ema20 ?? null,
    ema50: ind?.ema50 ?? null,
    fundingRate: positioning?.meanFundingRate ?? null,
    fundingSkewBps: positioning ? Number((positioning.fundingSkew * 10000).toFixed(2)) : null,
    fearGreed: intel?.fearGreed?.value ?? null,
    etfTrailing5UsdM: intel?.etfFlows?.trailing5UsdM ?? null,
    etfTrailing20UsdM: intel?.etfFlows?.trailing20UsdM ?? null,
    drawdownFromEntry: 0,
  }
}
const _pbEvalHandle = setInterval(async () => {
  try {
    for (const p of Playbooks.listPlaybooks({ publishedOnly: true, limit: 300 })) {
      await Playbooks.evaluatePlaybook(p.id, playbookCtx).catch(() => null)
    }
    await Playbooks.markPositions()
    Allocations.markAll()
  } catch (err) { logger.warn({ err: err.message }, 'playbook eval loop failed') }
}, Number(process.env.PLAYBOOK_EVAL_MS || 60_000))
_pbEvalHandle.unref?.()
news.subscribe(item => {
  metrics.news_events++
  newsBus.emit({ type: 'news', data: item })
  // Per-user push evaluation
  const users = listUsers()
  for (const userId in users) {
    const stored = loadUserSession(userId)
    const session = { ...stored, watchlist: stored.watchlist || [] }
    const analysis = analyzeNewsForUser({ ...item, analysis: undefined }, session)
    const enriched = { ...item, analysis }
    if (shouldPushForUser(enriched, session)) {
      import('./lib/push.mjs').then(m => m.sendPush(userId, {
        title: `NIGHTWATCH · ${item.severity} · ${item.category}`,
        body: item.headline,
        tag: `news-${item.id}`,
        url: `/#news/${item.id}`,
      })).catch(() => { /* fire and forget */ })
    }
  }
})

// Price tick loop → SSE. Prefer live WS cache; fall back to REST bulk-tickers
// when the socket is disconnected or hasn't populated yet. Loop stays at
// PRICES_TICK_MS so downstream SSE clients get a stable heartbeat even when
// ticks are flowing over WS.
setInterval(async () => {
  try {
    const tickers = await getAllTickersLive()
    if (!tickers) return
    metrics.price_ticks++
    priceBus.emit({ type: 'prices', data: { at: Date.now(), tickers } })
  } catch (err) {
    // An escaping rejection here would crash the whole process (Node ≥15 default).
    logger.warn({ err: err.message }, 'price tick failed')
  }
}, PRICES_TICK_MS).unref?.()

// Last-resort guards: a stray rejection from any fire-and-forget async path
// (push delivery, provider fetches, timers) must log, not kill the server.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason instanceof Error ? reason.message : String(reason) }, 'unhandled rejection')
})
process.on('uncaughtException', (err) => {
  logger.error({ err: err.message, stack: err.stack }, 'uncaught exception')
})

/* -------------------------------------------------- HTTP helpers */

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN)
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Expose-Headers', 'X-RateLimit-Remaining, X-RateLimit-Reset')
}
function json(res, status, body) { cors(res); res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
/** Minimal HTML escape for the tiny confirmation pages we render inline. */
function escapeHtmlLite(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
async function readJson(req, limitBytes = 512 * 1024) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > limitBytes) throw new Error('payload too large')
    chunks.push(c)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { throw new Error('invalid json') }
}
/** Parse a ?limit= query param: garbage/NaN falls back to the default, never NaN. */
function limitParam(raw, dflt, max) {
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) && n > 0 ? Math.min(max, n) : dflt
}
function keyFor(req) {
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) return 'jwt:' + auth.slice(7, 32)
  return req.socket.remoteAddress || 'anon'
}

/* -------------------------------------------------- narration rewrite for reports */

async function narrateReport(artifact, question) {
  if (!artifact?.report) return { artifact, engine: 'LOCAL' }
  const r = artifact.report
  // Deterministic short/long thesis fallback so the downloadable card always
  // has content even when the LLM is off or times out.
  const fallbackShort = r.signal?.catalyst
    ? `Near term: ${r.signal.catalyst} drives the ${(r.signal.direction || 'FLAT').toLowerCase()} setup at ${(r.signal.confidence * 100).toFixed(0)}% confidence.`
    : `Near term: ${(r.signal.direction || 'FLAT').toLowerCase()} bias at ${(r.signal.confidence * 100).toFixed(0)}% confidence, net edge ${(r.signal.netEdge * 100).toFixed(2)}%.`
  const fallbackLong = `Multi-week: watch macro regime and ${r.symbol} structural drivers; invalidate below the price and conditions listed in the invalidation section.`
  const nextBase = structuredClone(artifact)
  nextBase.report.thesis = nextBase.report.thesis || { short: fallbackShort, long: fallbackLong }

  if (!llm.enabled) return { artifact: nextBase, engine: 'LOCAL' }

  const prompt = `You are NIGHTWATCH AI, a professional trading research desk. Rewrite the summary and reasoning in crisp, professional trader English, and produce two distinct-horizon thesis lines. Do NOT change any numbers, tickers, verdicts, or invalidation prices. Return JSON:
{
  "summary": string,        // 2 sentences max, crisp desk voice
  "reasoning": string,      // 1 sentence, why the composite/edge came out this way
  "shortThesis": string,    // Near-term (hours to days): the immediate catalyst, tape read, and event risk. 1 sentence.
  "longThesis": string      // Multi-week to multi-month: the structural driver, macro fit, and what would invalidate the longer thesis. 1 sentence.
}

Question: ${question || ''}
Symbol: ${r.symbol}
Direction: ${r.signal.direction} · confidence ${(r.signal.confidence * 100).toFixed(0)}%
Net edge: ${(r.signal.netEdge * 100).toFixed(2)}%
Catalyst: ${r.signal.catalyst || ''}
Original summary: ${r.summary}
Original reasoning: ${r.signal.reason}
Invalidation price: ${r.invalidation?.price || 'n/a'}`
  metrics.llm_calls++
  const out = await llm.jsonComplete(prompt)
  if (!out) return { artifact: nextBase, engine: 'LOCAL' }
  const next = nextBase
  if (out.summary)      next.report.summary          = String(out.summary).slice(0, 800)
  if (out.reasoning)    next.report.signal.reason    = String(out.reasoning).slice(0, 500)
  if (out.shortThesis)  next.report.thesis.short     = String(out.shortThesis).slice(0, 400)
  if (out.longThesis)   next.report.thesis.long      = String(out.longThesis).slice(0, 400)
  return { artifact: next, engine: llm.provider.toUpperCase() }
}

/* -------------------------------------------------- Bitget MCP probe */

/**
 * Report the state of Bitget's hosted Signal MCP. The real MCP connection
 * lives in providers/bitget-mcp.mjs; this shape stays backwards-compatible
 * with the older /bitget/status consumers (connected/model/skills).
 */
function probeBitget() {
  const s = mcpStatus()
  return {
    connected: s.connected,
    model:     s.server || 'bitget-signal',
    version:   s.version || null,
    skills:    s.toolNames,
    reason:    s.connected
      ? `${s.tools} MCP tools reachable via ${s.server}`
      : s.lastError || (s.enabled ? 'connecting…' : 'MCP disabled'),
    url:       s.url,
  }
}

/* -------------------------------------------------- request handler */

const server = http.createServer(async (req, res) => {
  metrics.requests++
  const started = Date.now()
  cors(res)
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const url = new URL(req.url, 'http://x')
  const route = `${req.method} ${url.pathname}`

  try {
    // Health / metrics
    if (route === 'GET /health') {
      return json(res, 200, {
        ok: true,
        provider: { llm: llm.provider, model: llm.model, bitgetMcp: probeBitget(), bitgetWs: getWsStatus() },
        news: { enabled: NEWS_ENABLED, seen: news._items.length, feeds: FEEDS.length },
        universe: { total: DEMO_UNIVERSE.length, ...liveUniverseStatus() },
        mailer: mailerStatus(),
        nightwatch02: { ...nw02.status(), subscribers: listActiveSubscribers().length },
        uptimeSec: Math.round((Date.now() - metrics.started) / 1000),
      })
    }
    if (route === 'GET /metrics') {
      cors(res)
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' })
      const now = Math.round((Date.now() - metrics.started) / 1000)
      res.end(
        `# HELP nightwatch_requests_total total HTTP requests handled\n` +
        `# TYPE nightwatch_requests_total counter\nnightwatch_requests_total ${metrics.requests}\n` +
        `# HELP nightwatch_research_success_total research ok\n# TYPE nightwatch_research_success_total counter\nnightwatch_research_success_total ${metrics.research_ok}\n` +
        `# HELP nightwatch_research_error_total research error\n# TYPE nightwatch_research_error_total counter\nnightwatch_research_error_total ${metrics.research_err}\n` +
        `# HELP nightwatch_llm_calls_total total LLM calls\n# TYPE nightwatch_llm_calls_total counter\nnightwatch_llm_calls_total ${metrics.llm_calls}\n` +
        `# HELP nightwatch_news_events_total news items ingested and broadcast\n# TYPE nightwatch_news_events_total counter\nnightwatch_news_events_total ${metrics.news_events}\n` +
        `# HELP nightwatch_price_ticks_total price ticks broadcast\n# TYPE nightwatch_price_ticks_total counter\nnightwatch_price_ticks_total ${metrics.price_ticks}\n` +
        `# HELP nightwatch_sse_clients current SSE subscribers\n# TYPE nightwatch_sse_clients gauge\nnightwatch_sse_clients ${metrics.sse_clients()}\n` +
        `# HELP nightwatch_uptime_seconds process uptime\n# TYPE nightwatch_uptime_seconds gauge\nnightwatch_uptime_seconds ${now}\n`
      )
      return
    }
    if (route === 'GET /bitget/status') {
      if (!enforce(rateGeneral, req, res, () => {}, keyFor)) return
      return json(res, 200, probeBitget())
    }
    // MCP tool catalog + one-shot invocation. Judges can hit /mcp/tools to
    // see the actual tools exposed by Bitget's hosted signal MCP.
    if (route === 'GET /mcp/tools') {
      if (!enforce(rateGeneral, req, res, () => {}, keyFor)) return
      return json(res, 200, { ...mcpStatus(), tools: listMcpTools() })
    }
    if (route === 'POST /mcp/call') {
      if (!enforce(rateResearch, req, res, () => {}, keyFor)) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      if (!body?.name) return json(res, 400, { error: 'name required' })
      const out = await callMcpTool(String(body.name), body.arguments || {})
      return json(res, out.ok ? 200 : 502, out)
    }

    // Prices
    if (route === 'GET /prices/live') {
      if (!enforce(rateGeneral, req, res, () => {}, keyFor)) return
      const tickers = await getAllTickersLive()
      const ws = getWsStatus()
      return json(res, 200, {
        at: Date.now(),
        tickers: tickers || {},
        live: Boolean(tickers),
        stream: ws.connected ? 'bitget-public-ws' : 'bitget-public-rest',
        ws: { connected: ws.connected, ageMs: ws.ageMs, cachedPairs: ws.cachedPairs },
      })
    }
    if (route === 'GET /bitget/ws-status') {
      if (!enforce(rateGeneral, req, res, () => {}, keyFor)) return
      return json(res, 200, getWsStatus())
    }
    if (route === 'GET /prices/stream') {
      return priceBus.subscribe(res)
    }
    if (route.startsWith('GET /prices/indicators/')) {
      const symbol = url.pathname.split('/').pop().toUpperCase()
      let ind = await computeIndicators(symbol)
      // Fallback: when Bitget rate-limits the R-pair candles endpoint from a
      // shared cloud IP, serve indicators from the disk history cache which
      // was warmed at boot. This keeps the endpoint honest and useful even
      // during transient upstream throttling.
      if (!ind) {
        const h = loadHistory(symbol)
        if (h?.candles?.length >= 50) {
          const recent = h.candles.slice(-200)
          ind = await computeIndicators(symbol, recent)
          if (ind) ind.source = 'nightwatch-history-cache'
        }
      }
      if (!ind) return json(res, 404, { error: `no indicators for ${symbol}` })
      return json(res, 200, ind)
    }

    // News
    if (route === 'GET /news/live') {
      if (!enforce(rateGeneral, req, res, () => {}, keyFor)) return
      const limit = limitParam(url.searchParams.get('limit'), 60, 200)
      return json(res, 200, { items: news.list(limit), count: news._items.length, live: true })
    }
    if (route === 'GET /news/stream') {
      const close = newsBus.subscribe(res)
      // Also flush the latest handful of items so late subscribers see backlog.
      news.list(10).forEach(item => res.write(`event: news\ndata: ${JSON.stringify(item)}\n\n`))
      return close
    }
    if (route === 'POST /news/ingest') {
      // Manual force-poll trigger for tests + admin. Fans out to every RSS feed
      // — rate-limit so anonymous callers can't use us as an amplification proxy.
      if (!enforce(rateResearch, req, res, () => {}, keyFor)) return
      const added = await news.pollAll()
      return json(res, 200, { added, total: news._items.length })
    }

    // Research
    if (route === 'POST /research' || route === 'POST /desk') {
      if (!enforce(rateResearch, req, res, () => {}, keyFor)) return
      let request; try { request = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      try {
        // Live context: real tape + real wire news + real macro for EVERY intent.
        // The seeded engine only sees demo values when Bitget/Yahoo are unreachable.
        const assetHint = request.asset || inferAsset(request.question || request.thesis || '') || null
        const liveCtx = await buildLiveContext(news, assetHint).catch(err => { logger.warn({ err: err.message }, 'live context build failed'); return null })
        // Trim the client session before engine work: the server's own live
        // universe is authoritative, and shipping the full session (news feed,
        // reports, logs) through every skill call wastes memory.
        const clientCtx = request.context || {}
        const slimCtx = {
          memory: clientCtx.memory,
          session: clientCtx.session ? { watchlist: clientCtx.session.watchlist, positions: clientCtx.session.positions, universe: clientCtx.session.universe?.map(({ symbol, name, class: klass, sector, beta }) => ({ symbol, name, class: klass, sector, beta })) } : undefined,
        }
        const enriched = liveCtx
          ? { ...request, context: { ...slimCtx, universe: liveCtx.universe, macro: liveCtx.macro, btcChange24h: liveCtx.btcChange24h, news: liveCtx.news, newsBySymbol: liveCtx.newsBySymbol } }
          : { ...request, context: slimCtx }
        const artifact = await engine.run(enriched)
        // Live overlay — real cross-venue positioning + market intel + book depth
        const { artifact: withLive, live } = request.intent === 'research'
          ? await liveEnhanceArtifact(artifact, clientCtx.memory?.preferences)
          : { artifact, live: {} }
        const { artifact: rewritten, engine: engineName } = await narrateReport(withLive, request.question || request.thesis)
        const bitget = probeBitget()
        // Record the signal for the public history + accuracy ledger
        if (request.intent === 'research' && rewritten?.report?.signal?.status === 'SIGNAL') {
          try {
            SignalHistory.recordSignal({
              symbol:     rewritten.report.symbol,
              direction:  rewritten.report.signal.direction,
              confidence: rewritten.report.signal.confidence,
              netEdge:    rewritten.report.signal.netEdge,
              entryPrice: live?.ticker?.last ?? rewritten.report.suggestion?.entry,
              catalyst:   rewritten.report.signal.catalyst,
              reportId:   rewritten.report.id,
            })
          } catch (err) { logger.warn({ err: err.message }, 'record signal failed') }
        }
        metrics.research_ok++
        return json(res, 200, { intent: request.intent, engine: engineName, bitgetLive: bitget.connected, liveData: Boolean(live?.ticker || liveCtx?.live), artifact: rewritten })
      } catch (err) { metrics.research_err++; return json(res, 500, { error: err.message }) }
    }

    // Positioning + book depth endpoints
    if (route.startsWith('GET /positioning/')) {
      const symbol = url.pathname.split('/').pop().toUpperCase()
      const p = await getPositioning(symbol)
      if (!p) return json(res, 404, { error: `no positioning for ${symbol}` })
      return json(res, 200, p)
    }
    if (route.startsWith('GET /book/')) {
      const symbol = url.pathname.split('/').pop().toUpperCase()
      let b = await getSpotBookDepth(symbol)
      // Fallback: when Bitget rate-limits the per-symbol orderbook, derive
      // top-of-book from the bulk /tickers cache (different rate bucket, still
      // real data). Depth USD is null in this mode — the source stamp
      // 'bitget-ticker-only' tells the client it's a lightweight shape.
      if (!b) {
        const all = await getAllTickers().catch(() => null)
        const t = all?.[symbol]
        if (t?.bidPrice && t?.askPrice) {
          const spreadBps = ((t.askPrice - t.bidPrice) / t.askPrice) * 10000
          b = {
            symbol,
            bestBid: t.bidPrice, bestAsk: t.askPrice,
            spreadBps: Number(spreadBps.toFixed(2)),
            bidLiquidityUsd: null, askLiquidityUsd: null, depthImbalance: null,
            live: true, source: 'bitget-ticker-only', at: Date.now(),
          }
        }
      }
      if (!b) return json(res, 404, { error: `no book for ${symbol}` })
      return json(res, 200, b)
    }
    if (route.startsWith('GET /marketintel/')) {
      const symbol = url.pathname.split('/').pop().toUpperCase()
      const m = await getMarketIntelSnapshot(symbol)
      if (!m) return json(res, 404, { error: `no market intel for ${symbol}` })
      return json(res, 200, m)
    }
    if (route === 'GET /macro') {
      const m = await getMacro()
      if (!m) return json(res, 503, { error: 'macro snapshot unavailable (upstream unreachable)', live: false })
      return json(res, 200, m)
    }

    // US-equity earnings calendar — free Yahoo Finance quoteSummary, cached 12h.
    if (route === 'GET /earnings') {
      if (!enforce(rateGeneral, req, res, () => {}, keyFor)) return
      const limit = Math.min(20, Number(url.searchParams.get('limit') || 5))
      const rows = await getUpcomingEarnings({ limit }).catch(() => [])
      return json(res, 200, { rows, universe: EARNINGS_UNIVERSE, at: Date.now() })
    }
    if (route.startsWith('GET /earnings/')) {
      if (!enforce(rateGeneral, req, res, () => {}, keyFor)) return
      const symbol = url.pathname.split('/').pop().toUpperCase()
      const e = await getEarningsFor(symbol)
      if (!e) return json(res, 404, { error: `no earnings calendar for ${symbol}` })
      return json(res, 200, e)
    }

    // Analysis workbench — single call that bundles every Bitget-native primitive
    // (ticker, indicators, book depth, cross-venue positioning) with the macro
    // tape, symbol-filtered news, and a Qwen-authored synthesis. This is what
    // the Analysis tab renders.
    if (route.startsWith('GET /analysis/')) {
      if (!enforce(rateGeneral, req, res, () => {}, keyFor)) return
      const symbol = url.pathname.split('/').pop().toUpperCase()
      let [ticker, indicators, depth, positioning, intel, macro, earnings] = await Promise.all([
        getTicker(symbol).catch(() => null),
        computeIndicators(symbol).catch(() => null),
        getSpotBookDepth(symbol).catch(() => null),
        getPositioning(symbol).catch(() => null),
        getMarketIntelSnapshot(symbol).catch(() => null),
        getMacro().catch(() => null),
        // Earnings only meaningful for tokenized equities (Yahoo has no coverage for R-pairs directly;
        // we key off the underlying ticker which matches for NVDA/TSLA/AAPL etc.).
        EARNINGS_UNIVERSE.includes(symbol) ? getEarningsFor(symbol).catch(() => null) : Promise.resolve(null),
      ])
      // Rate-limit fallback: R-pair candles/orderbook get throttled from shared
      // cloud IPs. When indicators are missing, fall back to the disk history
      // cache warmed at boot so the workbench still renders real numbers.
      if (!indicators) {
        const h = loadHistory(symbol)
        if (h?.candles?.length >= 50) {
          indicators = await computeIndicators(symbol, h.candles.slice(-200)).catch(() => null)
          if (indicators) indicators.source = 'nightwatch-history-cache'
        }
      }
      // Book fallback: derive top-of-book from the bulk-tickers cache when
      // the per-symbol orderbook (and per-symbol ticker) got rate-limited.
      if (!depth) {
        const bulk = await getAllTickers().catch(() => null)
        const t = bulk?.[symbol] || ticker
        if (t?.bidPrice && t?.askPrice) {
          const spreadBps = ((t.askPrice - t.bidPrice) / t.askPrice) * 10000
          depth = {
            symbol,
            bestBid: t.bidPrice, bestAsk: t.askPrice,
            spreadBps: Number(spreadBps.toFixed(2)),
            bidLiquidityUsd: null, askLiquidityUsd: null, depthImbalance: null,
            live: true, source: 'bitget-ticker-only', at: Date.now(),
          }
        }
      }
      // Ticker fallback: fall back to the bulk-tickers cache too so the
      // workbench header always has a price to render.
      if (!ticker) {
        const bulk = await getAllTickers().catch(() => null)
        if (bulk?.[symbol]) ticker = bulk[symbol]
      }
      if (!ticker && !indicators) return json(res, 404, { error: `no live data for ${symbol}` })
      // Filter recent news to items that reference this symbol in their affectedAssets.
      const newsItems = news.list(80).filter(it =>
        (it.affectedAssets || []).some(a => a.symbol === symbol)
      ).slice(0, 8)
      // Ask Qwen for a 3-paragraph desk analysis. All facts stay grounded in the
      // real numbers above. LLM is optional — the client still renders every
      // fact panel if the synthesis field is null.
      let synthesis = null
      if (llm.enabled) {
        try {
          metrics.llm_calls++
          const facts = {
            symbol,
            price: ticker?.last, changePct24h: ticker?.changePct24h,
            spreadBps: depth?.spreadBps, depthImbalance: depth?.depthImbalance,
            bidLiquidityUsd: depth?.bidLiquidityUsd, askLiquidityUsd: depth?.askLiquidityUsd,
            rsi14: indicators?.rsi14, ema20: indicators?.ema20, ema50: indicators?.ema50,
            trend: indicators?.trend, support: indicators?.support, resistance: indicators?.resistance,
            atrPct: indicators?.atrPct, volumeZ: indicators?.volumeZ, change7d: indicators?.change7d,
            fundingRate: positioning?.meanFundingRate, openInterest: positioning?.openInterestUsd,
            fearGreed: intel?.fearGreed?.value, fearGreedClass: intel?.fearGreed?.classification,
            dxy: macro?.dxy?.last, vix: macro?.vix?.last, cryptoRegime: macro?.cryptoRegime, riskRegime: macro?.riskRegime,
            recentNews: newsItems.slice(0, 5).map(it => ({ headline: it.headline, source: it.source, severity: it.severity })),
          }
          const prompt = `You are NIGHTWATCH AI, a professional trading desk analyst. Given ONLY the JSON facts below about ${symbol}, produce a JSON response {"headline": string, "technical": string, "flow": string, "narrative": string, "verdict": "LONG"|"SHORT"|"SIT_OUT", "confidence": number 0..1, "entry": number|null, "stop": number|null, "target": number|null, "invalidation": string}. Keep each string one crisp sentence. Do not invent numbers not in the facts. Ground every claim in the facts.\n\nFACTS: ${JSON.stringify(facts)}`
          const out = await llm.jsonComplete(prompt)
          if (out && typeof out === 'object') synthesis = out
        } catch (err) { logger.warn({ err: err.message, symbol }, 'analysis synthesis failed') }
      }
      return json(res, 200, {
        symbol,
        at: Date.now(),
        ticker,
        indicators,
        depth,
        positioning,
        intel: intel ? { fearGreed: intel.fearGreed, etfFlows: intel.etfFlows } : null,
        macro: macro ? { dxy: macro.dxy, vix: macro.vix, cryptoRegime: macro.cryptoRegime, riskRegime: macro.riskRegime, live: macro.live } : null,
        earnings,
        news: newsItems,
        synthesis,
        engine: synthesis ? llm.provider.toUpperCase() : 'LOCAL',
      })
    }

    // Public signal history + accuracy scoreboard
    if (route === 'GET /signals/history') {
      const limit = limitParam(url.searchParams.get('limit'), 100, 500)
      return json(res, 200, { signals: SignalHistory.list(limit), stats: SignalHistory.stats() })
    }
    if (route === 'GET /signals/stats') {
      return json(res, 200, SignalHistory.stats())
    }

    // History cache: read a symbol's cached candles
    if (route === 'GET /history/status') {
      return json(res, 200, { supported: HISTORY_SUPPORTED, cache: historyStatus() })
    }
    if (route.startsWith('GET /history/')) {
      const symbol = url.pathname.split('/').pop().toUpperCase()
      const h = loadHistory(symbol)
      if (!h) return json(res, 404, { error: `no history for ${symbol}` })
      const limit = Math.min(h.candles.length, limitParam(url.searchParams.get('limit'), 2000, h.candles.length))
      return json(res, 200, { symbol: h.symbol, count: h.candles.length, updatedAt: h.updatedAt, candles: h.candles.slice(-limit) })
    }

    // Backtest against cached historical candles
    if (route === 'POST /backtest/live') {
      // CPU-heavy synchronous replay — keep anonymous callers from pinning the loop.
      if (!enforce(rateResearch, req, res, () => {}, keyFor)) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      const symbol = String(body.symbol || 'BTC').toUpperCase()
      const h = loadHistory(symbol)
      if (!h) return json(res, 404, { error: `no history for ${symbol}. Wait for warm-up or POST /history/warm` })
      const result = runBacktestFromCandles(symbol, h.candles, { step: body.step || 6, horizon: body.horizon || 8, minAbsForwardPct: body.minAbsForwardPct || 0.005 })
      return json(res, 200, { symbol, candleCount: h.candles.length, ...result })
    }
    if (route === 'POST /history/warm') {
      // Paginates every supported symbol against the public API — rate-limit.
      if (!enforce(rateResearch, req, res, () => {}, keyFor)) return
      const results = await warmHistory()
      return json(res, 200, { results, cache: historyStatus() })
    }

    // Bitget Agentic Account — Agent Hub OAuth authorize + callback for the
    // isolated agent-only sub-account. Route paths keep the historical
    // "/auth/oauth/bitget/*" shape because Bitget's redirect_uri and any
    // external clients are already pointing at it.
    if (route === 'GET /auth/oauth/bitget/start') {
      try {
        const stateTok = url.searchParams.get('state') || ''
        return json(res, 200, { authorizeUrl: buildAuthorizeUrl(stateTok), liveEnabled: isLiveEnabled() })
      } catch (err) { return json(res, 400, { error: err.message }) }
    }
    if (route === 'POST /auth/oauth/bitget/callback') {
      const user = requireAuth(req, res); if (!user) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      if (!body?.code) return json(res, 400, { error: 'code required' })
      try {
        const tok = await exchangeCodeForToken(body.code)
        storeUserToken(user.id, tok)
        return json(res, 200, { ok: true, connectedAt: new Date().toISOString(), scope: tok.scope })
      } catch (err) { return json(res, 400, { error: err.message }) }
    }
    if (route === 'GET /trading/status') {
      const user = requireAuth(req, res); if (!user) return
      return json(res, 200, {
        liveEnabled: isLiveEnabled(),
        connected: Boolean(user.bitget?.accessToken),
        connectedAt: user.bitget?.connectedAt || null,
        killedAt: user.bitget?.killedAt || null,
        scope: user.bitget?.scope || null,
      })
    }
    if (route === 'POST /trading/order') {
      const user = requireAuth(req, res); if (!user) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      if (!isLiveEnabled()) return json(res, 400, { error: 'Agentic Account routing disabled (paper only). Set BITGET_LIVE_ENABLED=1 and provision Agent Hub OAuth credentials.' })
      if (body?.confirm !== true) return json(res, 400, { error: 'explicit trader approve required (confirm: true)' })
      if (!body?.asset || !body?.direction || !body?.notional) return json(res, 400, { error: 'asset, direction, notional required' })
      try {
        const result = await submitLiveOrder(user.id, body)
        return json(res, 200, { ok: true, order: result, at: new Date().toISOString() })
      } catch (err) { return json(res, 500, { error: err.message }) }
    }
    if (route === 'POST /trading/kill') {
      const user = requireAuth(req, res); if (!user) return
      const result = await killSwitch(user.id)
      return json(res, 200, { ok: true, result, at: new Date().toISOString() })
    }

    // Web Push
    if (route === 'GET /vapid/public-key') {
      return json(res, 200, { publicKey: vapidPublicKey() })
    }
    if (route === 'POST /push/test') {
      const user = requireAuth(req, res); if (!user) return
      const result = await sendUserPush(user.id, { title: 'NIGHTWATCH test', body: 'Push delivery works. You will see this whenever a HIGH-relevance news item touches your book.', tag: 'nw-test' })
      return json(res, 200, result)
    }

    // Alerts
    if (route === 'GET /alerts') {
      const user = requireAuth(req, res); if (!user) return
      return json(res, 200, { alerts: Alerts.listAlerts(user.id) })
    }
    if (route === 'POST /alerts/parse') {
      const user = requireAuth(req, res); if (!user) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      const rule = await Alerts.parseAlert(body?.text || '', llm)
      if (!rule) return json(res, 400, { error: 'could not parse — try "Alert me when BTC drops below 70000"' })
      return json(res, 200, { rule })
    }
    if (route === 'POST /alerts') {
      const user = requireAuth(req, res); if (!user) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      let rule = body?.rule
      if (!rule && body?.text) rule = await Alerts.parseAlert(body.text, llm)
      if (!rule) return json(res, 400, { error: 'rule or parseable text required' })
      const alert = Alerts.createAlert(user.id, { text: body?.text || '', rule })
      return json(res, 200, { alert })
    }
    if (route.startsWith('DELETE /alerts/')) {
      const user = requireAuth(req, res); if (!user) return
      Alerts.deleteAlert(user.id, url.pathname.split('/').pop())
      return json(res, 200, { ok: true })
    }
    if (route.match(/^POST \/alerts\/[^/]+\/reset$/)) {
      const user = requireAuth(req, res); if (!user) return
      const id = url.pathname.split('/')[2]
      Alerts.resetAlert(user.id, id)
      return json(res, 200, { ok: true })
    }

    // Report sharing (public read-only via signed token)
    if (route === 'POST /share/report') {
      const user = requireAuth(req, res); if (!user) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      if (!body?.report?.id) return json(res, 400, { error: 'report required' })
      const { hash, token, expSeconds } = shareReport(body.report, { ownerUserId: user.id })
      const proto = req.headers['x-forwarded-proto'] || 'http'
      const host  = req.headers['x-forwarded-host'] || req.headers.host || `127.0.0.1:${PORT}`
      const shareUrl = `${proto}://${host}/share/report/${token}`
      return json(res, 200, { hash, token, url: shareUrl, expiresInSeconds: expSeconds })
    }
    if (route.startsWith('GET /share/report/')) {
      const token = url.pathname.split('/').slice(-1)[0]
      const record = readSharedByToken(token)
      if (!record) return json(res, 404, { error: 'share not found or expired' })
      return json(res, 200, { report: record.report, sharedAt: record.sharedAt, views: record.views })
    }

    // Portfolio Copilot
    if (route === 'POST /copilot/portfolio') {
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      const positions = Array.isArray(body?.positions) ? body.positions : []
      const nav = Number(body?.nav) || 25000
      return json(res, 200, analyzePortfolio(positions, { nav }))
    }
    if (route.startsWith('GET /copilot/correlation/')) {
      const symbol = url.pathname.split('/').pop().toUpperCase()
      const c = correlationToBtc(symbol)
      if (c == null) return json(res, 404, { error: `no correlation available for ${symbol} (need cached history for symbol + BTC)` })
      return json(res, 200, { symbol, corrToBtc: c })
    }

    // Paper account
    if (route === 'GET /paper') {
      const user = requireAuth(req, res); if (!user) return
      return json(res, 200, { user: { id: user.id, name: user.name, email: user.email }, paper: paperSnapshot(user.id) })
    }
    if (route === 'POST /paper/reset') {
      const user = requireAuth(req, res); if (!user) return
      const pa = resetPaperAccount(user.id)
      return json(res, 200, { ok: true, paper: pa })
    }
    if (route === 'POST /paper/credit') {
      const user = requireAuth(req, res); if (!user) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      try {
        const result = creditPnl(user.id, Number(body?.amountUsd), body?.sourceId)
        return json(res, 200, result)
      } catch (err) { return json(res, 400, { error: err.message }) }
    }
    // Reserve paper capital when the trader APPROVES a research report. This
    // debits `freeCapital` and increases `allocatedCapital` so the Portfolio
    // panel's PAPER CAPITAL / FREE / ALLOCATED strip correctly reflects the
    // open self-directed trade — not just Playbook allocations.
    if (route === 'POST /paper/reserve') {
      const user = requireAuth(req, res); if (!user) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      try {
        const result = reserveForPosition(user.id, body?.sourceId, Number(body?.amountUsd))
        return json(res, 200, result)
      } catch (err) { return json(res, 400, { error: err.message }) }
    }
    // Release + credit — called on CLOSE-AT-MARK. Returns reserved capital
    // to `freeCapital`, decrements `allocatedCapital`, and folds realized
    // P&L into `totalPnl`. Idempotent per sourceId. Backwards-compatible for
    // positions that were opened before /paper/reserve existed (no reservation
    // to return, just credits P&L).
    if (route === 'POST /paper/release') {
      const user = requireAuth(req, res); if (!user) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      try {
        const result = releaseAndCredit(user.id, body?.sourceId, Number(body?.amountUsd), Number(body?.realizedPnl))
        return json(res, 200, result)
      } catch (err) { return json(res, 400, { error: err.message }) }
    }

    // Playbooks
    if (route === 'GET /playbooks') {
      const limit = limitParam(url.searchParams.get('limit'), 50, 200)
      return json(res, 200, { playbooks: Playbooks.listPlaybooks({ publishedOnly: true, limit }) })
    }
    if (route === 'GET /playbooks/mine') {
      const user = requireAuth(req, res); if (!user) return
      const mine = Playbooks.listPlaybooks({ publishedOnly: false, limit: 200 }).filter(p => p.ownerUserId === user.id)
      const followed = Allocations.listAllocations(user.id).filter(a => !a.closedAt).map(a => ({ allocation: a, playbook: Playbooks.getPlaybook(a.playbookId) }))
      return json(res, 200, { created: mine, followed })
    }
    if (route.startsWith('GET /playbooks/')) {
      const id = url.pathname.split('/').pop()
      const p = Playbooks.getPlaybook(id)
      if (!p) return json(res, 404, { error: 'playbook not found' })
      const stats = Allocations.followerStats(id)
      return json(res, 200, { playbook: { ...p, ...stats } })
    }
    if (route === 'POST /playbooks') {
      const user = requireAuth(req, res); if (!user) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      try {
        const created = Playbooks.createPlaybook(user.id, { ownerName: user.name, ...body })
        return json(res, 200, { playbook: created })
      } catch (err) { return json(res, 400, { error: err.message }) }
    }
    if (route.match(/^PATCH \/playbooks\/[^/]+$/)) {
      const user = requireAuth(req, res); if (!user) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      try {
        const id = url.pathname.split('/').pop()
        return json(res, 200, { playbook: Playbooks.updatePlaybook(user.id, id, body) })
      } catch (err) { return json(res, 400, { error: err.message }) }
    }
    if (route.match(/^POST \/playbooks\/[^/]+\/publish$/)) {
      const user = requireAuth(req, res); if (!user) return
      let body = {}; try { body = await readJson(req) } catch { /* empty ok */ }
      try {
        const id = url.pathname.split('/')[2]
        const p = Playbooks.publishPlaybook(user.id, id, body.publish !== false)
        return json(res, 200, { playbook: p })
      } catch (err) { return json(res, 400, { error: err.message }) }
    }
    if (route.match(/^POST \/playbooks\/[^/]+\/backtest$/)) {
      const id = url.pathname.split('/')[2]
      try {
        const stats = Playbooks.backtestPlaybook(id)
        return json(res, 200, { backtest: stats })
      } catch (err) { return json(res, 400, { error: err.message }) }
    }
    if (route.match(/^POST \/playbooks\/[^/]+\/follow$/)) {
      const user = requireAuth(req, res); if (!user) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      const id = url.pathname.split('/')[2]
      try {
        const alloc = Allocations.follow(user.id, id, Number(body?.amountUsd) || 0)
        return json(res, 200, { allocation: alloc, paper: paperSnapshot(user.id) })
      } catch (err) { return json(res, 400, { error: err.message }) }
    }
    if (route.match(/^POST \/playbooks\/[^/]+\/unfollow$/)) {
      const user = requireAuth(req, res); if (!user) return
      const id = url.pathname.split('/')[2]
      try {
        const alloc = Allocations.unfollow(user.id, id)
        return json(res, 200, { allocation: alloc, paper: paperSnapshot(user.id) })
      } catch (err) { return json(res, 400, { error: err.message }) }
    }
    if (route.match(/^DELETE \/playbooks\/[^/]+$/)) {
      const user = requireAuth(req, res); if (!user) return
      const id = url.pathname.split('/').pop()
      try { Playbooks.deletePlaybook(user.id, id); return json(res, 200, { ok: true }) }
      catch (err) { return json(res, 400, { error: err.message }) }
    }

    // The Assayer chat
    if (route === 'POST /assayer/chat') {
      // Unauthenticated LLM calls — rate-limit or anyone can burn the API budget.
      if (!enforce(rateResearch, req, res, () => {}, keyFor)) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      const reply = await assayerChat({ messages: Array.isArray(body?.messages) ? body.messages.slice(-16) : [], llm })
      return json(res, 200, reply)
    }

    // Auth — passwordless email sign-in (like getagent.studio)
    // Step 1: user enters email, we send a 6-digit code.
    // Step 2: user enters the code, we return a JWT. First-time users are
    // created transparently on successful verification.
    if (route === 'POST /auth/request-code') {
      if (!enforce(rateAuth, req, res, () => {}, keyFor)) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      try {
        const out = await requestSignInCode({ email: body?.email })
        return json(res, 200, out)
      } catch (err) { return json(res, 400, { error: err.message }) }
    }
    if (route === 'POST /auth/verify-code') {
      if (!enforce(rateAuth, req, res, () => {}, keyFor)) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      try {
        const out = await verifySignInCode({ email: body?.email, code: body?.code, name: body?.name })
        return json(res, 200, out)
      } catch (err) { return json(res, 401, { error: err.message }) }
    }
    // Legacy password auth — kept temporarily for accounts already provisioned
    // this way. New sign-ins go through /auth/request-code + /auth/verify-code.
    if (route === 'POST /auth/signup') {
      if (!enforce(rateAuth, req, res, () => {}, keyFor)) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      try {
        const out = await signup({ email: body?.email, password: body?.password, name: body?.name })
        return json(res, 200, out)
      } catch (err) { return json(res, 400, { error: err.message }) }
    }
    if (route === 'POST /auth/login') {
      if (!enforce(rateAuth, req, res, () => {}, keyFor)) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      try {
        const out = await login({ email: body?.email, password: body?.password })
        return json(res, 200, out)
      } catch (err) { return json(res, 401, { error: err.message }) }
    }
    // Legacy dev-login — DEV ONLY. Off in production unless explicitly opted in.
    if (route === 'POST /auth/dev-login') {
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_LOGIN !== '1') {
        return json(res, 403, { error: 'dev login disabled; use /auth/signup or /auth/login' })
      }
      if (!enforce(rateAuth, req, res, () => {}, keyFor)) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      try {
        const { user, token } = devLogin({ email: body.email, name: body.name })
        return json(res, 200, { user, token })
      } catch (err) { return json(res, 400, { error: err.message }) }
    }

    // Session
    if (route === 'GET /session') {
      const user = requireAuth(req, res); if (!user) return
      return json(res, 200, { user: publicUser(user), session: loadSessionFor(user.id) })
    }
    if (route === 'PATCH /session') {
      const user = requireAuth(req, res); if (!user) return
      let patch; try { patch = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      return json(res, 200, { user: publicUser(user), session: patchSessionFor(user.id, patch) })
    }

    // Web Push subscription (endpoint stored; delivery in DEPLOYMENT.md)
    if (route === 'POST /push/subscribe') {
      const user = requireAuth(req, res); if (!user) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      if (!body?.endpoint) return json(res, 400, { error: 'endpoint required' })
      savePushSubscription(user.id, body)
      return json(res, 200, { ok: true })
    }

    // Alpha of the Day — daily tokenized-stock brief + subscriptions
    if (route === 'GET /nightwatch/latest') {
      if (!enforce(rateGeneral, req, res, () => {}, keyFor)) return
      const brief = loadLatestBrief()
      if (!brief) return json(res, 404, { error: 'no brief published yet — the first one is generated at 02:00 UTC' })
      return json(res, 200, brief)
    }
    if (route === 'GET /nightwatch/list') {
      if (!enforce(rateGeneral, req, res, () => {}, keyFor)) return
      const limit = limitParam(url.searchParams.get('limit'), 14, 60)
      return json(res, 200, { dates: listBriefDates(limit) })
    }
    if (route === 'GET /nightwatch/status') {
      // Public, cheap — surfaces schedule + mailer state so the UI can show
      // "next brief at 02:00 UTC" and warn when email delivery isn't wired.
      return json(res, 200, { scheduler: nw02.status(), mailer: mailerStatus() })
    }
    if (route === 'GET /nightwatch/subscription') {
      const user = requireAuth(req, res); if (!user) return
      const sub = getSubscription(user.email)
      return json(res, 200, {
        email: user.email,
        enabled: Boolean(sub?.enabled),
        subscribedAt: sub?.createdAt || null,
        updatedAt: sub?.updatedAt || null,
        mailerReady: mailerStatus().canDeliver,
      })
    }
    if (route === 'POST /nightwatch/subscription') {
      const user = requireAuth(req, res); if (!user) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      // The user's account email is the source of truth. If the client hands
      // us a different address we refuse — subscriptions are keyed to the
      // signed-in identity, otherwise anyone could subscribe strangers.
      const targetEmail = String(body?.email || user.email).toLowerCase().trim()
      if (targetEmail !== user.email.toLowerCase()) {
        return json(res, 400, { error: 'subscription email must match the signed-in account email' })
      }
      try {
        const sub = setSubscription({ email: user.email, enabled: body?.enabled !== false, userId: user.id, source: 'ui' })
        return json(res, 200, {
          email: sub.email, enabled: sub.enabled, updatedAt: sub.updatedAt,
          mailerReady: mailerStatus().canDeliver,
        })
      } catch (err) { return json(res, 400, { error: err.message }) }
    }
    // One-click unsubscribe from an email link. GET-only so it works from any
    // mail client; returns a tiny confirmation page rather than JSON.
    if (route.startsWith('GET /nightwatch/unsubscribe/')) {
      const token = url.pathname.split('/').pop()
      const sub = findByUnsubscribeToken(token)
      cors(res); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      if (!sub) {
        res.end('<html><body style="font-family:sans-serif;padding:32px;background:#0e0f11;color:#e6e6e6"><h1>Unsubscribe link expired</h1><p>Please toggle "Daily email" off from the Alpha of the Day page in the app.</p></body></html>')
        return
      }
      setSubscription({ email: sub.email, enabled: false, userId: sub.userId, source: 'email-unsubscribe' })
      res.end(`<html><body style="font-family:sans-serif;padding:32px;background:#0e0f11;color:#e6e6e6"><h1>Unsubscribed</h1><p><b>${escapeHtmlLite(sub.email)}</b> will no longer receive the daily Alpha of the Day brief (02:00 UTC). You can turn it back on any time from the Alpha of the Day page.</p></body></html>`)
      return
    }
    // Admin/dev trigger. In production, require ADMIN_TOKEN header; in dev,
    // any authenticated user can fire it so the demo doesn't need to wait
    // until 02:00 UTC.
    if (route === 'POST /nightwatch/run') {
      const isProd = process.env.NODE_ENV === 'production'
      const adminToken = process.env.ADMIN_TOKEN
      if (isProd) {
        if (!adminToken || req.headers['x-admin-token'] !== adminToken) return json(res, 403, { error: 'admin token required' })
      } else {
        const user = requireAuth(req, res); if (!user) return
      }
      if (!enforce(rateResearch, req, res, () => {}, keyFor)) return
      const result = await nw02.runNow()
      if (!result) return json(res, 409, { error: 'a run is already in progress' })
      return json(res, 200, result)
    }
    // Date-parametrized fetch — narrower routes above win first.
    if (route.startsWith('GET /nightwatch/')) {
      if (!enforce(rateGeneral, req, res, () => {}, keyFor)) return
      const key = url.pathname.split('/').pop()
      const brief = loadBriefByDate(key)
      if (!brief) return json(res, 404, { error: `no brief for ${key}` })
      return json(res, 200, brief)
    }

    // Client-side crash telemetry (see src/ui/ErrorBoundary.jsx). Fire-and-forget
    // from the browser; logged server-side, hard-capped and rate-limited.
    if (route === 'POST /errors') {
      if (!enforce(rateGeneral, req, res, () => {}, keyFor)) return
      let body; try { body = await readJson(req, 16 * 1024) } catch { return json(res, 400, { error: 'invalid json' }) }
      logger.error({
        message: String(body?.message || '').slice(0, 500),
        stack: String(body?.stack || '').slice(0, 4000),
        componentStack: String(body?.componentStack || '').slice(0, 2000),
        url: String(body?.url || '').slice(0, 300),
        clientAt: body?.at,
      }, 'client error boundary')
      return json(res, 200, { ok: true })
    }

    return json(res, 404, { error: 'not found', route })
  } catch (err) {
    logger.error({ err: err.message, route }, 'unhandled error')
    return json(res, 500, { error: err.message })
  } finally {
    logger.debug({ route, ms: Date.now() - started, status: res.statusCode }, 'request')
  }
})

server.listen(PORT, HOST, () => {
  logger.info({
    port: PORT, host: HOST,
    llm: llm.provider, model: llm.model,
    bitgetMcp: BITGET_MCP_URL || null,
    news: NEWS_ENABLED, dataDir: paths.DATA_DIR,
  }, `NIGHTWATCH AI adapter online`)
})

process.on('SIGTERM', () => { logger.info('shutting down'); news.stop(); stopBitgetWs(); stopBitgetMcp(); server.close(() => process.exit(0)) })
process.on('SIGINT',  () => { logger.info('shutting down'); news.stop(); stopBitgetWs(); stopBitgetMcp(); server.close(() => process.exit(0)) })
