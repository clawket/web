# @clawket/web

Web dashboard for [Clawket](https://github.com/clawket/clawket). React + Vite SPA. Published as a **build artifact** — consumers (the daemon) serve `dist/` statically.

## Development

```sh
pnpm install
pnpm dev      # http://localhost:5174, proxies to running clawket daemon
```

The dev server auto-discovers the daemon port from `~/.cache/clawket/clawketd.port`.

## Build

```sh
pnpm build    # writes dist/
```

## Consumed by

- `@clawket/daemon` — bundles `dist/` under its `web/` directory at runtime (prebuilt) or install-time (from published npm artifact).

## License

MIT
