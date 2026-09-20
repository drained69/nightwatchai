/**
 * NIGHTWATCH 02:00 — daily AI market intelligence brief.
 *
 * Every day at 02:00 UTC we:
 *   1. Pull the live tokenized-equity + crypto-anchor universe (buildLiveUniverse).
 *   2. Grade every asset on composite/net-edge/volume/news attention.
 *   3. Pick the top N alpha candidates.
 *   4. Run the same `LocalNightwatchEngine.research` pipeline that powers the
 *      Research tab against each candidate so its Thesis Card is produced by
 *      exactly one code path — no separate "brief-only" model to drift.
 *   5. Stress-test the top candidates via `stressTestThesis`.
 *   6. Persist to <DATA_DIR>/nightwatch02/YYYY-MM-DD.json and copy to latest.json.
 *   7. Email every subscribed address.
 *
 * All prices, news items and timestamps carry a source; missing data is
 * surfaced as `null` and labeled in the UI/email. We never claim a guaranteed
 * profit — the brief is research, not advice.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { paths } from './lib/store.mjs'
import { logger } from './lib/log.mjs'
import { buildLiveContext, buildLiveUniverse, getMacro } from './market-context.mjs'
import { LocalNightwatchEngine, inferAsset, stressTestThesis, fmtPct } from '../src/domain.js'
import { sendBatch } from './lib/mailer.mjs'
import { listActiveSubscribers } from './nightwatch02-subscriptions.mjs'

const DIR = path.join(paths.DATA_DIR, 'nightwatch02')
const LATEST_FILE = path.join(DIR, 'latest.json')
const BRIEFS_DIR  = path.join(DIR, 'briefs')

function ensureDirs() { fs.mkdirSync(BRIEFS_DIR, { recursive: true }) }
function atomicWrite(f, obj) {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  const tmp = `${f}.${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2))
  fs.renameSync(tmp, f)
}
function safeReadJson(f, fb) { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return fb } }

/** YYYY-MM-DD for the brief being generated (UTC, since scheduler is UTC). */
export function briefDateKey(at = new Date()) { return at.toISOString().slice(0, 10) }

/* -------------------------------------------------- ranking */

/**
 * Combine live signal + move + news attention into an "alpha score". Purely
 * a ranker — the report itself is produced by the research engine, not this
 * heuristic. Any missing input becomes a 0 contribution (never NaN).
 */
export function scoreAlphaCandidate(row, newsCount = 0) {
  const move = Math.abs(row.change24h ?? 0)
  const volZ = Math.max(0, Math.min(4, row.indicators?.volumeZ ?? 0))
  const news = Math.min(6, newsCount)
  // Bounded 0..1 combination. Weights sum to 1 so score stays comparable across
  // days regardless of tape.
  const rawMove = Math.min(1, move / 8)           // an 8% daily move saturates
  const rawVol  = volZ / 4                        // vol z-score capped at 4σ
  const rawNews = news / 6                        // 6+ headlines saturate
  return Number((0.5 * rawMove + 0.3 * rawVol + 0.2 * rawNews).toFixed(4))
}

/* -------------------------------------------------- sector map (labeling only) */

const SECTOR_OF = {
  NVDA: 'Semiconductors', AMD: 'Semiconductors', TSM: 'Semiconductors',
  TSLA: 'Auto / EV', AAPL: 'Consumer Tech', MSFT: 'Cloud / AI',
  META: 'Digital Ads', GOOGL: 'Digital Ads', AMZN: 'E-commerce / Cloud',
  MSTR: 'Crypto-linked Equity', COIN: 'Crypto-linked Equity',
  BTC: 'Crypto Anchor', ETH: 'Crypto Anchor', SOL: 'Crypto',
}
function sectorOf(row) { return SECTOR_OF[row.symbol] || row.sector || 'Other' }

/* -------------------------------------------------- market summary */

