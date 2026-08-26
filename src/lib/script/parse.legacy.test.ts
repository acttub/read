import { describe, expect, it } from "vitest";
import { parseScript, parseScriptWithRoles } from "./legacy-shape";

/**
 * `main`(정적 사이트)의 대본 파서 테스트를 그대로 옮긴 것이다.
 *
 * 그 30건은 실사용에서 깨진 대본을 고치며 하나씩 붙은 것이라(필로우맨의 단일 공백 형식,
 * "전화벨이 울린다"의 등장인물 소개 오인식, PDF 행 복원 …) **이관이 회귀인지 아닌지를
 * 가르는 유일한 근거**다. 눈으로 비교하지 말고 이 파일을 통과시켜라.
 *
 * 2026-08-26 최초 실행 결과: 30건 중 17건 실패.
 * 새 파서에 탭 구분자가 없고, 두 칸 이상 공백 정렬을 못 잡고, 여러 줄 대사를 줄바꿈이
 * 아니라 공백으로 합치고, 등장인물 목록을 걷어내지 않는다.
 * 반대로 새 파서에만 있는 것(대괄호 배역·배역 힌트/제외·쪽 표시·제목)은 `parse.test.ts` 가 지킨다.
 * **두 파일이 같이 통과해야 이관이 끝난 것이다.**
 */

// 두 파서의 반환 모양이 다르다. 옛 모양으로 맞춰 주는 얇은 껍데기는 legacy-shape.ts 에 있다.
const expectEqual = (a: unknown, b: unknown) => expect(a).toEqual(b);
const expectTruthy = (a: unknown) => expect(a).toBeTruthy();

