/**
 * The four GetAgent-style pages: Explore, Leaderboard, The Assayer chat, and a
 * Paper Account strip. Each hits the adapter directly via VITE_AGENT_API_URL.
 * If no adapter is attached, we show a friendly "connect the adapter" note.
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  Award, Compass, ExternalLink, Gem, MessageCircle, RotateCcw, Send, ShieldCheck, Sparkles, Wallet,
} from 'lucide-react'
import { apiBase, hasApi, apiUrl } from './apiBase.js'
import { MarketPulse } from './MarketPulse.jsx'
import { purgeAllSessions } from '../domain.js'

async function api(pathOrToken, opts = {}) {
  if (!hasApi()) throw new Error('adapter not attached')
  const { token, timeoutMs = 15000, ...rest } = opts
  const headers = { 'Content-Type': 'application/json', ...(rest.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`
  // Without a timeout a hung backend wedges the UI forever (busy=true, no error).
  const res = await fetch(apiUrl(pathOrToken), { ...rest, headers, signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return await res.json()
}

/** ---------------- Local token store (dev-login only, browser) ---------------- */
const TOK_KEY = 'nightwatch.auth.token.v1'
const USR_KEY = 'nightwatch.auth.user.v1'
export function getToken() { try { return localStorage.getItem(TOK_KEY) } catch { return null } }
export function getStoredUser() { try { return JSON.parse(localStorage.getItem(USR_KEY) || 'null') } catch { return null } }
export function saveAuth(user, token) {
  try { localStorage.setItem(TOK_KEY, token); localStorage.setItem(USR_KEY, JSON.stringify(user)) } catch { /* private mode */ }
}
export function logout() {
  try {
    localStorage.removeItem(TOK_KEY)
    localStorage.removeItem(USR_KEY)
  } catch { /* ignore */ }
  // Wipe every per-user + legacy session slot so User B never inherits User A's
  // positions, reports, watchlist, decisions or PnL when they sign in next.
  try { purgeAllSessions() } catch { /* ignore */ }
}

/** ---------------- Passwordless email sign-in ---------------- */

/**
 * Mask an email's local part but preserve the domain, e.g.
 *   uba9230@gmail.com  →  ub****30@gmail.com
 *   ab@x.com           →  a****@x.com
 *   me@x.com           →  m****@x.com
 * Keeps enough signal for the user to spot a typo in either half without
 * ever rendering the full identifying local part on screen.
 */
export function maskEmail(email) {
  const raw = String(email || '').trim()
  const at = raw.indexOf('@')
  const localPart = at >= 0 ? raw.slice(0, at) : raw
  const domain    = at >= 0 ? raw.slice(at)   : ''
  if (!localPart) return raw
  const masked = localPart.length <= 4
    ? `${localPart[0]}****`
    : `${localPart.slice(0, 2)}****${localPart.slice(-2)}`
  return `${masked}${domain}`
}

/**
 * Email-only sign-in, like getagent.studio. Two steps:
 *   1. User enters email → server sends a 6-digit code.
 *   2. User enters the code → JWT comes back, personal session hydrates.
 * First-time visitors are created transparently on successful verification —
 * no separate "sign up" step. The JWT scopes every subsequent request to this
 * user: watchlist, positions, reports, paper capital, alerts and playbooks
 * all follow the email, not the browser.
 */
