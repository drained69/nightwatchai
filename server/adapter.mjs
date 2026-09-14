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
import { requireAuth, devLogin } from './lib/auth.mjs'
import { loadSessionFor, patchSessionFor, savePushSubscription, paths } from './lib/store.mjs'
import { getAllTickers, getTicker, computeIndicators } from './providers/bitget.mjs'
import { getPositioning, getSpotBookDepth } from './providers/crossvenue.mjs'
import { getMarketIntelSnapshot } from './providers/marketintel.mjs'
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
import { leaderboard as playbookLeaderboard } from './leaderboard.mjs'
import { paperSnapshot, resetPaperAccount } from './paper.mjs'
import { chat as assayerChat } from './assayer.mjs'
import { buildLiveContext, liveUniverseStatus, getMacro } from './market-context.mjs'

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

// History cache + auto-backtest of published Playbooks so the Leaderboard
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

// Price tick loop → SSE.
setInterval(async () => {
  const tickers = await getAllTickers()
  if (!tickers) return
  metrics.price_ticks++
  priceBus.emit({ type: 'prices', data: { at: Date.now(), tickers } })
}, PRICES_TICK_MS).unref?.()

/* -------------------------------------------------- HTTP helpers */

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN)
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Expose-Headers', 'X-RateLimit-Remaining, X-RateLimit-Reset')
}
function json(res, status, body) { cors(res); res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
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
function keyFor(req) {
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) return 'jwt:' + auth.slice(7, 32)
  return req.socket.remoteAddress || 'anon'
}

/* -------------------------------------------------- narration rewrite for reports */

async function narrateReport(artifact, question) {
  if (!artifact?.report || !llm.enabled) return { artifact, engine: 'LOCAL' }
  const r = artifact.report
  const prompt = `You are NIGHTWATCH AI, a professional trading research desk. Rewrite these fields in crisp, professional trader English. Do NOT change any numbers, tickers, verdicts, or invalidation prices. Return JSON: {"summary": string, "reasoning": string}.

Question: ${question || ''}
Symbol: ${r.symbol}
Direction: ${r.signal.direction} · confidence ${(r.signal.confidence * 100).toFixed(0)}%
Net edge: ${(r.signal.netEdge * 100).toFixed(2)}%
Original summary: ${r.summary}
Original reasoning: ${r.signal.reason}`
  metrics.llm_calls++
  const out = await llm.jsonComplete(prompt)
  if (!out) return { artifact, engine: 'LOCAL' }
  const next = structuredClone(artifact)
  if (out.summary)   next.report.summary       = String(out.summary).slice(0, 800)
  if (out.reasoning) next.report.signal.reason = String(out.reasoning).slice(0, 500)
  return { artifact: next, engine: llm.provider.toUpperCase() }
}

/* -------------------------------------------------- Bitget MCP probe */