function summarizeMarket(rows, macro) {
  const equities = rows.filter(r => r.class === 'equity' || r.class === 'tokenized-equity' || SECTOR_OF[r.symbol] && r.class !== 'crypto')
  const crypto   = rows.filter(r => r.class === 'crypto')
  const avg = arr => arr.length ? arr.reduce((a, x) => a + (x.change24h || 0), 0) / arr.length : 0
  const winners = rows.filter(r => (r.change24h ?? 0) >= 1)
  const losers  = rows.filter(r => (r.change24h ?? 0) <= -1)

  // Sector-level averages (equities only — crypto is one bucket).
  const bySector = {}
  for (const r of rows) {
    const key = sectorOf(r)
    ;(bySector[key] ||= []).push(r)
  }
  const sectors = Object.entries(bySector).map(([sector, list]) => ({
    sector, count: list.length,
    avgChange24h: Number(avg(list).toFixed(2)),
    leaders: list.slice().sort((a, b) => (b.change24h || 0) - (a.change24h || 0)).slice(0, 2).map(r => r.symbol),
  })).sort((a, b) => Math.abs(b.avgChange24h) - Math.abs(a.avgChange24h))

  return {
    equityAvgChange24h: Number(avg(equities).toFixed(2)),
    cryptoAvgChange24h: Number(avg(crypto).toFixed(2)),
    winners: winners.length,
    losers: losers.length,
    breadth: rows.length ? Number(((winners.length - losers.length) / rows.length).toFixed(2)) : 0,
    macro: macro ? {
      cryptoRegime: macro.cryptoRegime,
      riskRegime: macro.riskRegime,
      dxy: macro.dxy?.last ?? null,
      vix: macro.vix?.last ?? null,
      spx: macro.spx?.last ?? null,
      ndx: macro.ndx?.last ?? null,
      ust10y: macro.ust10y?.last ?? null,
      live: Boolean(macro.live),
    } : null,
    sectors,
  }
}

/* -------------------------------------------------- unusual movements */

function findUnusualMovements(rows, newsBySymbol) {
  const notes = []
  for (const r of rows) {
    if (!r.live) continue
    const move = r.change24h ?? 0
    const volZ = r.indicators?.volumeZ ?? 0
    const news = (newsBySymbol[r.symbol] || []).length
    // Threshold: |move| ≥ 3% OR volume z ≥ 1.5σ OR news attention ≥ 3 items.
    if (Math.abs(move) >= 3 || volZ >= 1.5 || news >= 3) {
      const drivers = []
      if (Math.abs(move) >= 3) drivers.push(`24h move ${move >= 0 ? '+' : ''}${move.toFixed(2)}%`)
      if (volZ >= 1.5)         drivers.push(`volume ${volZ.toFixed(2)}σ above baseline`)
      if (news >= 3)           drivers.push(`${news} recent headlines`)
      notes.push({
        symbol: r.symbol,
        name: r.name,
        sector: sectorOf(r),
        change24h: Number(move.toFixed(2)),
        volumeZ: volZ ? Number(volZ.toFixed(2)) : null,
        newsCount: news,
        drivers,
      })
    }
  }
  return notes.sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h)).slice(0, 8)
}

/* -------------------------------------------------- candidate → mini-report */

/**
 * Turn one live universe row into a research-driven alpha card. Reuses the
 * exact LocalNightwatchEngine + stressTestThesis path the app uses on demand.
 */
async function buildCandidateCard(engine, row, ctx) {
  const request = {
    intent: 'research',
    question: `NIGHTWATCH 02:00 · what changed on ${row.symbol} and is there an edge?`,
    asset: row.symbol,
    context: ctx,
  }
  const artifact = await engine.run(request)
  const report = artifact.report
  const thesis = report && report.signal.status === 'SIGNAL'
    ? await stressTestOne(report, ctx)
    : null
  return {
    symbol: row.symbol,
    name: row.name,
    sector: sectorOf(row),
    price: row.price ?? null,
    change24h: row.change24h ?? null,
    liveSource: row.live ? 'bitget-spot' : 'seed',
    news: (ctx.newsBySymbol?.[row.symbol] || []).slice(0, 3).map(n => ({
      headline: n.headline, source: n.source, url: n.url, publishedAt: n.publishedAt,
      direction: n.direction, magnitude: n.magnitude,
    })),
    report: report ? {
      id: report.id,
      dataMode: report.dataMode,
      summary: report.summary,
      signal: report.signal,
      situation: report.situation,
      shortTermThesis: report.shortTermThesis,
      longTermThesis: report.longTermThesis,
      whatChangesThisThesis: report.whatChangesThisThesis,
      stressTests: report.stressTests,
      risks: report.risks,
      invalidation: report.invalidation,
      supporting: report.supporting?.slice(0, 5),
      contradicting: report.contradicting?.slice(0, 5),
      citations: report.citations?.slice(0, 6),
      dataFreshness: report.dataFreshness,
    } : null,
    thesisTest: thesis ? {
      verdict: thesis.verdict, resonance: thesis.resonance,
      steelman: thesis.steelman, counter: thesis.counter,
      stressTests: thesis.stressTests,
    } : null,
    thesisCardQuestion: `NIGHTWATCH 02:00 flagged ${row.symbol} (${sectorOf(row)}) — what is the current thesis and what would invalidate it?`,
  }
}

