/**
 * NIGHTWATCH AI — domain engine.
 *
 * Natural-language AI trading research workstation for the Bitget AI Trading Desk track.
 * The AI researches, extracts information, synthesizes evidence, and generates signals.
 * The human always makes the final trading decision. NightWatch never routes live orders.
 *
 * Skill vocabulary matches Bitget `bitget-signal` skill names so a Bitget MCP sidecar can
 * later replace the local skill bodies without changing the UI contract:
 *   news-briefing · market-intel · macro-analyst · sentiment-analyst · technical-analysis
 */

/**
 * SECURITY: session state must be user-scoped so that when User A signs out and
 * User B signs in on the same browser, B never sees A's watchlist, reports,
 * decisions, or paper positions. The public STORAGE_KEY is the anonymous slot;
 * `storageKeyFor(userId)` returns the per-user slot.
 */
export const STORAGE_KEY_PREFIX = 'nightwatch.session.v3'
export const STORAGE_KEY = `${STORAGE_KEY_PREFIX}.anon`
export const LEGACY_STORAGE_KEYS = ['nightwatch.session.v3', 'nightwatch.session.v2', 'nightwatch.session.v1']

/** Returns the localStorage key that scopes a session to a given user (or the
 *  anonymous slot when no user is signed in). */
export function storageKeyFor(userId) {
  const id = (userId && String(userId).trim()) || 'anon'
  // Only allow the id chars we actually issue (usr_ + hex) — belt & braces
  // against odd values crossing the boundary.
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '')
  return `${STORAGE_KEY_PREFIX}.${safe || 'anon'}`
}
export const RESEARCH_STEP_MS = 520

export const BITGET_SIGNAL_SKILLS = [
  { id: 'news-briefing',       label: 'News',       purpose: 'Aggregates print/wire/social news, extracts expectation gaps.' },
  { id: 'market-intel',        label: 'Market',     purpose: 'ETF flows, whale activity, DeFi TVL, on-chain intelligence.' },
  { id: 'technical-analysis',  label: 'Technical',  purpose: '23 indicators / 6 categories: trend, momentum, volatility, volume.' },
  { id: 'sentiment-analyst',   label: 'Sentiment',  purpose: 'Fear & Greed, long/short ratio, funding, positioning.' },
  { id: 'macro-analyst',       label: 'Macro',      purpose: 'Fed policy, DXY, rates, cross-asset regime.' },
]

export const INTENTS = ['research', 'thesis-test', 'portfolio-impact', 'execution-help', 'review', 'find-opportunities']

/* ------------------------------------------------------------------ Universe */

/** @typedef {{ symbol: string, name: string, class: 'crypto'|'tokenized-equity', sector: string, price: number, change24h: number, change7d: number, marketCap: number, momentum: 'HIGH'|'MED'|'LOW', volatility: 'HIGH'|'MED'|'LOW', liquidity: 'HIGH'|'MED'|'LOW', beta: number, event?: string, atrPct: number }} MarketRow */

export const DEMO_UNIVERSE = [
  // TOKENIZED U.S. EQUITIES — primary universe (Bitget spot R-pairs like RNVDAUSDT track the real NASDAQ/NYSE prints).
  { symbol: 'NVDA',  name: 'NVIDIA',       class: 'tokenized-equity', sector: 'Semis / AI',     price: 212.50, change24h: -2.4, change7d: -1.4, marketCap: 5200000000000, momentum: 'MED',  volatility: 'MED',  liquidity: 'HIGH', beta: 1.62, event: 'Anthropic stake chatter', atrPct: 3.4 },
  { symbol: 'TSLA',  name: 'Tesla',        class: 'tokenized-equity', sector: 'Auto / AI',      price: 358.80, change24h: -1.6, change7d: -2.2, marketCap: 1150000000000, momentum: 'MED',  volatility: 'HIGH', liquidity: 'HIGH', beta: 1.98, event: 'Robotaxi update',  atrPct: 4.2 },
  { symbol: 'AAPL',  name: 'Apple',        class: 'tokenized-equity', sector: 'Consumer tech',  price: 332.00, change24h: -0.3, change7d:  0.8, marketCap: 4900000000000, momentum: 'LOW',  volatility: 'LOW',  liquidity: 'HIGH', beta: 1.14, event: 'None',             atrPct: 1.6 },
  { symbol: 'MSFT',  name: 'Microsoft',    class: 'tokenized-equity', sector: 'Cloud / AI',     price: 498.40, change24h:  1.1, change7d:  1.6, marketCap: 3700000000000, momentum: 'MED',  volatility: 'LOW',  liquidity: 'HIGH', beta: 1.02, event: 'None',             atrPct: 1.8 },
  { symbol: 'AMZN',  name: 'Amazon',       class: 'tokenized-equity', sector: 'Retail / Cloud', price: 254.60, change24h: -0.8, change7d:  0.9, marketCap: 2700000000000, momentum: 'LOW',  volatility: 'MED',  liquidity: 'HIGH', beta: 1.28, event: 'None',             atrPct: 2.0 },
  { symbol: 'GOOGL', name: 'Alphabet',     class: 'tokenized-equity', sector: 'Search / AI',    price: 343.20, change24h:  1.5, change7d:  2.4, marketCap: 4150000000000, momentum: 'MED',  volatility: 'LOW',  liquidity: 'HIGH', beta: 1.10, event: 'Nuclear PPAs',     atrPct: 1.9 },
  { symbol: 'META',  name: 'Meta',         class: 'tokenized-equity', sector: 'Social / AI',    price: 660.10, change24h:  2.3, change7d:  3.7, marketCap: 1650000000000, momentum: 'HIGH', volatility: 'MED',  liquidity: 'HIGH', beta: 1.34, event: 'Ad-tier growth',   atrPct: 2.4 },
  { symbol: 'AMD',   name: 'Advanced Micro Devices', class: 'tokenized-equity', sector: 'Semis / AI', price: 486.00, change24h: -5.2, change7d: -3.3, marketCap: 790000000000, momentum: 'HIGH', volatility: 'HIGH', liquidity: 'HIGH', beta: 1.72, event: 'MI400 launch',    atrPct: 3.2 },
  { symbol: 'COIN',  name: 'Coinbase',     class: 'tokenized-equity', sector: 'Crypto exchange',price: 180.20, change24h:  4.0, change7d:  6.6, marketCap:   45500000000, momentum: 'HIGH', volatility: 'HIGH', liquidity: 'HIGH', beta: 2.31, event: 'Volume beat',      atrPct: 5.4 },
  { symbol: 'MSTR',  name: 'MicroStrategy',class: 'tokenized-equity', sector: 'BTC treasury',   price: 131.70, change24h:  2.5, change7d:  4.4, marketCap:   38500000000, momentum: 'MED',  volatility: 'HIGH', liquidity: 'HIGH', beta: 2.62, event: 'BTC beta',         atrPct: 6.2 },
  // CRYPTO CORRELATION SET — kept for macro context, BTC-beta calibration and cross-asset risk-regime reads.
  { symbol: 'BTC',   name: 'Bitcoin',      class: 'crypto',           sector: 'Store of value', price: 77800, change24h:  1.3, change7d:  3.1, marketCap: 1550000000000, momentum: 'MED',  volatility: 'MED',  liquidity: 'HIGH', beta: 1.00, event: 'ETF flows',        atrPct: 2.6 },
  { symbol: 'ETH',   name: 'Ethereum',     class: 'crypto',           sector: 'Smart contract', price:   2508, change24h:  1.2, change7d:  2.4, marketCap:  303000000000, momentum: 'MED',  volatility: 'MED',  liquidity: 'HIGH', beta: 1.18, event: 'Staking flows',    atrPct: 3.1 },
  { symbol: 'SOL',   name: 'Solana',     class: 'crypto',           sector: 'Smart contract', price:    102, change24h:  1.9, change7d:  4.4, marketCap:   55000000000, momentum: 'MED',  volatility: 'HIGH', liquidity: 'HIGH', beta: 1.45, event: 'Firedancer',       atrPct: 4.8 },
  { symbol: 'BNB',   name: 'BNB',          class: 'crypto',           sector: 'Exchange',       price:    722, change24h:  0.8, change7d:  1.4, marketCap:  100000000000, momentum: 'LOW',  volatility: 'MED',  liquidity: 'HIGH', beta: 0.92, event: 'None',             atrPct: 2.3 },
  { symbol: 'XRP',   name: 'XRP',          class: 'crypto',           sector: 'Payments',       price:   1.40, change24h:  4.3, change7d:  5.1, marketCap:   84000000000, momentum: 'HIGH', volatility: 'MED',  liquidity: 'HIGH', beta: 0.98, event: 'None',             atrPct: 3.4 },
  { symbol: 'DOGE',  name: 'Dogecoin',     class: 'crypto',           sector: 'Meme',           price: 0.0840, change24h:  0.7, change7d: -2.6, marketCap:   12600000000, momentum: 'LOW',  volatility: 'HIGH', liquidity: 'HIGH', beta: 1.72, event: 'ETF wind-down',    atrPct: 6.1 },
  { symbol: 'AVAX',  name: 'Avalanche',    class: 'crypto',           sector: 'Smart contract', price:   7.50, change24h:  2.7, change7d:  1.2, marketCap:    3200000000, momentum: 'MED',  volatility: 'HIGH', liquidity: 'HIGH', beta: 1.31, event: 'None',             atrPct: 4.0 },
  { symbol: 'ADA',   name: 'Cardano',      class: 'crypto',           sector: 'Smart contract', price:  0.209, change24h:  2.4, change7d: -1.8, marketCap:    7400000000, momentum: 'LOW',  volatility: 'MED',  liquidity: 'HIGH', beta: 1.10, event: 'None',             atrPct: 3.6 },
]

export const CRYPTO_SYMBOLS = new Set(DEMO_UNIVERSE.filter(a => a.class === 'crypto').map(a => a.symbol))

/* ------------------------------------------------------------------- Session */

const seedLogs = [
  { id: 'log-1', time: '00:00:00', type: 'BOOT', message: 'NIGHTWATCH AI online', detail: '18 assets in universe · 5 research skills armed' },
  { id: 'log-2', time: '00:00:01', type: 'BOOT', message: 'Awaiting trader question', detail: 'Type a research question to invoke the skill pack' },
]

// US equities first — this desk is built around event-driven US-equity / tokenized-stock trading.
const seedWatchlist = ['NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMD', 'META', 'MSTR', 'COIN', 'BTC', 'ETH']

const seedMemory = {
  thesis: 'Research any name in the universe. Follow the tape only when news, technicals, sentiment and macro agree; sit out when they diverge.',
  preferences: {
    risk: 'MODERATE',                          // CONSERVATIVE · MODERATE · AGGRESSIVE
    horizon: 'SWING',                          // INTRADAY · SWING · POSITION
    style: 'EVENT_DRIVEN',                     // EVENT_DRIVEN · TREND_FOLLOW · MEAN_REVERT · MACRO
    minConfidence: 0.65,
    minNetEdge: 0.008,
    maxPositionPct: 0.15,                      // % of NAV per position
    nav: 25000,
  },
  patterns: [
    { id: 'chase-post-print',   name: 'Chase post-print without liquidity',       occurrences: 2, lesson: 'Wait for spread ≤ 12bps before following a print.' },
    { id: 'crypto-beta-blowoff',name: 'Chase crypto-beta names during blow-off',  occurrences: 1, lesson: 'Trim exposure when BTC 24h range > 2× ATR.' },
  ],
  analogs: [
    { id: 'an-nvda-2024-08', period: '2024-08', asset: 'NVDA', bucket: 'FOLLOW',  setup: 'Beat + HIGH liquidity + BTC risk-on',       outcome: 'Follow +3.1% into cash open', similarity: 0.81, lesson: 'Print + HIGH liquidity + crypto risk-on = follow setup.' },
    { id: 'an-nvda-2024-05', period: '2024-05', asset: 'NVDA', bucket: 'FADE',    setup: 'Tokenized NVDA +3% into print; liquidity MED', outcome: 'Fade −1.8% overnight',       similarity: 0.62, lesson: 'Do not follow a print when tokenized liquidity is MED.' },
    { id: 'an-btc-2024-10',  period: '2024-10', asset: 'BTC',  bucket: 'FOLLOW',  setup: 'Spot ETF net inflow week + BTC breakout',     outcome: 'Follow +9.4% over 6 sessions', similarity: 0.71, lesson: 'BTC follows spot flows more than futures OI.' },
    { id: 'an-mstr-2024-03', period: '2024-03', asset: 'MSTR', bucket: 'FADE',    setup: 'MSTR premium to NAV > 2.0x during BTC surge', outcome: 'Fade −11% over 4 sessions',   similarity: 0.68, lesson: 'MSTR premium mean-reverts when BTC parabola breaks.' },
  ],
}

export const initialSession = () => ({
  version: 3,
  universe: DEMO_UNIVERSE,
  markets: DEMO_UNIVERSE,
  watchlist: seedWatchlist,
  memory: seedMemory,
  logs: seedLogs,
  reports: [],
  signals: [],
  theses: [],
  positions: [],
  decisions: [],
  reviews: [],
  news: [],
  newsAlerts: [],
  newsCursor: 3,
  liveTrace: [],
  stage: 'IDLE',
  activeReportId: null,
  pendingPositionId: null,
  provider: { engine: 'LOCAL', bitgetMcp: false, xai: false },
  settings: {
    paperOnly: true,
    dataMode: 'LIVE',                        // LIVE (adapter attached) · OFFLINE (fallback)
    riskProfile: 'MODERATE',
    stopBufferPct: 0.02,                     // used when a research report doesn't return an invalidation
  },
})

/* -------------------------------------------------------- Session persistence */

export function coerceSession(parsed) {
  const seed = initialSession()
  if (!parsed || typeof parsed !== 'object') return seed
  if (parsed.version !== 3) return migrateFromLegacy(parsed)
  return {
    ...seed,
    ...parsed,
    memory: { ...seed.memory, ...(parsed.memory || {}), preferences: { ...seed.memory.preferences, ...(parsed.memory?.preferences || {}) } },
    settings: { ...seed.settings, ...(parsed.settings || {}), paperOnly: true },
    universe: seed.universe,                              // universe always seeded from source
    markets: Array.isArray(parsed.markets) && parsed.markets.length ? parsed.markets : seed.markets,
    logs: Array.isArray(parsed.logs) ? parsed.logs.slice(-160) : seed.logs,
    reports: Array.isArray(parsed.reports) ? parsed.reports : [],
    signals: Array.isArray(parsed.signals) ? parsed.signals : [],
    theses: Array.isArray(parsed.theses) ? parsed.theses : [],
    positions: Array.isArray(parsed.positions) ? parsed.positions : [],
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
    reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [],
    news: Array.isArray(parsed.news) ? parsed.news.slice(0, 60) : [],
    newsAlerts: Array.isArray(parsed.newsAlerts) ? parsed.newsAlerts.slice(0, 20) : [],
    newsCursor: typeof parsed.newsCursor === 'number' ? parsed.newsCursor : 0,
    watchlist: Array.isArray(parsed.watchlist) && parsed.watchlist.length ? parsed.watchlist : seed.watchlist,
  }
}

