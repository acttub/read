/**
 * 대본 텍스트 → 배역·대사 구조.
 *
 * 지원 형식
 *  - 콜론:   `지수: 대사` (전각 콜론 `：`·`지수 : 대사`도 받음)
 *  - 탭:     `지수<TAB>대사`
 *  - 정렬:   `지수  대사` (두 칸 이상·전각 공백)
 *  - 블록:   `지수` 한 줄 + 다음 줄부터 다음 배역 전까지 대사
 *  - 공백:   `강호 대사` (한국 연극 대본식 — 명시적 구분자가 없을 때만)
 *  - 지문:   `(…)`·`[…]`로 감싼 한 줄, `이름, 행동` 꼴
 *
 * 형식은 문서 전체에서 반복 배역을 가장 많이 설명하는 후보를 고른다. 그래야 탭 대본의
 * `제목: …` 같은 메타데이터나 콜론 대본의 연속 줄 첫 어절이 배역으로 둔갑하지 않는다.
 */

export type DialogueLine = { type: "dialogue"; role: string; text: string };
export type DirectionLine = { type: "direction"; text: string };
export type ScriptLine = DialogueLine | DirectionLine;

export interface ParsedScript {
  title: string | undefined;
  roles: string[];
  lines: ScriptLine[];
}

export interface ParseOptions {
  /** 배역으로 취급할 이름. 본문에 한 번이라도 나와야 채택된다. */
  roleHints?: string[];
  /** true면 힌트에 있는 이름만 배역으로 쓴다. */
  onlyHints?: boolean;
  /** 사람이 직접 배역에서 뺀 이름. 그 이름의 줄은 지문으로 내려간다. */
  excludeRoles?: string[];
}

/** 배역별로 대사가 몇 줄인지 — 많이 말하는 순으로 보여 주기 위해 쓴다. */
export function countLinesByRole(lines: ScriptLine[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    if (line.type !== "dialogue") continue;
    counts.set(line.role, (counts.get(line.role) ?? 0) + 1);
  }
  return counts;
}

