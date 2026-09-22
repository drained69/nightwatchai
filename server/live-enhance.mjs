/**
 * Live-enhance a research artifact produced by the local (deterministic) engine.
 *
 * The engine emits a skill pack + signal + report with heuristic values. This
 * module fetches real cross-venue positioning + market intelligence + book
 * depth and overlays them onto the artifact's skill data + signal so the
 * artifact still validates against the same UI schema.
 *
 * Called from server/adapter.mjs after `engine.run()` returns. If any provider
 * fails, we simply skip that overlay — the client will render the seeded value.
 */

import { getPositioning, getSpotBookDepth, isSupported as isCrossSupported } from './providers/crossvenue.mjs'
import { getMarketIntelSnapshot } from './providers/marketintel.mjs'
import { computeIndicators, getTicker } from './providers/bitget.mjs'
import { logger } from './lib/log.mjs'

export async function liveEnhanceArtifact(artifact, prefs = null) {
  if (!artifact?.report) return { artifact, live: {} }
  const symbol = artifact.report.symbol
  const [ticker, indicators, positioning, book, intel] = await Promise.all([
    getTicker(symbol).catch(() => null),
    computeIndicators(symbol).catch(() => null),
    isCrossSupported(symbol) ? getPositioning(symbol).catch(() => null) : null,   // perps exist for crypto only
    getSpotBookDepth(symbol).catch(() => null),                                    // spot book: all 18 assets
    getMarketIntelSnapshot(symbol).catch(() => null),
  ])
  const live = { ticker, indicators, positioning, book, intel }
  const report = structuredClone(artifact.report)

  // ---- overlay technical-analysis skill with real indicators
  const ta = report.skills?.find(s => s.skill === 'technical-analysis')
  if (ta && indicators) {
    ta.title = `${symbol} · ${indicators.trend} · RSI ${indicators.rsi14.toFixed(0)}`
    ta.excerpt = `${(ticker?.changePct24h ?? 0).toFixed(2)}% / ATR ${indicators.atrPct.toFixed(1)}%`
    ta.source = 'bitget-1h-candles · live'
    ta.data = {
      ...ta.data,
      trend: indicators.trend,
      rsi: Number(indicators.rsi14.toFixed(1)),
      macdCross: indicators.macdCross,
      ema20: indicators.ema20,
      ema50: indicators.ema50,
      atrPct: indicators.atrPct,
      support: indicators.support ?? Number((indicators.last * 0.985).toFixed(2)),
      resistance: indicators.resistance ?? Number((indicators.last * 1.015).toFixed(2)),
      volumeZ: indicators.volumeZ ?? ta.data.volumeZ ?? null,
      live: true,
    }
    ta.confidence = 0.78                       // live data → higher confidence
  }

  // ---- overlay sentiment-analyst with real funding + crowding + F&G
  const sen = report.skills?.find(s => s.skill === 'sentiment-analyst')
  if (sen) {
    const fg = intel?.fearGreed
    const p  = positioning
    if (p || fg) {
      const tone = fg ? (fg.value > 60 ? 'POSITIVE' : fg.value < 40 ? 'NEGATIVE' : 'NEUTRAL') : sen.data.tone
      const crowding = p?.crowding ?? sen.data.crowding
      sen.title = `${symbol} · ${tone} · crowding ${crowding}`
      sen.excerpt = fg ? `Fear/greed ${fg.value} · ${fg.classification}${p ? ` · funding ${(p.meanFundingRate * 100).toFixed(4)}%` : ''}` : sen.excerpt
      sen.source = [p?.source, fg && 'alt.me-fng'].filter(Boolean).join(' · ') + ' · live'
      sen.data = {
        ...sen.data,
        tone,
        score: fg ? Number((fg.value / 100).toFixed(2)) : sen.data.score,
        crowding,
        fearGreed: fg?.value ?? sen.data.fearGreed,
        fearGreedTrend7d: fg?.trend7d ?? null,
        fundingRate: p?.meanFundingRate ?? sen.data.fundingRate,
        fundingSkewBps: p ? Number((p.fundingSkew * 10000).toFixed(2)) : null,
        openInterestUsd: p?.totalOpenInterestUsd ?? null,
        venueCount: p?.venueCount ?? 0,
        live: true,
      }
      sen.confidence = 0.82
    }
  }

  // ---- overlay market-intel with real ETF flows + book depth + network
  const mi = report.skills?.find(s => s.skill === 'market-intel')
  if (mi) {
    const b = book
    const flows = intel?.etfFlows
    const net = intel?.networkStats
    const anomaly = b ? Math.abs(b.depthImbalance || 0) > 0.15 : mi.data.volumeAnomaly
    mi.title = flows ? `${symbol} · ETF flow ${flows.latestDay.netUsdM >= 0 ? '+' : ''}$${flows.latestDay.netUsdM}M`
                     : anomaly ? `${symbol} · book imbalance` : `${symbol} · normal flow`
    mi.excerpt = b ? `Spread ${b.spreadBps?.toFixed(1)}bps · bid/ask depth $${Math.round(b.bidLiquidityUsd / 1000)}k/$${Math.round(b.askLiquidityUsd / 1000)}k`
                     : mi.excerpt
    mi.source = [b?.source, flows && 'farside-etf', net && 'blockchain.info'].filter(Boolean).join(' · ') + ' · live'
    mi.data = {
      ...mi.data,
      spreadBps:      b?.spreadBps ?? mi.data.spreadBps,
      bidLiquidityUsd: b?.bidLiquidityUsd ?? null,
      askLiquidityUsd: b?.askLiquidityUsd ?? null,
      depthImbalance:  b?.depthImbalance ?? null,
      etfNetFlowMUsdToday:     flows?.latestDay.netUsdM ?? null,
      etfNetFlowMUsdTrailing5: flows?.trailing5UsdM ?? null,
      etfNetFlowMUsdTrailing20: flows?.trailing20UsdM ?? null,
      btcHashRate: net?.hashRate ?? null,
      btc24hTxCount: net?.n_tx_24h ?? null,
      live: true,
    }
    if (flows || b) mi.confidence = 0.85
  }

  // ---- overlay signal net-edge friction with real spread
  //
  // We recompute netEdge here to reflect the ACTUAL Bitget spread rather
  // than the engine's spread estimate. The prior implementation then
  // unconditionally flipped SIGNAL → NO_TRADE any time netEdge went below
  // zero, which silently ignored the trader's minNetEdge preference — an
  // AGGRESSIVE user with a -200bp floor still saw every low-vol equity
  // rewritten to SIT-OUT here after the local engine had correctly
  // approved it. Re-apply the SAME configurable gate the engine uses so
  // the two paths agree, defaulting to the historical "reject if netEdge
  // < 0" only when no user preference is on record.
  if (book?.spreadBps != null) {
    // Bitget spot taker on both crypto pairs and tokenized R-pair equities
    // is ~0.10% per side (20 bps round-trip). Real spread applied on top,
    // floored at 2 bps for slippage guard.
    const realFriction = Math.max(book.spreadBps / 10000, 0.0002) + 0.002
    report.signal.estimatedFriction = Number(realFriction.toFixed(4))
    report.signal.netEdge = Number((report.signal.expectedEdge - realFriction - report.signal.riskAdjustment).toFixed(4))

    const minNetEdge = Number.isFinite(prefs?.minNetEdge) ? prefs.minNetEdge : 0
    if (report.signal.netEdge < minNetEdge && report.signal.status === 'SIGNAL') {
      report.signal.status = 'NO_TRADE'
      report.signal.direction = 'FLAT'
      report.signal.reason = `Post-friction net edge ${(report.signal.netEdge * 100).toFixed(2)}% fell below your ${(minNetEdge * 100).toFixed(2)}% floor after real ${book.spreadBps.toFixed(1)}bps spread was applied.`
      report.suggestion = null
    }
  }

  // ---- overlay live suggestion prices from real ticker
  if (ticker?.last && report.suggestion) {
    const move = ticker.last / report.suggestion.entry
    report.suggestion.entry  = Number(ticker.last.toFixed(2))
    report.suggestion.stop   = Number((report.suggestion.stop  * move).toFixed(2))
    report.suggestion.target = Number((report.suggestion.target * move).toFixed(2))
  }

  // ---- stamp report as live (honestly — only when real data actually landed)
  const anyLive = Boolean(ticker || indicators || positioning || book || intel?.live)
  if (anyLive) {
    report.dataMode = 'LIVE'
    const parts = ['bitget-spot']
    if (live.positioning) parts.push('binance/okx/bitget-perp')
    if (intel?.fearGreed) parts.push('alt.me FnG')
    if (intel?.etfFlows) parts.push('farside ETF')
    if (intel?.networkStats) parts.push('blockchain.info')
    report.dataFreshness = `Live · ${parts.join(' + ')}${ticker?.stale ? ' · STALE cache (upstream degraded)' : ''}`
  }
  report.citations = [
    ...(report.citations || []),
    ticker && { skill: 'live-data', source: 'bitget-public-rest' },
    live.positioning && { skill: 'cross-venue', source: 'binance/okx/bitget-perp' },
    live.intel?.fearGreed && { skill: 'alt.me', source: 'crypto fear&greed index' },
    live.intel?.etfFlows && { skill: 'farside', source: `spot ${live.intel.etfFlows.asset} ETF net flows` },
  ].filter(Boolean)

  return { artifact: { ...artifact, report }, live }
}
