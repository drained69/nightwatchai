import { useEffect, useState } from 'react'
import { apiBase, hasApi, apiUrl } from './apiBase.js'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function getSwReg() {
  if (!('serviceWorker' in navigator)) return null
  return await navigator.serviceWorker.getRegistration() || await navigator.serviceWorker.register('./sw.js')
}

export function usePush({ token }) {
  const [supported, setSupported] = useState(false)
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'default')
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'PushManager' in window && 'serviceWorker' in navigator)
    ;(async () => {
      const reg = await getSwReg()
      const sub = await reg?.pushManager.getSubscription()
      setSubscribed(Boolean(sub))
    })().catch(() => {})
  }, [])

  async function subscribe() {
    if (!hasApi()) throw new Error('no adapter endpoint configured')
    if (!token) throw new Error('sign in first')
    setBusy(true); setError(null)
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') throw new Error(`permission ${perm}`)
      const reg = await getSwReg()
      const keyRes = await fetch(apiUrl("/vapid/public-key"))
      const { publicKey } = await keyRes.json()
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      const res = await fetch(apiUrl("/push/subscribe"), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(sub.toJSON()),
      })
      if (!res.ok) throw new Error(`subscribe failed ${res.status}`)
      setSubscribed(true)
    } catch (err) {
      setError(err.message)
      throw err
    } finally { setBusy(false) }
  }

  async function testPush() {
    if (!token) return
    const res = await fetch(apiUrl("/push/test"), { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    return res.json()
  }

  return { supported, permission, subscribed, busy, error, subscribe, testPush }
}
