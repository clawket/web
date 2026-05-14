<!-- 번역 상태: 초기 동기화. 정본은 README.md (영문). 영문이 갱신되면 docs/i18n-policy.md 의 14d/21d drift 윈도우 안에 본 파일을 동기화한다. -->

[English](README.md)

# @clawket/web

> **LLM 코딩 에이전트를 위한 구조화된 태스크 계약.**

[Clawket](https://github.com/clawket/clawket) 의 웹 대시보드. React 19 + Vite + Tailwind + dnd-kit SPA. **GitHub Release tarball** 로 배포된다 — 컨슈머(Clawket 플러그인의 install gate)가 `dist/` 를 추출하면 데몬이 정적 서빙한다.

6 개 뷰: Summary, Plans, Board (Kanban DnD), Backlog (DnD 로 cycle 배정), Timeline (에이전트 swimlane + 활동 스트림), Wiki (파일 트리 + FTS5 + 시맨틱 검색).

## 개발

```sh
pnpm install
pnpm dev      # http://localhost:5174 — 데몬 HTTP 라우트는 proxy 통과,
              #                         SSE 는 데몬 직접 hit (아래 참조)
```

데몬 URL 결정 우선순위 (Vite, 순서대로):

1. `CLAWKET_DAEMON_URL` (명시 override, 최우선).
2. `$CLAWKET_CACHE_DIR/clawketd.port`.
3. `$XDG_CACHE_HOME/clawket/clawketd.port`.
4. `~/.cache/clawket/clawketd.port`.
5. 위 모두 실패 시 `http://127.0.0.1:19400` fallback.

**`/events` 는 dev 에서 의도적으로 proxy 하지 않는다** — Vite proxy 가 SSE chunk 를 upstream close 까지 버퍼링해서 EventSource 가 `CONNECTING` 상태로 멈춘다. Dev 빌드는 `__CLAWKET_DAEMON_URL__` 에 절대 origin 을 inject 해서 브라우저가 데몬을 직접 호출하게 한다; 데몬 CORS 가 cross-origin 요청을 허용. 프로덕션에서는 데몬이 `/` 아래로 번들을 서빙하므로 SSE 는 same-origin 이고 `__CLAWKET_DAEMON_URL__` 는 빈 문자열이다.

## 빌드

```sh
pnpm build    # writes dist/
```

## 사용 주체

- **Clawket 플러그인 install gate** (`adapters/shared/claude-hooks.cjs::ensureInstalled`) — GitHub Release tarball 다운로드, 플러그인의 `web/` 디렉터리 아래에 `dist/` 추출, 데몬이 서빙.
- **clawketd** — 플러그인이 설치된 사용자가 시작하면 번들된 `web/dist/` 를 `/` 아래 정적 서빙하므로 별도 dev 서버 없이 http://localhost:19400 이 동작한다.

> npm 의 `@clawket/web` 에 의존하지 말 것 — GitHub Release tarball 로만 배포된다.

## 기여

> *분해, 계약, 실행 — 구조화된 에이전트 루프.*

Clawket 에 기여하는 모든 작업 (이 대시보드 포함) 은 세 단계를 순서대로 거친다: **분해** (작업을 태스크 트리로 쪼갬), **각 leaf 에 계약 서명** (19 필드 실행 envelope), **계약 대비 실행**. 플러그인 shell 의 `PreToolUse` 훅이 1–2 단계를 거치지 않은 3 단계를 하드 블록한다.

전체 가이드: [clawket/clawket → docs/CONTRIBUTING.md](https://github.com/clawket/clawket/blob/main/docs/CONTRIBUTING.md).

## 라이선스

MIT
