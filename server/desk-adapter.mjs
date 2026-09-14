#!/usr/bin/env node
/**
 * NIGHTWATCH AI — server-side research adapter.
 *
 *   POST /research       — runs the local NightwatchEngine and optionally rewrites
 *                          narration via xAI / Anthropic / OpenAI (keys stay here,
 *                          never in the browser).
 *   GET  /bitget/status  — probes the Bitget Agent Hub MCP sidecar for the
 *                          5 official `bitget-signal` skills. Best-effort.
 *   GET  /health         — adapter health check.
 *
 * Environment variables (all optional):
 *
 *   PORT                Listener port (default 8787)
 *   XAI_API_KEY         xAI key for grok narration rewriting
 *   ANTHROPIC_API_KEY   Anthropic key for Claude narration rewriting
 *   OPENAI_API_KEY      OpenAI key for GPT narration rewriting
 *   BITGET_MCP_URL      Bitget Agent Hub MCP sidecar URL, e.g. http://127.0.0.1:9091
 *
 * Point the SPA at this process with `VITE_AGENT_API_URL=http://127.0.0.1:8787`.
 */
import http from 'node:http'
import { LocalNightwatchEngine, DEMO_UNIVERSE } from '../src/domain.js'

const PORT              = Number(process.env.PORT || 8787)
const XAI_KEY           = process.env.XAI_API_KEY
const XAI_BASE          = process.env.XAI_BASE_URL || 'https://api.x.ai/v1'
const XAI_MODEL         = process.env.XAI_MODEL || 'grok-4-fast'
const ANTHROPIC_KEY     = process.env.ANTHROPIC_API_KEY
const ANTHROPIC_MODEL   = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'
const OPENAI_KEY        = process.env.OPENAI_API_KEY
const OPENAI_MODEL      = process.env.OPENAI_MODEL || 'gpt-5'
const BITGET_MCP_URL    = process.env.BITGET_MCP_URL || ''

const engine = new LocalNightwatchEngine()

/* --------------------------------------------------- HTTP helpers */

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
}
function json(res, status, body) {
  cors(res)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
async function readJson(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { throw new Error('invalid json') }
}

/* --------------------------------------------------- LLM narration rewrite */

async function rewriteWithXai(prompt) {
  const response = await fetch(`${XAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${XAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: XAI_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(9000),
  })
  if (!response.ok) throw new Error(`xAI ${response.status}`)
  const body = await response.json()
  return JSON.parse(body.choices?.[0]?.message?.content || '{}')
}

async function rewriteWithAnthropic(prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 800,
      temperature: 0.2,
      messages: [{ role: 'user', content: `${prompt}\n\nReturn ONLY a JSON object.` }],
    }),
    signal: AbortSignal.timeout(9000),
  })
  if (!response.ok) throw new Error(`Anthropic ${response.status}`)
  const body = await response.json()
  const text = body.content?.[0]?.text || '{}'
  const match = text.match(/\{[\s\S]*\}/)
  return match ? JSON.parse(match[0]) : {}
}

async function rewriteWithOpenAi(prompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(9000),
  })
  if (!response.ok) throw new Error(`OpenAI ${response.status}`)
  const body = await response.json()
  return JSON.parse(body.choices?.[0]?.message?.content || '{}')
}

async function rewriteReport(artifact, question) {
  if (!artifact?.report) return { artifact, engine: 'LOCAL' }
  const r = artifact.report
  const prompt = `You are NIGHTWATCH AI, a professional trading research desk. Rewrite these fields in crisp, professional trader English. Do NOT change any numbers, tickers, verdicts, or invalidation prices. Return JSON: {"summary": string, "reasoning": string}.

Question: ${question || ''}
Symbol: ${r.symbol}
Direction: ${r.signal.direction} · confidence ${(r.signal.confidence * 100).toFixed(0)}%
Net edge: ${(r.signal.netEdge * 100).toFixed(2)}%
Original summary: ${r.summary}
Original reasoning: ${r.signal.reason}`

  const tryOne = async (fn, label) => {
    try {
      const out = await fn(prompt)
      const next = structuredClone(artifact)
      if (out.summary)   next.report.summary       = String(out.summary).slice(0, 800)
      if (out.reasoning) next.report.signal.reason = String(out.reasoning).slice(0, 500)
      return { artifact: next, engine: label }
    } catch { return null }
  }

  if (XAI_KEY)       { const r1 = await tryOne(rewriteWithXai,       'XAI');       if (r1) return r1 }
  if (ANTHROPIC_KEY) { const r2 = await tryOne(rewriteWithAnthropic, 'ANTHROPIC'); if (r2) return r2 }
  if (OPENAI_KEY)    { const r3 = await tryOne(rewriteWithOpenAi,    'OPENAI');    if (r3) return r3 }
  return { artifact, engine: 'LOCAL' }
}

/* --------------------------------------------------- Bitget MCP probe */

async function probeBitget() {
  if (!BITGET_MCP_URL) return {
    connected: false, model: null, skills: [],
    reason: 'BITGET_MCP_URL not set. Install the Bitget Agent Hub, run `bgc discover`, and set BITGET_MCP_URL to the MCP sidecar to enable live bitget-signal skills.'
  }
  try {
    const response = await fetch(`${BITGET_MCP_URL.replace(/\/$/, '')}/skills`, { signal: AbortSignal.timeout(2500) })
    if (!response.ok) return { connected: false, model: null, skills: [], reason: `MCP returned ${response.status}` }
    const body = await response.json()
    const skills = Array.isArray(body?.skills) ? body.skills.map(s => s.id || s.name) : []
    return { connected: true, model: body?.provider || 'bitget-signal', skills, reason: `${skills.length} bitget-signal skills reachable` }
  } catch (err) {
    return { connected: false, model: null, skills: [], reason: err.message }
  }
}

/* --------------------------------------------------- Request handler */

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return }

  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, {
      ok: true,
      llm: XAI_KEY ? 'xai' : ANTHROPIC_KEY ? 'anthropic' : OPENAI_KEY ? 'openai' : 'off',
      model: XAI_KEY ? XAI_MODEL : ANTHROPIC_KEY ? ANTHROPIC_MODEL : OPENAI_KEY ? OPENAI_MODEL : null,
      bitgetMcpUrl: BITGET_MCP_URL || null,
      universeSize: DEMO_UNIVERSE.length,
    })
  }

  if (req.method === 'GET' && req.url === '/bitget/status') {
    const status = await probeBitget()
    return json(res, 200, status)
  }

  if (req.method === 'POST' && (req.url === '/research' || req.url === '/desk')) {
    let request
    try { request = await readJson(req) } catch { return json(res, 400, { error: 'invalid json' }) }
    try {
      const artifact = await engine.run(request)
      const { artifact: rewritten, engine: engineName } = await rewriteReport(artifact, request.question || request.thesis)
      const bitget = await probeBitget()
      return json(res, 200, { intent: request.intent, engine: engineName, bitgetLive: bitget.connected, artifact: rewritten })
    } catch (err) {
      return json(res, 500, { error: err.message })
    }
  }

  return json(res, 404, { error: 'not found' })
})

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`NIGHTWATCH AI adapter · http://127.0.0.1:${PORT}
  narration:  ${XAI_KEY ? 'xAI ' + XAI_MODEL : ANTHROPIC_KEY ? 'Anthropic ' + ANTHROPIC_MODEL : OPENAI_KEY ? 'OpenAI ' + OPENAI_MODEL : 'off (local skills only)'}
  bitget MCP: ${BITGET_MCP_URL || 'not set — set BITGET_MCP_URL to enable live bitget-signal proxy'}
`)
})
