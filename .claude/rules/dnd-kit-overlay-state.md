# dnd-kit-overlay-state

## Purpose
`@dnd-kit/core` 의 `DndContext` + `DragOverlay` 패턴에서 drag 중 React 상태 변화가 일어났을 때 `activeTask` 같은 drag 메타 state 가 silent 하게 lost 되지 않도록 invariant 를 박는다.

## Prevents
- `DragOverlay` 내부 또는 `DragOverlay` 가 가리키는 카드 컴포넌트에서 `useState` / network mutation 을 호출 → drag 중 부모 re-render 가 발생해 `activeTask` 가 다음 frame 에 `null` 로 보이고, overlay 가 사라지거나 깜빡임.
- `onDragStart` 외부에서 `setActiveTask` 를 호출 → drag 시작이 누락된 채 drop 만 동작해, kanban 컬럼 사이 transition 이 jump 처럼 보임.
- `onDragEnd` 에서 `setActiveTask(null)` 누락 → drag 가 끝났는데 overlay 가 stuck 으로 남아 클릭을 가로채는 phantom card 가 발생.
- `useDraggable` / `useDroppable` 를 한 컴포넌트에서 동시에 호출 → dnd-kit 의 sensor 가 두 역할을 혼동, drag pointer 가 즉시 release 됨.

## Evidence
- `src/components/BoardView.tsx:57` — `const [activeTask, setActiveTask] = useState<Task | null>(null);` 가 BoardView top-level state.
- `src/components/BoardView.tsx:210-236` — `<DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>` 가 컬럼 그리드를 감싸고, `<DragOverlay>` 안에서 `activeTask` 를 직접 렌더링.
- `src/components/BoardView.tsx:59-61` — `useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))` — 5px 활성화 threshold (click 과 drag 분리).
- `src/components/board/TaskCard.tsx:3,39-50,93` — `useDraggable({ id: task.id })` 가 카드 자체에 결합. drag 중 카드가 unmount 되면 overlay 가 stale ref 를 가질 수 있음.
- `src/components/board/DroppableColumn.tsx:1,13` — `useDroppable({ id: col.key })` 가 컬럼에 결합. droppable id 가 status enum 과 1:1.

## Why not global
글로벌 `mechanical-overrides.md` 는 React 라이브러리 특화 패턴을 다루지 않는다. dnd-kit 의 `DragOverlay` 가 portal 렌더링이라 React tree 와 별도로 unmount 되는 사실은 sub-repo 특화 지식이며, 글로벌 룰로 표현하면 다른 sub-repo 에 무관한 잡음이 된다.

## Enforcement gap
- eslint `react-hooks/exhaustive-deps` 는 hook deps 를 검사할 뿐, "drag 중 setState 호출 금지" 를 알지 못한다.
- vitest + RTL 환경에 dnd-kit 의 `KeyboardSensor` simulation 이 갖춰져 있지 않아 drag lifecycle 회귀가 unit test 로 잘 잡히지 않는다.
- TypeScript 는 `activeTask` 가 mid-drag 에 `null` 이 되는 시나리오를 인지하지 못한다.

## Rule body

### DO
- `activeTask` 같은 drag 메타 state 는 항상 `DndContext` 의 가장 가까운 부모에서만 보유한다 (현재 `BoardView`).
- `onDragStart(e)` 에서만 `setActiveTask` 를 호출하고, `onDragEnd` / `onDragCancel` 둘 다에서 `setActiveTask(null)` 로 cleanup 한다.
- `<DragOverlay>` 의 children 은 stateless 한 view 컴포넌트 (`TaskCard` 처럼 prop 만 받는) 만 둔다. 네트워크 호출·로컬 state·effect 가 없어야 한다.
- `useDraggable` 와 `useDroppable` 는 분리된 컴포넌트에서 호출한다 — 현재 `TaskCard` (draggable) 와 `DroppableColumn` (droppable) 의 분리를 유지한다.

### DON'T
- `<DragOverlay>` 안에서 `useState`, `useEffect`, `useReducer`, `api.*` 호출을 추가하지 않는다 — overlay 가 portal 이라 re-render 시 cleanup 이 비대칭이다.
- drag 중 (`activeTask !== null` 상태) 에 BoardView 의 비-drag 관련 state 를 무리하게 setState 하지 않는다 — overlay 위치가 frame drop 으로 튄다.
- `useSensors` 의 `activationConstraint.distance` (현재 5px) 를 인지 없이 줄이지 않는다 — 클릭 (`onClick`) 과 drag 가 충돌한다.
- 같은 컴포넌트에서 `useDraggable` 와 `useDroppable` 를 동시에 호출하지 않는다 — sensor 가 즉시 release 한다.
- `onDragEnd` 의 cleanup 을 conditional 로 만들지 않는다 (성공/실패 모두 `setActiveTask(null)`).