export function SignInWidget({ onSignedIn }) {
  const [step, setStep] = useState('email')       // 'email' | 'code'
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)      // dev-mode "your code is …" hint

  const cleanErr = (err) => {
    const raw = String(err?.message || err || '')
    return raw.replace(/^\d{3}\s+/, '').replace(/^Unauthorized$/, 'invalid code')
  }

  const requestCode = async (e) => {
    e?.preventDefault()
    if (!email) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const r = await api('/auth/request-code', { method: 'POST', body: JSON.stringify({ email }) })
      // Dev-mode convenience: when the server has no email provider configured
      // it returns the code inline so local testing doesn't require SMTP.
      if (r?.previewCode) setNotice(`Dev mode — your code is ${r.previewCode}`)
      setStep('code')
    } catch (err) { setError(cleanErr(err)) } finally { setBusy(false) }
  }

  const verifyCode = async (e) => {
    e?.preventDefault()
    if (!code) return
    setBusy(true); setError(null)
    try {
      const r = await api('/auth/verify-code', { method: 'POST', body: JSON.stringify({ email, code }) })
      saveAuth(r.user, r.token)
      onSignedIn?.(r.user, r.token)
    } catch (err) { setError(cleanErr(err)) } finally { setBusy(false) }
  }

  const changeEmail = () => { setStep('email'); setCode(''); setError(null); setNotice(null) }

  if (step === 'code') {
    return (
      <form className="panel signin-panel" onSubmit={verifyCode}>
        <div className="panel-head">
          <h3>Check your inbox</h3>
          <small>We sent a 6-digit sign-in code to <b>{maskEmail(email)}</b>.</small>
        </div>
        <div className="signin-body">
          {notice && <div className="signin-notice">{notice}</div>}
          <label className="signin-field">
            <small>Sign-in code</small>
            <input
              className="signin-code-input"
              value={code}
              onChange={e => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={6}
              autoFocus
              required
            />
          </label>
          <button className="btn primary signin-btn" type="submit" disabled={busy || code.length !== 6}>
            {busy ? 'Verifying…' : 'Sign in'}
          </button>
          <div className="signin-alt">
            <button type="button" className="signin-link" onClick={changeEmail}>Use a different email</button>
            <button type="button" className="signin-link" onClick={requestCode} disabled={busy}>Resend code</button>
          </div>
          {error && <p className="signin-error">{error}</p>}
        </div>
      </form>
    )
  }

  return (
    <form className="panel signin-panel" onSubmit={requestCode}>
      <div className="panel-head">
        <h3>Sign in</h3>
        <small>Passwordless. We send a one-time code to your email.</small>
      </div>
      <div className="signin-body">
        <label className="signin-field">
          <small>Email address</small>
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@example.com" autoComplete="email" autoFocus required />
        </label>
        <button className="btn primary signin-btn" type="submit" disabled={busy || !email}>
          {busy ? 'Sending code…' : 'Continue'}
        </button>
        <p className="signin-fine">
          By continuing you agree to receive one-time sign-in codes at this address and to our terms of use. Codes expire after 10 minutes.
        </p>
        {error && <p className="signin-error">{error}</p>}
      </div>
    </form>
  )
}

/** ---------------- Paper account strip (top of Explore + Leaderboard) ---------------- */

export function PaperStrip({ user, onReset }) {
  const [paper, setPaper] = useState(null)
  const token = getToken()
  useEffect(() => {
    if (!token) return
    api('/paper', { token }).then(r => setPaper(r.paper)).catch(() => {})
  }, [token])
  const [resetting, setResetting] = useState(false)
  const reset = async () => {
    if (!token || resetting) return
    setResetting(true)
    try {
      const r = await api('/paper/reset', { method: 'POST', token })
      setPaper(r.paper); onReset?.()
    } catch { /* keep current paper state */ }
    finally { setResetting(false) }
  }
  if (!paper) return null
  const fmt = (n) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  return (
    <div className="stat-strip">
      <div><small>PAPER ACCOUNT · {user?.name || 'you'}</small><b>{fmt(paper.totalCapital)}</b><em className="muted">starting {fmt(paper.startingCapital)}</em></div>
      <div><small>FREE CAPITAL</small><b>{fmt(paper.freeCapital)}</b><em className={paper.freeCapital >= paper.startingCapital ? 'up' : 'muted'}>ready to allocate</em></div>
      <div><small>ALLOCATED</small><b>{fmt(paper.allocatedCapital)}</b><em className="muted">across followed playbooks</em></div>
      <div><small>REALIZED P&L</small><b className={paper.totalPnl >= 0 ? 'up' : 'down'}>{paper.totalPnl >= 0 ? '+' : ''}{fmt(paper.totalPnl)}</b><em className="muted">closed only</em></div>
      <div style={{ display: 'flex', alignItems: 'end' }}><button className="btn ghost sm" onClick={reset} disabled={resetting}><RotateCcw size={12} /> RESET</button></div>
    </div>
  )
}

