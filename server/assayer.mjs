/**
 * The Assayer — AI chat companion for NIGHTWATCH.
 *
 * A stateless chat endpoint. The trader messages The Assayer with plain-
 * language questions or half-formed strategies; the Assayer responds and
 * (when asked) proposes a structured Playbook JSON the trader can save.
 *
 * When an LLM key is present we use it. Otherwise a heuristic responder
 * still lets the trader see the flow and save a valid Playbook.
 */

import { getAllTickers } from './providers/bitget.mjs'
import { getFearGreed } from './providers/marketintel.mjs'
import { logger } from './lib/log.mjs'

const SYSTEM = `You are The Assayer, NIGHTWATCH AI's research companion. You speak in the tone of a 19th-century assay office: precise, honest, plainspoken, occasionally poetic. You help traders turn plain-language ideas into structured Playbooks. When they ask you to write a Playbook, return JSON matching:
{
  "playbook": {
    "title": "...",
    "description": "...",
    "asset": "<TICKER>",
    "direction": "LONG" | "SHORT",
    "signalConditions": [{ "field": "price"|"change24h"|"rsi14"|"fearGreed"|"fundingRate"|"etfTrailing5UsdM"|"fundingSkewBps"|"btc24hChange", "op": "<"|">"|"<="|">="|"=="|"!=", "value": <number> }],
    "exitConditions":   [{ "field": ..., "op": ..., "value": ... }],
    "sizing": { "type": "fixed_pct_of_capital", "value": 0.05-0.25 },
    "tags": ["..."]
  },
  "note": "One short sentence to the trader about the choice."
}

Rules:
- Never invent data. If you don't know a value, ask.
- No investment advice. This is paper only.
- Prefer 2-3 signal conditions and 1-2 exit conditions.
- Sizing default 0.10 (10% of paper capital) unless the setup is high-conviction.
- Speak in short paragraphs. No bullet lists unless requested.

If the trader is just asking a question, answer with prose only (no "playbook" key).`

export async function chat({ messages = [], intent = 'chat', llm } = {}) {
  const last = messages[messages.length - 1]?.content || ''
  if (llm?.enabled) {
    const prompt = [SYSTEM, '', 'Conversation so far:'].concat(
      messages.map(m => `${m.role.toUpperCase()}: ${m.content}`),
      ['', 'Reply as The Assayer. Return JSON: {"reply": "<your prose reply, keep concise>", "playbook": <optional playbook object>}']
    ).join('\n')
    const out = await llm.jsonComplete(prompt).catch(() => null)
    if (out?.reply) {
      return { reply: String(out.reply).slice(0, 1500), playbook: out.playbook || null, source: 'llm' }
    }
  }
  return heuristicChat(last)
}

/** Simple heuristic replies that keep the demo flowing without an LLM. */
async function heuristicChat(text) {
  const t = String(text || '').toLowerCase()
  const tickers = t.match(/\b(btc|eth|sol|bnb|xrp|doge|avax|ada|nvda|tsla|aapl|msft|amzn|googl|meta|amd|coin|mstr)\b/i)
  const asset = tickers ? tickers[0].toUpperCase() : 'BTC'
  const tickerSnap = await getAllTickers().catch(() => null)
  const t2 = tickerSnap?.[asset]
  const fg = await getFearGreed().catch(() => null)

  // "build" / "playbook" intent → synthesize
  if (/(build|playbook|strategy|rule|when|if)/.test(t)) {
    const direction = /(short|down|bear|crash|fade|sell)/.test(t) ? 'SHORT' : 'LONG'
    const useRsi   = /(oversold|overbought|rsi)/.test(t)
    const useFg    = /(fear|greed|sentiment)/.test(t)
    const useFlow  = /(etf|flow|inflow|outflow)/.test(t)
    const useFund  = /(funding|open interest|oi)/.test(t)
    const signalConditions = []
    if (useRsi)   signalConditions.push({ field: 'rsi14', op: direction === 'LONG' ? '<' : '>', value: direction === 'LONG' ? 30 : 70 })
    if (useFg)    signalConditions.push({ field: 'fearGreed', op: direction === 'LONG' ? '<' : '>', value: direction === 'LONG' ? 30 : 70 })
    if (useFlow)  signalConditions.push({ field: 'etfTrailing5UsdM', op: direction === 'LONG' ? '>' : '<', value: direction === 'LONG' ? 300 : -300 })
    if (useFund)  signalConditions.push({ field: 'fundingRate', op: direction === 'LONG' ? '<' : '>', value: 0 })
    if (signalConditions.length === 0) signalConditions.push({ field: 'change24h', op: direction === 'LONG' ? '>' : '<', value: direction === 'LONG' ? 2 : -2 })
    const playbook = {
      title: `${asset} ${direction === 'LONG' ? (useRsi ? 'oversold bounce' : useFlow ? 'flow follow' : 'trend follow') : 'fade'}`,
      description: `Auto-drafted from your prompt. ${direction} ${asset} when ${signalConditions.map(c => `${c.field} ${c.op} ${c.value}`).join(' AND ')}. Exit at a 3% adverse stop or RSI ${direction === 'LONG' ? '> 65' : '< 35'}.`,
      asset, direction,
      signalConditions,
      exitConditions: [
        { field: 'drawdownFromEntry', op: '<', value: -0.03 },
        { field: 'rsi14', op: direction === 'LONG' ? '>' : '<', value: direction === 'LONG' ? 65 : 35 },
      ],
      sizing: { type: 'fixed_pct_of_capital', value: 0.10 },
      tags: [asset.toLowerCase(), direction.toLowerCase()],
    }
    const price = t2?.last ? `$${t2.last.toLocaleString()}` : 'unknown'
    return {
      reply: `Sketched a ${asset} ${direction.toLowerCase()} playbook. ${asset} last prints ${price}${fg ? `, Fear & Greed at ${fg.value} (${fg.classification})` : ''}. Review the conditions, then Save. Paper only — no real capital moves.`,
      playbook,
      source: 'heuristic',
    }
  }
  // Q&A intent → give facts
  const facts = []
  if (t2)  facts.push(`${asset} last: $${t2.last?.toLocaleString()} (${t2.changePct24h?.toFixed(2)}% 24h)`)
  if (fg)  facts.push(`Crypto Fear & Greed: ${fg.value} (${fg.classification}, 7d trend ${fg.trend7d > 0 ? '+' : ''}${fg.trend7d})`)
  return {
    reply: facts.length
      ? `${facts.join(' · ')}. Ask me to draft a playbook — say "build a ${asset.toLowerCase()} oversold bounce" or similar — and I'll produce one you can allocate paper capital to.`
      : `I'm The Assayer. Tell me an asset and a setup — for example, "build a BTC ETF-flow follow" or "sketch an ETH oversold bounce" — and I'll draft a Playbook you can review, backtest, and (paper) allocate to.`,
    playbook: null,
    source: 'heuristic',
  }
}
