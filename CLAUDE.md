# @clawket/web — AI 컨텍스트

Clawket 데몬(`clawketd`)의 React 19 + Vite SPA 대시보드. **6 개 뷰** — Summary / Plans / Board / Backlog / Timeline / Wiki (`src/App.tsx:27`, `src/App.tsx:40`). 빌드 산출물(`dist/`)은 GitHub Release tarball 로 배포되어 데몬이 `/` 에서 정적 서빙한다 (`README.md:5`, `:43`).

본 sub-repo 는 독립 git repo 다. wrapper / 다른 sub-repo 없이 단독 clone 환경에서도 본 파일이 컨텍스트의 1차 소스다.

## 스택 (pinned)

| Layer | Version | Notes |
|---|---|---|
| React | `^19.2.4` | `react-dom` 동일 |
| Vite | `^8.0.4` | `@vitejs/plugin-react` `^6.0.1` |
| TypeScript | `~6.0.2` | `tsc -b` (project references: `tsconfig.app.json` + `tsconfig.node.json`) |
| Tailwind | `^4.2.2` | **CSS-first** via `@tailwindcss/vite` 플러그인. 설정/토큰은 `src/index.css` + `src/styles/tokens.css` |
| Router | `react-router` `^7.14.0` | URL: `/{projectId}/{view}/{type?}/{id?}` (`src/App.tsx:38`) |
| DnD | `@dnd-kit/core` `^6.3.1`, `sortable` `^10.0.0`, `utilities` `^3.2.2` | Board / Backlog 에서 사용 |
| Markdown | `react-markdown` `^10`, `remark-gfm` `^4`, `@tailwindcss/typography` `^0.5`, `@wireweave/markdown-plugin` `^1.2` | Wiki 뷰 |
| ESLint | `^9.39.4` flat config (`eslint.config.js`) | `js.recommended + typescript-eslint + react-hooks + react-refresh/vite` |
| Test | `vitest` `^3.2.4` + `@testing-library/react` `^16.3` + `jsdom` | `pnpm test` / `test:watch` |
| Node | `>=20` (CI 는 22) | pnpm 10.11 (`.github/workflows/ci.yml:16`) |

## 소스 레이아웃

```
src/
├── App.tsx              # 라우터 + SSE reducer + drawer + 6 view 스위치
├── main.tsx             # entry
├── api.ts               # fetch 래퍼 (credentials: 'include')
├── types.ts             # Project/Plan/Unit/Task/Cycle/Artifact/TimelineEvent 등
├── index.css            # Tailwind v4 @import + @theme 매핑
├── styles/
│   ├── tokens.css       # 시맨틱 토큰 (단일 진실)
│   └── themes/{dark,light}.css
├── lib/
│   ├── daemonUrl.ts     # __CLAWKET_DAEMON_URL__ 래퍼
│   ├── auth.ts          # X-Clawket-Token (헤더 fallback)
│   ├── theme.ts         # dark/light 토글
│   └── toast.ts
├── hooks/               # useDaemonHealth, useGlobalShortcuts, useRunEvents, useInlineEdit
├── components/          # 6 view + Header/Sidebar/TaskDetail/* + ui/ + board/ + task-detail/
└── features/            # decomposition/, runs/, timeline/
```

## 핵심 계약 (file:line 근거)

| 항목 | 사양 | 위치 |
|---|---|---|
| Dev 포트 | `5174` | `vite.config.ts:54` |
| 데몬 fallback 포트 | `19400` (port 파일 없을 때) | `vite.config.ts:26` |
| 데몬 URL 결정 우선순위 | `CLAWKET_DAEMON_URL` → `$CLAWKET_CACHE_DIR/clawketd.port` → `$XDG_CACHE_HOME/clawket/clawketd.port` → `~/.cache/clawket/clawketd.port` → `127.0.0.1:19400` | `vite.config.ts:13-28` |
| Vite proxy 대상 | `/projects /plans /units /tasks /knowledge /runs /questions /health /dashboard /agents /cycles /backlog /labels /activity /relations /comments /handoff /wiki/files /wiki/file` | `vite.config.ts:55-77` |
| SSE 엔드포인트 | `/events` — **proxy 우회**. dev 는 `__CLAWKET_DAEMON_URL__` 절대 origin, prod 는 same-origin (`''`) | `vite.config.ts:44-52`, `src/lib/daemonUrl.ts`, `src/App.tsx:367-371` |
| SSE 이벤트 이름 | `{task,unit,plan,cycle,knowledge}:{created,updated,deleted}` + `task:{started,done,cancelled}` + `comment:{created,deleted}` + `ping` (30s keepalive) | `src/App.tsx:383-401` |
| SSE 페이로드 envelope | `{entity_type, change_type, event_id, ts, fields[], …}` — `entity_type` 으로 분기 | `src/App.tsx:83-92`, `:290-348` |
| `Last-Event-ID` 복구 | `localStorage['clawket.sse.lastEventId']` + `?last_event_id=` 쿼리 | `src/App.tsx:159-173`, `:366-367` |
| 인증 (브라우저) | HttpOnly 세션 쿠키 `clawket_session` — daemon SPA index 응답 시 발급. `fetch` 는 `credentials: 'include'` | `src/api.ts:50-57` |
| 인증 (헤더 fallback) | `X-Clawket-Token` — `CLAWKET_REQUIRE_TOKEN=1` + dev 크로스포트 환경. `localStorage['clawket.auth.token']` | `src/lib/auth.ts` |
| URL 구조 | `/{PROJ-…}/{summary\|plans\|board\|backlog\|timeline\|wiki}[/{plan\|unit\|task}/{id}]` | `src/App.tsx:33-62` |
| Build (CI gate) | `pnpm build` = `tsc -b && vite build` | `package.json:9`, `.github/workflows/ci.yml:22-23` |

