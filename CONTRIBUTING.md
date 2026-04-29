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
pnpm dev                       # http://localhost:5173, proxies /api to :19400
```

You need a running `clawketd` for the dashboard to populate (`clawket daemon
start` from anywhere). Static fixtures under `tests/fixtures/` cover the
no-daemon path.

## Run tests

```bash
pnpm test                      # vitest + @testing-library/react
pnpm lint                      # eslint --quiet
pnpm typecheck                 # tsc --noEmit
pnpm build                     # Vite production bundle (CI gate)
```

The CI workflow runs all four on every PR. The bundle is committed as a
release artifact and the daemon serves it in production — there is no
deploy step beyond `pnpm build`.

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

See [`ROADMAP.md`](./ROADMAP.md) for the cross-repo plan. Web-specific
view-by-view roadmap (Wiki, Timeline RAG search) lives in the v11 addendum
plan inside the Clawket workspace.
