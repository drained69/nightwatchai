/**
 * Minimal Server-Sent Events bus.
 * Callers pass an http.ServerResponse; we set headers and register a subscriber.
 * Emit events with `bus.emit({ type, data })`.
 */
import { logger } from './log.mjs'

export function makeSseBus(name = 'sse') {
  /** @type {Set<{res: import('http').ServerResponse, filter: (ev: any) => boolean}>} */
  const clients = new Set()

  function subscribe(res, { filter = () => true, keepAliveMs = 25_000 } = {}) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    })
    // Initial retry hint + open event
    res.write('retry: 5000\n\n')
    res.write(`event: open\ndata: ${JSON.stringify({ stream: name, at: Date.now() })}\n\n`)
    const entry = { res, filter }
    clients.add(entry)
    const ping = setInterval(() => { try { res.write(': keep-alive\n\n') } catch { /* client disconnected */ } }, keepAliveMs)
    ping.unref?.()
    const close = () => { clients.delete(entry); clearInterval(ping); try { res.end() } catch { /* already ended */ } }
    res.on('close', close)
    res.on('error', close)
    logger.debug({ name, clients: clients.size }, 'sse subscribed')
    return close
  }

  function emit(event) {
    const payload = `event: ${event.type || 'message'}\ndata: ${JSON.stringify(event.data ?? {})}\n\n`
    for (const client of clients) {
      if (!client.filter(event)) continue
      try { client.res.write(payload) } catch { clients.delete(client) }
    }
  }

  function size() { return clients.size }

  return { subscribe, emit, size }
}
