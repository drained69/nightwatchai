/**
 * Resolve the NIGHTWATCH AI adapter base URL.
 *
 *   1. If VITE_AGENT_API_URL is set at build time, use it. (Dev typically points
 *      the vite dev server on :5173 at the adapter on :8787.)
 *   2. Otherwise, when running in the browser, use same-origin ('' means fetch
 *      hits the current host). This is what the Docker container does: SPA and
 *      API on the same port via server/static-serve.mjs.
 *   3. In Node (SSR / tests) return null.
 */
export function apiBase() {
  const configured = typeof import.meta !== 'undefined' && import.meta.env?.VITE_AGENT_API_URL
  if (configured) return configured.replace(/\/$/, '')
  if (typeof window !== 'undefined' && window.location) return ''  // same-origin
  return null
}

/** True when we have any adapter to talk to. */
export function hasApi() { return apiBase() !== null }

/** Prefix a path with the resolved base. */
export function apiUrl(path) {
  const b = apiBase()
  if (b == null) throw new Error('no adapter available in this environment')
  return `${b}${path}`
}
