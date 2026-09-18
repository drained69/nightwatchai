/**
 * The Assayer chat, Playbook detail modal, and a Paper Account strip.
 * Each hits the adapter directly via VITE_AGENT_API_URL (falls back to same-origin).
 * If no adapter is attached, we show a friendly "connect the adapter" note.
 */
import React, { useEffect, useState } from 'react'
import {
  ExternalLink, Gem, MessageCircle, RotateCcw, Send, ShieldCheck, Sparkles, Wallet,
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

/** ---------------- Paper account strip (top of Assayer + Portfolio) ---------------- */

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

/** ---------------- The Assayer chat page ---------------- */

export function AssayerPage({ user, onAllocated }) {
  const [messages, setMessages] = useState([{ role: 'assistant', content: 'The Assayer at your service. Tell me a tokenized U.S. stock and a setup — for example, "build an NVDA earnings-drift follow" or "sketch a TSLA post-print fade" — and I will draft a Playbook you can review, backtest, and allocate paper capital to.' }])
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
      setMessages(m => [...m, { role: 'assistant', content: `Saved and published as ${r.playbook.id}. It now appears in "My playbooks" below — allocate paper capital to start tracking live PnL against real Bitget prices. It also shows in Portfolio → Followed once you allocate.` }])
      setProposed(null)
      // Bump the mine-panel refresh key so it re-fetches immediately.
      setMineRefresh(x => x + 1)
      onAllocated?.()
    } catch (err) {
      setMessages(m => [...m, { role: 'assistant', content: `Save failed: ${err.message}` }])
    } finally { setBusy(false) }
  }

  // Bumping this counter forces MyPlaybooksPanel to re-pull /playbooks/mine.
  const [mineRefresh, setMineRefresh] = useState(0)

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
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && !busy && send()} placeholder='e.g. "build an NVDA earnings-drift follow" or "sketch an MSFT Azure-beat follow"' />
        <button className="btn primary" onClick={send} disabled={busy}><Send size={13} /> SEND</button>
      </div>

      {user && <MyPlaybooksPanel refreshKey={mineRefresh} onChanged={() => setMineRefresh(x => x + 1)} highlightId={savedId} />}
    </div>
  )
}

/** ---------------- My published + followed playbooks (Assayer + Portfolio) ---------------- */

/**
 * Shows every Playbook the signed-in user has **published** (drafted in the
 * Assayer), plus the ones they are actively following with paper capital.
 *
 * Renders both the "where does my strategy show up" answer for the Assayer
 * page — the just-published playbook appears here immediately — and the
 * running roster of active allocations on the Portfolio page. Allocate /
 * unfollow buttons are inline; capital changes flow through /paper/credit.
 */
