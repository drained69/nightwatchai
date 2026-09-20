/**
 * Alpha of the Day test suite.
 *
 * Covers:
 *   - scheduler math: nextFireAt + shouldCatchUp
 *   - alpha scoring is bounded 0..1
 *   - brief generator produces well-shaped output against a mock news store
 *   - subscription store round-trip + unsubscribe token
 *   - HTML/text email renderers include the essentials
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

process.env.NIGHTWATCH_DATA_DIR = path.join(process.cwd(), '.test-nw02-' + Date.now())
process.env.JWT_SECRET = 'nw02-test'
// Disable the scheduler by default in tests — we call the pieces directly.
process.env.NIGHTWATCH_02_ENABLED = '0'

const nw02 = await import('./nightwatch02.mjs')
const sched = await import('./nightwatch02-scheduler.mjs')
const subs = await import('./nightwatch02-subscriptions.mjs')

test.after(() => { try { fs.rmSync(process.env.NIGHTWATCH_DATA_DIR, { recursive: true, force: true }) } catch { /* ignore */ } })

/* -------------------------------------------------- scheduler math */

test('nextFireAt: today 01:00 UTC → today 02:00 UTC', () => {
  const now = new Date(Date.UTC(2026, 8, 18, 1, 0, 0))
  const next = sched.nextFireAt(now, 2, 0)
  assert.equal(next.toISOString(), '2026-09-18T02:00:00.000Z')
})

test('nextFireAt: today 02:00 UTC → TOMORROW 02:00 UTC (strictly greater)', () => {
  const now = new Date(Date.UTC(2026, 8, 18, 2, 0, 0))
  const next = sched.nextFireAt(now, 2, 0)
  assert.equal(next.toISOString(), '2026-09-19T02:00:00.000Z')
})

test('nextFireAt: today 03:00 UTC → tomorrow 02:00 UTC', () => {
  const now = new Date(Date.UTC(2026, 8, 18, 3, 0, 0))
  const next = sched.nextFireAt(now, 2, 0)
  assert.equal(next.toISOString(), '2026-09-19T02:00:00.000Z')
})

test('nextFireAt: month-end rollover (Feb 28 22:00 → Mar 1 02:00)', () => {
  const now = new Date(Date.UTC(2027, 1, 28, 22, 0, 0)) // 2027 is not a leap year
  const next = sched.nextFireAt(now, 2, 0)
  assert.equal(next.toISOString(), '2027-03-01T02:00:00.000Z')
})

test('shouldCatchUp: 04:00 UTC on a day with no brief → true', () => {
  const now = new Date(Date.UTC(2030, 5, 15, 4, 0, 0))
  assert.equal(sched.shouldCatchUp(now, 2, 0), true)
})

test('shouldCatchUp: 01:00 UTC (before fire) → false, no catch-up', () => {
  const now = new Date(Date.UTC(2030, 5, 15, 1, 0, 0))
  assert.equal(sched.shouldCatchUp(now, 2, 0), false)
})

/* -------------------------------------------------- alpha scoring */

test('scoreAlphaCandidate is bounded 0..1 with mixed inputs', () => {
  const s1 = nw02.scoreAlphaCandidate({ change24h: 0.4, indicators: { volumeZ: 0.5 } }, 1)
  const s2 = nw02.scoreAlphaCandidate({ change24h: -12, indicators: { volumeZ: 8 } }, 20)
  const s3 = nw02.scoreAlphaCandidate({ change24h: 0, indicators: {} }, 0)
  assert.ok(s1 >= 0 && s1 <= 1, `s1=${s1}`)
  assert.ok(s2 >= 0 && s2 <= 1, `s2=${s2}`)
  assert.equal(s3, 0)
})

test('scoreAlphaCandidate rewards larger moves over noise', () => {
  const quiet = nw02.scoreAlphaCandidate({ change24h: 0.3, indicators: { volumeZ: 0 } }, 0)
  const loud  = nw02.scoreAlphaCandidate({ change24h: 6.5, indicators: { volumeZ: 2.5 } }, 4)
  assert.ok(loud > quiet, `loud=${loud} should beat quiet=${quiet}`)
})

test('scoreAlphaCandidate never returns NaN when volumeZ is missing', () => {
  const s = nw02.scoreAlphaCandidate({ change24h: 3 }, 2)
  assert.ok(Number.isFinite(s))
})

/* -------------------------------------------------- brief generator */

