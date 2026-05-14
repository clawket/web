# vite-sse-proxy-bypass

## Purpose
SSE 채널(`/events`)이 Vite dev proxy 를 통해 흘러가지 않고, dev 에서는 `__CLAWKET_DAEMON_URL__` 절대 origin 으로, prod 에서는 same-origin 으로 EventSource 가 직접 연결되는 invariant 를 유지한다.

## Prevents
- `vite.config.ts` 의 `server.proxy` 에 `/events` 를 추가 → Vite 의 proxy 가 `text/event-stream` 응답을 버퍼링해서 EventSource 의 `readyState` 가 영원히 `CONNECTING` (0) 에 머무는 사고.
- production 빌드에서 `__CLAWKET_DAEMON_URL__` 에 절대 URL (e.g. `http://127.0.0.1:19400`) 을 inject → 브라우저 탭이 `localhost` 인데 daemon 이 `127.0.0.1` 을 광고하면 쿠키 scope 가 일치하지 않아 `clawket_session` 이 전송되지 않고 SSE 가 401 로 끊기는 사고.
- 새 fetch 경로를 추가하면서 `vite.config.ts:55-77` 의 proxy 목록에 등록하지 않아 dev 에서 CORS / 404 로 깨지는 사고 (반대 방향의 짝지은 실수).

## Evidence
- `vite.config.ts:30-43` — proxy 가 SSE chunk 를 버퍼링하는 동작과 dev/prod 의 `__CLAWKET_DAEMON_URL__` 분기 사유가 본문 주석으로 박혀 있다.
- `vite.config.ts:44-52` — `define: { __CLAWKET_DAEMON_URL__: JSON.stringify(command === 'serve' ? getDaemonUrl() : '') }`. **`command === 'serve'` 일 때만** 절대 URL.
- `vite.config.ts:55-77` — `/projects /plans /units /tasks /knowledge /runs /questions /health /dashboard /agents /cycles /backlog /labels /activity /relations /comments /handoff /wiki/files /wiki/file` proxy 등록.
- `vite.config.ts:75-76` — "/events is intentionally NOT proxied" 주석.
- `src/lib/daemonUrl.ts:8-18` — `DAEMON_ORIGIN` 이 dev 에서 daemon, prod 에서 빈 문자열. `daemonUrl('/events')` 가 prod 에서 `'/events'` 로 collapse.
- `src/App.tsx:367-371` — `const es = new EventSource(daemonUrl(path))`.
- `web/CLAUDE.md:89-90` — "/events 를 Vite proxy 에 추가하지 않는다", "production 빌드 모드에서 절대 URL 을 주입하면 cookie scope 불일치로 SSE 가 깨진다".

## Why not global
글로벌 룰은 Vite 의 proxy 가 SSE 청크를 버퍼링한다는 사실, 그리고 daemon 이 `127.0.0.1` 로 bind 하지만 브라우저 탭은 `localhost` 일 수 있다는 sub-repo 특화 토폴로지를 알지 못한다. `clawket-context-management.md` 의 활성 태스크 게이트도 이 invariant 를 detect 하지 못한다.

## Enforcement gap
- `vite.config.ts` 의 proxy 객체는 일반 JS 객체라, 누가 `'/events': DAEMON_URL` 한 줄을 추가해도 lint/type-check 가 통과한다.
- production 번들에서 `__CLAWKET_DAEMON_URL__ === ''` 를 단언하는 assertion 이 없다.
- EventSource 가 `CONNECTING` 에 stuck 되어도 fetch 는 정상 동작하므로 e2e smoke test 가 SSE 깨짐을 즉시 노출하지 않는다.

## Rule body

### DO
- HTTP 엔드포인트를 새로 추가하면 `vite.config.ts:55-77` 의 proxy 목록에 등록한다 — `web/CLAUDE.md:91` 지침.
- SSE 또는 streaming 응답을 다루는 새 엔드포인트는 `daemonUrl()` 을 통해 직접 origin 호출하고 proxy 우회로 둔다.
- `daemonUrl()` 으로만 SSE/streaming URL 을 구성한다 — 직접 `http://127.0.0.1:…` 를 박지 않는다.
- production 빌드 후 `dist/assets/*.js` 에 `__CLAWKET_DAEMON_URL__` 이 빈 문자열로 inline 되었는지 의심되면 `grep '127.0.0.1' dist/assets/*.js` 로 spot check.

### DON'T
- `vite.config.ts` 의 proxy 객체에 `'/events'` 를 추가하지 않는다 — EventSource 가 즉시 stuck.
- `defineConfig` 의 `define` 블록에서 `command === 'serve'` 분기를 제거하거나 production 에 절대 URL 을 주입하지 않는다.
- `src/lib/daemonUrl.ts` 의 `daemonUrl()` 을 우회해 EventSource 에 다른 origin string 을 박지 않는다 — 쿠키 scope 분기가 한 곳에 집중되어야 한다.
- "robustness" 명목으로 dev 에서 `/events` 도 proxy 로 통일하지 않는다 — proxy 가 chunk 를 버퍼링하는 본질적 제약이다.
