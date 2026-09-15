/**
 * Downloadable research card.
 *
 * Renders a professional research-note card as an SVG that the user can
 * download as a PNG (for Slack/Discord/Twitter) or SVG (crisp, printable).
 *
 * The card shows:
 *   - NIGHTWATCH brand + logo
 *   - Symbol, verdict pill, price/direction line
 *   - Short-term thesis (hours to days)
 *   - Long-term thesis (weeks to months)
 *   - Compact plan grid: entry / stop / target / size / R:R
 *   - Report ID + issued timestamp + disclaimer footer
 *
 * Both thesis fields are provided by the server; a deterministic fallback is
 * used if the LLM narration didn't return them.
 */
import React, { useMemo, useRef, useState } from 'react'
import { Download, FileImage, ImageDown, Loader2 } from 'lucide-react'
import { fmtPct, fmtPrice } from '../domain.js'

// A small helper that pretty-prints a report signal into a colored verdict.
function verdictOf(report) {
  const s = report.signal
  if (s.status === 'NO_TRADE') return { label: 'SIT OUT', fill: '#a5232a', bg: 'rgba(165,35,42,0.10)' }
  if (s.direction === 'LONG')   return { label: 'LONG',    fill: '#0b6f47', bg: 'rgba(11,111,71,0.10)' }
  if (s.direction === 'SHORT')  return { label: 'SHORT',   fill: '#a37528', bg: 'rgba(163,117,40,0.10)' }
  return { label: s.direction || '—', fill: '#5f6d61', bg: 'rgba(95,109,97,0.10)' }
}

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// Word-wrap a string to N chars, returns array of lines (max `maxLines`)
function wrapText(str, maxChars, maxLines = 3) {
  const words = String(str || '').split(/\s+/)
  const lines = []
  let line = ''
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars) {
      if (line) lines.push(line)
      line = w
      if (lines.length === maxLines - 1) break
    } else {
      line = (line ? line + ' ' : '') + w
    }
  }
  if (line && lines.length < maxLines) lines.push(line)
  // If the input still has more content, ellipsize last line
  const remaining = words.slice(lines.join(' ').split(/\s+/).length).join(' ')
  if (remaining && lines.length === maxLines) {
    const last = lines[lines.length - 1]
    lines[lines.length - 1] = (last.length > maxChars - 1 ? last.slice(0, maxChars - 1) : last) + '…'
  }
  return lines
}

