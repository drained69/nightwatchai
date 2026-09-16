import React from 'react'
import { purgeAllSessions } from '../domain.js'

export class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) {
    console.error('NIGHTWATCH panic:', error, info)
    // Fire-and-forget to any error-tracking endpoint the operator wires up.
    fetch('/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: error?.message, stack: error?.stack, componentStack: info?.componentStack, url: location.href, at: new Date().toISOString() }),
    }).catch(() => { /* offline is fine */ })
  }
  reset = () => this.setState({ error: null })
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="panic">
        <div className="panic-card">
          <b>NIGHTWATCH hit an error.</b>
          <p>The app kept your session in localStorage. Reset the view to try again.</p>
          <pre>{String(this.state.error?.message || this.state.error)}</pre>
          <div className="panic-actions">
            <button className="btn primary" onClick={this.reset}>RESET VIEW</button>
            <button className="btn ghost" onClick={() => { try { purgeAllSessions() } catch { /* ignore */ }; location.reload() }}>WIPE SESSION</button>
          </div>
        </div>
      </div>
    )
  }
}
