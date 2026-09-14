/**
 * Paper capital account.
 *
 * Every user is issued a starting virtual balance. Allocations to Playbooks
 * withdraw from `free`, unfollow returns them. Paper PnL is tracked live using
 * real Bitget prices — no real funds are ever moved.
 */

import { getUser, upsertUser } from './lib/store.mjs'
import { logger } from './lib/log.mjs'

const STARTING = Number(process.env.PAPER_STARTING_CAPITAL || 10000)

export function paperAccount(userId) {
  const user = getUser(userId)
  if (!user) return null
  if (!user.paperAccount) {
    const pa = { startingCapital: STARTING, freeCapital: STARTING, allocatedCapital: 0, totalPnl: 0, createdAt: new Date().toISOString() }
    const next = upsertUser({ ...user, paperAccount: pa })
    return next.paperAccount
  }
  return user.paperAccount
}

/** Reserve capital for an allocation. Throws if insufficient. */
export function reserveCapital(userId, amountUsd) {
  const user = getUser(userId)
  const pa = paperAccount(userId)
  if (!pa) throw new Error('user not found')
  if (amountUsd <= 0) throw new Error('amount must be positive')
  if (amountUsd > pa.freeCapital) throw new Error(`insufficient paper capital ($${pa.freeCapital.toFixed(2)} available, $${amountUsd.toFixed(2)} requested)`)
  const next = {
    ...pa,
    freeCapital: Number((pa.freeCapital - amountUsd).toFixed(2)),
    allocatedCapital: Number((pa.allocatedCapital + amountUsd).toFixed(2)),
  }
  upsertUser({ ...user, paperAccount: next })
  return next
}

/** Return capital when an allocation is closed. Realized PnL folds into totalPnl. */
export function releaseCapital(userId, allocatedAmount, realizedPnl) {
  const user = getUser(userId)
  const pa = paperAccount(userId)
  if (!pa) throw new Error('user not found')
  const returned = allocatedAmount + realizedPnl
  const next = {
    ...pa,
    freeCapital: Number((pa.freeCapital + returned).toFixed(2)),
    allocatedCapital: Number(Math.max(0, pa.allocatedCapital - allocatedAmount).toFixed(2)),
    totalPnl: Number((pa.totalPnl + realizedPnl).toFixed(2)),
  }
  upsertUser({ ...user, paperAccount: next })
  return next
}

/** Reset back to starting. */
export function resetPaperAccount(userId) {
  const user = getUser(userId)
  const pa = { startingCapital: STARTING, freeCapital: STARTING, allocatedCapital: 0, totalPnl: 0, createdAt: new Date().toISOString(), resetAt: new Date().toISOString() }
  upsertUser({ ...user, paperAccount: pa })
  return pa
}

/** Combined view for the UI. */
export function paperSnapshot(userId) {
  const pa = paperAccount(userId)
  if (!pa) return null
  const totalCapital = Number((pa.freeCapital + pa.allocatedCapital).toFixed(2))
  const totalPnlPct = pa.startingCapital ? Number(((totalCapital + pa.totalPnl - pa.startingCapital) / pa.startingCapital).toFixed(4)) : 0
  return {
    ...pa,
    totalCapital,
    totalPnlPct,
  }
}