export function migrateFromLegacy(parsed) {
  const seed = initialSession()
  const settings = { ...seed.settings, ...(parsed?.settings || {}), paperOnly: true }
  // v1/v2 stored a tightly-scripted overnight desk. Keep NAV & watchlist prefs if useful; drop autonomous positions.
  const prefs = { ...seed.memory.preferences }
  if (parsed?.settings?.nav) prefs.nav = parsed.settings.nav
  if (parsed?.settings?.minConfidence) prefs.minConfidence = parsed.settings.minConfidence
  if (parsed?.settings?.minNetEdge) prefs.minNetEdge = parsed.settings.minNetEdge
  return {
    ...seed,
    settings,
    memory: { ...seed.memory, preferences: prefs },
    logs: [...seed.logs, { id: `log-migrate-${Date.now()}`, time: new Date().toISOString().slice(11, 19), type: 'BOOT', message: `Session migrated from ${parsed?.version === 2 ? 'v2' : 'v1'}`, detail: 'universe expanded · engine rebuilt' }],
  }
}

/**
 * Load session state for `userId`. Falls back to a fresh initialSession() if
 * nothing is stored — critically, we do NOT bleed the anon slot into a signed-in
 * user, nor a signed-in user into anon.
 *
 * Legacy unscoped keys (v1/v2/v3-flat) are read only into the anon slot on
 * first boot and then deleted — signed-in users always start clean if the
 * server does not hand them state.
 */
export function loadSession(userId) {
  try {
    if (typeof localStorage === 'undefined') return initialSession()
    const key = storageKeyFor(userId)
    const raw = localStorage.getItem(key)
    if (raw) return coerceSession(JSON.parse(raw))
    // Only migrate legacy shared keys into the anon slot — never into a user
    // slot. Anything a signed-in user cares about must round-trip through the
    // server, not through shared browser state.
    if (!userId) {
      for (const legacyKey of LEGACY_STORAGE_KEYS) {
        const legacy = localStorage.getItem(legacyKey)
        if (legacy) {
          let next
          try { next = migrateFromLegacy(JSON.parse(legacy)) } catch { next = initialSession() }
          saveSession(next, null)
          try { localStorage.removeItem(legacyKey) } catch { /* ignore */ }
          return next
        }
      }
    }
  } catch { /* storage unavailable in private mode */ }
  return initialSession()
}

export function saveSession(session, userId) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(storageKeyFor(userId), JSON.stringify(session))
  } catch { /* ignore */ }
}

/**
 * Sign-out helper: purge every per-user session slot from localStorage (all
 * users, not just the current one, because we can't always know which one the
 * browser last held), plus the legacy shared keys. Public prefs like the
 * disclaimer ack are preserved.
 */
export function purgeAllSessions() {
  try {
    if (typeof localStorage === 'undefined') return
    const doomed = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      if (k.startsWith(STORAGE_KEY_PREFIX + '.') || LEGACY_STORAGE_KEYS.includes(k)) doomed.push(k)
    }
    for (const k of doomed) { try { localStorage.removeItem(k) } catch { /* ignore */ } }
  } catch { /* ignore */ }
}

/* -------------------------------------------------------------------- Formatters */

export function fmtPrice(value) {
  if (value == null || Number.isNaN(value)) return '—'
  if (value >= 1000) return Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (value >= 10)   return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}
export function fmtPct(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return '—'
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`
}
export function fmtAbs(value) {
  if (value == null || Number.isNaN(value)) return '—'
  return `${value >= 0 ? '+' : ''}$${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}
export function fmtCap(value) {
  if (value == null) return '—'
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9)  return `${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6)  return `${(value / 1e6).toFixed(0)}M`
  return String(value)
}
export function nowClock() { return new Date().toISOString().slice(11, 19) }
export function shortId(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}` }

/* --------------------------------------------------------------- Logging util */

