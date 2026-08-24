import assert from "node:assert/strict";
import test from "node:test";

import { parseScript, parseScriptWithRoles } from "../app/parse.js";

test("콜론 형식을 감지한다", () => {
  const result = parseScript([
    "건우: 지금 무슨 소릴 하는 거야.",
    "서연：네가 먼저 말했잖아.",
    "건우: 그게 같은 말이야?",
  ].join("\n"));

  assert.deepEqual(result.roles, ["건우", "서연"]);
  assert.deepEqual(result.turns[0], {
    role: "건우",
    text: "지금 무슨 소릴 하는 거야.",
    isDirection: false,
  });
});

test("탭 형식을 감지한다", () => {
  const result = parseScript([
    "건우\t지금 무슨 소릴 하는 거야.",
    "서연\t그게 무슨 뜻이야?",
    "건우\t말 그대로야.",
  ].join("\n"));

  assert.deepEqual(result.roles, ["건우", "서연"]);
  assert.equal(result.turns[0].text, "지금 무슨 소릴 하는 거야.");
});

test("두 칸 이상 공백으로 정렬된 형식을 감지한다", () => {
  const result = parseScript([
    "건우  지금 무슨 소릴 하는 거야.",
    "서연　　그게 무슨 뜻이야?",
    "건우    말 그대로야.",
  ].join("\n"));

  assert.deepEqual(result.roles, ["건우", "서연"]);
  assert.equal(result.turns.length, 3);
});

test("이름과 대사가 한 줄씩 나뉜 형식을 감지한다", () => {
  const result = parseScript([
    "건우",
    "지금 무슨 소릴 하는 거야.",
    "서연",
    "그게 무슨 뜻이야?",
    "건우",
    "말 그대로 받아들이면 되는 이야기야.",
    "서연",
    "알겠어.",
  ].join("\n"));

  assert.deepEqual(result.roles, ["건우", "서연"]);
  assert.deepEqual(result.turns.map(({ role }) => role), [
    "건우",
    "서연",
    "건우",
    "서연",
  ]);
});

test("콜론 형식의 세 줄 대사를 줄바꿈으로 이어 붙인다", () => {
  const result = parseScript([
    "건우: 이 대사는 한 줄에서 끝나지 않고",
    "둘째 줄까지 이어진 다음",
    "셋째 줄에서 끝나.",
    "서연: 전부 들었어.",
    "건우: 다행이다.",
  ].join("\n"));

  assert.equal(
    result.turns[0].text,
    "이 대사는 한 줄에서 끝나지 않고\n둘째 줄까지 이어진 다음\n셋째 줄에서 끝나.",
  );
});

test("PDF에서 시각적으로 나뉜 공백 구분 대사를 복원한다", () => {
  const result = parseScript([
    "민수  PDF에서 복사한 문장이",
    "페이지 폭에 맞춰 여러 줄로",
    "쪼개져 있어도 하나의 대사야.",
    "영희  이제 빠지지 않겠네.",
    "민수  그래.",
  ].join("\n"));

  assert.equal(
    result.turns[0].text,
    "PDF에서 복사한 문장이\n페이지 폭에 맞춰 여러 줄로\n쪼개져 있어도 하나의 대사야.",
  );
});

test("탭 형식의 구분자 없는 줄을 직전 대사에 이어 붙인다", () => {
  const result = parseScript([
    "건우\t첫 줄이야.",
    "이 줄도 같은 대사야.",
    "서연\t알겠어.",
    "건우\t다음 대사야.",
  ].join("\n"));

  assert.equal(result.turns[0].text, "첫 줄이야.\n이 줄도 같은 대사야.");
});

test("이름 한 줄 형식의 연속 줄을 다음 배역 전까지 이어 붙인다", () => {
  const result = parseScript([
    "건우",
    "첫 줄이야.",
    "(숨을 고른다)",
    "둘째 줄도 같은 대사고",
    "셋째 줄에서 끝나.",
    "서연",
    "알겠어.",
    "건우",
    "다음 대사야.",
    "서연",
    "응.",
  ].join("\n"));

  assert.equal(
    result.turns[0].text,
    "첫 줄이야.\n둘째 줄도 같은 대사고\n셋째 줄에서 끝나.",
  );
});

