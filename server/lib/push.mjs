/**
 * Web Push notifications.
 *
 * VAPID keys are auto-generated on first boot and persisted to disk. The
 * public key is exposed at /vapid/public-key so the SPA can subscribe.
 * Each user's subscription is stored via savePushSubscription().
 *
 * sendPush(userId, payload) delivers the payload to that user's subscription
 * (if any). deliverToAll(payload) fans out to every subscribed user — used by
 * the news+signal alerters upstream.
 */

import fs from 'node:fs'
import path from 'node:path'
import webpush from 'web-push'
import { logger } from './log.mjs'
import { paths, loadPushSubscription, listPushSubscriptions } from './store.mjs'

const VAPID_FILE = path.join(paths.DATA_DIR, 'vapid.json')
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:nightwatch@example.com'

function loadOrCreateKeys() {
  try { return JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8')) } catch { /* first run */ }
  const kp = webpush.generateVAPIDKeys()
  fs.mkdirSync(path.dirname(VAPID_FILE), { recursive: true })
  fs.writeFileSync(VAPID_FILE, JSON.stringify(kp, null, 2))
  logger.info({ file: VAPID_FILE }, 'VAPID keys generated')
  return kp
}

const KEYS = loadOrCreateKeys()
webpush.setVapidDetails(SUBJECT, KEYS.publicKey, KEYS.privateKey)

export function publicKey() { return KEYS.publicKey }

export async function sendPush(userId, payload) {
  const sub = loadPushSubscription(userId)
  if (!sub?.endpoint) return { skipped: true, reason: 'no subscription' }
  try {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
    const result = await webpush.sendNotification(sub, body, { TTL: 60 })
    return { sent: true, statusCode: result.statusCode }
  } catch (err) {
    logger.warn({ userId, err: err.message, statusCode: err.statusCode }, 'push send failed')
    return { sent: false, error: err.message, statusCode: err.statusCode }
  }
}

export async function deliverToAll(payload) {
  const subs = listPushSubscriptions()
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  let sent = 0, failed = 0
  for (const { userId, sub } of subs) {
    try {
      await webpush.sendNotification(sub, body, { TTL: 60 })
      sent++
    } catch (err) {
      failed++
      logger.debug({ userId, err: err.message }, 'push fanout: user skipped')
    }
  }
  return { sent, failed, total: subs.length }
}

/** Predicate helper: does this news item warrant a push for this user? */
export function shouldPushForUser(newsItem, session) {
  if (!newsItem?.analysis) return false
  const relevanceHigh = newsItem.analysis.relevanceTier === 'HIGH'
  const touchesPositions = (newsItem.analysis.positionsTouched || 0) > 0
  const severityHigh = newsItem.severity === 'HIGH'
  return relevanceHigh || (severityHigh && touchesPositions)
}
