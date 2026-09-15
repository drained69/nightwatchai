/**
 * Cross-venue derivatives market data.
 *
 * Aggregates funding rate + open interest for each supported ticker across:
 *   - Binance USDT-M perp    (public: https://fapi.binance.com/fapi/v1/*)
 *   - OKX perpetual swap     (public: https://www.okx.com/api/v5/public/*)
 *   - Bitget USDT-M perp     (public: https://api.bitget.com/api/v2/mix/market/*)
 *
 * Plus Bitget spot order-book depth for accurate spread + top-of-book size.
 *
 * All endpoints are public / no auth. Cached per key for CROSS_CACHE_MS.
 */

import { logger } from '../lib/log.mjs'
import { getBook as bitgetGetBook, getTicker as bitgetGetTicker, isSupported as bitgetSupported } from './bitget.mjs'

const CACHE_MS = Number(process.env.CROSS_CACHE_MS || 15_000)
const TIMEOUT_MS = Number(process.env.CROSS_TIMEOUT_MS || 3500)

const PAIR_MAP = new Map([
  ['BTC',  { binance: 'BTCUSDT',  okx: 'BTC-USDT-SWAP',  bitget: 'BTCUSDT' }],
  ['ETH',  { binance: 'ETHUSDT',  okx: 'ETH-USDT-SWAP',  bitget: 'ETHUSDT' }],
  ['SOL',  { binance: 'SOLUSDT',  okx: 'SOL-USDT-SWAP',  bitget: 'SOLUSDT' }],
  ['BNB',  { binance: 'BNBUSDT',  okx: 'BNB-USDT-SWAP',  bitget: 'BNBUSDT' }],
  ['XRP',  { binance: 'XRPUSDT',  okx: 'XRP-USDT-SWAP',  bitget: 'XRPUSDT' }],
  ['DOGE', { binance: 'DOGEUSDT', okx: 'DOGE-USDT-SWAP', bitget: 'DOGEUSDT' }],
  ['AVAX', { binance: 'AVAXUSDT', okx: 'AVAX-USDT-SWAP', bitget: 'AVAXUSDT' }],
  ['ADA',  { binance: 'ADAUSDT',  okx: 'ADA-USDT-SWAP',  bitget: 'ADAUSDT' }],
])

const cache = new Map()
function getCached(k) { const h = cache.get(k); if (!h) return null; if (Date.now() - h.at > CACHE_MS) { cache.delete(k); return null } return h.value }
function setCached(k, v) { cache.set(k, { at: Date.now(), value: v }) }

async function fetchJson(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'NightwatchAI/1.0' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

/* ---------------------------------------------------- Binance perps */

async function binanceFunding(pair) {
  const body = await fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${pair}`)
  if (!body?.lastFundingRate) return null
  return { venue: 'binance', pair, fundingRate: Number(body.lastFundingRate), markPrice: Number(body.markPrice), nextFundingTime: Number(body.nextFundingTime) }
}
async function binanceOi(pair) {
  const body = await fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${pair}`)
  if (!body?.openInterest) return null
  return { venue: 'binance', pair, openInterest: Number(body.openInterest), ts: Number(body.time) }
}

/* ---------------------------------------------------- OKX perps */

async function okxFunding(pair) {
  const body = await fetchJson(`https://www.okx.com/api/v5/public/funding-rate?instId=${pair}`)
  const row = body?.data?.[0]
  if (!row) return null
  return { venue: 'okx', pair, fundingRate: Number(row.fundingRate), markPrice: null, nextFundingTime: Number(row.nextFundingTime) }
}
async function okxOi(pair) {
  const body = await fetchJson(`https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${pair}`)
  const row = body?.data?.[0]
  if (!row) return null
  return { venue: 'okx', pair, openInterest: Number(row.oiCcy), openInterestUsd: Number(row.oiUsd), ts: Number(row.ts) }
}

/* ---------------------------------------------------- Bitget perps */

async function bitgetFunding(pair) {
  const body = await fetchJson(`https://api.bitget.com/api/v2/mix/market/current-fund-rate?symbol=${pair}&productType=USDT-FUTURES`)
  const row = body?.data?.[0]
  if (!row) return null
  return { venue: 'bitget', pair, fundingRate: Number(row.fundingRate), markPrice: null, nextFundingTime: null }
}
async function bitgetOi(pair) {
  const body = await fetchJson(`https://api.bitget.com/api/v2/mix/market/open-interest?symbol=${pair}&productType=USDT-FUTURES`)
  const row = body?.data?.openInterestList?.[0]
  if (!row?.size) return null
  const openInterest = Number(row.size)
  // Bitget returns OI in base-asset units. Convert to USD via the current mark price
  // pulled from the funding-rate endpoint (same request the caller just made in parallel).
  return { venue: 'bitget', pair, openInterest, ts: Number(body?.data?.ts || Date.now()) }
}

/* ---------------------------------------------------- Aggregated per asset */

