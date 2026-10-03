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
import { synthesizeSignal, buildResearchReport, roundPx } from '../src/domain.js'

/**
 * @param artifact  engine output ({ report })
 * @param prefs     trader preferences (minNetEdge / minConfidence / persona)
 * @param engineCtx { question, universe, macro, memory } — when supplied, the
 *   signal and every derived report section are RECOMPUTED from the overlaid
 *   live skills. Without it the signal would be computed on pre-overlay data
 *   and the report would show live skill panels that disagree with its own
 *   verdict (the pre-fix behaviour).
 */
export async function liveEnhanceArtifact(artifact, prefs = null, engineCtx = null) {
  if (!artifact?.report) return { artifact, live: {} }
  const symbol = artifact.report.symbol
  const [ticker, indicators, positioning, book, intel] = await Promise.all([
    getTicker(symbol).catch(() => null),
    computeIndicators(symbol).catch(() => null),
    isCrossSupported(symbol) ? getPositioning(symbol).catch(() => null) : null,   // perps exist for crypto only
    getSpotBookDepth(symbol).catch(() => null),                                    // spot book: every universe asset
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
      support: indicators.support ?? roundPx((indicators.last * 0.985)),
      resistance: indicators.resistance ?? roundPx((indicators.last * 1.015)),
      volumeZ: indicators.volumeZ ?? ta.data.volumeZ ?? null,
      live: true,
    }
    ta.confidence = 0.78                       // live data → higher confidence
  }

  // ---- overlay sentiment-analyst
  // Crypto: real funding + crowding + alternative.me Fear & Greed.
  // Tokenized equities are skipped: alternative.me is a CRYPTO index, and
  // applying it to NVDA/AAPL mislabelled crypto mood as equity sentiment.
  const sen = report.skills?.find(s => s.skill === 'sentiment-analyst')
  const isCrypto = report.skills && (engineCtx?.universe?.find(u => u.symbol === symbol)?.class
    ?? (isCrossSupported(symbol) ? 'crypto' : 'tokenized-equity')) === 'crypto'
  if (sen && isCrypto) {
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
        gauge: 'CRYPTO_FNG',
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
  // Equities: the engine's runSentiment already emits the VIX-derived gauge
  // from ctx.macro — nothing to overlay here.

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
      // Seeded flavour text — never ship it inside a LIVE report.
      whaleActivity: null,
      dexTvl: null,
      etfFlows: null,
      bookNote: undefined,
      live: true,
    }
    if (flows || b) mi.confidence = 0.85
  }

  // ---- recompute the signal + every derived section from the live skills
  //
  // The engine synthesized its signal BEFORE this overlay, so its verdict,
  // thesis, evidence and invalidation were computed on pre-live skill data.
  // Re-run synthesis on the overlaid skills (real spread now lives in
  // market-intel.spreadBps, so friction is real too) and rebuild the report.
  let rebuilt = report
  const market = engineCtx?.universe?.find(u => u.symbol === symbol)
  if (market && report.skills?.length === 5) {
    try {
      const mergedPrefs = { ...(engineCtx?.memory?.preferences || {}), ...(prefs || {}) }
      const signal = synthesizeSignal(symbol, market, report.skills, mergedPrefs)
      const fresh = buildResearchReport({
        question: report.question ?? engineCtx?.question ?? '',
        symbol, market, skills: report.skills, signal,
        memory: { ...(engineCtx?.memory || {}), preferences: mergedPrefs },
      })
      rebuilt = { ...fresh, id: report.id, createdAt: report.createdAt, intent: report.intent }
    } catch (err) {
      logger.warn({ err: err.message, symbol }, 'live re-synthesis failed — keeping engine signal')
    }
  }
  const out = rebuilt

  // ---- overlay live suggestion prices from real ticker
  if (ticker?.last && out.suggestion) {
    const move = ticker.last / out.suggestion.entry
    out.suggestion.entry  = roundPx(ticker.last)
    out.suggestion.stop   = roundPx((out.suggestion.stop  * move))
    out.suggestion.target = roundPx((out.suggestion.target * move))
  }

  // ---- stamp report as live (honestly — only when real data actually landed)
  const anyLive = Boolean(ticker || indicators || positioning || book || intel?.live)
  if (anyLive) {
    out.dataMode = 'LIVE'
    const parts = ['bitget-spot']
    if (live.positioning) parts.push('binance/okx/bitget-perp')
    if (isCrypto && intel?.fearGreed) parts.push('alt.me FnG')
    if (!isCrypto && engineCtx?.macro?.vix) parts.push('yahoo VIX')
    if (intel?.etfFlows) parts.push('farside ETF')
    if (intel?.networkStats) parts.push('blockchain.info')
    out.dataFreshness = `Live · ${parts.join(' + ')}${ticker?.stale ? ' · STALE cache (upstream degraded)' : ''}`
  }
  out.citations = [
    ...(out.citations || []),
    ticker && { skill: 'live-data', source: 'bitget-public-rest' },
    live.positioning && { skill: 'cross-venue', source: 'binance/okx/bitget-perp' },
    isCrypto && live.intel?.fearGreed && { skill: 'alt.me', source: 'crypto fear&greed index' },
    !isCrypto && engineCtx?.macro?.vix && { skill: 'yahoo-finance', source: 'VIX-derived equity fear gauge' },
    live.intel?.etfFlows && { skill: 'farside', source: `spot ${live.intel.etfFlows.asset} ETF net flows` },
  ].filter(Boolean)

  return { artifact: { ...artifact, report: out }, live }
}
