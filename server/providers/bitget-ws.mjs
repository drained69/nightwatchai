/**
 * Bitget public WebSocket client.
 *
 * Streams live spot ticker updates for every mapped pair (crypto majors +
 * tokenized U.S. equities). Replaces the 10s REST poll with tick-level updates
 * whenever WS is connected. REST remains the source of truth on cold boot and
 * during WS reconnects — the two paths share the same {getWsTicker,
 * getAllWsTickers} shape so the adapter can flip between them transparently.
 *
 * Bitget v2 public WS spec (docs.bitget.com/api-doc/spot/websocket/public):
 *   URL:         wss://ws.bitget.com/v2/ws/public
 *   Op:          {op: "subscribe", args: [{instType:"SPOT", channel:"ticker", instId:"BTCUSDT"}, …]}
 *   Heartbeat:   send string "ping" every 20s, expect string "pong"
 *   Data frame:  {action:"snapshot"|"update", arg:{instType,channel,instId}, data:[{...}], ts}
 *   Rate limit:  max 240 msgs / hour on op requests
 */

import { WebSocket } from 'ws'
import { SYMBOL_MAP } from './bitget.mjs'
import { logger } from '../lib/log.mjs'

const WS_URL = process.env.BITGET_WS_URL || 'wss://ws.bitget.com/v2/ws/public'
const HEARTBEAT_MS = Number(process.env.BITGET_WS_HEARTBEAT_MS || 20_000)
const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 30_000

/** pair (BTCUSDT/RNVDAUSDT) → last tick object (same shape as REST getTicker) */
const wsCache = new Map()

/** universe ticker (BTC/NVDA) → pair reverse index */
const universeIndex = new Map()
for (const [sym, pair] of SYMBOL_MAP) universeIndex.set(pair, sym)

let ws = null
let heartbeatTimer = null
let reconnectTimer = null
let reconnectDelayMs = RECONNECT_MIN_MS
let msgCount = 0
let lastConnectAt = 0
let lastMessageAt = 0
let subscribedPairs = new Set()

function clearTimers() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
}

function scheduleReconnect() {
  clearTimers()
  reconnectTimer = setTimeout(connect, reconnectDelayMs)
  reconnectDelayMs = Math.min(RECONNECT_MAX_MS, reconnectDelayMs * 2)
}