async function probeBitget() {
  if (!BITGET_MCP_URL) {
    return { connected: false, model: null, skills: [], reason: 'BITGET_MCP_URL not set — using local skill pack + Bitget public prices.' }
  }
  try {
    const res = await fetch(`${BITGET_MCP_URL.replace(/\/$/, '')}/skills`, { signal: AbortSignal.timeout(2500) })
    if (!res.ok) return { connected: false, model: null, skills: [], reason: `MCP returned ${res.status}` }
    const body = await res.json()
    const skills = Array.isArray(body?.skills) ? body.skills.map(s => s.id || s.name) : []
    return { connected: true, model: body?.provider || 'bitget-signal', skills, reason: `${skills.length} bitget-signal skills reachable` }
  } catch (err) { return { connected: false, model: null, skills: [], reason: err.message } }
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
        provider: { llm: llm.provider, model: llm.model, bitgetMcp: Boolean(BITGET_MCP_URL) },
        news: { enabled: NEWS_ENABLED, seen: news._items.length, feeds: FEEDS.length },
        universe: { total: DEMO_UNIVERSE.length, ...liveUniverseStatus() },
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
      return json(res, 200, await probeBitget())
    }

    // Prices
    if (route === 'GET /prices/live') {
      if (!enforce(rateGeneral, req, res, () => {}, keyFor)) return
      const tickers = await getAllTickers()
      return json(res, 200, { at: Date.now(), tickers: tickers || {}, live: Boolean(tickers) })
    }
    if (route === 'GET /prices/stream') {
      return priceBus.subscribe(res)
    }
    if (route.startsWith('GET /prices/indicators/')) {
      const symbol = url.pathname.split('/').pop().toUpperCase()
      const ind = await computeIndicators(symbol)
      if (!ind) return json(res, 404, { error: `no indicators for ${symbol}` })
      return json(res, 200, ind)
    }

    // News
    if (route === 'GET /news/live') {
      if (!enforce(rateGeneral, req, res, () => {}, keyFor)) return
      const limit = Math.min(200, Number(url.searchParams.get('limit') || 60))
      return json(res, 200, { items: news.list(limit), count: news._items.length, live: true })
    }
    if (route === 'GET /news/stream') {
      const close = newsBus.subscribe(res)
      // Also flush the latest handful of items so late subscribers see backlog.
      news.list(10).forEach(item => res.write(`event: news\ndata: ${JSON.stringify(item)}\n\n`))
      return close
    }
    if (route === 'POST /news/ingest') {
      // Manual force-poll trigger for tests + admin.
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
          ? await liveEnhanceArtifact(artifact)
          : { artifact, live: {} }
        const { artifact: rewritten, engine: engineName } = await narrateReport(withLive, request.question || request.thesis)
        const bitget = await probeBitget()
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
      const b = await getSpotBookDepth(symbol)
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

    // Public signal history + accuracy scoreboard
    if (route === 'GET /signals/history') {
      const limit = Math.min(500, Number(url.searchParams.get('limit') || 100))
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
      const limit = Math.min(h.candles.length, Number(url.searchParams.get('limit') || 2000))
      return json(res, 200, { symbol: h.symbol, count: h.candles.length, updatedAt: h.updatedAt, candles: h.candles.slice(-limit) })
    }

    // Backtest against cached historical candles
    if (route === 'POST /backtest/live') {
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      const symbol = String(body.symbol || 'BTC').toUpperCase()
      const h = loadHistory(symbol)
      if (!h) return json(res, 404, { error: `no history for ${symbol}. Wait for warm-up or POST /history/warm` })
      const result = runBacktestFromCandles(symbol, h.candles, { step: body.step || 6, horizon: body.horizon || 8, minAbsForwardPct: body.minAbsForwardPct || 0.005 })
      return json(res, 200, { symbol, candleCount: h.candles.length, ...result })
    }
    if (route === 'POST /history/warm') {
      const results = await warmHistory()
      return json(res, 200, { results, cache: historyStatus() })
    }

    // Bitget OAuth for live agent-account trading
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
      if (!isLiveEnabled()) return json(res, 400, { error: 'live trading disabled (paper only). Set BITGET_LIVE_ENABLED=1 and OAuth credentials.' })
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

    // Playbooks
    if (route === 'GET /playbooks') {
      const limit = Math.min(200, Number(url.searchParams.get('limit') || 50))
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

    // Leaderboard
    if (route === 'GET /leaderboard') {
      const sort = url.searchParams.get('sort') || 'return'
      const limit = Math.min(100, Number(url.searchParams.get('limit') || 25))
      return json(res, 200, { rows: playbookLeaderboard({ sort, limit }) })
    }

    // The Assayer chat
    if (route === 'POST /assayer/chat') {
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      const reply = await assayerChat({ messages: Array.isArray(body?.messages) ? body.messages.slice(-16) : [], llm })
      return json(res, 200, reply)
    }

    // Auth
    if (route === 'POST /auth/dev-login') {
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_LOGIN !== '1') {
        return json(res, 403, { error: 'dev login disabled in production; set ALLOW_DEV_LOGIN=1 to override' })
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
      return json(res, 200, { user, session: loadSessionFor(user.id) })
    }
    if (route === 'PATCH /session') {
      const user = requireAuth(req, res); if (!user) return
      let patch; try { patch = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      return json(res, 200, { user, session: patchSessionFor(user.id, patch) })
    }

    // Web Push subscription (endpoint stored; delivery in DEPLOYMENT.md)
    if (route === 'POST /push/subscribe') {
      const user = requireAuth(req, res); if (!user) return
      let body; try { body = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
      if (!body?.endpoint) return json(res, 400, { error: 'endpoint required' })
      savePushSubscription(user.id, body)
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

process.on('SIGTERM', () => { logger.info('shutting down'); news.stop(); server.close(() => process.exit(0)) })
process.on('SIGINT',  () => { logger.info('shutting down'); news.stop(); server.close(() => process.exit(0)) })