const NAME_RE = /^[가-힣A-Za-z0-9·]{1,6}$/;
const BRACKET_ROLE_RE = /^[[［【]\s*([가-힣A-Za-z0-9·]{1,6})\s*[\]］】]\s*(.+)$/;
const PAGE_MARK_RE = /^(?:[-–—]\s*\d+\s*[-–—]|[[［【]?\s*(?:페이지|쪽|면)\s*[\]］】]?\s*\S{0,6})$/;
const STRUCTURE_WORDS = new Set(["장", "막", "씬", "신", "화"]);
const MARKUP_INDEX_RE = /<<\d*>>/g;
const MARKUP_WRAP_RE = /<<([^>]*)>>/g;
const WRAPPED_DIRECTION_RE = /^[(\[（【].*[)\]）】]$/;
const NAME_COMMA_DIRECTION_RE = /^[가-힣A-Za-z0-9·]{1,6},\s*\S/;
const PARTICLE_SUFFIXES = new Set(["이", "가", "은", "는", "을", "를", "의", "도", "와", "과", "께서", "에게"]);
const HEADER_SECTION_RE = /^(?:등장\s?인물|나오는\s?사람들|만드는\s?사람들|배역|스태프|무대|때와\s?곳)$/;
const SCENE_MARKER_RE = /^(?:제?\s?\d+\s?(?:막|장|씬)|프롤로그|에필로그|서막|S#|#\s?\d)/i;
const HEADER_PREAMBLE_LIMIT = 50;
const HEADER_SKIP_CAP = 60;

type FormatKind = "colon" | "tab" | "aligned" | "bracket" | "solo" | "space";
type Head = { name: string; text: string };

interface FormatCandidate {
  kind: FormatKind;
  heads: Array<Head | null>;
  roles: string[];
  coverage: number;
  pairs: number;
}

function cleanInline(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalize(raw: string): string[] {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(MARKUP_INDEX_RE, "").replace(MARKUP_WRAP_RE, "$1").trim())
    .map((line) => (PAGE_MARK_RE.test(line) ? "" : line));
}

function isWrappedDirection(line: string): boolean {
  return WRAPPED_DIRECTION_RE.test(line);
}

function stripWrap(line: string): string {
  return line.replace(/^[(\[（【]\s*/, "").replace(/\s*[)\]）】]$/, "");
}

function splitBracket(line: string): Head | null {
  const match = BRACKET_ROLE_RE.exec(line);
  if (!match) return null;
  const name = match[1];
  if (STRUCTURE_WORDS.has(name) || /^\d+$/.test(name)) return null;
  return { name, text: cleanInline(match[2]) };
}

function isStructureMark(line: string): boolean {
  const match = BRACKET_ROLE_RE.exec(line);
  return match !== null && STRUCTURE_WORDS.has(match[1]);
}

function isSceneMarker(line: string): boolean {
  return SCENE_MARKER_RE.test(cleanInline(line));
}

function splitDelimited(line: string, kind: Exclude<FormatKind, "solo" | "space">): Head | null {
  if (kind === "bracket") return splitBracket(line);

  const delimiter = kind === "colon" ? /[:：]/ : kind === "tab" ? /\t+/ : /[ 　]{2,}/;
  const match = delimiter.exec(line);
  if (!match || match.index <= 0) return null;

  const name = line.slice(0, match.index).trim();
  const text = cleanInline(line.slice(match.index + match[0].length));
  if (!NAME_RE.test(name) || !text) return null;
  return { name, text };
}

function splitSpace(line: string): Head | null {
  const match = /[\t 　]+/.exec(line);
  if (!match || match.index <= 0) return null;
  const name = line.slice(0, match.index);
  const text = cleanInline(line.slice(match.index + match[0].length));
  if (!NAME_RE.test(name) || !text) return null;
  return { name, text };
}

function stripHeaderSections(lines: string[]): string[] {
  const kept: string[] = [];
  let keptNonEmpty = 0;
  let buffered: { raw: string[]; nonEmpty: number } | null = null;

  const restore = () => {
    if (!buffered) return;
    kept.push(...buffered.raw);
    buffered = null;
  };

  for (const raw of lines) {
    const line = cleanInline(raw);
    if (buffered) {
      if (isSceneMarker(line)) {
        buffered = null;
        kept.push(raw);
        keptNonEmpty += 1;
        continue;
      }
      buffered.raw.push(raw);
      if (line) buffered.nonEmpty += 1;
      if (buffered.nonEmpty > HEADER_SKIP_CAP) restore();
      continue;
    }

    if (HEADER_SECTION_RE.test(line) && keptNonEmpty < HEADER_PREAMBLE_LIMIT) {
      buffered = { raw: [raw], nonEmpty: 0 };
      continue;
    }

    kept.push(raw);
    if (line) keptNonEmpty += 1;
  }
  restore();
  return kept;
}

class Counter {
  private readonly counts = new Map<string, number>();

  add(name: string) {
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
  }

  countOf(name: string): number {
    return this.counts.get(name) ?? 0;
  }

  names(): string[] {
    return [...this.counts.keys()];
  }

  atLeast(count: number): string[] {
    return [...this.counts].filter(([, value]) => value >= count).map(([name]) => name);
  }
}

function pruneRare(names: string[], counter: Counter): string[] {
  if (names.length <= 2) return names;
  const top = Math.max(...names.map((name) => counter.countOf(name)));
  const floor = top >= 100 ? top * 0.02 : 1;
  return names.filter((name) => counter.countOf(name) >= floor);
}

function makeDelimitedCandidate(lines: string[], kind: Exclude<FormatKind, "solo" | "space">): FormatCandidate {
  const counter = new Counter();
  const heads = lines.map((line) => {
    if (!line || isWrappedDirection(line) || isStructureMark(line)) return null;
    const head = splitDelimited(line, kind);
    if (head) counter.add(head.name);
    return head;
  });
  const pairs = heads.filter((head): head is Head => head !== null).length;
  const coverage = heads.reduce(
    (total, head) => total + (head && counter.countOf(head.name) >= 2 ? 1 : 0),
    0,
  );
  const repeated = counter.atLeast(2);
  // 콜론·대괄호는 일반 문장에도 섞이므로 반복 배역이 둘 이상 잡히면 1회성 이름을
  // 메타데이터로 본다. 반면 탭·정렬 공백은 조판상 명시적인 구분자라 1회성 크레딧도
  // 보존한다. 반복 배역이 하나뿐인 짧은 콜론 대본도 상대역 한 줄을 잃지 않는다.
  const rolePool = (kind === "colon" || kind === "bracket") && repeated.length >= 2
    ? repeated
    : counter.names();
  return { kind, heads, roles: pruneRare(rolePool, counter), coverage, pairs };
}

function makeSoloCandidate(lines: string[]): FormatCandidate {
  const occurrences = new Counter();
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index];
    if (!NAME_RE.test(line) || isSceneMarker(line) || isWrappedDirection(line)) continue;
    const next = lines.slice(index + 1).find(Boolean);
    if (next && !isWrappedDirection(next)) occurrences.add(line);
  }

  const confirmed = new Set(occurrences.atLeast(2));
  const heads = lines.map((line) => (confirmed.has(line) ? { name: line, text: "" } : null));
  const pairs = heads.filter(Boolean).length;
  return { kind: "solo", heads, roles: [...confirmed], coverage: pairs, pairs };
}