function connect() {
  clearTimers()
  try {
    ws = new WebSocket(WS_URL, {
      handshakeTimeout: 10_000,
      headers: { 'User-Agent': 'Mozilla/5.0 NightwatchAI/1.2 (research; +https://nightwatchai.watch)' },
    })
  } catch (err) {
    logger.warn({ err: err.message }, 'bitget-ws: constructor failed, retrying')
    scheduleReconnect()
    return
  }

  ws.on('open', () => {
    lastConnectAt = Date.now()
    reconnectDelayMs = RECONNECT_MIN_MS
    logger.info({ url: WS_URL }, 'bitget-ws: connected')
    // Subscribe to ticker for every mapped pair.
    const args = []
    subscribedPairs = new Set()
    for (const [, pair] of SYMBOL_MAP) {
      args.push({ instType: 'SPOT', channel: 'ticker', instId: pair })
      subscribedPairs.add(pair)
    }
    // Bitget accepts up to 50 args per op; batch conservatively.
    const CHUNK = 20
    for (let i = 0; i < args.length; i += CHUNK) {
      ws.send(JSON.stringify({ op: 'subscribe', args: args.slice(i, i + CHUNK) }))
    }
    // Heartbeat: plain "ping" string per Bitget spec.
    heartbeatTimer = setInterval(() => {
      try { if (ws?.readyState === WebSocket.OPEN) ws.send('ping') } catch { /* fatal fires close handler */ }
    }, HEARTBEAT_MS)
  })

  ws.on('message', (raw) => {
    lastMessageAt = Date.now()
    msgCount++
    // Heartbeat reply is the plain string "pong".
    const text = raw.toString()
    if (text === 'pong') return
    let msg
    try { msg = JSON.parse(text) } catch { return }
    if (msg?.event === 'subscribe' || msg?.event === 'error') {
      if (msg.event === 'error') logger.warn({ code: msg.code, msg: msg.msg }, 'bitget-ws: op error')
      return
    }
    // Ticker frame → cache single record per pair.
    if (msg?.arg?.channel === 'ticker' && Array.isArray(msg?.data)) {
      for (const row of msg.data) {
        const pair = row.instId
        const symbol = universeIndex.get(pair)
        if (!symbol) continue
        const bidPr = row.bidPr != null ? Number(row.bidPr) : null
        const askPr = row.askPr != null ? Number(row.askPr) : null
        const value = {
          symbol, pair,
          last:          Number(row.lastPr),
          open24h:       Number(row.open24h ?? row.open ?? row.lastPr),
          high24h:       Number(row.high24h),
          low24h:        Number(row.low24h),
          bidPrice:      bidPr,
          askPrice:      askPr,
          volumeUsd24h:  Number(row.quoteVolume ?? row.usdtVol ?? 0),
          baseVolume24h: Number(row.baseVolume ?? row.baseVol ?? 0),
          changePct24h:  Number(row.change24h) * 100,
          spreadBps:     bidPr && askPr ? ((askPr - bidPr) / askPr) * 10000 : null,
          ts:            Number(row.ts ?? msg.ts ?? Date.now()),
          source:        'bitget-public-ws',
          live:          true,
        }
        wsCache.set(pair, value)
      }
    }
  })

  ws.on('close', (code, reason) => {
    logger.warn({ code, reason: String(reason).slice(0, 80) }, 'bitget-ws: closed, reconnecting')
    scheduleReconnect()
  })

  ws.on('error', (err) => {
    logger.warn({ err: err.message }, 'bitget-ws: error')
    try { ws?.close() } catch { /* ignore */ }
  })
}

/** Start the WS client (idempotent). */
export function startBitgetWs() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  connect()
}

/** Stop the WS client and cancel reconnects (used by SIGTERM). */
export function stopBitgetWs() {
  clearTimers()
  try { ws?.removeAllListeners(); ws?.close() } catch { /* ignore */ }
  ws = null
}

/**
 * Return the last WS-observed ticker for `symbol` (BTC/NVDA/…), or null.
 * Freshness gate: results older than `maxAgeMs` are treated as absent so
 * callers fall back to REST rather than serving arbitrarily-old ticks.
 */
export function getWsTicker(symbol, { maxAgeMs = 30_000 } = {}) {
  const pair = SYMBOL_MAP.get(String(symbol || '').toUpperCase())
  if (!pair) return null
  const hit = wsCache.get(pair)
  if (!hit) return null
  if (Date.now() - hit.ts > maxAgeMs) return null
  return hit
}

/** Return all cached WS tickers as { SYMBOL: tick, … }. Filters stale entries. */
export function getAllWsTickers({ maxAgeMs = 30_000 } = {}) {
  const now = Date.now()
  const out = {}
  for (const [symbol, pair] of SYMBOL_MAP) {
    const hit = wsCache.get(pair)
    if (!hit) continue
    if (now - hit.ts > maxAgeMs) continue
    out[symbol] = hit
  }
  return out
}

/** Diagnostics for /health and /bitget/ws-status. */
export function getWsStatus() {
  return {
    connected:   ws?.readyState === WebSocket.OPEN,
    readyState:  ws?.readyState ?? null,
    url:         WS_URL,
    subscribed:  subscribedPairs.size,
    cachedPairs: wsCache.size,
    msgCount,
    lastConnectAt: lastConnectAt || null,
    lastMessageAt: lastMessageAt || null,
    ageMs:       lastMessageAt ? Date.now() - lastMessageAt : null,
  }
}
