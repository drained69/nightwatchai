/**
 * Provider-agnostic LLM adapter for narration + classification.
 * Auto-selects Qwen, xAI, Anthropic, or OpenAI based on which key is set.
 * Every response is JSON-mode; callers hand in a JSON prompt.
 */
import { logger } from './log.mjs'

export function makeLlm() {
  const QWEN_KEY      = process.env.QWEN_API_KEY
  const QWEN_BASE     = (process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '')
  const QWEN_MODEL    = process.env.QWEN_MODEL || 'qwen3-8b'
  const XAI_KEY       = process.env.XAI_API_KEY
  const XAI_BASE      = (process.env.XAI_BASE_URL || 'https://api.x.ai/v1').replace(/\/$/, '')
  const XAI_MODEL     = process.env.XAI_MODEL   || 'grok-4-fast'
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
  const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'
  const OPENAI_KEY    = process.env.OPENAI_API_KEY
  const OPENAI_BASE   = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const OPENAI_MODEL  = process.env.OPENAI_MODEL || 'gpt-5'
  const TIMEOUT_MS    = Number(process.env.LLM_TIMEOUT_MS || 9000)

  const enabled = Boolean(QWEN_KEY || XAI_KEY || ANTHROPIC_KEY || OPENAI_KEY)
  const provider = QWEN_KEY ? 'qwen' : XAI_KEY ? 'xai' : ANTHROPIC_KEY ? 'anthropic' : OPENAI_KEY ? 'openai' : 'none'
  const model    = QWEN_KEY ? QWEN_MODEL : XAI_KEY ? XAI_MODEL : ANTHROPIC_KEY ? ANTHROPIC_MODEL : OPENAI_KEY ? OPENAI_MODEL : null

  // Qwen3 models default to "thinking mode" which burns hundreds of hidden
  // reasoning tokens (~25s+ per call). Our narration/classification prompts
  // don't need it — flipping it off drops latency ~6× with no quality loss on
  // structured JSON tasks. Unknown extras are ignored by OpenAI-proper.
  const QWEN_EXTRA = { enable_thinking: false }

  async function jsonComplete(prompt) {
    if (!enabled) return null
    const started = Date.now()
    let out = null
    try {
      if (QWEN_KEY)           out = await openaiCompat(prompt, QWEN_KEY, QWEN_BASE, QWEN_MODEL, TIMEOUT_MS, QWEN_EXTRA)
      else if (XAI_KEY)       out = await openaiCompat(prompt, XAI_KEY, XAI_BASE, XAI_MODEL, TIMEOUT_MS)
      else if (ANTHROPIC_KEY) out = await anthropic(prompt, ANTHROPIC_KEY, ANTHROPIC_MODEL, TIMEOUT_MS)
      else if (OPENAI_KEY)    out = await openaiCompat(prompt, OPENAI_KEY, OPENAI_BASE, OPENAI_MODEL, TIMEOUT_MS)
      logger.debug({ provider, model, latencyMs: Date.now() - started }, 'llm ok')
      return out
    } catch (err) {
      logger.warn({ provider, model, latencyMs: Date.now() - started, err: err.message }, 'llm failed')
      return null
    }
  }

  return { enabled, provider, model, jsonComplete }
}

/** OpenAI-compatible chat/completions endpoint (Qwen DashScope, xAI, OpenAI, OpenRouter, Together, vLLM…). */
async function openaiCompat(prompt, key, base, model, timeout, extra = {}) {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
      ...extra,
    }),
    signal: AbortSignal.timeout(timeout),
  })
  if (!res.ok) throw new Error(`${base} ${res.status}`)
  const body = await res.json()
  const text = body.choices?.[0]?.message?.content || '{}'
  // Some OpenAI-compatible servers (Qwen included) can wrap JSON in prose despite response_format;
  // fall back to extracting the first {...} block if strict parse fails.
  try { return JSON.parse(text) }
  catch {
    const match = text.match(/\{[\s\S]*\}/)
    return match ? JSON.parse(match[0]) : {}
  }
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
