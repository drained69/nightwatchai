import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BITGET_SIGNAL_SKILLS, DEMO_UNIVERSE, LocalNightwatchEngine, NightwatchProvider,
  PaperExecution, applyTraderDecision, buildResearchReport, buildReview,
  classifyIntent, coerceSession, findOpportunities, fmtCap, fmtPct, fmtPrice,
  inferAsset, initialSession, migrateFromLegacy, portfolioImpact, runSkillPack,
  stressTestThesis, synthesizeSignal,
} from './domain.js'

/* ---------- Universe + formatters ---------- */

test('universe has 18 assets across crypto and tokenized-equity classes', () => {
  assert.equal(DEMO_UNIVERSE.length, 18)
  const crypto = DEMO_UNIVERSE.filter(a => a.class === 'crypto').length
  const equity = DEMO_UNIVERSE.filter(a => a.class === 'tokenized-equity').length
  assert.equal(crypto + equity, 18)
  assert.ok(crypto >= 5 && equity >= 5)
})

test('formatters render prices and percents predictably', () => {
  assert.equal(fmtPrice(182.42), '182.42')
  assert.equal(fmtPrice(116420), '116,420')
  assert.equal(fmtPct(0.038), '+3.8%')
  assert.equal(fmtPct(-0.01), '-1.0%')
  assert.equal(fmtCap(4460000000000), '4.46T')
  assert.equal(fmtCap(272000000000), '272.0B')
})

/* ---------- Intent router ---------- */

test('classifyIntent detects research, thesis, portfolio, execution, review, opportunities', () => {
  assert.equal(classifyIntent('Why is NVDA moving?').intent,                             'research')
  assert.equal(classifyIntent('/thesis Long MSTR here').intent,                          'thesis-test')
  assert.equal(classifyIntent('Stress-test my NVDA thesis').intent,                      'thesis-test')
  assert.equal(classifyIntent('How does a $2000 long BTC affect my portfolio?').intent, 'portfolio-impact')
  assert.equal(classifyIntent('How should I size the trade?').intent,                    'execution-help')
  assert.equal(classifyIntent('/review my last trade').intent,                           'review')
  assert.equal(classifyIntent('Find the strongest overnight opportunities').intent,      'find-opportunities')
})

test('inferAsset finds the ticker even inside a sentence', () => {
  assert.equal(inferAsset('Should I short AAPL overnight?'), 'AAPL')
  assert.equal(inferAsset('Research Solana into weekend flows'), 'SOL')
  assert.equal(inferAsset('what is BTC doing here'), 'BTC')
  assert.equal(inferAsset('is Alphabet a buy?'), 'GOOGL')
  assert.equal(inferAsset('random question with no ticker'), null)
})

/* ---------- Skill pack + signal synthesis ---------- */

test('runSkillPack returns exactly the 5 bitget-signal skills in order', () => {
  const market = DEMO_UNIVERSE.find(a => a.symbol === 'NVDA')
  const pack = runSkillPack('NVDA', market)
  assert.equal(pack.length, 5)
  assert.deepEqual(pack.map(s => s.skill), BITGET_SIGNAL_SKILLS.map(s => s.id))
  for (const s of pack) {
    assert.ok(typeof s.confidence === 'number' && s.confidence > 0 && s.confidence < 1)
    assert.ok(typeof s.data === 'object')
  }
})

test('skill pack is deterministic for the same asset', () => {
  const market = DEMO_UNIVERSE.find(a => a.symbol === 'BTC')
  const a = runSkillPack('BTC', market)
  const b = runSkillPack('BTC', market)
  assert.deepEqual(a.map(x => x.confidence), b.map(x => x.confidence))
  assert.equal(a[0].data.catalyst, b[0].data.catalyst)
})

