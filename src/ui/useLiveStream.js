import { useEffect, useRef, useState } from 'react'
import { apiBase, hasApi } from './apiBase.js'

/**
 * Subscribe to an SSE endpoint on the NIGHTWATCH adapter.
 *
 * `events` holds the most-recent payload of each `type` (fine for coalescing
 * streams like prices). For streams where every message matters (news), pass
 * an `onEvent(type, data)` callback — it is invoked synchronously for every
 * SSE message, so bursts are never collapsed by React state batching.
 *
 * Uses same-origin by default; override with VITE_AGENT_API_URL at build time
 * to point at a different host.
 */
export function useLiveStream(streamPath, eventTypes = ['message'], onEvent) {
  const endpoint = hasApi() ? apiBase() : null
  const [events, setEvents] = useState({})
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)
  const onEventRef = useRef(onEvent)
  useEffect(() => { onEventRef.current = onEvent })

  useEffect(() => {
    if (endpoint == null) return
    let alive = true
    const url = `${endpoint}${streamPath}`
    const es = new EventSource(url)
    es.addEventListener('open', () => { if (!alive) return; setConnected(true); setError(null) })
    es.addEventListener('error', () => { if (alive) setConnected(false) })
    for (const type of eventTypes) {
      es.addEventListener(type, (e) => {
        if (!alive) return
        try {
          const data = JSON.parse(e.data)
          setEvents(prev => ({ ...prev, [type]: { data, at: Date.now() } }))
          onEventRef.current?.(type, data)
        } catch { /* skip malformed */ }
      })
    }
    return () => { alive = false; es.close() }
  }, [endpoint, streamPath, eventTypes.join(',')])

  return { connected, events, error, endpoint }
}
