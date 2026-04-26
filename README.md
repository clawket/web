# @clawket/web

Web dashboard for [Clawket](https://github.com/clawket/clawket). React 19 + Vite + Tailwind + dnd-kit SPA. Published as a **GitHub Release tarball** — consumers (the Clawket plugin's install gate) extract `dist/` and let the daemon serve it statically.

Six views: Summary, Plans, Board (Kanban DnD), Backlog (DnD cycle assignment), Timeline (agent swimlane + activity stream), Wiki (file-tree + FTS5 + semantic search).

## Development

```sh
pnpm install
pnpm dev      # http://localhost:5174, proxies to running clawket daemon
```

The dev server auto-discovers the daemon port from `$XDG_CACHE_HOME/clawket/clawketd.port` (default `~/.cache/clawket/clawketd.port`); override with `CLAWKET_CACHE_DIR`.

## Build

```sh
pnpm build    # writes dist/
```

## Consumed by

- **Clawket plugin install gate** (`adapters/shared/claude-hooks.cjs::ensureInstalled`) — downloads the GitHub Release tarball, extracts `dist/` under the plugin's `web/` directory, and the daemon serves it.
- **clawketd** — when started by a user with the plugin installed, serves the bundled `web/dist/` statically under `/` so http://localhost:19400 works without a separate dev server.

> npm publishing was retired (commit "stop publishing to npm; distribute via GitHub Release tarball only"). Do not depend on `@clawket/web` from npm.

## License

MIT
