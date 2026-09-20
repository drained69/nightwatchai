/**
 * Provider-agnostic transactional email adapter.
 *
 * The rest of the codebase (auth codes, Alpha of the Day briefs, future
 * transactional flows) SHOULD go through this module instead of talking to
 * Resend directly, so we can swap providers without hunting for call sites.
 *
 * Current provider: Resend (via HTTPS). If RESEND_API_KEY is not set, the
 * mailer runs in `log-only` mode — it never claims delivery it did not
 * perform, which is the whole point of the abstraction:
 *
 *   const r = await sendEmail({ to, subject, html })
 *   r.delivered  → true only when a real provider accepted the message
 *   r.transport  → 'resend' | 'log' | 'send-failed' | 'noop'
 *
 * Callers with hard delivery requirements (e.g. sign-in codes) MUST inspect
 * `r.delivered` / `r.transport` and refuse to advance the flow on failure.
 */
import { logger } from './log.mjs'

const RESEND_KEY = () => process.env.RESEND_API_KEY || ''
const DEFAULT_FROM = () => process.env.EMAIL_FROM || 'NIGHTWATCH AI <onboarding@resend.dev>'
const TIMEOUT_MS   = () => Number(process.env.EMAIL_TIMEOUT_MS || 10_000)

/** Cheap sanity check — matches the shape auth.mjs enforces on sign-in. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function isValidEmail(e) { return typeof e === 'string' && EMAIL_RE.test(e.trim()) }

/**
 * Reports what the mailer will actually do right now. Safe to call from
 * /health without leaking secrets.
 */
export function mailerStatus() {
  const key = RESEND_KEY()
  return {
    provider: key ? 'resend' : 'log-only',
    from: DEFAULT_FROM(),
    canDeliver: Boolean(key),
    reason: key ? 'RESEND_API_KEY is set' : 'set RESEND_API_KEY (and EMAIL_FROM) to send real email',
  }
}

/**
 * Send a transactional email. Returns:
 *   { delivered: boolean, transport: string, id?: string, status?: number, body?: string }
 * Never throws on transport errors — callers that need delivery guarantees
 * check `delivered`.
 */
export async function sendEmail({ to, subject, html, text, from = null, replyTo = null }) {
  if (!isValidEmail(to)) return { delivered: false, transport: 'noop', reason: 'invalid recipient' }
  if (!subject || !html) return { delivered: false, transport: 'noop', reason: 'subject + html required' }
  const key = RESEND_KEY()
  if (!key) {
    logger.info({ to, subject }, 'EMAIL (no provider — set RESEND_API_KEY to send real email)')
    return { delivered: false, transport: 'log' }
  }
  const payload = {
    from: from || DEFAULT_FROM(),
    to,
    subject,
    html,
    ...(text ? { text } : {}),
    ...(replyTo ? { reply_to: replyTo } : {}),
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS()),
    })
    const bodyTxt = await res.text().catch(() => '')
    if (!res.ok) {
      logger.warn({ to, subject, status: res.status, body: bodyTxt.slice(0, 200) }, 'mailer: resend refused send')
      return { delivered: false, transport: 'send-failed', status: res.status, body: bodyTxt.slice(0, 200) }
    }
    let id = null
    try { id = JSON.parse(bodyTxt)?.id || null } catch { /* ok */ }
    return { delivered: true, transport: 'resend', id }
  } catch (err) {
    logger.warn({ to, subject, err: err.message }, 'mailer: resend threw')
    return { delivered: false, transport: 'send-failed', reason: err.message }
  }
}

/**
 * Send the same subject/html to many recipients, one API call each. Returns
 * per-recipient results so the caller can surface partial failures.
 */
export async function sendBatch({ recipients, subject, html, text, from }) {
  const results = []
  for (const to of recipients) {
    // Sequential on purpose — Resend has per-key rate limits (~10/sec on the
    // free tier). Batches are small (subscriber count for one product), so
    // the added latency is measured in seconds, not minutes.
    // eslint-disable-next-line no-await-in-loop
    const r = await sendEmail({ to, subject, html, text, from })
    results.push({ to, ...r })
  }
  const delivered = results.filter(r => r.delivered).length
  return { total: results.length, delivered, failed: results.length - delivered, results }
}
