# Web → Tauri UI/UX Migration — Gap Analysis (Snapshot)

본 문서는 `PLAN-01KRKMZKYZWXZX4SN121VVFAJ9` U0-T3 의 산출물이며, 마이그레이션 시작 시점의 **단일 시점 스냅샷**이다. 진행 중 발견되는 추가 gap 은 본 문서를 **덮어쓰기**로 갱신한다 (snapshot-only 룰). 변경 이력은 git history 와 plan/task evidence 가 보존한다.

정본 출처 좌표:
- desktop (UI/UX 정본): `clawket/desktop/apps/desktop/src/` + `clawket/desktop/packages/ui/src/`
- web (마이그레이션 대상): `clawket/web/src/`

## 1. App shell

| 항목 | desktop (정본) | web (현행) | gap |
|---|---|---|---|
| Provider 합성 | `apps/desktop/src/App.tsx:145-157` — Root → DataProvider → SelectionProvider → AppInner | `web/src/App.tsx:517-709` — 단일 컴포넌트 본문 안에 모든 useState/Reducer 가 평탄 | provider 추출 필요 |
| Shell composition | `packages/ui/src/components/AppShell/AppShell.tsx:22-97` — compound (Root/Sidebar/Content/Topbar/Main), `flex h-screen w-screen`, Sidebar `w-72` | `web/src/App.tsx:517-709` — Header + Sidebar + main + DetailDrawer + Modals + Toast + Help + CommandPalette 가 평탄 JSX | compound 패턴 수동 재구현 |
| AppInner composition | `apps/desktop/src/App.tsx:105-134` — `AppShell.Root > AppShell.Sidebar (Sidebar) + AppShell.Content (Topbar + Main + ViewShell) + DetailDrawer + CommandSurface` | 평탄 | 동일 구조로 재배열 |
| 메인 selection 컨텍스트 | `apps/desktop/src/shell/selection.tsx` (`SelectionProvider`) | 명시 컨텍스트 없음 — `selected` state 가 App.tsx 안 | 별도 컨텍스트 필요 |

## 2. View 표면 (5 view vs 6 view)

desktop 의 5 view 와 web 의 6 view 를 매핑한다. **결정**: Plans top-level view 폐지 (PlanTree 를 Sidebar 로 fold-in, decision knowledge `ART-01KRKN45MR0Y11VWAYGABESVCD`).

| view | desktop (정본) | web (현행) | 정합 방향 |
|---|---|---|---|
| Summary | `apps/desktop/src/views/SummaryView.tsx` | `web/src/components/SummaryView.tsx` | KPI cards + bucket (now/next/done/empty) 패턴 정합 |
| Board | `apps/desktop/src/views/BoardView.tsx` | `web/src/components/BoardView.tsx` (+ `web/src/components/board/`) | dnd-kit overlay state 규율 (`.claude/rules/dnd-kit-overlay-state.md`) 보존 + 시각 디자인 정합 |
| Backlog | `apps/desktop/src/views/BacklogView.tsx` | `web/src/components/BacklogView.tsx` | cycle lane + dnd 보존 + 시각 디자인 정합 |
| Timeline | `apps/desktop/src/views/TimelineView.tsx` | `web/src/components/TimelineView.tsx` | swimlane + activity stream 정합. web 의 `features/timeline/TimelineReplay` 는 보존 |
| Wiki | `apps/desktop/src/views/WikiView.tsx` | `web/src/components/WikiView.tsx` | markdown reader 정합 |
| Plans (top-level) | **없음** | `web/src/components/PlanTree.tsx` 가 view 로 노출 | **폐지** — PlanTree 를 Sidebar 컴포넌트로 fold-in |
| ViewShell 래퍼 | `apps/desktop/src/views/ViewShell.tsx` | 없음 | 신규 도입 |

## 3. Modal 표면 (3 vs 19+)

desktop 은 19+ 개의 modal/panel 을 보유, web 은 3 개 + inline-edit. **결정**: 누락된 modal 을 모두 도입 (decision knowledge `ART-01KRKN45MR0Y11VWAYGABESVCD`).

