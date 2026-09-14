#!/usr/bin/env node
/**
 * NIGHTWATCH AI · combined static + API server for production.
 *
 * Mounts:
 *   - Static SPA from ./dist  (SPA fallback for client-side routing)
 *   - API routes from server/adapter.mjs on the same origin
 *
 * This is what runs inside the Docker image. In development we still use
 * `vite` + `npm run server` on separate ports; VITE_AGENT_API_URL points
 * the SPA at the API in that mode.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { logger } from './lib/log.mjs'

// Boot the API adapter (registers its own server) — but we take over the port
// by wrapping its handler here instead.
process.env.PORT ??= '8787'
process.env.HOST ??= '0.0.0.0'

const PORT = Number(process.env.PORT)
const HOST = process.env.HOST
const DIST = path.resolve(process.cwd(), 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
}

// Import the adapter's handler shape by re-implementing the routing inline —
// we can't easily reuse adapter.mjs' server object, but we can re-export its
// request handler. Simpler: dynamically import and monkey-patch createServer.
let apiHandler = null

const originalCreate = http.createServer.bind(http)
http.createServer = (handler) => {
  apiHandler = handler
  // Return a stub that doesn't actually listen — we take over.
  return { listen(){}, on(){}, close(cb){ cb && cb() } }
}
await import('./adapter.mjs')
http.createServer = originalCreate    // restore

const API_PREFIXES = ['/health', '/metrics', '/bitget', '/prices', '/news', '/research', '/desk', '/auth', '/session', '/push', '/positioning', '/book', '/marketintel', '/macro', '/signals', '/history', '/backtest', '/share', '/alerts', '/trading', '/copilot', '/vapid', '/paper', '/playbooks', '/leaderboard', '/assayer']

function isApi(pathname) { return API_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/')) }

function serveStatic(req, res) {
  const parsed = new URL(req.url, 'http://x')
  let file = parsed.pathname === '/' ? '/index.html' : parsed.pathname
  const abs = path.resolve(DIST + file)
  // Prevent directory traversal
  if (!abs.startsWith(DIST)) { res.writeHead(403); res.end('forbidden'); return }
  fs.stat(abs, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback: any unknown path → index.html so client router handles it
      const idx = path.join(DIST, 'index.html')
      fs.readFile(idx, (e2, buf) => {
        if (e2) { res.writeHead(404); res.end('not found'); return }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' })
        res.end(buf)
      })
      return
    }
    const ext = path.extname(abs).toLowerCase()
    const mime = MIME[ext] || 'application/octet-stream'
    // Hashed assets → immutable long cache. Everything else → no-cache.
    const cache = /\/assets\//.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache'
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': cache })
    fs.createReadStream(abs).pipe(res)
  })
}

const server = originalCreate((req, res) => {
  const parsed = new URL(req.url, 'http://x')
  if (isApi(parsed.pathname)) return apiHandler(req, res)
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('method not allowed'); return }
  serveStatic(req, res)
})

server.listen(PORT, HOST, () => {
  logger.info({ port: PORT, host: HOST, dist: DIST }, 'NIGHTWATCH AI static+api server online')
})
