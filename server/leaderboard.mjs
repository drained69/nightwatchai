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
    return {
      id: p.id,
      title: p.title,
      asset: p.asset,
      direction: p.direction,
      ownerName: p.ownerName,
      canonical: p.canonical,
      totalReturnPct: p.backtest?.totalReturnPct ?? p.backtest?.meanForward ?? null,
      backtestable: p.backtest?.backtestable ?? null,
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
  const dir = sort === 'recent' ? -1 : 1
  rows.sort((a, b) => {
    const av = a[key] ?? -Infinity, bv = b[key] ?? -Infinity
    return av < bv ? dir : av > bv ? -dir : 0
  })
  return rows.slice(0, limit)
}