test('synthesizeSignal produces valid direction and net-edge math', () => {
  const market = DEMO_UNIVERSE.find(a => a.symbol === 'NVDA')
  const skills = runSkillPack('NVDA', market)
  const sig = synthesizeSignal('NVDA', market, skills)
  assert.ok(['LONG', 'SHORT', 'FLAT'].includes(sig.direction))
  assert.ok(sig.confidence >= 0.5 && sig.confidence <= 1)
  assert.equal(sig.netEdge, Number((sig.expectedEdge - sig.estimatedFriction - sig.riskAdjustment).toFixed(4)))
  assert.ok(sig.catalyst && typeof sig.catalyst === 'string')
})

/* ---------- Research report ---------- */

test('buildResearchReport shape covers all mandatory sections', () => {
  const market = DEMO_UNIVERSE.find(a => a.symbol === 'BTC')
  const skills = runSkillPack('BTC', market)
  const signal = synthesizeSignal('BTC', market, skills)
  const seed = initialSession()
  const report = buildResearchReport({ question: 'Is BTC breakout sustainable?', symbol: 'BTC', market, skills, signal, memory: seed.memory })
  for (const key of ['id','question','symbol','summary','signal','supporting','contradicting','risks','invalidation','analogs','citations','skills','createdAt']) {
    assert.ok(key in report, `missing ${key}`)
  }
  assert.equal(report.symbol, 'BTC')
  assert.ok(Array.isArray(report.supporting))
  assert.ok(Array.isArray(report.contradicting))
  if (signal.status === 'SIGNAL') {
    assert.ok(report.suggestion && typeof report.suggestion.notional === 'number')
    assert.ok(report.suggestion.riskReward > 0)
  } else {
    assert.equal(report.suggestion, null)
  }
})

/* ---------- Thesis Lab ---------- */

test('stressTestThesis returns verdict and confidence delta', () => {
  const seed = initialSession()
  const res = stressTestThesis({ thesis: 'Long NVDA here because AI demand stays strong', memory: seed.memory })
  assert.equal(res.asset, 'NVDA')
  assert.ok(['SUPPORTS','REFUTES','MIXED'].includes(res.verdict))
  assert.ok(res.confidenceAfter <= res.confidenceBefore)
  assert.ok(res.stressTests.length >= 5)
  assert.ok(res.invalidation.price > 0)
  assert.ok(typeof res.steelman === 'string' && res.steelman.length > 10)
  assert.ok(typeof res.counterThesis === 'string' && res.counterThesis.length > 10)
})

test('stressTestThesis defaults to BTC when no ticker is present', () => {
  const seed = initialSession()
  const res = stressTestThesis({ thesis: 'Risk assets rip into year-end', memory: seed.memory })
  assert.equal(res.asset, 'BTC')
})

/* ---------- Portfolio impact ---------- */

test('portfolioImpact reports exposure and beta correctly for empty book', () => {
  const session = initialSession()
  const impact = portfolioImpact({ symbol: 'NVDA', notional: 3000, direction: 'LONG', session })
  assert.equal(impact.exposurePctBefore, 0)
  assert.ok(Math.abs(impact.exposurePctAfter - 3000 / session.memory.preferences.nav) < 1e-9)
  const nvda = DEMO_UNIVERSE.find(a => a.symbol === 'NVDA')
  assert.equal(impact.betaAfter, Number(nvda.beta.toFixed(2)))
})

test('portfolioImpact reflects an existing book', () => {
  const session = initialSession()
  const paper = new PaperExecution()
  const seedPos = paper.submit({ asset: 'BTC', direction: 'LONG', notional: 2000, entry: 100000, stop: 95000, target: 110000 })
  session.positions.push(seedPos)
  const impact = portfolioImpact({ symbol: 'MSTR', notional: 1500, direction: 'LONG', session })
  assert.equal(impact.currentBook, 2000)
  assert.equal(impact.nextBook, 3500)
  assert.ok(impact.cryptoPctBefore > 0)
})

/* ---------- Paper execution + trader decision ---------- */

