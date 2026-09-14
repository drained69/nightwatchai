import React, { useEffect, useState } from 'react'
import { ShieldCheck, X } from 'lucide-react'

const KEY = 'nightwatch.disclaimer.acknowledged.v1'

export function Disclaimer() {
  const [ack, setAck] = useState(() => {
    try { return localStorage.getItem(KEY) === '1' } catch { return true }
  })
  useEffect(() => { if (ack) try { localStorage.setItem(KEY, '1') } catch { /* ignore */ } }, [ack])
  return (
    <>
      <div className="disclaimer-footer">
        <ShieldCheck size={11} />
        <span>
          <b>Every rule, none of the promises.</b> NIGHTWATCH AI is a research workstation, not a broker. Signals are informational; the trader owns every decision. Paper mode only unless you explicitly wire a live account. <em>Not investment advice.</em>
        </span>
      </div>
      {!ack && (
        <div className="disclaimer-modal" role="dialog" aria-modal="true">
          <div className="disclaimer-card">
            <div className="dc-head">
              <b>Before you use NIGHTWATCH AI</b>
              <button className="icon-btn" onClick={() => setAck(true)} aria-label="Close"><X size={16} /></button>
            </div>
            <ul>
              <li><b>Not investment advice.</b> AI-generated research is informational. It does not account for your personal situation, tax status, or risk tolerance.</li>
              <li><b>Paper trading only by default.</b> No live orders are routed unless you provision a real broker adapter and explicitly approve each trade.</li>
              <li><b>Data may be delayed or wrong.</b> Live prices come from public Bitget endpoints. News comes from public RSS. Both can be stale, dropped, or incorrectly classified.</li>
              <li><b>Jurisdiction.</b> Not all products/features are available in every jurisdiction. Bitget's geographical restrictions apply. Consult local law before trading.</li>
              <li><b>You are responsible for your trades.</b> Approve, reject, or sit out — NIGHTWATCH will not act without you.</li>
            </ul>
            <button className="btn primary" onClick={() => setAck(true)}>I UNDERSTAND · CONTINUE</button>
          </div>
        </div>
      )}
    </>
  )
}
