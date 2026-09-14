/**
 * Bitget public market-data provider.
 *
 * Uses Bitget's public REST endpoints — no auth required.
 * Docs: https://www.bitget.com/api-doc/spot/market/Get-Tickers
 *
 * Covers the full 18-asset universe:
 *   - 8 crypto majors trade as plain spot pairs (BTCUSDT, ETHUSDT, …)
 *   - 10 tokenized U.S. equities trade on Bitget spot as xStocks-style
 *     R-prefixed pairs (RNVDAUSDT, RTSLAUSDT, …) — real prices, real books,
 *     real candles, 7×24.
 *
 * Resilience:
 *   - one automatic retry per call
 *   - stale-while-revalidate cache: if a refresh fails but we hold a previous
 *     good value, we return it marked `stale: true` with its original `ts`
 *     instead of collapsing to null. Callers still surface freshness honestly.
 */

const BITGET_BASE = process.env.BITGET_BASE_URL || 'https://api.bitget.com'
const BITGET_CACHE_MS = Number(process.env.BITGET_CACHE_MS || 5000)
const BITGET_TIMEOUT_MS = Number(process.env.BITGET_TIMEOUT_MS || 5000)
const BITGET_STALE_MS = Number(process.env.BITGET_STALE_MS || 10 * 60_000)

/** Universe ticker → Bitget spot symbol. Equities use Bitget's R-prefixed tokenized-stock pairs. */
export const SYMBOL_MAP = new Map([
  // Crypto majors
  ['BTC',   'BTCUSDT'],
  ['ETH',   'ETHUSDT'],
  ['SOL',   'SOLUSDT'],
  ['BNB',   'BNBUSDT'],
  ['XRP',   'XRPUSDT'],
  ['DOGE',  'DOGEUSDT'],
  ['AVAX',  'AVAXUSDT'],
  ['ADA',   'ADAUSDT'],
  // Tokenized U.S. equities (Bitget spot, R-prefix)
  ['NVDA',  'RNVDAUSDT'],
  ['TSLA',  'RTSLAUSDT'],
  ['AAPL',  'RAAPLUSDT'],
  ['MSFT',  'RMSFTUSDT'],
  ['AMZN',  'RAMZNUSDT'],
  ['GOOGL', 'RGOOGLUSDT'],
  ['META',  'RMETAUSDT'],
  ['AMD',   'RAMDUSDT'],
  ['COIN',  'RCOINUSDT'],
  ['MSTR',  'RMSTRUSDT'],
])

/** Back-compat alias. */
export const CRYPTO_MAP = SYMBOL_MAP

export function pairFor(symbol) { return SYMBOL_MAP.get(String(symbol || '').toUpperCase()) || null }
export function isSupported(symbol) { return SYMBOL_MAP.has(String(symbol || '').toUpperCase()) }

/** key → { at, value } fresh cache; key → { at, value } stale shelf. */
const cache = new Map()
const staleShelf = new Map()

function getCached(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > BITGET_CACHE_MS) { cache.delete(key); return null }
  return hit.value
}
function setCached(key, value) {
  cache.set(key, { at: Date.now(), value })
  staleShelf.set(key, { at: Date.now(), value })
}
/** Last good value within BITGET_STALE_MS, marked stale. Used when a live fetch fails. */
function getStale(key) {
  const hit = staleShelf.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > BITGET_STALE_MS) { staleShelf.delete(key); return null }
  const value = hit.value
  if (Array.isArray(value)) return value                                  // candles: historical by nature
  if (value && typeof value === 'object' && 'symbol' in value) {
    return { ...value, stale: true }                                      // single ticker / book
  }
  if (value && typeof value === 'object') {
    const out = {}                                                        // tickers:all map
    for (const k of Object.keys(value)) out[k] = { ...value[k], stale: true }
    return out
  }
  return value
}

async function fetchJson(url, { retries = 1 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(BITGET_TIMEOUT_MS) })
      if (!response.ok) {
        if (response.status === 429 && attempt < retries) { await new Promise(r => setTimeout(r, 400)); continue }
        return null
      }
      return await response.json()
    } catch {
      if (attempt < retries) { await new Promise(r => setTimeout(r, 250)); continue }
      return null
    }
  }
  return null
}

/** Return { last, open24h, high24h, low24h, volumeUsd24h, changePct24h, spreadBps } or null. */
export async function getTicker(symbol) {
  const pair = pairFor(symbol)
  if (!pair) return null
  const key = `ticker:${pair}`
  const hit = getCached(key)
  if (hit) return hit
  const body = await fetchJson(`${BITGET_BASE}/api/v2/spot/market/tickers?symbol=${pair}`)
  const row = body?.data?.[0]
  if (!row) return getStale(key)
  const value = {
    symbol: String(symbol).toUpperCase(),
    pair,
    last:          Number(row.lastPr),
    open24h:       Number(row.open),
    high24h:       Number(row.high24h),
    low24h:        Number(row.low24h),
    bidPrice:      Number(row.bidPr),
    askPrice:      Number(row.askPr),
    volumeUsd24h:  Number(row.quoteVolume),
    baseVolume24h: Number(row.baseVolume),
    changePct24h:  Number(row.change24h) * 100,
    spreadBps:     row.bidPr && row.askPr ? ((Number(row.askPr) - Number(row.bidPr)) / Number(row.askPr)) * 10000 : null,
    ts:            Number(row.ts),
    source:        'bitget-public-rest',
    live:          true,
  }
  setCached(key, value)
  return value
}

