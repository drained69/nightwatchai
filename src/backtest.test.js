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
  const result = runBacktestSynthetic('BTC', { n: 300, step: 6, horizon: 8 })
  assert.ok(result.rows.length > 20, 'should produce many rows')
  const s = result.stats
  assert.equal(s.total, result.rows.length)
  assert.ok(s.longCount + s.shortCount + s.flatCount === s.total)
  assert.ok(s.signalCount === s.longCount + s.shortCount)
  if (s.longAccuracy != null)  assert.ok(s.longAccuracy  >= 0 && s.longAccuracy  <= 1)
  if (s.shortAccuracy != null) assert.ok(s.shortAccuracy >= 0 && s.shortAccuracy <= 1)
  if (s.precisionOnMove != null) assert.ok(s.precisionOnMove >= 0 && s.precisionOnMove <= 1)
})

test('runBacktestFromCandles accepts arbitrary candles', () => {
  const c = syntheticCandles('ETH', 200)
  const result = runBacktestFromCandles('ETH', c, { step: 8, horizon: 6 })
  assert.equal(result.symbol, 'ETH')
  assert.ok(result.rows.length > 5)
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
