/**
 * Real news ingester.
 *
 * Polls a small set of free public RSS feeds (CoinDesk, TheBlock, SEC 8-K RSS,
 * Reuters World News), parses items, dedupes by content hash, classifies each
 * item into affected assets + direction + magnitude, and pushes into the
 * in-memory news store.
 *
 * The classifier is a hybrid:
 *   1. If LLM key available (XAI/ANTHROPIC/OPENAI): ask the model for a
 *      strict-JSON impact analysis. Cache per news hash.
 *   2. Otherwise: keyword-heuristic classifier over the 18-asset universe.
 *
 * No new dependencies. RSS parsing is regex-based over well-formed RSS 2.0.
 */
import crypto from 'node:crypto'
import { logger } from '../lib/log.mjs'

const NEWS_TIMEOUT_MS = Number(process.env.NEWS_TIMEOUT_MS || 6000)
const NEWS_POLL_MS    = Number(process.env.NEWS_POLL_MS    || 60_000)      // 60s
const NEWS_KEEP_MAX   = Number(process.env.NEWS_KEEP_MAX   || 120)

/**
 * RSS feeds — free, no auth. Verified reachable 2026-09.
 * NOTE: sec.gov requires a declared User-Agent with contact info (their
 * fair-access policy) — a generic UA gets 403. reuters worldNews was
 * discontinued upstream; CNBC + Yahoo Finance replace it.
 */
const SEC_UA = process.env.SEC_USER_AGENT || 'NightwatchAI Research admin@nightwatch.local'

