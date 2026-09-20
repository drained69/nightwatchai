/**
 * Alpha of the Day — the daily AI market intelligence page (tokenized U.S. stocks only).
 *
 * Structure mirrors the certificate/prospectus theme used elsewhere:
 *   1. Header block: date, generated-at, coverage stats, next-run.
 *   2. Market summary card: sector table, macro regime.
 *   3. Unusual movements strip.
 *   4. Alpha candidates: one card per finalist, each with situation /
 *      short + long thesis / risks / invalidation / a "Ask in Thesis Lab"
 *      button that pre-fills a research question.
 *   5. Email subscription toggle (auth-gated).
 *
 * The page is read-only: reports are generated on the server at 02:00 UTC
 * and by the /nightwatch/run admin endpoint. Client just renders.
 */
import React, { useEffect, useState } from 'react'
import { Clock, Mail, Sparkles, TrendingUp, TrendingDown, ExternalLink, RefreshCw, ShieldAlert } from 'lucide-react'
import { hasApi, apiUrl } from './apiBase.js'
import { getToken } from './GetAgentPages.jsx'

async function apiJson(path, opts = {}) {
  if (!hasApi()) throw new Error('no adapter')
  const res = await fetch(apiUrl(path), opts)
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`${res.status} ${t.slice(0, 200)}`) }
  return res.json()
}

// Report list fields are structured objects, not strings: risks are
// { label, detail }, change-conditions are { label, why }. Flatten to a line.
function itemText(x) {
  if (x == null) return ''
  if (typeof x === 'string') return x
  if (typeof x === 'object') {
    const head = x.label || x.name || ''
    const tail = x.detail || x.why || ''
    return tail ? `${head} — ${tail}` : head
  }
  return String(x)
}