export function addLog(session, type, message, detail = '') {
  const time = nowClock()
  const log = { id: `log-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, time, type, message, detail }
  return { ...session, logs: [...(session.logs || []), log].slice(-160) }
}

/* ---------------------------------------------------------- Intent detection */

export function classifyIntent(question) {
  const q = (question || '').trim()
  const lower = q.toLowerCase()
  if (!q) return { intent: 'research', asset: null, question: q }
  if (lower.startsWith('/review')                       || /review (my|last|the)/.test(lower)) return { intent: 'review', asset: null, question: q }
  if (lower.startsWith('/thesis') || lower.startsWith('/challenge') || /(stress[- ]?test|challenge|invalidat|counter)/i.test(lower)) return { intent: 'thesis-test', asset: inferAsset(q), question: q, thesis: q }
  if (/(portfolio|book|expos|beta|allocation).*(impact|effect|affect|change)/i.test(lower) || /(how does .* affect|impact on)/i.test(lower)) return { intent: 'portfolio-impact', asset: inferAsset(q), question: q }
  if (/(execute|order|slice|entry|stop|target|position size|size the trade|how much should)/i.test(lower)) return { intent: 'execution-help', asset: inferAsset(q), question: q }
  if (/(strongest|best|find|scan|opportunit|overnight|top)/i.test(lower) && !/(NVDA|AAPL|TSLA|BTC|ETH|SOL|MSFT|AMZN|GOOG|META|AMD|COIN|MSTR|BNB|XRP|DOGE|ADA|AVAX)/i.test(q)) return { intent: 'find-opportunities', asset: null, question: q }
  return { intent: 'research', asset: inferAsset(q), question: q }
}

export function inferAsset(question) {
  const q = (question || '').toUpperCase()
  const stripped = q.replace(/[^A-Z0-9 ]/g, ' ')
  for (const asset of DEMO_UNIVERSE) {
    const rx = new RegExp(`\\b${asset.symbol}\\b`)
    if (rx.test(stripped)) return asset.symbol
  }
  for (const asset of DEMO_UNIVERSE) {
    if (q.includes(asset.name.toUpperCase())) return asset.symbol
  }
  return null
}

const GENERIC_QUESTION_WORDS = new Set(`
a an the is are was were be been being am of in on at to for from with without into onto over under by
i you he she it we they me him her us them my your his its our their this that these those there here
and or not no nor but if then than so as do does did done can could should would will shall may might must
what why how when where which who whom whose
doing going get gets got make makes made take takes want wants need needs think seems looks mean means
just only even still also both each every many much some any all very really more most less least new old
big small high low higher lower above below top bottom dip dips drop drops rally rallies gain gains fall falls rise rises
buy sell buying selling bought sold long short hold holding holds trade trades trading trader invest investing investment
research analyze analysis check look looking give tell explain report review thesis stress test challenge
price prices move moves moving moved pump dump breakout breakdown setup opportunity opportunities scan
market markets tape day days week weeks today tonight tomorrow yesterday overnight weekend now current currently
good bad best worst strong weak strongest weakest bullish bearish neutral right worth shouldnt doesnt dont isnt arent
crypto cryptocurrency stock stocks equity equities token tokens coin listing listed ipo etf airdrop presale
altcoin altcoins memecoin stablecoin bitcoin ethereum solana dogecoin cardano avalanche coinbase
portfolio position positions size sizing entry stop target risk reward pnl profit loss exposure allocation
news headline catalyst sentiment volume liquidity funding correlation regime macro fed rate rates dollar
question questions ticker tickers random name names asset assets symbol symbols universe coverage covered
support supported please yes yeah ok okay hey hi hello about around up down out side sides play plays
call calls put puts order orders execute execution slice simulate simulation paper real money cash
flow flows stake staking yield apy tvl dominance halving
everything anything something nothing someone anyone
`.split(/\s+/).filter(Boolean))

const UNIVERSE_WORDS = new Set(
  DEMO_UNIVERSE.flatMap(a => [a.symbol.toLowerCase(), ...a.name.toLowerCase().split(/\s+/)])
)

/**
 * Names mentioned in a question that inferAsset could NOT resolve — i.e. the
 * user asked about an asset outside the coverage universe (e.g. "Dangote IPO").
 * Returns lowercase candidates; empty array means the question is generic and
 * the usual BTC default is safe.
 */
export function uncoveredAssetCandidates(question) {
  const q = (question || '').toLowerCase()
  const tokens = q.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  const candidates = []
  for (const t of tokens) {
    if (t.length < 3 || !/^[a-z]/.test(t)) continue          // skip numbers, 1-2 letter fragments
    if (GENERIC_QUESTION_WORDS.has(t) || UNIVERSE_WORDS.has(t)) continue
    if (!candidates.includes(t)) candidates.push(t)
  }
  return candidates
}

/* ------------------------------------------ Deterministic per-asset seed hash */

function hash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
  return Math.abs(h)
}
/** Deterministic value in [0,1) from a seed and a salt. Stable across reloads. */
function rand(seed, salt = '') {
  const h = hash(`${seed}::${salt}`) * 2654435761
  return ((h >>> 0) % 1000000) / 1000000
}

/* -------------------------------------------------------- Skill (tool) engine */

/**
 * Each skill returns a SkillResult with the same shape a Bitget MCP `bitget-signal`
 * response would produce. When `ctx` carries real data (live news items, real
 * indicators on the market row, real macro snapshot — injected by the server
 * adapter), skills compute from the real tape. Without ctx they fall back to
 * deterministic seeded values so tests and the offline demo stay reproducible.
 * @param {string} symbol
 * @param {MarketRow} market
 * @param {{ news?: Array, macro?: Object, btcChange24h?: number }} ctx
 */
function runNewsBriefing(symbol, market, ctx = {}) {
  const liveNews = Array.isArray(ctx.news) ? ctx.news.filter(n => n && n.headline) : []
  if (liveNews.length) {
    // ---- REAL news path ----
    const ups   = liveNews.filter(n => n.direction === 'UP').length
    const downs = liveNews.filter(n => n.direction === 'DOWN').length
    const avgMag = liveNews.reduce((s, n) => s + (n.magnitude || 0), 0) / liveNews.length
    const direction = ups > downs ? 'UP' : downs > ups ? 'DOWN' : 'MIXED'
    const beat = direction === 'UP'
    const highSev = liveNews.filter(n => n.severity === 'HIGH')
    const top = liveNews[0]
    const confidence = Math.min(0.95, 0.55 + avgMag * 0.3 + (highSev.length ? 0.05 : 0))
    return {
      skill: 'news-briefing',
      title: `${symbol} · ${liveNews.length} live headline${liveNews.length === 1 ? '' : 's'} · tape ${direction.toLowerCase()}`,
      confidence: Number(confidence.toFixed(2)),
      excerpt: `${ups} bullish / ${downs} bearish / ${liveNews.length - ups - downs} mixed · latest: ${top.headline.slice(0, 90)}`,
      source: `live wire ingest · ${[...new Set(liveNews.map(n => n.source))].slice(0, 3).join(' + ')}`,
      data: {
        catalyst: top.headline,
        beat,
        consensus: null,
        printed: null,
        expectationGap: `${direction} bias from ${liveNews.length} classified headlines (avg magnitude ${(avgMag * 100).toFixed(0)}%)`,
        newsDirection: direction,
        newsCounts: { up: ups, down: downs, mixed: liveNews.length - ups - downs, highSeverity: highSev.length },
        keyPoints: liveNews.slice(0, 4).map(n => `${n.severity === 'HIGH' ? '⚠ ' : ''}${n.headline} — ${n.source}${n.direction !== 'MIXED' ? ` (${n.direction.toLowerCase()} ${Math.round((n.magnitude || 0) * 100)}%)` : ''}`),
        newsItems: liveNews.slice(0, 8).map(n => ({ headline: n.headline, url: n.url, source: n.source, publishedAt: n.publishedAt, direction: n.direction, severity: n.severity })),
        sources: [...new Set(liveNews.map(n => n.source))],
        live: true,
      },
    }
  }
  // ---- seeded fallback (offline demo / tests) ----
  const beat = rand(symbol, 'news-beat') > 0.35
  const isCrypto = market.class === 'crypto'
  const consensus = isCrypto ? null : (market.price * (1 - 0.011)).toFixed(2)
  const printed   = isCrypto ? null : (market.price * (1 + 0.008)).toFixed(2)
  const gap       = isCrypto ? null : `${beat ? '+' : '-'}${(0.6 + rand(symbol, 'gap') * 1.4).toFixed(2)}% vs consensus`
  const catalystByAsset = {
    NVDA: 'Data-center revenue print vs consensus',
    TSLA: 'Robotaxi progress update',
    AAPL: 'Services growth commentary',
    MSFT: 'Azure AI capacity commentary',
    AMZN: 'AWS growth commentary',
    GOOGL:'Antitrust ruling and search-share update',
    META: 'Reels monetization pace',
    AMD:  'MI300 / MI400 pipeline update',
    COIN: 'Retail volumes vs institutional take rate',
    MSTR: 'BTC treasury NAV commentary',
    BTC:  'Spot ETF net flows week-over-week',
    ETH:  'Staking + L2 activity update',
    SOL:  'Firedancer client progress',
    BNB:  'BNB Chain fee capture',
    XRP:  'RLUSD launch commentary',
    DOGE: 'Retail-driven headlines',
    AVAX: 'Subnet activation activity',
    ADA:  'Governance update',
  }
  const catalyst = catalystByAsset[symbol] || `${market.name} overnight tape`
  return {
    skill: 'news-briefing',
    title: beat ? `${symbol} · positive overnight print` : `${symbol} · mixed overnight tape`,
    confidence: 0.62 + rand(symbol, 'news-conf') * 0.28,
    excerpt: beat ? 'Catalyst supports the tape.' : 'Catalyst is mixed; headline vs details diverge.',
    source: isCrypto ? 'Wires + on-chain flows' : 'MarketWire · verified filings',
    data: {
      catalyst,
      beat,
      consensus,
      printed,
      expectationGap: gap,
      keyPoints: [
        beat ? `Headline print supports ${symbol} direction` : `Headline is constructive but details are mixed`,
        isCrypto ? 'On-chain flow tape agrees with headline' : 'Guidance language is intact',
        rand(symbol, 'risk-mention') > 0.6 ? `Residual risk: ${isCrypto ? 'macro tape' : 'geographic revenue exposure'}` : `No new disclosure risk in the filing`,
      ],
      sources: isCrypto ? ['CoinDesk', 'Farside flows', 'Verified on-chain tape'] : ['MarketWire', 'Verified filing', 'Call transcript'],
    },
  }
}

function runMarketIntel(symbol, market) {
  const isCrypto = market.class === 'crypto'
  const ind = market.indicators
  const anomaly = ind?.volumeZ != null ? ind.volumeZ > 1 : market.momentum === 'HIGH'
  const volumeZ = ind?.volumeZ != null ? ind.volumeZ : Number((rand(symbol, 'mi-vol') * 3 + (anomaly ? 1.6 : -0.2)).toFixed(2))
  const spreadBps = market.spreadBps != null ? Number(market.spreadBps.toFixed(1)) : 4 + Math.round(rand(symbol, 'mi-spread') * 10)
  return {
    skill: 'market-intel',
    title: anomaly ? `${symbol} · unusual flow` : `${symbol} · normal flow`,
    confidence: ind?.live ? 0.8 : 0.6 + rand(symbol, 'mi-conf') * 0.3,
    excerpt: anomaly ? 'Volume + flow anomaly detected.' : 'Flow is inside recent envelope.',
    source: ind?.live ? 'bitget-spot-tape · live volume + book' : isCrypto ? 'On-chain + spot exchanges' : 'Tokenized book + rToken flow',
    data: {
      volumeZ,
      spreadBps,
      liquidity: market.liquidity,
      volumeUsd24h: market.volumeUsd24h ?? null,
      whaleActivity: isCrypto ? (rand(symbol, 'mi-whale') > 0.5 ? 'Accumulation cluster' : 'Distribution cluster') : `Institutional block ${rand(symbol, 'mi-block') > 0.5 ? 'accumulation' : 'distribution'}`,
      etfFlows: isCrypto && (symbol === 'BTC' || symbol === 'ETH') ? `${(rand(symbol, 'mi-etf') * 800 - 300).toFixed(0)}M net · trailing week` : null,
      dexTvl: isCrypto ? `${(rand(symbol, 'mi-tvl') * 20 + 5).toFixed(1)}B TVL · 7d +${(rand(symbol, 'mi-tvl2') * 8).toFixed(1)}%` : null,
      bookNote: ind?.live ? undefined : isCrypto ? 'Bitget public spot depth · MCP sidecar not attached.' : 'Bitget tokenized-equity book · MCP sidecar not attached.',
      live: Boolean(ind?.live),
    },
  }
}

function runTechnical(symbol, market) {
  const ind = market.indicators
  if (ind?.live) {
    // ---- REAL technicals from Bitget 1h candles ----
    const last = market.price
    return {
      skill: 'technical-analysis',
      title: `${symbol} · ${ind.trend} trend · RSI ${Math.round(ind.rsi14)}`,
      confidence: 0.78,
      excerpt: `${market.change24h >= 0 ? '+' : ''}${Number(market.change24h).toFixed(1)}% / ATR ${ind.atrPct.toFixed(1)}% · live ${ind.candleCount}×1h candles`,
      source: 'bitget-1h-candles · live',
      data: {
        trend: ind.trend,
        rsi: Number(ind.rsi14.toFixed(1)),
        macdCross: ind.macdCross,
        ema20: ind.ema20,
        ema50: ind.ema50,
        support: ind.support ?? Number((last * 0.985).toFixed(2)),
        resistance: ind.resistance ?? Number((last * 1.015).toFixed(2)),
        atrPct: ind.atrPct,
        change7d: ind.change7d != null ? Number((ind.change7d * 100).toFixed(2)) : market.change7d,
        volumeZ: ind.volumeZ ?? null,
        indicatorsBullish: ind.trend === 'UP' ? 14 + Math.round(ind.rsi14 / 10) : 8 + Math.round(ind.rsi14 / 12),
        indicatorsBearish: ind.trend === 'DOWN' ? 14 - Math.round(ind.rsi14 / 20) : 6 + Math.round((100 - ind.rsi14) / 12),
        live: true,
      },
    }
  }
  // ---- seeded fallback ----
  const rsi = Math.round(35 + rand(symbol, 'rsi') * 45)
  const trend = market.change7d > 0 ? 'UP' : market.change7d < 0 ? 'DOWN' : 'SIDE'
  const ma20 = market.price * (1 - rand(symbol, 'ma20') * 0.02)
  const ma50 = market.price * (1 - rand(symbol, 'ma50') * 0.05)
  const support = market.price * (1 - (0.01 + rand(symbol, 'sup') * 0.03))
  const resistance = market.price * (1 + (0.01 + rand(symbol, 'res') * 0.03))
  return {
    skill: 'technical-analysis',
    title: `${symbol} · ${trend} trend · RSI ${rsi}`,
    confidence: 0.55 + rand(symbol, 'ta-conf') * 0.3,
    excerpt: `${market.change24h >= 0 ? '+' : ''}${market.change24h.toFixed(1)}% / ATR ${market.atrPct.toFixed(1)}%`,
    source: 'OHLC series · 23 indicators / 6 categories',
    data: {
      trend,
      rsi,
      macdCross: rand(symbol, 'macd') > 0.5 ? 'BULL' : 'BEAR',
      ema20: Number(ma20.toFixed(2)),
      ema50: Number(ma50.toFixed(2)),
      support: Number(support.toFixed(2)),
      resistance: Number(resistance.toFixed(2)),
      atrPct: market.atrPct,
      indicatorsBullish: 12 + Math.round(rand(symbol, 'ind-b') * 6),
      indicatorsBearish: 6 + Math.round(rand(symbol, 'ind-x') * 5),
    },
  }
}

function runSentiment(symbol, market, ctx = {}) {
  const isCrypto = market.class === 'crypto'
  const score = 0.35 + rand(symbol, 'sent-score') * 0.55
  const crowding = score > 0.75 ? 'HIGH' : score > 0.55 ? 'MED' : 'LOW'
  const tone = score > 0.6 ? 'POSITIVE' : score < 0.45 ? 'NEGATIVE' : 'NEUTRAL'
  return {
    skill: 'sentiment-analyst',
    title: `${symbol} · ${tone} tone · crowding ${crowding}`,
    confidence: 0.55 + rand(symbol, 'sent-conf') * 0.3,
    excerpt: `Fear/greed ${Math.round(35 + rand(symbol, 'fg') * 55)} / 100 · funding ${isCrypto ? (rand(symbol, 'fund') * 0.05 - 0.01).toFixed(3) + '%' : 'n/a'}`,
    source: isCrypto ? 'Alt fear-greed + funding + open interest' : 'Options skew + implied vol surface',
    data: {
      tone,
      score: Number(score.toFixed(2)),
      crowding,
      fearGreed: Math.round(35 + rand(symbol, 'fg') * 55),
      longShortRatio: isCrypto ? Number((0.9 + rand(symbol, 'ls') * 0.6).toFixed(2)) : null,
      fundingRate: isCrypto ? Number((rand(symbol, 'fund') * 0.06 - 0.02).toFixed(4)) : null,
      putCallSkew: isCrypto ? null : Number((0.9 + rand(symbol, 'skew') * 0.4).toFixed(2)),
      ivRank: isCrypto ? null : Math.round(25 + rand(symbol, 'iv') * 55),
    },
  }
}

function runMacro(symbol, market, ctx = {}) {
  const macro = ctx.macro
  const btcChange24h = ctx.btcChange24h ?? DEMO_UNIVERSE.find(a => a.symbol === 'BTC')?.change24h ?? 0
  if (macro?.live) {
    // ---- REAL macro tape (Yahoo: DXY / SPX / NDX / VIX / UST10Y) ----
    const regime = macro.riskRegime === 'RISK_ON' ? 'RISK_ON' : macro.riskRegime === 'RISK_OFF' ? 'RISK_OFF' : 'NEUTRAL'
    const riskOn = regime === 'RISK_ON'
    // Macro "confirms" when regime and the asset's own tape point the same way.
    const confirms = regime === 'NEUTRAL' ? market.change24h > 0
      : riskOn ? market.change24h > 0 : market.change24h < 0
    const dxy = macro.dxy?.last ?? null
    const vix = macro.vix?.last ?? null
    return {
      skill: 'macro-analyst',
      title: `Macro · ${regime.replace('_', '-').toLowerCase()} · ${confirms ? 'confirms' : 'against'} ${symbol}`,
      confidence: 0.75,
      excerpt: `DXY ${dxy?.toFixed(1) ?? '—'}${macro.dxy?.changePct != null ? ` (${macro.dxy.changePct >= 0 ? '+' : ''}${macro.dxy.changePct}%)` : ''} · VIX ${vix?.toFixed(1) ?? '—'} · SPX ${macro.spx?.changePct != null ? `${macro.spx.changePct >= 0 ? '+' : ''}${macro.spx.changePct}%` : '—'} · BTC ${btcChange24h >= 0 ? '+' : ''}${Number(btcChange24h).toFixed(1)}%`,
      source: 'yahoo-finance-public · live cross-asset',
      data: {
        cryptoRegime: regime,
        btcChange24h: Number(Number(btcChange24h).toFixed(2)),
        dxy,
        dxyChangePct: macro.dxy?.changePct ?? null,
        spxChangePct: macro.spx?.changePct ?? null,
        ndxChangePct: macro.ndx?.changePct ?? null,
        vix,
        ust10y: macro.ust10y?.last ?? null,
        ratesRegime: macro.ust10y ? (macro.ust10y.last < 4 ? 'CUTS_AHEAD' : 'HIGHER_FOR_LONGER') : null,
        confirms,
        note: market.class === 'crypto'
          ? `Cross-asset regime is ${regime.replace('_', '-').toLowerCase()}; BTC ${btcChange24h >= 0 ? 'bid' : 'offered'} on the day.`
          : `Tokenized equity — NDX ${macro.ndx?.changePct != null ? `${macro.ndx.changePct >= 0 ? '+' : ''}${macro.ndx.changePct}%` : 'flat'} ${confirms ? 'agrees with' : 'fights'} the ${symbol} tape.`,
        live: true,
        stale: Boolean(macro.stale),
      },
    }
  }
  // ---- seeded fallback ----
  const btc = DEMO_UNIVERSE.find(a => a.symbol === 'BTC')
  const riskOn = (btc?.change24h ?? btcChange24h) > 0 && rand('macro-regime') > 0.35
  const isCrypto = market.class === 'crypto'
  const confirms = isCrypto ? (riskOn && market.change24h > 0) : (riskOn && market.change24h > 0)
  return {
    skill: 'macro-analyst',
    title: `Macro · risk-${riskOn ? 'on' : 'off'} · ${confirms ? 'confirms' : 'against'} ${symbol}`,
    confidence: 0.6 + rand(symbol, 'macro-conf') * 0.28,
    excerpt: `BTC ${btcChange24h >= 0 ? '+' : ''}${Number(btcChange24h).toFixed(1)}% · DXY ${(103 + rand('dxy') * 4).toFixed(1)}`,
    source: 'Cross-asset regime scan',
    data: {
      cryptoRegime: riskOn ? 'RISK_ON' : 'RISK_OFF',
      btcChange24h,
      dxy: Number((103 + rand('dxy') * 4).toFixed(2)),
      ratesRegime: rand('rates') > 0.4 ? 'CUTS_AHEAD' : 'HIGHER_FOR_LONGER',
      confirms,
      note: isCrypto ? 'Crypto is the primary macro driver of this name.' : `Crypto risk appetite ${confirms ? 'agrees with' : 'fights'} the ${symbol} tape.`,
    },
  }
}

const SKILL_RUNNERS = {
  'news-briefing':      runNewsBriefing,
  'market-intel':       runMarketIntel,
  'technical-analysis': runTechnical,
  'sentiment-analyst':  runSentiment,
  'macro-analyst':      runMacro,
}

/** Run all 5 skills for an asset. Order matches BITGET_SIGNAL_SKILLS. */
export function runSkillPack(symbol, market, ctx = {}) {
  return BITGET_SIGNAL_SKILLS.map(spec => SKILL_RUNNERS[spec.id](symbol, market, ctx))
}

/* -------------------------------------------------- Signal / research report */

/**
 * Deterministic signal derived from the 5-skill pack.
 * Returns { direction, confidence, expectedEdge, estimatedFriction, riskAdjustment, netEdge, status, catalyst, ...}
 */
/**
 * Persona weights that shape the composite. Style biases which skills matter.
 * Risk profile biases the composite threshold and the risk adjustment.
 */
export function personaWeights(prefs = {}) {
  const style = prefs.style || 'EVENT_DRIVEN'
  const risk  = prefs.risk  || 'MODERATE'
  const w = { news: 1, flow: 1, tech: 1, sent: 1, macro: 1 }
  if (style === 'EVENT_DRIVEN') { w.news = 1.6; w.macro = 1.2 }
  if (style === 'TREND_FOLLOW') { w.tech = 1.8; w.macro = 1.1 }
  if (style === 'MEAN_REVERT')  { w.tech = 1.4; w.sent = 1.6; w.news = 0.7 }
  if (style === 'MACRO')        { w.macro = 1.9; w.sent = 1.3; w.news = 0.9 }
  // Risk threshold shifts direction cut-offs.
  const bullThreshold = risk === 'CONSERVATIVE' ? 0.62 : risk === 'AGGRESSIVE' ? 0.51 : 0.55
  const bearThreshold = risk === 'CONSERVATIVE' ? 0.38 : risk === 'AGGRESSIVE' ? 0.45 : 0.40
  const riskMultiplier = risk === 'CONSERVATIVE' ? 1.5 : risk === 'AGGRESSIVE' ? 0.7 : 1.0
  return { weights: w, bullThreshold, bearThreshold, riskMultiplier, style, risk }
}

export function synthesizeSignal(symbol, market, skills, prefs) {
  const news = skills.find(s => s.skill === 'news-briefing')
  const mi   = skills.find(s => s.skill === 'market-intel')
  const ta   = skills.find(s => s.skill === 'technical-analysis')
  const sen  = skills.find(s => s.skill === 'sentiment-analyst')
  const mac  = skills.find(s => s.skill === 'macro-analyst')

  const p = personaWeights(prefs)

  const newsScore  = (news.data.beat ? 0.72 : 0.35) * news.confidence * p.weights.news
  const flowScore  = (mi.data.volumeZ > 1 ? 0.7 : 0.42) * mi.confidence * p.weights.flow
  const techScore  = (ta.data.trend === 'UP' ? 0.65 : ta.data.trend === 'DOWN' ? 0.35 : 0.5) * ta.confidence * p.weights.tech
  const sentScore  = (sen.data.score) * sen.confidence * p.weights.sent
  const macroScore = (mac.data.confirms ? 0.7 : 0.35) * mac.confidence * p.weights.macro
  const weightSum  = p.weights.news + p.weights.flow + p.weights.tech + p.weights.sent + p.weights.macro
  const composite  = (newsScore + flowScore + techScore + sentScore + macroScore) / weightSum

  const bullish = composite >= p.bullThreshold
  const bearish = composite <= p.bearThreshold
  const direction = bullish ? 'LONG' : bearish ? 'SHORT' : 'FLAT'

  const confidence = Number((0.5 + Math.abs(composite - 0.5) * 0.7).toFixed(2))
  // Expected edge: on live data, derived from the asset's real ATR (half-ATR
  // capture assumption) modulated by news conviction; seeded otherwise.
  const atrFrac = market.indicators?.atrPct != null ? market.indicators.atrPct / 100 : null
  let expectedEdge
  if (market.live && atrFrac != null) {
    const newsConviction = news.data.live && news.data.newsCounts
      ? Math.min(1, (Math.abs((news.data.newsCounts.up || 0) - (news.data.newsCounts.down || 0)) / Math.max(1, (news.data.newsCounts.up || 0) + (news.data.newsCounts.down || 0) + (news.data.newsCounts.mixed || 0))) + 0.4)
      : 0.7
    // Expected favorable excursion over the signal horizon (≥8h) ≈ 1.5× the
    // hourly ATR — conservative vs the ~4.9× hourly-ATR daily range.
    const raw = direction === 'FLAT' ? 0 : atrFrac * 1.5 * newsConviction
    expectedEdge = Number(Math.max(0, Math.min(0.06, raw)).toFixed(4))
  } else {
    expectedEdge = Number(((bullish ? 1 : bearish ? 1 : 0) * (0.012 + rand(symbol, 'edge') * 0.028)).toFixed(4))
  }
  // Round-trip friction: Bitget spot taker ≈ 0.10% per side (crypto) and
  // ≈ 0.15% per side for tokenized equities, plus the real spread when known.
  const baseFees = market.class === 'crypto' ? 0.002 : 0.003
  const estimatedFriction = Number((baseFees + (mi.data.spreadBps / 10000)).toFixed(4))
  const riskAdjustment = Number(((market.volatility === 'HIGH' ? 0.012 : market.volatility === 'MED' ? 0.006 : 0.003) * p.riskMultiplier).toFixed(4))
  const netEdge = Number((expectedEdge - estimatedFriction - riskAdjustment).toFixed(4))

  const noTrade = direction === 'FLAT' || netEdge < 0 || (bearish && market.class === 'crypto' && netEdge < 0.003)

  return {
    direction: noTrade ? 'FLAT' : direction,
    confidence,
    expectedEdge,
    estimatedFriction,
    riskAdjustment,
    netEdge,
    status: noTrade ? 'NO_TRADE' : 'SIGNAL',
    horizon: market.class === 'crypto' ? 'MULTI_SESSION' : 'OVERNIGHT_INTO_OPEN',
    catalyst: news.data.catalyst,
    composite: Number(composite.toFixed(3)),
    reason: noTrade
      ? `Signal did not clear net-edge floor after friction and risk adjustment. ${direction === 'FLAT' ? 'Skill scores are mixed.' : ''}`
      : `${direction} ${symbol}: ${bullish ? 'news, flow and macro agree' : 'downside pressure across news, tape and macro'}; net edge ${(netEdge * 100).toFixed(2)}% after ${(estimatedFriction * 100).toFixed(2)}% friction.`,
    persona: { style: p.style, risk: p.risk },
  }
}

/** Produce the full research report artifact for `research` intent. */
export function buildResearchReport({ question, symbol, market, skills, signal, memory, invalidationOverride }) {
  const supporting = []
  const contradicting = []
  const news = skills.find(s => s.skill === 'news-briefing')
  const mi   = skills.find(s => s.skill === 'market-intel')
  const ta   = skills.find(s => s.skill === 'technical-analysis')
  const sen  = skills.find(s => s.skill === 'sentiment-analyst')
  const mac  = skills.find(s => s.skill === 'macro-analyst')

  const push = (arr, source, claim, evidence) => arr.push({ source, claim, evidence })

  if (news.data.live) {
    const c = news.data.newsCounts || {}
    const dirTxt = news.data.newsDirection === 'UP' ? 'bullish' : news.data.newsDirection === 'DOWN' ? 'bearish' : 'mixed'
    push(news.data.newsDirection === 'DOWN' ? contradicting : news.data.newsDirection === 'UP' ? supporting : contradicting,
      'news-briefing',
      `${symbol} live wire tape is ${dirTxt}`,
      `${c.up || 0} bullish / ${c.down || 0} bearish / ${c.mixed || 0} mixed headlines${c.highSeverity ? ` · ${c.highSeverity} HIGH severity` : ''}`)
  } else if (news.data.beat) {
    push(supporting,     'news-briefing',      `${symbol} print/catalyst is constructive`, news.data.expectationGap || news.data.catalyst)
  } else {
    push(contradicting,  'news-briefing',      `${symbol} print/catalyst is mixed`,        news.data.keyPoints[1] || '')
  }
  if (mi.data.volumeZ > 1)                push(supporting,     'market-intel',       'Volume + flow anomaly present',            `z-score ${mi.data.volumeZ}`)
  else                                    push(contradicting,  'market-intel',       'Flow is inside recent envelope',            `z-score ${mi.data.volumeZ}`)
  if (ta.data.trend === 'UP')             push(supporting,     'technical-analysis', 'Trend is up',                                `EMA20 ${ta.data.ema20} · RSI ${ta.data.rsi}`)
  else if (ta.data.trend === 'DOWN')      push(contradicting,  'technical-analysis', 'Trend is down',                              `EMA20 ${ta.data.ema20} · RSI ${ta.data.rsi}`)
  else                                    push(contradicting,  'technical-analysis', 'Trend is sideways',                          `EMA20 ${ta.data.ema20} · RSI ${ta.data.rsi}`)
  if (sen.data.tone === 'POSITIVE')       push(supporting,     'sentiment-analyst',  'Tone is positive, crowding tolerable',      `crowding ${sen.data.crowding}`)
  else if (sen.data.tone === 'NEGATIVE')  push(contradicting,  'sentiment-analyst',  'Tone is negative',                            `crowding ${sen.data.crowding}`)
  else                                    push(contradicting,  'sentiment-analyst',  'Tone is neutral',                              `crowding ${sen.data.crowding}`)
  if (mac.data.confirms)                  push(supporting,     'macro-analyst',      'Cross-asset macro agrees with the tape',    mac.data.live ? `${mac.data.cryptoRegime} · DXY ${mac.data.dxy ?? '—'} · VIX ${mac.data.vix ?? '—'} · BTC ${fmtPct(mac.data.btcChange24h / 100)}` : `${mac.data.cryptoRegime} · BTC ${fmtPct(mac.data.btcChange24h / 100)}`)
  else                                    push(contradicting,  'macro-analyst',      'Macro fights the tape',                       mac.data.live ? `${mac.data.cryptoRegime} · DXY ${mac.data.dxy ?? '—'} · VIX ${mac.data.vix ?? '—'}` : `${mac.data.cryptoRegime} · rates ${mac.data.ratesRegime}`)

  const analogs = (memory?.analogs || []).filter(a => a.asset === symbol).slice(0, 3)
  const risks = buildRisks(symbol, market, signal, skills)
  const situation = buildSituation(symbol, market, signal, skills)
  const shortTermThesis = buildShortTermThesis(symbol, market, signal, skills)
  const longTermThesis  = buildLongTermThesis(symbol, market, signal, skills)
  const whatChangesThisThesis = buildChangeConditions(symbol, market, signal, skills)
  const stressTests = buildStressTests(symbol, market, signal, skills)

  const invalidation = invalidationOverride || {
    price: signal.direction === 'LONG'
      ? Number(((ta.data.live && ta.data.support != null ? Math.min(ta.data.support, market.price * (1 - Math.max(0.01, market.atrPct / 150))) : market.price * (1 - Math.max(0.015, market.atrPct / 100)))).toFixed(2))
      : signal.direction === 'SHORT'
      ? Number(((ta.data.live && ta.data.resistance != null ? Math.max(ta.data.resistance, market.price * (1 + Math.max(0.01, market.atrPct / 150))) : market.price * (1 + Math.max(0.015, market.atrPct / 100)))).toFixed(2))
      : null,
    conditions: [
      market.class === 'crypto' ? 'BTC 24h ≤ −3%' : 'BTC 24h ≤ −3% (risk-off cross-asset)',
      `${ta.data.trend === 'UP' ? 'Close < EMA20' : 'Close > EMA20'}`,
      news.data.live ? 'New headline flips the live wire bias against the trade'
        : news.data.beat ? 'Guidance / print re-cut' : 'Volume decays below 20-session median',
    ],
  }

  const summary = signal.status === 'NO_TRADE'
    ? `${symbol}: research does not support opening a book. Composite ${signal.composite}, net edge ${fmtPct(signal.netEdge)}. ${signal.reason}`
    : `${symbol}: research supports a ${signal.direction.toLowerCase()} bias with ${(signal.confidence * 100).toFixed(0)}% confidence. Composite ${signal.composite}, net edge ${fmtPct(signal.netEdge)}. Catalyst — ${signal.catalyst}. Invalidation at ${invalidation.price ? '$' + fmtPrice(invalidation.price) : 'n/a'}.`

  const suggestion = signal.status === 'NO_TRADE'
    ? null
    : suggestExecution({ symbol, market, signal, memory, invalidation })

  const isLive = Boolean(market?.live || skills.some(s => s.data?.live))
  const newsItems = news.data.newsItems || []
  const citations = [
    ...skills.flatMap(s => (s.data.sources || []).map(src => ({ skill: s.skill, source: src }))),
    ...newsItems.slice(0, 6).map(n => ({ skill: 'news-briefing', source: `${n.source} · ${n.headline.slice(0, 60)}`, url: n.url })),
  ]

  return {
    id: shortId('rep'),
    question,
    symbol,
    intent: 'research',
    createdAt: new Date().toISOString(),
    dataMode: isLive ? 'LIVE' : 'OFFLINE',
    skills,
    summary,
    signal,
    situation,
    shortTermThesis,
    longTermThesis,
    whatChangesThisThesis,
    stressTests,
    supporting,
    contradicting,
    risks,
    invalidation,
    analogs,
    suggestion,
    dataFreshness: isLive
      ? `Live tape · ${skills.filter(s => s.data?.live).map(s => s.skill).join(' + ') || 'bitget-spot'}`
      : `Deterministic demo data · Bitget MCP not connected · seed ${symbol}`,
    citations,
  }
}

/**
 * Situation — a 2-3 line "here is what is happening right now" grounded in
 * real numbers from the 5-skill pack. Every research report emits one so the
 * printed card leads with a picture of the tape, not a verdict.
 */
function buildSituation(symbol, market, signal, skills) {
  const news = skills.find(s => s.skill === 'news-briefing')
  const mi   = skills.find(s => s.skill === 'market-intel')
  const ta   = skills.find(s => s.skill === 'technical-analysis')
  const sen  = skills.find(s => s.skill === 'sentiment-analyst')
  const mac  = skills.find(s => s.skill === 'macro-analyst')
  const price = market?.price != null ? `$${fmtPrice(market.price)}` : '—'
  const change24h = market?.change24h != null ? fmtPct(market.change24h / 100) : '—'
  const trend = ta?.data?.trend?.toLowerCase() || 'flat'
  const tape = news?.data?.newsDirection ? `wire tape is ${news.data.newsDirection.toLowerCase()}` : `no fresh headlines`
  const regime = mac?.data?.cryptoRegime === 'RISK_ON' ? 'risk-on macro' : mac?.data?.cryptoRegime === 'RISK_OFF' ? 'risk-off macro' : 'neutral macro'
  const spread = mi?.data?.spreadBps != null ? `${Number(mi.data.spreadBps).toFixed(1)} bps spread` : `book depth unknown`
  return [
    `${symbol} is trading ${price} (${change24h} 24h). Trend is ${trend}; RSI ${ta?.data?.rsi ?? '—'}; ${spread}.`,
    `${tape}, sentiment ${sen?.data?.tone?.toLowerCase() || 'neutral'} with ${sen?.data?.crowding?.toLowerCase() || 'unknown'} crowding, and ${regime}.`,
  ]
}

/**
 * Short-term thesis — the next hours-to-days. Anchored to the signal's
 * direction, the strongest live-data driver, and an explicit expected move.
 */
function buildShortTermThesis(symbol, market, signal, skills) {
  const ta  = skills.find(s => s.skill === 'technical-analysis')
  const mi  = skills.find(s => s.skill === 'market-intel')
  const news = skills.find(s => s.skill === 'news-briefing')
  const atr = market?.atrPct ?? ta?.data?.atrPct ?? 1
  const expectedMovePct = Math.max(0.6, Math.min(atr * 1.5, 8))
  if (signal.status === 'NO_TRADE' || signal.direction === 'FLAT') {
    return {
      direction: 'FLAT',
      horizon: 'next 24-72 hours',
      statement: `${symbol} does not offer an actionable directional edge inside the next 24-72 hours. Composite ${signal.composite}, net edge ${fmtPct(signal.netEdge)} after friction.`,
      keyDrivers: ['No skill produces a decisive read', 'Range trade until composite exceeds ±0.55'],
      expectedMove: `Range-bound ±${(expectedMovePct * 0.6).toFixed(1)}%`,
    }
  }
  const drivers = []
  if (signal.catalyst) drivers.push(`Primary catalyst — ${signal.catalyst}`)
  if (ta?.data?.trend) drivers.push(`Trend ${ta.data.trend}, EMA20 ${ta.data.ema20}, RSI ${ta.data.rsi}`)
  if (mi?.data?.volumeZ != null) drivers.push(`Flow z-score ${mi.data.volumeZ}${mi.data.volumeZ > 1 ? ' (anomaly)' : ''}`)
  if (news?.data?.live && news.data.newsCounts) drivers.push(`Live headline mix ${news.data.newsCounts.up || 0}↑ / ${news.data.newsCounts.down || 0}↓`)
  return {
    direction: signal.direction,
    horizon: 'next 24-72 hours',
    statement: `${symbol} carries a ${signal.direction.toLowerCase()} bias over the next 24-72 hours with ${(signal.confidence * 100).toFixed(0)}% confidence, driven by ${signal.catalyst}. Expect a move of roughly ±${expectedMovePct.toFixed(1)}% before the tape resolves.`,
    keyDrivers: drivers.slice(0, 4),
    expectedMove: `${signal.direction === 'LONG' ? '+' : '−'}${expectedMovePct.toFixed(1)}%`,
  }
}

/**
 * Long-term thesis — weeks-to-months. Uses the structural elements (macro,
 * class-specific tailwinds/headwinds, and technical trend context).
 */
function buildLongTermThesis(symbol, market, signal, skills) {
  const mac  = skills.find(s => s.skill === 'macro-analyst')
  const ta   = skills.find(s => s.skill === 'technical-analysis')
  const news = skills.find(s => s.skill === 'news-briefing')
  const isEquity = market?.class === 'tokenized-equity'
  const structural = []
  if (isEquity) {
    structural.push('Bitget xStocks tokenised equity — inherits underlying earnings + guidance cycle')
    if (market?.event && market.event !== 'None') structural.push(`Named event on file: ${market.event}`)
  } else {
    structural.push('Crypto asset — correlation regime with BTC drives multi-week trend')
  }
  if (mac?.data?.ratesRegime) structural.push(`Rates regime: ${mac.data.ratesRegime.replace(/_/g, ' ').toLowerCase()}`)
  if (ta?.data?.ema20 != null && ta?.data?.ema50 != null) structural.push(`EMA20 ${ta.data.ema20} vs EMA50 ${ta.data.ema50} — ${ta.data.ema20 > ta.data.ema50 ? 'uptrend' : 'downtrend'} structure`)
  const longDir = ta?.data?.ema20 != null && ta?.data?.ema50 != null
    ? (ta.data.ema20 > ta.data.ema50 ? 'LONG' : 'SHORT')
    : signal.direction
  const conviction = signal.direction === longDir ? 'aligned with short-term' : 'diverges from short-term'
  return {
    direction: longDir,
    horizon: 'next 4-12 weeks',
    statement: `Structural view over 4-12 weeks is ${longDir.toLowerCase()} ${symbol}, ${conviction} view. ${isEquity ? 'Position-size around the next earnings window.' : 'Position-size around the prevailing BTC regime and rates repricing.'}`,
    structuralFactors: structural.slice(0, 4),
    convictionVsShort: conviction,
  }
}

/**
 * What would change this thesis — a concrete, testable list of events. Every
 * item is either a price level, a data-print threshold, or a regime shift.
 */
function buildChangeConditions(symbol, market, signal, skills) {
  const ta  = skills.find(s => s.skill === 'technical-analysis')
  const mi  = skills.find(s => s.skill === 'market-intel')
  const mac = skills.find(s => s.skill === 'macro-analyst')
  const isEquity = market?.class === 'tokenized-equity'
  const atr = market?.atrPct ?? 1
  const invalidPrice = signal.direction === 'LONG'
    ? market?.price * (1 - Math.max(0.015, atr / 100))
    : signal.direction === 'SHORT'
    ? market?.price * (1 + Math.max(0.015, atr / 100))
    : null
  const conditions = []
  if (invalidPrice != null) {
    conditions.push({
      label: `${signal.direction === 'LONG' ? 'Close < ' : signal.direction === 'SHORT' ? 'Close > ' : 'Close crosses '}$${fmtPrice(invalidPrice)}`,
      why: 'Price invalidation — the setup fails at this level and the thesis flips',
    })
  }
  if (ta?.data?.ema20 != null) {
    conditions.push({
      label: signal.direction === 'LONG' ? `${symbol} closes below EMA20 ($${ta.data.ema20})` : `${symbol} closes above EMA20 ($${ta.data.ema20})`,
      why: 'Trend structure break — momentum stops working',
    })
  }
  if (mi?.data?.spreadBps != null) {
    conditions.push({
      label: `Spread widens above ${Math.round(mi.data.spreadBps * 2)} bps`,
      why: 'Liquidity dries up — friction consumes the expected edge',
    })
  }
  if (isEquity) {
    conditions.push({ label: 'Earnings pre-print or a guidance change from the underlying', why: 'Fundamental picture resets before the tape can express the thesis' })
    conditions.push({ label: 'A regulatory or antitrust headline hits the underlying', why: 'Structural repricing overrides technical setup' })
  } else {
    conditions.push({ label: 'BTC moves > ±3% in 24h', why: 'Alt / crypto correlation regime shifts — thesis is exposed to the tail' })
  }
  conditions.push({
    label: mac?.data?.ratesRegime === 'CUTS_AHEAD' ? 'Fed pivots hawkish or DXY breaks new high' : 'Fed pivots dovish or DXY breaks new low',
    why: 'Macro regime flips — the risk-on/off backdrop for the setup inverts',
  })
  return conditions.slice(0, 6)
}

/**
 * Stress tests — apply concrete shocks and report the estimated move. Every
 * report ships with the same 4 buckets so the printed card is a true stress
 * table, not just a bullet list.
 */
function buildStressTests(symbol, market, signal, skills) {
  const ta = skills.find(s => s.skill === 'technical-analysis')
  const mi = skills.find(s => s.skill === 'market-intel')
  const atr = market?.atrPct ?? ta?.data?.atrPct ?? 1
  const dir = signal.direction === 'SHORT' ? -1 : 1
  return [
    { name: 'Adverse 2× ATR shock',            shock: `${(atr * 2).toFixed(1)}% against the trade`,           expectedMovePct: -Number((atr * 2 / 100).toFixed(4)), survives: (atr * 2 / 100) < 0.06 },
    { name: 'Cross-asset reversal',             shock: 'BTC 24h ≤ −4% risk-off',                                expectedMovePct: -0.03,                              survives: market?.class === 'tokenized-equity' },
    { name: 'Liquidity dry-up',                 shock: `spread ${mi?.data?.spreadBps ?? '—'} → ${((mi?.data?.spreadBps || 8) * 3).toFixed(0)} bps`, expectedMovePct: -Number(((((mi?.data?.spreadBps || 8) * 3) / 10000)).toFixed(4)), survives: (mi?.data?.spreadBps ?? 10) < 6 },
    { name: 'Headline reversal',                shock: 'a HIGH-severity headline flips wire bias',              expectedMovePct: -0.04,                              survives: false },
  ].map(t => ({ ...t, expectedMovePct: Number((t.expectedMovePct * dir).toFixed(4)) }))
}

function buildRisks(symbol, market, signal, skills) {
  const mi = skills.find(s => s.skill === 'market-intel')
  const sen = skills.find(s => s.skill === 'sentiment-analyst')
  const ta  = skills.find(s => s.skill === 'technical-analysis')
  const risks = []
  if (market.volatility === 'HIGH') risks.push({ label: 'Volatility whipsaw', detail: `ATR ${market.atrPct.toFixed(1)}% — 1R stops get taken` })
  if (mi.data.spreadBps > 8)         risks.push({ label: 'Slippage risk',     detail: `Spread ${mi.data.spreadBps} bps eats edge` })
  if (sen.data.crowding === 'HIGH')  risks.push({ label: 'Crowding',          detail: `Sentiment score ${sen.data.score} · crowded ${signal.direction.toLowerCase()} tape` })
  if (market.class === 'crypto')     risks.push({ label: 'BTC dominance',     detail: 'A BTC dump invalidates most alt setups' })
  if (market.class === 'tokenized-equity') risks.push({ label: 'Cash-open gap', detail: 'Overnight tokenized flow does not always survive the auction' })
  if (ta.data.rsi > 70)              risks.push({ label: 'Overbought RSI',    detail: `RSI ${ta.data.rsi}` })
  if (ta.data.rsi < 30)              risks.push({ label: 'Oversold RSI',      detail: `RSI ${ta.data.rsi}` })
  return risks.slice(0, 5)
}

function suggestExecution({ symbol, market, signal, memory, invalidation }) {
  const prefs = memory?.preferences || {}
  const nav = prefs.nav || 25000
  const notionalCap = nav * (prefs.maxPositionPct || 0.15)
  const rDollars = Math.min(nav * 0.01, 250)                      // ~1% NAV per R
  const stopPct = Math.abs(invalidation.price ? (invalidation.price - market.price) / market.price : (market.atrPct / 100))
  const notional = Math.min(notionalCap, Math.round(rDollars / Math.max(0.005, stopPct)))
  const targetPct = Math.max(0.02, stopPct * 2)
  const target = signal.direction === 'LONG' ? market.price * (1 + targetPct) : market.price * (1 - targetPct)
  const feesBps = market.class === 'crypto' ? 20 : 30          // round-trip taker fees, Bitget schedule
  return {
    notional,
    notionalPctOfNav: Number((notional / nav).toFixed(3)),
    entry: Number(market.price.toFixed(2)),
    stop: Number((invalidation.price || (signal.direction === 'LONG' ? market.price * (1 - stopPct) : market.price * (1 + stopPct))).toFixed(2)),
    target: Number(target.toFixed(2)),
    riskReward: Number((targetPct / Math.max(0.005, stopPct)).toFixed(2)),
    slices: [
      { pct: 0.6, condition: 'Initial · limit at ±5 bps' },
      { pct: 0.4, condition: 'Trailing add-on if signal composite improves within 15m' },
    ],
    estimatedFriction: {
      feesBps,
      slippageBps: Math.round(stopPct * 10000 * 0.05),
      totalPct: Number(((feesBps + Math.round(stopPct * 10000 * 0.05)) / 10000).toFixed(4)),
    },
    horizon: signal.horizon,
    notes: [
      `Position size sized off ${prefs.maxPositionPct ? (prefs.maxPositionPct * 100).toFixed(0) + '% NAV cap' : '15% NAV cap'} and ~1% risk-per-trade.`,
      'You decide. NIGHTWATCH will not fill without your explicit approve.',
    ],
  }
}

/* ---------------------------------------------- Thesis Lab (stress-test any) */

/** Stress-test an arbitrary trader-submitted thesis (free text). */
export function stressTestThesis({ thesis, memory, universe = DEMO_UNIVERSE, context = {} }) {
  const asset = inferAsset(thesis) || 'BTC'
  const market = universe.find(u => u.symbol === asset) || DEMO_UNIVERSE.find(u => u.symbol === asset)
  const skills = runSkillPack(asset, market, { ...context, news: context.newsBySymbol?.[asset] || context.news })
  const signal = synthesizeSignal(asset, market, skills, memory?.preferences)
  const direction = /(short|down|bear|fade|sell|crash|puke|breakdown)/i.test(thesis) ? 'SHORT'
                  : /(long|up|bull|follow|buy|rip|breakout|higher|moon)/i.test(thesis) ? 'LONG'
                  : signal.direction === 'FLAT' ? 'LONG' : signal.direction
  // Prior confidence: on live data, derived from how well the real composite
  // score agrees with the trader's claimed direction; seeded otherwise.
  const agreement = direction === 'SHORT' ? 1 - signal.composite : signal.composite
  const confidenceBefore = market.live
    ? Number(Math.min(0.88, Math.max(0.3, 0.3 + agreement * 0.55)).toFixed(2))
    : Number((0.6 + rand(thesis, 'before') * 0.2).toFixed(2))
  const supporting = []
  const contradicting = []

  const news = skills.find(s => s.skill === 'news-briefing')
  const mi   = skills.find(s => s.skill === 'market-intel')
  const ta   = skills.find(s => s.skill === 'technical-analysis')
  const sen  = skills.find(s => s.skill === 'sentiment-analyst')
  const mac  = skills.find(s => s.skill === 'macro-analyst')

  const supports = (skill, cond, claim, ev) => (cond ? supporting : contradicting).push({ source: skill, claim, evidence: ev })

  supports('news-briefing',      direction === 'LONG' ? news.data.beat : !news.data.beat,             direction === 'LONG' ? 'Catalyst supports upside' : 'Catalyst supports downside',    news.data.expectationGap || news.data.catalyst)
  supports('market-intel',       direction === 'LONG' ? mi.data.volumeZ > 1 : mi.data.volumeZ < 0.5,  direction === 'LONG' ? 'Flow anomaly aligns with thesis' : 'Flow does not confirm thesis', `z ${mi.data.volumeZ}`)
  supports('technical-analysis', direction === 'LONG' ? ta.data.trend === 'UP' : ta.data.trend === 'DOWN', `Trend ${ta.data.trend} ${direction === 'LONG' ? 'agrees with' : 'agrees with'} thesis`, `EMA20 ${ta.data.ema20}, RSI ${ta.data.rsi}`)
  supports('sentiment-analyst',  direction === 'LONG' ? sen.data.tone === 'POSITIVE' : sen.data.tone === 'NEGATIVE', `Tone ${sen.data.tone}`, `crowding ${sen.data.crowding}`)
  supports('macro-analyst',      mac.data.confirms,                                                    `Macro ${mac.data.confirms ? 'agrees' : 'fights'} tape`, `${mac.data.cryptoRegime} · rates ${mac.data.ratesRegime}`)

  const contradictWeight = contradicting.length * 0.06
  const confidenceAfter = Number(Math.max(0.15, confidenceBefore - contradictWeight).toFixed(2))

  const stressTests = [
    { name: 'Volatility shock (2× ATR)',            shock: `move ±${(market.atrPct * 2).toFixed(1)}%`,                    expectedPnlPct: -Number(((market.atrPct / 100) * 2).toFixed(3)),                                   survivable: (market.atrPct / 100) < 0.06 },
    { name: 'Cross-asset reversal',                 shock: 'BTC 24h ≤ −4%',                                                expectedPnlPct: -0.03,                                                                              survivable: market.class !== 'crypto' },
    { name: 'Book pull (spread ×3)',                shock: `spread ${mi.data.spreadBps} → ${mi.data.spreadBps * 3} bps`,   expectedPnlPct: -Number(((mi.data.spreadBps * 3) / 10000).toFixed(4)),                              survivable: mi.data.spreadBps < 6 },
    { name: 'Catalyst re-cut',                      shock: 'headline reversal within 24h',                                 expectedPnlPct: -0.04,                                                                              survivable: false },
    { name: 'Sentiment blow-off',                   shock: `crowding → HIGH`,                                              expectedPnlPct: -0.025,                                                                             survivable: sen.data.crowding !== 'HIGH' },
  ]

  const invalidation = {
    price: direction === 'LONG' ? Number((market.price * (1 - Math.max(0.015, market.atrPct / 100))).toFixed(2))
         : Number((market.price * (1 + Math.max(0.015, market.atrPct / 100))).toFixed(2)),
    conditions: [
      market.class === 'crypto' ? 'BTC breaks 24h range' : 'BTC 24h ≤ −3%',
      direction === 'LONG' ? 'Close < EMA20' : 'Close > EMA20',
      `Composite score < ${(signal.composite - 0.1).toFixed(2)}`,
    ],
  }

  const marketPricing = mi.data.volumeZ > 1
    ? 'Market appears to be pricing in the catalyst; late-follow risk elevated.'
    : 'Market may not fully price the catalyst yet.'

  const analogs = (memory?.analogs || []).filter(a => a.asset === asset).slice(0, 3)

  const verdict = confidenceAfter >= 0.65 && supporting.length >= 3
    ? 'SUPPORTS'
    : contradicting.length >= 3
    ? 'REFUTES'
    : 'MIXED'

  const finalAssessment = verdict === 'SUPPORTS'
    ? `Thesis survives stress-test. Direction ${direction}, invalidation ${'$' + fmtPrice(invalidation.price)}. Trader still owns the size decision.`
    : verdict === 'REFUTES'
    ? `Thesis does not survive stress-test. Recommend sit-out or reformulate around a different catalyst.`
    : `Thesis is mixed. Some evidence supports; some fights. Waiting for a stronger catalyst or trimmed size is reasonable.`

  return {
    id: shortId('ths'),
    thesis,
    asset,
    direction,
    createdAt: new Date().toISOString(),
    steelman: buildSteelman(direction, asset, news, mac),
    counterThesis: buildCounterThesis(direction, asset, mi, sen),
    marketPricing,
    supporting,
    contradicting,
    stressTests,
    invalidation,
    analogs,
    verdict,
    confidenceBefore,
    confidenceAfter,
    finalAssessment,
    signal,
    skills,
  }
}

function buildSteelman(direction, asset, news, macro) {
  if (news.data.live) {
    const c = news.data.newsCounts || {}
    const bias = `${c.up || 0} bullish / ${c.down || 0} bearish / ${c.mixed || 0} mixed live headlines`
    const macroNote = macro.data.live
      ? (macro.data.confirms ? `the live cross-asset regime (${macro.data.cryptoRegime.replace('_', '-').toLowerCase()}, DXY ${macro.data.dxy ?? '—'}, VIX ${macro.data.vix ?? '—'}) agrees` : `the cross-asset regime is the main thing to beat`)
      : (macro.data.confirms ? 'macro regime agrees' : 'the tape is stronger than macro')
    return direction === 'LONG'
      ? `${asset} moves higher: the live wire reads ${bias} with "${news.data.catalyst}" as the dominant story, and ${macroNote}.`
      : `${asset} moves lower: the live wire reads ${bias} with "${news.data.catalyst}" as the dominant story, and ${macroNote}.`
  }
  const kernel = direction === 'LONG'
    ? `${asset} moves higher because ${news.data.catalyst} is real and ${macro.data.confirms ? 'macro regime agrees' : 'the tape is stronger than macro'}.`
    : `${asset} moves lower because ${news.data.catalyst} disappoints and ${macro.data.confirms ? 'the macro tail is against risk' : 'positioning is already stretched'}.`
  return kernel
}
function buildCounterThesis(direction, asset, mi, sen) {
  if (mi.data.live || sen.data.live) {
    const flow = `live volume z ${mi.data.volumeZ ?? '—'}, spread ${mi.data.spreadBps ?? '—'}bps`
    return direction === 'LONG'
      ? `Entry quality is the weak point (${flow}, crowding ${sen.data.crowding}): if the move is already extended you are following, not front-running.`
      : `Positioning and flow (${flow}, crowding ${sen.data.crowding}) can squeeze; a bounce against a fresh short is the base risk.`
  }
  return direction === 'LONG'
    ? `The catalyst is already priced in (volume z ${mi.data.volumeZ}, crowding ${sen.data.crowding}); late-follow gives you a poor entry.`
    : `Positioning is already short (crowding ${sen.data.crowding}); a squeeze against you is more likely than a fresh leg down.`
}

/* ------------------------------------------------------ Portfolio impact */

/** Compute how a proposed position changes NAV exposure, beta and sector mix. */
export function portfolioImpact({ symbol, notional, direction, session }) {
  const market = session.universe.find(u => u.symbol === symbol)
  if (!market) return null
  const nav = session.memory.preferences.nav || 25000
  const openPositions = (session.positions || []).filter(p => p.status === 'OPEN')
  const currentBook  = openPositions.reduce((s, p) => s + p.notional, 0)
  const currentBeta  = openPositions.reduce((s, p) => s + p.notional * (session.universe.find(u => u.symbol === p.asset)?.beta || 1), 0) / Math.max(1, currentBook || 1)
  const nextBook     = currentBook + notional
  const nextBeta     = ((currentBeta * currentBook) + notional * market.beta) / Math.max(1, nextBook)
  const sectors      = {}
  for (const p of openPositions) {
    const s = session.universe.find(u => u.symbol === p.asset)?.sector || 'Other'
    sectors[s] = (sectors[s] || 0) + p.notional
  }
  const sectorsNext = { ...sectors, [market.sector]: (sectors[market.sector] || 0) + notional }
  const cryptoBookBefore = openPositions.filter(p => CRYPTO_SYMBOLS.has(p.asset)).reduce((s, p) => s + p.notional, 0)
  const cryptoBookAfter  = cryptoBookBefore + (CRYPTO_SYMBOLS.has(symbol) ? notional : 0)
  return {
    nav,
    currentBook,
    nextBook,
    exposurePctBefore: Number((currentBook / nav).toFixed(3)),
    exposurePctAfter:  Number((nextBook  / nav).toFixed(3)),
    betaBefore: Number(currentBeta.toFixed(2)),
    betaAfter:  Number(nextBeta.toFixed(2)),
    cryptoPctBefore: Number((cryptoBookBefore / nav).toFixed(3)),
    cryptoPctAfter:  Number((cryptoBookAfter  / nav).toFixed(3)),
    sectorsBefore: sectors,
    sectorsAfter:  sectorsNext,
    withinLimits: (nextBook / nav) <= (session.memory.preferences.maxPositionPct * 3 || 0.45),
  }
}

/* ------------------------------------------------- Post-trade review engine */

export function buildReview({ position, report, actualOutcome }) {
  const closingPnlPct = actualOutcome?.pnlPct ?? position?.pnlPercent ?? 0
  const originalDirection = position?.direction
  const worked = []
  const failed = []
  const missed = []
  if (!report) {
    return {
      id: shortId('rev'),
      positionId: position?.id,
      summary: `${position?.asset || 'Position'} closed at ${fmtPct(closingPnlPct)} with no research report on file.`,
      status: 'COMPLETE',
      whatWorked: [], whatFailed: [], missedRisks: [], recurringPattern: null, improvements: [],
    }
  }
  // position.pnlPercent is already direction-adjusted (a LONG that fell and a
  // SHORT that rose both read negative), so the sign of the realized P&L — not
  // a direction comparison — is what tells us whether the thesis actually paid.
  const won = closingPnlPct >= 0
  if (won) {
    worked.push(`Researched ${originalDirection || report.signal.direction} direction paid off (${fmtPct(closingPnlPct)})`)
    if (report.signal.confidence > 0.75) worked.push('High-confidence signal held')
    if (report.suggestion?.riskReward >= 2) worked.push('R:R ≥ 2 setup captured')
  } else {
    failed.push(`Researched edge did not materialize — closed ${fmtPct(closingPnlPct)}`)
    for (const risk of report.risks || []) missed.push(`${risk.label}: ${risk.detail}`)
  }
  const recurring = (report.risks || []).find(r => /Slippage|Crowd|Overbought|Oversold/i.test(r.label))
  const improvements = []
  if (report.suggestion?.estimatedFriction?.totalPct > 0.02) improvements.push('Friction was > 2% — require net edge > 3% on this asset class next time.')
  if (report.risks?.some(r => r.label === 'Crowding'))       improvements.push('Skip crowded entries — wait for the retest.')
  if (!won && report.signal.status !== 'NO_TRADE')           improvements.push('Consider tighter invalidation on this catalyst class.')
  return {
    id: shortId('rev'),
    positionId: position?.id,
    reportId: report.id,
    won,
    summary: `${position.asset} closed at ${fmtPct(closingPnlPct)}. The researched thesis ${won ? 'played out' : 'did not play out'}.`,
    status: 'COMPLETE',
    whatWorked: worked,
    whatFailed: failed,
    missedRisks: missed,
    recurringPattern: recurring ? recurring.label : null,
    improvements,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Fold a closed trade + its review back into trader memory so the desk learns
 * from its own realized outcomes. Produces:
 *   - a new `analog` (the trader's own trade, similarity 1.0) that future
 *     research on the same symbol will surface alongside the seeded history
 *   - an incremented `patterns` occurrence when the review named a recurring
 *     pattern, so repeated mistakes get louder over time
 * Idempotent by position id: reviewing the same position twice replaces its
 * analog rather than stacking duplicates.
 */
export function foldReviewIntoMemory(memory, position, report, review) {
  const base = memory || { preferences: {}, patterns: [], analogs: [] }
  const pnlPct = position.pnlPercent ?? 0
  const direction = position.direction || report?.signal?.direction || 'LONG'
  const period = (position.closedAt || new Date().toISOString()).slice(0, 7)
  // Realized P&L sign is authoritative (pnlPercent is already direction-adjusted).
  const won = review?.won ?? (pnlPct >= 0)
  const analogId = `an-${position.id}`
  const analog = {
    id: analogId,
    period,
    asset: position.asset,
    bucket: direction === 'LONG' ? 'FOLLOW' : 'FADE',
    setup: (report?.situation || report?.signal?.catalyst || `${direction} ${position.asset}`).slice(0, 120),
    outcome: `${direction} ${pnlPct >= 0 ? '+' : ''}${(pnlPct * 100).toFixed(1)}%${position.closeReason ? ` (${position.closeReason.replace(/_/g, ' ').toLowerCase()})` : ''}`,
    similarity: 1.0,
    lesson: review?.improvements?.[0] || (won ? 'Setup worked as researched — repeatable.' : 'Thesis diverged from outcome — revisit the invalidation.'),
    source: 'realized',
    won,
  }
  // Replace any prior analog for this exact position; keep the newest 24, with
  // the trader's own realized analogs preferred over seeds when trimming.
  const others = (base.analogs || []).filter(a => a.id !== analogId)
  const analogs = [analog, ...others]
    .sort((a, b) => (b.source === 'realized' ? 1 : 0) - (a.source === 'realized' ? 1 : 0))
    .slice(0, 24)

  let patterns = base.patterns || []
  if (review?.recurringPattern) {
    const idx = patterns.findIndex(p => p.name === review.recurringPattern || p.id === review.recurringPattern)
    if (idx >= 0) {
      patterns = patterns.map((p, i) => i === idx ? { ...p, occurrences: (p.occurrences || 0) + 1 } : p)
    } else {
      patterns = [...patterns, { id: `pat-${shortId('p')}`, name: review.recurringPattern, occurrences: 1, lesson: analog.lesson }]
    }
  }
  return { ...base, analogs, patterns }
}

/* --------------------------------------------------- Find-opportunities scan */

export function findOpportunities(session, watchlistOnly = false, ctx = {}) {
  const pool = watchlistOnly
    ? session.universe.filter(a => session.watchlist.includes(a.symbol))
    : session.universe
  const rows = pool.map(market => {
    const skills = runSkillPack(market.symbol, market, { ...ctx, news: ctx.newsBySymbol?.[market.symbol] || [] })
    const signal = synthesizeSignal(market.symbol, market, skills)
    return { symbol: market.symbol, name: market.name, class: market.class, price: market.price, change24h: market.change24h, signal }
  })
  return rows
    .filter(row => row.signal.status === 'SIGNAL')
    .sort((a, b) => (b.signal.netEdge * b.signal.confidence) - (a.signal.netEdge * a.signal.confidence))
    .slice(0, 8)
}

/* --------------------------------------------------------- Paper execution */

export class PaperExecution {
  submit({ asset, direction, notional, entry, stop, target, reportId = null, decisionId = null }) {
    return {
      id: shortId('pos'),
      asset,
      direction,
      notional,
      entryPrice: entry,
      currentPrice: entry,
      stopPrice: stop,
      targetPrice: target,
      status: 'OPEN',
      pnl: 0,
      pnlPercent: 0,
      environment: 'PAPER',
      // Provenance: link the position back to the exact research report and
      // trader decision that opened it, so post-trade review grades against
      // the right thesis even when the same symbol was researched twice.
      reportId,
      decisionId,
      openedAt: new Date().toISOString(),
    }
  }
  mark(position, market) {
    if (position.status !== 'OPEN') return position
    const move = (market.price - position.entryPrice) / position.entryPrice
    const pnlPercent = position.direction === 'LONG' ? move : -move
    const hitStop   = position.direction === 'LONG' ? market.price <= position.stopPrice   : market.price >= position.stopPrice
    const hitTarget = position.direction === 'LONG' ? market.price >= position.targetPrice : market.price <= position.targetPrice
    const closed = hitStop || hitTarget
    return {
      ...position,
      currentPrice: market.price,
      pnl: Number((position.notional * pnlPercent).toFixed(2)),
      pnlPercent: Number(pnlPercent.toFixed(4)),
      status: closed ? 'CLOSED' : 'OPEN',
      closeReason: hitTarget ? 'TAKE_PROFIT' : hitStop ? 'STOP_LOSS' : undefined,
      closedAt: closed ? new Date().toISOString() : undefined,
    }
  }
  simulateClose(position, pnlPct) {
    return {
      ...position,
      currentPrice: Number((position.entryPrice * (1 + pnlPct)).toFixed(4)),
      pnl: Number((position.notional * pnlPct).toFixed(2)),
      pnlPercent: pnlPct,
      status: 'CLOSED',
      closeReason: 'CLOSED_AT_MARK',
      closedAt: new Date().toISOString(),
    }
  }
}

/** Demo ticker for offline mode only. Rows fed by live prices (row.live) are never drifted. */
export class DemoMarketData {
  constructor(universe = DEMO_UNIVERSE) { this.markets = universe.map(m => ({ ...m })) }
  snapshot() { return this.markets.map(m => ({ ...m })) }
  /** Re-seed internal state from an external (e.g. live SSE) snapshot. */
  sync(rows) {
    if (!Array.isArray(rows)) return
    for (const r of rows) {
      const i = this.markets.findIndex(m => m.symbol === r.symbol)
      if (i >= 0) this.markets[i] = { ...this.markets[i], ...r }
    }
  }
  tick() {
    this.markets = this.markets.map(m => {
      if (m.live) return { ...m }                 // live rows are owned by the SSE price feed
      const drift = (m.class === 'crypto' ? 0.0006 : 0.0003) * (m.change24h >= 0 ? 1 : -1)
      const noise = (Math.random() - 0.5) * (m.atrPct / 100) * 0.1
      return { ...m, price: Number((m.price * (1 + drift + noise)).toFixed(4)) }
    })
    return this.snapshot()
  }
}

/* ---------------------- Trader decision → executes paper trade (or sit-out) */

export function applyTraderDecision(session, report, decision) {
  if (session.settings.paperOnly !== true) throw new Error('Live execution is disabled in NIGHTWATCH AI')
  if (!report) throw new Error('Cannot decide without a research report')
  const decisionRecord = {
    id: shortId('dec'),
    reportId: report.id,
    asset: report.symbol,
    action: decision.action,                                    // APPROVE · REJECT · SIT_OUT
    rationale: decision.rationale || '',
    at: new Date().toISOString(),
  }
  const decisions = [...(session.decisions || []), decisionRecord]

  if (decision.action === 'SIT_OUT') {
    return addLog({ ...session, decisions, stage: 'IDLE', pendingPositionId: null }, 'TRADER', `Sit-out acknowledged · ${report.symbol}`, report.signal.reason)
  }
  if (decision.action === 'REJECT') {
    return addLog({ ...session, decisions, stage: 'IDLE', pendingPositionId: null }, 'TRADER', `Rejected plan · ${report.symbol}`, decision.rationale || '')
  }
  if (decision.action !== 'APPROVE') throw new Error(`Unknown action ${decision.action}`)
  if (report.signal.status === 'NO_TRADE') throw new Error('Cannot approve a NO_TRADE report')
  if (!report.suggestion) throw new Error('Report has no execution suggestion to approve')

  const paper = new PaperExecution()
  const overrides = decision.overrides || {}
  const position = paper.submit({
    asset: report.symbol,
    direction: report.signal.direction,
    notional: overrides.notional ?? report.suggestion.notional,
    entry: report.suggestion.entry,
    stop: overrides.stop ?? report.suggestion.stop,
    target: overrides.target ?? report.suggestion.target,
    reportId: report.id,
    decisionId: decisionRecord.id,
  })
  return addLog(
    { ...session, decisions, positions: [...(session.positions || []), position], stage: 'BOOKED', pendingPositionId: position.id },
    'ORDER', `Paper order filled · ${report.symbol} ${report.signal.direction.toLowerCase()} · $${position.notional}`,
    `entry $${fmtPrice(position.entryPrice)} · stop $${fmtPrice(position.stopPrice)} · target $${fmtPrice(position.targetPrice)}`
  )
}

/* --------------------------------------------------- Provider abstraction */

/**
 * NIGHTWATCH AI research provider. Delegates to a server adapter if configured
 * (VITE_AGENT_API_URL), otherwise uses the local deterministic engine.
 *
 * The server adapter can optionally proxy to Bitget's `bitget-signal` MCP or
 * rewrite narration through an LLM (xAI grok, Anthropic, OpenAI). The browser
 * never holds a key.
 */
export class NightwatchProvider {
  constructor(options = {}) {
    const configured = typeof import.meta !== 'undefined' && import.meta.env?.VITE_AGENT_API_URL
    // Default: use configured URL if set, else same-origin in the browser, else null (Node/tests).
    this.endpoint = options.endpoint
      ?? (configured ? configured.replace(/\/$/, '') : null)
      ?? (typeof window !== 'undefined' ? '' : null)
    this.local = new LocalNightwatchEngine()
  }

  async run(request) {
    if (!request?.intent) throw new Error('NightwatchProvider.run needs an intent')
    if (this.endpoint == null) {
      const artifact = await this.local.run(request)
      return { intent: request.intent, engine: 'LOCAL', bitgetLive: false, fallback: false, artifact }
    }
    try {
      const response = await fetch(`${this.endpoint.replace(/\/$/, '')}/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        // Server worst case: live-context build + engine + LLM narration (9s
        // internal timeout) + Bitget probe (2.5s). Stay above that so a healthy
        // adapter is never silently downgraded to the offline LOCAL engine.
        signal: AbortSignal.timeout(30000),
      })
      if (!response.ok) throw new Error(`Provider returned ${response.status}`)
      const body = await response.json()
      return { intent: request.intent, engine: body.engine || 'ADAPTER', bitgetLive: Boolean(body.bitgetLive), fallback: false, artifact: body.artifact }
    } catch {
      const artifact = await this.local.run(request)
      return { intent: request.intent, engine: 'LOCAL', bitgetLive: false, fallback: true, artifact }
    }
  }

  async bitgetStatus() {
    if (this.endpoint == null) return { connected: false, model: null, reason: 'No server adapter configured' }
    try {
      const response = await fetch(`${this.endpoint.replace(/\/$/, '')}/bitget/status`, { signal: AbortSignal.timeout(3000) })
      if (!response.ok) return { connected: false, model: null, reason: `Adapter returned ${response.status}` }
      return await response.json()
    } catch (err) {
      return { connected: false, model: null, reason: err.message }
    }
  }
}

