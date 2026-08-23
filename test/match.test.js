import assert from "node:assert/strict";
import test from "node:test";

import {
  compare,
  jamoSimilarity,
  normalize,
  scoreAttempt,
  scoreTextAttempt,
  scoreVoiceAttempt,
  summarizeAttempts,
  summarizeVoiceAttempts,
  toJamo,
  wordMatchRatio,
} from "../app/match.js";

function assertPassAndMiss(original, spoken) {
  assert.equal(compare(original, spoken).passed, true);
  assert.equal(compare(original, "전혀 다른 이야기").passed, false);
}

test("완전히 같은 말은 넘어가고 다른 말은 다시 한다", () => {
  assertPassAndMiss("오늘은 여기까지 하자", "오늘은 여기까지 하자");
});

test("문장부호와 띄어쓰기 차이는 흡수한다", () => {
  assertPassAndMiss("난 화난 게 아니에요.", "난화난게아니에요");
});

test("음성인식의 어절 분절 차이는 판정을 바꾸지 않는다", () => {
  assertPassAndMiss(
    "난 화난 게 아니에요",
    "난 화가 난 게 아니에요",
  );
});

test("종성 오인식은 자모 거리로 비교한다", () => {
  assertPassAndMiss("났어요", "나써요");
});

test("조사 차이는 느슨하게에서만 넘어간다", () => {
  assert.equal(compare("나는 기다려", "나 기다려").passed, true);
  assert.equal(
    compare("나는 기다려", "나 기다려", { mode: "글자 그대로" }).passed,
    false,
  );
});

test("숫자와 한글 숫자 표기를 같은 글자로 정규화한다", () => {
  assertPassAndMiss("삼일 동안", "3일 동안");
  assert.equal(normalize("0, 10, 25, 99"), "영 십 이십오 구십구");
});

test("원문 안의 괄호 지문은 대조에서 제외한다", () => {
  assertPassAndMiss("(울며) 왜 그래요", "왜 그래요");
});

test("완전히 다른 말은 다시 하고 같은 말은 넘어간다", () => {
  assert.equal(compare("문을 닫아 줘", "창문을 열어 줘").passed, false);
  assert.equal(compare("문을 닫아 줘", "문을 닫아 줘").passed, true);
});

test("대사의 절반만 말하면 다시 하고 전부 말하면 넘어간다", () => {
  assert.equal(compare("오늘 저녁에 다시 만나자", "오늘 저녁에").passed, false);
  assert.equal(
    compare("오늘 저녁에 다시 만나자", "오늘 저녁에 다시 만나자").passed,
    true,
  );
});

test("빈 인식 결과는 다시 하고 대사가 있으면 넘어간다", () => {
  assert.equal(compare("괜찮아", "").passed, false);
  assert.equal(compare("괜찮아", "괜찮아").passed, true);
});

test("정규화 뒤 원문이 비면 자동으로 넘어간다", () => {
  assert.equal(compare("(잠시 침묵한다)…", "").passed, true);
  assert.equal(compare("기다려", "").passed, false);
});

test("표시 조각은 원문 어절 기준이고 비율을 반환하지 않는다", () => {
  const result = compare("나는 오늘 집에 간다", "나 오늘 학교에 간다");
  assert.equal(result.segments.length, 4);
  assert.ok(result.segments.some(({ matched }) => !matched));
  assert.equal(Object.hasOwn(result, "ratio"), false);
  assert.deepEqual(toJamo("났"), "ㄴㅏㅆ");
});

test("요약할 음성 시도가 없으면 지표를 만들지 않는다", () => {
  assert.equal(summarizeVoiceAttempts([]), null);
});

test("완전히 일치한 시도는 어절과 자모가 모두 1이다", () => {
  assert.equal(wordMatchRatio("오늘은 여기까지 하자.", "오늘은 여기까지 하자"), 1);
  assert.equal(jamoSimilarity("오늘은 여기까지 하자.", "오늘은 여기까지 하자"), 1);
});

test("완전히 불일치한 시도는 어절과 자모가 모두 0이다", () => {
  assert.equal(wordMatchRatio("가", "힣"), 0);
  assert.equal(jamoSimilarity("가", "힣"), 0);
});

test("줄마다 최고 시도를 고르고 조용히 통과한 줄도 평균에 넣는다", () => {
  const summary = summarizeVoiceAttempts([
    { lineIndex: 0, ...scoreVoiceAttempt("가", "힣") },
    { lineIndex: 0, ...scoreVoiceAttempt("가", "가") },
    {
      lineIndex: 1,
      ...scoreVoiceAttempt("가", "힣"),
      quietlyPassed: true,
    },
    {
      lineIndex: 1,
      ...scoreVoiceAttempt("가", "힣"),
      quietlyPassed: true,
    },
  ]);

  assert.deepEqual(summary, {
    dialogueAccuracy: 50,
    pronunciationAccuracy: 50,
  });
});

test("입력 시도만 있으면 대사 정확도만 요약한다", () => {
  const summary = summarizeAttempts([
    { lineIndex: 0, ...scoreTextAttempt("가", "가") },
    { lineIndex: 1, ...scoreAttempt("나", "힣", "text") },
  ]);

  assert.deepEqual(summary, { dialogueAccuracy: 50 });
});

test("음성 시도만 있으면 대사와 발음 정확도를 요약한다", () => {
  const summary = summarizeAttempts([
    { lineIndex: 0, ...scoreVoiceAttempt("가", "가") },
    { lineIndex: 1, ...scoreVoiceAttempt("나", "힣") },
  ]);

  assert.deepEqual(summary, {
    dialogueAccuracy: 50,
    pronunciationAccuracy: 50,
  });
});

test("혼합 시도는 대사는 모두, 발음은 음성 출처만 줄별 최고값을 쓴다", () => {
  const summary = summarizeAttempts([
    { lineIndex: 0, ...scoreVoiceAttempt("가", "힣") },
    { lineIndex: 0, ...scoreTextAttempt("가", "가") },
    { lineIndex: 1, ...scoreVoiceAttempt("나", "나") },
  ]);

  assert.deepEqual(summary, {
    dialogueAccuracy: 100,
    pronunciationAccuracy: 50,
  });
});
