/**
 * Real macro tape via Yahoo Finance's public chart API (no key).
 *
 *   DXY  (DX-Y.NYB) · S&P 500 (^GSPC) · Nasdaq (^IXIC) · VIX (^VIX) · UST10Y (^TNX)
 *
 * Cached 5 minutes with a 1-hour stale shelf so transient failures degrade
 * to the last good reading (marked stale) instead of null.
 */
import { logger } from '../lib/log.mjs'

const CACHE_MS  = Number(process.env.MACRO_CACHE_MS  || 5 * 60_000)
const STALE_MS  = Number(process.env.MACRO_STALE_MS  || 60 * 60_000)
const TIMEOUT_MS = Number(process.env.MACRO_TIMEOUT_MS || 6000)
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) NightwatchAI/1.1'

const SYMBOLS = {
  dxy:  'DX-Y.NYB',
  spx:  '^GSPC',
  ndx:  '^IXIC',
  vix:  '^VIX',
  ust10y: '^TNX',
}

const cache = new Map()
const staleShelf = new Map()

function fresh(k) { const h = cache.get(k); if (!h) return null; if (Date.now() - h.at > CACHE_MS) return null; return h.value }
function shelfGet(k) { const h = staleShelf.get(k); if (!h) return null; if (Date.now() - h.at > STALE_MS) { staleShelf.delete(k); return null } return { ...h.value, stale: true } }
function put(k, v) { cache.set(k, { at: Date.now(), value: v }); staleShelf.set(k, { at: Date.now(), value: v }); return v }

async function chart(yahooSymbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=5d`
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) { if (attempt === 0) continue; return null }
      const body = await res.json()
      const result = body?.chart?.result?.[0]
      const meta = result?.meta
      if (!meta || meta.regularMarketPrice == null) return null
      // True previous *daily* close: last completed bar of the 5d series
      // (meta.chartPreviousClose is the close before the whole range — 5d change).
      const closes = (result?.indicators?.quote?.[0]?.close || []).filter(x => x != null)
      const prev = closes.length >= 2 ? closes[closes.length - 2] : (meta.chartPreviousClose ?? null)
      return {
        last: Number(meta.regularMarketPrice),
        prevClose: prev != null ? Number(prev) : null,
        changePct: prev ? Number((((meta.regularMarketPrice - prev) / prev) * 100).toFixed(2)) : null,
        ts: (meta.regularMarketTime || Date.now() / 1000) * 1000,
      }
    } catch {
      if (attempt === 0) { await new Promise(r => setTimeout(r, 250)); continue }
      return null
    }
  }
  return null
}

async function one(name) {
  const key = `macro:${name}`
  const hit = fresh(key)
  if (hit) return hit
  const row = await chart(SYMBOLS[name])
  if (!row) return shelfGet(key)
  return put(key, row)
}

/**
 * Macro snapshot: { dxy, spx, ndx, vix, ust10y, riskRegime, live, stale? }
 * riskRegime is a simple deterministic read: VIX level + index direction.
 */
export async function getMacroSnapshot() {
  const [dxy, spx, ndx, vix, ust10y] = await Promise.all([
    one('dxy').catch(() => null),
    one('spx').catch(() => null),
    one('ndx').catch(() => null),
    one('vix').catch(() => null),
    one('ust10y').catch(() => null),
  ])
  const any = dxy || spx || ndx || vix || ust10y
  if (!any) return null
  const calmVix = vix ? vix.last < 20 : null
  const equitiesUp = spx?.changePct != null ? spx.changePct > 0 : ndx?.changePct != null ? ndx.changePct > 0 : null
  const riskRegime = calmVix === false ? 'RISK_OFF' : equitiesUp === true ? 'RISK_ON' : equitiesUp === false ? 'RISK_OFF' : 'NEUTRAL'
  return {
    dxy, spx, ndx, vix, ust10y,
    riskRegime,
    live: true,
    stale: Boolean(any.stale),
    source: 'yahoo-finance-public',
    at: Date.now(),
  }
}
