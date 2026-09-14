/**
 * Auth middleware + issue/verify helpers.
 *
 * Local dev: POST /auth/dev-login { email } → JWT (no password).
 * Production: POST /auth/oauth/bitget/callback (stub — plug in when Bitget OAuth
 *   app credentials are provisioned; see DEPLOYMENT.md).
 *
 * JWT_SECRET must be set in production. In dev, we fall back to a random secret
 * generated at process start (all previously issued tokens invalidate on restart).
 */
import crypto from 'node:crypto'
import { sign, verify } from './jwt.mjs'
import { createUser, getUser } from './store.mjs'
import { logger } from './log.mjs'

let SECRET = process.env.JWT_SECRET
if (!SECRET) {
  SECRET = crypto.randomBytes(48).toString('base64')
  logger.warn('JWT_SECRET not set — using ephemeral secret (tokens invalidate on restart). Set JWT_SECRET for production.')
}

/** Extract bearer token from Authorization header or ?token= query. */
export function extractToken(req) {
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  const url = new URL(req.url, 'http://x')
  return url.searchParams.get('token')
}

export function issueToken(user) {
  return sign({ sub: user.id, email: user.email, name: user.name, provider: user.provider }, SECRET)
}

export function authenticate(req) {
  const token = extractToken(req)
  if (!token) return null
  const payload = verify(token, SECRET)
  if (!payload) return null
  const user = getUser(payload.sub)
  return user ? { user, payload } : null
}

/** Middleware helper for HTTP routes: returns { user } or writes 401 and returns null. */
export function requireAuth(req, res) {
  const session = authenticate(req)
  if (session) return session.user
  res.writeHead(401, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'authentication required' }))
  return null
}

/* ------------------------------------------------- dev-login helper */

export function devLogin({ email, name }) {
  if (!email) throw new Error('email required')
  const user = createUser({ email, name, provider: 'dev' })
  return { user, token: issueToken(user) }
}

/* ------------------------------------------------- Bitget OAuth stub */

/**
 * Wire this to Bitget's Agentic Account OAuth flow. The exchange is:
 *   1. Client redirects to Bitget /oauth/authorize with client_id + redirect_uri.
 *   2. Bitget returns code → POST /auth/oauth/bitget/callback { code }.
 *   3. This function exchanges the code for an agent-account access token.
 *   4. We create/update the user and issue our own JWT.
 *
 * Fill BITGET_OAUTH_CLIENT_ID / BITGET_OAUTH_CLIENT_SECRET / BITGET_OAUTH_REDIRECT_URI.
 */
export async function bitgetOauthCallback({ code }) {
  const CLIENT_ID     = process.env.BITGET_OAUTH_CLIENT_ID
  const CLIENT_SECRET = process.env.BITGET_OAUTH_CLIENT_SECRET
  const REDIRECT_URI  = process.env.BITGET_OAUTH_REDIRECT_URI
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    throw new Error('Bitget OAuth not configured. Set BITGET_OAUTH_CLIENT_ID / BITGET_OAUTH_CLIENT_SECRET / BITGET_OAUTH_REDIRECT_URI. See DEPLOYMENT.md.')
  }
  if (!code) throw new Error('code required')
  // NOTE: replace this with the real Bitget OAuth endpoint once credentials are provisioned.
  // The Agent Hub docs describe the flow; this stub throws until env vars are set.
  throw new Error('Bitget OAuth exchange not implemented — pending API credentials. Use /auth/dev-login for local dev.')
}
