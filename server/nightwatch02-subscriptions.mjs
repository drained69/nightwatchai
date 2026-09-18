/**
 * NIGHTWATCH 02:00 email subscriptions.
 *
 * Layout on disk: <DATA_DIR>/nightwatch02/subscribers.json
 *   { "<lower-email>": { email, enabled, userId?, source, createdAt, updatedAt } }
 *
 * Keyed by lowercased email so a user cannot register the same address twice
 * with different casing. `enabled: false` records an explicit opt-out so we
 * can honor unsubscribe links without deleting the row and forgetting the
 * preference.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { paths } from './lib/store.mjs'
import { isValidEmail } from './lib/mailer.mjs'
import { logger } from './lib/log.mjs'

const DIR  = path.join(paths.DATA_DIR, 'nightwatch02')
const FILE = path.join(DIR, 'subscribers.json')

function ensureDir() { fs.mkdirSync(DIR, { recursive: true }) }
function safeReadJson(f, fb) { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return fb } }
function atomicWrite(f, obj) {
  ensureDir()
  const tmp = `${f}.${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2))
  fs.renameSync(tmp, f)
}

function loadAll() { return safeReadJson(FILE, {}) }
function saveAll(map) { atomicWrite(FILE, map) }

function normEmail(email) {
  const norm = String(email || '').toLowerCase().trim()
  if (!isValidEmail(norm)) throw new Error('valid email required')
  return norm
}

/** Turn subscription state on/off for an email. Idempotent. */
export function setSubscription({ email, enabled, userId = null, source = 'ui' }) {
  const norm = normEmail(email)
  const all = loadAll()
  const now = new Date().toISOString()
  const prior = all[norm]
  all[norm] = {
    email: norm,
    enabled: Boolean(enabled),
    userId: userId || prior?.userId || null,
    source: prior?.source || source,
    createdAt: prior?.createdAt || now,
    updatedAt: now,
    unsubscribeToken: prior?.unsubscribeToken || crypto.randomBytes(12).toString('hex'),
  }
  saveAll(all)
  logger.info({ email: norm, enabled: all[norm].enabled }, 'nightwatch02 subscription updated')
  return all[norm]
}

export function getSubscription(email) {
  try { return loadAll()[normEmail(email)] || null } catch { return null }
}

/** Look up by unsubscribe token — used by /nightwatch/unsubscribe/:token. */
export function findByUnsubscribeToken(token) {
  const all = loadAll()
  for (const key of Object.keys(all)) if (all[key].unsubscribeToken === token) return all[key]
  return null
}

/** Every currently-subscribed row. */
export function listActiveSubscribers() {
  const all = loadAll()
  return Object.values(all).filter(s => s.enabled)
}

/** Every row, including opt-outs, for admin views. */
export function listAllSubscribers() { return Object.values(loadAll()) }

export const _paths = { DIR, FILE }
