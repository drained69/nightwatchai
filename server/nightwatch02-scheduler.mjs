/**
 * Alpha of the Day daily scheduler.
 *
 * In-process, timezone-aware (default 02:00 UTC), with catch-up:
 *   1. On start, if today's brief file is missing AND today's fire time has
 *      already passed, generate immediately (a server that came up at 04:00
 *      UTC must not skip the 02:00 brief).
 *   2. Compute the next fire time (>= now) in the configured timezone.
 *   3. Sleep until that instant, run the pipeline, then reschedule.
 *
 * A single setTimeout is cheaper than a per-minute poll and cannot miss a
 * fire on a busy event loop the way a `Math.floor(nowMinutes) === 120` check
 * can. We DO cap the setTimeout at 24h and reschedule to defend against V8's
 * ~24.85-day timeout max.
 *
 * Env:
 *   NIGHTWATCH_02_HOUR      hour of day (0-23) in UTC (default 2)
 *   NIGHTWATCH_02_MINUTE    minute (0-59)          (default 0)
 *   NIGHTWATCH_02_ENABLED   '0' disables the scheduler (default enabled)
 */
import { logger } from './lib/log.mjs'
import { runDailyPipeline, loadBriefByDate, briefDateKey } from './nightwatch02.mjs'

const MAX_TIMEOUT_MS = 6 * 60 * 60 * 1000 // reschedule every 6h at worst

function config() {
  const hour = clamp(Number(process.env.NIGHTWATCH_02_HOUR ?? 2), 0, 23)
  const minute = clamp(Number(process.env.NIGHTWATCH_02_MINUTE ?? 0), 0, 59)
  return { hour, minute, enabled: process.env.NIGHTWATCH_02_ENABLED !== '0' }
}
function clamp(n, lo, hi) { return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : lo }

/**
 * Compute the next fire time >= `now` in UTC.
 * Exported so tests can pin `now` and assert scheduling math.
 */
export function nextFireAt(now = new Date(), hour = 2, minute = 0) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0, 0))
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1)
  return next
}

/** true when we should catch up: today's fire has passed AND no brief for today exists. */
export function shouldCatchUp(now = new Date(), hour = 2, minute = 0) {
  const todayFire = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0, 0))
  if (now.getTime() < todayFire.getTime()) return false
  const key = briefDateKey(now)
  return !loadBriefByDate(key)
}

class Scheduler {
  constructor(deps) {
    this.deps = deps
    this.timer = null
    this.nextAt = null
    this.running = false
    this.lastRun = null
    this.enabled = false
  }
  start() {
    const cfg = config()
    this.enabled = cfg.enabled
    if (!cfg.enabled) {
      logger.info('Alpha of the Day scheduler disabled (NIGHTWATCH_02_ENABLED=0)')
      return
    }
    this.hour = cfg.hour; this.minute = cfg.minute
    // Catch-up: if we boot after today's 02:00 and there's no brief for today,
    // generate one now so users landing on the page see today's brief.
    if (shouldCatchUp(new Date(), this.hour, this.minute)) {
      logger.info({ date: briefDateKey() }, 'Alpha of the Day catch-up: brief missing for today, generating now')
      this._runOnce().catch(err => logger.error({ err: err.message }, 'catch-up failed'))
    }
    this._schedule()
  }
  _schedule() {
    if (!this.enabled) return
    const now = new Date()
    this.nextAt = nextFireAt(now, this.hour, this.minute)
    const delay = Math.min(MAX_TIMEOUT_MS, this.nextAt.getTime() - now.getTime())
    logger.info({ at: this.nextAt.toISOString(), delayMs: delay }, 'Alpha of the Day next fire scheduled')
    this.timer = setTimeout(() => this._tick(), delay)
    this.timer.unref?.()
  }
  async _tick() {
    // If the delay was capped (>6h to fire), just reschedule.
    if (Date.now() < (this.nextAt?.getTime() ?? 0)) { this._schedule(); return }
    await this._runOnce()
    this._schedule()
  }
  async _runOnce() {
    if (this.running) return null
    this.running = true
    try {
      const started = Date.now()
      const { brief, email } = await runDailyPipeline(this.deps)
      this.lastRun = { at: new Date().toISOString(), briefId: brief.id, delivered: email.delivered, failed: email.failed, ms: Date.now() - started }
      return this.lastRun
    } catch (err) {
      logger.error({ err: err.message }, 'Alpha of the Day daily pipeline threw')
      this.lastRun = { at: new Date().toISOString(), error: err.message }
      return this.lastRun
    } finally {
      this.running = false
    }
  }
  /** External trigger (dev/admin endpoint). Bypasses schedule; still de-dupes concurrent runs. */
  async runNow() { return this._runOnce() }
  status() {
    return {
      enabled: this.enabled,
      hourUtc: this.hour,
      minuteUtc: this.minute,
      nextFireAt: this.nextAt?.toISOString() || null,
      running: this.running,
      lastRun: this.lastRun,
    }
  }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null }
}

export function makeScheduler(deps) { return new Scheduler(deps) }