// Minimal newsStore stub matching the shape market-context expects
function mockNewsStore() {
  return { _items: [
    { id: 'n1', headline: 'NVDA data-center revenue beats consensus', source: 'wire', url: 'https://x.co/n1', publishedAt: new Date().toISOString(), severity: 'HIGH', category: 'earnings', affectedAssets: [{ symbol: 'NVDA', direction: 'UP', magnitude: 0.7, reasoning: 'beat' }] },
    { id: 'n2', headline: 'FOMC minutes signal cautious pause', source: 'wire', url: 'https://x.co/n2', publishedAt: new Date().toISOString(), severity: 'MED', category: 'macro', affectedAssets: [{ symbol: 'BTC', direction: 'MIXED', magnitude: 0.4, reasoning: 'macro' }] },
  ] }
}

test('scopeToTokenizedStocks keeps equities and drops every crypto row', async () => {
  const { DEMO_UNIVERSE } = await import('../src/domain.js')
  const scoped = nw02.scopeToTokenizedStocks(DEMO_UNIVERSE)
  assert.ok(scoped.length > 0)
  assert.ok(scoped.every(r => r.class !== 'crypto'))
  assert.ok(!scoped.some(r => ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'AVAX', 'ADA'].includes(r.symbol)))
  assert.ok(scoped.some(r => r.symbol === 'NVDA'))
  assert.deepEqual(nw02.scopeToTokenizedStocks(null), [])
})

test('generateBrief writes latest.json + dated file with expected shape', async () => {
  const now = new Date(Date.UTC(2030, 5, 15, 2, 5, 0))
  const brief = await nw02.generateBrief({ newsStore: mockNewsStore(), now, maxCandidates: 3 })
  assert.equal(brief.date, '2030-06-15')
  assert.ok(brief.id.startsWith('nw02-'))
  assert.ok(brief.marketSummary)
  assert.ok(Array.isArray(brief.unusualMovements))
  assert.ok(Array.isArray(brief.alphaCandidates))
  assert.ok(brief.disclaimer.includes('not investment advice'))
  assert.equal(brief.disclaimer, 'All information here is not investment advice.')
  // Tokenized-stocks-only: no crypto anywhere in the brief.
  assert.equal(brief.marketSummary.cryptoAvgChange24h, undefined)
  assert.ok(!(brief.marketSummary.sectors || []).some(s => /crypto anchor|^crypto$/i.test(s.sector)))
  assert.ok(!brief.alphaCandidates.some(c => c.symbol === 'BTC'))
  assert.ok(!brief.unusualMovements.some(u => u.symbol === 'BTC'))
  // Persistence round-trip
  const loaded = nw02.loadLatestBrief()
  assert.equal(loaded.id, brief.id)
  const byDate = nw02.loadBriefByDate('2030-06-15')
  assert.equal(byDate.id, brief.id)
  const dates = nw02.listBriefDates()
  assert.ok(dates.includes('2030-06-15'))
})

test('loadBriefByDate rejects malformed dates without throwing', () => {
  assert.equal(nw02.loadBriefByDate('not-a-date'), null)
  assert.equal(nw02.loadBriefByDate('2020/01/01'), null)
  assert.equal(nw02.loadBriefByDate('../etc/passwd'), null)
})

/* -------------------------------------------------- subscriptions */

test('setSubscription round-trips and preserves createdAt', () => {
  const first = subs.setSubscription({ email: 'alice@example.com', enabled: true, source: 'ui' })
  assert.equal(first.email, 'alice@example.com')
  assert.equal(first.enabled, true)
  assert.ok(first.unsubscribeToken)
  const second = subs.setSubscription({ email: 'alice@example.com', enabled: false })
  assert.equal(second.enabled, false)
  assert.equal(second.createdAt, first.createdAt, 'createdAt must be preserved')
  assert.equal(second.unsubscribeToken, first.unsubscribeToken, 'unsubscribeToken must be stable')
})

test('subscription rejects invalid email', () => {
  assert.throws(() => subs.setSubscription({ email: 'not-an-email', enabled: true }), /valid email required/)
})

test('findByUnsubscribeToken locates the row', () => {
  const s = subs.setSubscription({ email: 'bob@example.com', enabled: true })
  const found = subs.findByUnsubscribeToken(s.unsubscribeToken)
  assert.equal(found?.email, 'bob@example.com')
  assert.equal(subs.findByUnsubscribeToken('nope'), null)
})

test('listActiveSubscribers excludes opted-out rows', () => {
  subs.setSubscription({ email: 'carol@example.com', enabled: true })
  subs.setSubscription({ email: 'dave@example.com', enabled: false })
  const active = subs.listActiveSubscribers().map(s => s.email)
  assert.ok(active.includes('carol@example.com'))
  assert.ok(!active.includes('dave@example.com'))
})

/* -------------------------------------------------- email rendering */

