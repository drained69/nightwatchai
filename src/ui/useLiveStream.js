import { useEffect, useRef, useState } from 'react'
import { apiBase, hasApi } from './apiBase.js'

/**
 * Subscribe to an SSE endpoint on the NIGHTWATCH adapter. Yields the
 * most-recent event of each `type`. Uses same-origin by default; override with
 * VITE_AGENT_API_URL at build time to point at a different host.
 */
export function useLiveStream(streamPath, eventTypes = ['message']) {
  const endpoint = hasApi() ? apiBase() : null
  const [events, setEvents] = useState({})
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)
  const esRef = useRef(null)

  useEffect(() => {
    if (endpoint == null) return
    let alive = true
    const url = `${endpoint}${streamPath}`
    const es = new EventSource(url)
    esRef.current = es
    es.addEventListener('open', () => alive && setConnected(true))
    es.addEventListener('error', (e) => alive && (setConnected(false), setError('stream error')))
    for (const type of eventTypes) {
      es.addEventListener(type, (e) => {
        if (!alive) return
        try {
          const data = JSON.parse(e.data)
          setEvents(prev => ({ ...prev, [type]: { data, at: Date.now() } }))
        } catch { /* skip malformed */ }
      })
    }
    return () => { alive = false; es.close() }
  }, [endpoint, streamPath, eventTypes.join(',')])

  return { connected, events, error, endpoint }
}