test("배역 없는 독립 괄호 지문 줄은 연속 대사에서 제외한다", () => {
  const result = parseScript([
    "건우: 첫 줄이야.",
    "(잠시: 창밖을 본다)",
    "둘째 줄이야.",
    "서연: 알겠어.",
    "건우: 다음 대사야.",
  ].join("\n"));

  assert.equal(result.turns[0].text, "첫 줄이야.\n둘째 줄이야.");
});

test("첫 배역 턴 이전의 씬 헤딩은 무시한다", () => {
  const result = parseScript([
    "S#3. 카페 안",
    "건우: 먼저 도착했네.",
    "서연: 오래 기다렸어?",
    "건우: 아니, 방금 왔어.",
  ].join("\n"));

  assert.equal(result.turns[0].text, "먼저 도착했네.");
  assert.equal(result.turns.some(({ text }) => text.includes("S#3")), false);
});

test("이름 한 줄 형식에서 1회성 장면 표시를 배역으로 잡지 않는다", () => {
  const result = parseScript([
    "밤",
    "민수",
    "왜 아무 말도 안 했어.",
    "영희",
    "말하면 네가 떠날 것 같았어.",
    "민수",
    "그건 네가 정할 일이 아니야.",
    "영희",
    "알아.",
  ].join("\n"));

  assert.deepEqual(result.roles, ["민수", "영희"]);
  assert.equal(result.roles.includes("밤"), false);
  assert.ok(
    result.turns.some(
      ({ role, text }) =>
        role === "민수" && text === "왜 아무 말도 안 했어.",
    ),
  );
});

test("반복되는 장면 표시 뒤의 이름을 대사로 먹지 않는다", () => {
  const result = parseScript([
    "1장",
    "민수",
    "왜 아무 말도 안 했어.",
    "영희",
    "응.",
    "1장",
    "민수",
    "그건 네가 정할 일이 아니야.",
    "영희",
    "그래.",
  ].join("\n"));

  assert.deepEqual(result.roles, ["민수", "영희"]);
  assert.equal(result.roles.includes("1장"), false);
  assert.deepEqual(
    result.turns
      .filter(({ role }) => role === "민수")
      .map(({ text }) => text),
    ["왜 아무 말도 안 했어.", "그건 네가 정할 일이 아니야."],
  );
});

test("반복되는 이름 없이 서술만 있는 입력은 거절한다", () => {
  const result = parseScript([
    "밤",
    "골목 끝 가로등 아래에 빗물이 고인다.",
    "잠시 후",
    "멀리서 헤드라이트가 천천히 다가온다.",
  ].join("\n"));

  assert.deepEqual(result.roles, []);
  assert.deepEqual(result.turns, []);
});

test("배역명보다 짧은 대답도 이름 한 줄 형식으로 잡는다", () => {
  const result = parseScript([
    "김영희",
    "네",
    "김영희",
    "응",
    "박철수",
    "그래",
    "박철수",
    "알았어",
  ].join("\n"));

  assert.deepEqual(result.roles, ["김영희", "박철수"]);
  assert.deepEqual(
    result.turns.map(({ role, text }) => [role, text]),
    [
      ["김영희", "네"],
      ["김영희", "응"],
      ["박철수", "그래"],
      ["박철수", "알았어"],
    ],
  );
});

test("첫 턴 이전 서술은 무시하고 대사 사이 서술은 직전 턴에 잇는다", () => {
  const result = parseScript([
    "무대 중앙에 오래된 의자가 놓여 있다.",
    "건우: 지금 무슨 소릴 하는 거야.",
    "조명이 천천히 어두워진다.",
    "건우: 말 그대로야.",
  ].join("\n"));

  assert.equal(result.turns.length, 2);
  assert.ok(result.turns.every(({ role }) => role === "건우"));
  assert.equal(
    result.turns[0].text,
    "지금 무슨 소릴 하는 거야.\n조명이 천천히 어두워진다.",
  );
});

