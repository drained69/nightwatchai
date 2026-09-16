/**
 * Live "Market Pulse" strip.
 *
 * Polls the adapter for real BTC + ETH tickers, Fear & Greed, and BTC ETF net
 * flow. Refreshes every 15s. Shows an "adapter offline" note if no fetch
 * succeeds. Used across Research and Explore pages.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Activity, TrendingUp } from 'lucide-react'
import { hasApi, apiUrl } from './apiBase.js'

async function safeJson(path) {
  if (!hasApi()) return null
  try {
    const res = await fetch(apiUrl(path), { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

export function MarketPulse({ compact = false }) {
  const [state, setState] = useState({ prices: null, fg: null, etf: null, macro: null, health: null })
  const timerRef = useRef(null)

  const poll = async () => {
    const [prices, marketintel, macro, health] = await Promise.all([
      safeJson('/prices/live'),
      safeJson('/marketintel/BTC'),
      safeJson('/macro'),
      safeJson('/health'),
    ])
    setState({
      prices: prices?.tickers || null,
      fg: marketintel?.fearGreed || null,
      etf: marketintel?.etfFlows || null,
      macro: macro?.live ? macro : null,
      health,
    })
  }

  useEffect(() => {
    poll()
    timerRef.current = setInterval(poll, 15000)
    return () => clearInterval(timerRef.current)
  }, [])

  const btc = state.prices?.BTC
  const eth = state.prices?.ETH
  const fg  = state.fg
  const etf = state.etf
  const macro = state.macro
  const anyLive = btc || eth || fg || etf || macro

  if (!hasApi()) return null
  if (!anyLive) {
    return (
      <div className="market-pulse offline">
        <span className="mp-chip"><Activity size={11} /> Adapter reachable but no live data yet — upstream feeds warming up…</span>
      </div>
    )
  }

  const fmtPrice = (n) => n == null ? '—' : `$${n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n.toFixed(2)}`
  const fmtPct   = (n) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
  const fmtEtf   = (n) => n == null ? '—' : `${n >= 0 ? '+' : ''}$${n.toFixed(0)}M`

  return (
    <div className={compact ? 'market-pulse compact' : 'market-pulse'}>
      <span className="mp-eyebrow"><i className="dot green" /> LIVE PULSE</span>
      {btc && <span className="mp-chip"><b>BTC</b> {fmtPrice(btc.last)} <em className={btc.changePct24h >= 0 ? 'up' : 'down'}>{fmtPct(btc.changePct24h)}</em></span>}
      {eth && <span className="mp-chip"><b>ETH</b> {fmtPrice(eth.last)} <em className={eth.changePct24h >= 0 ? 'up' : 'down'}>{fmtPct(eth.changePct24h)}</em></span>}
      {macro?.dxy && <span className="mp-chip"><b>DXY</b> {macro.dxy.last != null ? macro.dxy.last.toFixed(2) : '—'} <em className={macro.dxy.changePct >= 0 ? 'down' : 'up'}>{fmtPct(macro.dxy.changePct)}</em></span>}
      {macro?.vix && <span className="mp-chip"><b>VIX</b> {macro.vix.last != null ? macro.vix.last.toFixed(1) : '—'} <em className={(macro.vix.last ?? 0) >= 20 ? 'down' : 'up'}>{macro.riskRegime?.replace('_', '-')}</em></span>}
      {fg  && <span className="mp-chip"><b>F&G</b> {fg.value} <em className={fg.value >= 55 ? 'up' : fg.value <= 45 ? 'down' : 'amber'}>{fg.classification}</em></span>}
      {etf?.latestDay && <span className="mp-chip"><b>BTC ETF flow</b> {fmtEtf(etf.latestDay.netUsdM)} <em className="muted">latest · 5d {fmtEtf(etf.trailing5UsdM)}</em></span>}
      {state.health && <span className="mp-chip subtle"><TrendingUp size={11} /> Adapter up {Math.round(state.health.uptimeSec / 60)}m · llm {state.health.provider?.llm || 'off'}</span>}
    </div>
  )
}
