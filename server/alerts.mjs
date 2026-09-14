/**
 * Plain-English alerts.
 *
 * Trader types: "Alert me when BTC drops below 70000 and RSI < 30"
 * We parse to a structured rule:
 *   { asset: 'BTC', conditions: [
 *       { field: 'price',  op: '<', value: 70000 },
 *       { field: 'rsi14', op: '<', value: 30 },
 *     ], notify: ['push', 'sse'] }
 *
 * A tick loop evaluates every user's alerts against the current live snapshot
 * (price, RSI, funding rate, news relevance). Matching alerts fire a push +
 * an SSE event, then mark the alert as `triggeredAt` so it doesn't fire again
 * until the user resets it.
 *
 * Parsing uses the LLM if available; otherwise a keyword heuristic.
 */

import fs from 'node:fs'
import path from 'node:path'
import { getAllTickers, computeIndicators } from './providers/bitget.mjs'
import { getPositioning } from './providers/crossvenue.mjs'
import { paths, listUsers, loadCollection, saveCollection } from './lib/store.mjs'
import { logger } from './lib/log.mjs'

const EVAL_MS = Number(process.env.ALERTS_EVAL_MS || 15_000)

const FIELDS = new Set(['price', 'change24h', 'rsi14', 'atrPct', 'fundingRate', 'ema20', 'ema50', 'newsRelevance', 'change7d'])
const OPS    = new Set(['<', '>', '<=', '>=', '==', '!='])

/** Heuristic parse — returns { asset, conditions[], notify[] } or null. */
export function heuristicParseAlert(text) {
  const t = String(text || '').toLowerCase()
  const tickers = t.match(/\b(btc|eth|sol|bnb|xrp|doge|avax|ada|nvda|tsla|aapl|msft|amzn|googl|meta|amd|coin|mstr)\b/gi)
  if (!tickers) return null
  const asset = tickers[0].toUpperCase()
  const conditions = []
  // "price < 70000" / "below 70000" / "drops below 70000" / "under $70k"
  const priceMatch = t.match(/(?:price|value|below|under|above|over|drops? (?:to|below)|breaks? (?:above|below))\s*\$?([0-9]+(?:\.[0-9]+)?)(k|m|b)?/i)
  if (priceMatch) {
    const mult = priceMatch[2] === 'k' ? 1000 : priceMatch[2] === 'm' ? 1e6 : priceMatch[2] === 'b' ? 1e9 : 1
    const value = Number(priceMatch[1]) * mult
    const op = /(above|over|breaks? above)/.test(t) ? '>' : '<'
    conditions.push({ field: 'price', op, value })
  }
  const rsiMatch = t.match(/rsi\s*(?:is|goes)?\s*(<|>|<=|>=|==|!=|below|above)\s*([0-9]+)/i)
  if (rsiMatch) {
    const op = ['<','>','<=','>=','==','!='].includes(rsiMatch[1]) ? rsiMatch[1] : /below/.test(rsiMatch[1]) ? '<' : '>'
    conditions.push({ field: 'rsi14', op, value: Number(rsiMatch[2]) })
  }
  const changeMatch = t.match(/(?:24h|24 hour|day)\s*(?:change|move)?\s*(<|>|<=|>=|==|!=|below|above|drop|dropp?ed|up|down)\s*([-+]?[0-9]+(?:\.[0-9]+)?)\s*%?/i)
  if (changeMatch) {
    const op = /(above|up|>)/.test(changeMatch[1]) ? '>' : '<'
    conditions.push({ field: 'change24h', op, value: Number(changeMatch[2]) })
  }
  const newsMatch = /(breaking|high[- ]impact|major) news/.test(t)
  if (newsMatch) conditions.push({ field: 'newsRelevance', op: '>=', value: 'HIGH' })
  if (!conditions.length) return null
  return { asset, conditions, notify: ['push', 'sse'] }
}

export async function llmParseAlert(text, llm) {
  if (!llm?.enabled) return null
  const prompt = `Parse this plain-English trading alert into JSON.
Text: "${text}"

Return JSON matching:
{
  "asset": "<TICKER: BTC ETH SOL BNB XRP DOGE AVAX ADA NVDA TSLA AAPL MSFT AMZN GOOGL META AMD COIN MSTR>",
  "conditions": [
    { "field": "price"|"change24h"|"rsi14"|"atrPct"|"fundingRate"|"ema20"|"ema50"|"newsRelevance"|"change7d", "op": "<"|">"|"<="|">="|"=="|"!=", "value": <number or "HIGH"|"MED"|"LOW"> }
  ],
  "notify": ["push","sse"]
}
Only return valid JSON.`
  try {
    const raw = await llm.jsonComplete(prompt)
    if (!raw?.asset || !Array.isArray(raw.conditions)) return null
    raw.conditions = raw.conditions.filter(c => FIELDS.has(c.field) && OPS.has(c.op)).slice(0, 5)
    if (!raw.conditions.length) return null
    return { asset: String(raw.asset).toUpperCase(), conditions: raw.conditions, notify: Array.isArray(raw.notify) ? raw.notify : ['push'] }
  } catch { return null }
}

