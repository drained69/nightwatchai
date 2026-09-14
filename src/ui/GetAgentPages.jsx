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

async function api(pathOrToken, opts = {}) {
  if (!hasApi()) throw new Error('adapter not attached')
  const { token, ...rest } = opts
  const headers = { 'Content-Type': 'application/json', ...(rest.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(apiUrl(pathOrToken), { ...rest, headers })
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
export function logout() { try { localStorage.removeItem(TOK_KEY); localStorage.removeItem(USR_KEY) } catch { /* ignore */ } }

/** ---------------- Sign-in inline widget ---------------- */

export function SignInWidget({ onSignedIn }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e?.preventDefault()
    setBusy(true); setError(null)
    try {
      const r = await api('/auth/dev-login', { method: 'POST', body: JSON.stringify({ email, name }) })
      saveAuth(r.user, r.token)
      onSignedIn?.(r.user, r.token)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return (
    <form className="panel" onSubmit={submit} style={{ padding: 20 }}>
      <div className="panel-head"><h3>Sign in to allocate paper capital</h3><small>DEV LOGIN — email only, no password</small></div>
      <div className="settings-body">
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <small>Email</small>
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@example.com" required />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <small>Display name (optional)</small>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Prospector" />
        </label>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'signing in…' : 'CONTINUE'}</button>
        {error && <p className="red" style={{ marginTop: 8 }}>{error}</p>}
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
  const reset = async () => {
    if (!token) return
    const r = await api('/paper/reset', { method: 'POST', token })
    setPaper(r.paper); onReset?.()
  }
  if (!paper) return null
  const fmt = (n) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  return (
    <div className="stat-strip">
      <div><small>PAPER ACCOUNT · {user?.name || 'you'}</small><b>{fmt(paper.totalCapital)}</b><em className="muted">starting {fmt(paper.startingCapital)}</em></div>
      <div><small>FREE CAPITAL</small><b>{fmt(paper.freeCapital)}</b><em className={paper.freeCapital >= paper.startingCapital ? 'up' : 'muted'}>ready to allocate</em></div>
      <div><small>ALLOCATED</small><b>{fmt(paper.allocatedCapital)}</b><em className="muted">across followed playbooks</em></div>
      <div><small>REALIZED P&L</small><b className={paper.totalPnl >= 0 ? 'up' : 'down'}>{paper.totalPnl >= 0 ? '+' : ''}{fmt(paper.totalPnl)}</b><em className="muted">closed only</em></div>
      <div style={{ display: 'flex', alignItems: 'end' }}><button className="btn ghost sm" onClick={reset}><RotateCcw size={12} /> RESET</button></div>
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
                <div className={`asset-mark ${p.asset === 'BTC' || p.asset === 'ETH' || p.asset === 'SOL' ? 'crypto' : 'equity'}`}>{p.asset[0]}</div>
                <div><b>{p.title}</b><small>{p.ownerName || 'anonymous'} · {p.canonical ? 'CANONICAL' : 'COMMUNITY'}</small></div>
                <span className={`pill mini ${p.direction === 'LONG' ? 'green' : 'amber'}`}>{p.direction}</span>
              </div>
              <p className="pc-desc">{p.description}</p>
              {t && (
                <div className="pc-live">
                  <span>{p.asset} <b>{priceLine}</b></span>
                  <em className={t.changePct24h >= 0 ? 'up' : 'down'}>{t.changePct24h >= 0 ? '+' : ''}{t.changePct24h?.toFixed(2)}%</em>
                  {p.runtime?.position ? <span className="pill green mini">OPEN {(p.runtime.position.pnlPct * 100).toFixed(2)}%</span> : <span className="pill outline mini">FLAT</span>}
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
    api(`/playbooks/${id}`).then(async r => {
      setP(r.playbook)
      // Auto-backtest on first open if none yet
      if (r.playbook && !r.playbook.backtest) {
        try {
          await api(`/playbooks/${id}/backtest`, { method: 'POST' })
          const r2 = await api(`/playbooks/${id}`)
          setP(r2.playbook)
        } catch { /* history may still be warming */ }
      }
      // Fetch live ticker
      if (r.playbook?.asset) {
        api('/prices/live').then(px => setTicker(px.tickers?.[r.playbook.asset] || null)).catch(() => {})
      }
    }).catch(e => setError(e.message))
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
              <div><small>SIGNAL CONDITIONS</small>{p.signalConditions.map((c, i) => <em key={i}>{c.field} {c.op} {String(c.value)}</em>)}</div>
              <div><small>EXIT CONDITIONS</small>{p.exitConditions.map((c, i) => <em key={i}>{c.field} {c.op} {String(c.value)}</em>)}</div>
            </div>
            <div className="stat-strip">
              <div><small>ASSET</small><b>{p.asset}</b>{ticker && <em className={ticker.changePct24h >= 0 ? 'up' : 'down'}>${ticker.last?.toLocaleString(undefined, { maximumFractionDigits: 2 })} · {ticker.changePct24h >= 0 ? '+' : ''}{ticker.changePct24h?.toFixed(2)}%</em>}</div>
              <div><small>DIRECTION</small><b>{p.direction}</b></div>
              <div><small>SIZING</small><b>{(p.sizing.value * 100).toFixed(0)}%</b><em className="muted">of capital</em></div>
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

export function LeaderboardPage({ user, onOpenPlaybook }) {
  const [sort, setSort] = useState('followers')
  const [rows, setRows] = useState(null)
  useEffect(() => { api(`/leaderboard?sort=${sort}&limit=50`).then(r => setRows(r.rows)).catch(() => setRows([])) }, [sort])
  if (!hasApi()) return <div className="empty-report"><b>No adapter attached</b></div>
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow"><Award size={12} /> LEADERBOARD · REAL-PRICE PAPER PnL</div>
          <h1>The Assayer's ledger</h1>
        </div>
        <div className="filter-row">
          {[['followers', 'Followers'], ['capital', 'Capital'], ['return', 'Return'], ['live', 'Live P&L'], ['recent', 'Recent']].map(([k, l]) => (
            <button key={k} className={sort === k ? 'chip on' : 'chip'} onClick={() => setSort(k)}>{l}</button>
          ))}
        </div>
      </div>
      <MarketPulse />
      {user ? <PaperStrip user={user} /> : null}
      <div className="panel">
        <div className="pos-table">
          <div className="pos-head"><span>#</span><span>Playbook</span><span>Asset</span><span>Owner</span><span>Followers</span><span>Allocated</span><span>Live</span><span></span></div>
          {rows == null ? <div className="empty-body">loading…</div> : rows.length === 0 ? <div className="empty-body">no rows</div> : rows.map((r, i) => (
            <div className="pos-row" key={r.id}>
              <b className="mono">{i + 1}</b>
              <b>{r.title}</b>
              <span className="mono">{r.asset}</span>
              <span className="mono muted">{r.ownerName || '—'}</span>
              <b className="mono">{r.followers}</b>
              <b className="mono">${r.totalAllocatedUsd.toLocaleString()}</b>
              <b className={r.livePnlPct == null ? 'muted mono' : r.livePnlPct >= 0 ? 'up mono' : 'down mono'}>{r.livePnlPct == null ? '—' : `${(r.livePnlPct * 100).toFixed(2)}%`}</b>
              <button className="chip mini" onClick={() => onOpenPlaybook(r.id)}>OPEN →</button>
            </div>
          ))}
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
    if (!text) return
    setInput('')
    setBusy(true)
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next)
    try {
      const r = await api('/assayer/chat', { method: 'POST', body: JSON.stringify({ messages: next }) })
      setMessages([...next, { role: 'assistant', content: r.reply }])
      if (r.playbook) setProposed(r.playbook)
    } catch (err) {
      setMessages([...next, { role: 'assistant', content: `Something failed: ${err.message}` }])
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
            <small>Signal: {proposed.signalConditions.map(c => `${c.field} ${c.op} ${c.value}`).join(' AND ')}</small>
            <small>Exit: {proposed.exitConditions.map(c => `${c.field} ${c.op} ${c.value}`).join(' AND ')}</small>
            {token ? <button className="btn primary sm" onClick={savePlaybook} disabled={busy}><Gem size={12} /> SAVE + PUBLISH</button> : <p className="hint-inline">Sign in to save + publish.</p>}
          </div>
        )}
      </div>

      <div className="commandbar">
        <div className="cb-icon"><MessageCircle size={15} /></div>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()} placeholder='e.g. "build a BTC ETF-flow follow" or "sketch an ETH oversold bounce"' />
        <button className="btn primary" onClick={send} disabled={busy}><Send size={13} /> SEND</button>
      </div>
    </div>
  )
}
