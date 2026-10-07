/**
 * NIGHTWATCH AI · shared indicator math.
 *
 * One implementation of the 1h-candle indicator set and the HIGH/MED/LOW
 * market-row labels, imported by BOTH the live server (providers/bitget.mjs,
 * market-context.mjs) and the backtester (src/backtest.js). A backtest only
 * says something about production if it replays the exact same formulas, so
 * neither side may keep a private copy.
 */

/**
 * Indicators from a 1h candle series (oldest → newest). Production feeds the
 * latest 200 candles; the backtester feeds the 200 candles ending at the bar
 * being replayed, so bar i never sees candles after i. Null under 50 candles.
 */
export function indicatorsFrom(symbol, candles) {
  if (!candles || candles.length < 50) return null
  const closes = candles.map(c => c.close)
  const highs  = candles.map(c => c.high)
  const lows   = candles.map(c => c.low)
  const vols   = candles.map(c => c.volume || 0)
  const last   = closes[closes.length - 1]

  const ema = (period) => {
    const k = 2 / (period + 1)
    let e = closes.slice(0, period).reduce((s, x) => s + x, 0) / period
    for (let i = period; i < closes.length; i++) e = closes[i] * k + e * (1 - k)
    return e
  }
  const rsi = (period = 14) => {
    let gains = 0, losses = 0
    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1]
      if (diff >= 0) gains += diff; else losses -= diff
    }
    if (losses === 0) return 100
    const rs = gains / losses
    return 100 - 100 / (1 + rs)
  }
  const atr = (period = 14) => {
    let sum = 0
    for (let i = closes.length - period; i < closes.length; i++) {
      const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]))
      sum += tr
    }
    return sum / period
  }
  // Real volume z-score: last 24 bars vs the preceding ~7 days of hourly volume.
  const volumeZ = (() => {
    if (vols.length < 48) return null
    const recent = vols.slice(-24)
    const baseline = vols.slice(0, -24)
    const baseMean = baseline.reduce((s, x) => s + x, 0) / baseline.length
    const baseVar = baseline.reduce((s, x) => s + (x - baseMean) ** 2, 0) / baseline.length
    const sd = Math.sqrt(baseVar)
    if (!sd || !baseMean) return null
    const recentMean = recent.reduce((s, x) => s + x, 0) / recent.length
    return Number(((recentMean - baseMean) / sd).toFixed(2))
  })()
  const ema20 = ema(20), ema50 = ema(50)
  const rsi14 = rsi(14)
  const atr14 = atr(14)
  const change7d = closes.length > 168 ? (last - closes[closes.length - 168]) / closes[closes.length - 168] : null
  // Real swing levels: 48h low/high (≈ 2 daily sessions of 1h bars).
  const support    = Math.min(...lows.slice(-48))
  const resistance = Math.max(...highs.slice(-48))
  return {
    symbol: String(symbol).toUpperCase(),
    last,
    ema20: Number(ema20.toFixed(4)),
    ema50: Number(ema50.toFixed(4)),
    rsi14: Number(rsi14.toFixed(1)),
    atr14: Number(atr14.toFixed(4)),
    atrPct: Number((atr14 / last * 100).toFixed(2)),
    trend: last > ema20 && ema20 > ema50 ? 'UP' : last < ema20 && ema20 < ema50 ? 'DOWN' : 'SIDE',
    macdCross: ema20 > ema50 ? 'BULL' : 'BEAR',
    support: Number(support.toFixed(4)),
    resistance: Number(resistance.toFixed(4)),
    change7d,
    change24h: closes.length > 24 ? Number((((last - closes[closes.length - 25]) / closes[closes.length - 25]) * 100).toFixed(2)) : null,
    volumeZ,
    candleCount: candles.length,
    live: true,
  }
}