function stressTestOne(report, ctx) {
  try {
    // Reuse `stressTestThesis` with the report's own summary as the input.
    const thesis = `${report.signal.direction} ${report.symbol}: ${report.signal.reason}`
    const memory = ctx.memory || { preferences: {}, analogs: [] }
    const universe = ctx.universe
    return Promise.resolve(stressTestThesis({ thesis, memory, universe, context: ctx }))
  } catch (err) { logger.warn({ err: err.message, symbol: report.symbol }, 'stress-test failed'); return Promise.resolve(null) }
}

/* -------------------------------------------------- brief builder */

export async function generateBrief({ newsStore, engine = new LocalNightwatchEngine(), maxCandidates = 5, now = new Date() } = {}) {
  ensureDirs()
  const started = Date.now()
  const universe = await buildLiveUniverse().catch(err => { logger.warn({ err: err.message }, 'brief: universe fetch failed'); return [] })
  const macro = await getMacro().catch(() => null)
  const bySymbol = newsStore?._items ? newsBySymbolFromStore(newsStore) : {}

  // Ranking scope: live rows only. Never manufacture an alpha candidate from
  // seeded data — the brief must be honest about coverage.
  const liveRows = universe.filter(r => r.live)
  const ranked = liveRows
    .map(r => ({ row: r, score: scoreAlphaCandidate(r, (bySymbol[r.symbol] || []).length) }))
    .sort((a, b) => b.score - a.score)

  // Build the shared context once — every candidate reuses the same universe/
  // macro/news snapshot so cross-candidate references stay consistent.
  const sharedCtx = await buildLiveContext(newsStore, null).catch(() => ({ universe, macro, news: [], newsBySymbol: bySymbol, btcChange24h: null }))
  sharedCtx.memory = { preferences: {}, analogs: [] }

  const candidates = []
  for (const { row, score } of ranked.slice(0, maxCandidates)) {
    try {
      const card = await buildCandidateCard(engine, row, { ...sharedCtx, news: bySymbol[row.symbol] || [] })
      candidates.push({ ...card, alphaScore: score })
    } catch (err) { logger.warn({ err: err.message, symbol: row.symbol }, 'candidate card failed') }
  }

  const brief = {
    id: `nw02-${briefDateKey(now)}`,
    date: briefDateKey(now),
    generatedAt: now.toISOString(),
    generationMs: Date.now() - started,
    coverage: {
      total: universe.length,
      live: liveRows.length,
      newsItems: newsStore?._items?.length || 0,
    },
    marketSummary: summarizeMarket(universe, macro),
    unusualMovements: findUnusualMovements(universe, bySymbol),
    alphaCandidates: candidates,
    disclaimer: 'NIGHTWATCH 02:00 is AI-generated market research, not investment advice. Prices and news carry a source timestamp; missing data is labeled. Do your own diligence before trading.',
  }
  const dailyFile = path.join(BRIEFS_DIR, `${brief.date}.json`)
  atomicWrite(dailyFile, brief)
  atomicWrite(LATEST_FILE, brief)
  logger.info({ id: brief.id, live: brief.coverage.live, candidates: candidates.length, ms: brief.generationMs }, 'NIGHTWATCH 02:00 brief published')
  return brief
}

/** Lightweight version of market-context.newsBySymbol without importing it (circular). */
function newsBySymbolFromStore(newsStore, limitPerSymbol = 8) {
  const out = {}
  for (const item of newsStore._items || []) {
    for (const aff of item.affectedAssets || []) {
      const arr = (out[aff.symbol] ||= [])
      if (arr.length >= limitPerSymbol) continue
      arr.push({
        id: item.id, headline: item.headline, detail: (item.detail || '').slice(0, 200),
        source: item.source, url: item.url, publishedAt: item.publishedAt,
        severity: item.severity, category: item.category,
        direction: aff.direction || 'MIXED', magnitude: aff.magnitude ?? 0.5,
        reasoning: aff.reasoning || '',
      })
    }
  }
  return out
}

