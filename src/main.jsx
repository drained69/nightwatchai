import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, BookOpen, BrainCircuit, BarChart3,
  CalendarClock, ChevronRight, Copy, Cpu, Crosshair, Database, ExternalLink, Eye, FileText, Filter,
  LineChart, LogOut, MessageCircle, Menu, MoonStar, Newspaper, PieChart, Play, Radio, ScanLine,
  Search, Send, Settings, ShieldCheck, Sparkles, Terminal, TerminalSquare, Wallet, X, Zap,
} from 'lucide-react'
import './styles.css'
import { ErrorBoundary } from './ui/ErrorBoundary.jsx'
import { Disclaimer } from './ui/Disclaimer.jsx'
import { useLiveStream } from './ui/useLiveStream.js'
import { hasApi, apiUrl } from './ui/apiBase.js'

/** Convert a /prices/live tickers map into the field shape our market rows use. */
function applyLiveTickers(rows, tickers) {
  return (rows || []).map(m => {
    const t = tickers?.[m.symbol]
    if (!t) return m
    return {
      ...m,
      price: t.last,
      change24h: t.changePct24h,
      live: true,
      stale: Boolean(t.stale),
      spreadBps: t.spreadBps ?? m.spreadBps,
      volumeUsd24h: t.volumeUsd24h ?? m.volumeUsd24h,
    }
  })
}
import { runBacktestSynthetic } from './backtest.js'
import { AssayerPage, MyPlaybooksPanel, PlaybookDetail, SignInWidget, getStoredUser, getToken, logout } from './ui/GetAgentPages.jsx'
import { MarketPulse } from './ui/MarketPulse.jsx'
import { AnalysisPage } from './ui/AnalysisPage.jsx'
import { Nightwatch02Page } from './ui/Nightwatch02Page.jsx'
import { ResearchCardActions } from './ui/ResearchCard.jsx'
import {
  BITGET_CONNECTION_HELP, BITGET_SIGNAL_SKILLS, DEMO_NEWS, DEMO_UNIVERSE,
  DemoMarketData, NightwatchProvider, PaperExecution,
  RESEARCH_QUESTION_SUGGESTIONS, RESEARCH_STEP_MS, addLog, analyzeNewsForUser,
  applyTraderDecision, bitgetTradeUrl, buildReview, classifyIntent, fmtAbs, fmtCap,
  fmtPct, fmtPrice, ingestNewsItem, initialSession, loadSession, nowClock,
  pickNextDemoNews, portfolioImpact, safeUrl, saveSession, shortId,
  uncoveredAssetCandidates,
} from './domain'

const NAV = [
  { id: 'nightwatch02',label: 'NIGHTWATCH 02:00', icon: MoonStar },
  { id: 'research',    label: 'Research',    icon: BrainCircuit },
  { id: 'analysis',    label: 'Analysis',    icon: Crosshair },
  { id: 'assayer',     label: 'The Assayer', icon: MessageCircle },
  { id: 'news',        label: 'News',        icon: Newspaper },
  { id: 'markets',     label: 'Markets',     icon: ScanLine },
  { id: 'signals',     label: 'Signals',     icon: Radio },
  { id: 'thesis',      label: 'Thesis Lab',  icon: TerminalSquare },
  { id: 'portfolio',   label: 'Portfolio',   icon: Wallet },
  { id: 'backtest',    label: 'Backtest',    icon: BarChart3 },
  { id: 'history',     label: 'History',     icon: BookOpen },
  { id: 'settings',    label: 'Settings',    icon: Settings },
]

/* --------------------------------------------------------- App shell */