export function MyPlaybooksPanel({ refreshKey = 0, onChanged, highlightId, defaultAllocateUsd = 500 }) {
  const [mine, setMine] = useState({ created: [], followed: [] })
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  const [amounts, setAmounts] = useState({})
  const token = getToken()

  useEffect(() => {
    if (!hasApi() || !token) return
    let alive = true
    ;(async () => {
      try {
        const r = await api('/playbooks/mine', { token })
        if (alive) setMine({ created: r.created || [], followed: r.followed || [] })
      } catch (err) { if (alive) setError(err.message) }
    })()
  }, [token, refreshKey])

  if (!token) return null

  const followedIds = new Set(mine.followed.map(f => f.playbook?.id).filter(Boolean))
  const followedByPlaybook = new Map(mine.followed.map(f => [f.playbook?.id, f.allocation]))

  const allocate = async (playbookId) => {
    const amountUsd = Number(amounts[playbookId] ?? defaultAllocateUsd)
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) { setError('amount must be positive'); return }
    setBusyId(playbookId); setError(null)
    try {
      await api(`/playbooks/${playbookId}/follow`, { method: 'POST', token, body: JSON.stringify({ amountUsd }) })
      onChanged?.()
      const r = await api('/playbooks/mine', { token })
      setMine({ created: r.created || [], followed: r.followed || [] })
    } catch (err) { setError(err.message) } finally { setBusyId(null) }
  }
  const unfollow = async (playbookId) => {
    setBusyId(playbookId); setError(null)
    try {
      await api(`/playbooks/${playbookId}/unfollow`, { method: 'POST', token })
      onChanged?.()
      const r = await api('/playbooks/mine', { token })
      setMine({ created: r.created || [], followed: r.followed || [] })
    } catch (err) { setError(err.message) } finally { setBusyId(null) }
  }

  const fmtPct = (v) => v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`
  const fmtUsd = (v) => v == null ? '—' : `${v >= 0 ? '+' : ''}$${Math.abs(v).toFixed(2)}`

  const nothingCreated = mine.created.length === 0
  const nothingFollowed = mine.followed.length === 0
  if (nothingCreated && nothingFollowed) {
    return (
      <div className="panel">
        <div className="panel-head"><h3>My playbooks</h3><small>you have not published or allocated yet</small></div>
        <div className="empty-body">Draft a Playbook in The Assayer above. Once you publish it, it will land here with an Allocate button and start tracking live PnL against real Bitget prices.</div>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>My playbooks</h3>
        <small>{mine.created.length} published · {mine.followed.length} followed</small>
      </div>
      {error && <div className="empty-body red">{error}</div>}

      {mine.created.length > 0 && (
        <div className="my-pb-section">
          <div className="my-pb-label">PUBLISHED · DRAFTED IN THE ASSAYER</div>
          {mine.created.map(p => {
            const followed = followedIds.has(p.id)
            const alloc    = followedByPlaybook.get(p.id)
            const flash    = highlightId && p.id === highlightId
            return (
              <div className={`my-pb-row${flash ? ' flash' : ''}`} key={p.id}>
                <div className="my-pb-title">
                  <b>{p.title}</b>
                  <small>{p.asset} · {p.direction} · {p.canonical ? 'canonical' : 'community'}</small>
                </div>
                <div className="my-pb-stats">
                  {p.backtest?.winRate != null && <span><b>{(p.backtest.winRate * 100).toFixed(0)}%</b> win</span>}
                  {p.backtest?.tradeCount != null && <span>{p.backtest.tradeCount} trades</span>}
                  {p.followers != null && <span><b>{p.followers}</b> followers</span>}
                  {p.runtime?.position && <span className="up">OPEN {fmtPct(p.runtime.position.pnlPct)}</span>}
                </div>
                <div className="my-pb-actions">
                  {!followed && (
                    <>
                      <input
                        type="number" min="10" step="10"
                        value={amounts[p.id] ?? defaultAllocateUsd}
                        onChange={e => setAmounts(a => ({ ...a, [p.id]: e.target.value }))}
                        aria-label="allocation amount"
                      />
                      <button className="btn primary sm" onClick={() => allocate(p.id)} disabled={busyId === p.id}>
                        <Wallet size={12} /> {busyId === p.id ? 'Allocating…' : 'Allocate'}
                      </button>
                    </>
                  )}
                  {followed && alloc && (
                    <>
                      <span className="my-pb-pnl">${(alloc.allocatedUsd || 0).toLocaleString()} · <b className={(alloc.currentPnlPct || 0) >= 0 ? 'up' : 'down'}>{fmtPct(alloc.currentPnlPct)}</b> · {fmtUsd(alloc.currentPnlUsd)}</span>
                      <button className="btn ghost sm" onClick={() => unfollow(p.id)} disabled={busyId === p.id}>
                        {busyId === p.id ? 'Unfollowing…' : 'Unfollow'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {mine.followed.filter(f => !mine.created.some(c => c.id === f.playbook?.id)).length > 0 && (
        <div className="my-pb-section">
          <div className="my-pb-label">FOLLOWED · OTHER USERS' PLAYBOOKS</div>
          {mine.followed
            .filter(f => !mine.created.some(c => c.id === f.playbook?.id))
            .map(({ allocation: a, playbook: p }) => (
              <div className="my-pb-row" key={a.id}>
                <div className="my-pb-title">
                  <b>{p?.title || a.playbookId}</b>
                  <small>{p?.asset || '—'} · {p?.direction || '—'} · {p?.ownerName || '—'}</small>
                </div>
                <div className="my-pb-stats">
                  <span>${(a.allocatedUsd || 0).toLocaleString()} allocated</span>
                  <span>started {new Date(a.startedAt).toISOString().slice(0, 10)}</span>
                </div>
                <div className="my-pb-actions">
                  <span className="my-pb-pnl"><b className={(a.currentPnlPct || 0) >= 0 ? 'up' : 'down'}>{fmtPct(a.currentPnlPct)}</b> · {fmtUsd(a.currentPnlUsd)}</span>
                  <button className="btn ghost sm" onClick={() => unfollow(p?.id || a.playbookId)} disabled={busyId === (p?.id || a.playbookId)}>
                    {busyId === (p?.id || a.playbookId) ? 'Unfollowing…' : 'Unfollow'}
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