/* --------------------------------------------- Local (deterministic) engine */

export class LocalNightwatchEngine {
  async run(request) {
    const { intent } = request
    if (intent === 'research')          return this.research(request)
    if (intent === 'thesis-test')       return this.thesisTest(request)
    if (intent === 'portfolio-impact')  return this.portfolioImpact(request)
    if (intent === 'execution-help')    return this.executionHelp(request)
    if (intent === 'review')            return this.review(request)
    if (intent === 'find-opportunities')return this.findOpportunities(request)
    throw new Error(`Unknown intent ${intent}`)
  }

  research(request) {
    const question = request.question || ''
    const asset = request.asset || inferAsset(question) || 'BTC'
    const ctx = request.context || {}
    const market = ctx.universe?.find(u => u.symbol === asset) || DEMO_UNIVERSE.find(u => u.symbol === asset)
    const skills = runSkillPack(asset, market, { ...ctx, news: ctx.newsBySymbol?.[asset] || ctx.news })
    const prefs = ctx.memory?.preferences
    const signal = synthesizeSignal(asset, market, skills, prefs)
    return { report: buildResearchReport({ question, symbol: asset, market, skills, signal, memory: ctx.memory }) }
  }

  thesisTest(request) {
    const ctx = request.context || {}
    return { thesisReport: stressTestThesis({ thesis: request.thesis || request.question, memory: ctx.memory, universe: ctx.universe || DEMO_UNIVERSE, context: ctx }) }
  }

