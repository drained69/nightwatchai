import test from 'node:test'
import assert from 'node:assert/strict'

/* ---------- JWT ---------- */

import { sign, verify } from './jwt.mjs'

test('jwt: sign then verify round-trip', () => {
  const secret = 'test-secret-do-not-use-in-production'
  const token = sign({ sub: 'usr_1', email: 'a@b.co' }, secret)
  const payload = verify(token, secret)
  assert.equal(payload.sub, 'usr_1')
  assert.equal(payload.email, 'a@b.co')
  assert.ok(payload.iat && payload.exp && payload.exp > payload.iat)
})

test('jwt: verify rejects wrong secret', () => {
  const t = sign({ sub: 'x' }, 'a')
  assert.equal(verify(t, 'b'), null)
})

test('jwt: verify rejects malformed token', () => {
  assert.equal(verify(null, 'a'), null)
  assert.equal(verify('not.a.jwt.extra', 'a'), null)
  assert.equal(verify('two.parts', 'a'), null)
  assert.equal(verify('bad+chars.here.=', 'a'), null)
})

test('jwt: verify rejects expired token', () => {
  const t = sign({ sub: 'x' }, 's', { expSeconds: -1 })
  assert.equal(verify(t, 's'), null)
})

/* ---------- Rate limiter ---------- */

import { makeRateLimiter } from './ratelimit.mjs'

test('ratelimit: enforces window cap and refills after window elapses', async () => {
  const rl = makeRateLimiter({ windowMs: 100, max: 3 })
  assert.equal(rl.check('k').ok, true)
  assert.equal(rl.check('k').ok, true)
  assert.equal(rl.check('k').ok, true)
  const gate = rl.check('k')
  assert.equal(gate.ok, false)
  assert.equal(gate.remaining, 0)
  await new Promise(r => setTimeout(r, 150))
  assert.equal(rl.check('k').ok, true)
  rl.stop()
})

test('ratelimit: different keys are independent', () => {
  const rl = makeRateLimiter({ windowMs: 1000, max: 1 })
  assert.equal(rl.check('a').ok, true)
  assert.equal(rl.check('a').ok, false)
  assert.equal(rl.check('b').ok, true)
  rl.stop()
})

/* ---------- RSS parser ---------- */

import { parseRss } from '../providers/news.mjs'

test('rss: parses well-formed RSS 2.0', () => {
  const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Feed</title>
  <item>
    <title><![CDATA[Bitcoin surges to record on ETF inflows]]></title>
    <link>https://example.com/a</link>
    <description>BTC hit an all-time high driven by $612M net ETF flow.</description>
    <pubDate>Mon, 09 Sep 2026 12:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Solana Firedancer client hits milestone</title>
    <link>https://example.com/b</link>
    <description>Second validator client reaches mainnet parity.</description>
    <pubDate>Mon, 09 Sep 2026 13:00:00 GMT</pubDate>
  </item>
</channel></rss>`
  const items = parseRss(xml)
  assert.equal(items.length, 2)
  assert.equal(items[0].title, 'Bitcoin surges to record on ETF inflows')
  assert.equal(items[0].link, 'https://example.com/a')
  assert.ok(items[0].publishedAt.startsWith('2026-09-09'))
})

test('rss: parses Atom entries as well', () => {
  const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Fed hints at cuts</title>
    <link href="https://ex.com/1" />
    <summary>DXY lower on dovish minutes</summary>
    <updated>2026-09-09T14:00:00Z</updated>
  </entry>
</feed>`
  const items = parseRss(xml)
  assert.equal(items.length, 1)
  assert.equal(items[0].link, 'https://ex.com/1')
})

/* ---------- Store ---------- */

import fs from 'node:fs'
import path from 'node:path'
process.env.NIGHTWATCH_DATA_DIR = path.join(process.cwd(), '.test-data-' + Date.now())
const store = await import('./store.mjs')

test.after(() => {
  try { fs.rmSync(process.env.NIGHTWATCH_DATA_DIR, { recursive: true, force: true }) } catch { /* ignore */ }
})

test('store: create/find/upsert user', () => {
  const u = store.createUser({ email: 'x@y.co', name: 'X' })
  assert.ok(u.id.startsWith('usr_'))
  const same = store.createUser({ email: 'x@y.co', name: 'Y' })   // idempotent by email
  assert.equal(same.id, u.id)
  const found = store.findUserByEmail('x@y.co')
  assert.equal(found.id, u.id)
})

test('store: session round-trip', () => {
  const u = store.createUser({ email: 's@t.co' })
  store.patchSessionFor(u.id, { watchlist: ['BTC', 'ETH'], preferences: { nav: 42000 } })
  const s = store.loadSessionFor(u.id)
  assert.deepEqual(s.watchlist, ['BTC', 'ETH'])
  assert.equal(s.preferences.nav, 42000)
})
