/**
 * Provider-agnostic LLM adapter for narration + classification.
 * Auto-selects xAI, Anthropic, or OpenAI based on which key is set.
 * Every response is JSON-mode; callers hand in a JSON prompt.
 */
import { logger } from './log.mjs'

export function makeLlm() {
  const XAI_KEY       = process.env.XAI_API_KEY
  const XAI_BASE      = process.env.XAI_BASE_URL || 'https://api.x.ai/v1'
  const XAI_MODEL     = process.env.XAI_MODEL   || 'grok-4-fast'
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
  const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'
  const OPENAI_KEY    = process.env.OPENAI_API_KEY
  const OPENAI_MODEL  = process.env.OPENAI_MODEL || 'gpt-5'
  const TIMEOUT_MS    = Number(process.env.LLM_TIMEOUT_MS || 9000)

  const enabled = Boolean(XAI_KEY || ANTHROPIC_KEY || OPENAI_KEY)
  const provider = XAI_KEY ? 'xai' : ANTHROPIC_KEY ? 'anthropic' : OPENAI_KEY ? 'openai' : 'none'
  const model    = XAI_KEY ? XAI_MODEL : ANTHROPIC_KEY ? ANTHROPIC_MODEL : OPENAI_KEY ? OPENAI_MODEL : null

  async function jsonComplete(prompt) {
    if (!enabled) return null
    const started = Date.now()
    let out = null
    try {
      if (XAI_KEY) out = await xai(prompt, XAI_KEY, XAI_BASE, XAI_MODEL, TIMEOUT_MS)
      else if (ANTHROPIC_KEY) out = await anthropic(prompt, ANTHROPIC_KEY, ANTHROPIC_MODEL, TIMEOUT_MS)
      else if (OPENAI_KEY) out = await openai(prompt, OPENAI_KEY, OPENAI_MODEL, TIMEOUT_MS)
      logger.debug({ provider, model, latencyMs: Date.now() - started }, 'llm ok')
      return out
    } catch (err) {
      logger.warn({ provider, model, latencyMs: Date.now() - started, err: err.message }, 'llm failed')
      return null
    }
  }

  return { enabled, provider, model, jsonComplete }
}

async function xai(prompt, key, base, model, timeout) {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(timeout),
  })
  if (!res.ok) throw new Error(`xAI ${res.status}`)
  const body = await res.json()
  return JSON.parse(body.choices?.[0]?.message?.content || '{}')
}
async function anthropic(prompt, key, model, timeout) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 800, temperature: 0.2, messages: [{ role: 'user', content: `${prompt}\n\nReturn ONLY a JSON object.` }] }),
    signal: AbortSignal.timeout(timeout),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}`)
  const body = await res.json()
  const text = body.content?.[0]?.text || '{}'
  const match = text.match(/\{[\s\S]*\}/)
  return match ? JSON.parse(match[0]) : {}
}
async function openai(prompt, key, model, timeout) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(timeout),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}`)
  const body = await res.json()
  return JSON.parse(body.choices?.[0]?.message?.content || '{}')
}