/**
 * Returns {fundingByVenue, oiByVenue, meanFundingRate, totalOpenInterest, fundingSkew, crowding}
 * fundingSkew is (max - min) across venues — high skew signals arbitrage opportunity + positioning divergence.
 * crowding is 'HIGH'|'MED'|'LOW' derived from absolute funding rate magnitude.
 */
export async function getPositioning(symbol) {
  const pair = PAIR_MAP.get(symbol)
  if (!pair) return null
  const key = `positioning:${symbol}`
  const hit = getCached(key)
  if (hit) return hit

  const [bFund, bOi, oFund, oOi, gFund, gOi] = await Promise.all([
    binanceFunding(pair.binance), binanceOi(pair.binance),
    okxFunding(pair.okx),         okxOi(pair.okx),
    bitgetFunding(pair.bitget),   bitgetOi(pair.bitget),
  ])
  const fundingByVenue = [bFund, oFund, gFund].filter(Boolean)
  const oiByVenue      = [bOi,   oOi,   gOi  ].filter(Boolean)
  if (fundingByVenue.length === 0 && oiByVenue.length === 0) return null

  const fRates = fundingByVenue.map(f => f.fundingRate)
  const meanFunding = fRates.length ? fRates.reduce((s, x) => s + x, 0) / fRates.length : null
  const fundingSkew = fRates.length > 1 ? Math.max(...fRates) - Math.min(...fRates) : 0
  const absFunding = meanFunding == null ? 0 : Math.abs(meanFunding)
  const crowding = absFunding > 0.0005 ? 'HIGH' : absFunding > 0.0002 ? 'MED' : 'LOW'
  // Fill in openInterestUsd for venues that only give base-currency OI.
  // Prefer Binance's markPrice (accurate); fall back to Bitget spot last-price
  // (works when Binance is geo-blocked, which is the norm on cloud hosts).
  let markPrice = bFund?.markPrice ?? null
  if (!markPrice) {
    const spot = await bitgetGetTicker(symbol).catch(() => null)
    if (spot?.last) markPrice = spot.last
  }
  if (markPrice) {
    for (const oi of oiByVenue) {
      if (oi.openInterestUsd == null && oi.openInterest != null) {
        oi.openInterestUsd = Number((oi.openInterest * markPrice).toFixed(0))
      }
    }
  }
  const totalOpenInterest = oiByVenue.reduce((s, x) => s + (x.openInterest || 0), 0)
  const totalOpenInterestUsd = oiByVenue.reduce((s, x) => s + (x.openInterestUsd || 0), 0)

  const value = {
    symbol,
    fundingByVenue,
    oiByVenue,
    meanFundingRate: meanFunding != null ? Number(meanFunding.toFixed(6)) : null,
    fundingSkew: Number(fundingSkew.toFixed(6)),
    crowding,
    totalOpenInterest: Number(totalOpenInterest.toFixed(2)),
    totalOpenInterestUsd: Number(totalOpenInterestUsd.toFixed(0)),
    venueCount: fundingByVenue.length,
    live: true,
    source: 'binance+okx+bitget-perp',
    at: Date.now(),
  }
  setCached(key, value)
  return value
}

/* ---------------------------------------------------- Bitget spot book depth */

/**
 * Depth stats for ANY Bitget-listed universe asset — crypto majors and the
 * R-prefixed tokenized equities alike (delegates to providers/bitget.mjs).
 */
export async function getSpotBookDepth(symbol) {
  if (!PAIR_MAP.has(symbol) && !bitgetSupported(symbol)) return null
  const key = `book:${symbol}`
  const hit = getCached(key)
  if (hit) return hit
  const raw = await bitgetGetBook(symbol, 15)
  if (!raw) return null
  const bids = raw.bids || []
  const asks = raw.asks || []
  const bestBid = bids[0]?.price
  const bestAsk = asks[0]?.price
  const spreadBps = bestBid && bestAsk ? ((bestAsk - bestBid) / bestAsk) * 10000 : null
  const bidLiquidityUsd = bids.reduce((s, r) => s + r.price * r.size, 0)
  const askLiquidityUsd = asks.reduce((s, r) => s + r.price * r.size, 0)
  const value = {
    symbol,
    bestBid, bestAsk,
    spreadBps: spreadBps != null ? Number(spreadBps.toFixed(2)) : null,
    bidLiquidityUsd: Number(bidLiquidityUsd.toFixed(0)),
    askLiquidityUsd: Number(askLiquidityUsd.toFixed(0)),
    depthImbalance: bidLiquidityUsd && askLiquidityUsd ? Number(((bidLiquidityUsd - askLiquidityUsd) / (bidLiquidityUsd + askLiquidityUsd)).toFixed(3)) : null,
    live: true,
    source: 'bitget-spot-book',
    at: Date.now(),
  }
  setCached(key, value)
  return value
}

export function isSupported(symbol) { return PAIR_MAP.has(symbol) }
