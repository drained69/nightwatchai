/**
 * Analysis workbench — single-symbol deep-dive view.
 *
 * Consumes GET /analysis/{SYMBOL} which bundles: Bitget spot ticker, technical
 * indicators computed from real Bitget 1h candles, Bitget spot book depth,
 * cross-venue positioning (funding/OI where applicable), symbol-filtered news,
 * a macro snapshot, and an AI-authored 4-part desk analysis with a concrete
 * LONG/SHORT/SIT_OUT verdict + entry/stop/target + invalidation.
 *
 * Defaults to US equities (NVDA/TSLA/AAPL/MSFT/AMZN/GOOGL/META/AMD/COIN/MSTR)
 * because that's the desk's primary focus.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivitySquare, ArrowUpRight, ArrowDownRight, BrainCircuit,
  ExternalLink, LineChart, Newspaper, RefreshCw, ShieldCheck, TrendingUp, Zap,
} from 'lucide-react'
import { hasApi, apiUrl } from './apiBase.js'
import { bitgetTradeUrl, fmtPct, fmtPrice, safeUrl } from '../domain.js'

// US equities pinned first — this desk's primary universe.
const US_EQUITIES = ['NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'AMD', 'COIN', 'MSTR']
const CRYPTO_MAJORS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'AVAX', 'ADA']

function fmtUsd(n) {
  if (n == null || Number.isNaN(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function fmtBps(n) { return n == null ? '—' : `${Number(n).toFixed(1)} bps` }

export function AnalysisPage({ initialSymbol = 'NVDA' }) {
  const [symbol, setSymbol] = useState(initialSymbol)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [assetClass, setAssetClass] = useState('EQUITY')   // EQUITY | CRYPTO

  // Abort/supersede in-flight loads: without this a slow response for the
  // previously selected symbol can land after a fast one and paint mislabeled
  // prices (new symbol header, old symbol data).
  const abortRef = useRef(null)
  const wantedRef = useRef(symbol)
  wantedRef.current = symbol

  const load = async (sym) => {
    if (!hasApi()) { setError('Analysis workbench needs the adapter online.'); return }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const timeout = setTimeout(() => ctrl.abort(), 35000)
    setLoading(true); setError(null)
    try {
      const res = await fetch(apiUrl(`/analysis/${sym}`), { signal: ctrl.signal })
      if (!res.ok) throw new Error(`analysis unavailable (${res.status})`)
      const body = await res.json()
      if (sym !== wantedRef.current) return   // user switched symbols mid-flight
      setData(body)
    } catch (err) {
      if (ctrl.signal.aborted || sym !== wantedRef.current) return
      setError(err.message || 'analysis failed')
    } finally {
      clearTimeout(timeout)
      if (sym === wantedRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    // Symbol changed — drop the previous symbol's data so the loading state
    // renders instead of stale prices under the new symbol's header.
    setData(null); setError(null)
    load(symbol)
    return () => abortRef.current?.abort()
  }, [symbol])
  // Refresh live facts every 45s — the AI synthesis stays cached; only re-fetch on user action.
  useEffect(() => {
    if (!hasApi()) return
    const t = setInterval(() => load(symbol), 45000)
    return () => clearInterval(t)
  }, [symbol])

  const symbols = assetClass === 'EQUITY' ? US_EQUITIES : CRYPTO_MAJORS

  const t   = data?.ticker
  const ind = data?.indicators
  const dep = data?.depth
  const pos = data?.positioning
  const mac = data?.macro
  const syn = data?.synthesis
  const isEquity = US_EQUITIES.includes(symbol)

  const verdictTone = syn?.verdict === 'LONG' ? 'green' : syn?.verdict === 'SHORT' ? 'red' : 'amber'
  const bitgetUrl   = bitgetTradeUrl(symbol, syn?.verdict === 'SHORT' ? 'SHORT' : 'LONG')

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow"><BrainCircuit size={12} /> ANALYSIS WORKBENCH · SINGLE-SYMBOL DEEP DIVE</span>
          <h2>Research one name, all the way through.</h2>
          <p className="lead">Real Bitget prices, book depth, indicators, cross-venue positioning and symbol-tagged news — synthesized into a complete desk analysis with a concrete verdict, entry, stop, target and invalidation level.</p>
        </div>
        <div className="row-actions">
          <button className="btn ghost sm" onClick={() => load(symbol)} disabled={loading}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} /> {loading ? 'ANALYZING…' : 'REFRESH'}
          </button>
        </div>
      </div>

      <div className="analysis-picker">
        <div className="filter-row">
          <button className={assetClass === 'EQUITY' ? 'chip on' : 'chip'} onClick={() => setAssetClass('EQUITY')}>US EQUITIES</button>
          <button className={assetClass === 'CRYPTO' ? 'chip on' : 'chip'} onClick={() => setAssetClass('CRYPTO')}>CRYPTO</button>
        </div>
        <div className="chip-row">
          {symbols.map(sym => (
            <button key={sym} className={sym === symbol ? 'chip on' : 'chip'} onClick={() => setSymbol(sym)}>{sym}</button>
          ))}
        </div>
      </div>

      {error && <div className="panel" style={{ borderColor: 'var(--red)' }}><div className="settings-body"><b className="down">Analysis error</b> — {error}</div></div>}

      {t ? (
        <div className="analysis-header panel">
          <div className="ah-left">
            <div className="asset-cell">
              <div className={`asset-mark ${isEquity ? 'equity' : 'crypto'}`}>{symbol.slice(0, 1)}</div>
              <div>
                <h3 style={{ margin: 0 }}>{symbol}</h3>
                <small className="muted">{isEquity ? 'Tokenized U.S. equity' : 'Crypto major'} · Bitget spot · {t?.pair || `${symbol}USDT`}</small>
              </div>
            </div>
            <div className="ah-price">
              <b className="mono lg">${fmtPrice(t.last)}</b>
              <em className={t.changePct24h >= 0 ? 'up' : 'down'}>
                {t.changePct24h >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />} {fmtPct((t.changePct24h ?? 0) / 100)}
              </em>
            </div>
          </div>
          <div className="ah-right row-actions">
            {data?.earnings?.daysToNext != null && (
              <span className={`pill mini ${data.earnings.daysToNext <= 7 ? 'red' : data.earnings.daysToNext <= 21 ? 'amber' : 'outline'}`}>
                📅 earnings in {data.earnings.daysToNext}d
                {data.earnings.epsEstimate != null && ` · est $${Number(data.earnings.epsEstimate).toFixed(2)}`}
              </span>
            )}
            <span className="pill outline mini">24h vol · {fmtUsd(t.volumeUsd24h)}</span>
            <span className="pill outline mini">spread · {fmtBps(t.spreadBps)}</span>
            <span className="pill outline mini">high · ${fmtPrice(t.high24h)}</span>
            <span className="pill outline mini">low · ${fmtPrice(t.low24h)}</span>
            <a className="btn primary sm" href={bitgetUrl} target="_blank" rel="noreferrer noopener">
              <Zap size={12} /> TRADE {symbol} ON BITGET <ExternalLink size={11} />
            </a>
          </div>
        </div>
      ) : loading ? (
        <div className="empty-report"><div className="empty-icon"><BrainCircuit size={22} className="spin" /></div><b>Fetching real Bitget tape for {symbol}…</b><p>Pulling ticker, 200 candles, book depth, cross-venue positioning and related news, then synthesizing the desk verdict.</p></div>
      ) : null}

      {syn ? (
        <article className="panel synthesis-card">
          <div className="panel-head">
            <div>
              <span className="eyebrow"><BrainCircuit size={11} /> AI SYNTHESIS · GROUNDED ON REAL FACTS</span>
              <h3 style={{ marginTop: 4 }}>{syn.headline}</h3>
            </div>
            <div className="row-actions">
              <span className={`pill ${verdictTone} mini`}>{syn.verdict?.replace('_', ' ')}</span>
              {syn.confidence != null && <span className="pill outline mini">{Math.round(syn.confidence * 100)}% conf</span>}
            </div>
          </div>
          <div className="synth-grid">
            <div><small><LineChart size={10} /> TECHNICAL</small><p>{syn.technical}</p></div>
            <div><small><ActivitySquare size={10} /> FLOW</small><p>{syn.flow}</p></div>
            <div><small><Newspaper size={10} /> NARRATIVE</small><p>{syn.narrative}</p></div>
          </div>
          {(syn.entry || syn.stop || syn.target) ? (
            <div className="edge-grid" style={{ borderTop: '1px solid var(--line)', marginTop: 12 }}>
              {syn.entry  != null && <div className="metric"><small>ENTRY</small><b className="mono">${fmtPrice(syn.entry)}</b></div>}
              {syn.stop   != null && <div className="metric"><small>STOP</small><b className="mono down">${fmtPrice(syn.stop)}</b></div>}
              {syn.target != null && <div className="metric"><small>TARGET</small><b className="mono up">${fmtPrice(syn.target)}</b></div>}
            </div>
          ) : null}
          {syn.invalidation && (
            <p className="note" style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 12 }}>
              <ShieldCheck size={11} /> <b>Invalidation.</b> {syn.invalidation}
            </p>
          )}
        </article>
      ) : (t && !loading) ? (
        <div className="panel"><div className="settings-body"><b>Facts fetched — synthesis unavailable.</b> The AI narrator returned no verdict. Every fact panel below is still real.</div></div>
      ) : null}

      <div className="analysis-grid">
        <section className="panel">
          <div className="panel-head"><h3><LineChart size={13} /> Technical (real Bitget candles)</h3><small>{ind?.candleCount ?? 0} bars · 1h</small></div>
          <div className="edge-grid">
            <div className="metric"><small>RSI (14)</small><b className={ind?.rsi14 == null ? '' : ind.rsi14 >= 70 ? 'down' : ind.rsi14 <= 30 ? 'up' : ''}>{ind?.rsi14 ?? '—'}</b></div>
            <div className="metric"><small>Trend</small><b>{ind?.trend || '—'}</b></div>
            <div className="metric"><small>EMA 20</small><b className="mono">${ind ? fmtPrice(ind.ema20) : '—'}</b></div>
            <div className="metric"><small>EMA 50</small><b className="mono">${ind ? fmtPrice(ind.ema50) : '—'}</b></div>
            <div className="metric"><small>ATR %</small><b>{ind?.atrPct != null ? `${ind.atrPct}%` : '—'}</b></div>
            <div className="metric"><small>7d</small><b className={ind?.change7d >= 0 ? 'up' : 'down'}>{ind?.change7d != null ? fmtPct(ind.change7d) : '—'}</b></div>
            <div className="metric"><small>Support</small><b className="mono">${ind ? fmtPrice(ind.support) : '—'}</b></div>
            <div className="metric"><small>Resistance</small><b className="mono">${ind ? fmtPrice(ind.resistance) : '—'}</b></div>
            <div className="metric"><small>Vol z-score</small><b className={ind?.volumeZ >= 1 ? 'up' : ind?.volumeZ <= -1 ? 'down' : ''}>{ind?.volumeZ ?? '—'}</b></div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h3><ActivitySquare size={13} /> Bitget spot book (real)</h3><small>bitget-spot-book</small></div>
          <div className="edge-grid">
            <div className="metric"><small>Best bid</small><b className="mono up">${dep ? fmtPrice(dep.bestBid) : '—'}</b></div>
            <div className="metric"><small>Best ask</small><b className="mono down">${dep ? fmtPrice(dep.bestAsk) : '—'}</b></div>
            <div className="metric"><small>Spread</small><b>{fmtBps(dep?.spreadBps)}</b></div>
            <div className="metric"><small>Bid depth (15L)</small><b>{fmtUsd(dep?.bidLiquidityUsd)}</b></div>
            <div className="metric"><small>Ask depth (15L)</small><b>{fmtUsd(dep?.askLiquidityUsd)}</b></div>
            <div className="metric"><small>Imbalance</small><b className={dep?.depthImbalance > 0.1 ? 'up' : dep?.depthImbalance < -0.1 ? 'down' : ''}>{dep?.depthImbalance ?? '—'}</b></div>
          </div>
          {dep == null && <div className="settings-body"><small className="muted">Bitget book not available for this symbol yet.</small></div>}
        </section>

        <section className="panel">
          <div className="panel-head"><h3><TrendingUp size={13} /> Cross-venue positioning</h3><small>Binance · OKX · Bitget perp</small></div>
          {pos ? (
            <>
              <div className="edge-grid">
                <div className="metric"><small>Mean funding</small><b className={pos.meanFundingRate > 0 ? 'up' : 'down'}>{pos.meanFundingRate != null ? `${(pos.meanFundingRate * 100).toFixed(4)}%` : '—'}</b></div>
                <div className="metric"><small>Funding skew</small><b>{pos.fundingSkew != null ? `${(pos.fundingSkew * 10000).toFixed(1)} bps` : '—'}</b></div>
                <div className="metric"><small>Crowding</small><b className={pos.crowding === 'HIGH' ? 'amber' : ''}>{pos.crowding || '—'}</b></div>
                <div className="metric"><small>Total OI</small><b>{fmtUsd(pos.totalOpenInterestUsd)}</b></div>
              </div>
              <div className="venue-table">
                <div className="venue-head"><span>Venue</span><span>Funding</span><span>Next</span><span>Open interest</span></div>
                {['bitget', 'binance', 'okx'].map(v => {
                  const f = pos.fundingByVenue?.find(x => x.venue === v)
                  const o = pos.oiByVenue?.find(x => x.venue === v)
                  if (!f && !o) return null
                  const nextMin = f?.nextFundingTime ? Math.max(0, Math.round((f.nextFundingTime - Date.now()) / 60000)) : null
                  const isBitget = v === 'bitget'
                  return (
                    <div className={`venue-row ${isBitget ? 'venue-primary' : ''}`} key={v}>
                      <span className="venue-name">{isBitget && <span className="pill green mini">HOME</span>} {v.toUpperCase()}</span>
                      <b className={f?.fundingRate > 0 ? 'up mono' : 'down mono'}>{f?.fundingRate != null ? `${(f.fundingRate * 100).toFixed(4)}%` : '—'}</b>
                      <span className="mono muted">{nextMin != null ? `${nextMin}m` : '—'}</span>
                      <b className="mono">{o?.openInterestUsd ? fmtUsd(o.openInterestUsd) : (o?.openInterest ? `${o.openInterest.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${symbol}` : '—')}</b>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <div className="settings-body"><small className="muted">{isEquity ? 'Tokenized equities settle on Bitget spot — no cross-venue perp funding tape applies.' : 'Cross-venue positioning not available right now.'}</small></div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head"><h3><TrendingUp size={13} /> Macro regime</h3><small>{mac?.live ? 'live' : 'stale'}</small></div>
          {mac ? (
            <div className="edge-grid">
              <div className="metric"><small>DXY</small><b>{mac.dxy?.last?.toFixed(2) ?? '—'}</b><em className={mac.dxy?.changePct >= 0 ? 'down' : 'up'}>{mac.dxy?.changePct != null ? `${mac.dxy.changePct >= 0 ? '+' : ''}${mac.dxy.changePct.toFixed(2)}%` : '—'}</em></div>
              <div className="metric"><small>VIX</small><b>{mac.vix?.last?.toFixed(1) ?? '—'}</b><em className={(mac.vix?.last ?? 0) >= 20 ? 'down' : 'up'}>{mac.riskRegime?.replace('_', '-')}</em></div>
              <div className="metric"><small>Regime · risk</small><b>{mac.riskRegime || '—'}</b></div>
              {mac.cryptoRegime && <div className="metric"><small>Regime · crypto</small><b>{mac.cryptoRegime}</b></div>}
            </div>
          ) : <div className="settings-body"><small className="muted">Macro tape unavailable.</small></div>}
        </section>
      </div>

      <section className="panel">
        <div className="panel-head"><h3><Newspaper size={13} /> Related headlines</h3><small>{data?.news?.length || 0} tagged {symbol}</small></div>
        {(data?.news?.length || 0) === 0 ? (
          <div className="settings-body"><small className="muted">No recent wire items tagged {symbol}. When one lands, it will appear here and on the News tab.</small></div>
        ) : (
          <ul className="dense related-news" style={{ padding: '10px 14px' }}>
            {data.news.map((n, i) => (
              <li key={n.id || i}>
                <a href={safeUrl(n.url)} target="_blank" rel="noreferrer noopener" className="related-headline">{n.headline}</a>
                <em className="related-meta">{n.source} · {String(n.publishedAt || '').slice(5, 16).replace('T', ' ')} UTC · {n.severity} sev</em>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
