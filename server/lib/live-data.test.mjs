import test from 'node:test'
import assert from 'node:assert/strict'

import { pairFor, isSupported, SYMBOL_MAP } from '../providers/bitget.mjs'
import { heuristicClassify, parseRss } from '../providers/news.mjs'
import {
  DEMO_UNIVERSE, DemoMarketData, runSkillPack, synthesizeSignal,
  stressTestThesis, buildResearchReport, LocalNightwatchEngine,
} from '../../src/domain.js'
import { runBacktestFromCandles } from '../../src/backtest.js'

/* ---------- bitget symbol map: full 18-asset universe, equities included ---------- */

test('bitget map covers all 18 universe assets including R-prefixed tokenized equities', () => {
  for (const asset of DEMO_UNIVERSE) {
    assert.ok(isSupported(asset.symbol), `${asset.symbol} must be supported`)
    assert.equal(pairFor(asset.symbol), SYMBOL_MAP.get(asset.symbol))
  }
  assert.equal(pairFor('NVDA'), 'RNVDAUSDT')
  assert.equal(pairFor('tsla'), 'RTSLAUSDT')     // case-insensitive
  assert.equal(pairFor('BTC'), 'BTCUSDT')
  assert.equal(pairFor('NOPE'), null)
})

/* ---------- news classifier: word boundaries + direction ---------- */

test('news classifier: no substring false positives (exhibits ≠ IBIT, Canada ≠ ADA)', () => {
  const exhibits = heuristicClassify({ headline: '8-K - KEYCORP /NEW/ (Filer)', detail: 'Item 9.01: Financial Statements and Exhibits' })
  assert.deepEqual(exhibits.affectedAssets, [])
  const canada = heuristicClassify({ headline: 'Carney pitches Canada to global investors', detail: '' })
  assert.ok(!canada.affectedAssets.some(a => a.symbol === 'ADA'))
})

test('news classifier: real matches + directional keywords', () => {
  const nvda = heuristicClassify({ headline: 'Nvidia surges on record data-center demand', detail: '' })
  const aff = nvda.affectedAssets.find(a => a.symbol === 'NVDA')
  assert.ok(aff, 'NVDA must match')
  assert.equal(aff.direction, 'UP')

  const tsla = heuristicClassify({ headline: 'Tesla plunges after robotaxi delay', detail: '' })
  const t = tsla.affectedAssets.find(a => a.symbol === 'TSLA')
  assert.ok(t)
  assert.equal(t.direction, 'DOWN')

  const btc = heuristicClassify({ headline: 'Bitcoin ETFs shed $463M in weekly reversal', detail: 'spot bitcoin outflows accelerate' })
  const b = btc.affectedAssets.find(a => a.symbol === 'BTC')
  assert.ok(b)
  assert.equal(b.direction, 'DOWN')
})

test('news classifier: works on normalized items (headline/detail), not just raw rows', () => {
  const r = heuristicClassify({ headline: 'Ethereum staking milestone', detail: 'ETH staking ratio hits record', severity: 'LOW' })
  assert.ok(r.affectedAssets.some(a => a.symbol === 'ETH'))
})

/* ---------- parseRss sanity ---------- */