/* -------------------------------------------------- persistence readers */

export function loadLatestBrief() { return safeReadJson(LATEST_FILE, null) }
export function loadBriefByDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return null
  return safeReadJson(path.join(BRIEFS_DIR, `${date}.json`), null)
}
export function listBriefDates(limit = 30) {
  try {
    const files = fs.readdirSync(BRIEFS_DIR)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, limit)
    return files.map(f => f.replace('.json', ''))
  } catch { return [] }
}

/* -------------------------------------------------- email rendering */

const APP_URL = () => (process.env.APP_URL || 'http://localhost:8787').replace(/\/$/, '')

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

/** situation is an array of lines; join to one paragraph. */
function situationText(situation) {
  if (Array.isArray(situation)) return situation.join(' ')
  return typeof situation === 'string' ? situation : ''
}
/** shortTermThesis/longTermThesis are structured objects — use the statement. */
function thesisText(thesis) {
  if (thesis && typeof thesis === 'object') return String(thesis.statement || '')
  return typeof thesis === 'string' ? thesis : ''
}
/** risks are { label, detail }; change-conditions are { label, why }. Flatten. */
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

export function renderBriefEmailHtml(brief, subscriber) {
  const base = APP_URL()
  const unsub = subscriber?.unsubscribeToken
    ? `${base}/nightwatch/unsubscribe/${subscriber.unsubscribeToken}`
    : `${base}/#nightwatch02`
  const link = `${base}/#nightwatch02`
  const ms = brief.marketSummary || {}
  const macro = ms.macro || {}
  const topSectors = (ms.sectors || []).slice(0, 4).map(s =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #24262b;font-family:'IBM Plex Mono',monospace;color:#e6e6e6">${escapeHtml(s.sector)}</td>
     <td style="padding:6px 10px;border-bottom:1px solid #24262b;text-align:right;font-family:'IBM Plex Mono',monospace;color:${s.avgChange24h >= 0 ? '#5dbf91' : '#e05b6a'}">${s.avgChange24h >= 0 ? '+' : ''}${s.avgChange24h.toFixed(2)}%</td>
     <td style="padding:6px 10px;border-bottom:1px solid #24262b;font-family:'IBM Plex Mono',monospace;color:#9aa0a6">${(s.leaders || []).join(', ')}</td></tr>`
  ).join('')
  const unusual = (brief.unusualMovements || []).slice(0, 5).map(u =>
    `<li style="margin:8px 0;color:#e6e6e6"><b>${escapeHtml(u.symbol)}</b> · ${escapeHtml(u.sector)} · <span style="color:${u.change24h >= 0 ? '#5dbf91' : '#e05b6a'}">${u.change24h >= 0 ? '+' : ''}${u.change24h.toFixed(2)}%</span> — <span style="color:#9aa0a6">${escapeHtml(u.drivers.join(' · '))}</span></li>`
  ).join('')
  const cards = (brief.alphaCandidates || []).slice(0, 5).map(c => {
    const sig = c.report?.signal || {}
    const risks = (c.report?.risks || []).slice(0, 3).map(r => `<li style="margin:4px 0;color:#c5c5c5">${escapeHtml(itemText(r))}</li>`).join('')
    const inval = c.report?.invalidation
    return `
    <div style="border:1px solid #24262b;padding:20px;margin:16px 0;background:#101216">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <h3 style="font-family:'DM Serif Display',Georgia,serif;font-size:22px;margin:0;color:#fff">${escapeHtml(c.symbol)} · ${escapeHtml(c.name || '')}</h3>
        <span style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:${(c.change24h ?? 0) >= 0 ? '#5dbf91' : '#e05b6a'}">${(c.change24h ?? 0) >= 0 ? '+' : ''}${(c.change24h ?? 0).toFixed(2)}% 24h</span>
      </div>
      <div style="color:#9aa0a6;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:1px;margin:4px 0 14px">${escapeHtml(c.sector)} · ${escapeHtml(sig.direction || 'FLAT')} · ${sig.confidence != null ? (sig.confidence * 100).toFixed(0) + '% conf' : ''} · ${escapeHtml(c.liveSource)}</div>
      ${situationText(c.report?.situation) ? `<p style="color:#e6e6e6;line-height:1.6;margin:0 0 12px">${escapeHtml(situationText(c.report.situation))}</p>` : ''}
      ${thesisText(c.report?.shortTermThesis) ? `<p style="color:#c5c5c5;margin:8px 0;font-size:14px"><b style="color:#fff">Short term:</b> ${escapeHtml(thesisText(c.report.shortTermThesis))}</p>` : ''}
      ${thesisText(c.report?.longTermThesis) ? `<p style="color:#c5c5c5;margin:8px 0;font-size:14px"><b style="color:#fff">Long term:</b> ${escapeHtml(thesisText(c.report.longTermThesis))}</p>` : ''}
      ${risks ? `<div style="margin-top:12px"><b style="color:#fff;font-size:12px;text-transform:uppercase;letter-spacing:1px">Risks</b><ul style="margin:6px 0 0;padding-left:18px">${risks}</ul></div>` : ''}
      ${inval?.price ? `<div style="margin-top:12px;color:#9aa0a6;font-family:'IBM Plex Mono',monospace;font-size:12px">Invalidation ≈ $${inval.price} · ${escapeHtml((inval.conditions || []).slice(0, 2).join(' · '))}</div>` : ''}
      <a href="${link}" style="display:inline-block;margin-top:14px;padding:10px 16px;background:#5dbf91;color:#0e0f11;text-decoration:none;font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:1px;text-transform:uppercase">Open Thesis Card →</a>
    </div>`
  }).join('')

  return `
<!doctype html><html><body style="margin:0;padding:0;background:#0b0c0e;font-family:-apple-system,Segoe UI,sans-serif;color:#e6e6e6">
  <div style="max-width:640px;margin:0 auto;padding:32px 24px">
    <div style="border-bottom:1px solid #24262b;padding-bottom:16px;margin-bottom:24px">
      <h1 style="font-family:'DM Serif Display',Georgia,serif;font-size:30px;margin:0 0 4px;color:#fff">NIGHTWATCH 02:00</h1>
      <div style="color:#9aa0a6;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase">Daily Market Intelligence · ${escapeHtml(brief.date)}</div>
    </div>

    <h2 style="font-family:'DM Serif Display',Georgia,serif;color:#fff;font-size:18px;margin:0 0 12px">Market summary</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
      <tr>
        <td style="padding:6px 10px;color:#9aa0a6;font-family:'IBM Plex Mono',monospace;font-size:11px;text-transform:uppercase;letter-spacing:1px">Equities avg 24h</td>
        <td style="padding:6px 10px;text-align:right;font-family:'IBM Plex Mono',monospace;color:${ms.equityAvgChange24h >= 0 ? '#5dbf91' : '#e05b6a'}">${ms.equityAvgChange24h >= 0 ? '+' : ''}${(ms.equityAvgChange24h || 0).toFixed(2)}%</td>
      </tr>
      <tr>
        <td style="padding:6px 10px;color:#9aa0a6;font-family:'IBM Plex Mono',monospace;font-size:11px;text-transform:uppercase;letter-spacing:1px">Breadth (winners − losers)</td>
        <td style="padding:6px 10px;text-align:right;font-family:'IBM Plex Mono',monospace;color:#e6e6e6">${(ms.breadth || 0).toFixed(2)}</td>
      </tr>
      <tr>
        <td style="padding:6px 10px;color:#9aa0a6;font-family:'IBM Plex Mono',monospace;font-size:11px;text-transform:uppercase;letter-spacing:1px">Macro regime</td>
        <td style="padding:6px 10px;text-align:right;font-family:'IBM Plex Mono',monospace;color:#e6e6e6">${escapeHtml(macro.riskRegime || '—')} · DXY ${macro.dxy != null ? macro.dxy.toFixed(2) : '—'} · VIX ${macro.vix != null ? macro.vix.toFixed(1) : '—'}</td>
      </tr>
    </table>

    ${topSectors ? `<h3 style="font-family:'DM Serif Display',Georgia,serif;color:#fff;font-size:15px;margin:20px 0 8px">Top sectors</h3>
    <table style="width:100%;border-collapse:collapse;border:1px solid #24262b">${topSectors}</table>` : ''}

    ${unusual ? `<h2 style="font-family:'DM Serif Display',Georgia,serif;color:#fff;font-size:18px;margin:24px 0 8px">Unusual movements</h2><ul style="margin:0;padding-left:18px">${unusual}</ul>` : ''}

    <h2 style="font-family:'DM Serif Display',Georgia,serif;color:#fff;font-size:18px;margin:32px 0 8px">Alpha candidates</h2>
    ${cards || '<p style="color:#9aa0a6;font-style:italic">No qualifying alpha candidates in the current tape.</p>'}

    <div style="margin-top:32px;padding:16px 20px;background:#101216;border:1px solid #24262b;color:#9aa0a6;font-size:12px;line-height:1.6">
      ${escapeHtml(brief.disclaimer)}
    </div>

    <div style="margin-top:24px;color:#6d7278;font-size:11px;text-align:center;line-height:1.7">
      <a href="${link}" style="color:#9aa0a6">Open NIGHTWATCH 02:00 in the workstation</a><br>
      <a href="${unsub}" style="color:#6d7278">Unsubscribe from daily briefs</a>
    </div>
  </div>
</body></html>`.trim()
}

export function renderBriefEmailText(brief) {
  const lines = []
  lines.push(`NIGHTWATCH 02:00 — ${brief.date}`)
  lines.push('')
  lines.push(`Equities avg 24h: ${(brief.marketSummary?.equityAvgChange24h ?? 0).toFixed(2)}%`)
  lines.push(`Breadth: ${(brief.marketSummary?.breadth ?? 0).toFixed(2)}`)
  lines.push(`Coverage: ${brief.coverage?.live}/${brief.coverage?.total} live`)
  lines.push('')
  if (brief.unusualMovements?.length) {
    lines.push('Unusual movements:')
    for (const u of brief.unusualMovements.slice(0, 5)) {
      lines.push(`- ${u.symbol} (${u.sector}) ${u.change24h >= 0 ? '+' : ''}${u.change24h.toFixed(2)}% · ${u.drivers.join(' · ')}`)
    }
    lines.push('')
  }
  lines.push('Alpha candidates:')
  for (const c of (brief.alphaCandidates || []).slice(0, 5)) {
    const sig = c.report?.signal || {}
    lines.push(`- ${c.symbol} (${c.sector}) · ${sig.direction || 'FLAT'} · net edge ${sig.netEdge != null ? fmtPct(sig.netEdge) : '—'}`)
    if (thesisText(c.report?.shortTermThesis)) lines.push(`    short: ${thesisText(c.report.shortTermThesis)}`)
    if (thesisText(c.report?.longTermThesis))  lines.push(`    long : ${thesisText(c.report.longTermThesis)}`)
  }
  lines.push('')
  lines.push(brief.disclaimer)
  lines.push(`Open: ${APP_URL()}/#nightwatch02`)
  return lines.join('\n')
}

/* -------------------------------------------------- delivery */

export async function emailSubscribers(brief) {
  const subs = listActiveSubscribers()
  if (!subs.length) return { total: 0, delivered: 0, failed: 0, results: [] }
  // Render per-subscriber so each email carries its own unsubscribe token.
  const results = []
  let delivered = 0, failed = 0
  for (const s of subs) {
    const html = renderBriefEmailHtml(brief, s)
    const text = renderBriefEmailText(brief)
    // sendBatch expects same-html for all; do it one at a time to preserve token.
    // eslint-disable-next-line no-await-in-loop
    const { results: r } = await sendBatch({
      recipients: [s.email],
      subject: `NIGHTWATCH 02:00 · ${brief.date}`,
      html, text,
    })
    results.push(...r)
    delivered += r.filter(x => x.delivered).length
    failed    += r.filter(x => !x.delivered).length
  }
  logger.info({ brief: brief.id, subs: subs.length, delivered, failed }, 'nightwatch02 emails dispatched')
  return { total: subs.length, delivered, failed, results }
}

/**
 * Full pipeline: generate the brief then email it. Errors in email don't roll
 * back the brief — the brief stays on disk and the UI serves it either way.
 */
export async function runDailyPipeline({ newsStore, engine, now = new Date() } = {}) {
  const brief = await generateBrief({ newsStore, engine, now })
  let email = { total: 0, delivered: 0, failed: 0, results: [] }
  try { email = await emailSubscribers(brief) } catch (err) { logger.warn({ err: err.message }, 'nightwatch02 email failed') }
  return { brief, email }
}

export const _paths = { DIR, LATEST_FILE, BRIEFS_DIR }
