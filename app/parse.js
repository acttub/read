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
  // 동점 우선순위: 콜론 > 탭 > 공백 > 이름 한 줄.
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
