/**
 * NIGHTWATCH AI · backtesting engine.
 *
 * Replays historical Bitget 1h candles through the same skill pack +
 * `synthesizeSignal` used in production and measures what those signals
 * would have done after real round-trip costs.
 *
 * What makes the replay faithful:
 *   - Indicators come from src/indicators.js — the exact code the live desk
 *     runs on its latest 200 candles. Bar i sees only the 200 candles ending
 *     at i (no lookahead), and the market row is labelled with the same
 *     volatility / momentum / liquidity rules as the live universe.
 *   - Feeds with no point-in-time archive are held NEUTRAL, never seeded:
 *     news (no historical wire) and sentiment (VIX / Fear & Greed). Macro is
 *     reconstructed per bar from the Bitget RSPY tape (S&P proxy) when a
 *     benchmark series is supplied, using the live regime rule with VIX
 *     unavailable; otherwise it is neutral too.
 *   - Friction is the engine's own: 0.10% Bitget taker fee per side plus the
 *     spread assumption (the live spread when the server knows it).
 *   - Decisions are non-overlapping by default (step = horizon): one decision
 *     every H bars, held H bars, so the compounded equity curve is a real
 *     P&L path rather than double-counted overlapping windows.
 *
 * `runBacktestSynthetic` exists only for unit tests / engine self-checks; the
 * product never presents synthetic candles as a market backtest.
 */

import { DEMO_UNIVERSE, runSkillPack, synthesizeSignal } from './domain.js'
import { indicatorsFrom, classifyVolatility, classifyMomentum, classifyLiquidity } from './indicators.js'

/** Candles the live desk feeds its indicator set — and the replay warm-up. */
export const BACKTEST_WARMUP = 200
/** Forward horizons (in 1h bars) the UI offers. */
export const BACKTEST_HORIZONS = [1, 4, 8, 12, 24, 48]
/** Spread assumed when no live Bitget spread is known (bps). */
export const DEFAULT_SPREAD_BPS = 5

