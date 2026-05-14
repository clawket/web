import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// Resolution order:
//   1. CLAWKET_DAEMON_URL  (explicit override, wins outright)
//   2. $CLAWKET_CACHE_DIR/clawketd.port
//   3. $XDG_CACHE_HOME/clawket/clawketd.port
//   4. ~/.cache/clawket/clawketd.port
function getDaemonUrl() {
  if (process.env.CLAWKET_DAEMON_URL) return process.env.CLAWKET_DAEMON_URL

  const cacheDir =
    process.env.CLAWKET_CACHE_DIR ??
    (process.env.XDG_CACHE_HOME
      ? join(process.env.XDG_CACHE_HOME, 'clawket')
      : join(homedir(), '.cache', 'clawket'))

  try {
    const port = readFileSync(join(cacheDir, 'clawketd.port'), 'utf-8').trim()
    return `http://127.0.0.1:${port}`
  } catch {
    return 'http://127.0.0.1:19400'
  }
}

// SSE through the Vite dev proxy buffers the response (text/event-stream
// chunks are held until the upstream closes), leaving EventSource stuck in
// CONNECTING. In dev we bypass the proxy for `/events` only by exposing the
// daemon URL to the client and using it as an absolute origin. Daemon CORS
// allows the cross-origin request; loopback-only bind keeps the surface
// local.
//
// In production the daemon serves the web bundle itself, so the SPA is
// already same-origin with `/events`. Injecting an absolute URL there would
// turn EventSource into a cross-host request (the daemon advertises
// 127.0.0.1 while the browser tab is on `localhost`, and a session cookie
// scoped to one is not sent to the other) and break SSE entirely. Build mode
// therefore inlines an empty string so `daemonUrl('/events')` collapses to
// a relative path.
const DAEMON_URL = getDaemonUrl()

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  define: {
    __CLAWKET_DAEMON_URL__: JSON.stringify(
      command === 'serve' ? getDaemonUrl() : ''
    ),
  },
  server: {
    port: 5174,
    proxy: {
      '/projects': DAEMON_URL,
      '/plans': DAEMON_URL,
      '/units': DAEMON_URL,
      '/tasks': DAEMON_URL,
      '/knowledge': DAEMON_URL,
      '/runs': DAEMON_URL,
      '/questions': DAEMON_URL,
      '/health': DAEMON_URL,
      '/dashboard': DAEMON_URL,
      '/agents': DAEMON_URL,
      '/cycles': DAEMON_URL,
      '/backlog': DAEMON_URL,
      '/labels': DAEMON_URL,
      '/activity': DAEMON_URL,
      '/relations': DAEMON_URL,
      '/comments': DAEMON_URL,
      '/handoff': DAEMON_URL,
      '/wiki/files': DAEMON_URL,
      '/wiki/file': DAEMON_URL,
      // /events is intentionally NOT proxied — see __CLAWKET_DAEMON_URL__
      // above. EventSource hits the daemon directly; daemon CORS handles it.
    },
  },
}))
