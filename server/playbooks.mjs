/**
 * Playbook registry.
 *
 * A Playbook is a named, published strategy — plain-language description +
 * signal conditions + exit conditions + sizing rule. Playbooks are backtested
 * against cached historical Bitget candles at publish time.
 *
 * Users can create their own, publish them for others to see, and follow
 * (allocate paper capital) to other people's Playbooks. Real prices drive the
 * paper-PnL leaderboard.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { paths } from './lib/store.mjs'
import { loadHistory } from './history.mjs'
import { getTicker } from './providers/bitget.mjs'
import { runPlaybookBacktest } from '../src/backtest.js'
import { parseAlert } from './alerts.mjs'
import { logger } from './lib/log.mjs'

const FILE = path.join(paths.DATA_DIR, 'playbooks.json')
fs.mkdirSync(paths.DATA_DIR, { recursive: true })

const CANONICAL_STARTERS = [                       // seeded on first boot so Explore is not empty
  {
    id: 'pb-btc-etf-flow-follow',
    title: 'BTC ETF flow follow',
    description: 'Long BTC when spot ETF inflow week is > $500M and Fear & Greed > 50. Exit when RSI > 75 or drawdown > 5%.',
    asset: 'BTC', direction: 'LONG',
    signalConditions: [{ field: 'etfTrailing5UsdM', op: '>', value: 500 }, { field: 'fearGreed', op: '>', value: 50 }],
    exitConditions:   [{ field: 'rsi14', op: '>', value: 75 }, { field: 'drawdownFromEntry', op: '<', value: -0.05 }],
    sizing: { type: 'fixed_pct_of_capital', value: 0.15 },
    tags: ['btc', 'etf', 'macro'],
  },
  {
    id: 'pb-eth-oversold-bounce',
    title: 'ETH oversold bounce',
    description: 'Long ETH when RSI < 30 and BTC 24h > -3% (crypto risk not off). Exit at RSI > 55 or 3%-of-entry stop.',
    asset: 'ETH', direction: 'LONG',
    signalConditions: [{ field: 'rsi14', op: '<', value: 30 }, { field: 'btc24hChange', op: '>', value: -3 }],
    exitConditions:   [{ field: 'rsi14', op: '>', value: 55 }, { field: 'drawdownFromEntry', op: '<', value: -0.03 }],
    sizing: { type: 'fixed_pct_of_capital', value: 0.10 },
    tags: ['eth', 'mean-revert'],
  },
  {
    id: 'pb-sol-breakout-follow',
    title: 'SOL breakout follow',
    description: 'Long SOL when 24h > +6% and volume z-score > 1.5 and BTC 24h > 0. Exit at RSI > 78 or 4% stop.',
    asset: 'SOL', direction: 'LONG',
    signalConditions: [{ field: 'change24h', op: '>', value: 6 }, { field: 'btc24hChange', op: '>', value: 0 }],
    exitConditions:   [{ field: 'rsi14', op: '>', value: 78 }, { field: 'drawdownFromEntry', op: '<', value: -0.04 }],
    sizing: { type: 'fixed_pct_of_capital', value: 0.08 },
    tags: ['sol', 'momentum'],
  },
  {
    id: 'pb-fund-skew-arb',
    title: 'BTC funding-skew arbitrage',
    description: 'Long BTC when cross-venue funding skew > 3 bps and mean funding rate < 0 (venues disagree; longs paying shorts on some).',
    asset: 'BTC', direction: 'LONG',
    signalConditions: [{ field: 'fundingSkewBps', op: '>', value: 3 }, { field: 'fundingRate', op: '<', value: 0 }],
    exitConditions:   [{ field: 'fundingSkewBps', op: '<', value: 1 }],
    sizing: { type: 'fixed_pct_of_capital', value: 0.12 },
    tags: ['btc', 'derivatives'],
  },
]

/**
 * Store integrity note: `db.playbooks` (array) is the single source of truth.
 * `db.byId` is a derived index, rebuilt on every save. (A previous version
 * mutated `byId` and the array independently; after any JSON round-trip they
 * are separate objects, so backtests/publish state silently diverged.)
 * loadDb() also heals legacy files by merging byId-only fields back.
 */