/** Derive honest HIGH/MED/LOW labels from real numbers (same rules as the live universe). */
export function classifyVolatility(atrPct) { return atrPct >= 4 ? 'HIGH' : atrPct >= 2 ? 'MED' : 'LOW' }
export function classifyMomentum(change24h, volumeZ) {
  const move = Math.abs(change24h ?? 0)
  if (move >= 3 || (volumeZ != null && volumeZ >= 1.5)) return 'HIGH'
  if (move >= 1 || (volumeZ != null && volumeZ >= 0.75)) return 'MED'
  return 'LOW'
}
export function classifyLiquidity(spreadBps, volumeUsd24h) {
  const spreadOk = spreadBps == null || spreadBps <= 10
  if (spreadOk && (volumeUsd24h ?? 0) >= 50_000_000) return 'HIGH'
  if (spreadOk && (volumeUsd24h ?? 0) >= 5_000_000) return 'MED'
  return 'LOW'
}

/**
 * Realised volatility profile from a 1h candle series — used by the Thesis
 * Lab stress tests so shocks are sized from the asset's own history instead
 * of fixed percentages. Returns fractions (0.031 = 3.1%), never percents.
 *
 *   dailyRange     median (max high − min low) / close over rolling 24-bar days
 *   worstDown24h   most negative close-to-close 24-bar return
 *   worstUp24h     most positive close-to-close 24-bar return
 *   worstDown1h    most negative single-bar return (gap proxy)
 *   worstUp1h      most positive single-bar return
 */
export function volatilityProfile(candles, lookbackBars = 24 * 90) {
  if (!candles || candles.length < 72) return null
  const c = candles.slice(-lookbackBars)
  const ranges = []
  for (let i = 24; i < c.length; i += 24) {
    const day = c.slice(i - 24, i)
    const hi = Math.max(...day.map(x => x.high))
    const lo = Math.min(...day.map(x => x.low))
    ranges.push((hi - lo) / day[day.length - 1].close)
  }
  ranges.sort((a, b) => a - b)
  let worstDown24h = 0, worstUp24h = 0, worstDown1h = 0, worstUp1h = 0
  for (let i = 1; i < c.length; i++) {
    const r1 = (c[i].close - c[i - 1].close) / c[i - 1].close
    if (r1 < worstDown1h) worstDown1h = r1
    if (r1 > worstUp1h) worstUp1h = r1
    if (i >= 24) {
      const r24 = (c[i].close - c[i - 24].close) / c[i - 24].close
      if (r24 < worstDown24h) worstDown24h = r24
      if (r24 > worstUp24h) worstUp24h = r24
    }
  }
  return {
    dailyRange: ranges.length ? ranges[Math.floor(ranges.length / 2)] : null,
    worstDown24h, worstUp24h, worstDown1h, worstUp1h,
    days: Math.round(c.length / 24),
    from: c[0].ts, to: c[c.length - 1].ts,
  }
}

/**
 * OLS beta of `asset` hourly returns against `benchmark` hourly returns,
 * aligned by candle timestamp. Null when fewer than 200 overlapping bars.
 */
export function betaVs(asset, benchmark, lookbackBars = 24 * 60) {
  if (!asset?.length || !benchmark?.length) return null
  const bench = new Map(benchmark.map(b => [b.ts, b.close]))
  const a = asset.slice(-lookbackBars)
  const xs = [], ys = []
  for (let i = 1; i < a.length; i++) {
    const b0 = bench.get(a[i - 1].ts), b1 = bench.get(a[i].ts)
    if (b0 == null || b1 == null) continue
    xs.push((b1 - b0) / b0)
    ys.push((a[i].close - a[i - 1].close) / a[i - 1].close)
  }
  if (xs.length < 200) return null
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length
  const my = ys.reduce((s, y) => s + y, 0) / ys.length
  let cov = 0, varX = 0
  for (let i = 0; i < xs.length; i++) { cov += (xs[i] - mx) * (ys[i] - my); varX += (xs[i] - mx) ** 2 }
  return varX > 0 ? Number((cov / varX).toFixed(2)) : null
}