/** Return snapshot of every mapped symbol at once (single request). */
export async function getAllTickers() {
  const key = 'tickers:all'
  const hit = getCached(key)
  if (hit) return hit
  const body = await fetchJson(`${BITGET_BASE}/api/v2/spot/market/tickers`)
  if (!body?.data) return getStale(key)
  const byPair = new Map(body.data.map(row => [row.symbol, row]))
  const out = {}
  for (const [symbol, pair] of SYMBOL_MAP) {
    const row = byPair.get(pair)
    if (!row) continue
    out[symbol] = {
      symbol, pair,
      last:         Number(row.lastPr),
      open24h:      Number(row.open),
      high24h:      Number(row.high24h),
      low24h:       Number(row.low24h),
      changePct24h: Number(row.change24h) * 100,
      volumeUsd24h: Number(row.quoteVolume),
      spreadBps:    row.bidPr && row.askPr ? ((Number(row.askPr) - Number(row.bidPr)) / Number(row.askPr)) * 10000 : null,
      ts:           Number(row.ts),
      source:       'bitget-public-rest',
      live:         true,
    }
  }
  if (Object.keys(out).length === 0) return getStale(key)
  setCached(key, out)
  return out
}

/**
 * Return recent candles for `symbol` at `granularity` (e.g. '1h','4h','1day').
 * Pass `endTime` (ms) to page backwards for deep history.
 */
export async function getCandles(symbol, granularity = '1h', limit = 200, endTime = null) {
  const pair = pairFor(symbol)
  if (!pair) return null
  const g = String(granularity).toLowerCase()
  const key = `candles:${pair}:${g}:${limit}:${endTime || 'latest'}`
  const hit = getCached(key)
  if (hit) return hit
  const endParam = endTime ? `&endTime=${endTime}` : ''
  const body = await fetchJson(`${BITGET_BASE}/api/v2/spot/market/candles?symbol=${pair}&granularity=${g}&limit=${limit}${endParam}`)
  if (!body?.data) return endTime ? null : getStale(key)
  // Bitget returns [ts, open, high, low, close, baseVolume, quoteVolume]
  const candles = body.data.map(row => ({
    ts:     Number(row[0]),
    open:   Number(row[1]),
    high:   Number(row[2]),
    low:    Number(row[3]),
    close:  Number(row[4]),
    volume: Number(row[6]),
  })).sort((a, b) => a.ts - b.ts)
  if (!candles.length) return null
  setCached(key, candles)
  return candles
}

/** Return best bid/ask depth for the symbol (top of book). */
export async function getBook(symbol, depth = 5) {
  const pair = pairFor(symbol)
  if (!pair) return null
  const key = `book:${pair}:${depth}`
  const hit = getCached(key)
  if (hit) return hit
  const body = await fetchJson(`${BITGET_BASE}/api/v2/spot/market/orderbook?symbol=${pair}&limit=${depth}&type=step0`)
  if (!body?.data) return getStale(key)
  const value = {
    bids: body.data.bids?.map(([p, s]) => ({ price: Number(p), size: Number(s) })) || [],
    asks: body.data.asks?.map(([p, s]) => ({ price: Number(p), size: Number(s) })) || [],
    ts: Number(body.data.ts),
    source: 'bitget-public-rest',
    live: true,
  }
  setCached(key, value)
  return value
}

/** Compute technical indicators from real candles. Returns null if no data. */
export async function computeIndicators(symbol) {
  const candles = await getCandles(symbol, '1h', 200)
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
  const swingLows  = lows.slice(-48)
  const swingHighs = highs.slice(-48)
  const support    = Math.min(...swingLows)
  const resistance = Math.max(...swingHighs)
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
    source: 'bitget-public-rest',
  }
}

/** Convert a real ticker + indicators into a UI-facing MarketRow (same shape as DEMO_UNIVERSE). */
export function mergeMarketRow(base, ticker, indicators) {
  if (!ticker) return { ...base, live: false, source: 'demo' }
  return {
    ...base,
    price: ticker.last ?? base.price,
    change24h: ticker.changePct24h ?? base.change24h,
    change7d: indicators?.change7d != null ? indicators.change7d * 100 : base.change7d,
    spreadBps: ticker.spreadBps ?? null,
    atrPct: indicators?.atrPct ?? base.atrPct,
    volumeUsd24h: ticker.volumeUsd24h ?? null,
    live: true,
    stale: Boolean(ticker.stale),
    source: 'bitget-public-rest',
  }
}