function fmtPct(v) { return v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%` }
function fmtPctRaw(v) { return v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` }
function fmtNum(v, digits = 2) { return v == null ? '—' : v.toFixed(digits) }
function fmtRelative(iso) {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const min = Math.round(diff / 60_000)
  if (min < 60) return `${min}m ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function Nightwatch02Page({ user, onAsk }) {
  const [brief, setBrief] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [running, setRunning] = useState(false)

  const load = async () => {
    setLoading(true); setErr(null)
    try {
      const [b, s] = await Promise.all([
        apiJson('/nightwatch/latest').catch(e => { if (String(e.message).startsWith('404')) return null; throw e }),
        apiJson('/nightwatch/status').catch(() => null),
      ])
      setBrief(b); setStatus(s)
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const runNow = async () => {
    if (!user) { setErr('sign in to trigger a manual run'); return }
    const token = getToken()
    setRunning(true); setErr(null)
    try {
      await apiJson('/nightwatch/run', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      })
      await load()
    } catch (e) { setErr(e.message) } finally { setRunning(false) }
  }

  return (
    <div className="page nw02-page">
      <header className="nw02-header">
        <div className="nw02-title">
          <div className="nw02-eyebrow"><Sparkles size={13} /> ALPHA OF THE DAY · TOKENIZED STOCK INTELLIGENCE</div>
          <h1>Alpha of the Day</h1>
          <p className="nw02-sub">
            A daily AI research brief on the tokenized U.S. stock universe — sectors, unusual movements, and alpha
            candidates with a short-term and long-term thesis, risks, and invalidation conditions. Generated every
            day at 02:00 UTC from the same live tape the Research desk uses. Crypto is out of scope.
          </p>
        </div>
        <div className="nw02-meta">
          {status?.scheduler && (
            <div className="nw02-meta-row">
              <span className="lbl">Next run</span>
              <span className="val"><Clock size={11} /> {status.scheduler.nextFireAt ? new Date(status.scheduler.nextFireAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—'}</span>
            </div>
          )}
          {brief && (
            <div className="nw02-meta-row">
              <span className="lbl">Coverage</span>
              <span className="val">{brief.coverage?.live}/{brief.coverage?.total} live · {brief.coverage?.newsItems} news items</span>
            </div>
          )}
          {status?.scheduler?.lastRun && (
            <div className="nw02-meta-row">
              <span className="lbl">Last run</span>
              <span className="val">{fmtRelative(status.scheduler.lastRun.at)}</span>
            </div>
          )}
          {user && (
            <button className="btn ghost sm" onClick={runNow} disabled={running}>
              <RefreshCw size={11} /> {running ? 'Generating…' : 'Run now'}
            </button>
          )}
        </div>
      </header>

      <SubscriptionToggle user={user} status={status} />

      {loading && <div className="empty-report">Loading today's brief…</div>}
      {err && !brief && <div className="empty-report"><b>Could not load brief</b><p>{err}</p></div>}
      {!loading && !err && !brief && (
        <div className="empty-report" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <Sparkles size={28} style={{ marginBottom: 12, opacity: 0.4 }} />
          <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: 15 }}>No brief yet</p>
          <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 13 }}>
            The first Alpha of the Day brief will be generated at 02:00 UTC.{' '}
            {user ? 'Hit "Run now" above to generate one right away.' : 'Sign in to trigger a manual run.'}
          </p>
        </div>
      )}

      {brief && (
        <>
          <MarketSummary brief={brief} />
          <UnusualMovements items={brief.unusualMovements} />
          <AlphaCandidates candidates={brief.alphaCandidates} onAsk={onAsk} />
          <Disclaimer text={brief.disclaimer} />
        </>
      )}
    </div>
  )
}

/* ---------------- subscription toggle ---------------- */

function SubscriptionToggle({ user, status }) {
  const [sub, setSub] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const token = getToken()
  const mailerReady = status?.mailer?.canDeliver

  useEffect(() => {
    if (!user || !token || !hasApi()) return
    apiJson('/nightwatch/subscription', { headers: { Authorization: `Bearer ${token}` } })
      .then(setSub).catch(() => setSub(null))
  }, [user, token])

  if (!user) {
    return (
      <div className="nw02-subscribe locked">
        <Mail size={14} />
        <span>Sign in to receive the Alpha of the Day report by email every day.</span>
      </div>
    )
  }
  const toggle = async () => {
    setBusy(true); setNote(null)
    try {
      const enabled = !sub?.enabled
      const r = await apiJson('/nightwatch/subscription', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, enabled }),
      })
      setSub(r)
      setNote(enabled
        ? (r.mailerReady ? `You'll receive the brief at ${user.email} every day.` : `Preference saved — but email delivery is not configured on this server yet.`)
        : 'Daily emails turned off.')
    } catch (e) { setNote(`Could not save: ${e.message}`) } finally { setBusy(false) }
  }

  return (
    <div className={`nw02-subscribe ${sub?.enabled ? 'on' : 'off'}`}>
      <Mail size={14} />
      <div className="nw02-sub-body">
        <div className="nw02-sub-title">Send me the Alpha of the Day report every day</div>
        <div className="nw02-sub-detail">
          {sub?.enabled
            ? `Delivering to ${user.email} at 02:00 UTC. Unsubscribe anytime from the email footer or right here.`
            : `We'll email the brief to ${user.email} once you enable it.`}
          {!mailerReady && <span className="nw02-warn"><ShieldAlert size={11} /> Email provider not configured — the toggle records your preference but no mail will send until <code>RESEND_API_KEY</code> is set on the server.</span>}
        </div>
        {note && <div className="nw02-sub-note">{note}</div>}
      </div>
      <button className={`btn ${sub?.enabled ? '' : 'primary'} sm`} onClick={toggle} disabled={busy}>
        {busy ? 'Saving…' : sub?.enabled ? 'Turn off' : 'Turn on'}
      </button>
    </div>
  )
}

/* ---------------- market summary ---------------- */