  portfolioImpact(request) {
    const symbol = request.asset || inferAsset(request.question || '')
    const notional = request.notional || 1000
    const impact = portfolioImpact({ symbol, notional, direction: request.direction || 'LONG', session: request.context?.session })
    return { impact }
  }

  executionHelp(request) {
    const ctx = request.context || {}
    const asset = request.asset || inferAsset(request.question || '') || 'BTC'
    const market = ctx.universe?.find(u => u.symbol === asset) || DEMO_UNIVERSE.find(u => u.symbol === asset)
    const skills = runSkillPack(asset, market, { ...ctx, news: ctx.newsBySymbol?.[asset] || ctx.news })
    const signal = synthesizeSignal(asset, market, skills, ctx.memory?.preferences)
    // Never fabricate a directional plan when research says there is no trade.
    // A NO_TRADE/FLAT signal has no side to size, so returning a short-shaped
    // plan (stop above, target below) would be misinformation. Return an
    // explicit no-trade plan the UI can render honestly instead.
    if (signal.status === 'NO_TRADE' || signal.direction === 'FLAT') {
      return {
        executionPlan: {
          status: 'NO_TRADE',
          symbol: asset,
          entry: Number(market.price.toFixed(2)),
          reason: signal.reason || 'Signal did not clear the net-edge floor after friction and risk adjustment.',
          composite: signal.composite,
          netEdge: signal.netEdge,
          notes: [
            `No tradable edge on ${asset} right now — there is no position to size.`,
            'Re-run research when a catalyst or the tape changes; NIGHTWATCH will only plan an entry when the signal clears.',
          ],
        },
      }
    }
    const invalidation = {
      price: signal.direction === 'LONG' ? Number((market.price * (1 - Math.max(0.015, market.atrPct / 100))).toFixed(2))
           : Number((market.price * (1 + Math.max(0.015, market.atrPct / 100))).toFixed(2)),
      conditions: [],
    }
    return { executionPlan: { status: 'PLAN', symbol: asset, ...suggestExecution({ symbol: asset, market, signal, memory: ctx.memory, invalidation }) } }
  }

