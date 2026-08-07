const CHOSEONG = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];
const JUNGSEONG = [
  "ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ",
  "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ",
];
const JONGSEONG = [
  "", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ",
  "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];
const DIGITS = ["영", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const PARTICLES = [
  "에서", "으로", "은", "는", "이", "가", "을", "를", "에", "로",
  "도", "만", "과", "와", "의",
];
const LOOSE_THRESHOLD = 0.72;
const EXACT_THRESHOLD = 0.95;

function numberToKorean(value) {
  if (value < 10) return DIGITS[value];

  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${tens === 1 ? "" : DIGITS[tens]}십${ones ? DIGITS[ones] : ""}`;
}

export function normalize(text) {
  return String(text ?? "")
    .replace(/\([^)]*\)|（[^）]*）/g, " ")
    .replace(/[.,!?…"'“”‘’「」『』\-–—~·]/g, "")
    .replace(/\d+/g, (digits) => {
      const value = Number(digits);
      return Number.isInteger(value) && value >= 0 && value <= 99
        ? numberToKorean(value)
        : digits;
    })
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function toJamo(text) {
  let result = "";

  for (const character of String(text ?? "")) {
    const codePoint = character.codePointAt(0);
    if (codePoint < 0xac00 || codePoint > 0xd7a3) {
      result += character;
      continue;
    }

    const offset = codePoint - 0xac00;
    const choseongIndex = Math.floor(offset / 588);
    const jungseongIndex = Math.floor((offset % 588) / 28);
    const jongseongIndex = offset % 28;
    result += CHOSEONG[choseongIndex];
    result += JUNGSEONG[jungseongIndex];
    result += JONGSEONG[jongseongIndex];
  }

  return result;
}

function levenshtein(left, right) {
  const a = [...left];
  const b = [...right];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let aIndex = 1; aIndex <= a.length; aIndex += 1) {
    const current = [aIndex];
    for (let bIndex = 1; bIndex <= b.length; bIndex += 1) {
      const substitution = previous[bIndex - 1] +
        (a[aIndex - 1] === b[bIndex - 1] ? 0 : 1);
      current[bIndex] = Math.min(
        previous[bIndex] + 1,
        current[bIndex - 1] + 1,
        substitution,
      );
    }
    previous = current;
  }

  return previous[b.length];
}

function usesExactMode(options) {
  const mode = options?.mode ?? options?.strictness;
  return options?.strict === true ||
    mode === "strict" ||
    mode === "exact" ||
    mode === "literal" ||
    mode === "글자 그대로";
}

function withoutParticle(word) {
  for (const particle of PARTICLES) {
    if (word.length > particle.length && word.endsWith(particle)) {
      return word.slice(0, -particle.length);
    }
  }
  return word;
}

function wordMatches(originalWord, spokenWord, looseMode) {
  const leftWord = looseMode ? withoutParticle(originalWord) : originalWord;
  const rightWord = looseMode ? withoutParticle(spokenWord) : spokenWord;
  const left = toJamo(leftWord);
  const right = toJamo(rightWord);
  const distance = levenshtein(left, right);
  return distance / Math.max(left.length, right.length, 1) <= 0.5;
}

function makeSegments(original, spoken, looseMode) {
  const originalWords = original.split(/\s+/).filter(Boolean);
  const spokenWords = spoken.split(/\s+/).filter(Boolean);
  const rows = originalWords.length + 1;
  const columns = spokenWords.length + 1;
  const lcs = Array.from({ length: rows }, () =>
    Array(columns).fill(0)
  );

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      lcs[row][column] = wordMatches(
        originalWords[row - 1],
        spokenWords[column - 1],
        looseMode,
      )
        ? lcs[row - 1][column - 1] + 1
        : Math.max(lcs[row - 1][column], lcs[row][column - 1]);
    }
  }

  const matchedOriginalIndexes = new Set();
  let row = originalWords.length;
  let column = spokenWords.length;
  while (row > 0 && column > 0) {
    if (
      wordMatches(
        originalWords[row - 1],
        spokenWords[column - 1],
        looseMode,
      ) &&
      lcs[row][column] === lcs[row - 1][column - 1] + 1
    ) {
      matchedOriginalIndexes.add(row - 1);
      row -= 1;
      column -= 1;
    } else if (lcs[row - 1][column] >= lcs[row][column - 1]) {
      row -= 1;
    } else {
      column -= 1;
    }
  }

  return originalWords.map((text, index) => ({
    text,
    matched: matchedOriginalIndexes.has(index),
  }));
}

export function compare(original, spoken, options = {}) {
  const normalizedOriginal = normalize(original);
  const normalizedSpoken = normalize(spoken);
  const exactMode = usesExactMode(options);
  const originalJamo = toJamo(normalizedOriginal.replace(/\s/g, ""));
  const spokenJamo = toJamo(normalizedSpoken.replace(/\s/g, ""));
  const distance = levenshtein(originalJamo, spokenJamo);
  const similarity = 1 -
    distance / Math.max(originalJamo.length, spokenJamo.length, 1);

  return {
    passed: originalJamo.length === 0 ||
      similarity >= (exactMode ? EXACT_THRESHOLD : LOOSE_THRESHOLD),
    segments: makeSegments(
      normalizedOriginal,
      normalizedSpoken,
      !exactMode,
    ),
  };
}