function MarketSummary({ brief }) {
  const ms = brief.marketSummary || {}
  const macro = ms.macro || {}
  return (
    <section className="panel nw02-panel">
      <div className="panel-head">
        <h3>Market summary</h3>
        <small>{brief.date} · generated {fmtRelative(brief.generatedAt)}</small>
      </div>
      <div className="nw02-summary-grid">
        <StatTile label="Stocks avg 24h" value={fmtPctRaw(ms.equityAvgChange24h)} tone={ms.equityAvgChange24h >= 0 ? 'up' : 'down'} />
        <StatTile label="Breadth" value={fmtNum(ms.breadth)} tone={ms.breadth >= 0 ? 'up' : 'down'} />
        <StatTile label="Winners / Losers" value={`${ms.winners} / ${ms.losers}`} />
        <StatTile label="Risk regime" value={macro.riskRegime || '—'} />
        <StatTile label="DXY · VIX" value={`${fmtNum(macro.dxy)} · ${fmtNum(macro.vix, 1)}`} />
      </div>
      {ms.sectors?.length > 0 && (
        <div className="nw02-sectors">
          <div className="nw02-label">Sectors · 24h average</div>
          <div className="nw02-sector-grid">
            {ms.sectors.slice(0, 8).map(s => (
              <div className={`nw02-sector-row ${s.avgChange24h >= 0 ? 'up' : 'down'}`} key={s.sector}>
                <span className="nw02-sector-name">{s.sector}</span>
                <span className="nw02-sector-move">{fmtPctRaw(s.avgChange24h)}</span>
                <span className="nw02-sector-leaders">{(s.leaders || []).join(', ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function StatTile({ label, value, tone }) {
  return (
    <div className={`nw02-tile ${tone || ''}`}>
      <div className="nw02-tile-label">{label}</div>
      <div className="nw02-tile-value">{value}</div>
    </div>
  )
}

/* ---------------- unusual movements ---------------- */

function UnusualMovements({ items }) {
  if (!items?.length) return null
  return (
    <section className="panel nw02-panel">
      <div className="panel-head">
        <h3>Unusual movements</h3>
        <small>{items.length} symbols flagged</small>
      </div>
      <div className="nw02-unusual">
        {items.map(u => (
          <div className={`nw02-unusual-row ${u.change24h >= 0 ? 'up' : 'down'}`} key={u.symbol}>
            <div className="nw02-unusual-head">
              <b>{u.symbol}</b> <span className="nw02-unusual-sector">{u.sector}</span>
            </div>
            <div className="nw02-unusual-move">
              {u.change24h >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {fmtPctRaw(u.change24h)}
            </div>
            <div className="nw02-unusual-drivers">{u.drivers.join(' · ')}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ---------------- alpha candidates ---------------- */

function AlphaCandidates({ candidates, onAsk }) {
  if (!candidates?.length) {
    return (
      <section className="panel nw02-panel">
        <div className="panel-head"><h3>Alpha candidates</h3><small>none qualified today</small></div>
        <div className="empty-body">No tokenized stock cleared today's alpha scan. The next brief runs at 02:00 UTC tomorrow.</div>
      </section>
    )
  }
  return (
    <section className="panel nw02-panel">
      <div className="panel-head">
        <h3>Alpha candidates</h3>
        <small>{candidates.length} finalists · ranked by move · volume · news</small>
      </div>
      <div className="nw02-candidates">
        {candidates.map(c => <CandidateCard key={c.symbol} candidate={c} onAsk={onAsk} />)}
      </div>
    </section>
  )
}

function CandidateCard({ candidate, onAsk }) {
  const c = candidate
  const sig = c.report?.signal
  const dirTone = sig?.direction === 'LONG' ? 'up' : sig?.direction === 'SHORT' ? 'down' : 'flat'
  // situation is an array of lines; shortTermThesis/longTermThesis are structured
  // objects ({ statement, keyDrivers/structuralFactors, expectedMove, horizon }).
  const situationLines = Array.isArray(c.report?.situation) ? c.report.situation : (c.report?.situation ? [c.report.situation] : [])
  const shortT = c.report?.shortTermThesis
  const longT  = c.report?.longTermThesis
  return (
    <article className="nw02-candidate">
      <header className="nw02-cand-head">
        <div>
          <h4>{c.symbol} <span className="nw02-cand-name">{c.name}</span></h4>
          <div className="nw02-cand-meta">
            {c.sector} · <span className={c.change24h >= 0 ? 'up' : 'down'}>{fmtPctRaw(c.change24h)}</span> 24h · alpha score {c.alphaScore.toFixed(2)}
          </div>
        </div>
        {sig && (
          <div className={`nw02-cand-signal ${dirTone}`}>
            <b>{sig.direction}</b>
            <small>{(sig.confidence * 100).toFixed(0)}% conf · net edge {fmtPct(sig.netEdge)}</small>
          </div>
        )}
      </header>

      {situationLines.length > 0 && (
        <div className="nw02-cand-block">
          <div className="nw02-cand-label">Situation · what changed</div>
          {situationLines.map((line, i) => <p key={i}>{line}</p>)}
        </div>
      )}
      {shortT?.statement && (
        <div className="nw02-cand-block">
          <div className="nw02-cand-label">Short-term thesis{shortT.horizon ? ` · ${shortT.horizon}` : ''}</div>
          <p>{shortT.statement}</p>
          {shortT.expectedMove && <div className="nw02-cand-move">Expected move: <b>{shortT.expectedMove}</b></div>}
          {shortT.keyDrivers?.length > 0 && <ul className="nw02-cand-list">{shortT.keyDrivers.map((d, i) => <li key={i}>{d}</li>)}</ul>}
        </div>
      )}
      {longT?.statement && (
        <div className="nw02-cand-block">
          <div className="nw02-cand-label">Long-term thesis{longT.horizon ? ` · ${longT.horizon}` : ''}</div>
          <p>{longT.statement}</p>
          {longT.structuralFactors?.length > 0 && <ul className="nw02-cand-list">{longT.structuralFactors.map((d, i) => <li key={i}>{d}</li>)}</ul>}
        </div>
      )}
      {c.report?.risks?.length > 0 && (
        <div className="nw02-cand-block">
          <div className="nw02-cand-label">Risks</div>
          <ul className="nw02-cand-list">
            {c.report.risks.slice(0, 4).map((r, i) => <li key={i}>{itemText(r)}</li>)}
          </ul>
        </div>
      )}
      {c.report?.whatChangesThisThesis?.length > 0 && (
        <div className="nw02-cand-block">
          <div className="nw02-cand-label">What would change this thesis</div>
          <ul className="nw02-cand-list">
            {c.report.whatChangesThisThesis.slice(0, 3).map((r, i) => <li key={i}>{itemText(r)}</li>)}
          </ul>
        </div>
      )}
      {c.report?.invalidation?.price && (
        <div className="nw02-cand-invalidation">
          <b>Invalidation ≈ ${c.report.invalidation.price}</b> · {(c.report.invalidation.conditions || []).slice(0, 2).join(' · ')}
        </div>
      )}
      {c.news?.length > 0 && (
        <div className="nw02-cand-block">
          <div className="nw02-cand-label">Relevant news</div>
          <ul className="nw02-cand-list">
            {c.news.map(n => (
              <li key={n.headline}>
                <span className="nw02-news-source">[{n.source}]</span> {n.headline}
                {n.url && <a href={n.url} target="_blank" rel="noreferrer" className="nw02-news-link"><ExternalLink size={10} /></a>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="nw02-cand-actions">
        <button className="btn primary sm" onClick={() => onAsk?.(c.thesisCardQuestion)}>
          Research this stock
        </button>
        <span className="nw02-cand-source">{c.report?.dataFreshness || 'live tape'}</span>
      </div>
    </article>
  )
}

function Disclaimer({ text }) {
  return (
    <div className="nw02-disclaimer">
      {text || 'Alpha of the Day is AI-generated market research, not investment advice.'}
    </div>
  )
}
