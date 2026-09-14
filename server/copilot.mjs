/**
 * Portfolio Copilot.
 *
 * Given the user's open paper positions, compute:
 *   - Pairwise 30-day price correlation between every position and BTC
 *   - Factor exposure clusters: crypto-beta, semis/AI, cloud, macro-risk-on
 *   - Sector concentration (dollar weighted)
 *   - Advisory: "70% of your book is BTC-beta" style warnings
 *
 * Uses cached candles from history.mjs.
 */

import { loadHistory, SUPPORTED as HISTORY_SUPPORTED } from './history.mjs'
import { DEMO_UNIVERSE } from '../src/domain.js'

/** Pearson correlation over two aligned arrays. */
function correlation(a, b) {
  const n = Math.min(a.length, b.length)
  if (n < 5) return null
  let ma = 0, mb = 0
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i] }
  ma /= n; mb /= n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma, xb = b[i] - mb
    num += xa * xb; da += xa * xa; db += xb * xb
  }
  const denom = Math.sqrt(da * db)
  return denom === 0 ? null : Number((num / denom).toFixed(3))
}

/** Convert candles to log returns. */
function toReturns(candles, take = 168) {
  const slice = candles.slice(-take)
  const out = []
  for (let i = 1; i < slice.length; i++) out.push(Math.log(slice[i].close / slice[i - 1].close))
  return out
}

const FACTOR_LABELS = {
  BTC:  ['crypto', 'store-of-value'],
  ETH:  ['crypto', 'smart-contract'],
  SOL:  ['crypto', 'smart-contract'],
  BNB:  ['crypto', 'exchange'],
  XRP:  ['crypto', 'payments'],
  DOGE: ['crypto', 'meme'],
  AVAX: ['crypto', 'smart-contract'],
  ADA:  ['crypto', 'smart-contract'],
  NVDA: ['semis-ai', 'growth', 'nasdaq'],
  TSLA: ['auto', 'growth', 'nasdaq', 'elon-beta'],
  AAPL: ['consumer-tech', 'mega-cap', 'nasdaq'],
  MSFT: ['cloud', 'mega-cap', 'nasdaq'],
  AMZN: ['cloud', 'retail', 'mega-cap', 'nasdaq'],
  GOOGL:['search', 'mega-cap', 'nasdaq'],
  META: ['social', 'mega-cap', 'nasdaq'],
  AMD:  ['semis-ai', 'growth', 'nasdaq'],
  COIN: ['crypto-equity', 'nasdaq', 'btc-beta'],
  MSTR: ['crypto-equity', 'btc-beta'],
}

/** Return the correlation of `symbol` returns to BTC returns using cached history. */
export function correlationToBtc(symbol) {
  if (symbol === 'BTC') return 1.0
  if (!HISTORY_SUPPORTED.includes(symbol)) return null
  const s = loadHistory(symbol)
  const btc = loadHistory('BTC')
  if (!s || !btc) return null
  const sr = toReturns(s.candles)
  const br = toReturns(btc.candles)
  const n = Math.min(sr.length, br.length)
  return correlation(sr.slice(-n), br.slice(-n))
}

/**
 * Analyze an open book.
 * positions = [{ asset, direction, notional, ... }]
 */
export function analyzePortfolio(positions, { nav = 25000 } = {}) {
  const open = (positions || []).filter(p => p.status === 'OPEN')
  if (!open.length) return { empty: true, nav, exposureUsd: 0, exposurePct: 0, positions: [] }

  const totalNotional = open.reduce((s, p) => s + p.notional, 0)

  const rows = open.map(p => {
    const meta = DEMO_UNIVERSE.find(u => u.symbol === p.asset)
    return {
      asset: p.asset,
      direction: p.direction,
      notional: p.notional,
      pctBook: Number((p.notional / totalNotional).toFixed(3)),
      pctNav: Number((p.notional / nav).toFixed(3)),
      sector: meta?.sector || 'Other',
      class: meta?.class || 'unknown',
      beta: meta?.beta ?? null,
      corrToBtc: correlationToBtc(p.asset),
      factors: FACTOR_LABELS[p.asset] || [],
    }
  })

  // Book-weighted BTC correlation (a simple proxy for crypto-beta exposure)
  const validCorr = rows.filter(r => r.corrToBtc != null)
  const bookBtcCorr = validCorr.length
    ? Number((validCorr.reduce((s, r) => s + r.corrToBtc * (r.notional / totalNotional), 0) * (validCorr.reduce((s, r) => s + r.notional, 0) / totalNotional)).toFixed(3))
    : null

  // Sector concentration
  const sectors = {}
  for (const r of rows) sectors[r.sector] = (sectors[r.sector] || 0) + r.notional
  const sectorRows = Object.entries(sectors)
    .map(([sector, notional]) => ({ sector, notional, pctNav: Number((notional / nav).toFixed(3)), pctBook: Number((notional / totalNotional).toFixed(3)) }))
    .sort((a, b) => b.notional - a.notional)

  // Factor concentration
  const factors = {}
  for (const r of rows) for (const f of r.factors) factors[f] = (factors[f] || 0) + r.notional
  const factorRows = Object.entries(factors)
    .map(([factor, notional]) => ({ factor, notional, pctBook: Number((notional / totalNotional).toFixed(3)) }))
    .sort((a, b) => b.notional - a.notional)

  // Advisory warnings
  const warnings = []
  const topSector = sectorRows[0]
  if (topSector && topSector.pctBook >= 0.5) warnings.push({ severity: 'MEDIUM', text: `${(topSector.pctBook * 100).toFixed(0)}% of your book is one sector (${topSector.sector}).` })
  const topFactor = factorRows[0]
  if (topFactor && topFactor.pctBook >= 0.6) warnings.push({ severity: 'HIGH', text: `${(topFactor.pctBook * 100).toFixed(0)}% of your book maps to a single factor (${topFactor.factor}).` })
  if (bookBtcCorr != null && bookBtcCorr >= 0.7) warnings.push({ severity: 'HIGH', text: `Effective book BTC-correlation is ${bookBtcCorr}. A single BTC dump moves the entire book.` })
  const bookExposurePct = totalNotional / nav
  if (bookExposurePct > 0.5) warnings.push({ severity: 'MEDIUM', text: `Book at ${(bookExposurePct * 100).toFixed(0)}% of NAV. Reduce size or add uncorrelated names.` })

  return {
    empty: false,
    nav,
    exposureUsd: totalNotional,
    exposurePct: Number(bookExposurePct.toFixed(3)),
    positions: rows,
    sectors: sectorRows,
    factors: factorRows,
    bookBtcCorrelation: bookBtcCorr,
    warnings,
  }
}
