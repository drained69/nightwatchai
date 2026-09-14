/**
 * Bitget Agent Account trading.
 *
 * OAuth flow:
 *   1. SPA → /auth/oauth/bitget/start → redirect to Bitget authorize URL
 *   2. Bitget → REDIRECT_URI with ?code=... → SPA → /auth/oauth/bitget/callback
 *   3. Server exchanges code for agent-account access_token, refresh_token
 *   4. Server stores token on user record, issues our own JWT for browser
 *
 * Live order flow:
 *   POST /trading/order  (JWT + explicit trader approve)
 *     → uses stored agent-account token to POST to Bitget /v3/agent/orders
 *     → response contains real order id
 *
 * Kill switch:
 *   POST /trading/kill   → cancel every open order + revoke token
 *
 * Every write is trader-gated. Set BITGET_LIVE_ENABLED=1 to enable.
 * Without it we just return "paper only". This keeps a safety catch even if
 * OAuth env vars are misconfigured.
 */

import { logger } from '../lib/log.mjs'
import { upsertUser, getUser } from '../lib/store.mjs'

const BITGET_API   = process.env.BITGET_TRADE_API   || 'https://api.bitget.com'
const OAUTH_HOST   = process.env.BITGET_OAUTH_HOST  || 'https://www.bitget.com'
const CLIENT_ID    = process.env.BITGET_OAUTH_CLIENT_ID
const CLIENT_SECRET= process.env.BITGET_OAUTH_CLIENT_SECRET
const REDIRECT_URI = process.env.BITGET_OAUTH_REDIRECT_URI
const LIVE_ENABLED = process.env.BITGET_LIVE_ENABLED === '1'
const SCOPES       = process.env.BITGET_OAUTH_SCOPES || 'read trade'

export function isLiveEnabled() {
  return Boolean(LIVE_ENABLED && CLIENT_ID && CLIENT_SECRET && REDIRECT_URI)
}

export function buildAuthorizeUrl(state) {
  if (!CLIENT_ID || !REDIRECT_URI) throw new Error('Bitget OAuth not configured — see DEPLOYMENT.md §5')
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state: state || '',
  })
  return `${OAUTH_HOST}/oauth/authorize?${params.toString()}`
}

/** Exchange the authorization code for an access + refresh token. */
export async function exchangeCodeForToken(code) {
  if (!isLiveEnabled()) throw new Error('Bitget live trading not enabled. Set BITGET_LIVE_ENABLED=1 and provision OAuth credentials.')
  const res = await fetch(`${OAUTH_HOST}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(9000),
  })
  if (!res.ok) throw new Error(`Bitget token exchange returned ${res.status}: ${await res.text().catch(() => '')}`)
  const body = await res.json()
  return {
    accessToken:  body.access_token,
    refreshToken: body.refresh_token,
    expiresIn:    Number(body.expires_in) || 3600,
    tokenType:    body.token_type || 'Bearer',
    scope:        body.scope,
    obtainedAt:   Date.now(),
  }
}

export async function refreshAccessToken(refreshToken) {
  if (!isLiveEnabled()) throw new Error('live trading not enabled')
  const res = await fetch(`${OAUTH_HOST}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(9000),
  })
  if (!res.ok) throw new Error(`refresh returned ${res.status}`)
  const body = await res.json()
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || refreshToken,
    expiresIn: Number(body.expires_in) || 3600,
    obtainedAt: Date.now(),
  }
}

/** Attach or update the user's stored Bitget token. */
export function storeUserToken(userId, token) {
  const existing = getUser(userId)
  if (!existing) throw new Error('user not found')
  return upsertUser({
    ...existing,
    bitget: {
      ...(existing.bitget || {}),
      ...token,
      connectedAt: existing.bitget?.connectedAt || new Date().toISOString(),
    },
  })
}

/** Retrieve a valid (auto-refreshed) access token for the user. */
export async function getValidAccessToken(userId) {
  const user = getUser(userId)
  const tok = user?.bitget
  if (!tok?.accessToken) return null
  const expiresAt = (tok.obtainedAt || 0) + (tok.expiresIn || 0) * 1000
  if (Date.now() < expiresAt - 60_000) return tok.accessToken
  if (!tok.refreshToken) return null
  const fresh = await refreshAccessToken(tok.refreshToken).catch(() => null)
  if (!fresh) return null
  storeUserToken(userId, fresh)
  return fresh.accessToken
}

/**
 * Submit a live agent-account order. Trader-gated at the route layer.
 * NOTE: the exact endpoint + payload shape depends on the Bitget Agent Hub OAuth
 * API you're issued. The code below follows the documented pattern; refine when
 * you receive the final Bitget spec.
 */
export async function submitLiveOrder(userId, order) {
  const token = await getValidAccessToken(userId)
  if (!token) throw new Error('no live token — reconnect Bitget Agent Account in Settings')
  const res = await fetch(`${BITGET_API}/v3/agent/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: `${order.asset}USDT`,
      side: order.direction === 'LONG' ? 'buy' : 'sell',
      orderType: 'market',
      size: String(order.notional),
      timeInForce: 'GTC',
      clientOrderId: order.clientOrderId || `nw-${Date.now()}`,
    }),
    signal: AbortSignal.timeout(9000),
  })
  if (!res.ok) throw new Error(`bitget order returned ${res.status}: ${await res.text().catch(() => '')}`)
  return await res.json()
}

/** Cancel every open order + revoke the stored token. */
export async function killSwitch(userId) {
  const token = await getValidAccessToken(userId).catch(() => null)
  const results = { cancelled: 0, tokenRevoked: false, errors: [] }
  if (token) {
    try {
      const res = await fetch(`${BITGET_API}/v3/agent/orders/cancel-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(9000),
      })
      if (res.ok) results.cancelled = 1
      else results.errors.push(`cancel-all ${res.status}`)
    } catch (err) { results.errors.push(err.message) }
    try {
      const res = await fetch(`${OAUTH_HOST}/oauth/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
        signal: AbortSignal.timeout(6000),
      })
      if (res.ok) results.tokenRevoked = true
    } catch (err) { results.errors.push(err.message) }
  }
  const user = getUser(userId)
  if (user?.bitget) upsertUser({ ...user, bitget: { ...user.bitget, accessToken: null, refreshToken: null, killedAt: new Date().toISOString() } })
  return results
}