  review(request) {
    const position = request.position
    const report = request.report
    return { review: buildReview({ position, report, actualOutcome: request.actualOutcome }) }
  }

  findOpportunities(request) {
    const ctx = request.context || {}
    const session = {
      watchlist: ctx.session?.watchlist || seedWatchlist,
      positions: ctx.session?.positions || [],
      universe: (ctx.universe?.length ? ctx.universe : ctx.session?.universe) || DEMO_UNIVERSE,
    }
    return { opportunities: findOpportunities(session, request.watchlistOnly, ctx) }
  }
}

/* -------------------------------------------------------------- convenience */

export const RESEARCH_QUESTION_SUGGESTIONS = [
  { id: 'nvda',   label: 'Why is NVDA moving right now?',       question: 'Why is NVDA moving right now?' },
  { id: 'tsla',   label: 'Research TSLA into the print',        question: 'Research TSLA overnight — is the setup sustainable into the next print?' },
  { id: 'aapl',   label: 'Short AAPL overnight — worth it?',    question: 'Short AAPL overnight — is the setup worth it?' },
  { id: 'msft',   label: 'MSFT vs. macro risk-off',             question: 'How does MSFT hold up if macro flips risk-off overnight?' },
  { id: 'meta',   label: 'META ad-tier momentum still real?',   question: 'Is META’s ad-tier momentum still real, or already priced in?' },
  { id: 'scan',   label: 'Strongest overnight opportunities',   question: 'Find the strongest overnight opportunities across my watchlist.' },
  { id: 'mstr',   label: 'Stress-test long MSTR here',          question: '/thesis Long MSTR here as a BTC-beta trade.' },
  { id: 'coin',   label: 'Research COIN into weekend flows',    question: 'Research COIN into weekend crypto flows.' },
]