export const FEEDS = [
  { id: 'coindesk',    name: 'CoinDesk',      url: 'https://www.coindesk.com/arc/outboundfeeds/rss', kind: 'crypto' },
  { id: 'theblock',    name: 'The Block',     url: 'https://www.theblock.co/rss.xml',                kind: 'crypto' },
  { id: 'cointelegraph', name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss',                kind: 'crypto' },
  { id: 'sec-8k',      name: 'SEC 8-K',       url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&count=40&output=atom', kind: 'equity', ua: SEC_UA },
  { id: 'yahoo-fin',   name: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex',        kind: 'equity' },
  { id: 'cnbc-top',    name: 'CNBC',          url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', kind: 'macro' },
]

/* ------------------------------------------------------------ RSS parser */

function decodeXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}
function stripHtml(s) { return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() }
function pick(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`))
  return m ? decodeXml(m[1]).trim() : ''
}
export function parseRss(xml) {
  if (!xml) return []
  // Support RSS 2.0 <item> and Atom <entry>.
  const kind = xml.includes('<entry') && !xml.includes('<item') ? 'atom' : 'rss'
  const rx = kind === 'atom' ? /<entry\b[\s\S]*?<\/entry>/g : /<item\b[\s\S]*?<\/item>/g
  const items = xml.match(rx) || []
  return items.map(block => {
    const title = pick(block, 'title')
    const link = kind === 'atom'
      ? (block.match(/<link[^>]*href="([^"]+)"/) || [])[1] || ''
      : pick(block, 'link')
    const description = pick(block, kind === 'atom' ? 'summary' : 'description') || pick(block, 'content')
    const pub = pick(block, kind === 'atom' ? 'updated' : 'pubDate') || pick(block, 'published')
    return { title: stripHtml(title), link, description: stripHtml(description), publishedAt: pub ? new Date(pub).toISOString() : new Date().toISOString() }
  }).filter(r => r.title && r.link)
}

async function fetchText(url, ua = 'NightwatchAI/1.1 (news-ingester; +https://github.com)') {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': ua, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
        signal: AbortSignal.timeout(NEWS_TIMEOUT_MS),
      })
      if (!res.ok) return null
      return await res.text()
    } catch {
      if (attempt === 0) { await new Promise(r => setTimeout(r, 300)); continue }
      return null
    }
  }
  return null
}

/* ---------------------------------------------------------- heuristic classifier */

// Keyword → asset mapping. Keep terse; the LLM does the nuance when available.
const ASSET_HINTS = [
  { symbol: 'BTC',   words: ['bitcoin', 'btc', 'ibit', 'spot bitcoin', 'grayscale gbtc'] },
  { symbol: 'ETH',   words: ['ethereum', 'eth ', 'staking', 'shapella', 'ether'] },
  { symbol: 'SOL',   words: ['solana', 'sol ', 'firedancer'] },
  { symbol: 'BNB',   words: ['binance', 'bnb', 'binance smart chain'] },
  { symbol: 'XRP',   words: ['ripple', 'xrp', 'rlusd'] },
  { symbol: 'DOGE',  words: ['dogecoin', 'doge'] },
  { symbol: 'AVAX',  words: ['avalanche', 'avax'] },
  { symbol: 'ADA',   words: ['cardano', 'ada '] },
  { symbol: 'NVDA',  words: ['nvidia', 'nvda', 'jensen huang', 'blackwell'] },
  { symbol: 'TSLA',  words: ['tesla', 'tsla', 'elon musk', 'robotaxi', 'cybertruck'] },
  { symbol: 'AAPL',  words: ['apple', 'aapl', 'iphone', 'app store'] },
  { symbol: 'MSFT',  words: ['microsoft', 'msft', 'azure', 'satya nadella', 'copilot'] },
  { symbol: 'AMZN',  words: ['amazon', 'amzn', 'aws', 'andy jassy'] },
  { symbol: 'GOOGL', words: ['google', 'googl', 'alphabet', 'sundar pichai', 'gemini'] },
  { symbol: 'META',  words: ['meta ', 'facebook', 'instagram', 'zuckerberg', 'threads'] },
  { symbol: 'AMD',   words: ['advanced micro', 'amd ', 'lisa su', 'mi300', 'mi400'] },
  { symbol: 'COIN',  words: ['coinbase', 'coin '] },
  { symbol: 'MSTR',  words: ['microstrategy', 'mstr', 'saylor'] },
]

const UP_WORDS   = ['beat', 'beats', 'surge', 'surges', 'rally', 'rallies', 'soar', 'soars', 'jump', 'jumps', 'spike', 'spikes', 'rise', 'rises', 'climb', 'climbs', 'advance', 'advances', 'gain', 'gains', 'record', 'approve', 'approved', 'approval', 'positive', 'strong', 'upgrade', 'upgrades', 'raises', 'raise', 'exceeds', 'inflow', 'inflows', 'bullish', 'boost', 'boosts', 'adopt', 'adoption', 'win', 'wins', 'halving', 'breakout', 'accumulation', 'buyback', 'buybacks']
const DOWN_WORDS = ['miss', 'misses', 'plunge', 'plunges', 'slump', 'slumps', 'drop', 'drops', 'fall', 'falls', 'fell', 'slide', 'slides', 'slip', 'slips', 'tumble', 'tumbles', 'decline', 'declines', 'crash', 'crashes', 'selloff', 'sell-off', 'dump', 'shed', 'sheds', 'reject', 'rejected', 'denied', 'negative', 'weak', 'downgrade', 'downgrades', 'cuts', 'cut', 'below', 'losses', 'outflow', 'outflows', 'bearish', 'sec sues', 'sues', 'lawsuit', 'investigation', 'probe', 'ban', 'bans', 'hack', 'hacked', 'exploit', 'fine', 'fined', 'penalty', 'warning', 'warns', 'delist', 'delisting', 'bankruptcy', 'layoff', 'layoffs', 'fraud']
const HIGH_SEV_WORDS = ['earnings', 'fomc', 'rate decision', 'sec approves', 'sec rejects', 'ban', 'hack', 'exploit', 'liquidation', 'bankruptcy']

const CATEGORY_HINTS = [
  { cat: 'earnings',     words: ['earnings', 'revenue', 'eps', 'quarterly', 'q1', 'q2', 'q3', 'q4'] },
  { cat: 'regulatory',   words: ['sec', 'cftc', 'doj', 'lawsuit', 'court', 'ruling', 'approve', 'approves', 'regulation', 'ban'] },
  { cat: 'macro',        words: ['fed', 'fomc', 'inflation', 'cpi', 'ppi', 'unemployment', 'gdp', 'rate', 'dxy'] },
  { cat: 'on-chain',     words: ['etf inflow', 'etf outflow', 'whale', 'staking', 'defi', 'tvl', 'liquidation', 'on-chain'] },
  { cat: 'product',      words: ['launch', 'release', 'update', 'unveils', 'announce'] },
  { cat: 'geopolitical', words: ['tariff', 'sanction', 'war', 'election', 'china', 'russia'] },
  { cat: 'exchange',     words: ['listing', 'delist', 'volume', 'exchange'] },
]

/** Word-boundary match — avoids substring traps like "exh-ibit-s" → IBIT or "Can-ada" → ADA. */
function wordMatch(text, w) {
  const cleaned = String(w).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!cleaned) return false
  return new RegExp(`\\b${cleaned}\\b`).test(text)
}

export function heuristicClassify(item) {
  // Works on both raw RSS rows ({title, description}) and normalized items ({headline, detail}).
  const text = `${item.headline || item.title || ''}. ${item.detail || item.description || ''}`.toLowerCase()
  // affected assets
  const affectedAssets = []
  for (const hint of ASSET_HINTS) {
    if (hint.words.some(w => wordMatch(text, w))) {
      const upHits = UP_WORDS.reduce((n, w) => n + (wordMatch(text, w) ? 1 : 0), 0)
      const dnHits = DOWN_WORDS.reduce((n, w) => n + (wordMatch(text, w) ? 1 : 0), 0)
      const direction = upHits > dnHits ? 'UP' : dnHits > upHits ? 'DOWN' : 'MIXED'
      const magnitude = Math.min(0.9, 0.35 + Math.abs(upHits - dnHits) * 0.15)
      affectedAssets.push({
        symbol: hint.symbol, direction, magnitude: Number(magnitude.toFixed(2)),
        reasoning: `Heuristic match on ${hint.symbol}: direction=${direction} from ${upHits} bullish / ${dnHits} bearish keywords.`,
      })
    }
  }
  // category
  let category = 'macro'
  let bestScore = 0
  for (const c of CATEGORY_HINTS) {
    const score = c.words.reduce((n, w) => n + (wordMatch(text, w) ? 1 : 0), 0)
    if (score > bestScore) { bestScore = score; category = c.cat }
  }
  // severity
  const highHit = HIGH_SEV_WORDS.some(w => wordMatch(text, w))
  const severity = highHit ? 'HIGH' : affectedAssets.length >= 2 ? 'MEDIUM' : 'LOW'
  // regime shift
  const upTotal = affectedAssets.filter(a => a.direction === 'UP').length
  const dnTotal = affectedAssets.filter(a => a.direction === 'DOWN').length
  const regimeShift = affectedAssets.length >= 3 && upTotal >= 3 ? 'RISK_ON' : affectedAssets.length >= 3 && dnTotal >= 3 ? 'RISK_OFF' : null
  return { affectedAssets, category, severity, regimeShift }
}

/* ---------------------------------------------------------- LLM classifier */

async function llmClassify(item, llm) {
  if (!llm?.enabled) return null
  const prompt = `You are a financial news impact analyst. Classify this headline against these tickers only: BTC ETH SOL BNB XRP DOGE AVAX ADA NVDA TSLA AAPL MSFT AMZN GOOGL META AMD COIN MSTR.

Return JSON ONLY, matching:
{
  "affectedAssets": [{ "symbol": "<TICKER>", "direction": "UP"|"DOWN"|"MIXED", "magnitude": 0.0-1.0, "reasoning": "<one sentence>" }],
  "category": "earnings"|"macro"|"regulatory"|"on-chain"|"product"|"geopolitical"|"exchange",
  "severity": "HIGH"|"MEDIUM"|"LOW",
  "regimeShift": "RISK_ON"|"RISK_OFF"|null
}

Headline: ${item.headline || item.title}
Detail: ${item.detail || item.description || ''}
Source: ${item.source}`
  try {
    const raw = await llm.jsonComplete(prompt)
    if (!raw?.affectedAssets) return null
    return {
      affectedAssets: raw.affectedAssets.slice(0, 8).map(a => ({
        symbol: String(a.symbol || '').toUpperCase(),
        direction: ['UP','DOWN','MIXED'].includes(a.direction) ? a.direction : 'MIXED',
        magnitude: Math.max(0, Math.min(1, Number(a.magnitude) || 0)),
        reasoning: String(a.reasoning || '').slice(0, 240),
      })).filter(a => /^[A-Z]{3,5}$/.test(a.symbol)),
      category: ['earnings','macro','regulatory','on-chain','product','geopolitical','exchange'].includes(raw.category) ? raw.category : 'macro',
      severity: ['HIGH','MEDIUM','LOW'].includes(raw.severity) ? raw.severity : 'MEDIUM',
      regimeShift: ['RISK_ON','RISK_OFF'].includes(raw.regimeShift) ? raw.regimeShift : null,
    }
  } catch (err) {
    logger.warn({ err: err.message, headline: item.title }, 'llm classify failed')
    return null
  }
}

/* ---------------------------------------------------------- store + poller */

/** Normalize a headline for cross-source event matching. */
export function normalizeHeadline(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w))
    .sort()
    .join(' ')
    .slice(0, 200)
}
const STOPWORDS = new Set(['the','and','for','with','from','after','into','over','under','this','that','they','their','said','says','have','has','will','would','could','should','been','were','are','was','but','not','now','more','less','just','than','then','when','how','why','who','which','been','only','also','one','two','three','can','yet','out','off','ago','via','per','tue','wed','thu','fri','sat','sun','mon','jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'])

/** Rough overlap ratio between two normalized headlines. */
export function tokenOverlap(a, b) {
  if (!a || !b) return 0
  const A = new Set(a.split(' '))
  const B = new Set(b.split(' '))
  const both = [...A].filter(x => B.has(x)).length
  const total = new Set([...A, ...B]).size
  return total ? both / total : 0
}

export function makeNewsStore({ llm } = {}) {
  /** Deduped items, newest first. */
  const items = []
  const seen  = new Set()

  const subscribers = new Set()      // (item) => void

  function subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn) }
  function list(limit = 60) { return items.slice(0, limit) }

  /** Look for an existing item that describes the same event (>=60% token overlap). */
  function findCrossSourceMatch(raw) {
    const norm = normalizeHeadline(raw.title)
    for (const existing of items.slice(0, 30)) {
      const existingNorm = normalizeHeadline(existing.headline)
      const overlap = tokenOverlap(norm, existingNorm)
      if (overlap >= 0.6) return existing
    }
    return null
  }

  async function ingestRaw(raw, feed) {
    const hash = crypto.createHash('sha1').update(`${raw.title}::${raw.link}`).digest('hex').slice(0, 12)
    if (seen.has(hash)) return null
    seen.add(hash)

    // Cross-source dedup: if we've already seen this event from another source, add citation.
    const twin = findCrossSourceMatch(raw)
    if (twin) {
      twin.citations = twin.citations || [{ source: twin.source, url: twin.url }]
      if (!twin.citations.some(c => c.url === raw.link)) {
        twin.citations.push({ source: feed.name, url: raw.link })
      }
      subscribers.forEach(fn => { try { fn(twin) } catch { /* ignore */ } })
      return null
    }

    const item = {
      id: `news-live-${hash}`,
      hash,
      headline: raw.title,
      detail: raw.description?.slice(0, 400) || raw.title,
      source: feed.name,
      feedId: feed.id,
      url: raw.link,
      publishedAt: raw.publishedAt,
      time: raw.publishedAt.slice(11, 19),
      isSimulated: false,
      live: true,
      citations: [{ source: feed.name, url: raw.link }],
    }
    const classified = (await llmClassify(item, llm)) || heuristicClassify(item)
    item.category      = classified.category
    item.severity      = classified.severity
    item.regimeShift   = classified.regimeShift
    item.affectedAssets = classified.affectedAssets
    // Drop items that touch no assets in our universe (noise).
    if (item.affectedAssets.length === 0) return null
    items.unshift(item)
    if (items.length > NEWS_KEEP_MAX) items.length = NEWS_KEEP_MAX
    subscribers.forEach(fn => { try { fn(item) } catch { /* ignore subscriber errors */ } })
    return item
  }

  async function pollFeed(feed) {
    const xml = await fetchText(feed.url, feed.ua)
    if (!xml) { logger.warn({ feed: feed.id }, 'news fetch failed'); return 0 }
    const rows = parseRss(xml).slice(0, 20)     // cap per poll
    let added = 0
    for (const row of rows) {
      const ingested = await ingestRaw(row, feed)
      if (ingested) added++
    }
    return added
  }

  async function pollAll() {
    let total = 0
    for (const feed of FEEDS) total += await pollFeed(feed)
    if (total > 0) logger.info({ ingested: total }, 'news ingested')
    return total
  }

  let handle = null
  function start() {
    if (handle) return
    pollAll().catch(err => logger.warn({ err: err.message }, 'initial news poll failed'))
    handle = setInterval(() => pollAll().catch(err => logger.warn({ err: err.message }, 'news poll failed')), NEWS_POLL_MS)
    handle.unref?.()
    logger.info({ intervalMs: NEWS_POLL_MS, feeds: FEEDS.length }, 'news poller started')
  }
  function stop() { if (handle) { clearInterval(handle); handle = null } }

  return { list, subscribe, start, stop, pollAll, ingestRaw, _items: items, _seen: seen }
}