/** ---------------- Explore page (list of published Playbooks) ---------------- */

export function ExplorePage({ user, onOpenPlaybook }) {
  const [rows, setRows] = useState(null)
  const [tickers, setTickers] = useState({})
  const [error, setError] = useState(null)
  useEffect(() => { api('/playbooks?limit=100').then(r => setRows(r.playbooks)).catch(e => setError(e.message)) }, [])
  useEffect(() => {
    let alive = true
    const pull = async () => { try { const r = await api('/prices/live'); if (alive) setTickers(r.tickers || {}) } catch { /* ignore */ } }
    pull(); const t = setInterval(pull, 15000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  if (!hasApi()) return <div className="empty-report"><div className="empty-icon"><Compass size={22} /></div><b>No adapter attached</b><p>Set <code>VITE_AGENT_API_URL</code> to your NIGHTWATCH server to browse Playbooks.</p></div>
  if (error)   return <div className="empty-report"><b>Could not load playbooks</b><p>{error}</p></div>
  if (!rows)   return <div className="empty-body">loading playbooks…</div>
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow"><Compass size={12} /> EXPLORE · EVERY TRADE DESERVES A PLAYBOOK</div>
          <h1>The Playbook Library</h1>
        </div>
        <div className="hint-inline">Real prices drive every paper P&L below. No real user funds are involved.</div>
      </div>
      <MarketPulse />
      {user ? <PaperStrip user={user} /> : null}
      <div className="playbook-grid">
        {rows.map(p => {
          const t = tickers[p.asset]
          const priceLine = t ? `$${t.last >= 1000 ? Math.round(t.last).toLocaleString() : t.last?.toFixed(2)}` : null
          return (
            <button key={p.id} className="playbook-card" onClick={() => onOpenPlaybook(p.id)}>
              <div className="pc-head">
                <div className={`asset-mark ${p.asset === 'BTC' || p.asset === 'ETH' || p.asset === 'SOL' ? 'crypto' : 'equity'}`}>{p.asset?.[0] || '?'}</div>
                <div><b>{p.title}</b><small>{p.ownerName || 'anonymous'} · {p.canonical ? 'CANONICAL' : 'COMMUNITY'}</small></div>
                <span className={`pill mini ${p.direction === 'LONG' ? 'green' : 'amber'}`}>{p.direction}</span>
              </div>
              <p className="pc-desc">{p.description}</p>
              {t && (
                <div className="pc-live">
                  <span>{p.asset} <b>{priceLine}</b></span>
                  <em className={t.changePct24h >= 0 ? 'up' : 'down'}>{t.changePct24h >= 0 ? '+' : ''}{t.changePct24h?.toFixed(2)}%</em>
                    {p.runtime?.position ? <span className="pill green mini">OPEN {((p.runtime.position.pnlPct ?? 0) * 100).toFixed(2)}%</span> : <span className="pill outline mini">FLAT</span>}
                </div>
              )}
              <div className="pc-foot">
                <span><b>{p.followers ?? 0}</b> followers</span>
                <span><b>${(p.totalAllocatedUsd || 0).toLocaleString()}</b> allocated</span>
                {p.backtest?.winRate != null && <span><b>{(p.backtest.winRate * 100).toFixed(0)}%</b> win · {p.backtest.tradeCount} trades</span>}
                {p.backtest?.backtestable === false && <span className="muted">live-eval only</span>}
                <span>{(p.tags || []).slice(0, 3).map(t => <em key={t}>#{t}</em>)}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** ---------------- Playbook detail modal (allocate flow) ---------------- */

export function PlaybookDetail({ id, user, onClose, onAllocated }) {
  const [p, setP] = useState(null)
  const [amount, setAmount] = useState(500)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [ticker, setTicker] = useState(null)
  const token = getToken()
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await api(`/playbooks/${id}`)
        if (!alive) return
        setP(r.playbook)
        // Auto-backtest on first open if none yet
        if (r.playbook && !r.playbook.backtest) {
          try {
            await api(`/playbooks/${id}/backtest`, { method: 'POST', timeoutMs: 60000 })
            const r2 = await api(`/playbooks/${id}`)
            if (alive) setP(r2.playbook)
          } catch { /* history may still be warming */ }
        }
        // Fetch live ticker
        if (alive && r.playbook?.asset) {
          api('/prices/live').then(px => { if (alive) setTicker(px.tickers?.[r.playbook.asset] || null) }).catch(() => {})
        }
      } catch (e) {
        if (alive) setError(e.message)
      }
    })()
    return () => { alive = false }
  }, [id])
  const follow = async () => {
    setBusy(true); setError(null)
    try {
      await api(`/playbooks/${id}/follow`, { method: 'POST', token, body: JSON.stringify({ amountUsd: Number(amount) }) })
      onAllocated?.()
      onClose()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const unfollow = async () => {
    setBusy(true); setError(null)
    try { await api(`/playbooks/${id}/unfollow`, { method: 'POST', token }); onAllocated?.(); onClose() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const backtest = async () => {
    setBusy(true); setError(null)
    try { const r = await api(`/playbooks/${id}/backtest`, { method: 'POST' }); const p2 = await api(`/playbooks/${id}`); setP(p2.playbook) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return (
    <div className="disclaimer-modal" role="dialog">
      <div className="playbook-modal">
        <div className="dc-head"><b>{p ? p.title : 'loading…'}</b><button className="icon-btn" onClick={onClose}>×</button></div>
        {p && (
          <>
            <p className="pc-desc">{p.description}</p>
            <div className="pb-conds">
              <div><small>SIGNAL CONDITIONS</small>{(p.signalConditions || []).map((c, i) => <em key={i}>{c.field} {c.op} {String(c.value)}</em>)}</div>
              <div><small>EXIT CONDITIONS</small>{(p.exitConditions || []).map((c, i) => <em key={i}>{c.field} {c.op} {String(c.value)}</em>)}</div>
            </div>
            <div className="stat-strip">
              <div><small>ASSET</small><b>{p.asset}</b>{ticker && <em className={ticker.changePct24h >= 0 ? 'up' : 'down'}>${ticker.last?.toLocaleString(undefined, { maximumFractionDigits: 2 })} · {ticker.changePct24h >= 0 ? '+' : ''}{ticker.changePct24h?.toFixed(2)}%</em>}</div>
              <div><small>DIRECTION</small><b>{p.direction}</b></div>
              <div><small>SIZING</small><b>{p.sizing?.value != null ? `${(p.sizing.value * 100).toFixed(0)}%` : '—'}</b><em className="muted">of capital</em></div>
              <div><small>FOLLOWERS</small><b>{p.followers ?? 0}</b><em className="muted">${(p.totalAllocatedUsd || 0).toLocaleString()}</em></div>
              <div><small>LIVE POSITION</small><b className={p.runtime?.position ? 'up' : ''}>{p.runtime?.position ? 'OPEN' : 'FLAT'}</b>{p.runtime?.position ? <em className={p.runtime.position.pnlPct >= 0 ? 'up' : 'down'}>{(p.runtime.position.pnlPct * 100).toFixed(2)}%</em> : null}</div>
            </div>
            {p.backtest ? (
              p.backtest.backtestable === false ? (
                <p className="hint-inline">Not replayable from candles — conditions need live-only feeds ({(p.backtest.missing || []).join(', ')}). The Playbook still evaluates live every 60s.</p>
              ) : (
                <div className="settings-body">
                  <div className="kv-row"><span>Mode</span><b>Condition replay · {p.backtest.candleCount} real 1h candles</b></div>
                  <div className="kv-row"><span>Trades</span><b>{p.backtest.tradeCount} <span className="muted">({p.backtest.wins}W / {p.backtest.losses}L)</span></b></div>
                  <div className="kv-row"><span>Win rate</span><b>{p.backtest.winRate != null ? `${(p.backtest.winRate * 100).toFixed(0)}%` : '—'}</b></div>
                  <div className="kv-row"><span>Total return (sum of trades)</span><b className={p.backtest.totalReturnPct >= 0 ? 'up' : 'down'}>{p.backtest.totalReturnPct != null ? `${(p.backtest.totalReturnPct * 100).toFixed(2)}%` : '—'}</b></div>
                  <div className="kv-row"><span>Mean trade vs random-entry baseline</span><b>{p.backtest.meanTradePnlPct != null ? `${(p.backtest.meanTradePnlPct * 100).toFixed(2)}%` : '—'} <span className="muted">vs {(p.backtest.baselinePct * 100).toFixed(2)}%</span></b></div>
                  <div className="kv-row"><span>Lift</span><b className={p.backtest.lift >= 0 ? 'up' : 'down'}>{p.backtest.lift != null ? `${(p.backtest.lift * 100).toFixed(2)}%` : '—'}</b></div>
                </div>
              )
            ) : (
              <p className="hint-inline">No backtest run yet.</p>
            )}
            {token ? (
              <>
                <div className="thesis-input" style={{ padding: 12 }}>
                  <input value={amount} onChange={e => setAmount(e.target.value)} type="number" min={1} max={100000} />
                  <button className="btn primary" onClick={follow} disabled={busy}><Wallet size={12} /> ALLOCATE PAPER</button>
                  <button className="btn ghost" onClick={unfollow} disabled={busy}>UNFOLLOW</button>
                  <button className="btn ghost" onClick={backtest} disabled={busy}>RUN BACKTEST</button>
                </div>
                {error && <p className="red">{error}</p>}
              </>
            ) : <p className="hint-inline">Sign in to allocate paper capital.</p>}
          </>
        )}
      </div>
    </div>
  )
}

/** ---------------- Leaderboard page ---------------- */

// US-equity universe used to tag rows so traders can see at a glance whether
// a Playbook trades tokenized equities or crypto correlation.
const EQUITY_SYMBOLS = new Set(['NVDA','TSLA','AAPL','MSFT','AMZN','GOOGL','META','AMD','COIN','MSTR'])

export function LeaderboardPage({ user, onOpenPlaybook, onOpenAssayer }) {
  const [sort, setSort] = useState('return')
  const [assetFilter, setAssetFilter] = useState('ALL')     // ALL · EQUITY · CRYPTO
  const [rows, setRows] = useState(null)

  useEffect(() => {
    let alive = true
    api(`/leaderboard?sort=${sort}&limit=100`)
      .then(r => { if (alive) setRows(Array.isArray(r.rows) ? r.rows : []) })
      .catch(() => { if (alive) setRows([]) })
    return () => { alive = false }
  }, [sort])

  const filtered = useMemo(() => {
    if (!rows) return rows
    if (assetFilter === 'EQUITY') return rows.filter(r => EQUITY_SYMBOLS.has(r.asset))
    if (assetFilter === 'CRYPTO') return rows.filter(r => !EQUITY_SYMBOLS.has(r.asset))
    return rows
  }, [rows, assetFilter])

  if (!hasApi()) return <div className="empty-report"><b>Adapter not attached</b></div>

  const fmtPct = (v, digits = 2) => v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`
  const fmtCap = (n) => `$${Math.round(n || 0).toLocaleString()}`

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow"><Award size={12} /> LEADERBOARD · REAL-PRICE PAPER P&amp;L · REAL FOLLOWERS</div>
          <h1>Playbook leaderboard</h1>
          <p className="lead">Every Playbook published by a real user, ranked on real backtests over cached Bitget 1h candles and marked-to-market against real live prices. No simulated volume, no fake followers.</p>
        </div>
        <div className="row-actions">
          {onOpenAssayer && (
            <button className="btn primary sm" onClick={onOpenAssayer}>
              <Sparkles size={12} /> Draft a Playbook in the Assayer
            </button>
          )}
        </div>
      </div>

      <div className="filter-row" style={{ marginTop: 8 }}>
        <span className="filter-label">Sort</span>
        {[['return', 'Total return'], ['live', 'Live P&L'], ['followers', 'Followers'], ['capital', 'Capital allocated'], ['recent', 'Most recent']].map(([k, l]) => (
          <button key={k} className={sort === k ? 'chip on' : 'chip'} onClick={() => setSort(k)}>{l}</button>
        ))}
        <span className="filter-label" style={{ marginLeft: 20 }}>Universe</span>
        {[['ALL', 'All'], ['EQUITY', 'U.S. equities'], ['CRYPTO', 'Crypto']].map(([k, l]) => (
          <button key={k} className={assetFilter === k ? 'chip on' : 'chip'} onClick={() => setAssetFilter(k)}>{l}</button>
        ))}
      </div>

      <MarketPulse />
      {user ? <PaperStrip user={user} /> : null}

      <div className="panel">
        <div className="panel-head"><h3>Ranked playbooks</h3><small>{filtered ? `${filtered.length} of ${rows.length}` : '—'}</small></div>
        <div className="leaderboard-table">
          <div className="lb-head">
            <span>#</span>
            <span>Playbook</span>
            <span>Asset</span>
            <span>Return</span>
            <span>Win rate</span>
            <span>Trades</span>
            <span>Followers</span>
            <span>Allocated</span>
            <span>Live P&amp;L</span>
            <span></span>
          </div>
          {filtered == null ? (
            <div className="empty-body">loading real-price backtests…</div>
          ) : filtered.length === 0 ? (
            <div className="lb-empty">
              <b>No Playbooks{assetFilter === 'EQUITY' ? ' for U.S. equities' : assetFilter === 'CRYPTO' ? ' for crypto' : ''} yet.</b>
              <p>Playbooks are published strategies that anyone can follow with paper capital. Backtests run on real cached Bitget 1h candles; the leaderboard populates as soon as the first Playbook publishes.</p>
              {onOpenAssayer ? (
                <button className="btn primary" onClick={onOpenAssayer}><Sparkles size={13} /> Draft your first Playbook</button>
              ) : null}
            </div>
          ) : filtered.map((r, i) => {
            const isEquity = EQUITY_SYMBOLS.has(r.asset)
            return (
              <div className="lb-row" key={r.id}>
                <b className="mono muted">{i + 1}</b>
                <div className="lb-title">
                  <b>{r.title}</b>
                  <small className="muted">
                    {r.ownerName || '—'} · {new Date(r.createdAt).toISOString().slice(0, 10)}
                    {r.backtestable === false && (
                      <em className="pill outline mini" style={{ marginLeft: 6 }} title={`Requires live-only fields: ${(r.backtestMissing || []).join(', ')}`}>
                        live-context only
                      </em>
                    )}
                  </small>
                </div>
                <span className="lb-asset">
                  <b className="mono">{r.asset}</b>
                  <em className={isEquity ? 'pill green mini' : 'pill outline mini'}>{isEquity ? 'Equity' : 'Crypto'}</em>
                </span>
                <b className={r.totalReturnPct == null ? 'mono muted' : r.totalReturnPct >= 0 ? 'up mono' : 'down mono'}>{fmtPct(r.totalReturnPct)}</b>
                <b className="mono">{r.winRate == null ? '—' : `${(r.winRate * 100).toFixed(0)}%`}</b>
                <span className="mono muted">{r.tradeCount || 0}</span>
                <b className="mono">{r.followers}</b>
                <b className="mono">{fmtCap(r.totalAllocatedUsd)}</b>
                <b className={r.livePnlPct == null ? 'mono muted' : r.livePnlPct >= 0 ? 'up mono' : 'down mono'}>{fmtPct(r.livePnlPct, 2)}</b>
                <button className="chip mini" onClick={() => onOpenPlaybook(r.id)}>Open</button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** ---------------- The Assayer chat page ---------------- */

export function AssayerPage({ user, onAllocated }) {
  const [messages, setMessages] = useState([{ role: 'assistant', content: 'The Assayer at your service. Tell me an asset and a setup — for example, "build a BTC ETF-flow follow" — and I will draft a Playbook you can review, backtest, and allocate paper capital to.' }])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [proposed, setProposed] = useState(null)
  const [savedId, setSavedId] = useState(null)
  const token = getToken()

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next)
    try {
      // LLM-backed — allow longer than the default api() timeout.
      const r = await api('/assayer/chat', { method: 'POST', body: JSON.stringify({ messages: next }), timeoutMs: 60000 })
      setMessages(m => [...m, { role: 'assistant', content: r.reply }])
      if (r.playbook) setProposed(r.playbook)
    } catch (err) {
      setMessages(m => [...m, { role: 'assistant', content: `Something failed: ${err.message}` }])
    } finally { setBusy(false) }
  }

  const savePlaybook = async () => {
    if (!token || !proposed) return
    setBusy(true)
    try {
      const r = await api('/playbooks', { method: 'POST', token, body: JSON.stringify(proposed) })
      await api(`/playbooks/${r.playbook.id}/publish`, { method: 'POST', token, body: JSON.stringify({ publish: true }) })
      setSavedId(r.playbook.id)
      setMessages(m => [...m, { role: 'assistant', content: `Saved and published. Playbook id ${r.playbook.id}. Head to Leaderboard to see it live.` }])
      setProposed(null)
      onAllocated?.()
    } catch (err) {
      setMessages(m => [...m, { role: 'assistant', content: `Save failed: ${err.message}` }])
    } finally { setBusy(false) }
  }

  if (!hasApi()) return <div className="empty-report"><b>No adapter attached</b><p>Set <code>VITE_AGENT_API_URL</code> to talk to The Assayer.</p></div>

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow"><MessageCircle size={12} /> THE ASSAYER · YOUR RESEARCH COMPANION</div>
          <h1>Sweat or coin.</h1>
        </div>
        <div className="hint-inline">Every draft is paper only. No real user funds move.</div>
      </div>
      <MarketPulse />

      <div className="assayer-chat">
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <small>{m.role === 'user' ? (user?.name || 'you') : 'The Assayer'}</small>
            <p>{m.content}</p>
          </div>
        ))}
        {proposed && (
          <div className="chat-proposed">
            <b>Proposed Playbook</b>
            <p>{proposed.title} · {proposed.asset} {proposed.direction}</p>
            <small>Signal: {(proposed.signalConditions || []).map(c => `${c.field} ${c.op} ${c.value}`).join(' AND ')}</small>
            <small>Exit: {(proposed.exitConditions || []).map(c => `${c.field} ${c.op} ${c.value}`).join(' AND ')}</small>
            {token ? <button className="btn primary sm" onClick={savePlaybook} disabled={busy}><Gem size={12} /> SAVE + PUBLISH</button> : <p className="hint-inline">Sign in to save + publish.</p>}
          </div>
        )}
      </div>

      <div className="commandbar">
        <div className="cb-icon"><MessageCircle size={15} /></div>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && !busy && send()} placeholder='e.g. "build a BTC ETF-flow follow" or "sketch an ETH oversold bounce"' />
        <button className="btn primary" onClick={send} disabled={busy}><Send size={13} /> SEND</button>
      </div>
    </div>
  )
}