function loadDb() {
  let db = null
  try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { /* seed below */ }
  if (!db || !Array.isArray(db.playbooks) || !db.playbooks.length) {
    db = { playbooks: CANONICAL_STARTERS.map(seedify), byId: {} }
  } else if (db.byId) {
    // Heal legacy divergence: fold byId-only state back into the array copies.
    for (const p of db.playbooks) {
      const b = db.byId[p.id]
      if (!b) continue
      if (b.backtest && !p.backtest) p.backtest = b.backtest
      if (b.published !== undefined && b.updatedAt && !p.updatedAt) p.published = b.published
      const bPos = b.runtime?.position, pPos = p.runtime?.position
      if (bPos && !pPos) p.runtime = b.runtime
      else if (bPos && pPos && new Date(b.runtime.lastEvaluatedAt || 0) > new Date(p.runtime.lastEvaluatedAt || 0)) p.runtime = b.runtime
      if (b.lastClose && !p.lastClose) p.lastClose = b.lastClose
      if ((b.followers ?? 0) > (p.followers ?? 0)) { p.followers = b.followers; p.totalAllocatedUsd = b.totalAllocatedUsd }
    }
  }
  reindex(db)
  return db
}
function reindex(db) {
  db.byId = {}
  for (const p of db.playbooks) db.byId[p.id] = p
}
function saveDb(db) {
  reindex(db)
  fs.writeFileSync(FILE, JSON.stringify(db))
}
/** Find a playbook in the canonical array (never trust the persisted index). */
function find(db, id) { return db.playbooks.find(p => p.id === id) || null }
function seedify(p) {
  return {
    ...p,
    ownerUserId: null,
    ownerName: 'NIGHTWATCH',
    createdAt: new Date().toISOString(),
    published: true,
    canonical: true,
    followers: 0,
    totalAllocatedUsd: 0,
    backtest: null,
    runtime: { position: null, lastEvaluatedAt: null },
  }
}

export function listPlaybooks({ publishedOnly = true, limit = 100 } = {}) {
  const db = loadDb()
  return db.playbooks.filter(p => (publishedOnly ? p.published : true)).slice(0, limit)
}

export function getPlaybook(id) {
  const db = loadDb()
  return find(db, id)
}

export function createPlaybook(userId, { ownerName, title, description, asset, direction = 'LONG', signalConditions, exitConditions, sizing, tags = [] }) {
  if (!title || !asset) throw new Error('title and asset required')
  const db = loadDb()
  const id = `pb-${crypto.randomBytes(6).toString('hex')}`
  const pb = {
    id,
    title: String(title).slice(0, 120),
    description: String(description || '').slice(0, 800),
    asset: String(asset).toUpperCase(),
    direction: direction === 'SHORT' ? 'SHORT' : 'LONG',
    signalConditions: Array.isArray(signalConditions) ? signalConditions.slice(0, 6) : [],
    exitConditions:   Array.isArray(exitConditions)   ? exitConditions.slice(0, 6)   : [],
    sizing: sizing || { type: 'fixed_pct_of_capital', value: 0.10 },
    tags: Array.isArray(tags) ? tags.slice(0, 6) : [],
    ownerUserId: userId,
    ownerName: ownerName || 'anonymous',
    createdAt: new Date().toISOString(),
    published: false,
    canonical: false,
    followers: 0,
    totalAllocatedUsd: 0,
    backtest: null,
    runtime: { position: null, lastEvaluatedAt: null },
  }
  db.playbooks.push(pb)
  saveDb(db)
  return pb
}

export function updatePlaybook(userId, id, patch) {
  const db = loadDb()
  const p = find(db, id)
  if (!p) throw new Error('playbook not found')
  if (p.ownerUserId !== userId && !p.canonical) throw new Error('not owner')
  const allowed = ['title', 'description', 'asset', 'direction', 'signalConditions', 'exitConditions', 'sizing', 'tags']
  for (const k of allowed) if (k in patch) p[k] = patch[k]
  saveDb(db)
  return p
}