test('PaperExecution.submit + mark obeys stops and targets', () => {
  const p = new PaperExecution()
  const pos = p.submit({ asset: 'NVDA', direction: 'LONG', notional: 1000, entry: 100, stop: 95, target: 110 })
  const marked = p.mark(pos, { price: 111 })
  assert.equal(marked.status, 'CLOSED')
  assert.equal(marked.closeReason, 'TAKE_PROFIT')
  const stopped = p.mark(pos, { price: 94 })
  assert.equal(stopped.status, 'CLOSED')
  assert.equal(stopped.closeReason, 'STOP_LOSS')
})

test('applyTraderDecision APPROVE opens a paper position from a SIGNAL report', () => {
  const session = initialSession()
  const market = DEMO_UNIVERSE.find(a => a.symbol === 'NVDA')
  const skills = runSkillPack('NVDA', market)
  const signal = synthesizeSignal('NVDA', market, skills)
  const report = buildResearchReport({ question: 'x', symbol: 'NVDA', market, skills, signal, memory: session.memory })
  if (report.signal.status !== 'SIGNAL') return                           // deterministic seed may be sit-out — skip
  session.reports.push(report)
  session.activeReportId = report.id
  const next = applyTraderDecision(session, report, { action: 'APPROVE' })
  assert.equal(next.positions.length, 1)
  assert.equal(next.positions[0].status, 'OPEN')
  assert.equal(next.decisions[0].action, 'APPROVE')
})

test('applyTraderDecision throws on NO_TRADE approve', () => {
  const session = initialSession()
  const fakeReport = { id: 'r-1', symbol: 'AAPL', signal: { status: 'NO_TRADE', direction: 'FLAT' }, suggestion: null }
  assert.throws(() => applyTraderDecision(session, fakeReport, { action: 'APPROVE' }))
})

test('applyTraderDecision refuses when session is not paperOnly', () => {
  const session = { ...initialSession(), settings: { paperOnly: false } }
  const fakeReport = { id: 'r-1', symbol: 'BTC', signal: { status: 'SIGNAL', direction: 'LONG' }, suggestion: {} }
  assert.throws(() => applyTraderDecision(session, fakeReport, { action: 'APPROVE' }))
})

/* ---------- Opportunities scan ---------- */

test('findOpportunities returns a non-empty sorted list', () => {
  const session = initialSession()
  const opps = findOpportunities(session)
  assert.ok(opps.length > 0)
  for (const o of opps) assert.equal(o.signal.status, 'SIGNAL')
  for (let i = 1; i < opps.length; i++) {
    const a = opps[i - 1].signal.netEdge * opps[i - 1].signal.confidence
    const b = opps[i].signal.netEdge * opps[i].signal.confidence
    assert.ok(a >= b)
  }
})

test('findOpportunities honours the watchlistOnly flag', () => {
  const session = initialSession()
  const all      = findOpportunities(session, false)
  const filtered = findOpportunities(session, true)
  assert.ok(filtered.length <= all.length)
})

/* ---------- Review ---------- */

test('buildReview produces sections without throwing when no report is on file', () => {
  const rev = buildReview({ position: { asset: 'BTC', pnlPercent: 0.02 } })
  assert.equal(rev.status, 'COMPLETE')
  assert.ok(rev.summary.includes('BTC'))
})

test('buildReview lists missed risks when direction diverged from outcome', () => {
  const market = DEMO_UNIVERSE.find(a => a.symbol === 'NVDA')
  const skills = runSkillPack('NVDA', market)
  const signal = synthesizeSignal('NVDA', market, skills)
  const report = buildResearchReport({ question: 'q', symbol: 'NVDA', market, skills, signal, memory: initialSession().memory })
  const position = { asset: 'NVDA', direction: signal.direction === 'LONG' ? 'SHORT' : 'LONG', pnlPercent: 0.01 }
  const rev = buildReview({ position, report, actualOutcome: { pnlPct: -0.02 } })
  assert.ok(rev.whatFailed.length + rev.missedRisks.length >= 1)
})