## 디자인 시스템

Tailwind v4 **CSS-first**. `src/index.css` 가 `@import "tailwindcss"` + `@theme { … }` 블록으로 시맨틱 토큰을 Tailwind 컬러로 노출하고, 실제 값은 `src/styles/tokens.css` + `themes/{dark,light}.css` 에서 정의된다. dark/light 두 테마 보유 (`src/lib/theme.ts` 가 토글). 컴포넌트 클래스에는 `bg-background / text-foreground / text-muted / border-border / bg-surface / bg-surface-high / bg-primary` 등 시맨틱 이름만 쓰고, hex 색을 인라인으로 박지 않는다.

## 개발 워크플로

| 명령 | 동작 |
|---|---|
| `pnpm install` | 의존성 설치 |
| `pnpm dev` | dev 서버 `http://localhost:5174`. HTTP 는 Vite proxy, SSE 는 데몬에 직접 |
| `pnpm build` | `tsc -b && vite build` → `dist/`. **CI gate — 보고 전 통과 필수** |
| `pnpm lint` | `eslint .` (CI 에서도 실행) |
| `pnpm test` / `test:watch` | vitest (`jsdom` + RTL) |
| `pnpm preview` | `dist/` 정적 미리보기 |
| `CLAWKET_DAEMON_URL=http://127.0.0.1:PORT pnpm dev` | 비표준 포트의 데몬을 가리키게 |

Prod URL: 데몬이 가동 중일 때 `http://localhost:19400/` — 같은 origin 에서 SPA + `/events` 둘 다 서빙. 데몬은 별도 sub-repo (`clawket/daemon`) 에서 빌드된 바이너리.

## Cross-repo 좌표

릴리즈 order, 컴포넌트 핀 버전(`components.json`), 데몬 HTTP/SSE 계약, i18n 정책은 **wrapper repo (`github.com/clawket/clawket`)** 가 정본이다 — `CLAUDE.md` + `docs/RELEASING.md` + `docs/COMPATIBILITY.md` + `docs/i18n-policy.md`. 본 파일에 복제하지 않는다. 호환성 매트릭스를 깨는 변경은 plugin major bump 트리거.

## AI 가드레일

- 명시 지시 없이 commit / push 하지 않는다. wrapper `CLAUDE.md` 의 커밋 규칙을 그대로 따른다.
- 작업 완료 보고 전 **반드시 `pnpm build` 통과** 확인 — `tsc -b` 가 동봉되어 있어 타입 에러를 잡아낸다. `pnpm lint` 도 통과해야 CI green.
- SSE 이벤트 이름(`*:created|updated|deleted` 등)을 **단독으로 추가/변경 금지**. 데몬(`clawket/daemon`) 측 emitter 와 동시 갱신 필요 — cross-repo 변경이므로 wrapper 의 contract 표를 먼저 업데이트.
- Dev 포트 `5174`, 데몬 fallback `19400` 은 contract 다. 변경하려면 wrapper / 데몬 / 플러그인 install gate 와 동기 변경 필요.
- `/events` 를 Vite proxy 에 추가하지 않는다 — proxy 가 SSE 청크를 버퍼링해서 EventSource 가 `CONNECTING` 에서 멈춘다 (`vite.config.ts:30-43` 의 주석 참조).
- `__CLAWKET_DAEMON_URL__` 은 dev 에서만 절대 origin, prod 는 빈 문자열. 빌드 모드에서 절대 URL 을 주입하면 cookie scope 불일치로 SSE 가 깨진다 (`vite.config.ts:36-43`).
- 새 fetch 경로를 추가하면 `vite.config.ts` 의 proxy 목록에도 함께 등록한다.
- 색상은 `tokens.css` + `@theme` 매핑된 시맨틱 클래스로만. raw hex / 임의 Tailwind palette 직접 사용 금지.