describe("main 의 대본 파서 테스트 (이관 게이트)", () => {


it("콜론 형식을 감지한다", () => {
  const result = parseScript([
    "건우: 지금 무슨 소릴 하는 거야.",
    "서연：네가 먼저 말했잖아.",
    "건우: 그게 같은 말이야?",
  ].join("\n"));

  expectEqual(result.roles, ["건우", "서연"]);
  expectEqual(result.turns[0], {
    role: "건우",
    text: "지금 무슨 소릴 하는 거야.",
    isDirection: false,
  });
});

it("탭 형식을 감지한다", () => {
  const result = parseScript([
    "건우\t지금 무슨 소릴 하는 거야.",
    "서연\t그게 무슨 뜻이야?",
    "건우\t말 그대로야.",
  ].join("\n"));

  expectEqual(result.roles, ["건우", "서연"]);
  expectEqual(result.turns[0].text, "지금 무슨 소릴 하는 거야.");
});

it("두 칸 이상 공백으로 정렬된 형식을 감지한다", () => {
  const result = parseScript([
    "건우  지금 무슨 소릴 하는 거야.",
    "서연　　그게 무슨 뜻이야?",
    "건우    말 그대로야.",
  ].join("\n"));

  expectEqual(result.roles, ["건우", "서연"]);
  expectEqual(result.turns.length, 3);
});

it("이름과 대사가 한 줄씩 나뉜 형식을 감지한다", () => {
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

  expectEqual(result.roles, ["건우", "서연"]);
  expectEqual(result.turns.map(({ role }) => role), [
    "건우",
    "서연",
    "건우",
    "서연",
  ]);
});

it("콜론 형식의 세 줄 대사를 줄바꿈으로 이어 붙인다", () => {
  const result = parseScript([
    "건우: 이 대사는 한 줄에서 끝나지 않고",
    "둘째 줄까지 이어진 다음",
    "셋째 줄에서 끝나.",
    "서연: 전부 들었어.",
    "건우: 다행이다.",
  ].join("\n"));

  expectEqual(
    result.turns[0].text,
    "이 대사는 한 줄에서 끝나지 않고\n둘째 줄까지 이어진 다음\n셋째 줄에서 끝나.",
  );
});

it("PDF에서 시각적으로 나뉜 공백 구분 대사를 복원한다", () => {
  const result = parseScript([
    "민수  PDF에서 복사한 문장이",
    "페이지 폭에 맞춰 여러 줄로",
    "쪼개져 있어도 하나의 대사야.",
    "영희  이제 빠지지 않겠네.",
    "민수  그래.",
  ].join("\n"));

  expectEqual(
    result.turns[0].text,
    "PDF에서 복사한 문장이\n페이지 폭에 맞춰 여러 줄로\n쪼개져 있어도 하나의 대사야.",
  );
});

it("탭 형식의 구분자 없는 줄을 직전 대사에 이어 붙인다", () => {
  const result = parseScript([
    "건우\t첫 줄이야.",
    "이 줄도 같은 대사야.",
    "서연\t알겠어.",
    "건우\t다음 대사야.",
  ].join("\n"));

  expectEqual(result.turns[0].text, "첫 줄이야.\n이 줄도 같은 대사야.");
});

it("이름 한 줄 형식의 연속 줄을 다음 배역 전까지 이어 붙인다", () => {
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

  expectEqual(
    result.turns[0].text,
    "첫 줄이야.\n둘째 줄도 같은 대사고\n셋째 줄에서 끝나.",
  );
});

it("배역 없는 독립 괄호 지문 줄은 연속 대사에서 제외한다", () => {
  const result = parseScript([
    "건우: 첫 줄이야.",
    "(잠시: 창밖을 본다)",
    "둘째 줄이야.",
    "서연: 알겠어.",
    "건우: 다음 대사야.",
  ].join("\n"));

  expectEqual(result.turns[0].text, "첫 줄이야.\n둘째 줄이야.");
});

it("첫 배역 턴 이전의 씬 헤딩은 무시한다", () => {
  const result = parseScript([
    "S#3. 카페 안",
    "건우: 먼저 도착했네.",
    "서연: 오래 기다렸어?",
    "건우: 아니, 방금 왔어.",
  ].join("\n"));

  expectEqual(result.turns[0].text, "먼저 도착했네.");
  expectEqual(result.turns.some(({ text }) => text.includes("S#3")), false);
});

it("이름 한 줄 형식에서 1회성 장면 표시를 배역으로 잡지 않는다", () => {
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

  expectEqual(result.roles, ["민수", "영희"]);
  expectEqual(result.roles.includes("밤"), false);
  expectTruthy(
    result.turns.some(
      ({ role, text }) =>
        role === "민수" && text === "왜 아무 말도 안 했어.",
    ),
  );
});

it("반복되는 장면 표시 뒤의 이름을 대사로 먹지 않는다", () => {
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

  expectEqual(result.roles, ["민수", "영희"]);
  expectEqual(result.roles.includes("1장"), false);
  expectEqual(
    result.turns
      .filter(({ role }) => role === "민수")
      .map(({ text }) => text),
    ["왜 아무 말도 안 했어.", "그건 네가 정할 일이 아니야."],
  );
});

it("반복되는 이름 없이 서술만 있는 입력은 거절한다", () => {
  const result = parseScript([
    "밤",
    "골목 끝 가로등 아래에 빗물이 고인다.",
    "잠시 후",
    "멀리서 헤드라이트가 천천히 다가온다.",
  ].join("\n"));

  expectEqual(result.roles, []);
  expectEqual(result.turns, []);
});

it("배역명보다 짧은 대답도 이름 한 줄 형식으로 잡는다", () => {
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

  expectEqual(result.roles, ["김영희", "박철수"]);
  expectEqual(
    result.turns.map(({ role, text }) => [role, text]),
    [
      ["김영희", "네"],
      ["김영희", "응"],
      ["박철수", "그래"],
      ["박철수", "알았어"],
    ],
  );
});

it("첫 턴 이전 서술은 무시하고 대사 사이 서술은 직전 턴에 잇는다", () => {
  const result = parseScript([
    "무대 중앙에 오래된 의자가 놓여 있다.",
    "건우: 지금 무슨 소릴 하는 거야.",
    "조명이 천천히 어두워진다.",
    "건우: 말 그대로야.",
  ].join("\n"));

  expectEqual(result.turns.length, 2);
  expectTruthy(result.turns.every(({ role }) => role === "건우"));
  expectEqual(
    result.turns[0].text,
    "지금 무슨 소릴 하는 거야.\n조명이 천천히 어두워진다.",
  );
});

it("반복 배역이 많은 탭을 채택하고 1회성 크레딧도 보존한다", () => {
  const result = parseScript([
    "작품: 밤의 저택",
    "연출\t한서린",
    "건우\t지금 무슨 소릴 하는 거야.",
    "서연\t그게 무슨 뜻이야?",
    "건우\t말 그대로야.",
    "서연\t그럴 리가 없어.",
  ].join("\n"));

  expectEqual(result.roles, ["연출", "건우", "서연"]);
  expectEqual(result.turns[0], {
    role: "연출",
    text: "한서린",
    isDirection: false,
  });
  expectEqual(result.turns.some(({ role }) => role === "작품"), false);
});

it("반복 배역 커버리지가 0이면 더 많은 쌍을 찾은 형식을 채택한다", () => {
  const result = parseScript([
    "제목: 햄릿",
    "햄릿\t사느냐 죽느냐.",
    "오필리어\t안녕하세요, 왕자님.",
  ].join("\n"));

  expectEqual(result.roles, ["햄릿", "오필리어"]);
  expectEqual(result.turns.some(({ role }) => role === "제목"), false);
});

it("반복 배역 커버리지가 양수로 같으면 쌍이 더 많은 형식을 채택한다", () => {
  const result = parseScript([
    "안내: 시작",
    "민수\t첫 번째 대사.",
    "안내: 끝",
    "민수\t두 번째 대사.",
    "연출\t홍길동",
  ].join("\n"));

  expectEqual(result.roles, ["민수", "연출"]);
  expectEqual(result.turns.length, 3);
  expectEqual(result.turns.some(({ role }) => role === "안내"), false);
});

it("긴 탭 대본에 콜론 줄 3개가 섞여도 탭 형식을 채택한다", () => {
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

  expectEqual(result.roles, ["민수", "영희"]);
  expectEqual(result.turns.length, 309);
  expectEqual(result.turns.some(({ role }) => role === "제목"), false);
});

it("괄호로 시작하는 대사를 지문으로 표시한다", () => {
  const result = parseScript([
    "건우: (고개를 돌린다)",
    "서연: 왜 그래?",
    "건우: 아무것도 아니야.",
  ].join("\n"));

  expectEqual(result.turns[0].isDirection, true);
  expectEqual(result.turns[1].isDirection, false);
});

it("직접 받은 배역 이름으로 여러 줄 대사를 다시 파싱한다", () => {
  const result = parseScriptWithRoles([
    "건우 왜 아무 말도 안 했어.",
    "정말 몰랐던 거야?",
    "서연：말하면 네가 떠날 것 같았어.",
    "건우\t그건 네가 정할 일이 아니야.",
  ].join("\n"), ["건우", "서연"]);

  expectEqual(result.roles, ["건우", "서연"]);
  expectEqual(result.turns.map(({ role, text }) => [role, text]), [
    ["건우", "왜 아무 말도 안 했어.\n정말 몰랐던 거야?"],
    ["서연", "말하면 네가 떠날 것 같았어."],
    ["건우", "그건 네가 정할 일이 아니야."],
  ]);
});

it("직접 받은 이름이 실제 대사와 연결되지 않으면 배역을 만들지 않는다", () => {
  const result = parseScriptWithRoles("장면 설명만 있는 대본", ["건우"]);
  expectEqual(result, { turns: [], roles: [] });
});

it("배역 이름으로 시작할 뿐인 대사 줄을 배역 줄로 자르지 않는다", () => {
  const result = parseScriptWithRoles([
    "건우: 서연이 어디 갔어?",
    "서연: 나 여기 있어.",
    "건우: 서연은 아직 안 왔다고 들었는데.",
    "서연이가 그렇게 말했어?",
  ].join("\n"), ["건우", "서연"]);

  expectEqual(result.turns.map(({ role, text }) => [role, text]), [
    ["건우", "서연이 어디 갔어?"],
    ["서연", "나 여기 있어."],
    ["건우", "서연은 아직 안 왔다고 들었는데.\n서연이가 그렇게 말했어?"],
  ]);
});

it("단일 공백 형식은 첫 어절이 3회 이상 반복되는 이름만 배역으로 확정한다", () => {
  const script = [
    "등장인물",
    "카투리안 - 이은서",
    "투폴스키 - 김가하",
    "1막 1장",
    "경찰 취조실. 테이블이 놓여 있다.",
    "투폴스키 카투리안씨, 이쪽은 아리엘 형사요. 누가 이렇게",
    "씌워 놓고 간 거요?",
    "카투리안 뭘 말입니까?",
    "투폴스키가 눈가리개를 벗긴다.",
    "투폴스키 누가 씌워 놓고 갔냐고요?",
    "카투리안 어, 어떤 남자가요.",
    "투폴스키 왜 안 풀었어요?",
    "카투리안 그게, 무서웠어요.",
  ].join("\n");

  const { roles, turns } = parseScript(script);

  expectEqual(roles, ["투폴스키", "카투리안"]);
  expectEqual(turns.length, 6);
  expectEqual(
    turns[0].text,
    "카투리안씨, 이쪽은 아리엘 형사요. 누가 이렇게\n씌워 놓고 간 거요?",
  );
  expectEqual(
    turns[1].text,
    "뭘 말입니까?\n투폴스키가 눈가리개를 벗긴다.",
  );
});

it("접두 관계의 실제 배역 쌍은 살리고 조사 확장형만 지운다", () => {
  const lines = [];
  for (let i = 0; i < 4; i += 1) {
    lines.push(`왕 ${i}번째 명이다.`);
    lines.push(`왕비 ${i}번째 답이다.`);
  }
  lines.push("왕이 옥좌에서 일어난다.");
  const { roles } = parseScript(lines.join("\n"));

  expectEqual(roles, ["왕", "왕비"]);
});

it("본문 중간의 캐스트 목록 줄은 대사에 붙이지 않고 건너뛴다", () => {
  const lines = [];
  for (let i = 0; i < 3; i += 1) {
    lines.push(`민수 ${i}번째 대사다.`);
    lines.push(`영지 ${i}번째 답이다.`);
  }
  lines.push("민수 - 김배우");
  const { turns } = parseScript(lines.join("\n"));

  expectEqual(turns.length, 6);
  expectTruthy(turns.every((turn) => !turn.text.includes("김배우")));
});

it("콜론 대본은 연속 줄 첫 어절이 반복돼도 콜론 해석을 유지한다", () => {
  const lines = [];
  for (let i = 0; i < 4; i += 1) {
    lines.push(`지우: ${i}번째 대사인데 말이 길어서`);
    lines.push("하지만 다음 줄로 이어진다.");
    lines.push(`민준: ${i}번째 답.`);
  }
  const { roles, turns } = parseScript(lines.join("\n"));

  expectEqual(roles, ["지우", "민준"]);
  expectEqual(turns.length, 8);
  expect(turns[0].text).toMatch(/하지만 다음 줄로 이어진다/);
});

it("등장인물·무대 소개 구간은 장 표시 전까지 걷어내고 본문만 파싱한다", () => {
  const lines = [
    "전화벨이 울린다",
    "이연주 作",
    "등장인물",
    "김수진  콜센터 상담원",
    "박민규  연극배우",
    "무대",
    "주 무대는 콜센터와 고시원이다.",
    "1장",
  ];
  for (let i = 0; i < 3; i += 1) {
    lines.push(`수진  ${i}번째 대사예요.`);
    lines.push(`민규  ${i}번째 답이에요.`);
  }
  const { roles, turns } = parseScript(lines.join("\n"));

  expectEqual(roles, ["수진", "민규"]);
  expectEqual(turns.length, 6);
  expectTruthy(turns.every((turn) => !turn.text.includes("상담원")));
});

it("헤더 뒤에 막·장 표시가 없으면 아무것도 걷어내지 않는다", () => {
  const lines = ["등장인물"];
  for (let i = 0; i < 3; i += 1) {
    lines.push(`수진: ${i}번째 대사.`);
    lines.push(`민규: ${i}번째 답.`);
  }
  const { roles, turns } = parseScript(lines.join("\n"));

  expectEqual(roles, ["수진", "민규"]);
  expectEqual(turns.length, 6);
});

it("본문 중간의 '무대' 한 줄은 소개 구간으로 오인하지 않는다", () => {
  const lines = [];
  for (let i = 0; i < 30; i += 1) {
    lines.push(`수진: ${i}번째 대사.`);
    lines.push(`민규: ${i}번째 답.`);
  }
  lines.push("무대");
  for (let i = 30; i < 33; i += 1) {
    lines.push(`수진: ${i}번째 대사.`);
    lines.push(`민규: ${i}번째 답.`);
  }
  const { turns } = parseScript(lines.join("\n"));

  expectEqual(turns.length, 66);
});
});
