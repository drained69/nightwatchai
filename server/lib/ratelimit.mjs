/**
 * Sliding-window rate limiter (in-memory).
 * Use `check(key)` at the top of each request handler.
 * Returns { ok, remaining, resetAt }.
 */

export function makeRateLimiter({ windowMs = 60_000, max = 60, prefix = 'rl' } = {}) {
  /** @type {Map<string, number[]>} */
  const hits = new Map()
  const gc = setInterval(() => {
    const cutoff = Date.now() - windowMs
    for (const [key, times] of hits) {
      const fresh = times.filter(t => t > cutoff)
      if (fresh.length === 0) hits.delete(key); else hits.set(key, fresh)
    }
  }, windowMs).unref?.()
  return {
    check(key) {
      const now = Date.now()
      const cutoff = now - windowMs
      const times = (hits.get(`${prefix}:${key}`) || []).filter(t => t > cutoff)
      if (times.length >= max) return { ok: false, remaining: 0, resetAt: (times[0] || now) + windowMs }
      times.push(now)
      hits.set(`${prefix}:${key}`, times)
      return { ok: true, remaining: Math.max(0, max - times.length), resetAt: now + windowMs }
    },
    stop() { if (gc) clearInterval(gc) },
  }
}

/**
 * Convenience wrapper: sends 429 if limit exceeded, otherwise calls next().
 */
export function enforce(limiter, req, res, next, keyFn = (r) => (r.socket.remoteAddress || 'anon')) {
  const key = keyFn(req)
  const gate = limiter.check(key)
  res.setHeader('X-RateLimit-Remaining', gate.remaining)
  res.setHeader('X-RateLimit-Reset', Math.ceil(gate.resetAt / 1000))
  if (!gate.ok) {
    res.writeHead(429, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'rate limited', retryAfterMs: Math.max(0, gate.resetAt - Date.now()) }))
    return false
  }
  next()
  return true
}
