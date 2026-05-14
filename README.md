# @clawket/web

> **Structured task contracts for LLM coding agents.**

Web dashboard for [Clawket](https://github.com/clawket/clawket). React 19 + Vite + Tailwind + dnd-kit SPA. Published as a **GitHub Release tarball** — consumers (the Clawket plugin's install gate) extract `dist/` and let the daemon serve it statically.

Six views: Summary, Plans, Board (Kanban DnD), Backlog (DnD cycle assignment), Timeline (agent swimlane + activity stream), Wiki (file-tree + FTS5 + semantic search).

[한국어](README.ko.md)

## Development

```sh
pnpm install
pnpm dev      # http://localhost:5174 — proxies daemon HTTP routes; SSE goes
              #                         direct to the daemon (see below)
```

Daemon URL resolution (Vite, in order):

1. `CLAWKET_DAEMON_URL` (explicit override, wins outright).
2. `$CLAWKET_CACHE_DIR/clawketd.port`.
3. `$XDG_CACHE_HOME/clawket/clawketd.port`.
4. `~/.cache/clawket/clawketd.port`.
5. Fallback `http://127.0.0.1:19400` if none of the above resolves.

**`/events` is intentionally not proxied in dev** — the Vite proxy buffers
SSE chunks until upstream close, which strands EventSource in `CONNECTING`.
The dev build injects `__CLAWKET_DAEMON_URL__` as an absolute origin so the
browser hits the daemon directly; daemon CORS allows the cross-origin
request. In production the daemon serves the bundle under `/`, so SSE is
same-origin and `__CLAWKET_DAEMON_URL__` is the empty string.

## Build

```sh
pnpm build    # writes dist/
```

## Consumed by

- **Clawket plugin install gate** (`adapters/shared/claude-hooks.cjs::ensureInstalled`) — downloads the GitHub Release tarball, extracts `dist/` under the plugin's `web/` directory, and the daemon serves it.
- **clawketd** — when started by a user with the plugin installed, serves the bundled `web/dist/` statically under `/` so http://localhost:19400 works without a separate dev server.

> Do not depend on `@clawket/web` from npm — the package is distributed only as a GitHub Release tarball.

## Contributing

> *Decompose, contract, execute — the structured agent loop.*

Every contribution to Clawket — including this dashboard — moves through three steps in order: **decompose** the work into a task tree, **sign each leaf with a contract** (the 19-field execution envelope), then **execute against the contract**. The `PreToolUse` hook in the plugin shell hard-blocks step 3 if steps 1–2 weren't done.

Full guide: [clawket/clawket → docs/CONTRIBUTING.md](https://github.com/clawket/clawket/blob/main/docs/CONTRIBUTING.md).

## License

MIT
