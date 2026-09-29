import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

process.env.NIGHTWATCH_DATA_DIR = path.join(process.cwd(), '.test-ga-' + Date.now())
process.env.PAPER_STARTING_CAPITAL = '10000'

const store  = await import('./store.mjs')
const paper  = await import('../paper.mjs')
const pb     = await import('../playbooks.mjs')
const alloc  = await import('../allocations.mjs')
const assayer= await import('../assayer.mjs')

test.after(() => { try { fs.rmSync(process.env.NIGHTWATCH_DATA_DIR, { recursive: true, force: true }) } catch { /* ignore */ } })

/* ---------- paper account ---------- */

test('paper: issues starting capital on first read', () => {
  const u = store.createUser({ email: 'p1@t.co' })
  const pa = paper.paperAccount(u.id)
  assert.equal(pa.startingCapital, 10000)
  assert.equal(pa.freeCapital, 10000)
  assert.equal(pa.allocatedCapital, 0)
})

test('paper: reserve then release round-trip with realized pnl', () => {
  const u = store.createUser({ email: 'p2@t.co' })
  paper.reserveCapital(u.id, 3000)
  let pa = paper.paperAccount(u.id)
  assert.equal(pa.freeCapital, 7000)
  assert.equal(pa.allocatedCapital, 3000)
  paper.releaseCapital(u.id, 3000, 150)
  pa = paper.paperAccount(u.id)
  assert.equal(pa.freeCapital, 10150)
  assert.equal(pa.allocatedCapital, 0)
  assert.equal(pa.totalPnl, 150)
})

test('paper: reserve throws on overdraft', () => {
  const u = store.createUser({ email: 'p3@t.co' })
  assert.throws(() => paper.reserveCapital(u.id, 999999))
})

test('paper: position release returns the SERVER-recorded reservation, not the client amount', () => {
  const u = store.createUser({ email: 'p4@t.co' })
  paper.reserveForPosition(u.id, 'pos-1', 1500)
  // Client claims it reserved 9000 — must be ignored.
  const r = paper.releaseAndCredit(u.id, 'pos-1', 9000, 60)
  assert.equal(r.capitalReleased, 1500)
  const snap = paper.paperSnapshot(u.id)
  assert.equal(snap.freeCapital, 10060)
  assert.equal(snap.allocatedCapital, 0)
  assert.equal(snap.totalPnl, 60)
  // +$60 on $10k is +0.6% — the old formula double-counted it as +1.2%.
  assert.equal(snap.totalPnlPct, 0.006)
})

test('paper: realized pnl on a position is bounded by its notional', () => {
  const u = store.createUser({ email: 'p5@t.co' })
  paper.reserveForPosition(u.id, 'pos-2', 1000)
  paper.releaseAndCredit(u.id, 'pos-2', 1000, -50000)
  assert.equal(paper.paperSnapshot(u.id).totalPnl, -1000)
})

test('paper: reset clears reservations from the previous cycle', () => {
  const u = store.createUser({ email: 'p6@t.co' })
  paper.reserveForPosition(u.id, 'pos-3', 2000)
  paper.resetPaperAccount(u.id)
  const r = paper.releaseAndCredit(u.id, 'pos-3', 2000, 0)
  assert.equal(r.capitalReleased, 0)
  assert.equal(paper.paperSnapshot(u.id).freeCapital, 10000)
})

/* ---------- playbooks ---------- */

test('playbooks: seed loaded with 4 canonicals', () => {
  const list = pb.listPlaybooks()
  assert.ok(list.length >= 4)
  assert.ok(list.every(p => p.published))
  assert.ok(list.some(p => p.canonical))
})

test('playbooks: create + publish + update + delete', () => {
  const u = store.createUser({ email: 'pb@t.co' })
  const created = pb.createPlaybook(u.id, { ownerName: 'me', title: 'test', asset: 'BTC', signalConditions: [{ field: 'rsi14', op: '<', value: 30 }] })
  assert.equal(created.published, false)
  pb.publishPlaybook(u.id, created.id)
  const updated = pb.updatePlaybook(u.id, created.id, { title: 'renamed' })
  assert.equal(updated.title, 'renamed')
  pb.deletePlaybook(u.id, created.id)
  assert.equal(pb.getPlaybook(created.id), null)
})

test('playbooks: non-owner cannot update', () => {
  const a = store.createUser({ email: 'own1@t.co' })
  const b = store.createUser({ email: 'own2@t.co' })
  const created = pb.createPlaybook(a.id, { ownerName: 'a', title: 'x', asset: 'BTC' })
  assert.throws(() => pb.updatePlaybook(b.id, created.id, { title: 'hijack' }))
})

/* ---------- allocations ---------- */

test('allocations: follow reserves capital and increments counters', () => {
  const u = store.createUser({ email: 'al@t.co' })
  const a = alloc.follow(u.id, 'pb-btc-etf-flow-follow', 500)
  assert.equal(a.allocatedUsd, 500)
  assert.equal(paper.paperAccount(u.id).freeCapital, 9500)
  const stats = alloc.followerStats('pb-btc-etf-flow-follow')
  assert.equal(stats.followerCount, 1)
  assert.equal(stats.totalCapitalUsd, 500)
})

test('allocations: unfollow releases capital', () => {
  const u = store.createUser({ email: 'al2@t.co' })
  alloc.follow(u.id, 'pb-eth-oversold-bounce', 800)
  const closed = alloc.unfollow(u.id, 'pb-eth-oversold-bounce')
  assert.ok(closed.closedAt)
  assert.equal(paper.paperAccount(u.id).freeCapital, 10000)
})

test('allocations: unfollow when not allocated throws', () => {
  const u = store.createUser({ email: 'al3@t.co' })
  assert.throws(() => alloc.unfollow(u.id, 'pb-btc-etf-flow-follow'))
})

/* ---------- assayer ---------- */

test('assayer: heuristic produces valid playbook when prompted to build', async () => {
  const r = await assayer.chat({ messages: [{ role: 'user', content: 'build a BTC oversold bounce' }] })
  assert.ok(r.reply)
  assert.ok(r.playbook)
  assert.equal(r.playbook.asset, 'BTC')
  assert.ok(Array.isArray(r.playbook.signalConditions) && r.playbook.signalConditions.length >= 1)
})

test('assayer: Q&A intent replies without playbook', async () => {
  const r = await assayer.chat({ messages: [{ role: 'user', content: 'hello there' }] })
  assert.ok(r.reply)
  assert.equal(r.playbook, null)
})