| modal/panel | desktop (정본) | web (현행) | 작업 |
|---|---|---|---|
| Plan create | `apps/desktop/src/shell/PlanCreateModal.tsx` | `web/src/components/CreatePlanModal.tsx` | 시각 정합 |
| Plan edit | `apps/desktop/src/shell/PlanEditModal.tsx` | **없음** (inline edit) | 신규 작성 |
| Unit create | `apps/desktop/src/shell/UnitCreateModal.tsx` | `web/src/components/CreateUnitModal.tsx` | 시각 정합 |
| Unit edit | `apps/desktop/src/shell/UnitEditModal.tsx` | **없음** (inline edit) | 신규 작성 |
| Cycle create | `apps/desktop/src/shell/CycleCreateModal.tsx` | **없음** | 신규 작성 |
| Cycle edit | `apps/desktop/src/shell/CycleEditModal.tsx` | **없음** | 신규 작성 |
| Task create | (없음 — desktop 은 SubtaskCreateModal 만) | `web/src/components/CreateTaskModal.tsx` | web 패턴 유지 (top-level task create) + desktop 의 Subtask 패턴 추가 |
| Task edit | `apps/desktop/src/shell/TaskEditModal.tsx` | **없음** (inline edit) | 신규 작성 |
| Task status | `apps/desktop/src/shell/TaskStatusModal.tsx` | **없음** (인라인 상태 변경) | 신규 작성 (특히 `done` 전환의 `--evidence` 필수 UX) |
| Subtask create | `apps/desktop/src/shell/SubtaskCreateModal.tsx` | **없음** | 신규 작성 |
| Project create | `apps/desktop/src/shell/ProjectCreateModal.tsx` | `web/src/components/ProjectSettings.tsx` 의 일부 | desktop 패턴 정합 (별도 modal) |
| Project settings | `apps/desktop/src/shell/ProjectSettingsModal.tsx` | `web/src/components/ProjectSettings.tsx` | 시각 정합 + modal 형태 통일 |
| Project switcher | `apps/desktop/src/shell/ProjectSwitcher.tsx` | (없음 — Header 안 ad-hoc) | 신규 작성 |
| Detail panels (Task Comments) | `apps/desktop/src/shell/TaskCommentsPanel.tsx` | `web/src/components/task-detail/` 일부 | 시각 정합 |
| Detail panels (Task Questions) | `apps/desktop/src/shell/TaskQuestionsPanel.tsx` | `web/src/components/task-detail/` 일부 | 시각 정합 |
| Detail panels (Task Runs) | `apps/desktop/src/shell/TaskRunsPanel.tsx` | `web/src/components/task-detail/` 일부 | 시각 정합. web 의 `features/runs/RunCompare` 는 보존 |
| DetailDrawer (래퍼) | `apps/desktop/src/shell/DetailDrawer.tsx` + `DetailPanels.tsx` | `web/src/App.tsx:644-660` 의 인라인 drawer | 추출 + 정합 |
| Help | (없음) | `web/src/components/HelpModal.tsx` | web-only 유지 — 사용자 가치 있음 |
| Toast | (없음 명시) | `web/src/components/Toast.tsx` | web-only 유지 (실시간 SSE 알림용) |

## 4. Command palette

| 항목 | desktop (정본) | web (현행) | 정합 방향 |
|---|---|---|---|
| 컴포넌트 | `packages/ui/src/components/CommandSurface/CommandSurface.tsx` | `web/src/components/CommandPalette.tsx` | 시각 + 그룹 구조 정합 |
| 그룹 구성 | Views (⌘1-⌘5) + Plans (top 8) + Units (top 8) + Tasks (top 12), `apps/desktop/src/App.tsx:40-82` 에서 memoized | (web 측 확인 필요) | desktop 그룹 구조 정합 |
| 트리거 | Cmd+K + 각 view 단축키 ⌘1-⌘5 | (web 측 useGlobalShortcuts) | 단축키 정합 |

## 5. Theme + localStorage 키 정합

`clawket.theme` 키는 desktop/web 모두 동일 — web 은 이미 legacy `clawket-theme` 에서 마이그레이션 완료 (`web/src/lib/theme.ts:28-29` 참조). 동일 패턴으로 다른 키도 dot 명명으로 정합.

| 키 | desktop (정본) | web (현행) | 정합 작업 |
|---|---|---|---|
| 테마 | `packages/ui/src/lib/theme.ts:5` — `clawket.theme` | `web/src/lib/theme.ts:12` — `clawket.theme` | 이미 정합 — 추가 작업 없음 |
| Sidebar width | `apps/desktop/src/shell/Sidebar.tsx:15` — `clawket.sidebarWidth` (numeric width) | `web/src/components/Sidebar.tsx:96-105` — `clawket-sidebar-collapsed` (boolean, 다른 컨셉) | desktop 패턴 (resizable width) 도입 + 신규 키 `clawket.sidebarWidth` 사용. `clawket-sidebar-collapsed` 는 폐기 (다른 컨셉) |
| Drawer width | `apps/desktop/src/shell/DetailDrawer.tsx:17` — `clawket.drawerWidth` (default 400, range 320-480) | `web/src/App.tsx:222,238` — `clawket-drawer-width` (default 520) | 키 정합: `clawket.drawerWidth` 로 변경, 1회 read-fallback (`clawket-drawer-width` → `clawket.drawerWidth`) 후 새 키로 write. default/range 도 desktop 값 (400, 320-480) 으로 정합 |
| Active project | `apps/desktop/src/data/DataProvider.tsx:64` — `clawket.activeProjectId` | (web 측 키 확인 필요) | desktop 키 정합 |
| SSE last event id | (desktop 측 확인 필요 — 현재 inventory 에서 미발견) | `web/src/App.tsx:159` — `clawket.sse.lastEventId` | web 키 유지 (이미 dot 명명) |

