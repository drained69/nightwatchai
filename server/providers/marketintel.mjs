/**
 * Higher-level market intelligence:
 *   - Crypto Fear & Greed Index      (public: api.alternative.me/fng)
 *   - Bitcoin ETF net flows          (public: farside.co.uk CSV)
 *   - Ethereum ETF net flows         (public: farside.co.uk CSV)
 *   - Bitcoin/Ethereum network stats (public: blockchain.info + etherscan open endpoint)
 *
 * All feeds are cached generously. If a source fails, the caller falls back
 * to heuristic values. No API keys required.
 */

import { logger } from '../lib/log.mjs'

const CACHE_MS = Number(process.env.MI_CACHE_MS || 15 * 60_000)          // 15 min
const TIMEOUT_MS = Number(process.env.MI_TIMEOUT_MS || 6000)

const cache = new Map()
function cached(k) { const h = cache.get(k); if (!h) return null; if (Date.now() - h.at > CACHE_MS) { cache.delete(k); return null } return h.value }
function put(k, v) { cache.set(k, { at: Date.now(), value: v }); return v }

/** Negative cache: remember failures so a dead source can't slow every request. */
const failed = new Map()
const FAIL_TTL_MS = Number(process.env.MI_FAIL_TTL_MS || 30 * 60_000)
function markFailed(k) { failed.set(k, Date.now()) }
function recentlyFailed(k) { const at = failed.get(k); if (!at) return false; if (Date.now() - at > FAIL_TTL_MS) { failed.delete(k); return false } return true }

async function fetchText(url, headers = {}) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'NightwatchAI/1.0', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    return await res.text()
  } catch { return null }
}
async function fetchJson(url) {
  const text = await fetchText(url, { Accept: 'application/json' })
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}

/* ---------------------------------------------------- Fear & Greed */

export async function getFearGreed() {
  const hit = cached('fng')
  if (hit) return hit
  const body = await fetchJson('https://api.alternative.me/fng/?limit=7')
  const rows = body?.data || []
  if (!rows.length) return null
  const latest = rows[0]
  const value  = Number(latest.value)
  const week   = rows.map(r => Number(r.value))
  const trend  = week.length > 3 ? week[0] - week[week.length - 1] : 0
  return put('fng', {
    value,
    classification: latest.value_classification,
    trend7d: Number(trend.toFixed(1)),
    week,
    ts: Number(latest.timestamp) * 1000,
    source: 'alternative.me',
    live: true,
  })
}

/* ---------------------------------------------------- ETF flows */

/**
 * Farside publishes these CSVs at incrementing paths that change without
 * notice (and Cloudflare-403s anonymous HTML scraping). We try a list of
 * candidates and accept the first that parses. Override via env when the
 * path moves: FARSIDE_BTC_CSV / FARSIDE_ETH_CSV.
 */
const FARSIDE_BTC_CANDIDATES = [
  process.env.FARSIDE_BTC_CSV,
  'https://farside.co.uk/wp-content/uploads/2024/07/bitcoin-etf-fund-flow-8.csv',
  'https://farside.co.uk/wp-content/uploads/2024/07/bitcoin-etf-fund-flow-4.csv',
].filter(Boolean)
const FARSIDE_ETH_CANDIDATES = [
  process.env.FARSIDE_ETH_CSV,
  'https://farside.co.uk/wp-content/uploads/2024/07/ethereum-etf-fund-flow-1.csv',
].filter(Boolean)

async function fetchFarside(candidates) {
  for (const url of candidates) {
    const text = await fetchText(url, { Referer: 'https://farside.co.uk/' })
    const parsed = parseFarsideCsv(text)
    if (parsed) return parsed
  }
  return null
}

/** Parse Farside's Total column from the CSV. Returns { latestDay, weeklyNetUsdM }. */
function parseFarsideCsv(text) {
  if (!text) return null
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length < 3) return null
  const header = lines[0].split(',')
  const totalIdx = header.findIndex(h => /^total$/i.test(h.trim()))
  if (totalIdx < 0) return null
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',')
    const date = parts[0]?.trim()
    const total = parts[totalIdx]?.trim().replace(/[()]/g, m => m === '(' ? '-' : '').replace(/,/g, '')
    if (!date || !total || total === '-' || isNaN(Number(total))) continue
    rows.push({ date, netUsdM: Number(total) })
  }
  if (!rows.length) return null
  const latest = rows[rows.length - 1]
  const trailing5 = rows.slice(-5).reduce((s, r) => s + r.netUsdM, 0)
  const trailing20 = rows.slice(-20).reduce((s, r) => s + r.netUsdM, 0)
  return { latestDay: latest, trailing5UsdM: Number(trailing5.toFixed(1)), trailing20UsdM: Number(trailing20.toFixed(1)), rows: rows.slice(-30) }
}

export async function getBitcoinEtfFlows() {
  const hit = cached('etf-btc')
  if (hit) return hit
  if (recentlyFailed('etf-btc')) return null
  const parsed = await fetchFarside(FARSIDE_BTC_CANDIDATES)
  if (!parsed) { markFailed('etf-btc'); return null }
  return put('etf-btc', { asset: 'BTC', ...parsed, source: 'farside.co.uk', live: true })
}
export async function getEthereumEtfFlows() {
  const hit = cached('etf-eth')
  if (hit) return hit
  if (recentlyFailed('etf-eth')) return null
  const parsed = await fetchFarside(FARSIDE_ETH_CANDIDATES)
  if (!parsed) { markFailed('etf-eth'); return null }
  return put('etf-eth', { asset: 'ETH', ...parsed, source: 'farside.co.uk', live: true })
}

/* ---------------------------------------------------- Bitcoin network stats (blockchain.info) */

export async function getBtcNetworkStats() {
  const hit = cached('btc-network')
  if (hit) return hit
  const body = await fetchJson('https://blockchain.info/stats?format=json')
  if (!body?.market_price_usd) return null
  return put('btc-network', {
    marketPriceUsd: Number(body.market_price_usd),
    hashRate: Number(body.hash_rate),
    difficulty: Number(body.difficulty),
    minersRevenueUsd: Number(body.miners_revenue_usd),
    n_tx_24h: Number(body.n_tx),
    trade_volume_usd_24h: Number(body.trade_volume_usd),
    ts: Date.now(),
    source: 'blockchain.info',
    live: true,
  })
}

/* ---------------------------------------------------- One-shot aggregate helper */

/**
 * Composite market-intel snapshot for a symbol. Only fills fields available for that asset.
 */
export async function getMarketIntelSnapshot(symbol) {
  const [fng, btcFlows, ethFlows, btcNet] = await Promise.all([
    getFearGreed().catch(() => null),
    (symbol === 'BTC' || symbol === 'MSTR') ? getBitcoinEtfFlows().catch(() => null) : null,
    (symbol === 'ETH')                       ? getEthereumEtfFlows().catch(() => null) : null,
    (symbol === 'BTC') ? getBtcNetworkStats().catch(() => null) : null,
  ])
  return {
    fearGreed: fng,
    etfFlows: btcFlows || ethFlows,
    networkStats: btcNet,
    live: Boolean(fng || btcFlows || ethFlows || btcNet),
  }
}
