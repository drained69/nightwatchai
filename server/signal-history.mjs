/**
 * Public signal history + accuracy scorekeeper.
 *
 * When the /research endpoint emits a SIGNAL, we record it here with the
 * inputs. A periodic evaluator resolves signals older than the horizon by
 * fetching the realized price and computing whether the direction was correct.
 *
 * Exposed at /signals/history (public read-only).
 */

import fs from 'node:fs'
import path from 'node:path'
import { getTicker } from './providers/bitget.mjs'
import { paths } from './lib/store.mjs'
import { logger } from './lib/log.mjs'

const SIGNALS_FILE = path.join(paths.DATA_DIR, 'public-signals.json')
const HORIZON_HOURS = Number(process.env.SIGNAL_HORIZON_HOURS || 8)
const EVAL_INTERVAL_MS = Number(process.env.SIGNAL_EVAL_MS || 5 * 60_000)

fs.mkdirSync(paths.DATA_DIR, { recursive: true })

function load() {
  try { return JSON.parse(fs.readFileSync(SIGNALS_FILE, 'utf8')) } catch { return { signals: [] } }
}
function save(state) { fs.writeFileSync(SIGNALS_FILE, JSON.stringify(state)) }

/** Record an emitted signal for future evaluation. */
export function recordSignal({ symbol, direction, confidence, netEdge, entryPrice, catalyst, reportId }) {
  const state = load()
  const record = {
    id: `pubsig-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`,
    symbol,
    direction,
    confidence,
    netEdge,
    entryPrice,
    catalyst,
    reportId,
    createdAt: new Date().toISOString(),
    horizonHours: HORIZON_HOURS,
    resolvedAt: null,
    exitPrice: null,
    forwardReturn: null,
    outcome: null,       // 'HIT' | 'MISS' | 'FLAT'
  }
  state.signals.push(record)
  if (state.signals.length > 500) state.signals = state.signals.slice(-500)
  save(state)
  return record
}

/** Resolve signals older than the horizon. */
export async function evaluatePending() {
  const state = load()
  const cutoff = Date.now() - HORIZON_HOURS * 3600_000
  let changed = 0
  for (const s of state.signals) {
    if (s.resolvedAt) continue
    if (new Date(s.createdAt).getTime() > cutoff) continue
    const ticker = await getTicker(s.symbol)
    if (!ticker?.last) continue
    const forward = (ticker.last - s.entryPrice) / s.entryPrice
    const correct = (s.direction === 'LONG' && forward > 0) || (s.direction === 'SHORT' && forward < 0)
    s.resolvedAt = new Date().toISOString()
    s.exitPrice = ticker.last
    s.forwardReturn = Number(forward.toFixed(4))
    s.outcome = Math.abs(forward) < 0.002 ? 'FLAT' : correct ? 'HIT' : 'MISS'
    changed++
  }
  if (changed) { save(state); logger.info({ resolved: changed }, 'signal history evaluated') }
  return changed
}

/** Aggregate stats. */
export function stats() {
  const state = load()
  const resolved = state.signals.filter(s => s.resolvedAt)
  const hits = resolved.filter(s => s.outcome === 'HIT').length
  const misses = resolved.filter(s => s.outcome === 'MISS').length
  const flats = resolved.filter(s => s.outcome === 'FLAT').length
  const total = resolved.length
  const bySymbol = {}
  for (const s of resolved) {
    if (!bySymbol[s.symbol]) bySymbol[s.symbol] = { hits: 0, misses: 0, flats: 0, total: 0, meanForward: 0 }
    const b = bySymbol[s.symbol]
    b.total++
    b[s.outcome.toLowerCase() + 's']++
    b.meanForward += s.forwardReturn
  }
  for (const k in bySymbol) bySymbol[k].meanForward = Number((bySymbol[k].meanForward / bySymbol[k].total).toFixed(4))
  return {
    total: state.signals.length,
    resolved: total,
    pending: state.signals.length - total,
    hits, misses, flats,
    hitRate: total ? Number((hits / (hits + misses)).toFixed(3)) : null,
    meanForwardReturn: total ? Number((resolved.reduce((s, x) => s + x.forwardReturn, 0) / total).toFixed(4)) : null,
    bySymbol,
    horizonHours: HORIZON_HOURS,
  }
}

/** Public read-only listing. */
export function list(limit = 100) {
  const state = load()
  return state.signals.slice(-limit).reverse()
}

/** Start the periodic evaluator. */
export function startEvaluator() {
  const t = setInterval(() => evaluatePending().catch(err => logger.warn({ err: err.message }, 'signal eval failed')), EVAL_INTERVAL_MS)
  t.unref?.()
  logger.info({ intervalMs: EVAL_INTERVAL_MS, horizonHours: HORIZON_HOURS }, 'signal history evaluator started')
  // Kick once at boot
  evaluatePending().catch(() => {})
  return t
}
