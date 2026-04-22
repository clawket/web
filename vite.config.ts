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
    return 'http://127.0.0.1:3456'
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: {
      '/projects': getDaemonUrl(),
      '/plans': getDaemonUrl(),
      '/units': getDaemonUrl(),
      '/tasks': getDaemonUrl(),
      '/artifacts': getDaemonUrl(),
      '/runs': getDaemonUrl(),
      '/questions': getDaemonUrl(),
      '/health': getDaemonUrl(),
      '/dashboard': getDaemonUrl(),
      '/agents': getDaemonUrl(),
      '/cycles': getDaemonUrl(),
      '/backlog': getDaemonUrl(),
      '/labels': getDaemonUrl(),
      '/activity': getDaemonUrl(),
      '/relations': getDaemonUrl(),
      '/comments': getDaemonUrl(),
      '/handoff': getDaemonUrl(),
      '/wiki/files': getDaemonUrl(),
      '/wiki/file': getDaemonUrl(),
      '/events': getDaemonUrl(),
    },
  },
})
