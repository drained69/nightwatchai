/**
 * Free US-equity earnings calendar via NASDAQ public API.
 *
 * NASDAQ's `/api/calendar/earnings?date=YYYY-MM-DD` returns every ticker
 * reporting on that day. `/api/quote/{sym}/eps` returns the per-ticker EPS
 * history + upcoming-quarter consensus. Both are free, no auth, ~250ms.
 *
 * Strategy for "next earnings for each universe symbol":
 *   1. Walk forward day-by-day for up to 45 calendar days.
 *   2. For each day, fetch the calendar; note any hit whose symbol is in the
 *      equity universe. First hit wins.
 *   3. Cache the whole result for 12 hours (earnings dates rarely move).
 *
 * We also cache the per-symbol EPS consensus so the Analysis page can show
 * both "next date" and "consensus EPS estimate" together.
 */
import { logger } from '../lib/log.mjs'

const CACHE_MS  = Number(process.env.EARNINGS_CACHE_MS   || 12 * 60 * 60 * 1000)  // 12h
const TIMEOUT   = Number(process.env.EARNINGS_TIMEOUT_MS || 5000)
const HORIZON_DAYS = Number(process.env.EARNINGS_HORIZON_DAYS || 90)

// US-equity coverage universe (matches the 10 tokenized R-pairs on Bitget).
export const EQUITY_UNIVERSE = ['NVDA','TSLA','AAPL','MSFT','AMZN','GOOGL','META','AMD','COIN','MSTR']

// Nasdaq's API refuses server-side clients without matching Origin/Referer headers.
// The exact User-Agent doesn't matter; the origin does.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const NASDAQ_HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://www.nasdaq.com',
  'Referer': 'https://www.nasdaq.com/',
}

const cache = new Map()   // key → { at, value }
function getCached(k) {
  const h = cache.get(k)
  if (!h) return null
  if (Date.now() - h.at > CACHE_MS) { cache.delete(k); return null }
  return h.value
}
function setCached(k, v) { cache.set(k, { at: Date.now(), value: v }) }

function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { headers: NASDAQ_HEADERS, signal: AbortSignal.timeout(TIMEOUT) })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

/** Per-ticker consensus EPS + fiscal period for the next reporting quarter. */
async function fetchEpsConsensus(symbol) {
  const url = `https://api.nasdaq.com/api/quote/${symbol.toLowerCase()}/eps`
  const body = await fetchJson(url)
  const rows = body?.data?.earningsPerShare || []
  const upcoming = rows.find(r => r?.type === 'UpcomingQuarter')
  const lastActual = [...rows].reverse().find(r => r?.type === 'PreviousQuarter' && r?.earnings != null)
  const lastSurprise = lastActual && lastActual.consensus != null
    ? Number(((lastActual.earnings - lastActual.consensus) / Math.abs(lastActual.consensus)).toFixed(3))
    : null
  return {
    epsEstimate:  upcoming?.consensus ?? null,
    epsPeriod:    upcoming?.period    ?? null,
    epsLastActual:   lastActual?.earnings ?? null,
    epsLastConsensus: lastActual?.consensus ?? null,
    epsLastSurprise: lastSurprise,
    epsLastPeriod: lastActual?.period ?? null,
  }
}

/**
 * Scan the next HORIZON_DAYS of Nasdaq's daily calendar in parallel and index
 * every universe hit into a map keyed by symbol. Cached at module level for
 * CACHE_MS since the whole map is expensive but earnings dates rarely move.
 */
let _calendarMapPromise = null
async function loadUniverseCalendarMap() {
  const cached = getCached('calendar-map')
  if (cached) return cached
  if (_calendarMapPromise) return _calendarMapPromise
  _calendarMapPromise = (async () => {
    const start = new Date()
    const dates = []
    for (let i = 0; i < HORIZON_DAYS; i++) {
      dates.push(new Date(start.getTime() + i * 86_400_000))
    }
    // Nasdaq is happy with modest fan-out; do all 45 in parallel.
    const results = await Promise.all(dates.map(async d => {
      const dateStr = ymd(d)
      const body = await fetchJson(`https://api.nasdaq.com/api/calendar/earnings?date=${dateStr}`)
      return { date: dateStr, at: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), rows: body?.data?.rows || [] }
    }))
    const map = new Map()   // symbol → { date, at, timeSlot }
    for (const day of results) {
      for (const row of day.rows) {
        const sym = String(row?.symbol || '').toUpperCase()
        if (!EQUITY_UNIVERSE.includes(sym)) continue
        if (map.has(sym)) continue     // first (soonest) occurrence wins
        map.set(sym, { date: day.date, at: day.at, timeSlot: row.time || null })
      }
    }
    setCached('calendar-map', map)
    return map
  })()
  const out = await _calendarMapPromise
  _calendarMapPromise = null
  return out
}

async function findNextEarningsDate(symbol) {
  const map = await loadUniverseCalendarMap()
  return map.get(String(symbol || '').toUpperCase()) || null
}

/**
 * Per-symbol earnings snapshot:
 *   { symbol, nextEarningsAt, nextEarningsDate, daysToNext, timeSlot,
 *     epsEstimate, epsPeriod, epsLastActual, epsLastConsensus, epsLastSurprise, epsLastPeriod,
 *     source, at }
 * Returns null on total failure.
 */
export async function getEarningsFor(symbol) {
  const sym = String(symbol || '').toUpperCase()
  if (!sym) return null
  const cached = getCached(`eps:${sym}`)
  if (cached) return cached
  try {
    const [next, eps] = await Promise.all([
      findNextEarningsDate(sym),
      fetchEpsConsensus(sym),
    ])
    if (!next && !eps.epsEstimate) return null
    const daysToNext = next?.at != null
      ? Math.max(0, Math.round((next.at - Date.now()) / 86_400_000))
      : null
    const value = {
      symbol: sym,
      nextEarningsAt:   next?.at ?? null,
      nextEarningsDate: next?.date ?? null,
      daysToNext,
      timeSlot: next?.timeSlot ?? null,
      ...eps,
      source: 'nasdaq-public',
      at: Date.now(),
    }
    setCached(`eps:${sym}`, value)
    return value
  } catch (err) {
    logger.debug({ symbol: sym, err: err.message }, 'earnings fetch failed')
    return null
  }
}

/**
 * Batch: earnings for the whole equity universe (or a caller-supplied list),
 * sorted by soonest-upcoming date. Symbols with no coverage are dropped.
 */
export async function getUpcomingEarnings({ symbols = EQUITY_UNIVERSE, limit = 5 } = {}) {
  const cached = getCached(`upcoming:${symbols.join(',')}:${limit}`)
  if (cached) return cached
  const list = await Promise.all(symbols.map(s => getEarningsFor(s).catch(() => null)))
  const rows = list
    .filter(x => x && x.nextEarningsAt && x.nextEarningsAt > Date.now() - 86_400_000)   // include today
    .sort((a, b) => a.nextEarningsAt - b.nextEarningsAt)
    .slice(0, limit)
  setCached(`upcoming:${symbols.join(',')}:${limit}`, rows)
  return rows
}