test('renderBriefEmailHtml embeds date, disclaimer, and unsubscribe link', async () => {
  const brief = await nw02.generateBrief({ newsStore: mockNewsStore(), now: new Date(Date.UTC(2030, 5, 16)), maxCandidates: 2 })
  const html = nw02.renderBriefEmailHtml(brief, { email: 'eve@x.co', unsubscribeToken: 'tok_abc' })
  assert.match(html, /Alpha of the Day/)
  assert.match(html, /2030-06-16/)
  assert.match(html, /not investment advice/)
  assert.match(html, /unsubscribe\/tok_abc/)
})

test('renderBriefEmailText is plain, contains date and disclaimer', async () => {
  const brief = await nw02.generateBrief({ newsStore: mockNewsStore(), now: new Date(Date.UTC(2030, 5, 17)), maxCandidates: 2 })
  const text = nw02.renderBriefEmailText(brief)
  assert.match(text, /^Alpha of the Day — 2030-06-17/)
  assert.match(text, /not investment advice/)
  // No HTML tags in the text version
  assert.ok(!/<[a-z][^>]*>/i.test(text))
})

test('renderBriefEmailHtml renders structured thesis objects without [object Object]', () => {
  // Candidate carrying the REAL report shape: situation is an array, and the
  // theses are structured objects — not strings. The renderer must extract the
  // statement, never stringify the object.
  const brief = {
    id: 'nw02-2030-07-01', date: '2030-07-01',
    coverage: { total: 1, live: 1, newsItems: 0 },
    marketSummary: { equityAvgChange24h: 1.2, breadth: 0.1, macro: { riskRegime: 'RISK_ON' }, sectors: [] },
    unusualMovements: [],
    alphaCandidates: [{
      symbol: 'NVDA', name: 'NVIDIA', sector: 'Semiconductors', change24h: 2.3, alphaScore: 0.5,
      news: [],
      report: {
        signal: { direction: 'LONG', confidence: 0.72, netEdge: 0.02, status: 'SIGNAL' },
        situation: ['NVDA is trading $220 (+2.3% 24h).', 'Wire tape is bullish.'],
        shortTermThesis: { direction: 'LONG', horizon: 'next 24-72 hours', statement: 'NVDA follow-through likely on the earnings drift.', keyDrivers: ['beat'], expectedMove: '+2%' },
        longTermThesis: { horizon: 'next 4-12 weeks', statement: 'Structural AI capex tailwind intact.', structuralFactors: ['datacenter demand'] },
        risks: [{ label: 'Volatility whipsaw', detail: 'ATR 4.2% — 1R stops get taken' }],
        whatChangesThisThesis: [{ label: 'Close < EMA20', why: 'Trend structure break' }],
        invalidation: { price: 210, conditions: ['Close < EMA20'] },
      },
    }],
    disclaimer: 'not investment advice',
  }
  const html = nw02.renderBriefEmailHtml(brief, { unsubscribeToken: 't' })
  assert.ok(!/\[object Object\]/.test(html), 'email must not contain [object Object]')
  assert.match(html, /NVDA follow-through likely/)
  assert.match(html, /Structural AI capex tailwind/)
  assert.match(html, /Volatility whipsaw/)
  const text = nw02.renderBriefEmailText(brief)
  assert.ok(!/\[object Object\]/.test(text), 'text email must not contain [object Object]')
  assert.match(text, /NVDA follow-through likely/)
})

/* -------------------------------------------------- thesis card routing */

test('thesisCardQuestion routes to research intent, not thesis-test', async () => {
  const { classifyIntent } = await import('../src/domain.js')
  const brief = await nw02.generateBrief({ newsStore: mockNewsStore(), now: new Date(Date.UTC(2030, 5, 20)), maxCandidates: 5 })
  for (const c of brief.alphaCandidates) {
    assert.ok(c.thesisCardQuestion, `${c.symbol} must have a thesisCardQuestion`)
    const { intent } = classifyIntent(c.thesisCardQuestion)
    assert.equal(intent, 'research', `${c.symbol} thesisCardQuestion should route to research, got ${intent}: "${c.thesisCardQuestion}"`)
  }
})

test('renderBriefEmailHtml escapes HTML entities from external strings', () => {
  const brief = {
    id: 'nw02-2030-06-18', date: '2030-06-18',
    coverage: { total: 1, live: 1, newsItems: 0 },
    marketSummary: { equityAvgChange24h: 1, breadth: 0, macro: {} },
    unusualMovements: [{ symbol: '<script>alert(1)</script>', name: 'x', sector: '"><b>xss</b>', change24h: 5, drivers: ['<x>'] }],
    alphaCandidates: [],
    disclaimer: 'ok',
  }
  const html = nw02.renderBriefEmailHtml(brief, { unsubscribeToken: 't' })
  assert.ok(!/<script>alert/i.test(html), 'raw <script> must not appear')
  assert.match(html, /&lt;script&gt;/)
})