export function buildResearchCardSvg(report) {
  const s = report.signal
  const v = verdictOf(report)
  const sug = report.suggestion
  const th = report.thesis || {}
  const short = th.short || (s.catalyst ? `Near term: ${s.catalyst}` : 'No short-term catalyst on file.')
  const long  = th.long  || 'Multi-week: watch macro regime and structural drivers; invalidate against the levels listed.'
  const shortLines = wrapText(short, 78, 3)
  const longLines  = wrapText(long, 78, 3)
  const issued = new Date(report.createdAt || Date.now()).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  const price = sug?.entry ?? report.currentPrice ?? report.price ?? null
  const rr    = sug?.riskReward ?? null

  const W = 1200, H = 800
  const CREAM = '#efe8d5', INK = '#0d1f16', LINE = '#123528', SOFT = 'rgba(18,53,40,0.18)', MUTED = '#5f6d61', GILT = '#a37528', UP = '#0b6f47', DOWN = '#a5232a'

  // Small helper for a labeled metric cell inside the plan grid
  const cell = (x, y, w, h, label, value, tone = INK) => `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${SOFT}" stroke-width="1"/>
    <text x="${x + 16}" y="${y + 26}" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="10" font-weight="600" letter-spacing="1.4" fill="${MUTED}">${escapeXml(label.toUpperCase())}</text>
    <text x="${x + 16}" y="${y + 58}" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="22" font-weight="600" fill="${tone}">${escapeXml(value)}</text>
  `

  const planW = W - 80
  const planX = 40
  const planY = 540
  const cellW = planW / 5
  const planH = 88

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${CREAM}"/>
  <rect x="12" y="12" width="${W-24}" height="${H-24}" fill="none" stroke="${LINE}" stroke-width="3"/>
  <rect x="20" y="20" width="${W-40}" height="${H-40}" fill="none" stroke="${LINE}" stroke-width="1" opacity="0.4"/>

  <!-- Header: brand + issued -->
  <g transform="translate(40 40)">
    <rect x="0" y="0" width="52" height="52" fill="${LINE}" rx="4"/>
    <mask id="crescent-card">
      <rect width="52" height="52" fill="white"/>
      <circle cx="34" cy="20" r="14" fill="black"/>
    </mask>
    <circle cx="24" cy="28" r="14.5" fill="${CREAM}" mask="url(#crescent-card)"/>
    <path d="M38 15 L38.75 16.75 L40.5 17.5 L38.75 18.25 L38 20 L37.25 18.25 L35.5 17.5 L37.25 16.75 Z" fill="${GILT}"/>
    <text x="70" y="24" font-family="DM Serif Display, Georgia, serif" font-size="26" fill="${INK}">NIGHTWATCH <tspan fill="${DOWN}" font-style="italic">AI</tspan></text>
    <text x="70" y="44" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="10" letter-spacing="1.6" fill="${MUTED}">AI TRADING DESK  ·  RESEARCH NOTE</text>
  </g>
  <text x="${W-40}" y="52" text-anchor="end" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="11" letter-spacing="1.4" fill="${MUTED}">ISSUED  ${escapeXml(issued)}</text>
  <text x="${W-40}" y="72" text-anchor="end" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="10" letter-spacing="1" fill="${MUTED}">${escapeXml((report.id || '').toUpperCase())}</text>

  <line x1="40" y1="110" x2="${W-40}" y2="110" stroke="${SOFT}" stroke-width="1"/>

  <!-- Symbol row -->
  <text x="40" y="180" font-family="DM Serif Display, Georgia, serif" font-size="72" fill="${INK}">${escapeXml(report.symbol)}</text>
  <text x="40" y="215" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="12" letter-spacing="1.2" fill="${MUTED}">${escapeXml((report.name || report.symbol).toUpperCase())}  ·  BITGET SPOT${price ? '  ·  $' + escapeXml(fmtPrice(price)) : ''}</text>

  <!-- Verdict pill -->
  <g transform="translate(${W-40} 145)">
    <rect x="-220" y="0" width="220" height="52" rx="2" fill="${v.bg}" stroke="${v.fill}" stroke-width="1.5"/>
    <text x="-110" y="34" text-anchor="middle" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="20" font-weight="700" letter-spacing="2" fill="${v.fill}">${escapeXml(v.label)}</text>
  </g>
  <text x="${W-40}" y="220" text-anchor="end" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="13" fill="${MUTED}">${(s.confidence * 100).toFixed(0)}% conf  ·  net edge ${escapeXml(fmtPct(s.netEdge))}  ·  ${escapeXml((s.horizon || '').toLowerCase().replace(/_/g, ' '))}</text>

  <!-- Short-term thesis -->
  <g transform="translate(40 265)">
    <text x="0" y="0" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="11" font-weight="700" letter-spacing="1.8" fill="${DOWN}">SHORT-TERM  ·  HOURS TO DAYS</text>
    ${shortLines.map((ln, i) => `<text x="0" y="${28 + i * 26}" font-family="DM Sans, sans-serif" font-size="18" fill="${INK}">${escapeXml(ln)}</text>`).join('')}
  </g>

  <!-- Long-term thesis -->
  <g transform="translate(40 ${265 + 40 + shortLines.length * 26 + 20})">
    <text x="0" y="0" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="11" font-weight="700" letter-spacing="1.8" fill="${UP}">LONG-TERM  ·  WEEKS TO MONTHS</text>
    ${longLines.map((ln, i) => `<text x="0" y="${28 + i * 26}" font-family="DM Sans, sans-serif" font-size="18" fill="${INK}">${escapeXml(ln)}</text>`).join('')}
  </g>

  <!-- Plan grid -->
  <g transform="translate(0 0)">
    <text x="40" y="522" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="11" font-weight="700" letter-spacing="1.8" fill="${MUTED}">${sug ? 'EXECUTION PLAN  ·  YOU DECIDE' : 'NO EXECUTION SUGGESTED'}</text>
    <rect x="${planX}" y="${planY}" width="${planW}" height="${planH}" fill="rgba(18,53,40,0.03)" stroke="${SOFT}"/>
    ${sug ? `
      ${cell(planX + 0 * cellW, planY, cellW, planH, 'Direction', s.direction || '—')}
      ${cell(planX + 1 * cellW, planY, cellW, planH, 'Entry', '$' + fmtPrice(sug.entry))}
      ${cell(planX + 2 * cellW, planY, cellW, planH, 'Stop', '$' + fmtPrice(sug.stop), DOWN)}
      ${cell(planX + 3 * cellW, planY, cellW, planH, 'Target', '$' + fmtPrice(sug.target), UP)}
      ${cell(planX + 4 * cellW, planY, cellW, planH, 'R:R', rr != null ? String(rr) : '—')}
    ` : `
      <text x="${planX + planW / 2}" y="${planY + planH / 2 + 8}" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="16" fill="${MUTED}">${escapeXml(s.reason || 'Signal did not clear the required net-edge floor.')}</text>
    `}
  </g>

  <!-- Invalidation strip -->
  ${report.invalidation?.price ? `
    <g transform="translate(40 ${planY + planH + 30})">
      <text x="0" y="0" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="11" font-weight="700" letter-spacing="1.8" fill="${MUTED}">INVALIDATION</text>
      <text x="0" y="24" font-family="DM Sans, sans-serif" font-size="16" fill="${INK}">Invalidate at $${escapeXml(fmtPrice(report.invalidation.price))}. ${escapeXml((report.invalidation.conditions || []).slice(0, 2).join(' · '))}</text>
    </g>
  ` : ''}

  <!-- Footer -->
  <line x1="40" y1="${H-70}" x2="${W-40}" y2="${H-70}" stroke="${SOFT}" stroke-width="1"/>
  <text x="40" y="${H-45}" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="10" letter-spacing="1.1" fill="${MUTED}">nightwatchai.watch  ·  Research tool, not a broker  ·  Analysis is informational only  ·  Not investment advice</text>
  <text x="${W-40}" y="${H-45}" text-anchor="end" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="10" letter-spacing="1.1" fill="${MUTED}">Engine: ${escapeXml((report.engine || 'LOCAL').toUpperCase())}  ·  Data: BITGET LIVE</text>
</svg>`
}

function downloadFile(name, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function svgToPngBlob(svg, scale = 2) {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  try {
    const img = new Image()
    img.decoding = 'sync'
    img.crossOrigin = 'anonymous'
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = () => reject(new Error('svg → image decode failed'))
      img.src = url
    })
    const W = 1200 * scale, H = 800 * scale
    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, W, H)
    return await new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('canvas toBlob failed')), 'image/png', 0.95)
    })
  } finally { URL.revokeObjectURL(url) }
}

export function ResearchCardActions({ report }) {
  const [busy, setBusy] = useState(null)
  const svg = useMemo(() => buildResearchCardSvg(report), [report?.id])
  const safeName = `nightwatch-${(report.symbol || 'REPORT').toLowerCase()}-${(report.id || Date.now().toString(36)).slice(-8)}`

  const downloadPng = async () => {
    if (busy) return
    setBusy('png')
    try {
      const blob = await svgToPngBlob(svg, 2)
      downloadFile(`${safeName}.png`, blob)
    } catch (e) {
      // Fallback: give the SVG since PNG rendering failed
      downloadFile(`${safeName}.svg`, new Blob([svg], { type: 'image/svg+xml' }))
    } finally { setBusy(null) }
  }
  const downloadSvg = () => {
    downloadFile(`${safeName}.svg`, new Blob([svg], { type: 'image/svg+xml' }))
  }

  return (
    <div className="card-download-actions">
      <div className="card-download-preview" dangerouslySetInnerHTML={{ __html: svg }} aria-label="Research card preview" />
      <div className="card-download-buttons">
        <button className="btn primary" onClick={downloadPng} disabled={busy === 'png'}>
          {busy === 'png' ? <><Loader2 size={13} className="spin" /> Rendering…</> : <><ImageDown size={13} /> Download PNG</>}
        </button>
        <button className="btn ghost" onClick={downloadSvg}>
          <FileImage size={13} /> Download SVG
        </button>
        <span className="card-download-hint">Share on Slack, Discord or X — the card includes the verdict, plan, both thesis horizons and full disclaimer.</span>
      </div>
    </div>
  )
}
