# Contributing to `clawket/web`

The Clawket dashboard — React 19 + Vite SPA served by the daemon at
`http://localhost:19400`. Six views: Summary, Plans, Board, Backlog,
Timeline, Wiki. All data flows through the daemon's HTTP surface; the web
bundle never talks directly to SQLite.

## Cross-repo workflow

The cross-repo contribution model (decompose → contract → execute, active-task
gate, PR / commit conventions, Conventional Commits bump policy, Code of Conduct)
is canonical in the meta repo:

- [`clawket/clawket` › `docs/CONTRIBUTING.md`](https://github.com/clawket/clawket/blob/main/docs/CONTRIBUTING.md) — workflow + repo layout + submission rules
- [`clawket/clawket` › `docs/RELEASING.md`](https://github.com/clawket/clawket/blob/main/docs/RELEASING.md) — release order across the seven repos
- [`clawket/clawket` › `CODE_OF_CONDUCT.md`](https://github.com/clawket/clawket/blob/main/CODE_OF_CONDUCT.md) — Contributor Covenant v2.1; reports go to **conduct@clawket.dev**

Do not duplicate those rules here — they live in one place to avoid drift.

## Local setup

```bash
git clone https://github.com/clawket/web
cd web
pnpm install
pnpm dev                       # http://localhost:5174 (Vite dev server)
```

You need a running `clawketd` for the dashboard to populate (`clawket daemon
start` from anywhere). Vite resolves the daemon URL in this order:
`CLAWKET_DAEMON_URL` → `$CLAWKET_CACHE_DIR/clawketd.port` →
`$XDG_CACHE_HOME/clawket/clawketd.port` → `~/.cache/clawket/clawketd.port` →
`127.0.0.1:19400` fallback (see `vite.config.ts:13-28`). Daemon HTTP routes
go through the Vite proxy; `/events` SSE is intentionally **not** proxied —
the client hits the daemon directly via `__CLAWKET_DAEMON_URL__` because
Vite's proxy buffers `text/event-stream` chunks and EventSource gets stuck in
`CONNECTING` (`vite.config.ts:30-43`).

## Scripts

```bash
pnpm dev                       # Vite dev server with HMR
pnpm test                      # vitest run (jsdom + RTL)
pnpm test:watch                # vitest watch
pnpm lint                      # eslint . (CI gate)
pnpm build                     # tsc -b && vite build (typecheck + bundle, CI gate)
pnpm preview                   # serve dist/ locally
```

`pnpm build` is the single typecheck + bundle gate (`tsc -b` runs first, then
`vite build`). CI (`.github/workflows/ci.yml`) runs `pnpm lint` + `pnpm build`
on every push/PR and uploads `dist/` as an artifact. Tests run locally but are
not enforced in CI today.

## Repo-specific PR rules

- Branch off `main`. The release workflow auto-bumps `package.json#version`
  via `release-it --ci` based on Conventional Commit subjects since the last
  tag — **do not edit `package.json#version` by hand**.
- New fetch endpoints must be registered in `vite.config.ts`'s proxy list
  (`/projects /plans /units /tasks /knowledge /runs /questions /health
  /dashboard /agents /cycles /backlog /labels /activity /relations /comments
  /handoff /wiki/files /wiki/file`). SSE / streaming endpoints stay off the
  proxy list — see `.claude/rules/vite-sse-proxy-bypass.md`.
- SSE event names (`task:created`, `knowledge:updated`, …) and the
  `entity_type` / `change_type` envelope are wire contracts with the daemon
  (`src/App.tsx:83-92,383-401`). Changes must ship in the **same release
  cycle** as the daemon-side emit change. See
  `.claude/rules/sse-event-synchronization.md`.
- All daemon calls must go through `src/api.ts`'s `request<T>()` wrapper —
  it carries `credentials: 'include'` (cookie channel) **and** `X-Clawket-Token`
  (header fallback) together. Raw `fetch()` that bypasses the wrapper breaks
  one channel silently. See `.claude/rules/cookie-auth-x-header-fallback.md`.
- Tailwind v4 is **CSS-first**: tokens live in `src/styles/tokens.css` and
  are exposed as Tailwind colors through `src/index.css`'s `@theme` block.
  Do not add `tailwind.config.js`, `@apply` directives, or arbitrary hex
  values (`bg-[#7c3aed]`) — only semantic classes (`bg-background`,
  `text-foreground`, `border-border`, …). See
  `.claude/rules/tailwind-v4-css-first.md`.
- The `BoardView` drag-and-drop lifecycle is fragile: `activeTask` lives at
  the nearest `DndContext` parent, `setActiveTask` is called only in
  `onDragStart`, cleared in both `onDragEnd` and `onDragCancel`, and the
  `DragOverlay` body stays stateless. See
  `.claude/rules/dnd-kit-overlay-state.md`.
- React 19's `use()` / `<Activity>` require a Suspense boundary + Error
  Boundary above the call site, and this repo is client-only SPA (no RSC).
  See `.claude/rules/react-19-activity-use-discipline.md`.