/** Simple deterministic price walk with drift + occasional shock (tests only). */
export function syntheticCandles(seed = 'BTC', n = 300, start = 100) {
  const rnd = mulberry(hash(seed))
  const out = []
  let last = start
  const t0 = Date.UTC(2026, 0, 1)
  for (let i = 0; i < n; i++) {
    const drift = 0.0005 * Math.sin(i / 20)
    const shock = rnd() < 0.02 ? (rnd() - 0.5) * 0.06 : 0
    const noise = (rnd() - 0.5) * 0.015
    const change = drift + shock + noise
    const open = last
    const close = last * (1 + change)
    const high = Math.max(open, close) * (1 + Math.abs(noise) * 0.5)
    const low  = Math.min(open, close) * (1 - Math.abs(noise) * 0.5)
    out.push({ ts: t0 + i * 3600_000, open, high, low, close, volume: 1_000_000 * (0.5 + rnd()) })
    last = close
  }
  return out
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return Math.abs(h) }
function mulberry(a) { return () => { let t = (a += 0x6D2B79F5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

/** Live macro regime rule (server/providers/macro.mjs) with VIX unavailable. */
function regimeFromEquityChange(eqChgPct) {
  if (eqChgPct <= -0.75) return 'RISK_OFF'
  if (eqChgPct >= 0.4) return 'RISK_ON'
  return 'NEUTRAL'
}

/** Market row for bar i, built exactly like server/market-context.mjs builds a live row. */
function marketAt(symbol, base, window, spreadBps) {
  const ind = indicatorsFrom(symbol, window)
  if (!ind) return null
  const volumeUsd24h = window.slice(-24).reduce((s, c) => s + (c.volume || 0), 0)
  const change24h = ind.change24h ?? 0
  return {
    ...base,
    price: ind.last,
    change24h,
    change7d: ind.change7d != null ? ind.change7d * 100 : base.change7d ?? 0,
    atrPct: ind.atrPct,
    spreadBps,
    volumeUsd24h,
    volatility: classifyVolatility(ind.atrPct),
    momentum: classifyMomentum(change24h, ind.volumeZ),
    liquidity: classifyLiquidity(spreadBps, volumeUsd24h),
    event: 'None',
    live: true,
    stale: false,
    source: 'bitget-history-replay',
    indicators: { ...ind, source: 'bitget-history-replay' },
  }
}

/**
 * Replay the production signal engine over `candles` (1h, oldest → newest).
 *
 * @param {string} symbol
 * @param {Array<{ts,open,high,low,close,volume}>} candles
 * @param {object} opts
 *   horizon           forward holding period in bars (1..168, default 8)
 *   step              bars between decisions (default = horizon → non-overlapping)
 *   prefs             trader preferences (style / risk / minNetEdge / minConfidence) — same gates as live
 *   spreadBps         spread assumption in bps (default DEFAULT_SPREAD_BPS)
 *   benchmarkCandles  RSPY (S&P proxy) 1h candles for per-bar macro regime; optional
 *   minAbsForwardPct  "material move" threshold for precision/recall@move (fraction, default 0.005)
 */
export function runBacktestFromCandles(symbol, candles, opts = {}) {
  const horizon = clampInt(opts.horizon, 1, 168, 8)
  const step = clampInt(opts.step, 1, 168, horizon)
  const minAbs = Number.isFinite(opts.minAbsForwardPct) && opts.minAbsForwardPct > 0 ? opts.minAbsForwardPct : 0.005
  const spreadBps = Number.isFinite(opts.spreadBps) && opts.spreadBps >= 0 ? opts.spreadBps : DEFAULT_SPREAD_BPS
  const prefs = opts.prefs || undefined
  const sym = String(symbol || '').toUpperCase()
  const base = DEMO_UNIVERSE.find(a => a.symbol === sym)
    || { symbol: sym, name: sym, class: 'tokenized-equity', sector: '—', beta: 1, change24h: 0, change7d: 0, marketCap: 0 }
  const series = Array.isArray(candles) ? candles.filter(c => c && Number.isFinite(c.close) && c.close > 0) : []
  const bench = Array.isArray(opts.benchmarkCandles) && opts.benchmarkCandles.length
    ? new Map(opts.benchmarkCandles.map(c => [c.ts, c.close]))
    : null

  const meta = {
    symbol: sym,
    candleCount: series.length,
    warmup: BACKTEST_WARMUP,
    horizon,
    step,
    overlapping: step < horizon,
    spreadBps,
    feePctPerSide: 0.1,
    macroSource: bench ? 'RSPY 24h tape (S&P proxy)' : 'neutral',
    heldNeutral: bench ? ['news-briefing', 'sentiment-analyst'] : ['news-briefing', 'sentiment-analyst', 'macro-analyst'],
    replayed: bench ? ['technical-analysis', 'market-intel', 'macro-analyst'] : ['technical-analysis', 'market-intel'],
    persona: prefs ? { style: prefs.style || 'EVENT_DRIVEN', risk: prefs.risk || 'MODERATE' } : { style: 'EVENT_DRIVEN', risk: 'MODERATE' },
  }

  const rows = []
  const first = BACKTEST_WARMUP - 1
  for (let i = first; i + horizon < series.length; i += step) {
    const market = marketAt(sym, base, series.slice(i - BACKTEST_WARMUP + 1, i + 1), spreadBps)
    if (!market) continue
    let macro = null
    if (bench && i >= 24) {
      const now = bench.get(series[i].ts)
      const prev = bench.get(series[i - 24].ts)
      if (now != null && prev != null && prev > 0) {
        const eqChg = Number((((now - prev) / prev) * 100).toFixed(2))
        macro = { live: true, replay: true, riskRegime: regimeFromEquityChange(eqChg), spx: { changePct: eqChg }, ndx: null, vix: null, dxy: null, ust10y: null }
      }
    }
    const skills = runSkillPack(sym, market, { replay: true, macro })
    const signal = synthesizeSignal(sym, market, skills, prefs)
    const priceNow = series[i].close
    const priceFuture = series[i + horizon].close
    const forwardReturn = (priceFuture - priceNow) / priceNow
    const traded = signal.status === 'SIGNAL' && (signal.direction === 'LONG' || signal.direction === 'SHORT')
    const dir = traded ? (signal.direction === 'LONG' ? 1 : -1) : 0
    const grossReturn = traded ? dir * forwardReturn : null
    const netReturn = traded ? grossReturn - signal.estimatedFriction : null
    rows.push({
      ts: series[i].ts,
      exitTs: series[i + horizon].ts,
      priceNow, priceFuture,
      direction: signal.direction,
      status: signal.status,
      confidence: signal.confidence,
      composite: signal.composite,
      netEdge: signal.netEdge,
      friction: signal.estimatedFriction,
      macroRegime: macro?.riskRegime ?? null,
      forwardReturn,
      grossReturn,
      netReturn,
      // WIN: profitable after costs · FEES: direction right, costs ate it · LOSS: wrong way.
      outcome: !traded ? 'SKIP' : netReturn > 0 ? 'WIN' : grossReturn > 0 ? 'FEES' : 'LOSS',
    })
  }
  meta.evaluated = rows.length
  meta.firstTs = rows[0]?.ts ?? null
  meta.lastTs = rows.length ? rows[rows.length - 1].exitTs : null
  return { symbol: sym, rows, stats: aggregate(rows, minAbs, meta), meta }
}

export function runBacktestSynthetic(symbol = 'BTC', opts = {}) {
  const candles = syntheticCandles(symbol, opts.n || 600)
  return runBacktestFromCandles(symbol, candles, opts)
}

function clampInt(v, lo, hi, dflt) {
  if (v == null || v === '') return dflt
  const n = Math.floor(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt
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

function aggregate(rows, minAbs, meta = {}) {
  const total = rows.length
  const signals = rows.filter(r => r.status === 'SIGNAL' && r.grossReturn != null)
  const longs = signals.filter(r => r.direction === 'LONG')
  const shorts = signals.filter(r => r.direction === 'SHORT')
  const sitOuts = rows.filter(r => r.status === 'NO_TRADE')
  const flats = sitOuts.filter(r => r.direction === 'FLAT')

  const meanForward      = mean(rows.map(r => r.forwardReturn))
  const meanForwardLong  = mean(longs.map(r => r.forwardReturn))
  const meanForwardShort = mean(shorts.map(r => r.forwardReturn))
  const meanForwardFlat  = mean(sitOuts.map(r => r.forwardReturn))

  const hits = signals.filter(r => r.grossReturn > 0).length
  const longWins = longs.filter(r => r.forwardReturn > 0).length
  const shortWins = shorts.filter(r => r.forwardReturn < 0).length
  const netWins = signals.filter(r => r.netReturn > 0).length

  // Precision @ move: of called bars where |realized| ≥ minAbs, how often was
  // the direction right? Recall @ move: of all bars that moved ≥ minAbs, how
  // many did the desk call?
  const material = signals.filter(r => Math.abs(r.forwardReturn) >= minAbs)
  const correctMaterial = material.filter(r => r.grossReturn > 0).length
  const allMoves = rows.filter(r => Math.abs(r.forwardReturn) >= minAbs)

  // Timing lift: the signals' mean directional return minus what the same
  // long/short mix would earn on randomly timed bars. Separates timing skill
  // from simply leaning long in a rising tape.
  const pLong = total ? longs.length / total : 0
  const pShort = total ? shorts.length / total : 0
  const meanSignalGross = mean(signals.map(r => r.grossReturn))
  const randomMix = signals.length && meanForward != null && (pLong + pShort) > 0
    ? ((pLong - pShort) / (pLong + pShort)) * meanForward
    : null
  const timingLift = meanSignalGross != null && randomMix != null ? meanSignalGross - randomMix : null

  // Compounded equity curves. Strategy is flat between signals; buy & hold
  // holds the asset from the first decision bar to the final exit.
  let equity = 1, peak = 1, maxDrawdown = 0
  const curve = []
  const startPx = rows[0]?.priceNow ?? null
  for (const r of rows) {
    if (r.netReturn != null) equity *= 1 + r.netReturn
    peak = Math.max(peak, equity)
    maxDrawdown = Math.min(maxDrawdown, equity / peak - 1)
    curve.push({ ts: r.exitTs ?? r.ts, strategy: equity - 1, buyHold: startPx ? r.priceFuture / startPx - 1 : null })
  }
  const strategyReturn = rows.length ? equity - 1 : null
  const buyHoldReturn = rows.length && startPx ? rows[rows.length - 1].priceFuture / startPx - 1 : null

  return {
    total,
    signalCount: signals.length,
    longCount: longs.length,
    shortCount: shorts.length,
    sitOutCount: sitOuts.length,
    flatCount: flats.length,
    gatedCount: sitOuts.length - flats.length,
    hitRate: signals.length ? hits / signals.length : null,
    longAccuracy: longs.length ? longWins / longs.length : null,
    shortAccuracy: shorts.length ? shortWins / shorts.length : null,
    netWinRate: signals.length ? netWins / signals.length : null,
    avgGrossReturn: meanSignalGross,
    avgNetReturn: mean(signals.map(r => r.netReturn)),
    avgFriction: mean(signals.map(r => r.friction)),
    strategyReturn,
    buyHoldReturn,
    maxDrawdown: rows.length ? maxDrawdown : null,
    meanForward, meanForwardLong, meanForwardShort, meanForwardFlat,
    precisionOnMove: material.length ? correctMaterial / material.length : null,
    recallOnMove: allMoves.length ? material.length / allMoves.length : null,
    minAbsForwardPct: minAbs,
    timingLift,
    // Legacy field: LONG-signalled mean forward return minus all-bar mean.
    lift: meanForward != null && meanForwardLong != null ? meanForwardLong - meanForward : null,
    overlapping: Boolean(meta.overlapping),
    curve: downsample(curve, 160),
  }
}
function mean(arr) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null }
function downsample(points, max) {
  if (points.length <= max) return points
  const out = []
  const every = (points.length - 1) / (max - 1)
  for (let k = 0; k < max; k++) out.push(points[Math.round(k * every)])
  return out
}
