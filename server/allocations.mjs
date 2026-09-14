/**
 * Allocations — per-user follow of a Playbook.
 *
 * When a user allocates $X paper capital to a Playbook, the corresponding
 * amount is reserved from their paperAccount.free. Their PnL mirrors the
 * playbook's runtime position PnL until unfollowed (at which point the
 * realized PnL folds back into their totalPnl).
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { paths } from './lib/store.mjs'
import { getPlaybook, incFollowers } from './playbooks.mjs'
import { reserveCapital, releaseCapital } from './paper.mjs'
import { logger } from './lib/log.mjs'

const FILE = path.join(paths.DATA_DIR, 'allocations.json')

function loadDb() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return { byUser: {}, byPlaybook: {} } } }
function saveDb(db) { fs.writeFileSync(FILE, JSON.stringify(db)) }

export function listAllocations(userId) {
  const db = loadDb()
  return db.byUser[userId] || []
}

export function follow(userId, playbookId, amountUsd) {
  const pb = getPlaybook(playbookId)
  if (!pb) throw new Error('playbook not found')
  if (!pb.published) throw new Error('playbook not published')
  if (amountUsd <= 0) throw new Error('amount required')
  reserveCapital(userId, amountUsd)
  const db = loadDb()
  db.byUser[userId] = db.byUser[userId] || []
  const existing = db.byUser[userId].find(a => a.playbookId === playbookId && !a.closedAt)
  if (existing) {
    // Adding to existing allocation
    existing.allocatedUsd = Number((existing.allocatedUsd + amountUsd).toFixed(2))
  } else {
    const alloc = {
      id: `alloc-${crypto.randomBytes(6).toString('hex')}`,
      userId, playbookId,
      allocatedUsd: Number(amountUsd.toFixed(2)),
      startedAt: new Date().toISOString(),
      currentPnlPct: 0,
      currentPnlUsd: 0,
      closedAt: null,
      realizedPnlUsd: 0,
    }
    db.byUser[userId].push(alloc)
    db.byPlaybook[playbookId] = db.byPlaybook[playbookId] || []
    db.byPlaybook[playbookId].push(alloc.id)
  }
  saveDb(db)
  incFollowers(playbookId, existing ? 0 : 1, amountUsd)
  return db.byUser[userId].find(a => a.playbookId === playbookId && !a.closedAt)
}

export function unfollow(userId, playbookId) {
  const db = loadDb()
  const alloc = (db.byUser[userId] || []).find(a => a.playbookId === playbookId && !a.closedAt)
  if (!alloc) throw new Error('not currently allocated')
  const realized = alloc.currentPnlUsd
  releaseCapital(userId, alloc.allocatedUsd, realized)
  alloc.closedAt = new Date().toISOString()
  alloc.realizedPnlUsd = realized
  saveDb(db)
  incFollowers(playbookId, -1, -alloc.allocatedUsd)
  return alloc
}

/** Update every open allocation's currentPnl from the underlying playbook position. */
export function markAll() {
  const db = loadDb()
  let touched = 0
  for (const userId in db.byUser) {
    for (const a of db.byUser[userId]) {
      if (a.closedAt) continue
      const pb = getPlaybook(a.playbookId)
      if (!pb) continue
      const pos = pb.runtime?.position
      const pnlPct = pos?.pnlPct ?? 0
      a.currentPnlPct = pnlPct
      a.currentPnlUsd = Number((a.allocatedUsd * pnlPct).toFixed(2))
      touched++
    }
  }
  if (touched) saveDb(db)
  return touched
}

/** Followers of a playbook: sum of capital + count. */
export function followerStats(playbookId) {
  const db = loadDb()
  let totalUsd = 0, count = 0
  for (const userId in db.byUser) {
    for (const a of db.byUser[userId]) {
      if (a.playbookId === playbookId && !a.closedAt) { totalUsd += a.allocatedUsd; count++ }
    }
  }
  return { totalCapitalUsd: Number(totalUsd.toFixed(2)), followerCount: count }
}