export function publishPlaybook(userId, id, publish = true) {
  const db = loadDb()
  const p = find(db, id)
  if (!p) throw new Error('playbook not found')
  if (p.ownerUserId !== userId) throw new Error('not owner')
  p.published = Boolean(publish)
  saveDb(db)
  return p
}

export function deletePlaybook(userId, id) {
  const db = loadDb()
  const p = find(db, id)
  if (!p) return
  if (p.ownerUserId !== userId) throw new Error('not owner')
  db.playbooks = db.playbooks.filter(x => x.id !== id)
  saveDb(db)
}

/** Replay the playbook's OWN conditions on cached real candles and store the result. */
export function backtestPlaybook(id, { maxHoldBars = 168 } = {}) {
  const db = loadDb()
  const p = find(db, id)
  if (!p) throw new Error('playbook not found')
  const h = loadHistory(p.asset)
  if (!h) throw new Error(`no cached history for ${p.asset} — /history/warm first`)
  const btc = p.asset === 'BTC' ? h : loadHistory('BTC')
  const result = runPlaybookBacktest(p, h.candles, { btcCandles: btc?.candles || null, maxHoldBars })
  p.backtest = {
    ...result,
    candleCount: h.candles.length,
    updatedAt: new Date().toISOString(),
  }
  saveDb(db)
  return p.backtest
}

/** Simple heuristic to evaluate a playbook against current live data. */
function meets(op, a, b) { switch (op) { case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b; case '==': return a == b; case '!=': return a != b; default: return false } }
function evalConds(conds, ctx) { return conds.every(c => meets(c.op, ctx[c.field], c.value)) }

/**
 * Compute the current PnL of each open allocation's mirror position by pricing
 * against the live Bitget ticker.
 */
export async function markPositions() {
  const db = loadDb()
  let dirty = false
  for (const p of db.playbooks) {
    if (!p.runtime?.position) continue
    const ticker = await getTicker(p.asset).catch(() => null)
    if (!ticker?.last) continue
    const pos = p.runtime.position
    const move = (ticker.last - pos.entryPrice) / pos.entryPrice
    const pnlPct = p.direction === 'LONG' ? move : -move
    p.runtime.position = { ...pos, currentPrice: ticker.last, pnlPct: Number(pnlPct.toFixed(4)) }
    dirty = true
  }
  if (dirty) saveDb(db)
}

/**
 * Mint a new position for a playbook if signal conditions match against the
 * evaluated context. Runs periodically from the adapter.
 */
export async function evaluatePlaybook(id, ctxProvider) {
  const db = loadDb()
  const p = find(db, id)
  if (!p || !p.published) return null
  const ctx = await ctxProvider(p.asset)
  if (!ctx) return null
  if (!p.runtime?.position && p.signalConditions.length && evalConds(p.signalConditions, ctx)) {
    const ticker = await getTicker(p.asset).catch(() => null)
    if (ticker?.last) {
      p.runtime = { ...p.runtime, position: { entryPrice: ticker.last, currentPrice: ticker.last, pnlPct: 0, openedAt: new Date().toISOString() }, lastEvaluatedAt: new Date().toISOString() }
      saveDb(db)
      return { opened: true, playbookId: id }
    }
  }
  if (p.runtime?.position && p.exitConditions.length && evalConds(p.exitConditions, { ...ctx, drawdownFromEntry: p.runtime.position.pnlPct })) {
    const closed = { ...p.runtime.position, closedAt: new Date().toISOString(), realizedPnlPct: p.runtime.position.pnlPct }
    p.runtime = { position: null, lastClose: closed, lastEvaluatedAt: new Date().toISOString() }
    saveDb(db)
    return { closed, playbookId: id }
  }
  return null
}

/** Update follower / capital counters. */
export function incFollowers(playbookId, delta, deltaCapital) {
  const db = loadDb()
  const p = find(db, playbookId)
  if (!p) return
  p.followers = Math.max(0, (p.followers || 0) + delta)
  p.totalAllocatedUsd = Math.max(0, Number(((p.totalAllocatedUsd || 0) + deltaCapital).toFixed(2)))
  saveDb(db)
}
