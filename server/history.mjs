/**
 * Historical Bitget candle cache.
 *
 * Fetches hourly candles for every universe asset — crypto majors AND the
 * R-prefixed tokenized equities — and stores them at
 * `NIGHTWATCH_DATA_DIR/history/<symbol>.json`. Used by the backtester, the
 * playbook leaderboard, and the portfolio copilot's BTC correlations.
 *
 * First warm pages backwards (endTime pagination) up to HISTORY_WARM_CANDLES;
 * later refreshes merge only the newest candles. On boot: warm once in the
 * background. Failed fetches are recorded but the process still starts.
 */

import fs from 'node:fs'
import path from 'node:path'
import { getCandles, isSupported } from './providers/bitget.mjs'
import { paths } from './lib/store.mjs'
import { logger } from './lib/log.mjs'

const HISTORY_DIR = path.join(paths.DATA_DIR, 'history')
const HISTORY_MAX_CANDLES  = Number(process.env.HISTORY_MAX_CANDLES  || 8000)   // hard cap (~11 months of 1h)
const HISTORY_WARM_CANDLES = Number(process.env.HISTORY_WARM_CANDLES || 2000)   // first-warm target (~83 days of 1h)
const SUPPORTED = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'AVAX', 'ADA',
                   'NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'AMD', 'COIN', 'MSTR']
  .filter(isSupported)

// Symbols come from user-controlled paths/bodies — reject anything that could
// escape HISTORY_DIR (path separators, dot segments) before touching the fs.
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-]{0,19}$/
function file(symbol) {
  if (!SYMBOL_RE.test(String(symbol ?? ''))) return null
  return path.join(HISTORY_DIR, `${symbol}.json`)
}

fs.mkdirSync(HISTORY_DIR, { recursive: true })

export function loadHistory(symbol) {
  try {
    const f = file(symbol)
    return f ? JSON.parse(fs.readFileSync(f, 'utf8')) : null
  } catch { return null }
}

function saveHistory(symbol, candles, meta = {}) {
  const f = file(symbol)
  if (!f) return null
  const payload = { symbol, updatedAt: new Date().toISOString(), count: candles.length, ...meta, candles }
  fs.writeFileSync(f, JSON.stringify(payload))
  return payload
}

/** Merge + dedupe + sort candle arrays. */
function mergeCandles(...arrays) {
  const byTs = new Map()
  for (const arr of arrays) for (const c of arr || []) byTs.set(c.ts, c)
  return [...byTs.values()].sort((a, b) => a.ts - b.ts)
}

/** Page backwards from `endTs` until we have ~target candles or the exchange runs out. */
async function fetchDeep(symbol, target) {
  let all = []
  let endTs = null
  const maxPages = Math.ceil(target / 200)
  for (let page = 0; page < maxPages; page++) {
    const chunk = await getCandles(symbol, '1h', 200, endTs)
    if (!chunk?.length) break
    const prevLen = all.length
    all = mergeCandles(chunk, all)
    if (all.length === prevLen) break                    // no new candles → done
    endTs = all[0].ts - 1                                // next page ends before oldest
    if (all.length >= target) break
    await new Promise(r => setTimeout(r, 120))           // be polite to the public API
  }
  return all.length ? all : null
}

/** Refresh cache for one symbol. Non-destructive; merges new candles into stored series. */
export async function refreshHistory(symbol) {
  const existing = loadHistory(symbol)
  if (!existing) {
    const deep = await fetchDeep(symbol, HISTORY_WARM_CANDLES)
    if (!deep) return null
    return saveHistory(symbol, deep)
  }
  const fresh = await getCandles(symbol, '1h', 200)
  if (!fresh) return existing
  const lastKnownTs = existing.candles[existing.candles.length - 1]?.ts || 0
  const newCandles = fresh.filter(c => c.ts > lastKnownTs)
  if (!newCandles.length) return existing
  let merged = [...existing.candles, ...newCandles]
  if (merged.length > HISTORY_MAX_CANDLES) merged = merged.slice(-HISTORY_MAX_CANDLES)
  return saveHistory(symbol, merged)
}

/** Warm every supported symbol once. Best-effort. */
export async function warmHistory() {
  const results = {}
  for (const symbol of SUPPORTED) {
    try {
      const h = await refreshHistory(symbol)
      results[symbol] = h ? h.count : 0
    } catch (err) {
      logger.warn({ symbol, err: err.message }, 'history warm failed')
      results[symbol] = 0
    }
  }
  return results
}

export function historyStatus() {
  const out = {}
  for (const symbol of SUPPORTED) {
    const h = loadHistory(symbol)
    out[symbol] = h ? { count: h.candles.length, updatedAt: h.updatedAt, oldestTs: h.candles[0]?.ts, latestTs: h.candles[h.candles.length - 1]?.ts } : null
  }
  return out
}

export { SUPPORTED }