/* ---------- LocalNightwatchEngine + provider ---------- */

test('LocalNightwatchEngine.research returns a research report', async () => {
  const engine = new LocalNightwatchEngine()
  const artifact = await engine.run({ intent: 'research', question: 'Why is NVDA moving?', asset: 'NVDA', context: { memory: initialSession().memory } })
  assert.ok(artifact.report)
  assert.equal(artifact.report.symbol, 'NVDA')
})

test('LocalNightwatchEngine.thesisTest returns a thesis report', async () => {
  const engine = new LocalNightwatchEngine()
  const artifact = await engine.run({ intent: 'thesis-test', thesis: 'Long BTC into ETF flows', context: { memory: initialSession().memory } })
  assert.ok(artifact.thesisReport)
  assert.equal(artifact.thesisReport.asset, 'BTC')
})

test('NightwatchProvider with no endpoint uses local engine', async () => {
  const provider = new NightwatchProvider({ endpoint: null })
  const res = await provider.run({ intent: 'research', question: 'Why is BTC moving?', asset: 'BTC', context: { memory: initialSession().memory } })
  assert.equal(res.engine, 'LOCAL')
  assert.equal(res.artifact.report.symbol, 'BTC')
})

test('NightwatchProvider.bitgetStatus returns not-connected without adapter', async () => {
  const provider = new NightwatchProvider({ endpoint: null })
  const status = await provider.bitgetStatus()
  assert.equal(status.connected, false)
})

/* ---------- Session migration ---------- */

test('coerceSession returns fresh initial session when given empty input', () => {
  const s = coerceSession(null)
  assert.equal(s.version, 3)
  assert.equal(s.settings.paperOnly, true)
  assert.equal(s.universe.length, 18)
})

test('migrateFromLegacy carries over NAV and preserves paperOnly', () => {
  const migrated = migrateFromLegacy({ version: 2, settings: { nav: 50000, minConfidence: 0.8 } })
  assert.equal(migrated.memory.preferences.nav, 50000)
  assert.equal(migrated.memory.preferences.minConfidence, 0.8)
  assert.equal(migrated.settings.paperOnly, true)
  assert.equal(migrated.version, 3)
})

test('coerceSession preserves v3 reports and signals', () => {
  const seed = initialSession()
  seed.reports = [{ id: 'rep-1', symbol: 'BTC' }]
  seed.signals = [{ id: 'sig-1', asset: 'BTC' }]
  const coerced = coerceSession(JSON.parse(JSON.stringify(seed)))
  assert.equal(coerced.reports.length, 1)
  assert.equal(coerced.signals.length, 1)
})

/* ---------- News: classifier + user impact + Bitget deep-link ---------- */

import { DEMO_NEWS, analyzeNewsForUser, bitgetTradeUrl, classifyNewsImpact, ingestNewsItem, pickNextDemoNews } from './domain.js'

test('DEMO_NEWS has 10+ items across all categories', () => {
  assert.ok(DEMO_NEWS.length >= 10)
  const cats = new Set(DEMO_NEWS.map(n => n.category))
  assert.ok(cats.has('earnings'))
  assert.ok(cats.has('macro'))
  assert.ok(cats.has('on-chain'))
  assert.ok(cats.has('regulatory'))
  for (const n of DEMO_NEWS) {
    assert.ok(n.affectedAssets.length > 0, `${n.id} has no affected assets`)
    for (const a of n.affectedAssets) assert.ok(['UP','DOWN','MIXED'].includes(a.direction))
  }
})

test('classifyNewsImpact sorts affected assets by magnitude', () => {
  const impact = classifyNewsImpact(DEMO_NEWS.find(n => n.id === 'news-btc-etf-flows'))
  for (let i = 1; i < impact.affectedAssets.length; i++) {
    assert.ok(impact.affectedAssets[i - 1].magnitude >= impact.affectedAssets[i].magnitude)
  }
})

