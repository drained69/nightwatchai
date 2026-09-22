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

/**
 * Credit (or debit) a realized PnL amount from a self-directed paper trade —
 * i.e. a position the user opened by approving a research report and then
 * closed at mark. Both freeCapital AND totalPnl move by the same amount so
 * the running capital reflects real trades in real time.
 *
 * Idempotent via `sourceId` (the paper position id): a second call with the
 * same source is a no-op, so accidental client double-taps or reloads while a
 * request is in flight cannot double-credit the account.
 */
export function creditPnl(userId, amountUsd, sourceId) {
  const user = getUser(userId)
  const pa = paperAccount(userId)
  if (!pa) throw new Error('user not found')
  const applied = new Set(user.paperCredits || [])
  const key = String(sourceId || '')
  if (!key) throw new Error('sourceId required')
  if (applied.has(key)) {
    return { credited: false, reason: 'already-applied', paper: paperSnapshot(userId) }
  }
  const delta = Number(amountUsd)
  if (!Number.isFinite(delta)) throw new Error('amountUsd must be a finite number')
  const next = {
    ...pa,
    freeCapital: Number((pa.freeCapital + delta).toFixed(2)),
    totalPnl:    Number((pa.totalPnl    + delta).toFixed(2)),
  }
  applied.add(key)
  // Cap the applied set at 1000 recent entries to bound file size while
  // preserving idempotency for the last ~1000 trades. FIFO eviction — order
  // preserved because `applied` was constructed from an array.
  const trimmed = Array.from(applied)
  const kept = trimmed.length > 1000 ? trimmed.slice(-1000) : trimmed
  upsertUser({ ...user, paperAccount: next, paperCredits: kept })
  logger.info({ userId, sourceId: key, amountUsd: delta, newFree: next.freeCapital, newPnl: next.totalPnl }, 'paper pnl credited')
  return { credited: true, delta, paper: paperSnapshot(userId) }
}

/** Reset back to starting. Also wipes the idempotency ledger so historical
 *  paper-trade credits from the previous cycle can't block a re-play. */
export function resetPaperAccount(userId) {
  const user = getUser(userId)
  const pa = { startingCapital: STARTING, freeCapital: STARTING, allocatedCapital: 0, totalPnl: 0, createdAt: new Date().toISOString(), resetAt: new Date().toISOString() }
  upsertUser({ ...user, paperAccount: pa, paperCredits: [] })
  return pa
}

/**
 * Reserve capital for a trader-approved paper position from a research report.
 * Idempotent by sourceId (the paper position id) so a client retry or double
 * APPROVE click cannot double-debit the account. Returns the current snapshot
 * on a duplicate call instead of throwing.
 */
export function reserveForPosition(userId, sourceId, amountUsd) {
  const user = getUser(userId)
  if (!user) throw new Error('user not found')
  const key = String(sourceId || '')
  if (!key) throw new Error('sourceId required')
  const reservations = new Set(user.paperReservations || [])
  if (reservations.has(key)) return { reserved: false, reason: 'already-reserved', paper: paperSnapshot(userId) }
  const next = reserveCapital(userId, amountUsd)
  reservations.add(key)
  const kept = Array.from(reservations)
  const trimmed = kept.length > 1000 ? kept.slice(-1000) : kept
  upsertUser({ ...getUser(userId), paperReservations: trimmed })
  logger.info({ userId, sourceId: key, amountUsd, newFree: next.freeCapital, newAllocated: next.allocatedCapital }, 'paper capital reserved')
  return { reserved: true, paper: paperSnapshot(userId) }
}

/**
 * Release capital + credit realized P&L for a closed paper position. Combines
 * releaseCapital + creditPnl into one idempotent operation (by sourceId) so a
 * CLOSE-AT-MARK on a research-approved trade cleanly returns the reserved
 * capital AND folds the P&L into totalPnl in a single hop.
 *
 * Backwards-compatible: if there is no reservation for `sourceId` (position
 * opened before the reserve-on-approve flow shipped, or a legacy /paper/credit
 * caller), only the P&L is credited — no allocatedCapital change.
 */
export function releaseAndCredit(userId, sourceId, amountUsd, realizedPnl) {
  const user = getUser(userId)
  if (!user) throw new Error('user not found')
  const pa = paperAccount(userId)
  if (!pa) throw new Error('paper account not found')
  const key = String(sourceId || '')
  if (!key) throw new Error('sourceId required')
  const credits = new Set(user.paperCredits || [])
  if (credits.has(key)) return { credited: false, reason: 'already-applied', paper: paperSnapshot(userId) }

  const pnl = Number.isFinite(Number(realizedPnl)) ? Number(realizedPnl) : 0
  const reserved = Number.isFinite(Number(amountUsd)) ? Number(amountUsd) : 0
  const hadReservation = (user.paperReservations || []).includes(key)
  // Return the reserved capital (if any) + fold P&L into totalPnl. When no
  // reservation was on record we still credit P&L for backwards compat.
  const capitalReturn = hadReservation ? reserved : 0
  const next = {
    ...pa,
    freeCapital:       Number((pa.freeCapital + capitalReturn + pnl).toFixed(2)),
    allocatedCapital:  Number(Math.max(0, pa.allocatedCapital - capitalReturn).toFixed(2)),
    totalPnl:          Number((pa.totalPnl + pnl).toFixed(2)),
  }
  credits.add(key)
  const reservations = (user.paperReservations || []).filter(k => k !== key)
  const kept = Array.from(credits)
  const trimmed = kept.length > 1000 ? kept.slice(-1000) : kept
  upsertUser({ ...user, paperAccount: next, paperCredits: trimmed, paperReservations: reservations })
  logger.info({ userId, sourceId: key, amountUsd: pnl, capitalReleased: capitalReturn, newFree: next.freeCapital, newAllocated: next.allocatedCapital, newPnl: next.totalPnl }, 'paper position released')
  return { credited: true, delta: pnl, capitalReleased: capitalReturn, paper: paperSnapshot(userId) }
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
