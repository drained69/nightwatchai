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

/**
 * Fetch (or create) a user's paper account. Every account is seeded with the
 * configured STARTING capital (default $10,000). If a legacy account exists
 * with a different starting capital — a dev account from before this rule was
 * standardised, or an account created under an old env var — it is migrated
 * up (or down) so that every user is on an equal footing.
 *
 * Migration rules:
 *   - No paperAccount     → issue a fresh $STARTING account.
 *   - Wrong starting cap  → rebase to $STARTING, preserving current PnL and
 *                            proportional allocation (allocatedCapital never
 *                            goes below 0). This is deliberate: we want
 *                            *every* account to start from $10K, even if the
 *                            user has already used the app.
 */
export function paperAccount(userId) {
  const user = getUser(userId)
  if (!user) return null
  const existing = user.paperAccount
  if (!existing) {
    const pa = { startingCapital: STARTING, freeCapital: STARTING, allocatedCapital: 0, totalPnl: 0, createdAt: new Date().toISOString() }
    const next = upsertUser({ ...user, paperAccount: pa })
    return next.paperAccount
  }
  if (existing.startingCapital !== STARTING) {
    // Rebase to the current starting capital. Keep the allocation the account
    // already holds against Playbooks so the user's followed positions don't
    // silently disappear, but wipe realized PnL so every account restarts on equal footing.
    const allocated = Math.max(0, Number(existing.allocatedCapital) || 0)
    const pa = {
      startingCapital: STARTING,
      allocatedCapital: Math.min(allocated, STARTING),
      freeCapital: Number(Math.max(0, STARTING - Math.min(allocated, STARTING)).toFixed(2)),
      totalPnl: 0,
      createdAt: existing.createdAt || new Date().toISOString(),
      rebasedAt: new Date().toISOString(),
      previousStartingCapital: existing.startingCapital,
    }
    logger.info({ userId, from: existing.startingCapital, to: STARTING }, 'paper account rebased to standard $10K starting capital')
    const next = upsertUser({ ...user, paperAccount: pa })
    return next.paperAccount
  }
  return existing
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
