const DELIMITER_CANDIDATES = [
  /[:：]/,
  /\t+/,
  /[ 　]{2,}/,
];

function makeTurn(roleText, dialogueText) {
  const role = roleText.trim();
  const text = dialogueText.trim();

  if (!role || !text || role.length > 12 || /[.!?]$/.test(role)) {
    return null;
  }

  return {
    role,
    text,
    isDirection: text.startsWith("("),
  };
}

function isStandaloneDirection(line) {
  return line.startsWith("(") && line.endsWith(")");
}

function appendContinuation(turn, line) {
  if (!turn || isStandaloneDirection(line)) return;
  turn.text = turn.text ? `${turn.text}\n${line}` : line;
}

function parseWithDelimiter(lines, delimiter) {
  const turns = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (isStandaloneDirection(line)) continue;

    const match = line.match(delimiter);
    const turn = match && match.index !== undefined
      ? makeTurn(
        line.slice(0, match.index),
        line.slice(match.index + match[0].length),
      )
      : null;
    if (turn) {
      turns.push(turn);
      continue;
    }

    appendContinuation(turns[turns.length - 1], line);
  }

  return turns;
}

function parseWithNameLines(lines) {
  const nonEmptyLines = lines.map((line) => line.trim()).filter(Boolean);
  const candidateCounts = new Map();

  for (let index = 0; index < nonEmptyLines.length - 1; index += 1) {
    const role = nonEmptyLines[index];
    if (
      isStandaloneDirection(role) ||
      role.length > 12 ||
      /[.!?…]$/.test(role)
    ) continue;

    candidateCounts.set(role, (candidateCounts.get(role) || 0) + 1);
  }

  const nameCandidates = new Set(
    [...candidateCounts]
      .filter(([, count]) => count >= 2)
      .map(([role]) => role),
  );
  const roleCounts = new Map();

  for (let index = 0; index < nonEmptyLines.length - 1; index += 1) {
    const role = nonEmptyLines[index];
    const nextLine = nonEmptyLines[index + 1];
    if (!nameCandidates.has(role) || nameCandidates.has(nextLine)) continue;

    roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
  }

  // 구분자 없는 형식은 서술문과 구별하기 위해 2회 이상 말하는 배역만 확정한다.
  const confirmedRoles = new Set(
    [...roleCounts]
      .filter(([, count]) => count >= 2)
      .map(([role]) => role),
  );
  const turns = [];
  let current = null;

  function finishCurrent() {
    if (!current) return;
    const turn = makeTurn(current.role, current.text);
    if (turn) turns.push(turn);
    current = null;
  }

  for (const line of nonEmptyLines) {
    if (isStandaloneDirection(line)) continue;
    if (confirmedRoles.has(line)) {
      finishCurrent();
      current = { role: line, text: "" };
      continue;
    }

    appendContinuation(current, line);
  }
  finishCurrent();

  return turns;
}

const PARTICLE_SUFFIXES = new Set([
  "이", "가", "은", "는", "을", "를", "의", "도", "와", "과", "께서", "에게",
]);

// "이름 대사" 단일 공백 형식(필로우맨류 조판). 한 칸 공백은 일반 문장과 구분이
// 안 되므로, 줄 첫 어절이 문서 전체에서 3회 이상 반복될 때만 배역으로 확정한다.
// 조사가 붙는 서술문("투폴스키가 …")은 첫 어절이 달라져 배역과 충돌하지 않는다.
function parseWithLeadingNames(lines) {
  const nonEmptyLines = lines.map((line) => line.trim()).filter(Boolean);
  const counts = new Map();

  for (const line of nonEmptyLines) {
    const spaceIndex = line.search(/\s/);
    if (spaceIndex <= 0) continue;
    const first = line.slice(0, spaceIndex);
    if (first.length > 12 || first.startsWith("(") || /[.!?…:：,]$/.test(first)) {
      continue;
    }
    counts.set(first, (counts.get(first) || 0) + 1);
  }

  // 긴 대본에서는 줄바꿈 조각의 첫 어절도 3회쯤 우연히 반복된다. 최다 화자
  // 대비 10% 미만은 버리고, 다른 확정 후보에 조사만 붙은 확장형("투폴스키가")은
  // 배역이 아니라 서술문으로 본다. 조사 목록으로만 지워 왕/왕비 같은
  // 접두 관계의 실제 배역 쌍은 살린다.
  let maxCount = 0;
  for (const count of counts.values()) {
    if (count > maxCount) maxCount = count;
  }
  const floor = Math.max(3, Math.ceil(maxCount * 0.1));
  const strongNames = [...counts].filter(([name, count]) =>
    count >= floor &&
    ![...counts].some(([other, otherCount]) =>
      other !== name &&
      otherCount >= count &&
      name.startsWith(other) &&
      PARTICLE_SUFFIXES.has(name.slice(other.length))
    ),
  );
  const confirmedRoles = new Set(strongNames.map(([name]) => name));
  const turns = [];
  let current = null;

  function finishCurrent() {
    if (!current) return;
    const turn = makeTurn(current.role, current.text);
    if (turn) turns.push(turn);
    current = null;
  }

  for (const line of nonEmptyLines) {
    if (isStandaloneDirection(line)) continue;
    const spaceIndex = line.search(/\s/);
    const first = spaceIndex > 0 ? line.slice(0, spaceIndex) : line;
    const rest = spaceIndex > 0 ? line.slice(spaceIndex + 1).trim() : "";

    // "이름 - 배우" 캐스트 목록 줄은 대사도, 직전 대사의 연속도 아니다.
    if (confirmedRoles.has(first) && rest && /^[-–—]/.test(rest)) continue;
    if (confirmedRoles.has(first) && rest) {
      finishCurrent();
      current = { role: first, text: rest };
      continue;
    }
    if (confirmedRoles.has(line)) {
      finishCurrent();
      current = { role: line, text: "" };
      continue;
    }

    appendContinuation(current, line);
  }
  finishCurrent();

  return turns;
}

