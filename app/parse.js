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

function parseWithDelimiter(lines, delimiter) {
  const turns = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const match = line.match(delimiter);
    if (!match || match.index === undefined) continue;

    const turn = makeTurn(
      line.slice(0, match.index),
      line.slice(match.index + match[0].length),
    );
    if (turn) turns.push(turn);
  }

  return turns;
}

function parseWithNameLines(lines) {
  const nonEmptyLines = lines.map((line) => line.trim()).filter(Boolean);
  const candidateCounts = new Map();

  for (let index = 0; index < nonEmptyLines.length - 1; index += 1) {
    const role = nonEmptyLines[index];
    if (role.length > 12 || /[.!?…]$/.test(role)) continue;

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

  for (let index = 0; index < nonEmptyLines.length - 1; index += 1) {
    const role = nonEmptyLines[index];
    const text = nonEmptyLines[index + 1];
    if (!confirmedRoles.has(role)) continue;

    const turn = makeTurn(role, text);
    if (!turn) continue;

    turns.push(turn);
    index += 1;
  }

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

export function lastWord(text) {
  const cleaned = text.replace(/[.,!?…"'）)]+$/g, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}
