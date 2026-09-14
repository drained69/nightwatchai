/**
 * Per-user JSON-file store. One directory per user; one file per collection.
 * Adequate for single-node beta; swap for Postgres before scaling.
 *
 * Layout:  <DATA_DIR>/users/<userId>/<collection>.json
 *          <DATA_DIR>/users.json         (id → { email, createdAt, ... })
 *          <DATA_DIR>/push/<userId>.json (Web Push subscriptions)
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { logger } from './log.mjs'

const DATA_DIR = process.env.NIGHTWATCH_DATA_DIR || path.join(process.cwd(), 'data')

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }) }
function safeReadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}
function atomicWrite(file, obj) {
  ensureDir(path.dirname(file))
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2))
  fs.renameSync(tmp, file)
}

/* ---------------- users ---------------- */

const USERS_FILE = path.join(DATA_DIR, 'users.json')

export function listUsers() { return safeReadJson(USERS_FILE, {}) }
export function getUser(userId) { return listUsers()[userId] || null }
export function upsertUser(user) {
  const users = listUsers()
  users[user.id] = { ...(users[user.id] || {}), ...user, updatedAt: new Date().toISOString() }
  atomicWrite(USERS_FILE, users)
  return users[user.id]
}
export function findUserByEmail(email) {
  const norm = String(email || '').toLowerCase().trim()
  const users = listUsers()
  for (const id in users) if ((users[id].email || '').toLowerCase() === norm) return users[id]
  return null
}
export function createUser({ email, name, provider = 'dev' }) {
  const existing = findUserByEmail(email)
  if (existing) return existing
  const id = `usr_${crypto.randomBytes(9).toString('hex')}`
  const user = { id, email: (email || '').toLowerCase(), name: name || (email || '').split('@')[0], provider, createdAt: new Date().toISOString() }
  upsertUser(user)
  logger.info({ userId: id, provider }, 'user created')
  return user
}

/* ---------------- per-user collections ---------------- */

function userFile(userId, name) { return path.join(DATA_DIR, 'users', userId, `${name}.json`) }

export function loadCollection(userId, name, fallback = []) {
  return safeReadJson(userFile(userId, name), fallback)
}
export function saveCollection(userId, name, value) {
  atomicWrite(userFile(userId, name), value)
}

/* ---------------- session helpers ---------------- */

export function loadSessionFor(userId) {
  return {
    watchlist:    loadCollection(userId, 'watchlist', null),
    preferences:  loadCollection(userId, 'preferences', null),
    reports:      loadCollection(userId, 'reports', []),
    signals:      loadCollection(userId, 'signals', []),
    theses:       loadCollection(userId, 'theses', []),
    positions:    loadCollection(userId, 'positions', []),
    decisions:    loadCollection(userId, 'decisions', []),
    reviews:      loadCollection(userId, 'reviews', []),
    newsAlerts:   loadCollection(userId, 'newsAlerts', []),
  }
}
export function patchSessionFor(userId, patch) {
  if (patch.watchlist)   saveCollection(userId, 'watchlist',   patch.watchlist)
  if (patch.preferences) saveCollection(userId, 'preferences', patch.preferences)
  if (patch.reports)     saveCollection(userId, 'reports',     patch.reports.slice(0, 200))
  if (patch.signals)     saveCollection(userId, 'signals',     patch.signals.slice(0, 200))
  if (patch.theses)      saveCollection(userId, 'theses',      patch.theses.slice(0, 100))
  if (patch.positions)   saveCollection(userId, 'positions',   patch.positions)
  if (patch.decisions)   saveCollection(userId, 'decisions',   patch.decisions.slice(0, 500))
  if (patch.reviews)     saveCollection(userId, 'reviews',     patch.reviews.slice(0, 200))
  if (patch.newsAlerts)  saveCollection(userId, 'newsAlerts',  patch.newsAlerts.slice(0, 50))
  return loadSessionFor(userId)
}

/* ---------------- push subscriptions ---------------- */

const PUSH_DIR = path.join(DATA_DIR, 'push')
export function savePushSubscription(userId, sub) {
  ensureDir(PUSH_DIR)
  atomicWrite(path.join(PUSH_DIR, `${userId}.json`), sub)
}
export function loadPushSubscription(userId) {
  return safeReadJson(path.join(PUSH_DIR, `${userId}.json`), null)
}
export function listPushSubscriptions() {
  ensureDir(PUSH_DIR)
  return fs.readdirSync(PUSH_DIR).map(f => ({ userId: f.replace('.json', ''), sub: safeReadJson(path.join(PUSH_DIR, f), null) })).filter(x => x.sub)
}

export const paths = { DATA_DIR, USERS_FILE, PUSH_DIR }
