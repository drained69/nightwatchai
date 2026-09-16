/**
 * Public leaderboard of Playbooks.
 *
 * Ranks published Playbooks by trailing 30-day paper PnL (from backtest),
 * follower count, and current live PnL of the active position.
 */

import { listPlaybooks } from './playbooks.mjs'
import { followerStats } from './allocations.mjs'

export function leaderboard({ sort = 'return', limit = 50 } = {}) {
  const rows = listPlaybooks({ publishedOnly: true, limit: 500 }).map(p => {
    const followers = followerStats(p.id)
    const backtestable = p.backtest?.backtestable ?? null
    return {
      id: p.id,
      title: p.title,
      asset: p.asset,
      direction: p.direction,
      ownerName: p.ownerName,
      canonical: p.canonical,
      totalReturnPct: p.backtest?.totalReturnPct ?? p.backtest?.meanForward ?? null,
      backtestable,
      backtestMissing: p.backtest?.missing || null,
      winRate: p.backtest?.winRate ?? null,
      longAccuracy:  p.backtest?.longAccuracy ?? null,
      shortAccuracy: p.backtest?.shortAccuracy ?? null,
      precisionOnMove: p.backtest?.precisionOnMove ?? null,
      lift: p.backtest?.lift ?? null,
      tradeCount: p.backtest?.tradeCount ?? 0,
      followers: followers.followerCount,
      totalAllocatedUsd: followers.totalCapitalUsd,
      livePnlPct: p.runtime?.position?.pnlPct ?? null,
      hasOpenPosition: Boolean(p.runtime?.position),
      tags: p.tags || [],
      createdAt: p.createdAt,
    }
  })
  const key = sort === 'followers' ? 'followers'
            : sort === 'capital'   ? 'totalAllocatedUsd'
            : sort === 'recent'    ? 'createdAt'
            : sort === 'live'      ? 'livePnlPct'
            : 'totalReturnPct'
  const desc = sort !== 'recent'
  rows.sort((a, b) => {
    // On "return" sort, rows that couldn't be backtested (live-context only)
    // always fall to the bottom regardless of the null value ordering, so real
    // backtested playbooks headline the leaderboard.
    if (key === 'totalReturnPct') {
      const aOk = a.backtestable === true, bOk = b.backtestable === true
      if (aOk !== bOk) return aOk ? -1 : 1
    }
    const av = a[key] ?? (desc ? -Infinity : Infinity)
    const bv = b[key] ?? (desc ? -Infinity : Infinity)
    if (av === bv) return 0
    return desc ? (av < bv ? 1 : -1) : (av < bv ? -1 : 1)
  })
  return rows.slice(0, limit)
}