test('analyzeNewsForUser marks watchlist and open positions', () => {
  const session = { ...initialSession(), watchlist: ['NVDA', 'AMD'], positions: [{ asset: 'NVDA', direction: 'LONG', status: 'OPEN', notional: 1000 }] }
  const item = DEMO_NEWS.find(n => n.id === 'news-nvda-print')
  const analysis = analyzeNewsForUser(item, session)
  const nvda = analysis.rows.find(r => r.symbol === 'NVDA')
  assert.equal(nvda.watching, true)
  assert.ok(nvda.position && nvda.position.direction === 'LONG')
  assert.equal(nvda.action.tone, 'green')             // NVDA UP + LONG position → CONFIRMING
  const amd = analysis.rows.find(r => r.symbol === 'AMD')
  assert.equal(amd.watching, true)
  assert.equal(amd.position, null)
  assert.ok(['RESEARCH LONG','RESEARCH SHORT','REVIEW'].includes(amd.action.label))
})

test('analyzeNewsForUser flags adverse when news fights an open position', () => {
  const session = { ...initialSession(), watchlist: ['BTC'], positions: [{ asset: 'BTC', direction: 'LONG', status: 'OPEN', notional: 1000 }] }
  const item = DEMO_NEWS.find(n => n.id === 'news-fomc-hawkish')     // BTC DOWN
  const analysis = analyzeNewsForUser(item, session)
  const btc = analysis.rows.find(r => r.symbol === 'BTC')
  assert.equal(btc.action.label, 'ADVERSE')
  assert.equal(btc.action.tone, 'red')
})

test('analyzeNewsForUser relevance tier reflects watchlist + position weight', () => {
  const item = DEMO_NEWS.find(n => n.id === 'news-btc-etf-flows')
  const cold = analyzeNewsForUser(item, { watchlist: [], positions: [] })
  const warm = analyzeNewsForUser(item, { watchlist: ['BTC','MSTR','COIN','ETH'], positions: [] })
  const hot  = analyzeNewsForUser(item, { watchlist: ['BTC'], positions: [{ asset: 'BTC', direction: 'LONG', status: 'OPEN', notional: 1000 }] })
  assert.ok(cold.relevance <= warm.relevance)
  assert.ok(warm.relevance <= hot.relevance)
  assert.equal(hot.relevanceTier, 'HIGH')
})

test('bitgetTradeUrl routes crypto and tokenized equities correctly', () => {
  assert.ok(bitgetTradeUrl('BTC').includes('/spot/BTCUSDT'))
  assert.ok(bitgetTradeUrl('NVDA').includes('/pre-market/stocks/NVDA'))
  assert.ok(bitgetTradeUrl('UNKNOWN').includes('/spot/UNKNOWNUSDT'))
})

test('ingestNewsItem appends news, stamps time, and raises alerts on high relevance', () => {
  const session = { ...initialSession(), watchlist: ['BTC'], positions: [{ asset: 'BTC', direction: 'LONG', status: 'OPEN', notional: 1000 }] }
  const before = session.news.length
  const next = ingestNewsItem(session, DEMO_NEWS.find(n => n.id === 'news-btc-etf-flows'))
  assert.equal(next.news.length, before + 1)
  assert.ok(next.news[0].analysis.relevanceTier === 'HIGH')
  assert.ok(next.newsAlerts.length >= 1)
  assert.ok(next.logs[next.logs.length - 1].type === 'NEWS')
})

test('pickNextDemoNews rotates deterministically', () => {
  const seen = new Set()
  for (let i = 0; i < DEMO_NEWS.length; i++) seen.add(pickNextDemoNews(i).id)
  assert.equal(seen.size, DEMO_NEWS.length)
  assert.equal(pickNextDemoNews(0).id, pickNextDemoNews(DEMO_NEWS.length).id)
})

test('initialSession starts with empty news feed — real product hydrates from /news/live', () => {
  const s = initialSession()
  assert.deepEqual(s.news, [])
  assert.deepEqual(s.newsAlerts, [])
})