function App({ authUser: signedInUser, onSignedOut }) {
  const [page, setPage] = useState('research')
  // IMPORTANT: session state is user-scoped in localStorage. The parent AuthGate
  // remounts <App> with a fresh key whenever the user changes, so we compute
  // the initial session against *this* user's id — never the shared slot.
  const [authUser, setAuthUser] = useState(signedInUser || getStoredUser)
  const initialUserId = (signedInUser || getStoredUser())?.id || null
  const [session, setSession] = useState(() => loadSession(initialUserId))
  const [command, setCommand] = useState('')
  const [running, setRunning] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [toast, setToast] = useState('')
  const [clock, setClock] = useState(nowClock())
  const [liveTrace, setLiveTrace] = useState([])
  const [activeArtifact, setActiveArtifact] = useState(null)
  const [openPlaybookId, setOpenPlaybookId] = useState(null)
  const authToken = getToken()
  const [bitgetStatus, setBitgetStatus] = useState({ connected: false, model: null, reason: 'checking…' })
  const [personalHydrated, setPersonalHydrated] = useState(false)

  const sessionRef = useRef(session)
  const timers = useRef([])
  const market = useRef(new DemoMarketData(session.universe)).current
  const paper = useRef(new PaperExecution()).current
  const provider = useRef(new NightwatchProvider()).current

  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { saveSession(session, authUser?.id || null) }, [session, authUser?.id])

  // Personal session hydrate: on sign-in, pull this user's server-side
  // watchlist/preferences/reports/positions/etc. so their state follows them
  // across devices instead of living only in the current browser.
  useEffect(() => {
    if (!authUser || !authToken || !hasApi()) { setPersonalHydrated(true); return }
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(apiUrl('/session'), { headers: { Authorization: `Bearer ${authToken}` }, signal: AbortSignal.timeout(8000) })
        if (!res.ok) return
        const body = await res.json()
        const s = body?.session || {}
        if (!alive) return
        // Only let a server array replace local state when it actually holds
        // something — signing in against a fresh/empty profile must not wipe
        // research, positions or watchlist accumulated offline in this browser.
        const pick = (remote, local) => Array.isArray(remote) && (remote.length > 0 || !(local?.length > 0)) ? remote : local
        setSession(prev => ({
          ...prev,
          watchlist:   pick(s.watchlist,   prev.watchlist),
          reports:     pick(s.reports,     prev.reports),
          signals:     pick(s.signals,     prev.signals),
          theses:      pick(s.theses,      prev.theses),
          positions:   pick(s.positions,   prev.positions),
          decisions:   pick(s.decisions,   prev.decisions),
          reviews:     pick(s.reviews,     prev.reviews),
          newsAlerts:  pick(s.newsAlerts,  prev.newsAlerts),
          memory:      s.preferences ? { ...prev.memory, preferences: { ...prev.memory.preferences, ...s.preferences } } : prev.memory,
        }))
      } catch { /* keep local session as-is */ }
      finally { if (alive) setPersonalHydrated(true) }
    })()
    return () => { alive = false }
  }, [authUser?.id, authToken])

  // Structural signature of the paper book: id/status/sizing only. Mark-to-market
  // ticks mutate prices/pnl every 10s — syncing on array identity fired a full
  // PATCH on every tick; the server copy only needs structural changes (live
  // prices re-mark open positions on the next hydrate anyway).
  const positionsSig = (session.positions || []).map(p => `${p.id}:${p.status}:${p.notional}:${p.entryPrice}:${p.closedAt || ''}`).join('|')

  // Debounced push of personal state back to the user's account so it survives
  // browser reloads and shows up on their other devices.
  useEffect(() => {
    if (!authUser || !authToken || !hasApi() || !personalHydrated) return
    const t = setTimeout(() => {
      const patch = {
        watchlist:   session.watchlist,
        preferences: session.memory?.preferences,
        reports:     session.reports,
        signals:     session.signals,
        theses:      session.theses,
        positions:   session.positions,
        decisions:   session.decisions,
        reviews:     session.reviews,
        newsAlerts:  session.newsAlerts,
      }
      fetch(apiUrl('/session'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(patch),
        signal: AbortSignal.timeout(8000),
      }).catch(() => { /* offline is fine — local save still holds */ })
    }, 1500)
    return () => clearTimeout(t)
  }, [
    authUser?.id, authToken, personalHydrated,
    session.watchlist, session.memory?.preferences, session.reports, session.signals,
    session.theses, positionsSig, session.decisions, session.reviews, session.newsAlerts,
  ])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  useEffect(() => { const t = setInterval(() => setClock(nowClock()), 1000); return () => clearInterval(t) }, [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3400); return () => clearTimeout(t) }, [toast])

  // Mark-to-market ticker for paper positions. In real-product mode the adapter
  // owns prices (see /prices/live hydrate + /prices/stream below); we only fall
  // back to the synthetic random walk when no adapter is configured.
  useEffect(() => {
    if (hasApi()) return
    const t = setInterval(() => {
      setSession(prev => {
        const snap = market.tick()
        let next = { ...prev, markets: snap }
        if (prev.positions?.some(p => p.status === 'OPEN')) {
          next = {
            ...next,
            positions: prev.positions.map(p => {
              if (p.status !== 'OPEN') return p
              const m = snap.find(s => s.symbol === p.asset)
              return m ? paper.mark(p, m) : p
            }),
          }
        }
        return next
      })
    }, 2400)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let alive = true
    provider.bitgetStatus().then(s => { if (alive) setBitgetStatus(s) })
    return () => { alive = false }
  }, [])

  // When a self-directed paper position transitions to CLOSED — whether via
  // CLOSE AT MARK or an auto stop/target hit inside the ticker loop — credit
  // the realized $ PnL to the user's server paper account. The server is
  // idempotent by position id, so this effect can safely re-fire and cannot
  // double-credit even if the browser re-renders.
  const creditedRef = useRef(new Set())
  useEffect(() => {
    if (!hasApi() || !authToken) return
    for (const p of session.positions || []) {
      if (p.status !== 'CLOSED') continue
      if (creditedRef.current.has(p.id)) continue
      const amountUsd = Number(p.pnl)
      if (!Number.isFinite(amountUsd)) continue
      creditedRef.current.add(p.id)
      fetch(apiUrl('/paper/credit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ amountUsd, sourceId: p.id }),
        signal: AbortSignal.timeout(6000),
      }).catch(() => { creditedRef.current.delete(p.id) /* retry on next render — server is idempotent */ })
    }
  }, [session.positions, authToken])

  // Real prices + news on first paint: hydrate from REST before the SSE streams
  // arrive so the UI never shows a hardcoded demo price or seeded headline when
  // the adapter is available.
  useEffect(() => {
    if (!hasApi()) return
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(apiUrl('/prices/live'), { signal: AbortSignal.timeout(6000) })
        if (!res.ok) return
        const body = await res.json()
        const tickers = body?.tickers
        if (!alive || !tickers || !Object.keys(tickers).length) return
        setSession(prev => {
          const markets = applyLiveTickers(prev.markets, tickers)
          market.sync(markets)
          return { ...prev, markets, universe: applyLiveTickers(prev.universe, tickers) }
        })
      } catch { /* SSE will catch up */ }
    })()
    ;(async () => {
      try {
        const res = await fetch(apiUrl('/news/live?limit=30'), { signal: AbortSignal.timeout(6000) })
        if (!res.ok) return
        const body = await res.json()
        const items = body?.items
        if (!alive || !Array.isArray(items) || items.length === 0) return
        setSession(prev => {
          // Replace seeded demo items with the real wire on first hydrate. Preserve
          // any items already ingested via SSE by de-duplicating on id.
          const existingIds = new Set((prev.news || []).filter(n => n && !n.isSimulated).map(n => n.id))
          const fresh = items
            .filter(it => it && !existingIds.has(it.id))
            .map(it => ({ ...it, analysis: analyzeNewsForUser(it, prev) }))
          // Sort by real publish time — SSE items ingested between request and
          // response are newer than the REST batch and must not render below it.
          const merged = [...fresh, ...(prev.news || []).filter(n => !n.isSimulated)]
            .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
            .slice(0, 60)
          return { ...prev, news: merged }
        })
      } catch { /* SSE will fill in */ }
    })()
    return () => { alive = false }
  }, [])

  // Ingest one live news item. Runs outside React state updaters (via the
  // sessionRef mirror) so SSE bursts deliver EVERY headline — a "latest wins"
  // state hop would silently drop all but the last item of each burst — and so
  // the breaking-news toast never fires from inside an updater.
  const ingestLiveNews = (data) => {
    if (!data?.headline) return
    const prev = sessionRef.current
    const next = ingestNewsItem(prev, data)
    sessionRef.current = next
    setSession(next)
    if ((next.newsAlerts || []).length > (prev.newsAlerts || []).length) {
      const h = String(data.headline || '')
      setToast(`Breaking · ${h.slice(0, 80)}${h.length > 80 ? '…' : ''}`)
    }
  }

  // Live news + prices: prefer the adapter's SSE streams; fall back only for
  // dev-time no-adapter mode (see hasApi() gate above).
  const newsStream   = useLiveStream('/news/stream', ['news'], (type, data) => { if (type === 'news') ingestLiveNews(data) })
  const pricesStream = useLiveStream('/prices/stream', ['prices'])

  useEffect(() => {
    const ev = pricesStream.events?.prices
    if (!ev?.data?.tickers) return
    setSession(prev => {
      const tickers = ev.data.tickers
      const markets = applyLiveTickers(prev.markets, tickers)
      market.sync(markets)               // freeze the demo random walk at real prices
      const positions = prev.positions?.some(p => p.status === 'OPEN')
        ? prev.positions.map(p => {
            if (p.status !== 'OPEN') return p
            const m = markets.find(r => r.symbol === p.asset)
            return m ? paper.mark(p, m) : p
          })
        : prev.positions
      return { ...prev, markets, universe: applyLiveTickers(prev.universe, tickers), positions }
    })
  }, [pricesStream.events?.prices?.at])

  // Fallback demo-news ticker only when no adapter is attached (dev-only).
  // Real product: the adapter's /news/stream is the sole source of headlines.
  useEffect(() => {
    if (hasApi() || newsStream.endpoint) return
    const t = setInterval(() => {
      ingestLiveNews(pickNextDemoNews(sessionRef.current.newsCursor))
    }, 45000)
    return () => clearInterval(t)
  }, [newsStream.endpoint])

  const sleep = (ms) => new Promise(r => { timers.current.push(setTimeout(r, ms)) })
  const cancelTheatre = () => { timers.current.forEach(clearTimeout); timers.current = [] }

  const notify = (msg) => setToast(msg)

  /** Route a natural-language question to the right engine + UI */
  const submit = async (rawText) => {
    const text = (rawText ?? command).trim()
    if (!text) { notify('Type a question — e.g. "Why is NVDA moving?"'); return }
    if (running) return
    setRunning(true)
    cancelTheatre()
    setLiveTrace([])
    const routed = classifyIntent(text)
    setSession(s => addLog({ ...s, stage: 'INTAKE' }, 'USER', text, `Intent: ${routed.intent}${routed.asset ? ' · ' + routed.asset : ''}`))
    // Uncovered name (e.g. "research on Dangote IPO"): refuse instead of
    // silently falling back to a BTC report the user never asked for.
    if (!routed.asset && routed.intent !== 'find-opportunities' && routed.intent !== 'review') {
      const unknown = uncoveredAssetCandidates(text)
      if (unknown.length) {
        setSession(s => addLog({ ...s, stage: 'INTAKE' }, 'ERROR', `Unsupported asset: "${unknown[0]}"`, `Coverage: ${DEMO_UNIVERSE.map(a => a.symbol).join(', ')}`))
        notify(`"${unknown[0]}" isn't in this desk's coverage universe. Supported: ${DEMO_UNIVERSE.map(a => a.symbol).join(', ')}.`)
        setRunning(false)
        return
      }
    }
    try {
      if      (routed.intent === 'research')            await runResearch(text, routed)
      else if (routed.intent === 'thesis-test')         await runThesis(text)
      else if (routed.intent === 'portfolio-impact')    await runPortfolioImpact(text, routed)
      else if (routed.intent === 'execution-help')      await runExecution(text, routed)
      else if (routed.intent === 'review')              await runReview()
      else if (routed.intent === 'find-opportunities')  await runOpportunities(text)
    } catch (err) {
      setSession(s => addLog({ ...s, stage: 'ERROR' }, 'ERROR', err.message, ''))
      notify(err.message)
    } finally {
      cancelTheatre()
      setRunning(false)
    }
  }

  const runResearch = async (question, routed) => {
    const asset = routed.asset || 'BTC'
    setSession(s => addLog({ ...s, stage: 'GATHERING' }, 'SKILL', 'Skill pack armed', `Target ${asset}`))
    const response = await provider.run({ intent: 'research', question, asset, context: { memory: sessionRef.current.memory, session: { watchlist: sessionRef.current.watchlist, positions: sessionRef.current.positions } } })
    // Stamp the narration engine onto the report so the downloadable card can
    // credit Qwen (or whichever provider actually authored the writeup).
    const report = { ...response.artifact.report, engine: response.engine || 'LOCAL' }
    for (const skill of report.skills) {
      await sleep(RESEARCH_STEP_MS)
      setLiveTrace(t => [...t, skill])
      setSession(s => addLog(s, 'SKILL', `${skill.skill} · ${skill.title}`, `${Math.round(skill.confidence * 100)}% confidence · ${skill.source}`))
    }
    await sleep(RESEARCH_STEP_MS)
    setSession(s => {
      const reports = [report, ...(s.reports || [])].slice(0, 40)
      const signals = [{ id: shortId('sig'), reportId: report.id, asset: report.symbol, ...report.signal, createdAt: report.createdAt }, ...(s.signals || [])].slice(0, 60)
      return addLog({ ...s, reports, signals, stage: report.signal.status === 'NO_TRADE' ? 'NO_TRADE' : 'AWAITING_TRADER', activeReportId: report.id, provider: { ...s.provider, engine: response.engine, bitgetLive: response.bitgetLive } },
        'REPORT', `Research report ready · ${report.symbol}`, `${report.signal.status} · net edge ${fmtPct(report.signal.netEdge)}`)
    })
    setActiveArtifact({ type: 'research', payload: report })
    notify(`Report ready · ${report.symbol} · ${report.signal.status}`)
  }

  const runThesis = async (question) => {
    const cleaned = question.replace(/^\/thesis\s+/i, '').replace(/^\/challenge\s+/i, '')
    setSession(s => addLog({ ...s, stage: 'CHALLENGING' }, 'THESIS', 'Stress-testing thesis', cleaned.slice(0, 80)))
    const response = await provider.run({ intent: 'thesis-test', thesis: cleaned, context: { memory: sessionRef.current.memory } })
    const artifact = response.artifact.thesisReport
    for (const skill of artifact.skills) {
      await sleep(RESEARCH_STEP_MS - 120)
      setLiveTrace(t => [...t, skill])
    }
    setSession(s => addLog({ ...s, theses: [artifact, ...(s.theses || [])].slice(0, 40), stage: 'IDLE' }, 'THESIS', `Verdict ${artifact.verdict} · ${artifact.asset}`, `${(artifact.confidenceBefore * 100).toFixed(0)}% → ${(artifact.confidenceAfter * 100).toFixed(0)}%`))
    setActiveArtifact({ type: 'thesis', payload: artifact })
    setPage('thesis')
    notify(`Thesis ${artifact.verdict} · confidence ${(artifact.confidenceBefore * 100).toFixed(0)}% → ${(artifact.confidenceAfter * 100).toFixed(0)}%`)
  }

  const runPortfolioImpact = async (question, routed) => {
    const symbol = routed.asset || 'BTC'
    const notional = Number((question.match(/\$?([0-9]{2,7})/) || [])[1]) || 1500
    const direction = /short/i.test(question) ? 'SHORT' : 'LONG'
    const impact = portfolioImpact({ symbol, notional, direction, session: sessionRef.current })
    setSession(s => addLog(s, 'PORTFOLIO', `Impact simulation · ${symbol}`, `Δ exposure ${((impact?.exposurePctAfter || 0) * 100).toFixed(1)}% · Δ beta ${((impact?.betaAfter || 0) - (impact?.betaBefore || 0)).toFixed(2)}`))
    setActiveArtifact({ type: 'portfolio', payload: { symbol, notional, direction, impact } })
    setPage('portfolio')
    notify(`Portfolio impact ready · ${symbol} · $${notional}`)
  }

  const runExecution = async (question, routed) => {
    const asset = routed.asset || 'BTC'
    const response = await provider.run({ intent: 'execution-help', asset, question, context: { memory: sessionRef.current.memory } })
    const plan = response.artifact.executionPlan
    setSession(s => addLog(s, 'PLAN', `Execution plan · ${asset}`, `entry $${fmtPrice(plan.entry)} · stop $${fmtPrice(plan.stop)} · R:R ${plan.riskReward}`))
    setActiveArtifact({ type: 'execution', payload: { asset, plan } })
    notify(`Execution plan · ${asset} · R:R ${plan.riskReward}`)
  }

  const runReview = async () => {
    const s = sessionRef.current
    const position = [...s.positions].reverse().find(p => p.status === 'CLOSED')
    if (!position) { notify('No closed position to review.'); return }
    const report = s.reports.find(r => r.symbol === position.asset)
    const review = buildReview({ position, report, actualOutcome: { pnlPct: position.pnlPercent } })
    setSession(cur => addLog({ ...cur, reviews: [review, ...(cur.reviews || [])] }, 'REVIEW', `Review · ${position.asset}`, review.summary))
    setActiveArtifact({ type: 'review', payload: review })
    setPage('history')
    notify(`Review written · ${position.asset}`)
  }

  const runOpportunities = async (question) => {
    const s = sessionRef.current
    const response = await provider.run({ intent: 'find-opportunities', watchlistOnly: /watchlist|my/i.test(question), context: { session: { watchlist: s.watchlist, positions: s.positions }, memory: s.memory, universe: s.universe } })
    const opportunities = response.artifact.opportunities
    setSession(s => addLog(s, 'SCAN', `Opportunity scan · ${opportunities.length} candidates`, opportunities.slice(0, 3).map(o => o.symbol).join(' · ')))
    setActiveArtifact({ type: 'opportunities', payload: opportunities })
    setPage('signals')
    notify(`Scan complete · ${opportunities.length} candidates`)
  }

  const decide = (action, overrides) => {
    const s = sessionRef.current
    const report = s.reports.find(r => r.id === s.activeReportId)
    if (!report) { notify('No active research report.'); return }
    try {
      const next = applyTraderDecision(s, report, { action, overrides })
      setSession(next)
      if (action === 'APPROVE') notify(`Paper order filled · ${report.symbol}`)
      else if (action === 'REJECT') notify(`Rejected · ${report.symbol}`)
      else notify(`Sit-out logged · ${report.symbol}`)
    } catch (err) { notify(err.message) }
  }

  const closeAtMark = (positionId) => {
    const s = sessionRef.current
    const open = positionId
      ? s.positions.find(p => p.id === positionId && p.status === 'OPEN')
      : s.positions.find(p => p.status === 'OPEN')
    if (!open) { notify('No open paper position.'); return }
    // Real product: only close at the current mark-to-market P&L. If the live tick
    // has not yet marked this position, keep P&L at 0 rather than fabricating a return.
    const pnlPct = Number.isFinite(open.pnlPercent) ? open.pnlPercent : 0
    const closed = paper.simulateClose(open, pnlPct)
    closed.closeReason = 'CLOSED_AT_MARK'
    // The credit useEffect above will post this realized $ PnL to the server
    // paper account (idempotent by position id), so Free Capital + Realized
    // P&L update whether the user closed manually or a stop/target hit fired.
    setSession(cur => addLog({ ...cur, positions: cur.positions.map(p => p.id === open.id ? closed : p) }, 'POSITION', `${open.asset} closed`, `CLOSED @ MARK · ${fmtPct(closed.pnlPercent)}`))
    notify(`Closed at mark · ${open.asset} · ${fmtPct(closed.pnlPercent)}`)
  }

  const resetSession = () => {
    const fresh = initialSession()
    setSession(fresh); setCommand(''); setLiveTrace([]); setActiveArtifact(null)
    market.markets = fresh.universe.map(m => ({ ...m }))
    notify('Session reset')
  }

  const toggleWatch = (symbol) => {
    setSession(s => {
      const inList = s.watchlist.includes(symbol)
      const watchlist = inList ? s.watchlist.filter(x => x !== symbol) : [...s.watchlist, symbol]
      return { ...s, watchlist }
    })
  }

  const activeReport = session.reports.find(r => r.id === session.activeReportId)

  return (
    <div className="app-shell">
      <aside className={mobileNav ? 'sidebar open' : 'sidebar'}>
        <div className="brand">
          <img className="brand-mark" src="/logo.svg" alt="NIGHTWATCH AI" width="36" height="36" />
          <div className="brand-name">
            <strong>NIGHTWATCH<span>AI</span></strong>
            <small>AI TRADING DESK</small>
          </div>
          <button className="icon-btn mobile-close" onClick={() => setMobileNav(false)} aria-label="Close nav"><X size={16} /></button>
        </div>
        <div className={(bitgetStatus.connected || pricesStream.connected || newsStream.connected) ? 'env-badge ok' : 'env-badge'}>
          <span className="dot" /> {
            bitgetStatus.connected                                    ? 'BITGET MCP · LIVE'
            : (pricesStream.connected && newsStream.connected)        ? 'LIVE FEED · PRICES + NEWS'
            : pricesStream.connected                                  ? 'LIVE PRICES · NEWS CONNECTING'
            : newsStream.connected                                    ? 'LIVE NEWS · PRICES CONNECTING'
                                                                      : 'CONNECTING · BITGET TAPE'
          }
        </div>
        <nav>
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} className={page === id ? 'nav-item on' : 'nav-item'} onClick={() => { setPage(id); setMobileNav(false) }}>
              <Icon size={15} /><span>{label}</span>
              {id === 'news'      && session.newsAlerts?.length ? <em className="alert">{session.newsAlerts.length}</em> : null}
              {id === 'signals'   && session.signals?.length > 0 ? <em>{session.signals.length}</em> : null}
              {id === 'portfolio' && session.positions?.filter(p => p.status === 'OPEN').length ? <em>{session.positions.filter(p => p.status === 'OPEN').length}</em> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="watch-strip">
            <small>WATCHLIST</small>
            <div className="watch-list">
              {session.watchlist.slice(0, 6).map(sym => {
                const m = session.markets.find(x => x.symbol === sym) || session.universe.find(x => x.symbol === sym)
                if (!m) return null
                return <div className="watch-row" key={sym} onClick={() => { setCommand(`Why is ${sym} moving right now?`); setPage('research') }}>
                  <b>{sym}</b><span className={m.change24h >= 0 ? 'up' : 'down'}>{fmtPct(m.change24h / 100)}</span>
                </div>
              })}
            </div>
          </div>
          <div className="hint"><Cpu size={11} /> {session.provider.engine} · {session.reports?.length || 0} reports</div>
          {authUser && (
            <div className="account-strip" role="group" aria-label="Account">
              <div className="account-avatar" aria-hidden="true">
                {(authUser.name || authUser.email || '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="account-info">
                <small className="account-label">Signed in as</small>
                <b className="account-name" title={authUser.name || authUser.email}>
                  {authUser.name || authUser.email?.split('@')[0]}
                </b>
                <small className="account-email" title={authUser.email}>{authUser.email}</small>
              </div>
              <button
                type="button"
                className="account-signout"
                onClick={() => { if (confirm('Sign out of NIGHTWATCH AI?')) onSignedOut?.() }}
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut size={14} />
              </button>
            </div>
          )}
        </div>
      </aside>

      {mobileNav && <div className="scrim" onClick={() => setMobileNav(false)} />}

      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setMobileNav(true)}><Menu size={17} /></button>
          <div className="crumbs">
            <span>NIGHTWATCH AI</span><ChevronRight size={13} /><b>{(NAV.find(n => n.id === page) || NAV[0]).label.toUpperCase()}</b>
          </div>
          <div className="topbar-right">
            <span className="ticker-tape">
              {['NVDA','TSLA','AAPL','MSFT','AMD','META','MSTR','COIN','BTC'].map(sym => {
                const m = session.markets.find(x => x.symbol === sym) || session.universe.find(x => x.symbol === sym)
                if (!m) return null
                return <span key={sym}><b>{sym}</b> ${fmtPrice(m.price)} <em className={m.change24h >= 0 ? 'up' : 'down'}>{fmtPct(m.change24h / 100)}</em></span>
              })}
            </span>
            <span className="clock"><Radio size={12} /> {clock} UTC</span>
          </div>
        </header>

        {/* Per-page boundary (keyed on page): a malformed server payload crashes
            one tab, not the whole workstation; navigating resets the boundary. */}
        <ErrorBoundary key={page}>
        {page === 'nightwatch02' && <Nightwatch02Page user={authUser} onAsk={q => { setCommand(q); setPage('research'); submit(q) }} />}
        {page === 'research'  && <ResearchPage {...{ command, setCommand, submit, running, session, liveTrace, activeReport, decide, closeAtMark, activeArtifact }} />}
        {page === 'analysis'  && <AnalysisPage />}
        {page === 'news'      && <NewsPage session={session} setSession={setSession} onAsk={q => { setCommand(q); setPage('research'); submit(q) }} />}
        {page === 'markets'   && <MarketsPage session={session} onAsk={q => { setCommand(q); setPage('research'); submit(q) }} toggleWatch={toggleWatch} />}
        {page === 'signals'   && <SignalsPage session={session} activeArtifact={activeArtifact} onAsk={q => { setCommand(q); setPage('research'); submit(q) }} />}
        {page === 'thesis'    && <ThesisPage session={session} activeArtifact={activeArtifact} setCommand={setCommand} submit={submit} />}
        {page === 'portfolio' && <PortfolioPage session={session} activeArtifact={activeArtifact} closeAtMark={closeAtMark} setCommand={setCommand} submit={submit} />}
        {page === 'backtest'  && <BacktestPage session={session} />}
        {page === 'history'   && <HistoryPage session={session} activeArtifact={activeArtifact} onAsk={q => { setCommand(q); setPage('research'); submit(q) }} />}
        {page === 'settings'  && <SettingsPage session={session} setSession={setSession} bitgetStatus={bitgetStatus} onReset={resetSession} />}
        {page === 'assayer'   && (
          authUser
            ? <AssayerPage user={authUser} onAllocated={() => setPage('portfolio')} />
            : <div className="page"><SignInWidget onSignedIn={(u) => setAuthUser(u)} /><AssayerPage user={null} /></div>
        )}
        {openPlaybookId && <PlaybookDetail id={openPlaybookId} user={authUser} onClose={() => setOpenPlaybookId(null)} onAllocated={() => { setOpenPlaybookId(null); notify('Paper allocation updated') }} />}
        </ErrorBoundary>

        {toast && <div className="toast"><ShieldCheck size={13} /> {toast}</div>}
      </main>
    </div>
  )
}

