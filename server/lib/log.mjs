/**
 * Zero-dependency structured JSON logger.
 * Set LOG_LEVEL=debug|info|warn|error (default info).
 * Set LOG_PRETTY=1 for human-friendly local dev output.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const CURRENT = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info
const PRETTY  = process.env.LOG_PRETTY === '1'
const SERVICE = process.env.LOG_SERVICE || 'nightwatch-ai'

function emit(level, fields, msg) {
  if (LEVELS[level] < CURRENT) return
  const line = { time: new Date().toISOString(), level, service: SERVICE, msg, ...fields }
  if (!PRETTY) { process.stdout.write(JSON.stringify(line) + '\n'); return }
  const colored = level === 'error' ? `\x1b[31m${level}\x1b[0m`
                : level === 'warn'  ? `\x1b[33m${level}\x1b[0m`
                : level === 'info'  ? `\x1b[36m${level}\x1b[0m`
                : `\x1b[90m${level}\x1b[0m`
  const extras = Object.keys(fields || {}).length ? ' ' + JSON.stringify(fields) : ''
  process.stdout.write(`${line.time} ${colored} ${msg}${extras}\n`)
}

export const logger = {
  debug: (fields, msg) => (typeof fields === 'string' ? emit('debug', {}, fields) : emit('debug', fields, msg)),
  info:  (fields, msg) => (typeof fields === 'string' ? emit('info',  {}, fields) : emit('info',  fields, msg)),
  warn:  (fields, msg) => (typeof fields === 'string' ? emit('warn',  {}, fields) : emit('warn',  fields, msg)),
  error: (fields, msg) => (typeof fields === 'string' ? emit('error', {}, fields) : emit('error', fields, msg)),
  child: (bindings) => ({
    debug: (f, m) => logger.debug({ ...bindings, ...(typeof f === 'object' ? f : {}) }, typeof f === 'string' ? f : m),
    info:  (f, m) => logger.info({  ...bindings, ...(typeof f === 'object' ? f : {}) }, typeof f === 'string' ? f : m),
    warn:  (f, m) => logger.warn({  ...bindings, ...(typeof f === 'object' ? f : {}) }, typeof f === 'string' ? f : m),
    error: (f, m) => logger.error({ ...bindings, ...(typeof f === 'object' ? f : {}) }, typeof f === 'string' ? f : m),
  }),
}
