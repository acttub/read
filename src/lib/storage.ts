/**
 * 대본과 설정은 sessionStorage까지만 간다. 사용자가 넣는 대본은 대부분 타인의 저작물이라
 * 서버에 올리지 않고, 탭을 닫으면 사라지게 둔다.
 */
import type { ScriptLine } from "./script/parse";

export interface StoredScript {
  title: string | undefined;
  roles: string[];
  lines: ScriptLine[];
  raw: string;
}

export type AdvanceMode = "silence" | "manual";
export type Mode = "read" | "quiz";
export type QuizInputMode = "voice" | "silent";

export interface Setup {
  myRole: string;
  start: number;
  end: number;
  mode: Mode;
  advanceMode: AdvanceMode;
  quizInputMode?: QuizInputMode;
}

const SCRIPT_KEY = "rehearsal.script";
const SETUP_KEY = "rehearsal.setup";

function read<T>(key: string): T | null {
  try {
    const v = sessionStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장이 막힌 환경(시크릿 등)이면 그냥 메모리만 쓴다 */
  }
}

export const storage = {
  loadScript: () => read<StoredScript>(SCRIPT_KEY),
  saveScript: (s: StoredScript | null) => write(SCRIPT_KEY, s),
  loadSetup: () => read<Setup>(SETUP_KEY),
  saveSetup: (s: Setup | null) => write(SETUP_KEY, s),
};

/**
 * 주소가 정한 모드를 저장된 설정에 얹는다.
 *
 * `/quiz`·`/prac` 은 모드를 말하는 주소라 저장값을 덮는다. `/` 는 아니다 —
 * 화면 안에서 모드를 바꿔 쓰던 사람이 새로고침할 때마다 튕기면 안 된다.
 */
export function applyInitialMode(stored: Setup | null, initialMode?: Mode): Setup | null {
  if (!stored) return null;
  return initialMode ? { ...stored, mode: initialMode } : stored;
}
