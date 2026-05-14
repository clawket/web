# sse-event-synchronization

## Purpose
웹 대시보드의 SSE 구독자가 데몬(`clawket/daemon`)이 발행하는 이벤트 이름 집합과 1:1로 동기화된 상태를 유지하도록 강제한다. 이름이 추가·변경·삭제될 때 daemon repo 의 wire-contract 와 함께 단일 트랜잭션으로 갱신한다.

## Prevents
- 데몬이 `task:archived` 같은 새 이벤트를 emit 하기 시작했는데 `src/App.tsx:383-401` 의 하드코딩된 리스트에 추가되지 않아, SSE 채널은 살아 있지만 해당 변경이 silent 하게 UI 에 반영되지 않는 사고.
- 데몬이 `knowledge:created` 같은 이름을 deprecate 했는데 웹이 여전히 구독해 `addEventListener` 가 영원히 트리거되지 않고 view 가 stale 상태로 남는 사고.
- `entity_type` / `change_type` envelope 키가 데몬에서 리네임되었는데 (`src/App.tsx:83-92`) reducer 분기가 그대로라 모든 이벤트가 `default` 로 빠져 reducer 가 no-op 가 되는 사고.

## Evidence
- `src/App.tsx:383-401` — 21개 이벤트 이름이 문자열 배열로 하드코딩되어 있고, `for` 루프로 `addEventListener` 등록. 타입 추론으로 잡히지 않는다.
- `src/App.tsx:83-92` — `SseEvent` envelope (`entity_type`, `change_type`, `event_id`, `ts`, `fields[]`). reducer 가 이 키 이름에 강하게 결합되어 있다.
- `src/App.tsx:65-92` — payload contract 주석이 v3 SSE wire 의 정본 사양을 가리키지만, 실제 데몬 emitter 가 정본이고 이 주석은 mirror 다.
- `web/CLAUDE.md:53,87` — "SSE 이벤트 이름을 단독으로 추가/변경 금지. 데몬 측 emitter 와 동시 갱신 필요" 명시.

## Why not global
글로벌 `mechanical-overrides.md §10 NO SEMANTIC SEARCH` 는 grep 으로 모든 참조를 찾으라고 하지만, daemon ↔ web 간 wire contract 는 두 repo 가 독립 git 으로 분리되어 grep 가 cross-repo 로 확장되지 않는다. cross-repo wire 동기화는 sub-repo 가드레일로만 표현 가능하다. `clawket-context-management.md` 의 활성 태스크 게이트도 이 결합을 detect 하지 못한다 — 변경 자체는 한 repo 안에서 잘 컴파일된다.

## Cross-repo counterpart
- **Producer 측** — `daemon/.claude/rules/sse-event-wire-contract.md` 가 `src/state.rs` 매핑 테이블과 `src/routes/knowledge.rs` 의 emit 위치를 정본으로 본다.
- **Consumer 측 (본 룰)** — 본 sub-repo. `src/App.tsx:383-401` 의 이벤트 배열과 `sseReducer` 의 분기가 정본.
- 두 룰은 동일한 wire 의 양 끝이며, 동일 패턴이 ≥3 sub-repo 에서 반복되면 글로벌 cross-repo wire-contract 룰로 promotion 후보 (Phase 1 inventory 결정 §종합 priority ranking).

## Enforcement gap
- `src/App.tsx:383-401` 는 string literal 배열이라 TypeScript 가 이벤트명 misspelling 을 잡지 못한다.
- 데몬 측 라우트에서 새 이벤트가 추가되어도 웹 빌드는 그대로 green — runtime 에 silent drop 만 발생.
- vitest 가 SSE end-to-end mock 을 가지지 않아 reducer 단위 테스트가 envelope 키 drift 를 검출하지 못한다.
- ESLint 가 string-literal allowlist 룰을 구성하지 않은 상태.

## Rule body

### DO
- 이벤트 이름 추가/변경/삭제는 항상 daemon repo 의 emit 측 (`src/routes/*.rs`, `src/state.rs`) 과 같은 PR / 같은 cycle 에서 짝지어 진행한다.
- `src/App.tsx:383-401` 의 배열을 갱신할 때는 데몬 `src/state.rs` 의 매핑 테이블 (또는 후속 wire-contract 정본) 과 1:1 비교한 결과를 PR 본문에 적는다.
- envelope 키 (`entity_type` / `change_type` / `event_id` / `ts` / `fields`) 가 바뀌면 `src/App.tsx:83-92` 의 `SseEvent` 인터페이스와 reducer 분기를 함께 갱신한다.

### DON'T
- 웹 단독으로 이벤트 이름을 추가/제거하지 않는다 — 데몬이 emit 하지 않는 이름을 구독하면 dead code 가 되고, 데몬이 emit 하는데 구독하지 않으면 UI 가 stale 이 된다.
- "어차피 generic listener 로 처리되니까" 라며 새 이벤트의 명시적 등록을 생략하지 않는다 (`onmessage` fallback 은 named event 를 받지 않는다).
- envelope 키를 fields 안에 옮기거나 fields 의 의미를 재정의하지 않는다 — 데몬과의 wire 계약이다.
