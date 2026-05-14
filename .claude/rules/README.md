# @clawket/web — `.claude/rules/`

본 sub-repo 특화 AI 가드레일. 각 룰은 글로벌 룰 (`~/.claude/rules/*.md`) 로 잡지 못하는 web 고유의 invariant 를 evidence (file:line) 와 함께 박는다.

룰 추가 기준: (a) 방지하는 구체적 failure scenario, (b) 글로벌 룰로 못 잡는 이유, (c) 코드/CI 가 이미 강제하지 않는 enforcement gap. 셋 모두 충족하지 못하면 sub-repo 룰이 아니라 글로벌 룰 후보거나 코드/CI 강제 후보다.

## 현재 룰

| 파일 | 다루는 invariant |
|---|---|
| `sse-event-synchronization.md` | SSE 이벤트 이름·envelope 가 데몬 emitter 와 1:1 동기화. daemon 측 wire-contract 룰의 consumer 쪽 짝. |
| `tailwind-v4-css-first.md` | Tailwind v4 CSS-first 환경 보존 — `tailwind.config.js` / `@apply` / JSX hex 금지, `tokens.css` 가 single source. |
| `dnd-kit-overlay-state.md` | `DragOverlay` 내 setState / drag 중 state cleanup 비대칭 방지. `activeTask` lifecycle 강제. |
| `vite-sse-proxy-bypass.md` | `/events` 가 Vite proxy 우회. dev/prod 에서 `__CLAWKET_DAEMON_URL__` 분기 보존. |
| `cookie-auth-x-header-fallback.md` | `credentials: 'include'` + `X-Clawket-Token` 두 채널 동시 유지. `src/api.ts:request()` 우회 금지. |
| `react-19-activity-use-discipline.md` | `use()` 는 Suspense + Error Boundary 동반, `<Activity>` 는 라우트 단위로만. RSC 아님. |

## Cross-repo wire

`sse-event-synchronization.md` 는 daemon repo 의 `sse-event-wire-contract.md` 와 한 wire 의 양 끝이다. 동일 패턴이 ≥3 sub-repo 로 확장되면 글로벌 cross-repo wire-contract 룰로 promotion 후보 (Phase 1 inventory `종합 priority ranking`).

## 위 / 아래 정본

- 상위 정본: `web/CLAUDE.md` (스택·계약·디자인 시스템·AI 가드레일 요약).
- 글로벌: `~/.claude/rules/{product-quality-first,mechanical-overrides,clawket-context-management}.md`.
- 본 디렉토리는 둘 사이의 sub-repo 특화 layer.
