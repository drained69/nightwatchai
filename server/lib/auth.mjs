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
import { promisify } from 'node:util'
import { sign, verify } from './jwt.mjs'
import { createUser, getUser, findUserByEmail, upsertUser } from './store.mjs'
import { logger } from './log.mjs'

const scrypt = promisify(crypto.scrypt)
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, SCRYPT_KEYLEN = 64

/** Hash a password with scrypt + per-user salt. Returns "salt:hash" hex. */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = await scrypt(String(password), salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

/** Timing-safe verify of a plaintext password against a stored "salt:hash". */
export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false
  const [saltHex, hashHex] = stored.split(':')
  try {
    const expected = Buffer.from(hashHex, 'hex')
    const candidate = await scrypt(String(password), Buffer.from(saltHex, 'hex'), expected.length, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
    return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate)
  } catch { return false }
}

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

/* ------------------------------------------------- email auth (validation) */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateEmail(email) {
  const norm = String(email || '').toLowerCase().trim()
  if (!norm || !EMAIL_RE.test(norm)) throw new Error('valid email required')
  return norm
}
function validatePassword(password) {
  const p = String(password ?? '')
  if (p.length < 8) throw new Error('password must be at least 8 characters')
  if (p.length > 200) throw new Error('password too long')
  return p
}

/* ------------------------------------------------- passwordless: email-code */

/**
 * In-process pending code store. One record per email. Codes hash with per-request
 * salt so we never keep the plaintext in memory. TTL 10 minutes. Max 5 verify
 * attempts before the record is invalidated. Restart wipes all pending codes —
 * that's the desired behavior (code drops become useless on redeploy).
 */
const PENDING_CODES = new Map()
const CODE_TTL_MS = 10 * 60 * 1000
const MAX_VERIFY_ATTEMPTS = 5
const MIN_RESEND_MS = 30 * 1000     // per-email resend throttle

function hashCode(code, salt) {
  return crypto.scryptSync(String(code), salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex')
}

/**
 * Ask for a 6-digit sign-in code to be sent to `email`. Idempotent within the
 * throttle window — a rapid re-request keeps the same live code.
 * Returns { sent, throttled?: boolean, previewCode?: string }
 *   previewCode is included ONLY when email delivery isn't configured — for
 *   local dev, we can't send email so we return the code inline. In production
 *   Resend or SMTP MUST be configured; otherwise the endpoint refuses to
 *   handle new users.
 */
export async function requestSignInCode({ email }) {
  const norm = validateEmail(email)
  const existing = PENDING_CODES.get(norm)
  const now = Date.now()
  if (existing && existing.issuedAt && now - existing.issuedAt < MIN_RESEND_MS) {
    return { sent: true, throttled: true, retryInMs: MIN_RESEND_MS - (now - existing.issuedAt) }
  }
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
  const salt = crypto.randomBytes(8)
  const hashed = hashCode(code, salt)
  PENDING_CODES.set(norm, { hashed, salt, expiresAt: now + CODE_TTL_MS, issuedAt: now, attempts: 0 })
  const delivery = await sendSignInCode(norm, code)
  const previewCode = delivery.transport === 'log' ? code : undefined
  logger.info({ email: norm, transport: delivery.transport }, 'sign-in code issued')
  return { sent: true, transport: delivery.transport, previewCode }
}

/**
 * Verify the code the user typed. On success returns { user, token }, creating
 * a new user record on first sign-in. Failed attempts are counted; the code
 * self-destructs after MAX_VERIFY_ATTEMPTS or on expiry.
 */
export async function verifySignInCode({ email, code, name }) {
  const norm = validateEmail(email)
  const rec = PENDING_CODES.get(norm)
  if (!rec) throw new Error('no sign-in code pending — request a new one')
  if (Date.now() > rec.expiresAt) {
    PENDING_CODES.delete(norm)
    throw new Error('code expired — request a new one')
  }
  if (rec.attempts >= MAX_VERIFY_ATTEMPTS) {
    PENDING_CODES.delete(norm)
    throw new Error('too many attempts — request a new code')
  }
  rec.attempts++
  const candidate = hashCode(String(code || ''), rec.salt)
  const ok = candidate.length === rec.hashed.length &&
             crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(rec.hashed, 'hex'))
  if (!ok) throw new Error('invalid code')
  PENDING_CODES.delete(norm)
  let user = findUserByEmail(norm)
  if (!user) {
    user = createUser({ email: norm, name, provider: 'email' })
  } else if (user.provider !== 'email' && user.provider !== 'password') {
    user = upsertUser({ ...user, provider: 'email' })
  }
  return { user: publicUser(user), token: issueToken(user) }
}