function makeSpaceCandidate(lines: string[]): FormatCandidate {
  const counter = new Counter();
  for (const line of lines) {
    if (!line || isWrappedDirection(line) || NAME_COMMA_DIRECTION_RE.test(line)) continue;
    const head = splitSpace(line);
    if (!head || /[.!?…:：,]$/.test(head.name)) continue;
    counter.add(head.name);
  }

  const top = Math.max(0, ...counter.names().map((name) => counter.countOf(name)));
  const floor = Math.max(2, Math.ceil(top * 0.1));
  const roles = counter.names().filter((name) => {
    const count = counter.countOf(name);
    if (count < floor) return false;
    return !counter.names().some((other) =>
      other !== name &&
      counter.countOf(other) >= count &&
      name.startsWith(other) &&
      PARTICLE_SUFFIXES.has(name.slice(other.length)),
    );
  });
  const roleSet = new Set(roles);
  const heads = lines.map((line) => {
    const head = splitSpace(line);
    if (!head || !roleSet.has(head.name) || /^[-–—]/.test(head.text)) return null;
    return head;
  });
  const pairs = heads.filter(Boolean).length;
  const coverage = heads.reduce((total, head) => total + (head ? 1 : 0), 0);
  return { kind: "space", heads, roles, coverage, pairs };
}

function chooseFormat(lines: string[]): FormatCandidate | null {
  const candidates: FormatCandidate[] = [
    makeDelimitedCandidate(lines, "colon"),
    makeDelimitedCandidate(lines, "tab"),
    makeDelimitedCandidate(lines, "aligned"),
    makeDelimitedCandidate(lines, "bracket"),
    makeSoloCandidate(lines),
  ];

  let selected: FormatCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate.pairs < 2) continue;
    if (
      !selected ||
      candidate.coverage > selected.coverage ||
      (candidate.coverage === selected.coverage && candidate.pairs > selected.pairs)
    ) {
      selected = candidate;
    }
  }

  if (!selected || selected.coverage < 3) {
    const space = makeSpaceCandidate(lines);
    if (
      space.pairs > 0 &&
      (!selected ||
        space.coverage > selected.coverage ||
        (space.coverage === selected.coverage && space.pairs > selected.pairs))
    ) {
      selected = space;
    }
  }
  return selected;
}

function splitHint(line: string, hints: string[]): Head | null {
  const bracket = splitBracket(line);
  if (bracket && hints.includes(bracket.name)) return bracket;

  for (const name of [...hints].sort((left, right) => right.length - left.length)) {
    if (line === name) return { name, text: "" };
    if (!line.startsWith(name)) continue;
    const rest = line.slice(name.length);
    const colon = /^\s*[:：]\s*(.+)$/.exec(rest);
    if (colon) return { name, text: cleanInline(colon[1]) };
    const spaced = /^[\t 　]+(.+)$/.exec(rest);
    if (spaced) return { name, text: cleanInline(spaced[1]) };
  }
  return null;
}

function appearsAsRole(line: string, name: string): boolean {
  return splitHint(line, [name]) !== null;
}

function appendContinuation(
  line: DialogueLine,
  text: string,
  partsByLine: Map<DialogueLine, string[]>,
  forceLineBreak: boolean,
) {
  const cleaned = cleanInline(text);
  if (!cleaned) return;
  const parts = partsByLine.get(line) ?? [line.text];
  parts.push(cleaned);
  partsByLine.set(line, parts);

  // 기존 파서는 짧은 대사 한 줄이 한 번만 접힌 경우 공백으로 정규화했다. 그 계약은
  // 유지하되, 세 줄 이상이거나 지문을 사이에 둔 경우와 탭·정렬 형식은 원래 줄 경계를
  // 보존한다.
  const separator = forceLineBreak || parts.length >= 3 || parts[0].length > 10 ? "\n" : " ";
  line.text = parts.join(separator);
}