function repeatedRoleCoverage(turns) {
  const counts = new Map();
  for (const turn of turns) {
    counts.set(turn.role, (counts.get(turn.role) || 0) + 1);
  }

  return turns.reduce(
    (covered, turn) => covered + (counts.get(turn.role) >= 2 ? 1 : 0),
    0,
  );
}

export function parseScript(text) {
  const lines = text.split("\n");
  const candidates = [
    ...DELIMITER_CANDIDATES.map((delimiter) =>
      parseWithDelimiter(lines, delimiter),
    ),
    parseWithNameLines(lines),
  ];

  let selectedTurns = [];
  let selectedCoverage = -1;

  // 커버리지가 같으면 쌍 수를 비교하고, 그마저 같으면 배열 순서를 따른다.
  // 동점 우선순위: 콜론 > 탭 > 공백 > 이름 한 줄 > 선행 이름(단일 공백).
  for (const turns of candidates) {
    if (turns.length === 0) continue;
    const coverage = repeatedRoleCoverage(turns);
    const hasMorePairsAtSameCoverage =
      coverage === selectedCoverage && turns.length > selectedTurns.length;

    if (coverage > selectedCoverage || hasMorePairsAtSameCoverage) {
      selectedTurns = turns;
      selectedCoverage = coverage;
    }
  }

  // 단일 공백 휴리스틱은 명시적 구분자가 사실상 실패했을 때만 후보에 넣는다 —
  // 구분자 형식의 연속 줄 첫 어절("하지만"×3)이 배역으로 둔갑해 정상 해석을
  // 뒤집는 것을 막는다(Codex 리뷰 P2 반영).
  if (selectedCoverage < 3) {
    const leadingTurns = parseWithLeadingNames(lines);
    if (leadingTurns.length > 0) {
      const coverage = repeatedRoleCoverage(leadingTurns);
      if (
        coverage > selectedCoverage ||
        (coverage === selectedCoverage && leadingTurns.length > selectedTurns.length)
      ) {
        selectedTurns = leadingTurns;
        selectedCoverage = coverage;
      }
    }
  }

  const roles = [];
  for (const turn of selectedTurns) {
    if (!roles.includes(turn.role)) roles.push(turn.role);
  }

  return { turns: selectedTurns, roles };
}

export function parseScriptWithRoles(text, roleNames) {
  const names = [...new Set(
    roleNames.map((name) => String(name).trim()).filter(Boolean),
  )];
  const matchOrder = [...names].sort((left, right) => right.length - left.length);
  const turns = [];
  let current = null;

  function finishCurrent() {
    if (!current) return;
    const turn = makeTurn(current.role, current.text);
    if (turn) turns.push(turn);
    current = null;
  }

  for (const rawLine of String(text ?? "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    // 이름 뒤에 글자가 바로 붙으면 배역 줄이 아니라 대사 줄이다 — 배역이 "영희"일 때
    // "영희는 아직 안 왔어"를 잘라내면 대사에서 "영희"가 사라진다.
    const role = matchOrder.find((name) => {
      if (!line.startsWith(name)) return false;
      const rest = line.slice(name.length);
      return rest === "" || /^[\s:：]/.test(rest);
    });
    if (role) {
      finishCurrent();
      current = {
        role,
        text: line.slice(role.length).replace(/^[\s:：]+/, ""),
      };
      continue;
    }

    if (current) {
      current.text = current.text ? `${current.text}\n${line}` : line;
    }
  }
  finishCurrent();

  const roles = [];
  for (const turn of turns) {
    if (!roles.includes(turn.role)) roles.push(turn.role);
  }
  return { turns, roles };
}

export function lastWord(text) {
  const cleaned = text.replace(/[.,!?…"'）)]+$/g, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}