test('parseRss handles RSS 2.0 items', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>Bitcoin rallies</title><link>https://x.co/1</link><description>BTC up</description><pubDate>Mon, 14 Sep 2026 10:00:00 GMT</pubDate></item>
    <item><title><![CDATA[Ethereum news]]></title><link>https://x.co/2</link></item>
  </channel></rss>`
  const rows = parseRss(xml)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].title, 'Bitcoin rallies')
  assert.equal(rows[1].title, 'Ethereum news')
})

/* ---------- skill pack on REAL context ---------- */

const liveMarket = { ...DEMO_UNIVERSE.find(a => a.symbol === 'BTC'), price: 77800, change24h: 1.3, live: true, spreadBps: 0.4, indicators: { live: true, last: 77800, ema20: 77000, ema50: 76000, rsi14: 62.5, atrPct: 1.8, atr14: 1400, trend: 'UP', macdCross: 'BULL', support: 76100, resistance: 79200, change7d: 0.031, volumeZ: 1.2, candleCount: 200 } }

const realNews = [
  { id: 'n1', headline: 'Bitcoin ETFs see $500M inflow day', source: 'CoinDesk', url: 'https://x.co/1', publishedAt: '2026-09-14T10:00:00Z', severity: 'HIGH', category: 'on-chain', direction: 'UP', magnitude: 0.7, live: true },
  { id: 'n2', headline: 'Fed official warns on inflation', source: 'CNBC', url: 'https://x.co/2', publishedAt: '2026-09-14T09:00:00Z', severity: 'MEDIUM', category: 'macro', direction: 'DOWN', magnitude: 0.4, live: true },
]

const realMacro = { live: true, riskRegime: 'RISK_ON', dxy: { last: 99.5, changePct: -0.2 }, spx: { last: 7650, changePct: 0.4 }, ndx: { last: 26300, changePct: 0.5 }, vix: { last: 16.2 }, ust10y: { last: 4.1 } }

test('news-briefing uses real headlines when ctx.news provided', () => {
  const skills = runSkillPack('BTC', liveMarket, { news: realNews, macro: realMacro, btcChange24h: 1.3 })
  const nb = skills.find(s => s.skill === 'news-briefing')
  assert.equal(nb.data.live, true)
  assert.equal(nb.data.newsDirection, 'MIXED')               // 1 UP vs 1 DOWN
  assert.equal(nb.data.beat, false)
  assert.equal(nb.data.newsItems.length, 2)
  assert.ok(nb.data.keyPoints.some(k => k.includes('Bitcoin ETFs')))
  assert.ok(nb.data.sources.includes('CoinDesk'))
})

test('technical-analysis uses real indicators when market.indicators.live', () => {
  const skills = runSkillPack('BTC', liveMarket, {})
  const ta = skills.find(s => s.skill === 'technical-analysis')
  assert.equal(ta.data.live, true)
  assert.equal(ta.data.rsi, 62.5)
  assert.equal(ta.data.trend, 'UP')
  assert.equal(ta.data.support, 76100)
  assert.equal(ta.data.resistance, 79200)
  assert.ok(ta.title.includes('RSI 63') || ta.title.includes('RSI 62'))
})

test('market-intel uses real volumeZ + spread', () => {
  const skills = runSkillPack('BTC', liveMarket, {})
  const mi = skills.find(s => s.skill === 'market-intel')
  assert.equal(mi.data.volumeZ, 1.2)
  assert.equal(mi.data.spreadBps, 0.4)
  assert.equal(mi.data.live, true)
})

test('macro-analyst uses real DXY / VIX / regime', () => {
  const skills = runSkillPack('BTC', liveMarket, { macro: realMacro, btcChange24h: 1.3 })
  const mac = skills.find(s => s.skill === 'macro-analyst')
  assert.equal(mac.data.live, true)
  assert.equal(mac.data.dxy, 99.5)
  assert.equal(mac.data.vix, 16.2)
  assert.equal(mac.data.cryptoRegime, 'RISK_ON')
  assert.equal(mac.data.confirms, true)          // risk-on + BTC up
  assert.ok(mac.excerpt.includes('99.5'))
})

test('synthesizeSignal derives expectedEdge from real ATR on live rows', () => {
  const bullishNews = [
    { id: 'n1', headline: 'Bitcoin ETFs see $500M inflow day', source: 'CoinDesk', url: 'https://x.co/1', publishedAt: '2026-09-14T10:00:00Z', severity: 'HIGH', category: 'on-chain', direction: 'UP', magnitude: 0.8, live: true },
    { id: 'n2', headline: 'Bitcoin breaks resistance as spot demand surges', source: 'TheBlock', url: 'https://x.co/3', publishedAt: '2026-09-14T09:30:00Z', severity: 'MEDIUM', category: 'on-chain', direction: 'UP', magnitude: 0.6, live: true },
  ]
  const skills = runSkillPack('BTC', liveMarket, { news: bullishNews, macro: realMacro, btcChange24h: 1.3 })
  const signal = synthesizeSignal('BTC', liveMarket, skills, { risk: 'AGGRESSIVE', style: 'EVENT_DRIVEN' })
  if (signal.direction === 'FLAT') {
    assert.equal(signal.expectedEdge, 0)                    // FLAT never projects edge
  } else {
    // ATR 1.8% → atrFrac 0.018 × 2.0 (swing-horizon multiplier) × conviction(≤1) ≤ 0.036
    assert.ok(signal.expectedEdge > 0 && signal.expectedEdge <= 0.036, `edge out of range: ${signal.expectedEdge}`)
  }
  // Mixed-news fixture above → FLAT → zero edge, honest NO_TRADE
  const mixed = runSkillPack('BTC', liveMarket, { news: realNews, macro: realMacro, btcChange24h: 1.3 })
  const mixedSignal = synthesizeSignal('BTC', liveMarket, mixed, { risk: 'MODERATE', style: 'EVENT_DRIVEN' })
  if (mixedSignal.direction === 'FLAT') assert.equal(mixedSignal.expectedEdge, 0)
  assert.ok(['SIGNAL', 'NO_TRADE'].includes(mixedSignal.status))
})

test('seeded fallback stays deterministic without live context', () => {
  const demoMarket = DEMO_UNIVERSE.find(a => a.symbol === 'ETH')
  const a = runSkillPack('ETH', demoMarket, {})
  const b = runSkillPack('ETH', demoMarket, {})
  assert.deepEqual(a, b)
  assert.ok(!a.find(s => s.skill === 'technical-analysis').data.live)
})

/* ---------- DemoMarketData never drifts live rows ---------- */

test('DemoMarketData.tick leaves live rows untouched; sync adopts live rows', () => {
  const m = new DemoMarketData()
  m.sync([{ symbol: 'BTC', price: 77777, live: true }])
  const before = m.snapshot().find(r => r.symbol === 'BTC')
  for (let i = 0; i < 5; i++) m.tick()
  const after = m.snapshot().find(r => r.symbol === 'BTC')
  assert.equal(after.price, 77777)
  assert.equal(after.price, before.price)
  // demo rows still drift
  const demoRow = m.snapshot().find(r => !r.live)
  assert.ok(demoRow, 'demo rows remain for offline mode')
})

/* ---------- live thesis lab ---------- */

test('stressTestThesis on live universe: monotonic confidence, real invalidation', () => {
  const universe = DEMO_UNIVERSE.map(u => u.symbol === 'BTC' ? liveMarket : u)
  const t = stressTestThesis({ thesis: 'Long BTC because ETF inflows are back', memory: null, universe, context: { news: realNews, macro: realMacro, btcChange24h: 1.3 } })
  assert.ok(t.confidenceAfter <= t.confidenceBefore)
  assert.equal(t.asset, 'BTC')
  assert.ok(t.invalidation.price > 0)
  assert.ok(t.steelman.includes('live wire') || t.steelman.includes('BTC'))
  const nb = t.skills.find(s => s.skill === 'news-briefing')
  assert.equal(nb.data.live, true)
})

/* ---------- live research report ---------- */

test('buildResearchReport stamps LIVE dataMode and cites real news URLs', () => {
  const skills = runSkillPack('BTC', liveMarket, { news: realNews, macro: realMacro, btcChange24h: 1.3 })
  const signal = synthesizeSignal('BTC', liveMarket, skills, {})
  const report = buildResearchReport({ question: 'Is BTC sustainable?', symbol: 'BTC', market: liveMarket, skills, signal, memory: null })
  assert.equal(report.dataMode, 'LIVE')
  assert.ok(report.citations.some(c => c.url === 'https://x.co/1'))
  assert.ok(report.dataFreshness.startsWith('Live tape'))
})

test('engine research on live context produces LIVE report end-to-end', async () => {
  const engine = new LocalNightwatchEngine()
  const artifact = await engine.run({
    intent: 'research',
    question: 'Why is BTC moving?',
    asset: 'BTC',
    context: { universe: [liveMarket], news: realNews, macro: realMacro, btcChange24h: 1.3, memory: null },
  })
  assert.equal(artifact.report.symbol, 'BTC')
  assert.equal(artifact.report.dataMode, 'LIVE')
  assert.equal(artifact.report.skills.length, 5)
})

/* ---------- backtest on real-shaped candles uses real indicators ---------- */

test('runBacktestFromCandles computes signals from the candle series (no lookahead crash)', () => {
  const candles = []
  let price = 100
  for (let i = 0; i < 400; i++) {
    const drift = Math.sin(i / 25) * 0.004
    const open = price
    const close = price * (1 + drift + (((i * 7919) % 100) / 100 - 0.5) * 0.01)
    candles.push({ ts: Date.UTC(2026, 0, 1) + i * 3600_000, open, high: Math.max(open, close) * 1.002, low: Math.min(open, close) * 0.998, close, volume: 1000 + (i % 50) * 30 })
    price = close
  }
  const res = runBacktestFromCandles('BTC', candles, { step: 6, horizon: 8 })
  assert.ok(res.rows.length > 20)
  assert.ok(res.stats.total === res.rows.length)
  assert.ok(res.rows.every(r => Number.isFinite(r.netEdge) && Number.isFinite(r.forwardReturn)))
})