/* --------------------------------------------------- Research page (hero) */

function ResearchPage({ command, setCommand, submit, running, session, liveTrace, activeReport, decide, closeAtMark, activeArtifact }) {
  const skillState = BITGET_SIGNAL_SKILLS.map((spec, idx) => {
    const done = liveTrace.find(t => t.skill === spec.id)
    const inFlight = running && !done && liveTrace.length >= idx
    return { spec, done, inFlight }
  })
  return (
    <div className="page">
      <section className="hero">
        <div className="hero-line">
          <span className="eyebrow"><i className="dot green" /> FOR EVENT-DRIVEN &amp; INFORMATION-HEAVY TRADERS</span>
          <h1>Ask NIGHTWATCH AI a question.</h1>
          <p>Trade the information, not just the chart. Type a research question in plain English — Nightwatch fires the five Bitget research skills (news, market intel, technicals, sentiment, macro), synthesizes the evidence, and hands you an actionable report with verdict, entry, stop and target you can copy to your paper book in one click.</p>
        </div>
        <div className="commandbar">
          <div className="cb-icon"><Terminal size={15} /></div>
          <input
            value={command}
            onChange={e => setCommand(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) submit() }}
            placeholder='e.g. "Research NVDA overnight and tell me whether the current move looks sustainable."'
          />
          <span className="cb-hint">↵</span>
          <button className={running ? 'btn primary running' : 'btn primary'} onClick={() => submit()} disabled={running}>
            {running ? <><Zap size={13} /> RESEARCHING…</> : <><Play size={13} /> RUN RESEARCH</>}
          </button>
        </div>
        <MarketPulse />
        <EarningsStrip onAsk={(sym) => submit(`Research ${sym} into its earnings print`)} />
        <div className="chip-row">
          {RESEARCH_QUESTION_SUGGESTIONS.map(chip => (
            <button className="chip" key={chip.id} onClick={() => { setCommand(chip.question); submit(chip.question) }}>{chip.label}</button>
          ))}
        </div>
      </section>

      <section className="skill-rail">
        {skillState.map(({ spec, done, inFlight }) => (
          <div key={spec.id} className={done ? 'skill on' : inFlight ? 'skill wait' : 'skill'}>
            <div className="skill-head">
              <small>{spec.id}</small>
              {done ? <em>{Math.round(done.confidence * 100)}%</em> : inFlight ? <em className="wait">gathering…</em> : <em className="idle">ready</em>}
            </div>
            <b>{done ? done.title : spec.label}</b>
            <span>{done ? done.excerpt : spec.purpose}</span>
          </div>
        ))}
      </section>

      {activeArtifact?.type === 'execution' ? <ExecutionCard payload={activeArtifact.payload} /> : null}

      {activeReport ? (
        <ResearchReportView report={activeReport} decide={decide} session={session} closeAtMark={closeAtMark} />
      ) : (
        <div className="empty-report">
          <div className="empty-icon"><Search size={22} /></div>
          <b>No active report</b>
          <p>Ask a research question above, or pick a suggestion. NIGHTWATCH will invoke the 5 Bitget research skills and stream evidence into a structured report.</p>
        </div>
      )}
    </div>
  )
}

