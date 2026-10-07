import test from 'node:test'
import assert from 'node:assert/strict'
import { runBacktestSynthetic, syntheticCandles, runBacktestFromCandles, runPlaybookBacktest, nonBacktestableFields } from './backtest.js'

test('syntheticCandles: produces requested count with valid OHLC', () => {
  const c = syntheticCandles('BTC', 100, 50000)
  assert.equal(c.length, 100)
  for (const bar of c) {
    assert.ok(bar.high >= bar.open && bar.high >= bar.close)
    assert.ok(bar.low  <= bar.open && bar.low  <= bar.close)
    assert.ok(bar.volume > 0)
  }
})

test('syntheticCandles: deterministic for the same seed', () => {
  const a = syntheticCandles('BTC', 50)
  const b = syntheticCandles('BTC', 50)
  assert.equal(a[10].close, b[10].close)
  assert.equal(a[49].close, b[49].close)
})

test('runBacktestSynthetic returns coherent stats', () => {
  const result = runBacktestSynthetic('NVDA', { n: 600, horizon: 8 })
  assert.ok(result.rows.length > 20, 'should produce many rows')
  const s = result.stats
  assert.equal(s.total, result.rows.length)
  assert.equal(s.signalCount + s.sitOutCount, s.total)
  assert.equal(s.signalCount, s.longCount + s.shortCount)
  assert.equal(s.flatCount + s.gatedCount, s.sitOutCount)
  for (const k of ['hitRate', 'longAccuracy', 'shortAccuracy', 'netWinRate', 'precisionOnMove', 'recallOnMove']) {
    if (s[k] != null) assert.ok(s[k] >= 0 && s[k] <= 1, `${k} in [0,1]`)
  }
  assert.ok(Number.isFinite(s.buyHoldReturn))
  assert.ok(s.maxDrawdown <= 0)
})

test('runBacktestFromCandles: warm-up matches production (200 candles) and defaults to non-overlapping decisions', () => {
  const c = syntheticCandles('AAPL', 400)
  const r = runBacktestFromCandles('AAPL', c, { horizon: 6 })
  assert.equal(r.meta.warmup, 200)
  assert.equal(r.meta.step, 6)
  assert.equal(r.meta.overlapping, false)
  assert.equal(r.rows[0].ts, c[199].ts)
  for (let k = 1; k < r.rows.length; k++) assert.equal(r.rows[k].ts - r.rows[k - 1].ts, 6 * 3600_000)
  assert.ok(r.rows.every(row => row.exitTs - row.ts === 6 * 3600_000))
})

test('runBacktestFromCandles: no lookahead — changing future candles never changes past decisions', () => {
  const c = syntheticCandles('MSFT', 500)
  const a = runBacktestFromCandles('MSFT', c, { horizon: 4 })
  const tampered = c.map((bar, i) => i > 350 ? { ...bar, close: bar.close * 1.5, high: bar.high * 1.5, low: bar.low * 1.5 } : bar)
  const b = runBacktestFromCandles('MSFT', tampered, { horizon: 4 })
  for (const row of a.rows.filter(r => r.ts <= c[350].ts)) {
    const twin = b.rows.find(x => x.ts === row.ts)
    assert.equal(twin.direction, row.direction)
    assert.equal(twin.composite, row.composite)
    assert.equal(twin.status, row.status)
  }
})

test('runBacktestFromCandles: no seeded per-symbol data leaks into the replay', () => {
  // Seeded fallbacks are keyed by symbol. With news/sentiment/macro held
  // neutral, two tickers on identical candles must produce identical calls.
  const c = syntheticCandles('X', 500)
  const a = runBacktestFromCandles('NVDA', c, { horizon: 8 })
  const b = runBacktestFromCandles('AMD', c, { horizon: 8 })
  assert.deepEqual(a.rows.map(r => [r.direction, r.status, r.composite]), b.rows.map(r => [r.direction, r.status, r.composite]))
})

test('runBacktestFromCandles: net P&L is gross directional return minus the engine friction', () => {
  const r = runBacktestFromCandles('TSLA', syntheticCandles('TSLA', 700), { horizon: 8, spreadBps: 3 })
  const traded = r.rows.filter(x => x.status === 'SIGNAL')
  for (const t of traded) {
    const dir = t.direction === 'LONG' ? 1 : -1
    assert.ok(Math.abs(t.grossReturn - dir * t.forwardReturn) < 1e-12)
    assert.ok(Math.abs(t.netReturn - (t.grossReturn - t.friction)) < 1e-12)
    assert.ok(t.friction >= 0.0023 - 1e-9, 'fees 0.20% round-trip + 3 bps spread')
  }
  for (const s of r.rows.filter(x => x.status === 'NO_TRADE')) {
    assert.equal(s.netReturn, null)
    assert.equal(s.outcome, 'SKIP')
  }
})