export function detectRoles(raw: string, options: ParseOptions = {}): string[] {
  return parseScript(raw, options).roles;
}

export function parseScript(raw: string, options: ParseOptions = {}): ParsedScript {
  const lines = stripHeaderSections(normalize(raw));
  if (lines.every((line) => line === "")) return { title: undefined, roles: [], lines: [] };

  const selected = chooseFormat(lines);
  const hints = [...new Set((options.roleHints ?? []).map((name) => name.trim()).filter(Boolean))];
  const appearingHints = hints.filter((name) => lines.some((line) => appearsAsRole(line, name)));
  const excluded = new Set(options.excludeRoles ?? []);
  const detected = options.onlyHints ? [] : (selected?.roles ?? []);
  const roles = [...detected, ...appearingHints.filter((name) => !detected.includes(name))]
    .filter((name) => !excluded.has(name));
  const roleSet = new Set(roles);

  const out: ScriptLine[] = [];
  let previous: DialogueLine | null = null;
  let pendingRole: string | null = null;
  const continuationParts = new Map<DialogueLine, string[]>();
  const breakAfterDirection = new Set<DialogueLine>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      previous = null;
      pendingRole = null;
      continue;
    }

    if (isWrappedDirection(line)) {
      out.push({ type: "direction", text: stripWrap(line) });
      if (previous) breakAfterDirection.add(previous);
      continue;
    }
    if (isStructureMark(line)) {
      out.push({ type: "direction", text: BRACKET_ROLE_RE.exec(line)![2].trim() });
      previous = null;
      pendingRole = null;
      continue;
    }
    if (isSceneMarker(line)) {
      out.push({ type: "direction", text: cleanInline(line) });
      previous = null;
      pendingRole = null;
      continue;
    }

    let head: Head | null = null;
    if (options.onlyHints) {
      head = splitHint(line, roles);
    } else if (selected) {
      head = selected.heads[index];
      if ((!head || !roleSet.has(head.name)) && appearingHints.length > 0) {
        head = splitHint(line, appearingHints);
      }
    }

    if (head && roleSet.has(head.name)) {
      if (selected?.kind === "space" && /^[-–—]/.test(head.text)) continue;
      if (!head.text) {
        pendingRole = head.name;
        previous = null;
      } else {
        previous = { type: "dialogue", role: head.name, text: head.text };
        out.push(previous);
        continuationParts.set(previous, [head.text]);
        pendingRole = null;
      }
      continue;
    }

    if (pendingRole) {
      previous = { type: "dialogue", role: pendingRole, text: cleanInline(line) };
      out.push(previous);
      continuationParts.set(previous, [previous.text]);
      pendingRole = null;
      continue;
    }

    const foreignHead = splitDelimited(line, "colon") ?? splitDelimited(line, "tab") ?? splitDelimited(line, "aligned");
    if (foreignHead || NAME_COMMA_DIRECTION_RE.test(line)) {
      out.push({ type: "direction", text: cleanInline(line) });
      continue;
    }

    if (selected?.kind === "space") {
      const possibleCast = splitSpace(line);
      if (possibleCast && roleSet.has(possibleCast.name) && /^[-–—]/.test(possibleCast.text)) continue;
    }

    if (previous) {
      const explicitMultiline = options.onlyHints || selected?.kind === "tab" || selected?.kind === "aligned" || selected?.kind === "space";
      appendContinuation(
        previous,
        line,
        continuationParts,
        explicitMultiline || breakAfterDirection.has(previous),
      );
      breakAfterDirection.delete(previous);
      continue;
    }
    out.push({ type: "direction", text: cleanInline(line) });
  }

  let title: string | undefined;
  const firstIndex = lines.findIndex((line) => line !== "");
  const first = lines[firstIndex];
  if (
    first &&
    lines[firstIndex + 1] === "" &&
    cleanInline(first).length <= 30 &&
    out[0]?.type === "direction" &&
    out[0].text === cleanInline(first)
  ) {
    title = cleanInline(first);
    out.shift();
  }

  const usedRoles = new Set(out.filter((line): line is DialogueLine => line.type === "dialogue").map((line) => line.role));
  return { title, roles: roles.filter((role) => usedRoles.has(role)), lines: out };
}

/** TTS로 읽을 때 괄호 지문·따옴표를 뺀 본문. */
export function speakableText(text: string): string {
  return text
    .replace(/[(（\[【][^)）\]】]*[)）\]】]/g, " ")
    .replace(/["“”'‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
