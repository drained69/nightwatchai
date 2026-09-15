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
          <b>NIGHTWATCH AI is a research tool — not a broker, exchange or investment advisor.</b> Analysis is informational only and does not constitute a solicitation, recommendation, or offer to buy or sell any asset. Market data is provided by Bitget and third-party sources and may be delayed, incomplete or incorrect. Paper trading by default; live order routing is disabled unless explicitly enabled by the account holder. Past performance does not guarantee future results. <em>Not investment, legal or tax advice.</em>
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
              <li><b>Not investment advice.</b> AI-generated research is informational only and does not account for your financial situation, tax status, jurisdiction or risk tolerance. Consult a licensed advisor before making investment decisions.</li>
              <li><b>Paper trading by default.</b> Live order routing is disabled unless the account holder explicitly enables it and provisions a real broker connection. Each order still requires manual approval.</li>
              <li><b>Data may be delayed or incorrect.</b> Market data is sourced from Bitget and third-party APIs. News is aggregated from public RSS feeds and automatically classified. Any field may be stale, dropped or misclassified without warning.</li>
              <li><b>Regional availability.</b> Products, features and asset listings vary by jurisdiction and are subject to Bitget's geographical restrictions. Verify local eligibility and applicable law before trading.</li>
              <li><b>You are responsible for your trades.</b> NIGHTWATCH will never open, close, or modify a position without your explicit approval.</li>
            </ul>
            <button className="btn primary" onClick={() => setAck(true)}>I understand — continue</button>
          </div>
        </div>
      )}
    </>
  )
}