test('runBacktestFromCandles: benchmark candles drive a per-bar macro regime', () => {
  const c = syntheticCandles('NVDA', 500)
  const spy = syntheticCandles('SPY', 500)
  const r = runBacktestFromCandles('NVDA', c, { horizon: 8, benchmarkCandles: spy })
  assert.ok(r.rows.every(x => ['RISK_ON', 'RISK_OFF', 'NEUTRAL'].includes(x.macroRegime)))
  assert.ok(r.meta.replayed.includes('macro-analyst'))
  const none = runBacktestFromCandles('NVDA', c, { horizon: 8 })
  assert.ok(none.rows.every(x => x.macroRegime === null))
  assert.ok(none.meta.heldNeutral.includes('macro-analyst'))
})

test('runBacktestFromCandles: hostile options are clamped, short series return empty stats', () => {
  const c = syntheticCandles('NVDA', 300)
  const r = runBacktestFromCandles('NVDA', c, { step: -5, horizon: 9999 })
  assert.equal(r.meta.step, 1)
  assert.equal(r.meta.horizon, 168)
  const short = runBacktestFromCandles('NVDA', syntheticCandles('NVDA', 150), { horizon: 8 })
  assert.equal(short.rows.length, 0)
  assert.equal(short.stats.total, 0)
  assert.equal(short.stats.strategyReturn, null)
})

/* ---------- playbook condition replay ---------- */

test('runPlaybookBacktest: refuses live-only condition fields honestly', () => {
  const pb = { direction: 'LONG', signalConditions: [{ field: 'fearGreed', op: '>', value: 50 }, { field: 'etfTrailing5UsdM', op: '>', value: 500 }], exitConditions: [{ field: 'rsi14', op: '>', value: 75 }] }
  assert.deepEqual(nonBacktestableFields(pb).sort(), ['etfTrailing5UsdM', 'fearGreed'])
  const r = runPlaybookBacktest(pb, syntheticCandles('BTC', 400))
  assert.equal(r.backtestable, false)
  assert.equal(r.tradeCount, 0)
  assert.ok(r.missing.includes('fearGreed'))
})

test('runPlaybookBacktest: replays RSI mean-reversion conditions on real-shaped candles', () => {
  const pb = {
    direction: 'LONG',
    signalConditions: [{ field: 'rsi14', op: '<', value: 45 }, { field: 'change24h', op: '<', value: 0 }],
    exitConditions: [{ field: 'drawdownFromEntry', op: '<', value: -0.02 }],
  }
  const r = runPlaybookBacktest(pb, syntheticCandles('BTC', 600), { maxHoldBars: 24 })
  assert.equal(r.backtestable, true)
  assert.equal(r.mode, 'conditions')
  assert.ok(r.tradeCount >= 0)
  if (r.tradeCount > 0) {
    assert.ok(r.winRate >= 0 && r.winRate <= 1)
    assert.equal(r.wins + r.losses, r.tradeCount)
    assert.ok(r.trades.every(t => t.heldBars <= 24))
    assert.ok(Number.isFinite(r.totalReturnPct))
    assert.ok(Number.isFinite(r.lift))
  }
})

test('runPlaybookBacktest: btc24hChange condition uses aligned BTC series', () => {
  const btc = syntheticCandles('BTC', 600)
  const pb = {
    direction: 'LONG',
    signalConditions: [{ field: 'btc24hChange', op: '<', value: 100 }, { field: 'rsi14', op: '<', value: 45 }],
    exitConditions: [{ field: 'drawdownFromEntry', op: '<', value: -0.02 }],
  }
  // Same series as the asset → perfect ts alignment; condition always true → entries happen
  const r = runPlaybookBacktest(pb, btc, { btcCandles: btc, maxHoldBars: 12 })
  assert.equal(r.backtestable, true)
  assert.ok(r.tradeCount > 0, 'aligned btc series should permit entries')
})

test('runPlaybookBacktest: insufficient candles → not backtestable', () => {
  const pb = { direction: 'LONG', signalConditions: [{ field: 'rsi14', op: '<', value: 30 }], exitConditions: [] }
  const r = runPlaybookBacktest(pb, syntheticCandles('BTC', 100))
  assert.equal(r.backtestable, false)
  assert.ok(r.missing.includes('insufficient-candles'))
})
