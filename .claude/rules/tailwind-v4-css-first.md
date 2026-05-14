# tailwind-v4-css-first

## Purpose
본 sub-repo 가 Tailwind v4 **CSS-first** 환경임을 모든 스타일 변경 흐름에서 invariant 로 유지한다. v3 의 `tailwind.config.js` / `@apply` / JSX hex 임의 색 패턴이 v4 코드베이스에 우발적으로 도입되지 않도록 가드한다.

## Prevents
- v3 패턴을 따라 `tailwind.config.js` 를 새로 만들고 `theme.extend.colors` 에 색을 정의 → v4 가 `@tailwindcss/vite` 의 CSS-first 토큰 (`src/index.css` `@theme` 블록) 을 정본으로 사용하기 때문에 두 정의가 동시 존재하며 silent 하게 어긋남.
- 컴포넌트에 `@apply` 디렉티브를 도입 → v4 에서는 권장되지 않고, `src/styles/tokens.css` 를 single source 로 사용하는 토큰 체계와 우회 경로를 만든다.
- JSX 에 `className="bg-[#7c3aed]"` 같은 임의 hex 를 박음 → 다크/라이트 테마 토큰 매핑 (`src/styles/themes/{dark,light}.css`) 을 우회해 한 테마에서만 보이는 색이 된다.
- 새로 추가한 컴포넌트가 `src/styles/tokens.css` 외부에서 raw color 를 정의 → tokens.css 의 single source 가 깨진다.

## Evidence
- `src/index.css:1-6` — `@import "tailwindcss"; @import "./styles/tokens.css"; @plugin "@tailwindcss/typography"; @source "../components";` (v4 CSS-first 진입점).
- `src/index.css:8-60` — `@theme { --color-background: var(--color-background); … }` 블록이 시맨틱 토큰을 Tailwind 컬러로 노출.
- `src/styles/tokens.css`, `src/styles/themes/{dark,light}.css` — 실제 토큰 값의 정본 (한 곳).
- `package.json:36,44` — `@tailwindcss/vite ^4.2.2`, `tailwindcss ^4.2.2`. `tailwind.config.js` / `postcss.config.js` 파일 부재 확인.
- `web/CLAUDE.md:14,63,92` — "**CSS-first** via `@tailwindcss/vite`. 설정/토큰은 `src/index.css` + `src/styles/tokens.css`", "raw hex / 임의 Tailwind palette 직접 사용 금지".

## Why not global
글로벌 `product-quality-first.md` 의 SCOPE LOCK 은 문서 정체성을 지키지만, "이 repo 의 styling 환경이 v4 CSS-first" 라는 사실은 sub-repo 특화 invariant 다. 글로벌 `mechanical-overrides.md §3 SENIOR DEV OVERRIDE` 도 "v3 와 v4 의 차이" 를 모르므로, `tailwind.config.js` 를 추가하는 PR 을 "구조적 개선" 이라며 통과시킬 수 있다.

## Enforcement gap
- `pnpm lint` (eslint flat config) 에 `tailwindcss/no-custom-classname` 같은 plugin 이 결합되어 있지 않다.
- `tailwind.config.js` 가 추가되어도 v4 빌드는 그것을 무시할 뿐 fail 하지 않는다 — 사람이 보기 전까지 두 정의가 공존.
- `@apply` 가 v4 에서 동작은 하므로 빌드가 깨지지 않는다. lint 없이는 도입 시점에 silent.
- JSX 의 `className="bg-[#…]"` 는 Tailwind arbitrary value 문법으로 합법 → 빌드/lint 통과.

## Rule body

### DO
- 새 색·간격·반경·폰트는 `src/styles/tokens.css` 에 시맨틱 토큰으로 추가한 뒤, `src/index.css` 의 `@theme` 에서 Tailwind 컬러로 매핑한다.
- 컴포넌트는 `bg-background`, `text-foreground`, `text-muted`, `border-border`, `bg-surface`, `bg-surface-high`, `bg-primary` 등 시맨틱 클래스만 사용한다.
- 다크/라이트 양쪽에서 동작이 필요한 색은 `src/styles/themes/{dark,light}.css` 양쪽에 동시에 토큰을 정의한다.
- `@tailwindcss/typography` plugin 의 prose 색은 `src/index.css:96-113` 의 prose override 패턴을 따른다 (themed CSS vars).

### DON'T
- `tailwind.config.js` / `tailwind.config.ts` / `postcss.config.js` 를 신설하지 않는다 — v4 CSS-first 정본을 정의하면 split source 가 된다.
- 컴포넌트나 글로벌 CSS 에 `@apply` 디렉티브를 새로 도입하지 않는다 (`@apply` 가 token 체계를 우회해 클래스 그래프를 평탄화한다).
- JSX 에 `bg-[#7c3aed]`, `text-[#000]` 같은 hex arbitrary value 를 박지 않는다 — 테마 토글이 깨진다.
- `src/styles/tokens.css` 밖의 위치에서 색·간격·radius 토큰을 새로 정의하지 않는다.
- `tailwindcss` major 를 v3 로 다운그레이드하지 않는다 — `web/CLAUDE.md:14` 의 핀이 깨진다.