export const BITGET_CONNECTION_HELP = [
  'Install the Bitget Agent Hub CLI: `npm i -g @bitget/agent-hub-cli` (or clone github.com/BitgetLimited/agent_hub).',
  'Run `bgc discover` to enumerate the 5 bitget-signal research skills without an API key.',
  'To route real research through Bitget MCP, run `npm run desk` with BITGET_MCP_URL set; NIGHTWATCH will proxy skill calls.',
  'To rewrite narration through an LLM without exposing keys to the browser, set XAI_API_KEY (or ANTHROPIC_API_KEY / OPENAI_API_KEY) on the server only.',
]

/* ============================================================ NEWS ENGINE */

/**
 * News → market impact analysis.
 *
 * Every news item is deterministic and seeded. `classifyNewsImpact` returns which
 * assets are affected, in which direction, and with what magnitude. `analyzeNewsForUser`
 * folds in the trader's watchlist and open positions to produce personalised guidance:
 * confirms vs adverse, suggested action, and a Bitget deep-link so the trader can act.
 *
 * The bitget-signal MCP news feed (via news-briefing) can replace DEMO_NEWS body-for-body;
 * the shape is deliberately compatible.
 */

export const NEWS_CATEGORIES = ['earnings', 'macro', 'regulatory', 'on-chain', 'product', 'geopolitical', 'exchange']

