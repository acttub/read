# rehearsal-web — 상대역 리허설 v1 설계

> 대본을 넣고 내 배역을 고르면, 나머지 배역의 대사를 AI가 소리 내어 연기해 주고
> 내 차례에는 멈춰서 기다리는 혼자 연습용 도구. 최종 목표는 앱이고, v1은 모바일 웹.

참고 베이스: `acttub/read`(플로우·가드레일·침묵 감지), `coo001/rehearsal_app`(연기 지시 → TTS, 범위 반복).

## 결정 사항

- 스택: Next.js 16(App Router) + TypeScript + Tailwind v4. 순수 로직은 vitest.
- 폰 세로 기본, 데스크톱은 가운데 좁은 셸(max 480px). 앱 전환을 염두에 둔 SPA 구조(화면 = phase 상태).
- 대본 본문은 **브라우저 안에서만** 다루고 `sessionStorage`까지만 저장한다. 서버·로그에 대본이 남지 않는다.
- 상대 대사 음성은 **브라우저에서 도는 Supertonic 3 가 기본**. 모델은 HuggingFace CDN 에서 받아 Cache API 에 둔다. 서버가 없어 대사가 기기 밖으로 나가지 않는다.
  모델을 받기 전이거나 받을 수 없으면 **기기 내장 TTS(`speechSynthesis`)로 폴백**한다. 유료 API 는 호출하지 않는다.
  실행 장치에 따라 가중치가 다르다 — WebGPU 에는 fp32(380MB), WebAssembly 에는 int8(138MB). int8 은 WebGPU 에서 진폭이 터져 못 쓴다.
- 내 차례 넘김은 **마이크 음량 기반 침묵 감지**(오디오가 밖으로 나가지 않음) + 수동 버튼. STT는 쓰지 않는다.
- 연기를 평가·채점하지 않는다. 화면 문구는 기능 설명에 한정한다.

## 화면 흐름 (phase) — 2026-08-26 pen 시안(`Project/pen/RN앱 반영.pen` A8·W10·D9 시리즈) 반영

| phase | 하는 일 |
|---|---|
| `input` | 대본과 배역 — 파일(txt·pdf) / 붙여넣기 / 직접 쓰기 / 예시. 오른쪽(데스크톱은 2열) 배역 정하기 카드에 배역·대사 수. 배역 부족하면 이름 힌트 |
| `review` | (폰만) 대본 확인 — 제목·배역 칩·대사 목록. 데스크톱은 `setup` 왼쪽 열에 같이 보임 |
| `setup` | 배역 정하기 — 내 배역 · 리딩 방식(읽어주기 / 암기 대조) · 목소리 들어보기 · 넘김 방식(침묵 감지 / 버튼) |
| `run` | 읽어주기: 상대 대사 TTS, 내 차례 대기. 암기 대조: 내 대사 가림 + 첫 글자 힌트, 마이크 누르고 말하기(브라우저 음성인식) 또는 입력하기, 글자 대조 → 넘어가기/다시. 데스크톱은 왼쪽 대본 열 + 오른쪽 무대 |
| `done` | 완료 — 내 배역·대사·시간, AI 코치 카드(acttub 연결), 다시 / 새 대본. 암기 대조만 대사 정확도 % 표시 |

앞 단계 데이터가 없으면 앞 화면으로 되돌린다. 테마는 시안 토큰(토스 톤 라이트, `$web-blue` 계열)을 `globals.css`에 그대로 옮겼다.

암기 대조 가드레일(read AGENTS.md): 글자만 맞춘다("여기까지가 글자예요"), 맞음/틀림 대신 넘어가기/다시, 같은 줄 2회 미달이면 안내 없이 통과, 인식 텍스트는 판정 후 버린다.

## 모듈

- `src/lib/script/parse.ts` — 대본 텍스트 → `{ roles, lines }`. 지원 형식: `이름: 대사`, `이름 대사`(알려진 배역), 블록형(`이름` 한 줄 + 다음 줄 대사), `(지문)`·`[지문]`.
- `src/lib/rehearsal/machine.ts` — 순수 상태머신. `idle → ai | me → … → done`, `paused`. 지문은 화면에만 보이고 진행에서는 건너뛴다.
- `src/lib/audio/vad.ts` — RMS 샘플을 받아 `speech_start / speech_end / timeout`을 내는 순수 침묵 감지기.
- `src/lib/audio/tts.ts` — 두 엔진(Supertonic·기기 음성)의 파사드. 배역별 목소리 배정, 한국어 음성 품질 정렬, iOS 언락, 괄호 지문 제거, 다음 대사 미리 합성.
- `src/lib/audio/supertonic/` — 브라우저 신경망 음성. `engine.ts`(장치·가중치 선택과 합성), `cache.ts`(모델 캐시), `play.ts`(재생과 진폭 안전장치), `helper.js`(원본 런타임 벤더링).
- `src/lib/audio/mic.ts` — getUserMedia → AnalyserNode → RMS만 뽑아 감지기에 넣는다. 녹음·전송 없음.
- `src/lib/script/extract.ts` — 파일 종류를 보고 알맞은 추출기로 넘긴다. hwp · pdf · docx · txt.
- `src/lib/script/hwp.ts` — 한글 파일. 배역과 대사를 가르는 탭을 살린다. 한글 97 형식은 알아보고 알린다.
- `src/lib/script/docx.ts` — 워드 파일. 서식은 버리고 글자만.
- `src/lib/script/pdf.ts` — pdf.js로 브라우저 안에서 텍스트 추출(워커는 `public/pdf.worker.min.mjs`).
- `src/lib/storage.ts` — `sessionStorage` 저장/복원.
- `src/hooks/useRehearsalRunner.ts` — 상태머신 + TTS + 마이크를 잇는 러너. 상태가 바뀌면 진행 중인 TTS·마이크를 항상 정리한다.
- `src/components/App.tsx` — phase 라우터. `screens/`에 화면 4개.

유료 TTS/LLM 경로(`/api/tts` 등)는 넣지 않았다. 서버 GPU 도 필요 없었다 — Supertonic 은 CPU 에서도 실시간보다 빠르고 WebGPU 에서는 RTF 0.28 이다.

## v2 후보 (v1에서 뺀 것)

파싱 결과 수동 교정 화면 · 배역별 목소리 수동 배정 · 암기 대조(STT) · 세션 목록 · LLM 연기 지시(rehearsal_app 방식) · 캐릭터/관계 카드.