test("반복 배역이 많은 탭을 채택하고 1회성 크레딧도 보존한다", () => {
  const result = parseScript([
    "작품: 밤의 저택",
    "연출\t한서린",
    "건우\t지금 무슨 소릴 하는 거야.",
    "서연\t그게 무슨 뜻이야?",
    "건우\t말 그대로야.",
    "서연\t그럴 리가 없어.",
  ].join("\n"));

  assert.deepEqual(result.roles, ["연출", "건우", "서연"]);
  assert.deepEqual(result.turns[0], {
    role: "연출",
    text: "한서린",
    isDirection: false,
  });
  assert.equal(result.turns.some(({ role }) => role === "작품"), false);
});

test("반복 배역 커버리지가 0이면 더 많은 쌍을 찾은 형식을 채택한다", () => {
  const result = parseScript([
    "제목: 햄릿",
    "햄릿\t사느냐 죽느냐.",
    "오필리어\t안녕하세요, 왕자님.",
  ].join("\n"));

  assert.deepEqual(result.roles, ["햄릿", "오필리어"]);
  assert.equal(result.turns.some(({ role }) => role === "제목"), false);
});

test("반복 배역 커버리지가 양수로 같으면 쌍이 더 많은 형식을 채택한다", () => {
  const result = parseScript([
    "안내: 시작",
    "민수\t첫 번째 대사.",
    "안내: 끝",
    "민수\t두 번째 대사.",
    "연출\t홍길동",
  ].join("\n"));

  assert.deepEqual(result.roles, ["민수", "연출"]);
  assert.equal(result.turns.length, 3);
  assert.equal(result.turns.some(({ role }) => role === "안내"), false);
});

test("긴 탭 대본에 콜론 줄 3개가 섞여도 탭 형식을 채택한다", () => {
  const tabLines = Array.from({ length: 309 }, (_, index) => {
    const role = index % 2 === 0 ? "민수" : "영희";
    return `${role}\t${index + 1}번째 대사.`;
  });
  const result = parseScript([
    "제목: 긴 공연",
    ...tabLines.slice(0, 103),
    "장소: 극장",
    ...tabLines.slice(103, 206),
    "시간: 밤",
    ...tabLines.slice(206),
  ].join("\n"));

  assert.deepEqual(result.roles, ["민수", "영희"]);
  assert.equal(result.turns.length, 309);
  assert.equal(result.turns.some(({ role }) => role === "제목"), false);
});

test("괄호로 시작하는 대사를 지문으로 표시한다", () => {
  const result = parseScript([
    "건우: (고개를 돌린다)",
    "서연: 왜 그래?",
    "건우: 아무것도 아니야.",
  ].join("\n"));

  assert.equal(result.turns[0].isDirection, true);
  assert.equal(result.turns[1].isDirection, false);
});

test("직접 받은 배역 이름으로 여러 줄 대사를 다시 파싱한다", () => {
  const result = parseScriptWithRoles([
    "건우 왜 아무 말도 안 했어.",
    "정말 몰랐던 거야?",
    "서연：말하면 네가 떠날 것 같았어.",
    "건우\t그건 네가 정할 일이 아니야.",
  ].join("\n"), ["건우", "서연"]);

  assert.deepEqual(result.roles, ["건우", "서연"]);
  assert.deepEqual(result.turns.map(({ role, text }) => [role, text]), [
    ["건우", "왜 아무 말도 안 했어.\n정말 몰랐던 거야?"],
    ["서연", "말하면 네가 떠날 것 같았어."],
    ["건우", "그건 네가 정할 일이 아니야."],
  ]);
});

test("직접 받은 이름이 실제 대사와 연결되지 않으면 배역을 만들지 않는다", () => {
  const result = parseScriptWithRoles("장면 설명만 있는 대본", ["건우"]);
  assert.deepEqual(result, { turns: [], roles: [] });
});

test("배역 이름으로 시작할 뿐인 대사 줄을 배역 줄로 자르지 않는다", () => {
  const result = parseScriptWithRoles([
    "건우: 서연이 어디 갔어?",
    "서연: 나 여기 있어.",
    "건우: 서연은 아직 안 왔다고 들었는데.",
    "서연이가 그렇게 말했어?",
  ].join("\n"), ["건우", "서연"]);

  assert.deepEqual(result.turns.map(({ role, text }) => [role, text]), [
    ["건우", "서연이 어디 갔어?"],
    ["서연", "나 여기 있어."],
    ["건우", "서연은 아직 안 왔다고 들었는데.\n서연이가 그렇게 말했어?"],
  ]);
});
