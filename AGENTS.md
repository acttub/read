# read.acttub.com — 상대역 리딩 (가칭)

대본을 붙여넣고 내 배역을 고르면, **다른 배역의 대사를 소리로 읽어주는** 혼자 연습용 도구.

> 기획 정본은 볼트의 `planning/서브프로젝트/subproject-scene-partner-2026-07-29.md`.
> 이름은 **가칭**이다. 확정 전까지 팀 용어처럼 쓰지 않는다.

## 화면 3개

| 경로 | 하는 일 |
|---|---|
| `/input` | 대본 붙여넣기 → 배역 추출 |
| `/char` | 내 배역 고르기 · 배역별 목소리 배정 |
| `/prac` | 리딩 실행 — 내 차례엔 멈추고, 나머지를 읽는다 |

`/`는 `/input`으로 보낸다. 단계를 건너뛰면(앞 단계 데이터 없음) 앞 화면으로 되돌린다.

## 절대 어기지 않는 것

- **대본을 서버로 보내지 않는다.** 사용자가 넣는 대본은 대부분 타인의 저작물이고 서버 저장은 복제에 해당한다. 브라우저 안에서만 다루고 `sessionStorage`까지가 끝이다. 서버·분석·로그 어디에도 대본 본문을 남기지 않는다.
- **연기를 평가·판정하지 않는다.** 점수·등급·"잘했어요"·"자연스러워요"·강약점·교정 문구 금지. 읽어주고 끝이다. 사용자 음성을 분석·비교하지 않고, 속도·발음·성량 계측값을 보여주지 않는다. 화면 문구는 기능 설명에 한정한다.
- **녹음을 서버로 보내지 않는다.** 마이크는 넘김 감지에만 쓰고 그 자리에서 버린다.

근거: 볼트 `AGENTS.md`의 제품 가드레일.

## 스택

- **Tailwind v4** — 토큰은 `src/brand/tailwind-starter.css`의 `@theme`. **직접 고치지 않는다.** 값을 바꾸려면 볼트 `brand/DESIGN.md`를 고치고 `tools/brand-tokens-export.py` → `tools/subproject-sync-brand.py`를 돌린다.
- 스타일 빌드: `npm run css` (`src/input.css` → `styles.css`). 배포는 정적이다.
- 기기 대응은 `src/brand/responsive-base.css`의 3단 티어(`phone`/`tablet`/`desktop`). `.tier-root` + `.tier-shell` 골격을 쓴다.
- 뷰포트 meta 고정: `width=device-width, initial-scale=1, viewport-fit=cover`. `maximum-scale`·`user-scalable=no` 금지.
- 높이는 `100vh` 대신 `100svh`(=`--app-min-h`). **가로 넘침을 `overflow-x: hidden`으로 덮지 않는다.**

## 폰트

UI는 Pretendard 서브셋(`build-fonts.py`), **대본 본문만 시스템 한글 글꼴**(`--font-script`)로 떨어뜨린다. 사용자가 넣는 대본은 글자가 임의라 서브셋으로 감당할 수 없어서다. 다른 서브프로젝트처럼 전부 서브셋하면 대본 절반이 깨진 글꼴로 렌더된다.

## 디자인

`design/input.pen`에 4화면 시안이 있다(파일명은 input이지만 4화면이 다 들어 있다). **캔버스는 시안까지고 구현 기준이 아니다** — pen export를 코드로 쓰지 않는다. 캔버스가 Pretendard를 렌더하지 못해 시안만 Noto Sans KR로 보이지만, `font-main` 변수는 정본대로 Pretendard다.

## 배포

- GitHub가 정본이고 **`git push origin main`이 곧 배포다.** 로컬에서 `vercel --prod`를 치지 않는다.
- **푸시는 최우영 승인 후.** 커밋까지만 하고 멈춘다.
- 커밋 전 `uv run tools/device-matrix.py subpro/read` (20개 프리셋, 문제 있으면 종료코드 1).
- ⚠️ **공개 저장소다.** 비밀값·실명·비공개 볼트 경로를 커밋하지 않는다.
