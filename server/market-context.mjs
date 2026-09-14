/**
 * Live market context for the research engine.
 *
 * Builds a real-data version of the 18-asset universe (Bitget spot tickers +
 * 1h-candle indicators for crypto majors *and* Bitget's R-prefixed tokenized
 * equities), attaches the latest real news items per asset from the news
 * store, and a real macro snapshot (DXY / SPX / NDX / VIX / UST10Y).
 *
 * The adapter injects this into every `engine.run()` call so skills, signals
 * and reports are computed from the real tape — the seeded DEMO_UNIVERSE is
 * only a fallback while live data is unavailable (and is labeled as such).
 */

import { DEMO_UNIVERSE } from '../src/domain.js'
import { getAllTickers, computeIndicators, mergeMarketRow } from './providers/bitget.mjs'
import { getMacroSnapshot } from './providers/macro.mjs'
import { logger } from './lib/log.mjs'

const UNIVERSE_CACHE_MS = Number(process.env.LIVE_UNIVERSE_CACHE_MS || 30_000)

let universeCache = { at: 0, rows: null }
let macroCache = { at: 0, snap: null }

/** Derive honest HIGH/MED/LOW labels from real numbers. */
function classifyVolatility(atrPct) { return atrPct >= 4 ? 'HIGH' : atrPct >= 2 ? 'MED' : 'LOW' }
function classifyMomentum(change24h, volumeZ) {
  const move = Math.abs(change24h ?? 0)
  if (move >= 3 || (volumeZ != null && volumeZ >= 1.5)) return 'HIGH'
  if (move >= 1 || (volumeZ != null && volumeZ >= 0.75)) return 'MED'
  return 'LOW'
}
function classifyLiquidity(spreadBps, volumeUsd24h) {
  const spreadOk = spreadBps == null || spreadBps <= 10
  if (spreadOk && (volumeUsd24h ?? 0) >= 50_000_000) return 'HIGH'
  if (spreadOk && (volumeUsd24h ?? 0) >= 5_000_000) return 'MED'
  return 'LOW'
}

/**
 * Universe rows with the same shape as DEMO_UNIVERSE, but real prices,
 * real 24h/7d change, real ATR/RSI/EMA/volumeZ attached under `indicators`.
 * Rows we could not fetch keep their seeded values and `live: false`.
 */
export async function buildLiveUniverse() {
  if (universeCache.rows && Date.now() - universeCache.at < UNIVERSE_CACHE_MS) return universeCache.rows
  const tickers = await getAllTickers().catch(() => null)
  if (!tickers) return universeCache.rows || DEMO_UNIVERSE   // last good, else seeded fallback

  const rows = await Promise.all(DEMO_UNIVERSE.map(async (base) => {
    const ticker = tickers[base.symbol] || null
    const indicators = await computeIndicators(base.symbol).catch(() => null)
    const row = mergeMarketRow(base, ticker, indicators)
    if (row.live) {
      row.volatility = classifyVolatility(row.atrPct)
      row.momentum   = classifyMomentum(row.change24h, indicators?.volumeZ)
      row.liquidity  = classifyLiquidity(row.spreadBps, ticker?.volumeUsd24h)
      if (indicators) row.indicators = indicators
      if (ticker?.volumeUsd24h != null) row.volumeUsd24h = ticker.volumeUsd24h
    }
    return row
  }))

  const liveCount = rows.filter(r => r.live).length
  universeCache = { at: Date.now(), rows }
  logger.debug({ liveCount, total: rows.length }, 'live universe built')
  return rows
}

/** Real macro snapshot with a short cache. */
export async function getMacro() {
  if (macroCache.snap && Date.now() - macroCache.at < UNIVERSE_CACHE_MS) return macroCache.snap
  const snap = await getMacroSnapshot().catch(() => null)
  if (snap) macroCache = { at: Date.now(), snap }
  return snap || macroCache.snap
}

/** Latest real news touching `symbol` from the live news store. */
export function newsForSymbol(newsStore, symbol, limit = 8) {
  if (!newsStore?._items?.length) return []
  return newsStore._items
    .filter(item => (item.affectedAssets || []).some(a => a.symbol === symbol))
    .slice(0, limit)
    .map(item => {
      const aff = (item.affectedAssets || []).find(a => a.symbol === symbol)
      return {
        id: item.id,
        headline: item.headline,
        detail: (item.detail || '').slice(0, 200),
        source: item.source,
        url: item.url,
        publishedAt: item.publishedAt,
        severity: item.severity,
        category: item.category,
        direction: aff?.direction || 'MIXED',
        magnitude: aff?.magnitude ?? 0.5,
        reasoning: aff?.reasoning || '',
        live: true,
      }
    })
}

/** One pass over the store → { SYMBOL: [news…] } for every universe asset. */
export function newsBySymbol(newsStore, limitPerSymbol = 8) {
  const out = {}
  if (!newsStore?._items?.length) return out
  for (const item of newsStore._items) {
    for (const aff of item.affectedAssets || []) {
      const arr = (out[aff.symbol] ||= [])
      if (arr.length >= limitPerSymbol) continue
      arr.push({
        id: item.id,
        headline: item.headline,
        detail: (item.detail || '').slice(0, 200),
        source: item.source,
        url: item.url,
        publishedAt: item.publishedAt,
        severity: item.severity,
        category: item.category,
        direction: aff.direction || 'MIXED',
        magnitude: aff.magnitude ?? 0.5,
        reasoning: aff.reasoning || '',
        live: true,
      })
    }
  }
  return out
}

/** Non-fetching peek at the cached live universe (for /health). */
export function liveUniverseStatus() {
  const rows = universeCache.rows
  return {
    at: universeCache.at || null,
    ageSec: universeCache.at ? Math.round((Date.now() - universeCache.at) / 1000) : null,
    total: rows?.length || 0,
    live: rows?.filter(r => r.live).length || 0,
    stale: rows?.filter(r => r.stale).length || 0,
  }
}

/**
 * Everything the engine needs to run on the real tape.
 * Falls back to seeded rows (live:false) when Bitget is unreachable.
 */
export async function buildLiveContext(newsStore, asset) {
  const [universe, macro] = await Promise.all([buildLiveUniverse(), getMacro()])
  const btcRow = universe.find(u => u.symbol === 'BTC')
  const bySymbol = newsBySymbol(newsStore)
  return {
    universe,
    macro: macro || null,
    btcChange24h: btcRow?.change24h ?? null,
    news: asset ? (bySymbol[asset] || []) : [],
    newsBySymbol: bySymbol,
    live: universe.some(u => u.live),
  }
}
