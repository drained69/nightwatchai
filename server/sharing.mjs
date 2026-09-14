/**
 * Report sharing.
 *
 * Any authenticated user can turn a report into a signed public link:
 *   POST /share/report { report } → { url, token }
 * The token is a short JWT with { sub: reportHash, iat, exp }. We persist the
 * report JSON in data/shared/<hash>.json so unauthenticated GET /share/report/:token
 * can serve it read-only.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { sign, verify } from './lib/jwt.mjs'
import { paths } from './lib/store.mjs'
import { logger } from './lib/log.mjs'

const SHARED_DIR = path.join(paths.DATA_DIR, 'shared')
fs.mkdirSync(SHARED_DIR, { recursive: true })

const SECRET = process.env.SHARE_SECRET || process.env.JWT_SECRET || crypto.randomBytes(32).toString('base64')

function fileFor(hash) { return path.join(SHARED_DIR, `${hash}.json`) }

export function shareReport(report, { ownerUserId, expSeconds = 60 * 60 * 24 * 30 } = {}) {
  if (!report?.id) throw new Error('report.id required')
  const canonical = JSON.stringify(report)
  const hash = crypto.createHash('sha1').update(canonical).digest('hex').slice(0, 20)
  const record = {
    hash,
    ownerUserId: ownerUserId || null,
    report,
    sharedAt: new Date().toISOString(),
    views: 0,
  }
  fs.writeFileSync(fileFor(hash), JSON.stringify(record))
  const token = sign({ sub: hash, kind: 'share' }, SECRET, { expSeconds })
  return { hash, token, expSeconds }
}

export function readSharedByToken(token) {
  const payload = verify(token, SECRET)
  if (!payload || payload.kind !== 'share' || !payload.sub) return null
  try {
    const record = JSON.parse(fs.readFileSync(fileFor(payload.sub), 'utf8'))
    record.views = (record.views || 0) + 1
    fs.writeFileSync(fileFor(payload.sub), JSON.stringify(record))
    return record
  } catch { return null }
}
