import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

process.env.NIGHTWATCH_DATA_DIR = path.join(process.cwd(), '.test-tier2-' + Date.now())
process.env.JWT_SECRET = 'tier2-test'
process.env.SHARE_SECRET = 'share-test'
process.env.VAPID_SUBJECT = 'mailto:t@t.co'

const alerts    = await import('../alerts.mjs')
const sharing   = await import('../sharing.mjs')
const copilot   = await import('../copilot.mjs')
const news      = await import('../providers/news.mjs')
const store     = await import('./store.mjs')

test.after(() => { try { fs.rmSync(process.env.NIGHTWATCH_DATA_DIR, { recursive: true, force: true }) } catch { /* ignore */ } })

/* ---------- alerts parser ---------- */

test('alerts: heuristic parser extracts price condition', () => {
  const r = alerts.heuristicParseAlert('Alert me when BTC drops below 70000')
  assert.equal(r.asset, 'BTC')
  assert.ok(r.conditions.some(c => c.field === 'price' && c.op === '<' && c.value === 70000))
})

test('alerts: heuristic parser combines multiple conditions', () => {
  const r = alerts.heuristicParseAlert('Alert me when BTC drops below 70000 and RSI < 30')
  assert.equal(r.asset, 'BTC')
  assert.ok(r.conditions.some(c => c.field === 'rsi14' && c.op === '<' && c.value === 30))
})

test('alerts: create + list + delete round-trip per user', () => {
  const u = store.createUser({ email: 'a@a.co' })
  const created = alerts.createAlert(u.id, { text: 'BTC below 70000', rule: { asset: 'BTC', conditions: [{ field: 'price', op: '<', value: 70000 }], notify: ['push'] } })
  const listed = alerts.listAlerts(u.id)
  assert.equal(listed.length, 1)
  assert.equal(listed[0].id, created.id)
  alerts.deleteAlert(u.id, created.id)
  assert.equal(alerts.listAlerts(u.id).length, 0)
})

/* ---------- sharing ---------- */

test('sharing: round-trip via token', () => {
  const report = { id: 'rep-1', symbol: 'BTC', signal: { direction: 'LONG', confidence: 0.8 } }
  const { hash, token } = sharing.shareReport(report, { ownerUserId: 'usr_1' })
  assert.equal(hash.length, 20)
  const record = sharing.readSharedByToken(token)
  assert.equal(record.report.id, 'rep-1')
  assert.equal(record.views, 1)
  // Second read increments views
  sharing.readSharedByToken(token)
  const third = sharing.readSharedByToken(token)
  assert.equal(third.views, 3)
})

test('sharing: bad token returns null', () => {
  assert.equal(sharing.readSharedByToken('nope'), null)
})

/* ---------- copilot ---------- */

test('copilot: empty book returns empty:true', () => {
  const r = copilot.analyzePortfolio([], { nav: 25000 })
  assert.equal(r.empty, true)
})

test('copilot: concentration warnings fire', () => {
  const r = copilot.analyzePortfolio([
    { asset: 'BTC',  direction: 'LONG', notional: 6000, status: 'OPEN' },
    { asset: 'ETH',  direction: 'LONG', notional: 2000, status: 'OPEN' },
    { asset: 'MSTR', direction: 'LONG', notional: 4000, status: 'OPEN' },
  ], { nav: 25000 })
  assert.equal(r.empty, false)
  assert.equal(r.exposureUsd, 12000)
  assert.ok(r.warnings.some(w => w.text.includes('factor') && w.severity === 'HIGH'))
})

test('copilot: BTC self-correlation returns 1', () => {
  assert.equal(copilot.correlationToBtc('BTC'), 1.0)
})

/* ---------- cross-source news dedup ---------- */

test('news: normalizeHeadline drops stopwords and lowercases', () => {
  const n = news.normalizeHeadline('The Federal Reserve Signals Rate Cuts Ahead')
  assert.ok(n.includes('federal'))
  assert.ok(!n.includes('the'))
})

test('news: tokenOverlap detects near-duplicates', () => {
  const a = news.normalizeHeadline('Bitcoin ETFs post record inflow of 612 million dollars today')
  const b = news.normalizeHeadline('Bitcoin ETFs record inflow 612 million dollars today')
  const overlap = news.tokenOverlap(a, b)
  assert.ok(overlap >= 0.6, `overlap ${overlap} should be >= 0.6`)
})
