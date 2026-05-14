# react-19-activity-use-discipline

## Purpose
React 19 의 신규 API (`use()` hook, `<Activity>` 컴포넌트) 를 도입할 때, 코드베이스가 SPA-only 클라이언트 런타임이라는 invariant 와 충돌하지 않도록 사용 위치·전제 조건을 게이트한다.

## Prevents
- `use()` hook 을 Suspense boundary 없이 호출 → fetch 실패 시 모든 부모가 throw 되어 dashboard 가 흰 화면.
- `use()` 를 async server component 자리에 호출 (이 repo 는 RSC 아님) → React 가 client-only 에서 promise unwrap 을 의도와 다르게 처리, dev/prod 동작 불일치.
- `<Activity mode="hidden">` 으로 무거운 view 를 hide 처리 후 effect 가 unmount 되지 않아 SSE/timer/listener 가 invisible state 로 leak.
- 기존 `useEffect + fetch + setState` 패턴 위에 무계획적으로 `use()` 를 끼워넣어 두 데이터 fetch path 가 race condition 으로 충돌.

## Evidence
- `package.json:39-40` — `react ^19.2.4`, `react-dom ^19.2.4` (v19 정식 채택).
- `src/components/TimelineView.tsx:1,88` — `import { useState, useEffect, useMemo, useRef } from 'react'`; "Activity Stream" 은 코드 섹션 주석으로 사용된 식별자이지 React 의 `<Activity>` 가 아니다. 현재 codebase 는 `use()` / `<Activity>` 를 아직 미사용.
- `src/App.tsx:65-152` — SSE 는 `useReducer` + `useEffect` 패턴으로 결합. 데이터 fetch 와 mutation 이 effect 기반.
- `src/api.ts:47-62` — fetch 가 promise 를 반환하지만 모든 호출 site 가 `await` / `.then` 패턴이고 `use()` 로 promise 를 직접 unwrap 하는 곳은 없음.
- `web/CLAUDE.md:11,30` — React 19 채택, SSE / drawer / view switch 가 효과(`useEffect`) 기반 SPA.

## Why not global
글로벌 `mechanical-overrides.md` 는 React 19 신규 API 의 client-only 제약과 Suspense boundary 결합 요건을 다루지 않는다. "이 repo 는 RSC 가 아니다" 도 sub-repo 특화 사실 — 다른 React 19 sub-repo (예: landing) 와 별개의 결정.

## Enforcement gap
- ESLint `react-hooks/rules-of-hooks` 는 `use()` 가 conditional 안에 들어가는 것은 잡지만, "이 호출 위에 Suspense 가 없다" 는 트리 구조 검사는 하지 않는다.
- `<Activity>` 는 `react-dom` 19 의 신규 컴포넌트로, 잘못된 위치 (예: 라우터 root) 에서 사용해도 TypeScript / ESLint 가 차단하지 않는다.
- vitest + jsdom 환경은 Suspense + concurrent rendering 의 일부 시나리오만 reproduce 한다 — full Activity 라이프사이클 회귀가 unit 으로 잘 잡히지 않는다.

## Rule body

### DO
- `use()` 를 새로 도입할 때는 호출 site 의 상위에 **명시적 `<Suspense fallback>`** 과 **Error Boundary** 를 함께 배치한다. `App.tsx` root 의 view switch 위에 boundary 를 두는 것을 우선 고려.
- `<Activity>` 는 라우트 단위 view 캐싱 (Summary ↔ Board ↔ Backlog ↔ Timeline ↔ Wiki) 같이 명확한 경계를 가진 컨테이너에만 적용한다. component-level toggle 에는 쓰지 않는다.
- `<Activity mode="hidden">` 으로 가린 view 안의 effect 가 cleanup 되지 않는 동작을 인지하고, SSE listener / timer 는 가시성 상태와 별도 lifecycle 로 명시 관리.
- 기존 `useEffect + fetch + setState` 코드를 `use()` 로 마이그레이션할 때는 한 컴포넌트씩 phased 로, 두 패턴 공존 기간을 짧게 둔다.

### DON'T
- Suspense / Error Boundary 없이 `use(somePromise)` 를 호출하지 않는다 — fallback 없이 throw 가 상위로 전파된다.
- `use()` 를 server component 가정 하에 작성하지 않는다 — 이 repo 는 client-only SPA 다.
- `<Activity>` 를 "모든 곳에서 좋은 디폴트" 라며 잘 동작하는 `useEffect` 코드 위에 덮어쓰지 않는다. 도입 사유를 PR 본문에 명시.
- `<Activity>` 안에 SSE EventSource 를 새로 인스턴스화하지 않는다 — `App.tsx` 의 단일 EventSource 가 SSoT.
- React minor 를 임의로 bump 하지 않는다 (`web/CLAUDE.md:11` 의 `^19.2.4` 핀 — major 변경은 wrapper 의 호환성 매트릭스 확인 필요).