## 6. Data layer (필수 보존)

| 항목 | desktop (정본 패턴) | web (현행 패턴) | 정합 방향 |
|---|---|---|---|
| Data provider | `apps/desktop/src/data/DataProvider.tsx` — 단일 reducer + useEvents 구독 | `web/src/App.tsx:65-152` — sseReducer (3 action: `task:patch`, `task:delete`, `structural`) | 구조 정합 (DataProvider 추출) 하되 **21 채널 SSE routing 보존** |
| SSE 채널 라우팅 | useEvents 안에 추상화 | `web/src/App.tsx:290-348, 383-401` — 21 채널 명시 dispatch | web 의 21 채널 routing 그대로 보존. desktop 패턴으로 옮길 때 abstraction 깊이 동일하게 유지 |
| HTTP 전송 | WebView fetch (Tauri 환경) | `web/src/api.ts` — `request<T>()` with `credentials` + `X-Clawket-Token` | web 의 dual-channel auth 보존 |
| Selection state | `SelectionProvider` (`apps/desktop/src/shell/selection.tsx`) | App.tsx 인라인 useState | desktop 컨텍스트 패턴 도입 |

## 7. Web 전용 가치 surface (보존)

다음은 desktop 에 없고 web 에만 있는 유의미 표면. **마이그레이션 중 제거 금지**:

| 표면 | 위치 | 가치 |
|---|---|---|
| EnvelopeForm | `web/src/components/EnvelopeForm.tsx` (+ 3 test 파일) | 19-field ADR-0001 envelope, 400ms 검증 debounce. Clawket 핵심 differential |
| Decomposition suggestion | `web/src/features/decomposition/` | LLM 기반 plan decomposition 제안 패널 |
| Run compare | `web/src/features/runs/` | RunCompare UI — agent run diff 비교 |
| Timeline replay | `web/src/features/timeline/` | TimelineReplay UI — SSE event 재생 |
| Help | `web/src/components/HelpModal.tsx` | 단축키 + 사용법 도움말 |
| Toast | `web/src/components/Toast.tsx` | 실시간 SSE 알림 표시 |

## 8. 보존 invariant (한 줄도 약화 금지)

| invariant | 위치 | 비고 |
|---|---|---|
| SSE 21 채널 envelope | `web/src/types.ts` + `web/src/App.tsx:290-348` | `task:*`, `unit:*`, `plan:*`, `cycle:*`, `knowledge:*`, `comment:*`, `ping` |
| `last_event_id` 재생 | `web/src/App.tsx:159` `LAST_EVENT_ID_KEY` | SSE reconnect 시 누락 이벤트 재수신 |
| Dual-channel auth | `web/src/api.ts` `request<T>()` | cookie `clawket_session` + `X-Clawket-Token` header fallback |
| Vite SSE proxy bypass | `web/vite.config.ts` (또는 등가) | `.claude/rules/vite-sse-proxy-bypass.md` |
| dnd-kit overlay state | `web/src/components/BoardView.tsx` + `BacklogView.tsx` | `.claude/rules/dnd-kit-overlay-state.md` |
| Tailwind v4 CSS-first | `web/src/index.css` `@theme` block | `.claude/rules/tailwind-v4-css-first.md` (또는 등가) |
| React 19 use()/Activity | (현행 사용 지점) | RSC 도입 금지, Suspense + ErrorBoundary 동반 |

## 9. Phase 매핑 (U1 ~ U6)

| Phase | 본 문서 섹션 | 핵심 task 후보 |
|---|---|---|
| U1 Design system 정합 | §5 (theme/localStorage) + tokens.css 신규 | tokens.css 도입, theme.ts 정합 확인, drawerWidth 키 정규화, sidebarWidth 키 신규 |
| U2 AppShell 패턴 이식 | §1 + §4 + §6 | AppShell compound, Sidebar, Topbar, BrandMark, ProjectSwitcher, DetailDrawer 추출, CommandSurface 재구현, SelectionProvider, DataProvider 추출 |
| U3 View 정합 | §2 | ViewShell 도입 + 5 view 시각 정합 + Plans view 폐지 + PlanTree sidebar fold-in |
| U4 Modal/interaction 정합 | §3 | 누락 16 개 modal 신규 작성 + DetailPanels 정합 |
| U5 Playwright MCP 검증 | §8 (invariant 회귀) | 골든패스 3종 + SSE 21 채널 회귀 |
| U6 Cleanup | §7 (web 전용 가치 보존 확인) + §5 (legacy key 제거) | tsc/eslint 통과, legacy key cleanup, pre-tauri tag 보존 안내 |
