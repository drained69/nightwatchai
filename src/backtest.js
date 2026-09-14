/**
 * NIGHTWATCH AI · backtesting engine.
 *
 * Replays a series of historical candles through the same `synthesizeSignal`
 * used in production and measures precision/recall vs realized forward returns.
 *
 * Two modes:
 *   - `runBacktestSynthetic(symbol, opts)` — deterministic synthetic price
 *     walk (works everywhere, no network). Useful for CI and demos.
 *   - `runBacktestFromCandles(symbol, candles, opts)` — pass real candles from
 *     Bitget (or any provider) and get real precision/recall.
 *
 * The point of a backtester in this product is *not* to prove profitability.
 * It's to give the trader evidence that the signal pipeline discriminates —
 * i.e. LONG-signalled bars have a higher forward mean return than random.
 */

import { DEMO_UNIVERSE, runSkillPack, synthesizeSignal } from './domain.js'

/** Simple deterministic price walk with drift + occasional shock. */
export function syntheticCandles(seed = 'BTC', n = 300, start = 100) {
  const rnd = mulberry(hash(seed))
  const out = []
  let last = start
  for (let i = 0; i < n; i++) {
    const drift = 0.0005 * Math.sin(i / 20)
    const shock = rnd() < 0.02 ? (rnd() - 0.5) * 0.06 : 0
    const noise = (rnd() - 0.5) * 0.015
    const change = drift + shock + noise
    const open = last
    const close = last * (1 + change)
    const high = Math.max(open, close) * (1 + Math.abs(noise) * 0.5)
    const low  = Math.min(open, close) * (1 - Math.abs(noise) * 0.5)
    out.push({ ts: Date.now() - (n - i) * 3600_000, open, high, low, close, volume: 1_000_000 * (0.5 + rnd()) })
    last = close
  }
  return out
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return Math.abs(h) }
function mulberry(a) { return () => { let t = (a += 0x6D2B79F5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

/** Compute a rough per-bar market context from a candle window. */
function contextFromCandles(candles, i, base) {
  const window = candles.slice(Math.max(0, i - 24), i + 1)
  const last = window[window.length - 1].close
  const prev24 = window[0]?.close ?? last
  const change24h = ((last - prev24) / prev24) * 100
  const rolling7 = candles.slice(Math.max(0, i - 168), i + 1)
  const change7d = rolling7.length > 1 ? ((last - rolling7[0].close) / rolling7[0].close) * 100 : 0
  const atr = window.reduce((s, c) => s + (c.high - c.low), 0) / window.length
  // Real per-bar indicator set (computed only from candles ≤ i — no lookahead).
  const long = candles.slice(Math.max(0, i - 199), i + 1)
  const closes = long.map(c => c.close)
  const emaOf = (period) => {
    if (closes.length < period) return null
    const k = 2 / (period + 1)
    let e = closes.slice(0, period).reduce((s, x) => s + x, 0) / period
    for (let j = period; j < closes.length; j++) e = closes[j] * k + e * (1 - k)
    return e
  }
  const rsiOf = (period = 14) => {
    if (closes.length < period + 1) return null
    let gains = 0, losses = 0
    for (let j = closes.length - period; j < closes.length; j++) {
      const d = closes[j] - closes[j - 1]
      if (d >= 0) gains += d; else losses -= d
    }
    if (losses === 0) return 100
    return 100 - 100 / (1 + gains / losses)
  }
  const ema20 = emaOf(20), ema50 = emaOf(50), rsi14 = rsiOf(14)
  const swing = candles.slice(Math.max(0, i - 47), i + 1)
  const volumes = long.map(c => c.volume || 0)
  let volumeZ = null
  if (volumes.length >= 48) {
    const recent = volumes.slice(-24), prior = volumes.slice(0, -24)
    const m = prior.reduce((s, x) => s + x, 0) / prior.length
    const sd = Math.sqrt(prior.reduce((s, x) => s + (x - m) ** 2, 0) / prior.length)
    if (sd > 0) volumeZ = Number((((recent.reduce((s, x) => s + x, 0) / recent.length) - m) / sd).toFixed(2))
  }
  const atrPct = (atr / last) * 100
  return {
    ...base,
    price: last,
    change24h,
    change7d,
    atrPct,
    spreadBps: base.spreadBps ?? null,
    volatility: (atr / last) > 0.03 ? 'HIGH' : (atr / last) > 0.015 ? 'MED' : 'LOW',
    momentum: change24h > 1.5 ? 'HIGH' : change24h < -1.5 ? 'LOW' : 'MED',
    live: true,                                   // indicators below are real, computed from the candle series
    indicators: (ema20 != null && rsi14 != null) ? {
      live: true,
      last,
      ema20: Number(ema20.toFixed(4)),
      ema50: ema50 != null ? Number(ema50.toFixed(4)) : null,
      rsi14: Number(rsi14.toFixed(1)),
      atrPct: Number(atrPct.toFixed(2)),
      trend: ema50 != null ? (last > ema20 && ema20 > ema50 ? 'UP' : last < ema20 && ema20 < ema50 ? 'DOWN' : 'SIDE') : (last > ema20 ? 'UP' : 'DOWN'),
      macdCross: ema50 != null ? (ema20 > ema50 ? 'BULL' : 'BEAR') : 'BULL',
      support: Number(Math.min(...swing.map(c => c.low)).toFixed(4)),
      resistance: Number(Math.max(...swing.map(c => c.high)).toFixed(4)),
      change7d: change7d / 100,
      volumeZ,
      candleCount: long.length,
    } : undefined,
  }
}

/**
 * Run backtest. Emits a signal every `step` bars, evaluates realized forward
 * return over `horizon` bars, and aggregates precision/recall by direction.
 */
export function runBacktestFromCandles(symbol, candles, { step = 6, horizon = 8, minAbsForwardPct = 0.005 } = {}) {
  const base = DEMO_UNIVERSE.find(a => a.symbol === symbol) || DEMO_UNIVERSE[0]
  const rows = []
  for (let i = 30; i < candles.length - horizon; i += step) {
    const market = contextFromCandles(candles, i, base)
    const skills = runSkillPack(symbol, market)
    const signal = synthesizeSignal(symbol, market, skills)
    const priceNow = candles[i].close
    const priceFuture = candles[i + horizon].close
    const forwardReturn = (priceFuture - priceNow) / priceNow
    rows.push({
      ts: candles[i].ts,
      priceNow, priceFuture,
      direction: signal.direction,
      status: signal.status,
      confidence: signal.confidence,
      composite: signal.composite,
      netEdge: signal.netEdge,
      forwardReturn,
    })
  }
  return { symbol, rows, stats: aggregate(rows, minAbsForwardPct) }
}

export function runBacktestSynthetic(symbol = 'BTC', opts = {}) {
  const candles = syntheticCandles(symbol, opts.n || 300)
  return runBacktestFromCandles(symbol, candles, opts)
}

/* ------------------------------------------------- Playbook condition replay */

/** Fields a candle series can honestly reconstruct per bar. */
const DERIVABLE_FIELDS = new Set(['price', 'change24h', 'change7d', 'rsi14', 'ema20', 'ema50', 'atrPct', 'drawdownFromEntry', 'btc24hChange'])

/** Which condition fields cannot be replayed from candles (live-only feeds). */
export function nonBacktestableFields(playbook) {
  const fields = [...(playbook.signalConditions || []), ...(playbook.exitConditions || [])].map(c => c.field)
  return [...new Set(fields.filter(f => !DERIVABLE_FIELDS.has(f)))]
}

function meets(op, a, b) {
  if (a == null) return false
  switch (op) { case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b; case '==': return a == b; case '!=': return a != b; default: return false }
}
function evalConds(conds, ctx) { return conds.length > 0 && conds.every(c => meets(c.op, ctx[c.field], c.value)) }

/** Incremental indicator series over a candle array (no lookahead: bar i uses only ≤ i). */
function indicatorSeries(candles) {
  const n = candles.length
  const out = new Array(n)
  const closes = candles.map(c => c.close)
  let ema20 = null, ema50 = null
  const k20 = 2 / 21, k50 = 2 / 51
  for (let i = 0; i < n; i++) {
    const c = closes[i]
    if (i === 19) ema20 = closes.slice(0, 20).reduce((s, x) => s + x, 0) / 20
    else if (i > 19) ema20 = c * k20 + ema20 * (1 - k20)
    if (i === 49) ema50 = closes.slice(0, 50).reduce((s, x) => s + x, 0) / 50
    else if (i > 49) ema50 = c * k50 + ema50 * (1 - k50)
    let rsi14 = null
    if (i >= 14) {
      let g = 0, l = 0
      for (let j = i - 13; j <= i; j++) { const d = closes[j] - closes[j - 1]; if (d >= 0) g += d; else l -= d }
      rsi14 = l === 0 ? 100 : 100 - 100 / (1 + g / l)
    }
    let atrPct = null
    if (i >= 24) {
      let s = 0
      for (let j = i - 23; j <= i; j++) s += (candles[j].high - candles[j].low) / closes[j]
      atrPct = (s / 24) * 100
    }
    out[i] = {
      price: c,
      change24h: i >= 24 ? ((c - closes[i - 24]) / closes[i - 24]) * 100 : null,
      change7d: i >= 168 ? ((c - closes[i - 168]) / closes[i - 168]) * 100 : null,
      rsi14, ema20, ema50, atrPct,
    }
  }
  return out
}

/**
 * Replay a Playbook's OWN signal/exit conditions over real candles.
 * Entry when every signalCondition matches; exit when every exitCondition
 * matches (same semantics as the live evaluator) or after maxHoldBars.
 * btc24hChange is reconstructed from a BTC candle series aligned by timestamp
 * when provided. Returns an honest stats object; `backtestable: false` when
 * conditions reference live-only fields (funding, Fear&Greed, ETF flows).
 */
export function runPlaybookBacktest(playbook, candles, { btcCandles = null, maxHoldBars = 168 } = {}) {
  const missing = nonBacktestableFields(playbook)
  if (missing.length) {
    return { mode: 'conditions', backtestable: false, missing, tradeCount: 0, totalReturnPct: null, winRate: null, longAccuracy: null, shortAccuracy: null, precisionOnMove: null, lift: null }
  }
  if (!candles || candles.length < 220) {
    return { mode: 'conditions', backtestable: false, missing: ['insufficient-candles'], tradeCount: 0, totalReturnPct: null, winRate: null, longAccuracy: null, shortAccuracy: null, precisionOnMove: null, lift: null }
  }
  const series = indicatorSeries(candles)
  const btcByTs = btcCandles ? new Map(btcCandles.map(c => [c.ts, c.close])) : null
  const dir = playbook.direction === 'SHORT' ? -1 : 1

  const ctxAt = (i) => {
    const s = series[i]
    const ctx = { ...s }
    if (btcByTs) {
      const now = btcByTs.get(candles[i].ts)
      const prev = btcByTs.get(candles[i - 24]?.ts)
      ctx.btc24hChange = now != null && prev != null ? ((now - prev) / prev) * 100 : null
    }
    return ctx
  }

  const trades = []
  let entry = null
  for (let i = 200; i < candles.length; i++) {
    if (!entry) {
      if (evalConds(playbook.signalConditions || [], ctxAt(i))) entry = { idx: i, price: candles[i].close, ts: candles[i].ts }
      continue
    }
    const pnlFrac = dir * (candles[i].close - entry.price) / entry.price
    const ctx = { ...ctxAt(i), drawdownFromEntry: pnlFrac }
    const held = i - entry.idx
    const exitHit = evalConds(playbook.exitConditions || [], ctx)
    if (exitHit || held >= maxHoldBars) {
      trades.push({ entryTs: entry.ts, exitTs: candles[i].ts, entryPrice: entry.price, exitPrice: candles[i].close, heldBars: held, pnlPct: Number(pnlFrac.toFixed(4)), exitReason: exitHit ? 'condition' : 'time-stop' })
      entry = null
    }
  }

  // Random-entry baseline over the same window and average holding period.
  const avgHold = trades.length ? Math.round(trades.reduce((s, t) => s + t.heldBars, 0) / trades.length) : 8
  let baseSum = 0, baseN = 0
  for (let i = 200; i + avgHold < candles.length; i += 3) {
    baseSum += dir * (candles[i + avgHold].close - candles[i].close) / candles[i].close
    baseN++
  }
  const baseline = baseN ? baseSum / baseN : 0

  const wins = trades.filter(t => t.pnlPct > 0).length
  const meanPnl = trades.length ? trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length : null
  const total = trades.reduce((s, t) => s + t.pnlPct, 0)
  return {
    mode: 'conditions',
    backtestable: true,
    tradeCount: trades.length,
    wins,
    losses: trades.length - wins,
    winRate: trades.length ? Number((wins / trades.length).toFixed(3)) : null,
    totalReturnPct: trades.length ? Number(total.toFixed(4)) : null,
    meanTradePnlPct: meanPnl != null ? Number(meanPnl.toFixed(4)) : null,
    avgHoldBars: avgHold,
    baselinePct: Number(baseline.toFixed(4)),
    lift: meanPnl != null ? Number((meanPnl - baseline).toFixed(4)) : null,
    // UI-compat aliases (PlaybookDetail reads these):
    longAccuracy: dir === 1 && trades.length ? Number((wins / trades.length).toFixed(3)) : null,
    shortAccuracy: dir === -1 && trades.length ? Number((wins / trades.length).toFixed(3)) : null,
    precisionOnMove: trades.length ? Number((wins / trades.length).toFixed(3)) : null,
    trades: trades.slice(-40),
    maxHoldBars,
  }
}

/** For UI convenience — a signal quality summary in one line. */
export function backtestSummaryLine(stats) {
  if (!stats) return 'n/a'
  const l = stats.longAccuracy != null ? `${(stats.longAccuracy * 100).toFixed(0)}%` : '—'
  const s = stats.shortAccuracy != null ? `${(stats.shortAccuracy * 100).toFixed(0)}%` : '—'
  const p = stats.precisionOnMove != null ? `${(stats.precisionOnMove * 100).toFixed(0)}%` : '—'
  const lift = stats.lift != null ? `${(stats.lift * 100).toFixed(2)}%` : '—'
  return `long ${l} · short ${s} · precision@move ${p} · lift ${lift}`
}

function aggregate(rows, minAbs) {
  const total = rows.length
  const signals = rows.filter(r => r.status === 'SIGNAL')
  const longs = signals.filter(r => r.direction === 'LONG')
  const shorts = signals.filter(r => r.direction === 'SHORT')
  const flats  = rows.filter(r => r.status === 'NO_TRADE')

  const meanForward     = mean(rows.map(r => r.forwardReturn))
  const meanForwardLong = mean(longs.map(r => r.forwardReturn))
  const meanForwardShort = mean(shorts.map(r => r.forwardReturn))
  const meanForwardFlat = mean(flats.map(r => r.forwardReturn))

  const longWins   = longs.filter(r => r.forwardReturn > 0).length
  const shortWins  = shorts.filter(r => r.forwardReturn < 0).length
  const longAccuracy  = longs.length ? longWins / longs.length : null
  const shortAccuracy = shorts.length ? shortWins / shorts.length : null

  // Precision @ move: of bars where |realized| ≥ minAbs and we called SIGNAL,
  // how often was direction correct?
  const material = signals.filter(r => Math.abs(r.forwardReturn) >= minAbs)
  const correctMaterial = material.filter(r => (r.direction === 'LONG' && r.forwardReturn > 0) || (r.direction === 'SHORT' && r.forwardReturn < 0)).length
  const precisionOnMove = material.length ? correctMaterial / material.length : null

  // Recall @ move: of bars with |realized| ≥ minAbs, how many did we call SIGNAL on?
  const allMoves = rows.filter(r => Math.abs(r.forwardReturn) >= minAbs)
  const recallOnMove = allMoves.length ? material.length / allMoves.length : null

  return {
    total, signalCount: signals.length, longCount: longs.length, shortCount: shorts.length, flatCount: flats.length,
    meanForward, meanForwardLong, meanForwardShort, meanForwardFlat,
    longAccuracy, shortAccuracy,
    precisionOnMove, recallOnMove,
    minAbsForwardPct: minAbs,
    lift: meanForward != null && meanForwardLong != null ? meanForwardLong - meanForward : null,
  }
}
function mean(arr) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null }