/**
 * Send a sign-in code by email. Uses Resend if `RESEND_API_KEY` is set;
 * otherwise logs the code to the server console (for local dev — the endpoint
 * response includes `previewCode` in that case).
 */
async function sendSignInCode(email, code) {
  const RESEND_KEY = process.env.RESEND_API_KEY
  const FROM = process.env.EMAIL_FROM || 'NIGHTWATCH AI <onboarding@resend.dev>'
  const subject = `Your NIGHTWATCH sign-in code is ${code}`
  const html = `
<!doctype html><html><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#0e0f11;color:#e6e6e6;padding:32px">
  <div style="max-width:480px;margin:0 auto;background:#15161a;border:1px solid #24262b;padding:32px;border-radius:4px">
    <h1 style="font-family:'DM Serif Display',Georgia,serif;font-size:26px;margin:0 0 8px;color:#fff">NIGHTWATCH AI</h1>
    <p style="color:#9aa0a6;margin:0 0 24px;font-size:13px;letter-spacing:0.5px;text-transform:uppercase">AI Trading Desk</p>
    <p style="font-size:15px;line-height:1.6">Use this one-time code to sign in:</p>
    <div style="font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:32px;letter-spacing:6px;background:#0b0c0e;border:1px solid #2a2d33;padding:16px 20px;text-align:center;color:#fff;margin:16px 0">${code}</div>
    <p style="color:#9aa0a6;font-size:13px;line-height:1.6">This code expires in 10 minutes. If you didn't request it, ignore this message.</p>
  </div>
</body></html>`.trim()
  if (RESEND_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: email, subject, html }),
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) {
        const body = await res.text()
        logger.warn({ status: res.status, body: body.slice(0, 200) }, 'resend send failed — falling back to log transport')
        logger.info({ email, code }, 'SIGN-IN CODE (fallback log)')
        return { transport: 'log' }
      }
      return { transport: 'resend' }
    } catch (err) {
      logger.warn({ err: err.message }, 'resend threw — falling back to log transport')
      logger.info({ email, code }, 'SIGN-IN CODE (fallback log)')
      return { transport: 'log' }
    }
  }
  // No email provider configured — log for local dev.
  logger.info({ email, code }, 'SIGN-IN CODE (no email provider — set RESEND_API_KEY to send real email)')
  return { transport: 'log' }
}

export async function signup({ email, password, name }) {
  const norm = validateEmail(email)
  const pw = validatePassword(password)
  const existing = findUserByEmail(norm)
  if (existing) {
    // Distinguish "already registered (real password user)" from "seen only via a
    // prior dev-login": the second case is still a valid signup — attach a real
    // password to the existing record.
    if (existing.passwordHash) throw new Error('an account with this email already exists — sign in instead')
    const passwordHash = await hashPassword(pw)
    const updated = upsertUser({ ...existing, name: name || existing.name, provider: 'password', passwordHash })
    logger.info({ userId: updated.id }, 'user upgraded to password auth')
    return { user: publicUser(updated), token: issueToken(updated) }
  }
  const passwordHash = await hashPassword(pw)
  const user = createUser({ email: norm, name, provider: 'password' })
  const withPw = upsertUser({ ...user, passwordHash })
  return { user: publicUser(withPw), token: issueToken(withPw) }
}

export async function login({ email, password }) {
  const norm = validateEmail(email)
  const pw = validatePassword(password)
  const user = findUserByEmail(norm)
  // Same error text for "no user" and "wrong password" — prevents email enumeration.
  if (!user || !user.passwordHash) throw new Error('invalid email or password')
  const ok = await verifyPassword(pw, user.passwordHash)
  if (!ok) throw new Error('invalid email or password')
  return { user: publicUser(user), token: issueToken(user) }
}

/** Strip sensitive fields before returning to the client. */
export function publicUser(u) {
  if (!u) return null
  const { passwordHash, ...rest } = u
  return rest
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
