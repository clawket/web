# Contributing to `clawket/web`

The Clawket dashboard — React 19 + Vite SPA served by the daemon at
`http://localhost:19400`. Six views: Summary, Plans, Board, Backlog,
Timeline, Wiki. All data flows through the daemon's HTTP surface; the web
bundle never talks directly to SQLite.

## Local setup

```bash
git clone https://github.com/clawket/web
cd web
pnpm install
pnpm dev                       # http://localhost:5174 (Vite). Daemon HTTP
                               # routes go through the Vite proxy. `/events`
                               # SSE is intentionally NOT proxied — the
                               # client hits the daemon directly via
                               # __CLAWKET_DAEMON_URL__ (see vite.config.ts
                               # line ~30 for the rationale).
```

You need a running `clawketd` for the dashboard to populate (`clawket daemon
start` from anywhere). Vite resolves the daemon URL in this order:
`CLAWKET_DAEMON_URL` → `$CLAWKET_CACHE_DIR/clawketd.port` →
`$XDG_CACHE_HOME/clawket/clawketd.port` → `~/.cache/clawket/clawketd.port`.

## Scripts

```bash
pnpm dev                       # Vite dev server (HMR)
pnpm test                      # vitest run
pnpm test:watch                # vitest watch
pnpm lint                      # eslint .
pnpm build                     # tsc -b && vite build  (typecheck + bundle)
pnpm preview                   # serve dist/ locally
```

`pnpm build` is the single typecheck + bundle gate (it invokes `tsc -b`
first, then `vite build`). CI (`.github/workflows/ci.yml`) runs `pnpm lint`
+ `pnpm build` on every push/PR and uploads `dist/` as an artifact. Test +
preview scripts exist for local use but are not enforced in CI today.

## Pull requests

- Branch off `main`. Conventional Commits.
- Snapshot the rendered view in screenshots when touching a Six-view layout.
- Component changes that affect the API contract belong in
  [`clawket/daemon`](https://github.com/clawket/daemon) first; the web PR
  follows once the daemon route ships.
- Tailwind classes belong in component files. Do not extend `tailwind.config.js`
  with project-specific colors — use CSS variables instead.

## Commit convention

Conventional Commits. The release workflow bundles the SPA + uploads it as a
GitHub Release artifact, which the plugin's install gate downloads.

## Roadmap

See the cross-repo
[`ROADMAP.md`](https://github.com/clawket/clawket/blob/main/ROADMAP.md)
in the meta repo for the cross-repo plan.

## Code of Conduct

By participating you agree to abide by the
[Contributor Covenant v2.1](https://github.com/clawket/clawket/blob/main/CODE_OF_CONDUCT.md).
Reports go to **conduct@clawket.dev**; see the meta repo's
`CODE_OF_CONDUCT.md` for the full enforcement policy.