/** A rotating deck of realistic breaking-news items across the universe. */
export const DEMO_NEWS = [
  {
    id: 'news-nvda-print',
    headline: 'NVIDIA reports Q3 revenue beat on data-center demand; guidance intact',
    detail: 'Data-center segment up 92% YoY; management sees no near-term slowdown in AI capex.',
    category: 'earnings', severity: 'HIGH', source: 'MarketWire',
    affectedAssets: [
      { symbol: 'NVDA', direction: 'UP',   magnitude: 0.85, reasoning: 'Beat + intact guidance historically extends the move overnight when liquidity is HIGH.' },
      { symbol: 'AMD',  direction: 'UP',   magnitude: 0.55, reasoning: 'Semis / AI beta co-moves with NVDA on print sessions.' },
      { symbol: 'MSFT', direction: 'UP',   magnitude: 0.30, reasoning: 'Azure AI capex is downstream of NVDA hardware demand.' },
    ],
    regimeShift: null,
  },
  {
    id: 'news-btc-etf-flows',
    headline: 'Spot BTC ETFs post $612M net inflow — largest since Jan',
    detail: 'IBIT led with $310M; ARKB and FBTC positive. Weekly cumulative flow back above $1.2B.',
    category: 'on-chain', severity: 'HIGH', source: 'Farside',
    affectedAssets: [
      { symbol: 'BTC',  direction: 'UP', magnitude: 0.80, reasoning: 'Sustained spot ETF inflows are the primary driver of the current BTC regime.' },
      { symbol: 'MSTR', direction: 'UP', magnitude: 0.70, reasoning: 'MSTR premium expands on BTC risk-on.' },
      { symbol: 'COIN', direction: 'UP', magnitude: 0.50, reasoning: 'Exchange volumes track BTC flow-driven trend days.' },
      { symbol: 'ETH',  direction: 'UP', magnitude: 0.35, reasoning: 'Cross-asset crypto risk-on.' },
    ],
    regimeShift: 'RISK_ON',
  },
  {
    id: 'news-fomc-hawkish',
    headline: 'FOMC minutes reveal hawkish tilt; DXY breaks 105.0',
    detail: 'Members signalled fewer cuts than the market implies. 10y yield up 8bps; DXY at 3-month high.',
    category: 'macro', severity: 'HIGH', source: 'Reuters',
    affectedAssets: [
      { symbol: 'BTC',  direction: 'DOWN', magnitude: 0.60, reasoning: 'DXY strength and higher real yields historically pressure crypto.' },
      { symbol: 'ETH',  direction: 'DOWN', magnitude: 0.55, reasoning: 'Duration-sensitive risk asset.' },
      { symbol: 'NVDA', direction: 'DOWN', magnitude: 0.35, reasoning: 'High-multiple equities compress on hawkish repricing.' },
      { symbol: 'SOL',  direction: 'DOWN', magnitude: 0.50, reasoning: 'Higher-beta crypto sells off harder in risk-off.' },
    ],
    regimeShift: 'RISK_OFF',
  },
  {
    id: 'news-sec-eth-etf',
    headline: 'SEC approves in-kind creation/redemption for spot ETH ETFs',
    detail: 'Structural upgrade widely expected to compress ETF-vs-spot basis and improve authorized-participant economics.',
    category: 'regulatory', severity: 'HIGH', source: 'SEC filing',
    affectedAssets: [
      { symbol: 'ETH',  direction: 'UP',   magnitude: 0.75, reasoning: 'In-kind mechanics historically tighten ETF spread and boost demand.' },
      { symbol: 'COIN', direction: 'UP',   magnitude: 0.45, reasoning: 'Coinbase Custody is the largest ETF custodian.' },
      { symbol: 'BTC',  direction: 'UP',   magnitude: 0.30, reasoning: 'Read-through to BTC ETF product improvements.' },
    ],
    regimeShift: 'RISK_ON',
  },
  {
    id: 'news-msft-outage',
    headline: 'Azure regional outage disrupts US-East enterprise workloads',
    detail: 'Microsoft investigating; ~90 minutes of degraded auth and storage services reported.',
    category: 'product', severity: 'MEDIUM', source: 'Microsoft status',
    affectedAssets: [
      { symbol: 'MSFT', direction: 'DOWN', magnitude: 0.35, reasoning: 'Outages historically produce short-lived overnight weakness.' },
      { symbol: 'AMZN', direction: 'UP',   magnitude: 0.15, reasoning: 'AWS often gains modest read-through on rival outages.' },
    ],
    regimeShift: null,
  },
  {
    id: 'news-china-tariff',
    headline: 'US signals fresh 25% tariff on China EV components',
    detail: 'Draft order targets battery cells and rare-earth processing; Chinese auto ADRs lower.',
    category: 'geopolitical', severity: 'MEDIUM', source: 'Bloomberg',
    affectedAssets: [
      { symbol: 'TSLA', direction: 'MIXED', magnitude: 0.55, reasoning: 'Reduces China EV competition domestically, but hurts input costs and China revenue.' },
      { symbol: 'AMD',  direction: 'DOWN',  magnitude: 0.25, reasoning: 'Chinese demand exposure.' },
    ],
    regimeShift: null,
  },
  {
    id: 'news-sol-firedancer',
    headline: 'Firedancer client hits testnet mainnet-compatibility milestone',
    detail: 'Second Solana validator client demonstrates full mainnet parity in Jump-run testnet slot.',
    category: 'product', severity: 'MEDIUM', source: 'Jump Research',
    affectedAssets: [
      { symbol: 'SOL', direction: 'UP', magnitude: 0.60, reasoning: 'Client diversity is the largest structural risk narrative around SOL.' },
    ],
    regimeShift: null,
  },
  {
    id: 'news-coin-volume',
    headline: 'Coinbase Q3 volumes come in $310B — 40% above consensus',
    detail: 'Institutional take rate held at 3bps; retail take rate expanded 4bps QoQ.',
    category: 'earnings', severity: 'HIGH', source: 'Coinbase IR',
    affectedAssets: [
      { symbol: 'COIN', direction: 'UP', magnitude: 0.80, reasoning: 'Volume beat with retail take-rate expansion is the highest-leverage COIN print.' },
      { symbol: 'BTC',  direction: 'UP', magnitude: 0.25, reasoning: 'Confirms crypto risk-on tape.' },
    ],
    regimeShift: 'RISK_ON',
  },
  {
    id: 'news-google-antitrust',
    headline: 'DOJ files search-remedy proposal — Chrome divestiture requested',
    detail: 'DOJ asks the court to force divestiture of Chrome and open default-search bidding.',
    category: 'regulatory', severity: 'HIGH', source: 'DOJ filing',
    affectedAssets: [
      { symbol: 'GOOGL', direction: 'DOWN', magnitude: 0.65, reasoning: 'Structural remedy would materially reduce search-distribution economics.' },
      { symbol: 'META',  direction: 'UP',   magnitude: 0.20, reasoning: 'Ad-share read-through to walled-garden competitors.' },
    ],
    regimeShift: null,
  },
  {
    id: 'news-btc-liquidations',
    headline: 'BTC liquidations top $480M in one hour on Coinbase and Binance',
    detail: 'Cascading longs took out $60-62k stops; funding flipped negative on OKX perps.',
    category: 'on-chain', severity: 'HIGH', source: 'Coinglass',
    affectedAssets: [
      { symbol: 'BTC',  direction: 'DOWN', magnitude: 0.65, reasoning: 'Post-cascade tape is choppy; short-term downside continuation is the modal case.' },
      { symbol: 'ETH',  direction: 'DOWN', magnitude: 0.55, reasoning: 'Follows BTC in liquidation cascades.' },
      { symbol: 'MSTR', direction: 'DOWN', magnitude: 0.60, reasoning: 'MSTR premium usually compresses in BTC drawdowns.' },
      { symbol: 'COIN', direction: 'DOWN', magnitude: 0.30, reasoning: 'Volume beat is discounted vs directional risk.' },
    ],
    regimeShift: 'RISK_OFF',
  },
  {
    id: 'news-aapl-services',
    headline: 'Apple Services revenue guided lower; App Store growth decelerates',
    detail: 'Q4 Services growth guided to +8% vs +12% consensus. Ad-network segment cited as weak spot.',
    category: 'earnings', severity: 'MEDIUM', source: 'Apple IR',
    affectedAssets: [
      { symbol: 'AAPL', direction: 'DOWN', magnitude: 0.55, reasoning: 'Services multiple has been the primary AAPL re-rating driver; deceleration compresses the print.' },
    ],
    regimeShift: null,
  },
  {
    id: 'news-eth-staking',
    headline: 'ETH staking ratio hits 30% of supply; queue clears',
    detail: 'Activation queue at 0 for the first time since Shapella; withdrawal queue also clearing.',
    category: 'on-chain', severity: 'LOW', source: 'beaconcha.in',
    affectedAssets: [
      { symbol: 'ETH', direction: 'UP', magnitude: 0.35, reasoning: 'Structurally reduces ETH float; balances against yield-driven selling.' },
    ],
    regimeShift: null,
  },
]

/**
 * Sanitize an untrusted URL (e.g. RSS <link>) for safe use in an href.
 * Blocks javascript:/data: and other script-executing schemes that would run
 * in the app origin and could exfiltrate the localStorage auth token.
 */
export function safeUrl(u) {
  try {
    const parsed = new URL(String(u ?? ''), 'https://placeholder.invalid')
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href
  } catch { /* fall through */ }
  return '#'
}

/** Bitget deep-link for a symbol (spot USDT pair by default; equity tokens use rEQUITY convention). */
export function bitgetTradeUrl(symbol, direction = 'LONG') {
  const asset = DEMO_UNIVERSE.find(a => a.symbol === symbol)
  if (!asset) return `https://www.bitget.com/spot/${symbol}USDT`
  if (asset.class === 'crypto') return `https://www.bitget.com/spot/${symbol}USDT`
  // Bitget lists tokenized U.S. equities under the rEQUITY-USDT convention on their tokenized-stocks surface.
  return `https://www.bitget.com/pre-market/stocks/${symbol}`
}

/** Suggested trade direction for a news impact on an asset, combined with existing exposure. */
function suggestActionForAsset({ affected, position, watching }) {
  const dir = affected.direction
  if (position) {
    const confirms = (position.direction === 'LONG' && dir === 'UP') || (position.direction === 'SHORT' && dir === 'DOWN')
    if (dir === 'MIXED') return { label: 'REVIEW', tone: 'amber', text: `News is mixed for your open ${position.direction.toLowerCase()} ${affected.symbol}. Re-research before adding.` }
    return confirms
      ? { label: 'CONFIRMING',    tone: 'green', text: `News agrees with your open ${position.direction.toLowerCase()} ${affected.symbol}. Consider tightening stop, not adding size.` }
      : { label: 'ADVERSE',       tone: 'red',   text: `News fights your open ${position.direction.toLowerCase()} ${affected.symbol}. Consider a hedge or exit.` }
  }
  if (watching) {
    if (dir === 'UP')   return { label: 'RESEARCH LONG',  tone: 'green', text: `${affected.symbol} is in your watchlist and this news supports upside. Run research to size.` }
    if (dir === 'DOWN') return { label: 'RESEARCH SHORT', tone: 'amber', text: `${affected.symbol} is in your watchlist and this news supports downside. Run research to size.` }
    return { label: 'REVIEW', tone: 'amber', text: `${affected.symbol} is in your watchlist and the news impact is mixed.` }
  }
  return { label: dir === 'UP' ? 'CONSIDER LONG' : dir === 'DOWN' ? 'CONSIDER SHORT' : 'MONITOR', tone: 'muted', text: `${affected.symbol} not in your book — informational.` }
}

/** Classify a news item into affected assets. Idempotent; already computed on DEMO_NEWS items. */
export function classifyNewsImpact(newsItem) {
  return {
    id: newsItem.id,
    category: newsItem.category,
    severity: newsItem.severity,
    regimeShift: newsItem.regimeShift ?? null,
    affectedAssets: (newsItem.affectedAssets || []).slice().sort((a, b) => (b.magnitude || 0) - (a.magnitude || 0)),
  }
}

/** For a news item and a user session, produce per-user impact analysis + suggested actions. */
export function analyzeNewsForUser(newsItem, session) {
  const impact = classifyNewsImpact(newsItem)
  const watchlist = new Set(session?.watchlist || [])
  const openBySymbol = new Map((session?.positions || []).filter(p => p.status === 'OPEN').map(p => [p.asset, p]))
  const rows = impact.affectedAssets.map(a => ({
    ...a,
    watching: watchlist.has(a.symbol),
    position: openBySymbol.get(a.symbol) || null,
    action: suggestActionForAsset({ affected: a, position: openBySymbol.get(a.symbol) || null, watching: watchlist.has(a.symbol) }),
    bitgetUrl: bitgetTradeUrl(a.symbol, a.direction === 'DOWN' ? 'SHORT' : 'LONG'),
  }))
  // Weights: an open position matters far more than watchlist interest.
  const relevance = rows.reduce((s, r) => s + (r.magnitude || 0) * (r.position ? 4 : r.watching ? 1 : 0.2), 0)
  const relevanceTier = relevance >= 1.2 ? 'HIGH' : relevance >= 0.5 ? 'MEDIUM' : 'LOW'
  return {
    id: `imp-${newsItem.id}-${Date.now().toString(36)}`,
    newsId: newsItem.id,
    rows,
    relevance: Number(relevance.toFixed(2)),
    relevanceTier,
    regimeShift: impact.regimeShift,
    positionsTouched: rows.filter(r => r.position).length,
    watchlistTouched: rows.filter(r => r.watching).length,
    summary: buildNewsSummary(newsItem, rows),
  }
}

function buildNewsSummary(item, rows) {
  const primary = rows[0]
  if (!primary) return `${item.headline}. No affected assets in universe.`
  const others = rows.slice(1).filter(r => r.magnitude >= 0.3).map(r => r.symbol)
  const other = others.length ? ` Also touches ${others.join(', ')}.` : ''
  return `${item.headline}. Primary impact: ${primary.symbol} ${primary.direction.toLowerCase()} · magnitude ${(primary.magnitude * 100).toFixed(0)}%.${other}`
}

/** Ingest a fresh news item into the session and return the enriched session. */
export function ingestNewsItem(session, newsItem) {
  const stamped = {
    ...newsItem,
    time: newsItem.time || nowClock(),
    publishedAt: newsItem.publishedAt || new Date().toISOString(),
    ingestedAt: new Date().toISOString(),
    isSimulated: newsItem.isSimulated === true,
  }
  const analysis = analyzeNewsForUser(stamped, session)
  const alerts = analysis.relevanceTier === 'HIGH' || (analysis.positionsTouched > 0 && stamped.severity === 'HIGH')
    ? [analysis, ...(session.newsAlerts || [])].slice(0, 20)
    : session.newsAlerts || []
  const news = [{ ...stamped, analysis }, ...(session.news || [])].slice(0, 60)
  return addLog({ ...session, news, newsAlerts: alerts, newsCursor: (session.newsCursor || 0) + 1 }, 'NEWS', stamped.headline, stamped.source)
}

/** Return the next demo news item to inject on the live simulation tick. */
export function pickNextDemoNews(cursor = 0) {
  const idx = ((cursor | 0) % DEMO_NEWS.length + DEMO_NEWS.length) % DEMO_NEWS.length
  return DEMO_NEWS[idx]
}

/* -------------------------------- seeded news for first-run initialSession */

const _SEED_WATCHLIST = ['NVDA', 'AMD', 'MSTR', 'BTC', 'ETH', 'SOL', 'COIN']

function seedNews() {
  const items = [DEMO_NEWS[0], DEMO_NEWS[1], DEMO_NEWS[2]]        // NVDA print · BTC ETF flows · FOMC minutes
  return items.map((raw, i) => {
    const stamped = { ...raw, time: `02:${(10 + i * 4).toString().padStart(2, '0')}:${(11 + i).toString().padStart(2, '0')}`, publishedAt: new Date(Date.now() - (i + 1) * 12 * 60 * 1000).toISOString(), isSimulated: true }
    stamped.analysis = analyzeNewsForUser(stamped, { watchlist: _SEED_WATCHLIST, positions: [] })
    return stamped
  })
}

function seedNewsAlerts() {
  const items = seedNews().filter(n => n.analysis.relevanceTier === 'HIGH')
  return items.map(i => i.analysis).slice(0, 5)
}
