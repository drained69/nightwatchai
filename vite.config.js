import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-mode API proxy: same-origin fetches from the SPA are forwarded to the
// adapter (npm run server, port 8787). Keep the prefix list in sync with
// API_PREFIXES in server/static-serve.mjs.
const API_PREFIXES = ['/health', '/metrics', '/bitget', '/prices', '/news', '/research', '/desk', '/auth', '/session', '/push', '/positioning', '/book', '/marketintel', '/macro', '/signals', '/history', '/backtest', '/share', '/alerts', '/trading', '/copilot', '/vapid', '/paper', '/playbooks', '/leaderboard', '/assayer']

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: Object.fromEntries(API_PREFIXES.map(p => [p, {
      target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8787',
      changeOrigin: true,
    }])),
  },
})
