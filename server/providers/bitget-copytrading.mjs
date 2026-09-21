/**
 * Bitget public copy-trading leaderboard.
 *
 * Fetches the same top-trader ranking that powers bitget.com/copy-trading/futures.
 * Endpoint is public (no API key required) but is served from the website's own
 * gateway, not api.bitget.com — so cross-venue relays and rate-limit rules that
 * apply to the market-data host don't apply here.
 *
 * We cache 15 min: rankings only shift once per hour on Bitget's side, and
 * every extra request just burns headroom on the shared endpoint.
 */

const ENDPOINT = process.env.BITGET_COPYTRADING_URL ||
  'https://www.bitget.com/v1/trigger/public/uta/rankingList'
const CACHE_MS = Number(process.env.BITGET_COPYTRADING_CACHE_MS || 15 * 60_000)
const TIMEOUT_MS = 8_000

const cache = new Map() // key → { at, value }

/** Sort options Bitget exposes on their leaderboard UI. */
export const SORT_FIELDS = {
  weekProfitRate:  '7D ROI',
  monthProfitRate: '30D ROI',
  totalProfit:     'All-time PnL',
  followCount:     'Followers',
}

/** Extract the numeric value for a labeled column in Bitget's itemVoList. */
function pickItem(items, code) {
  const row = items?.find(x => x.showColumnCode === code)
  if (!row) return null
  const n = Number(row.comparedValue)
  return Number.isFinite(n) ? n : null
}

/**
 * Fetch the top N Bitget copy-trading traders.
 *   sortField: one of SORT_FIELDS keys (default weekProfitRate)
 *   limit:     1-50 (default 20)
 */
export async function getTopTraders({ sortField = 'weekProfitRate', limit = 20 } = {}) {
  const size = Math.max(1, Math.min(50, Math.floor(limit)))
  const key = `${sortField}:${size}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value

  let body
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'language':     'en-US',
        'User-Agent':   'Mozilla/5.0 NightwatchAI/1.2 (research; +https://nightwatchai.watch)',
        'Accept':       'application/json',
      },
      body: JSON.stringify({
        pageNum: 1,
        pageSize: size,
        sortField,
        sortType: 'DESC',
        businessLine: 'MIX',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return hit?.value || null
    body = await res.json()
  } catch { return hit?.value || null }

  if (body?.code !== '200' || !Array.isArray(body?.data?.rows)) return hit?.value || null

  const traders = body.data.rows.map((row, rank) => {
    const items = row.itemVoList || []
    return {
      rank:            rank + 1,
      uid:             row.traderUid || null,
      displayName:     row.displayName || row.userName || row.traderNickName || `Trader ${rank + 1}`,
      avatar:          row.headPic || null,
      grade:           row.traderGrade?.gradeName || null,
      followers:       Number(row.followCount ?? 0),
      maxFollowers:    Number(row.maxFollowCount ?? 0),
      pnl30dUsd:       pickItem(items, 'total_income'),
      roiPct:          pickItem(items, 'profit_rate'),
      copierProfitUsd: pickItem(items, 'total_follow_profit'),
      aumUsd:          pickItem(items, 'total_follow_trade_amount'),
      mddPct:          pickItem(items, 'max_retracement'),
      openFollowProducts: Array.isArray(row.openFollowProducts) ? row.openFollowProducts.slice(0, 5) : [],
      canFollow:       Boolean(row.canTrace),
      profileUrl:      row.traderUid ? `https://www.bitget.com/copy-trading/futures-trader-detail/${row.traderUid}` : null,
      followUrl:       row.traderUid ? `https://www.bitget.com/copy-trading/futures-trader-detail/${row.traderUid}?tab=intro` : null,
    }
  })

  const value = {
    sortField, sortFieldLabel: SORT_FIELDS[sortField] || sortField,
    count: traders.length,
    total: Number(body.data.maxShowSizes || 0),
    traders,
    at: Date.now(),
    source: 'bitget-copytrading-public',
  }
  cache.set(key, { at: Date.now(), value })
  return value
}

export function copyTradingStatus() {
  const keys = [...cache.keys()]
  return {
    endpoint: ENDPOINT,
    cacheKeys: keys,
    cacheMs:   CACHE_MS,
  }
}
