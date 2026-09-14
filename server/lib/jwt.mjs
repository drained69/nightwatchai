/**
 * Zero-dependency HS256 JWT sign/verify (RFC 7519).
 * Keep JWT_SECRET on the server only.
 */
import crypto from 'node:crypto'

const b64u = (buf) => Buffer.from(buf).toString('base64url')
const b64uDecode = (s) => Buffer.from(s, 'base64url')

export function sign(payload, secret, { expSeconds = 60 * 60 * 24 * 14 } = {}) {
  if (!secret) throw new Error('JWT secret missing')
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const body = { iat: now, exp: now + expSeconds, ...payload }
  const p1 = b64u(JSON.stringify(header))
  const p2 = b64u(JSON.stringify(body))
  const mac = crypto.createHmac('sha256', secret).update(`${p1}.${p2}`).digest()
  return `${p1}.${p2}.${b64u(mac)}`
}

export function verify(token, secret) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [p1, p2, p3] = parts
  const expected = crypto.createHmac('sha256', secret).update(`${p1}.${p2}`).digest()
  const provided = b64uDecode(p3)
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) return null
  let payload
  try { payload = JSON.parse(b64uDecode(p2).toString('utf8')) } catch { return null }
  if (payload.exp && payload.exp * 1000 < Date.now()) return null
  return payload
}
