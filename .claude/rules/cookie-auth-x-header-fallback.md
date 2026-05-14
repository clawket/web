# cookie-auth-x-header-fallback

## Purpose
브라우저 인증 경로의 invariant — 모든 데몬 호출이 (1) `credentials: 'include'` 로 HttpOnly 세션 쿠키를 함께 보내고, (2) `X-Clawket-Token` 헤더 fallback 을 동시에 시도하는 dual-channel 패턴을 유지한다. 한 쪽이 약화되면 dev cross-port 환경 또는 `CLAWKET_REQUIRE_TOKEN=1` 모드가 silent 하게 깨진다.

## Prevents
- `credentials: 'include'` 누락 → `clawket_session` 쿠키가 전송되지 않아 prod 빌드에서 401 / 빈 응답. SSE 도 cookie scope 불일치로 끊김.
- `authHeaders()` 호출 누락 → dev (Vite 5174 ↔ daemon 19400 cross-port) 에서 쿠키가 흐르지 않을 때 fallback 마저 사라져 dev DX 가 깨짐. `CLAWKET_REQUIRE_TOKEN=1` 의 헤더-required 모드도 동시에 망가짐.
- 새 fetch 헬퍼를 추가하면서 `src/api.ts` 의 `request()` 래퍼를 우회하고 raw `fetch()` 직접 호출 → 두 채널을 모두 잃음.
- `getStoredToken()` / `setStoredToken()` 외 다른 localStorage 키로 토큰을 저장 → token 입력 UI 와 fetch 가 어긋남.

## Evidence
- `src/api.ts:47-62` — `request<T>(path, init?)` 에서 `credentials: 'include'` 와 `...authHeaders()` 를 동시에 spread.
- `src/api.ts:50-56` — 두 채널 사유 주석: "쿠키가 bootstrap 채널, `authHeaders()` 는 Vite cross-port dev fallback".
- `src/lib/auth.ts:11` — `const KEY = 'clawket.auth.token';` (단일 storage key).
- `src/lib/auth.ts:31-34` — `authHeaders()` 가 token 없으면 빈 객체. 호출자가 unconditional 하게 spread 안전.
- `web/CLAUDE.md:56-57` — "HttpOnly 세션 쿠키 `clawket_session` — daemon SPA index 응답 시 발급. `fetch` 는 `credentials: 'include'`", "X-Clawket-Token — `CLAWKET_REQUIRE_TOKEN=1` + dev 크로스포트 환경".

## Why not global
글로벌 룰은 "이 repo 의 데몬이 두 채널을 모두 받는다" 는 사실, 그리고 dev cross-port 가 쿠키 흐름을 깬다는 web 특화 토폴로지를 알지 못한다. `clawket-context-management.md` 의 활성 태스크 게이트도 raw `fetch()` 호출 추가를 detect 하지 못한다.

## Enforcement gap
- ESLint 가 `fetch(` 직접 호출을 ban 하는 룰이 구성되어 있지 않다. 새 fetch 가 `src/api.ts:request()` 를 우회해도 통과.
- vitest 는 `CLAWKET_REQUIRE_TOKEN=1` 모드의 통합 테스트를 가지지 않아 헤더 fallback 회귀가 잡히지 않는다.
- TypeScript 는 `credentials: 'include'` 옵션의 누락을 type error 로 보지 않는다.

## Rule body

### DO
- 모든 데몬 호출은 `src/api.ts` 의 `request<T>()` 를 통해서 한다. 새 엔드포인트는 `api.ts` 안에 헬퍼 함수로 추가한다.
- 새 헬퍼가 streaming 응답을 받아야 하는 등의 이유로 `fetch()` 를 직접 써야 한다면, `credentials: 'include'` + `headers: { ...authHeaders(), ... }` 두 채널을 모두 명시한다.
- 토큰 저장/읽기는 항상 `src/lib/auth.ts` 의 `getStoredToken` / `setStoredToken` 만 통한다 — localStorage key `clawket.auth.token` 가 단일 storage point.
- 토큰 입력 UI 가 새로 생기면 `setStoredToken` 으로 저장하고, 다음 fetch 가 자동으로 헤더에 실린다.

### DON'T
- `credentials: 'include'` 를 제거하지 않는다 — prod 에서 401, SSE 끊김.
- `authHeaders()` 호출을 제거하지 않는다 — dev cross-port + token-required 모드 동시 파손.
- `src/api.ts:request()` 를 우회해 raw `fetch()` 로 데몬을 직접 호출하지 않는다.
- `localStorage.getItem('clawket.auth.token')` 같은 raw 접근을 새 모듈에서 추가하지 않는다 — `src/lib/auth.ts` 가 SSoT.
- 토큰을 sessionStorage / cookie / URL query 로 옮기지 않는다 — 현재 위치 (`localStorage`) 가 데몬·CLI 와 일치한다.
- 401 응답에 즉시 redirect / reload 로 우회하지 않는다 — 두 채널 어디서 깨졌는지 진단 정보를 잃는다. 먼저 `src/api.ts` 의 에러 처리 경로를 따른다.