export async function parseAlert(text, llm) {
  const llmParsed = await llmParseAlert(text, llm)
  if (llmParsed) return { ...llmParsed, source: 'llm' }
  const heur = heuristicParseAlert(text)
  return heur ? { ...heur, source: 'heuristic' } : null
}

/* ---------------------------------------------------- store */

function loadAlerts(userId) { return loadCollection(userId, 'alerts', []) }
function saveAlerts(userId, alerts) { saveCollection(userId, 'alerts', alerts.slice(0, 50)) }

export function listAlerts(userId) { return loadAlerts(userId) }

export function createAlert(userId, { text, rule }) {
  const alerts = loadAlerts(userId)
  const alert = {
    id: `alrt-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`,
    text,
    rule,
    createdAt: new Date().toISOString(),
    triggeredAt: null,
    lastEvaluatedAt: null,
    active: true,
  }
  alerts.unshift(alert)
  saveAlerts(userId, alerts)
  return alert
}

export function deleteAlert(userId, alertId) {
  const alerts = loadAlerts(userId).filter(a => a.id !== alertId)
  saveAlerts(userId, alerts)
}

export function resetAlert(userId, alertId) {
  const alerts = loadAlerts(userId).map(a => a.id === alertId ? { ...a, triggeredAt: null, active: true } : a)
  saveAlerts(userId, alerts)
}

/* ---------------------------------------------------- evaluator */

function cmp(op, a, b) {
  switch (op) {
    case '<': return a < b
    case '>': return a > b
    case '<=': return a <= b
    case '>=': return a >= b
    case '==': return a == b
    case '!=': return a != b
  }
  return false
}

const RELEVANCE_ORDER = { LOW: 1, MED: 2, HIGH: 3 }

async function contextForAsset(symbol, tickers) {
  const ticker = tickers?.[symbol]
  const indicators = await computeIndicators(symbol).catch(() => null)
  const positioning = await getPositioning(symbol).catch(() => null)
  return {
    price: ticker?.last ?? null,
    change24h: ticker?.changePct24h ?? null,
    change7d: indicators?.change7d != null ? indicators.change7d * 100 : null,
    rsi14: indicators?.rsi14 ?? null,
    atrPct: indicators?.atrPct ?? null,
    fundingRate: positioning?.meanFundingRate ?? null,
    ema20: indicators?.ema20 ?? null,
    ema50: indicators?.ema50 ?? null,
    newsRelevance: null,       // updated by news bus subscriber; static in cold eval
  }
}

function matches(rule, ctx) {
  for (const c of rule.conditions) {
    const val = ctx[c.field]
    if (val == null) return false
    if (c.field === 'newsRelevance') {
      if (!cmp(c.op, RELEVANCE_ORDER[String(val).toUpperCase()] || 0, RELEVANCE_ORDER[String(c.value).toUpperCase()] || 0)) return false
      continue
    }
    if (!cmp(c.op, Number(val), Number(c.value))) return false
  }
  return rule.conditions.length > 0
}

export async function evaluateAllUsers(pushSender) {
  const tickers = await getAllTickers().catch(() => null)
  const users = listUsers()
  const fired = []
  for (const userId in users) {
    const alerts = loadAlerts(userId)
    if (!alerts.length) continue
    for (const alert of alerts) {
      if (!alert.active || alert.triggeredAt) continue
      alert.lastEvaluatedAt = new Date().toISOString()
      const ctx = await contextForAsset(alert.rule.asset, tickers)
      if (matches(alert.rule, ctx)) {
        alert.triggeredAt = new Date().toISOString()
        alert.snapshotAtTrigger = ctx
        fired.push({ userId, alert })
        if (pushSender) {
          await pushSender(userId, {
            title: `NIGHTWATCH · alert fired · ${alert.rule.asset}`,
            body: alert.text,
            tag: `alert-${alert.id}`,
          }).catch(() => { /* ignore */ })
        }
      }
    }
    saveAlerts(userId, alerts)
  }
  if (fired.length) logger.info({ fired: fired.length }, 'alerts fired')
  return fired
}

export function startEvaluator({ sendPush } = {}) {
  const t = setInterval(() => evaluateAllUsers(sendPush).catch(err => logger.warn({ err: err.message }, 'alerts eval failed')), EVAL_MS)
  t.unref?.()
  logger.info({ intervalMs: EVAL_MS }, 'alerts evaluator started')
  return t
}
