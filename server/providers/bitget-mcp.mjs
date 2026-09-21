/**
 * Bitget Signal MCP client.
 *
 * Speaks Model Context Protocol (Streamable HTTP transport) to Bitget's
 * hosted signal MCP server — the one the official `@bitget-ai/bitget-signal`
 * package registers into Claude Code / Codex / OpenClaw. Default endpoint is
 * `https://datahub.noxiaohao.com/mcp` (Bitget's own datahub); override with
 * BITGET_MCP_URL if you run a private sidecar.
 *
 * Handles:
 *   - MCP handshake (initialize → notifications/initialized)
 *   - Streamable-HTTP session ID (mcp-session-id header)
 *   - SSE-framed responses (event: message / data: {...})
 *   - Auto-reconnect on session expiry
 *   - tools/list and tools/call
 *
 * Docs: modelcontextprotocol.io/specification/basic/transports#streamable-http
 */

import { logger } from '../lib/log.mjs'

const MCP_URL = process.env.BITGET_MCP_URL || 'https://datahub.noxiaohao.com/mcp'
const MCP_ENABLED = process.env.BITGET_MCP_ENABLED !== '0'
const HANDSHAKE_TIMEOUT_MS = Number(process.env.BITGET_MCP_HANDSHAKE_TIMEOUT_MS || 12_000)
const CALL_TIMEOUT_MS      = Number(process.env.BITGET_MCP_CALL_TIMEOUT_MS      || 30_000)
const REFRESH_INTERVAL_MS  = Number(process.env.BITGET_MCP_REFRESH_MS           || 15 * 60_000)

const CLIENT_INFO = { name: 'nightwatch-ai', version: '1.2.0' }
const PROTOCOL_VERSION = '2025-06-18'

/** Persistent session state — one shared client for the whole process. */
const state = {
  sessionId: null,
  serverInfo: null,      // { name, version }
  tools: [],             // [{ name, description, inputSchema }]
  connectedAt: null,
  lastHandshakeError: null,
  lastCallAt: null,
  nextRequestId: 100,
  refreshTimer: null,
}

/** Parse an SSE-framed body — MCP HTTP responses come back as `event: message\n\ndata: {...}`. */
function parseSse(text) {
  if (!text) return null
  const lines = text.split(/\r?\n/)
  const dataLines = []
  for (const line of lines) {
    if (line.startsWith('data: ')) dataLines.push(line.slice(6))
  }
  if (!dataLines.length) {
    // Some servers return raw JSON — try that as a fallback.
    try { return JSON.parse(text) } catch { return null }
  }
  try { return JSON.parse(dataLines.join('\n')) } catch { return null }
}

/** POST an MCP JSON-RPC message. Returns the parsed JSON body + session id header. */
async function post(body, { sessionId = null, timeoutMs = CALL_TIMEOUT_MS } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept':       'application/json, text/event-stream',
    'User-Agent':   'NightwatchAI/1.2 mcp-client',
  }
  if (sessionId) headers['mcp-session-id'] = sessionId
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  const returnedSid = res.headers.get('mcp-session-id')
  const parsed = parseSse(text)
  return { ok: res.ok, status: res.status, body: parsed, sessionId: returnedSid || sessionId }
}

async function handshake() {
  state.lastHandshakeError = null
  const init = await post({
    jsonrpc: '2.0',
    id: state.nextRequestId++,
    method: 'initialize',
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
  }, { timeoutMs: HANDSHAKE_TIMEOUT_MS })

  if (!init.ok || !init.body?.result) {
    const err = init.body?.error?.message || `HTTP ${init.status}`
    state.lastHandshakeError = err
    throw new Error(`MCP initialize failed: ${err}`)
  }
  state.sessionId = init.sessionId
  state.serverInfo = init.body.result.serverInfo || null

  // Notify initialized — server needs this before tools/list is allowed.
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { sessionId: state.sessionId, timeoutMs: HANDSHAKE_TIMEOUT_MS })

  const list = await post({
    jsonrpc: '2.0',
    id: state.nextRequestId++,
    method: 'tools/list',
  }, { sessionId: state.sessionId, timeoutMs: HANDSHAKE_TIMEOUT_MS })

  if (!list.ok || !list.body?.result?.tools) {
    const err = list.body?.error?.message || `HTTP ${list.status}`
    state.lastHandshakeError = err
    throw new Error(`MCP tools/list failed: ${err}`)
  }
  state.tools = list.body.result.tools
  state.connectedAt = Date.now()
  logger.info({
    server: state.serverInfo?.name,
    version: state.serverInfo?.version,
    tools: state.tools.length,
  }, 'bitget-mcp: connected')
}

/** Ensure we have a live MCP session; handshake if not. */
async function ensureSession() {
  if (state.sessionId && state.tools.length > 0) return true
  try { await handshake(); return true }
  catch (err) { logger.warn({ err: err.message, url: MCP_URL }, 'bitget-mcp: handshake failed'); return false }
}

/** Start the MCP client (fire-and-forget handshake + periodic refresh). */
export function startBitgetMcp() {
  if (!MCP_ENABLED) { logger.info('bitget-mcp: disabled via BITGET_MCP_ENABLED=0'); return }
  ensureSession()
  // Refresh session periodically so an idle timeout on the server side doesn't
  // silently invalidate us; also keeps the tool list current if Bitget adds/removes tools.
  if (state.refreshTimer) clearInterval(state.refreshTimer)
  state.refreshTimer = setInterval(() => {
    state.sessionId = null
    ensureSession()
  }, REFRESH_INTERVAL_MS)
  state.refreshTimer.unref?.()
}

export function stopBitgetMcp() {
  if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null }
  state.sessionId = null
}

/** Invoke a tool by name. Returns { ok, result, error }. */
export async function callMcpTool(name, args = {}) {
  if (!MCP_ENABLED) return { ok: false, error: 'MCP disabled' }
  if (!(await ensureSession())) return { ok: false, error: state.lastHandshakeError || 'no session' }
  const res = await post({
    jsonrpc: '2.0',
    id: state.nextRequestId++,
    method: 'tools/call',
    params: { name, arguments: args },
  }, { sessionId: state.sessionId })
  state.lastCallAt = Date.now()
  if (!res.ok || res.body?.error) {
    const err = res.body?.error?.message || `HTTP ${res.status}`
    // Session may have expired — invalidate so the next call re-handshakes.
    if (res.status === 400 || res.status === 404) state.sessionId = null
    return { ok: false, error: err }
  }
  return { ok: true, result: res.body?.result || null }
}

/** Return the current tool catalog (empty if not yet connected). */
export function listMcpTools() {
  return state.tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }))
}

/** Diagnostics for /bitget/status and the UI. */
export function mcpStatus() {
  return {
    enabled:     MCP_ENABLED,
    url:         MCP_URL,
    connected:   Boolean(state.sessionId && state.tools.length > 0),
    server:      state.serverInfo?.name || null,
    version:     state.serverInfo?.version || null,
    tools:       state.tools.length,
    toolNames:   state.tools.map(t => t.name),
    connectedAt: state.connectedAt,
    lastCallAt:  state.lastCallAt,
    lastError:   state.lastHandshakeError,
  }
}