function ResearchReportView({ report, decide, session, closeAtMark }) {
  const s = report.signal
  const openPosition = session.positions.find(p => p.status === 'OPEN' && p.asset === report.symbol)
  const isTradable = s.status === 'SIGNAL' && !openPosition
  return (
    <article className="report">
      <header className="report-head">
        <div>
          <span className="eyebrow"><FileText size={11} /> RESEARCH REPORT · {new Date(report.createdAt).toISOString().slice(11, 16)} UTC · {report.dataMode === 'LIVE' ? 'LIVE TAPE' : 'OFFLINE FALLBACK'}</span>
          <h2>{report.symbol} · <em>{s.direction}</em></h2>
          <p className="q">“{report.question}”</p>
        </div>
        <div className="report-badges">
          <span className={s.status === 'NO_TRADE' ? 'pill red' : s.direction === 'LONG' ? 'pill green' : 'pill amber'}>
            {s.status === 'NO_TRADE' ? 'SIT-OUT RECOMMENDED' : `${s.direction} · ${(s.confidence * 100).toFixed(0)}% conf`}
          </span>
          <span className="pill outline">{report.dataMode === 'LIVE' ? 'LIVE' : 'OFFLINE'}</span>
          {s.persona && <span className="pill outline">{s.persona.style} · {s.persona.risk}</span>}
        </div>
      </header>

      <ActionSummaryCard
        report={report}
        openPosition={openPosition}
        isTradable={isTradable}
        decide={decide}
        closeAtMark={closeAtMark}
      />

      <ThesisAndCardBlock report={report} />

      <div className="report-summary">
        <p>{report.summary}</p>
        {report.dataFreshness && <small className="muted">{report.dataFreshness}</small>}
      </div>

      <div className="edge-grid">
        <Metric label="Expected edge" value={fmtPct(s.expectedEdge)} tone="green" />
        <Metric label="Estimated friction" value={fmtPct(-s.estimatedFriction)} tone="red" />
        <Metric label="Risk adjustment" value={fmtPct(-s.riskAdjustment)} tone="red" />
        <Metric label="Net edge" value={fmtPct(s.netEdge)} tone={s.netEdge >= 0 ? 'accent' : 'red'} strong />
        <Metric label="Composite score" value={String(s.composite)} />
        <Metric label="Horizon" value={s.horizon.replace(/_/g, ' ').toLowerCase()} />
      </div>

      <div className="report-grid">
        <Section title="Catalyst" icon={<Sparkles size={13} />}>
          <p>{s.catalyst}</p>
        </Section>

        {(() => {
          const nb = report.skills?.find(x => x.skill === 'news-briefing')
          const items = nb?.data?.newsItems
          if (!items?.length) return null
          return (
            <Section title="Live wire tape" icon={<Newspaper size={13} />}>
              <ul className="dense">
                {items.map((n, i) => (
                  <li key={i}>
                    <a href={safeUrl(n.url)} target="_blank" rel="noreferrer noopener">{n.headline}</a>
                    <em>{n.source} · {String(n.publishedAt || '').slice(5, 16).replace('T', ' ')} UTC · {n.direction}{n.severity === 'HIGH' ? ' · HIGH SEV' : ''}</em>
                  </li>
                ))}
              </ul>
            </Section>
          )
        })()}

        <Section title="Supporting evidence" icon={<ArrowUpRight size={13} />} tone="green">
          <ul>
            {report.supporting.map((row, i) => (
              <li key={i}><b>[{row.source}]</b> {row.claim}<em>{row.evidence}</em></li>
            ))}
            {report.supporting.length === 0 && <li className="none">No supporting evidence surfaced.</li>}
          </ul>
        </Section>

        <Section title="Contradicting evidence" icon={<ArrowDownRight size={13} />} tone="amber">
          <ul>
            {report.contradicting.length === 0 && <li className="none">No material contradictions surfaced.</li>}
            {report.contradicting.map((row, i) => (
              <li key={i}><b>[{row.source}]</b> {row.claim}<em>{row.evidence}</em></li>
            ))}
          </ul>
        </Section>

        <Section title="Risks" icon={<AlertTriangle size={13} />} tone="red">
          <ul>
            {report.risks.length === 0 && <li className="none">No material risk factors flagged.</li>}
            {report.risks.map((r, i) => <li key={i}><b>{r.label}</b><em>{r.detail}</em></li>)}
          </ul>
        </Section>

        <Section title="Invalidation" icon={<ShieldCheck size={13} />}>
          {report.invalidation.price ? <div className="kv"><span>Price level</span><b>${fmtPrice(report.invalidation.price)}</b></div> : null}
          <ul className="dense">
            {report.invalidation.conditions.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </Section>

        <Section title="Historical analogs" icon={<PieChart size={13} />}>
          {report.analogs.length === 0 && <p className="none">No historical analogs on file for {report.symbol}. Add one via review after a trade.</p>}
          {report.analogs.map(a => (
            <div className="analog" key={a.id}>
              <b>{a.id}</b>
              <div><span>{a.setup}</span><em>{a.outcome}</em></div>
              <small>sim {(a.similarity * 100).toFixed(0)}% · {a.lesson}</small>
            </div>
          ))}
        </Section>
      </div>

      {report.suggestion ? (
        <div className="suggest">
          <div className="suggest-head">
            <div><span className="eyebrow"><Crosshair size={12} /> SUGGESTED EXECUTION · YOU DECIDE</span><h3>Human-in-the-loop plan</h3></div>
            <span className="pill outline">R:R {report.suggestion.riskReward}</span>
          </div>
          <div className="suggest-grid">
            <Metric label="Notional" value={`$${report.suggestion.notional.toLocaleString()}`} />
            <Metric label="% of NAV"  value={fmtPct(report.suggestion.notionalPctOfNav, 1)} />
            <Metric label="Entry"     value={`$${fmtPrice(report.suggestion.entry)}`} />
            <Metric label="Stop"      value={`$${fmtPrice(report.suggestion.stop)}`}   tone="red" />
            <Metric label="Target"    value={`$${fmtPrice(report.suggestion.target)}`} tone="green" />
            <Metric label="Est. friction" value={fmtPct(report.suggestion.estimatedFriction.totalPct)} />
          </div>
          <div className="slice-row">
            {report.suggestion.slices.map((sl, i) => (
              <span key={i}>{Math.round(sl.pct * 100)}% · {sl.condition}</span>
            ))}
          </div>
          <p className="note">{report.suggestion.notes.join(' ')}</p>
          <div className="report-actions">
            {isTradable && <button className="btn primary" onClick={() => decide('APPROVE')}>APPROVE PAPER TRADE</button>}
            {isTradable && <button className="btn ghost" onClick={() => decide('REJECT', { rationale: 'Not now.' })}>REJECT</button>}
            <button className="btn ghost" onClick={() => decide('SIT_OUT', { rationale: 'Sit-out logged.' })}>LOG SIT-OUT</button>
            {openPosition && <button className="btn ghost" onClick={() => closeAtMark(openPosition.id)}>CLOSE AT MARK</button>}
          </div>
        </div>
      ) : (
        <div className="suggest sit">
          <div className="suggest-head">
            <div><span className="eyebrow"><Eye size={12} /> NO SUGGESTED EXECUTION</span><h3>NIGHTWATCH does not open a book here</h3></div>
            <span className="pill red">SIT OUT</span>
          </div>
          <p>{s.reason}</p>
          <div className="report-actions">
            <button className="btn ghost" onClick={() => decide('SIT_OUT', { rationale: 'Sit-out acknowledged.' })}>ACKNOWLEDGE SIT-OUT</button>
          </div>
        </div>
      )}

      <div className="citations">
        <small>Sources · </small>
        {report.citations.slice(0, 12).map((c, i) => (
          <span key={i}>[{c.skill}] {c.url ? <a href={safeUrl(c.url)} target="_blank" rel="noreferrer noopener">{c.source}</a> : c.source}</span>
        ))}
      </div>
    </article>
  )
}

/* ------------------------------------------------------- Markets page */

function MarketsPage({ session, onAsk, toggleWatch }) {
  const [filter, setFilter] = useState('EQUITY')
  const rows = session.markets.filter(m => filter === 'ALL' ? true : filter === 'CRYPTO' ? m.class === 'crypto' : m.class === 'tokenized-equity')
  return (
    <div className="page">
      <PageHead title="Universe scanner" eyebrow={<><ScanLine size={12} /> TOKENIZED U.S. EQUITIES + CRYPTO CORRELATION SET · BITGET SPOT</>}>
        <div className="filter-row">
          {[['EQUITY','US Equities'], ['CRYPTO','Crypto correlation set'], ['ALL','All']].map(([f, label]) => (
            <button key={f} className={filter === f ? 'chip on' : 'chip'} onClick={() => setFilter(f)}>{label}</button>
          ))}
        </div>
      </PageHead>
      <div className="scanner">
        <div className="scan-head">
          <span>Asset</span><span>Price</span><span>24h</span><span>7d</span><span>Cap</span><span>Vol</span><span>Liq</span><span>β</span><span>Event</span><span></span>
        </div>
        {rows.map(m => (
          <div className="scan-row" key={m.symbol}>
            <div className="asset-cell"><div className={`asset-mark ${m.class === 'crypto' ? 'crypto' : 'equity'}`}>{m.symbol.slice(0,1)}</div><div><b>{m.symbol}</b><small>{m.sector}</small></div></div>
            <b className="mono">${fmtPrice(m.price)}</b>
            <span className={m.change24h >= 0 ? 'up' : 'down'}>{fmtPct(m.change24h / 100)}</span>
            <span className={m.change7d  >= 0 ? 'up' : 'down'}>{fmtPct(m.change7d  / 100)}</span>
            <span className="mono muted">{fmtCap(m.marketCap)}</span>
            <span className={`level ${m.volatility.toLowerCase()}`}>{m.volatility}</span>
            <span className={`level ${m.liquidity.toLowerCase()}`}>{m.liquidity}</span>
            <span className="mono muted">{m.beta.toFixed(2)}</span>
            <span className={m.event === 'None' ? 'event none' : 'event on'}>{m.event === 'None' ? '—' : m.event}</span>
            <div className="row-actions">
              <button className="chip mini" onClick={() => toggleWatch(m.symbol)}>{session.watchlist.includes(m.symbol) ? '★' : '☆'}</button>
              <button className="chip mini" onClick={() => onAsk(`Why is ${m.symbol} moving right now?`)}>RESEARCH →</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------- Signals page */

function SignalsPage({ session, activeArtifact, onAsk }) {
  const opportunities = activeArtifact?.type === 'opportunities' ? activeArtifact.payload : null
  return (
    <div className="page">
      <PageHead title="Signals" eyebrow={<><Radio size={12} /> ALL GENERATED SIGNALS</>}>
        <button className="btn primary sm" onClick={() => onAsk('Find the strongest overnight opportunities across my watchlist.')}><Zap size={13} /> SCAN NOW</button>
      </PageHead>
      {opportunities ? (
        <div className="panel">
          <div className="panel-head"><h3>Scan results</h3><small>{opportunities.length} candidates</small></div>
          <div className="opp-table">
            <div className="opp-head"><span>Asset</span><span>Dir</span><span>Conf</span><span>Net edge</span><span>Reason</span><span></span></div>
            {opportunities.map(o => (
              <div className="opp-row" key={o.symbol}>
                <div className="asset-cell"><div className={`asset-mark ${o.class === 'crypto' ? 'crypto' : 'equity'}`}>{o.symbol.slice(0,1)}</div><div><b>{o.symbol}</b><small>{o.name}</small></div></div>
                <span className={o.signal.direction === 'LONG' ? 'pill green mini' : 'pill amber mini'}>{o.signal.direction}</span>
                <b className="mono">{(o.signal.confidence * 100).toFixed(0)}%</b>
                <b className={o.signal.netEdge >= 0 ? 'up mono' : 'down mono'}>{fmtPct(o.signal.netEdge)}</b>
                <span className="reason">{o.signal.reason}</span>
                <button className="chip mini" onClick={() => onAsk(`Research ${o.symbol} — is this signal sustainable?`)}>OPEN →</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-head"><h3>Historical signals</h3><small>Generated by research reports</small></div>
        {(!session.signals || session.signals.length === 0) ? <div className="empty-body">No signals yet. Run research to generate one.</div> : (
          <div className="opp-table">
            <div className="opp-head"><span>Time</span><span>Asset</span><span>Dir</span><span>Conf</span><span>Net edge</span><span>Status</span></div>
            {session.signals.map(sig => (
              <div className="opp-row" key={sig.id}>
                <span className="mono muted">{new Date(sig.createdAt).toISOString().slice(11, 16)}</span>
                <b>{sig.asset}</b>
                <span className={sig.direction === 'LONG' ? 'pill green mini' : sig.direction === 'SHORT' ? 'pill amber mini' : 'pill outline mini'}>{sig.direction}</span>
                <b className="mono">{(sig.confidence * 100).toFixed(0)}%</b>
                <b className={sig.netEdge >= 0 ? 'up mono' : 'down mono'}>{fmtPct(sig.netEdge)}</b>
                <span className={sig.status === 'NO_TRADE' ? 'pill red mini' : 'pill green mini'}>{sig.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------- Thesis Lab page */

function ThesisPage({ session, activeArtifact, setCommand, submit }) {
  const [draft, setDraft] = useState('')
  const artifact = activeArtifact?.type === 'thesis' ? activeArtifact.payload : (session.theses?.[0] || null)
  return (
    <div className="page">
      <PageHead title="Thesis Lab" eyebrow={<><TerminalSquare size={12} /> DECISION STRESS-TESTING</>}>
        <span className="hint-inline">Submit a thesis in trader English. NIGHTWATCH steelmans it, counters it, stress-tests it, and returns a confidence delta.</span>
      </PageHead>
      <div className="thesis-input">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={3}
          placeholder='Example: "Long MSTR here because BTC breakout is real and MSTR premium will re-rate."'
        />
        <button className="btn primary" onClick={() => { if (!draft.trim()) return; const q = `/thesis ${draft}`; setCommand(q); submit(q); setDraft('') }}>STRESS-TEST →</button>
      </div>

      {artifact ? <ThesisResult artifact={artifact} /> : (
        <div className="empty-report">
          <div className="empty-icon"><TerminalSquare size={22} /></div>
          <b>No thesis on file</b>
          <p>Type a thesis above. NIGHTWATCH will invoke news, market intel, technical, sentiment and macro skills to challenge it.</p>
        </div>
      )}

      {session.theses?.length > 1 ? (
        <div className="panel">
          <div className="panel-head"><h3>Prior theses</h3><small>{session.theses.length}</small></div>
          {session.theses.slice(1, 6).map(t => <div className="thesis-row" key={t.id}><b>{t.asset} · {t.direction}</b><span>{t.thesis.slice(0, 100)}</span><em>{t.verdict}</em><small>{(t.confidenceBefore * 100).toFixed(0)}% → {(t.confidenceAfter * 100).toFixed(0)}%</small></div>)}
        </div>
      ) : null}
    </div>
  )
}

function ThesisResult({ artifact }) {
  return (
    <article className="report">
      <header className="report-head">
        <div>
          <span className="eyebrow"><TerminalSquare size={11} /> THESIS · {new Date(artifact.createdAt).toISOString().slice(11, 16)} UTC</span>
          <h2>{artifact.asset} · <em>{artifact.direction}</em> · verdict <em className={artifact.verdict === 'SUPPORTS' ? 'green' : artifact.verdict === 'REFUTES' ? 'red' : 'amber'}>{artifact.verdict}</em></h2>
          <p className="q">“{artifact.thesis}”</p>
        </div>
        <div className="report-badges">
          <span className="pill outline">{(artifact.confidenceBefore * 100).toFixed(0)}% → {(artifact.confidenceAfter * 100).toFixed(0)}%</span>
        </div>
      </header>

      <div className="report-grid">
        <Section title="Steelman" icon={<ArrowUpRight size={13} />} tone="green">
          <p>{artifact.steelman}</p>
        </Section>
        <Section title="Counter-thesis" icon={<ArrowDownRight size={13} />} tone="amber">
          <p>{artifact.counterThesis}</p>
        </Section>
        <Section title="What the market may be pricing" icon={<LineChart size={13} />}>
          <p>{artifact.marketPricing}</p>
        </Section>
        <Section title="Supporting evidence" icon={<Database size={13} />} tone="green">
          <ul>{artifact.supporting.map((r, i) => <li key={i}><b>[{r.source}]</b> {r.claim}<em>{r.evidence}</em></li>)}</ul>
          {artifact.supporting.length === 0 && <p className="none">No supporting evidence surfaced.</p>}
        </Section>
        <Section title="Contradicting evidence" icon={<Database size={13} />} tone="red">
          <ul>{artifact.contradicting.map((r, i) => <li key={i}><b>[{r.source}]</b> {r.claim}<em>{r.evidence}</em></li>)}</ul>
          {artifact.contradicting.length === 0 && <p className="none">Thesis is clean of contradictions.</p>}
        </Section>
        <Section title="Stress tests" icon={<AlertTriangle size={13} />} tone="amber">
          <div className="mini-table">
            <div className="mini-head"><span>Scenario</span><span>Shock</span><span>Est P&L</span><span>Survive</span></div>
            {artifact.stressTests.map((s, i) => <div className="mini-row" key={i}><b>{s.name}</b><span>{s.shock}</span><em className={s.expectedPnlPct >= 0 ? 'up' : 'down'}>{fmtPct(s.expectedPnlPct)}</em><em className={s.survivable ? 'up' : 'down'}>{s.survivable ? 'YES' : 'NO'}</em></div>)}
          </div>
        </Section>
        <Section title="Invalidation" icon={<ShieldCheck size={13} />}>
          <div className="kv"><span>Price</span><b>${fmtPrice(artifact.invalidation.price)}</b></div>
          <ul className="dense">{artifact.invalidation.conditions.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </Section>
        <Section title="Historical analogs" icon={<PieChart size={13} />}>
          {artifact.analogs.length === 0 ? <p className="none">No analogs on file for {artifact.asset}.</p> :
            artifact.analogs.map(a => <div className="analog" key={a.id}><b>{a.id}</b><div><span>{a.setup}</span><em>{a.outcome}</em></div><small>{a.lesson}</small></div>)}
        </Section>
      </div>

      <div className="suggest">
        <div className="suggest-head">
          <div><span className="eyebrow"><Sparkles size={12} /> FINAL ASSESSMENT · YOU DECIDE</span><h3>{artifact.verdict}</h3></div>
        </div>
        <p>{artifact.finalAssessment}</p>
      </div>
    </article>
  )
}

/* ------------------------------------------------------- Portfolio page */

function PortfolioPage({ session, activeArtifact, closeAtMark, setCommand, submit }) {
  const open = session.positions.filter(p => p.status === 'OPEN')
  const closed = session.positions.filter(p => p.status === 'CLOSED')
  const exposureBook = open.reduce((s, p) => s + p.notional, 0)
  const unrealized = open.reduce((s, p) => s + (p.pnl || 0), 0)
  const realized   = closed.reduce((s, p) => s + (p.pnl || 0), 0)
  const impact = activeArtifact?.type === 'portfolio' ? activeArtifact.payload : null

  /* --- Server-authoritative paper account + Playbook allocations --- */
  const [paper, setPaper] = useState(null)
  const [mine, setMine]   = useState({ created: [], followed: [] })
  const token = getToken()
  useEffect(() => {
    if (!hasApi() || !token) return
    let alive = true
    const pull = async () => {
      try {
        const [p, m] = await Promise.all([
          fetch(apiUrl('/paper'),          { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : null),
          fetch(apiUrl('/playbooks/mine'), { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : null),
        ])
        if (!alive) return
        if (p?.paper) setPaper(p.paper)
        if (m) setMine({ created: m.created || [], followed: m.followed || [] })
      } catch { /* ignore */ }
    }
    pull(); const t = setInterval(pull, 20000); return () => { alive = false; clearInterval(t) }
  }, [token])

  const paperNav = paper?.totalCapital ?? paper?.startingCapital ?? 10000
  const followedPnlUsd = mine.followed.reduce((s, f) => s + (f.allocation?.currentPnlUsd || 0), 0)

  return (
    <div className="page">
      <PageHead title="Portfolio" eyebrow={<><Wallet size={12} /> PAPER BOOK · TRADER-APPROVED FILLS ONLY</>}>
        <button className="btn primary sm" onClick={() => { const q = 'How does a $1500 long BTC affect my portfolio?'; setCommand(q); submit(q) }}>SIMULATE IMPACT</button>
      </PageHead>

      {paper && (
        <div className="stat-strip">
          <div><small>PAPER CAPITAL</small><b>${paperNav.toLocaleString('en-US', { maximumFractionDigits: 0 })}</b><em className="muted">starting ${(paper.startingCapital ?? 10000).toLocaleString()}</em></div>
          <div><small>FREE</small><b>${(paper.freeCapital ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</b><em className="muted">ready to allocate</em></div>
          <div><small>ALLOCATED</small><b>${(paper.allocatedCapital ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</b><em className="muted">across {mine.followed.length} playbook{mine.followed.length === 1 ? '' : 's'}</em></div>
          <div><small>REALIZED P&L</small><b className={(paper.totalPnl ?? 0) >= 0 ? 'up' : 'down'}>{fmtAbs(paper.totalPnl ?? 0)}</b></div>
          <div><small>OPEN PLAYBOOK P&L</small><b className={followedPnlUsd >= 0 ? 'up' : 'down'}>{fmtAbs(followedPnlUsd)}</b></div>
        </div>
      )}

      <div className="stat-strip">
        <div><small>OPEN NOTIONAL (LOCAL)</small><b>${exposureBook.toLocaleString()}</b><em className="muted">{paperNav > 0 ? `${((exposureBook / paperNav) * 100).toFixed(1)}% of paper` : '—'}</em></div>
        <div><small>UNREALIZED P&L (LOCAL)</small><b className={unrealized >= 0 ? 'up' : 'down'}>{fmtAbs(unrealized)}</b></div>
        <div><small>REALIZED P&L (LOCAL)</small><b className={realized >= 0 ? 'up' : 'down'}>{fmtAbs(realized)}</b></div>
        <div><small>LOCAL OPEN</small><b>{open.length}</b></div>
        <div><small>LOCAL CLOSED</small><b>{closed.length}</b></div>
      </div>

      {/* Single source of truth for both published + followed playbooks. The
          same panel renders inside The Assayer so a freshly-drafted strategy
          is instantly actionable from the page it was created on. */}
      <MyPlaybooksPanel />


      {impact ? <ImpactCard impact={impact} /> : null}

      <div className="panel">
        <div className="panel-head"><h3>Open positions</h3><small>{open.length}</small></div>
        {open.length === 0 ? <div className="empty-body">Flat. Approve a research report to open a paper position.</div> : (
          <div className="pos-table">
            <div className="pos-head"><span>Asset</span><span>Dir</span><span>Notional</span><span>Entry</span><span>Now</span><span>Stop</span><span>Target</span><span>P&L</span><span></span></div>
            {open.map(p => (
              <div className="pos-row" key={p.id}>
                <b>{p.asset}</b>
                <span className={p.direction === 'LONG' ? 'pill green mini' : 'pill amber mini'}>{p.direction}</span>
                <b className="mono">${p.notional.toLocaleString()}</b>
                <span className="mono muted">${fmtPrice(p.entryPrice)}</span>
                <b className="mono">${fmtPrice(p.currentPrice)}</b>
                <span className="mono red">${fmtPrice(p.stopPrice)}</span>
                <span className="mono up">${fmtPrice(p.targetPrice)}</span>
                <b className={p.pnl >= 0 ? 'up mono' : 'down mono'}>{fmtAbs(p.pnl)} · {fmtPct(p.pnlPercent)}</b>
                <button className="chip mini" onClick={() => closeAtMark(p.id)}>CLOSE AT MARK</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head"><h3>Closed positions</h3><small>{closed.length}</small></div>
        {closed.length === 0 ? <div className="empty-body">No closed positions yet.</div> : (
          <div className="pos-table">
            <div className="pos-head"><span>Asset</span><span>Dir</span><span>Notional</span><span>P&L</span><span>Reason</span><span>Closed</span></div>
            {closed.map(p => (
              <div className="pos-row" key={p.id}>
                <b>{p.asset}</b>
                <span className={p.direction === 'LONG' ? 'pill green mini' : 'pill amber mini'}>{p.direction}</span>
                <b className="mono">${p.notional.toLocaleString()}</b>
                <b className={p.pnl >= 0 ? 'up mono' : 'down mono'}>{fmtAbs(p.pnl)} · {fmtPct(p.pnlPercent)}</b>
                <span className="mono muted">{p.closeReason || '—'}</span>
                <span className="mono muted">{p.closedAt ? new Date(p.closedAt).toISOString().slice(11, 19) : '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ImpactCard({ impact }) {
  const { symbol, notional, direction, impact: i } = impact
  if (!i) return null
  return (
    <div className="panel impact">
      <div className="panel-head"><h3>Portfolio impact simulation</h3><small>{direction} {symbol} · ${notional.toLocaleString()}</small></div>
      <div className="impact-grid">
        <div><small>Exposure</small><b>{(i.exposurePctBefore * 100).toFixed(1)}% → <em>{(i.exposurePctAfter * 100).toFixed(1)}%</em></b></div>
        <div><small>Book β</small><b>{i.betaBefore.toFixed(2)} → <em>{i.betaAfter.toFixed(2)}</em></b></div>
        <div><small>Crypto weight</small><b>{(i.cryptoPctBefore * 100).toFixed(1)}% → <em>{(i.cryptoPctAfter * 100).toFixed(1)}%</em></b></div>
        <div><small>Within limits</small><b className={i.withinLimits ? 'up' : 'down'}>{i.withinLimits ? 'YES' : 'BREACHES CAP'}</b></div>
      </div>
      <div className="impact-sectors">
        <small>SECTOR MIX AFTER</small>
        <div className="mini-table">
          <div className="mini-head"><span>Sector</span><span>Notional</span><span>% NAV</span></div>
          {Object.entries(i.sectorsAfter).map(([sector, dollars]) => (
            <div className="mini-row" key={sector}><b>{sector}</b><span>${dollars.toLocaleString()}</span><em>{((dollars / i.nav) * 100).toFixed(1)}%</em></div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ExecutionCard({ payload }) {
  const { asset, plan } = payload
  return (
    <div className="panel">
      <div className="panel-head"><h3>Execution plan · {asset}</h3><small>Suggested by NIGHTWATCH AI · you decide</small></div>
      <div className="edge-grid" style={{ borderTop: '1px solid var(--line)' }}>
        <Metric label="Notional"  value={`$${plan.notional.toLocaleString()}`} />
        <Metric label="Entry"     value={`$${fmtPrice(plan.entry)}`} />
        <Metric label="Stop"      value={`$${fmtPrice(plan.stop)}`}   tone="red" />
        <Metric label="Target"    value={`$${fmtPrice(plan.target)}`} tone="green" />
        <Metric label="R:R"       value={String(plan.riskReward)} />
        <Metric label="Fees + slippage" value={fmtPct(plan.estimatedFriction.totalPct)} />
      </div>
      <div className="slice-row">{plan.slices.map((s, i) => <span key={i}>{Math.round(s.pct * 100)}% · {s.condition}</span>)}</div>
      <p className="note">{plan.notes.join(' ')}</p>
    </div>
  )
}

/* ------------------------------------------------------- History page */

function HistoryPage({ session, activeArtifact, onAsk }) {
  const active = activeArtifact?.type === 'review' ? activeArtifact.payload : (session.reviews?.[0] || null)
  return (
    <div className="page">
      <PageHead title="History" eyebrow={<><BookOpen size={12} /> DECISIONS · REPORTS · POST-TRADE REVIEWS</>} />

      {active ? (
        <div className="panel">
          <div className="panel-head"><h3>Latest review</h3><small>{active.status}</small></div>
          <div className="review-body">
            <p className="lead">{active.summary}</p>
            <div className="review-grid">
              <div><small>WHAT WORKED</small><ul>{active.whatWorked.map((w, i) => <li key={i}>{w}</li>)}{active.whatWorked.length === 0 && <li className="none">—</li>}</ul></div>
              <div><small>WHAT FAILED</small><ul>{active.whatFailed.map((w, i) => <li key={i}>{w}</li>)}{active.whatFailed.length === 0 && <li className="none">—</li>}</ul></div>
              <div><small>MISSED RISKS</small><ul>{active.missedRisks.map((w, i) => <li key={i}>{w}</li>)}{active.missedRisks.length === 0 && <li className="none">None missed</li>}</ul></div>
              <div><small>RECURRING PATTERN</small><b>{active.recurringPattern || '—'}</b></div>
              <div><small>IMPROVEMENTS</small><ul>{active.improvements.map((w, i) => <li key={i}>{w}</li>)}{active.improvements.length === 0 && <li className="none">—</li>}</ul></div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-head"><h3>Research reports</h3><small>{session.reports?.length || 0}</small></div>
        {(!session.reports || session.reports.length === 0) ? <div className="empty-body">No reports yet. Run research from the Research page.</div> : (
          <div className="pos-table">
            <div className="pos-head"><span>Time</span><span>Asset</span><span>Direction</span><span>Status</span><span>Net edge</span><span>Question</span><span></span></div>
            {session.reports.slice(0, 20).map(r => (
              <div className="pos-row" key={r.id}>
                <span className="mono muted">{new Date(r.createdAt).toISOString().slice(11, 16)}</span>
                <b>{r.symbol}</b>
                <span className={r.signal.direction === 'LONG' ? 'pill green mini' : r.signal.direction === 'SHORT' ? 'pill amber mini' : 'pill outline mini'}>{r.signal.direction}</span>
                <span className={r.signal.status === 'NO_TRADE' ? 'pill red mini' : 'pill green mini'}>{r.signal.status}</span>
                <b className={r.signal.netEdge >= 0 ? 'up mono' : 'down mono'}>{fmtPct(r.signal.netEdge)}</b>
                <span className="q-cell">{r.question.slice(0, 120)}</span>
                <button className="chip mini" onClick={() => onAsk(r.question)}>RE-RUN</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head"><h3>Trader decisions</h3><small>{session.decisions?.length || 0}</small></div>
        {(!session.decisions || session.decisions.length === 0) ? <div className="empty-body">No decisions on file.</div> : (
          <div className="pos-table">
            <div className="pos-head"><span>Time</span><span>Asset</span><span>Action</span><span>Rationale</span></div>
            {session.decisions.map(d => (
              <div className="pos-row" key={d.id}>
                <span className="mono muted">{new Date(d.at).toISOString().slice(11, 19)}</span>
                <b>{d.asset}</b>
                <span className={d.action === 'APPROVE' ? 'pill green mini' : d.action === 'REJECT' ? 'pill amber mini' : 'pill outline mini'}>{d.action}</span>
                <span>{d.rationale || '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head"><h3>Session activity</h3><small>{session.logs?.length || 0}</small></div>
        <div className="log-body">
          {session.logs.slice(-40).reverse().map((log) => (
            <div className="log-row" key={log.id}>
              <time>{log.time}</time>
              <span className={`log-type ${log.type.toLowerCase()}`}>{log.type}</span>
              <b>{log.message}</b>
              <small>{log.detail}</small>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------- News page */

function NewsPage({ session, setSession, onAsk }) {
  const [filter, setFilter] = useState('ALL')     // ALL · WATCHLIST · POSITIONS · HIGH
  const feed = (session.news || [])
    .filter(item => {
      if (filter === 'ALL') return true
      if (filter === 'HIGH') return item.analysis.relevanceTier === 'HIGH' || item.severity === 'HIGH'
      if (filter === 'WATCHLIST') return item.analysis.watchlistTouched > 0
      if (filter === 'POSITIONS') return item.analysis.positionsTouched > 0
      return true
    })

  const dismissAlert = (newsId) => setSession(s => ({ ...s, newsAlerts: (s.newsAlerts || []).filter(a => a.newsId !== newsId) }))
  const dismissAll   = () => setSession(s => ({ ...s, newsAlerts: [] }))

  return (
    <div className="page">
      <PageHead title="News tape" eyebrow={<><Newspaper size={12} /> BREAKING NEWS · AI IMPACT ANALYSIS</>}>
        <span className="hint-inline">
          NIGHTWATCH classifies every incoming headline against your watchlist and open positions.
          High-relevance items ping you as toasts.
        </span>
      </PageHead>

      {session.newsAlerts?.length > 0 && (
        <div className="panel alert-panel">
          <div className="panel-head">
            <h3>Active alerts for you</h3>
            <div className="row-actions"><small>{session.newsAlerts.length} high-relevance</small><button className="chip mini" onClick={dismissAll}>DISMISS ALL</button></div>
          </div>
          <div className="alert-list">
            {session.newsAlerts.map(a => {
              const item = session.news.find(n => n.id === a.newsId) || DEMO_NEWS.find(n => n.id === a.newsId)
              if (!item) return null
              const top = a.rows[0]
              return (
                <div className="alert-row" key={a.id}>
                  <span className="pill red mini">HIGH</span>
                  <b>{item.headline}</b>
                  <em>Primary impact · {top?.symbol} {top?.direction.toLowerCase()} · {(top?.magnitude * 100).toFixed(0)}%</em>
                  <div className="row-actions">
                    <button className="chip mini" onClick={() => onAsk(`Research ${top?.symbol} — how does this news affect the setup?`)}>RESEARCH →</button>
                    <a className="chip mini" href={top?.bitgetUrl} target="_blank" rel="noreferrer noopener">TRADE ON BITGET <ExternalLink size={9} /></a>
                    <button className="chip mini" onClick={() => dismissAlert(item.id)}>DISMISS</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="filter-row" style={{ padding: '0 2px' }}>
        {[
          ['ALL',       'All'],
          ['HIGH',      'High impact'],
          ['WATCHLIST', 'My watchlist'],
          ['POSITIONS', 'Open positions'],
        ].map(([k, l]) => (
          <button key={k} className={filter === k ? 'chip on' : 'chip'} onClick={() => setFilter(k)}>
            <Filter size={11} /> {l}
          </button>
        ))}
      </div>

      {feed.length === 0
        ? <div className="empty-report"><div className="empty-icon"><Newspaper size={22} /></div><b>No news matches this filter</b><p>Change the filter, or wait — the tape ticks a new item every 45 seconds.</p></div>
        : feed.map(item => <NewsCard key={item.id + item.publishedAt} item={item} onAsk={onAsk} />)
      }
    </div>
  )
}

function NewsCard({ item, onAsk }) {
  const a = item.analysis
  const primary = a.rows[0]
  const secondary = a.rows.slice(1)
  return (
    <article className="news-card">
      <header className="news-head">
        <div className="news-title">
          <span className={`pill ${item.severity === 'HIGH' ? 'red' : item.severity === 'MEDIUM' ? 'amber' : 'outline'} mini`}>{item.severity}</span>
          <span className="pill outline mini">{item.category}</span>
          <span className="pill outline mini">{item.source}</span>
          <time>{item.time || new Date(item.publishedAt).toISOString().slice(11, 16)} UTC</time>
        </div>
        <span className={`pill ${a.relevanceTier === 'HIGH' ? 'green' : a.relevanceTier === 'MEDIUM' ? 'amber' : 'outline'} mini`}>
          RELEVANCE · {a.relevanceTier}
        </span>
      </header>

      <h3 className="news-headline">{item.headline}</h3>
      <p className="news-detail">{item.detail}</p>

      <div className="news-impact-grid">
        {a.rows.map(row => (
          <div key={row.symbol} className={`news-impact ${row.direction === 'UP' ? 'up-bg' : row.direction === 'DOWN' ? 'down-bg' : 'mix-bg'}`}>
            <div className="ni-head">
              <b>{row.symbol}</b>
              <span className={row.direction === 'UP' ? 'up' : row.direction === 'DOWN' ? 'down' : 'amber'}>
                {row.direction === 'UP' ? '↑' : row.direction === 'DOWN' ? '↓' : '↕'} {(row.magnitude * 100).toFixed(0)}%
              </span>
            </div>
            <span className="ni-reason">{row.reasoning}</span>
            <div className="ni-flags">
              {row.position && <span className="pill mini outline">OPEN {row.position.direction}</span>}
              {row.watching && !row.position && <span className="pill mini outline">WATCHING</span>}
              <span className={`pill mini ${row.action.tone === 'green' ? 'green' : row.action.tone === 'red' ? 'red' : row.action.tone === 'amber' ? 'amber' : 'outline'}`}>{row.action.label}</span>
            </div>
            <p className="ni-action">{row.action.text}</p>
            <div className="ni-cta">
              <button className="chip mini" onClick={() => onAsk(`Research ${row.symbol} — how does this news change the setup?`)}>RESEARCH</button>
              <a className="chip mini" href={row.bitgetUrl} target="_blank" rel="noreferrer noopener">BITGET <ExternalLink size={9} /></a>
            </div>
          </div>
        ))}
      </div>

      {a.regimeShift && (
        <div className="regime-note">
          <span className="pill outline mini">CROSS-ASSET</span>
          Cross-asset regime shift · <b>{a.regimeShift.replace('_', '-').toLowerCase()}</b> — expect correlated moves across {a.regimeShift === 'RISK_ON' ? 'high-beta U.S. equities (NVDA, TSLA, AMD, MSTR, COIN) and crypto majors.' : 'risk assets; USD-strength wins.'}
        </div>
      )}

      <div className="news-foot">
        <small>AI summary · {a.summary}</small>
        <div className="row-actions">
          <button className="chip mini" onClick={() => onAsk(`Research ${primary?.symbol || 'BTC'} — is this news actionable?`)}>OPEN RESEARCH →</button>
          <a className="chip mini" href={primary ? primary.bitgetUrl : 'https://www.bitget.com'} target="_blank" rel="noreferrer noopener">VIEW ON BITGET <ExternalLink size={9} /></a>
        </div>
      </div>
    </article>
  )
}

/* ------------------------------------------------------- Backtest page */

function BacktestPage({ session }) {
  const [symbol, setSymbol] = useState('BTC')
  const [horizon, setHorizon] = useState(8)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const run = async () => {
    setRunning(true)
    try {
      // Prefer real cached Bitget candles via the adapter; fall back to synthetic offline.
      if (hasApi()) {
        try {
          const res = await fetch(apiUrl('/backtest/live'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol, horizon }),
            signal: AbortSignal.timeout(25000),
          })
          if (res.ok) {
            const body = await res.json()
            if (Array.isArray(body?.rows) && body?.stats) {
              setResult({ symbol, rows: body.rows, stats: body.stats, live: true, candleCount: body.candleCount })
              return
            }
          }
        } catch { /* fall through to synthetic */ }
      }
      await new Promise(r => setTimeout(r, 0))          // yield to render
      setResult({ ...runBacktestSynthetic(symbol, { horizon }), live: false })
    } finally { setRunning(false) }
  }
  const fmtStat = (v, digits = 1) => v == null ? '—' : `${(v * 100).toFixed(digits)}%`
  return (
    <div className="page">
      <PageHead title="Signal backtest" eyebrow={<><BarChart3 size={12} /> {result?.live ? `LIVE BITGET CANDLES · ${result.candleCount} BARS` : 'SIGNAL QUALITY · SYNTHETIC REPLAY'}</>}>
        <span className="hint-inline">{result?.live ? 'Replaying real cached Bitget 1h candles through the exact same skill-pack + signal engine used in production.' : 'Replays 300 synthetic bars — connect the adapter to backtest on real Bitget candles.'}</span>
      </PageHead>

      <div className="panel">
        <div className="panel-head"><h3>Configure</h3><small>Deterministic seed per symbol</small></div>
        <div className="settings-grid">
          <label><small>Symbol</small>
            <select value={symbol} onChange={e => setSymbol(e.target.value)}>
              {session.universe.map(u => <option key={u.symbol} value={u.symbol}>{u.symbol} · {u.name}</option>)}
            </select>
          </label>
          <label><small>Forward horizon (bars)</small><input type="number" min="1" max="48" value={horizon} onChange={e => setHorizon(Number(e.target.value) || 8)} /></label>
          <div style={{ alignSelf: 'end' }}>
            <button className={running ? 'btn primary running' : 'btn primary'} onClick={run} disabled={running}>{running ? 'RUNNING…' : 'RUN BACKTEST'}</button>
          </div>
        </div>
      </div>

      {result && (
        <>
          <div className="stat-strip">
            <div><small>SIGNAL RATE</small><b>{result.stats.signalCount}/{result.stats.total}</b><em className="muted">{fmtStat(result.stats.signalCount / result.stats.total)}</em></div>
            <div><small>LONG ACC</small><b className={result.stats.longAccuracy >= 0.5 ? 'up' : 'down'}>{fmtStat(result.stats.longAccuracy)}</b><em className="muted">{result.stats.longCount} calls</em></div>
            <div><small>SHORT ACC</small><b className={result.stats.shortAccuracy >= 0.5 ? 'up' : 'down'}>{fmtStat(result.stats.shortAccuracy)}</b><em className="muted">{result.stats.shortCount} calls</em></div>
            <div><small>PRECISION @MOVE</small><b>{fmtStat(result.stats.precisionOnMove)}</b><em className="muted">≥{fmtStat(result.stats.minAbsForwardPct)} move</em></div>
            <div><small>LIFT vs BASELINE</small><b className={result.stats.lift >= 0 ? 'up' : 'down'}>{fmtStat(result.stats.lift, 2)}</b><em className="muted">LONG mean − all mean</em></div>
          </div>

          <div className="panel">
            <div className="panel-head"><h3>Per-signal ledger</h3><small>{result.rows.length} bars · {symbol}</small></div>
            <div className="pos-table" style={{ maxHeight: 420, overflow: 'auto' }}>
              <div className="pos-head"><span>Bar</span><span>Dir</span><span>Status</span><span>Conf</span><span>Composite</span><span>Net edge</span><span>Fwd return</span><span>Outcome</span><span></span></div>
              {result.rows.slice(-40).reverse().map((r, i) => {
                const correct = (r.direction === 'LONG' && r.forwardReturn > 0) || (r.direction === 'SHORT' && r.forwardReturn < 0)
                const outcome = r.status === 'NO_TRADE' ? 'SKIP' : correct ? 'HIT' : 'MISS'
                return (
                  <div className="pos-row" key={i}>
                    <span className="mono muted">{new Date(r.ts).toISOString().slice(11, 16)}</span>
                    <span className={r.direction === 'LONG' ? 'pill green mini' : r.direction === 'SHORT' ? 'pill amber mini' : 'pill outline mini'}>{r.direction}</span>
                    <span className={r.status === 'NO_TRADE' ? 'pill outline mini' : 'pill green mini'}>{r.status}</span>
                    <b className="mono">{(r.confidence * 100).toFixed(0)}%</b>
                    <b className="mono">{r.composite.toFixed(2)}</b>
                    <b className={r.netEdge >= 0 ? 'up mono' : 'down mono'}>{fmtPct(r.netEdge)}</b>
                    <b className={r.forwardReturn >= 0 ? 'up mono' : 'down mono'}>{fmtPct(r.forwardReturn)}</b>
                    <span className={`pill mini ${outcome === 'HIT' ? 'green' : outcome === 'MISS' ? 'red' : 'outline'}`}>{outcome}</span>
                    <span />
                  </div>
                )
              })}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><h3>How to read this</h3><small>Interpretation</small></div>
            <div className="settings-body">
              <p className="lead">
                <b>Signal rate</b> is what fraction of bars produced a tradable signal (rest were sit-outs).
                <b> Long/short accuracy</b> is directional hit-rate on called bars.
                <b> Precision @ move</b> filters to bars where the market actually moved ≥ {fmtStat(result.stats.minAbsForwardPct)} — this is the number that matters most.
                <b> Lift</b> is the excess mean forward return on LONG-signalled bars vs all bars. Positive lift is the minimum bar for a signal to have any information content.
              </p>
              <p className="lead">
                {result.live
                  ? <>This report replays <b>real Bitget 1h candles</b> ({result.candleCount} bars, cached server-side). Indicators, signals and forward returns are all computed from the actual price series — no lookahead.</>
                  : <>This report uses <b>synthetic</b> candles because the adapter is unreachable. Start the server (<code>npm run server</code>) to backtest on real cached Bitget candles via <code>POST /backtest/live</code>.</>}
              </p>
            </div>
          </div>
        </>
      )}

      {!result && (
        <div className="empty-report">
          <div className="empty-icon"><BarChart3 size={22} /></div>
          <b>No backtest yet</b>
          <p>Pick a symbol and horizon above, then RUN BACKTEST. NIGHTWATCH will replay the skill pack and signal synthesizer through 300 bars and report precision + lift.</p>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------- Settings page */

function SettingsPage({ session, setSession, bitgetStatus, onReset }) {
  const prefs = session.memory.preferences
  const setPref = (key, value) => setSession(s => ({ ...s, memory: { ...s.memory, preferences: { ...s.memory.preferences, [key]: value } } }))
  // Clamp numeric prefs on change: raw Number('') is NaN, which JSON-serializes
  // to null and silently corrupts stored preferences; out-of-range values break
  // signal gating and position sizing.
  const setNumPref = (key, raw, min, max, fallback) => {
    const n = Number(raw)
    if (raw === '' || !Number.isFinite(n)) return
    setPref(key, Math.min(max, Math.max(min, n)))
  }
  return (
    <div className="page">
      <PageHead title="Settings" eyebrow={<><Settings size={12} /> RESEARCH PREFERENCES · INTEGRATIONS</>} />

      <div className="panel">
        <div className="panel-head"><h3>Bitget Agent Hub</h3><small>{bitgetStatus.connected ? 'CONNECTED' : 'NOT CONNECTED'}</small></div>
        <div className="settings-body">
          <p className="lead">NIGHTWATCH AI is architected to consume the 5 official Bitget <code>bitget-signal</code> research skills (<code>{BITGET_SIGNAL_SKILLS.map(s => s.id).join(', ')}</code>).</p>
          <div className="kv-row"><span>Adapter</span><b>{bitgetStatus.connected ? bitgetStatus.model || 'MCP' : 'Local deterministic skills'}</b></div>
          <div className="kv-row"><span>Reason</span><b className="muted">{bitgetStatus.reason || 'ready'}</b></div>
          <ol className="steps">
            {BITGET_CONNECTION_HELP.map((h, i) => <li key={i}>{h}</li>)}
          </ol>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h3>Trader profile</h3><small>Personalizes signals and stress tests</small></div>
        <div className="settings-grid">
          <label><small>NAV (paper)</small><input type="number" min="1000" step="1000" value={prefs.nav} onChange={e => setNumPref('nav', e.target.value, 1000, 1e9, 25000)} /></label>
          <label><small>Risk profile</small>
            <select value={prefs.risk} onChange={e => setPref('risk', e.target.value)}>
              {['CONSERVATIVE','MODERATE','AGGRESSIVE'].map(r => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label><small>Style</small>
            <select value={prefs.style} onChange={e => setPref('style', e.target.value)}>
              {['EVENT_DRIVEN','TREND_FOLLOW','MEAN_REVERT','MACRO'].map(r => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label><small>Horizon</small>
            <select value={prefs.horizon} onChange={e => setPref('horizon', e.target.value)}>
              {['INTRADAY','SWING','POSITION'].map(r => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label><small>Min confidence</small><input type="number" step="0.05" min="0.4" max="0.95" value={prefs.minConfidence} onChange={e => setNumPref('minConfidence', e.target.value, 0.4, 0.95, 0.6)} /></label>
          <label><small>Min net edge</small><input type="number" step="0.001" min="0" max="0.1" value={prefs.minNetEdge} onChange={e => setNumPref('minNetEdge', e.target.value, 0, 0.1, 0.005)} /></label>
          <label><small>Max position % NAV</small><input type="number" step="0.01" min="0.02" max="0.5" value={prefs.maxPositionPct} onChange={e => setNumPref('maxPositionPct', e.target.value, 0.02, 0.5, 0.1)} /></label>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h3>Watchlist</h3><small>{session.watchlist.length} symbols</small></div>
        <div className="watch-grid">
          {session.watchlist.map(sym => (
            <div className="watch-tag" key={sym}>
              <b>{sym}</b>
              <button className="chip mini" onClick={() => setSession(s => ({ ...s, watchlist: s.watchlist.filter(x => x !== sym) }))}>×</button>
            </div>
          ))}
          {session.universe.filter(u => !session.watchlist.includes(u.symbol)).map(u => (
            <button key={u.symbol} className="watch-tag ghost" onClick={() => setSession(s => ({ ...s, watchlist: [...s.watchlist, u.symbol] }))}>+ {u.symbol}</button>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h3>Session</h3><small>Local · trader-gated</small></div>
        <div className="settings-body">
          <div className="kv-row"><span>Paper only</span><b className="up">ENFORCED</b></div>
          <div className="kv-row"><span>Storage</span><b>localStorage · nightwatch.session.v3.&lt;user&gt;</b></div>
          <div className="kv-row"><span>Engine</span><b>{session.provider.engine}</b></div>
          <button className="btn ghost" onClick={onReset}>RESET SESSION</button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------- Small components */

function PageHead({ title, eyebrow, children }) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
      </div>
      <div className="page-head-actions">{children}</div>
    </div>
  )
}

function Metric({ label, value, tone, strong }) {
  return (
    <div className={`metric${tone ? ' ' + tone : ''}${strong ? ' strong' : ''}`}>
      <small>{label}</small>
      <b>{value}</b>
    </div>
  )
}

function Section({ title, icon, tone, children }) {
  return (
    <section className={`sec${tone ? ' ' + tone : ''}`}>
      <div className="sec-head">{icon} <b>{title}</b></div>
      <div className="sec-body">{children}</div>
    </section>
  )
}

/**
 * Compact top-of-report summary + one-click paper trade action. Sits at the
 * top of every research report so the trader sees the verdict, the plan and
 * the copy-to-paper button before scrolling into the detail grid.
 */
function ActionSummaryCard({ report, openPosition, isTradable, decide, closeAtMark }) {
  const s = report.signal
  const sug = report.suggestion
  const isSitOut = s.status === 'NO_TRADE'
  const dir = s.direction
  const verdictClass = isSitOut ? 'red' : dir === 'LONG' ? 'green' : 'amber'
  const bitgetUrl = bitgetTradeUrl(report.symbol, dir)

  const copyToPaper = () => decide('APPROVE')
  const sitOut = () => decide('SIT_OUT', { rationale: 'Marked as sit-out from action summary.' })

  return (
    <aside className={`action-card action-${verdictClass}`}>
      <div className="action-card-head">
        <div className="action-verdict">
          <span className={`pill ${verdictClass}`}>
            {isSitOut ? 'SIT OUT' : dir}
          </span>
          {!isSitOut && (
            <span className="action-conf">{(s.confidence * 100).toFixed(0)}% conf · net edge {fmtPct(s.netEdge)}</span>
          )}
        </div>
        {sug && !isSitOut && (
          <span className="pill outline sm">R:R {sug.riskReward}</span>
        )}
      </div>

      <p className="action-summary-line">{report.summary}</p>

      {sug && !isSitOut && (
        <div className="action-plan">
          <div className="action-plan-metric">
            <small>Direction</small><b>{dir}</b>
          </div>
          <div className="action-plan-metric">
            <small>Entry</small><b className="mono">${fmtPrice(sug.entry)}</b>
          </div>
          <div className="action-plan-metric">
            <small>Stop</small><b className="mono down">${fmtPrice(sug.stop)}</b>
          </div>
          <div className="action-plan-metric">
            <small>Target</small><b className="mono up">${fmtPrice(sug.target)}</b>
          </div>
          <div className="action-plan-metric">
            <small>Size</small><b className="mono">${sug.notional.toLocaleString()}</b>
            <em className="muted">{(sug.notionalPctOfNav * 100).toFixed(1)}% NAV</em>
          </div>
          <div className="action-plan-metric">
            <small>Est. friction</small><b className="mono">{fmtPct(sug.estimatedFriction.totalPct)}</b>
          </div>
        </div>
      )}

      <div className="action-buttons">
        {isSitOut ? (
          <>
            <button className="btn ghost" onClick={sitOut}>ACKNOWLEDGE SIT-OUT</button>
            <span className="action-hint">{s.reason}</span>
          </>
        ) : openPosition ? (
          <>
            <span className="pill amber sm">Already in your paper book · {openPosition.direction}</span>
            <button className="btn ghost" onClick={() => closeAtMark(openPosition.id)}>CLOSE AT MARK</button>
            <a className="btn ghost" href={bitgetUrl} target="_blank" rel="noreferrer noopener">
              <ExternalLink size={12} /> View on Bitget
            </a>
          </>
        ) : isTradable ? (
          <>
            <button className="btn primary" onClick={copyToPaper}>
              <Copy size={13} /> COPY TO PAPER PORTFOLIO
            </button>
            <button className="btn ghost" onClick={() => decide('REJECT', { rationale: 'Rejected from action summary.' })}>REJECT</button>
            <button className="btn ghost" onClick={sitOut}>SIT OUT</button>
            <a className="btn ghost" href={bitgetUrl} target="_blank" rel="noreferrer noopener">
              <ExternalLink size={12} /> Trade on Bitget
            </a>
          </>
        ) : (
          <span className="action-hint">No actionable plan — see the detail below.</span>
        )}
      </div>

      {sug && !isSitOut && (
        <p className="action-legal">
          Paper trading only · trader owns every decision · no live orders routed unless a Bitget account is wired and each order is explicitly approved.
        </p>
      )}
    </aside>
  )
}

/**
 * Short-term + long-term thesis panel with a "Download research card" action.
 * Both fields are provided by the Qwen narration; a deterministic fallback is
 * used when the LLM is off.
 */
/**
 * "Printed research card" — every research question emits this. It leads with
 * the current situation, then a short-term thesis, then a long-term thesis,
 * then explicit change conditions and a stress table. Falls back gracefully
 * when a report lacks the new fields (legacy reports from before the schema
 * upgrade still render).
 */
function ThesisAndCardBlock({ report }) {
  const [showCard, setShowCard] = useState(false)
  const situation = report.situation
  const shortT   = report.shortTermThesis || null
  const longT    = report.longTermThesis  || null
  const changes  = report.whatChangesThisThesis || []
  const stress   = report.stressTests || []
  // Legacy fallback so older reports still render.
  const legacyShort = report.thesis?.short || (report.signal?.catalyst ? `Near term: ${report.signal.catalyst}` : null)
  const legacyLong  = report.thesis?.long  || null

  return (
    <section className="thesis-block printed-card">
      <div className="printed-card-head">
        <span className="printed-card-eyebrow">RESEARCH CARD · {report.symbol} · {report.dataMode || 'LIVE'}</span>
        <span className="printed-card-title">{report.symbol} — {report.signal?.direction || 'FLAT'}</span>
      </div>

      {situation && situation.length > 0 && (
        <div className="printed-card-section">
          <small className="printed-card-label"><i className="dot cyan" /> SITUATION</small>
          {situation.map((line, i) => <p key={i}>{line}</p>)}
        </div>
      )}

      <div className="thesis-row">
        <div className="thesis-cell thesis-short">
          <small><i className="dot red" /> SHORT-TERM THESIS · {shortT?.horizon || 'hours to days'}</small>
          {shortT ? (
            <>
              <p className="thesis-statement">{shortT.statement}</p>
              {shortT.expectedMove && <div className="thesis-meta"><span>Expected move</span><b>{shortT.expectedMove}</b></div>}
              {shortT.keyDrivers?.length > 0 && (
                <ul className="thesis-drivers">
                  {shortT.keyDrivers.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              )}
            </>
          ) : (
            <p>{legacyShort || 'Near term: no immediate catalyst on file.'}</p>
          )}
        </div>
        <div className="thesis-cell thesis-long">
          <small><i className="dot green" /> LONG-TERM THESIS · {longT?.horizon || 'weeks to months'}</small>
          {longT ? (
            <>
              <p className="thesis-statement">{longT.statement}</p>
              {longT.structuralFactors?.length > 0 && (
                <ul className="thesis-drivers">
                  {longT.structuralFactors.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              )}
            </>
          ) : (
            <p>{legacyLong || 'Multi-week: watch macro regime and the invalidation levels below.'}</p>
          )}
        </div>
      </div>

      {changes.length > 0 && (
        <div className="printed-card-section">
          <small className="printed-card-label"><i className="dot amber" /> WHAT WOULD CHANGE THIS THESIS</small>
          <ul className="change-list">
            {changes.map((c, i) => (
              <li key={i}><b>{c.label}</b><em>{c.why}</em></li>
            ))}
          </ul>
        </div>
      )}

      {stress.length > 0 && (
        <div className="printed-card-section">
          <small className="printed-card-label"><i className="dot red" /> STRESS TEST · EVIDENCE AGAINST THESIS</small>
          <div className="stress-table">
            <div className="stress-head"><span>Scenario</span><span>Shock</span><span>Est. move</span><span>Survivable</span></div>
            {stress.map((s, i) => (
              <div className="stress-row" key={i}>
                <b>{s.name}</b>
                <span>{s.shock}</span>
                <span className={s.expectedMovePct >= 0 ? 'up mono' : 'down mono'}>{fmtPct(s.expectedMovePct)}</span>
                <span className={s.survives ? 'up' : 'down'}>{s.survives ? 'yes' : 'no'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="thesis-actions">
        <button className="btn ghost sm" onClick={() => setShowCard(v => !v)}>
          {showCard ? 'Hide shareable card' : 'Download shareable PNG'}
        </button>
        <span className="thesis-actions-hint">PNG · situation, both horizons, verdict, plan and disclaimer.</span>
      </div>
      {showCard && <ResearchCardActions report={report} />}
    </section>
  )
}

/* --------------------------------------------------- Earnings calendar strip */

/**
 * Compact "next US-equity earnings" strip for the Research page. Free NASDAQ
 * calendar; cached server-side for 12h. Click a ticker to auto-research it.
 */
function EarningsStrip({ onAsk }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    if (!hasApi()) return
    let alive = true
    fetch(apiUrl('/earnings?limit=6'), { signal: AbortSignal.timeout(15000) })
      .then(r => r.ok ? r.json() : null)
      .then(body => { if (alive) setRows(body?.rows || []) })
      .catch(() => { if (alive) setRows([]) })
    return () => { alive = false }
  }, [])
  if (!hasApi() || rows == null) return null
  if (rows.length === 0) return null
  return (
    <div className="earnings-strip">
      <span className="earnings-strip-label"><CalendarClock size={11} /> UPCOMING EARNINGS</span>
      {rows.map(r => {
        const isSoon = r.daysToNext != null && r.daysToNext <= 7
        return (
          <button className={`earnings-chip${isSoon ? ' hot' : ''}`} key={r.symbol} onClick={() => onAsk?.(r.symbol)}>
            <b>{r.symbol}</b>
            <em>{r.daysToNext != null ? `${r.daysToNext}d` : r.nextEarningsDate || '—'}</em>
            {r.epsEstimate != null && <span className="earnings-eps">est ${Number(r.epsEstimate).toFixed(2)}</span>}
          </button>
        )
      })}
      <span className="earnings-strip-source">nasdaq · consensus EPS</span>
    </div>
  )
}

/* --------------------------------------------------- Auth-hero live ticker */

/**
 * A muted, always-live strip of real Bitget prices under the sign-in copy.
 * Proves to first-time visitors that the tape behind the app is genuine before
 * they even sign in. Pulls /prices/live every 30s.
 */
function AuthTicker() {
  const [tickers, setTickers] = useState(null)
  useEffect(() => {
    if (!hasApi()) return
    let alive = true
    const load = async () => {
      try {
        const res = await fetch(apiUrl('/prices/live'), { signal: AbortSignal.timeout(6000) })
        if (!res.ok) return
        const body = await res.json()
        if (alive) setTickers(body?.tickers || null)
      } catch { /* keep silent */ }
    }
    load()
    const t = setInterval(load, 30000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  if (!tickers) return <div className="auth-marquee-empty" aria-hidden />
  const symbols = ['NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMD', 'META', 'MSTR', 'COIN', 'BTC']
  return (
    <div className="auth-marquee-inner">
      {symbols.map(sym => {
        const t = tickers[sym]
        if (!t) return null
        const up = (t.changePct24h ?? 0) >= 0
        return (
          <span className="auth-tick" key={sym}>
            <b>{sym}</b>
            <span className="mono">${fmtPrice(t.last)}</span>
            <em className={up ? 'up' : 'down'}>{up ? '+' : ''}{(t.changePct24h ?? 0).toFixed(2)}%</em>
          </span>
        )
      })}
      <span className="auth-tick-source">bitget spot · live</span>
    </div>
  )
}

/* --------------------------------------------------------- Auth gate */

function AuthGate() {
  const [user, setUser] = useState(getStoredUser)
  // Every authenticated request needs the JWT; if the browser has one but no user
  // (e.g. localStorage half-cleared), treat as signed-out.
  const token = getToken()
  const signedIn = Boolean(user && token)

  if (!signedIn) {
    return (
      <div className="auth-shell">
        <div className="auth-hero">
          <div className="brand auth-brand">
            <img className="brand-mark lg" src="/logo.svg" alt="NIGHTWATCH AI" width="52" height="52" />
            <div className="brand-name">
              <strong>NIGHTWATCH<span>AI</span></strong>
              <small>AI TRADING DESK</small>
            </div>
          </div>
          <div className="auth-target">Built for event-driven traders in tokenized U.S. stocks</div>
          <h1>Your AI trading desk.</h1>
          <p className="auth-tagline">Tokenized U.S. equities on Bitget — NVDA, TSLA, AAPL, MSFT, META, AMD, COIN, MSTR — plus a crypto correlation set. Research the news, not just the chart.</p>
          <p className="auth-lead">Ask a market question in plain English. NIGHTWATCH consolidates live Bitget R-pair prices for tokenized U.S. stocks, cross-venue funding, order-book depth, macro context and symbol-tagged news, then produces a structured research report with a clear verdict, entry, stop and target. You decide whether to trade.</p>
          <ul className="auth-perks">
            <li><ShieldCheck size={14} /> <span><b>A research workspace that remembers.</b> Watchlist, reports, theses and paper positions are tied to your account and follow you across every device.</span></li>
            <li><ShieldCheck size={14} /> <span><b>Real market data, end to end.</b> Live Bitget spot prices, cross-venue perpetual funding and open interest, cached candles, macro tape and symbol-tagged news — nothing simulated.</span></li>
            <li><ShieldCheck size={14} /> <span><b>Your judgment stays in the loop.</b> NIGHTWATCH researches, synthesizes and stress-tests. You approve, reject, or sit out — nothing trades on its own.</span></li>
          </ul>
          <div className="auth-marquee"><AuthTicker /></div>
        </div>
        <div className="auth-form">
          <SignInWidget onSignedIn={(u) => setUser(u)} />
          <p className="auth-footnote">Paper trading by default. The trader makes every decision. Live order routing requires an approved broker connection and explicit per-order approval.</p>
        </div>
      </div>
    )
  }
  return <App key={user.id} authUser={user} onSignedOut={() => { logout(); setUser(null) }} />
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <AuthGate />
    <Disclaimer />
  </ErrorBoundary>
)
