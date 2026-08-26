/**
 * `main` 의 파서 API 모양으로 지금 파서를 감싼다 — 이관 게이트(parse.legacy.test.ts)를 돌리기 위한 것.
 *
 *   main: { roles, turns: [{ role, text, isDirection }] }
 *   지금: { roles, lines: [{ type:"dialogue", role, text } | { type:"direction", text }] }
 *
 * 역할 없는 독립 지문은 main 에서 turn 이 되지 않으므로 버린다.
 * **이관이 끝나면 이 파일과 게이트 테스트를 지운다** — 두 모양을 영원히 유지할 이유는 없다.
 */
import { parseScript as parse } from "./parse";

export interface LegacyTurn {
  role: string;
  text: string;
  isDirection: boolean;
}

export interface LegacyParsed {
  roles: string[];
  turns: LegacyTurn[];
}

function adapt(p: ReturnType<typeof parse>): LegacyParsed {
  return {
    roles: p.roles,
    turns: p.lines
      .filter((l) => l.type === "dialogue")
      .map((l) => ({ role: l.role, text: l.text, isDirection: l.text.startsWith("(") })),
  };
}

export const parseScript = (text: string): LegacyParsed => adapt(parse(text));

export const parseScriptWithRoles = (text: string, roleNames: string[]): LegacyParsed =>
  adapt(parse(text, { roleHints: roleNames, onlyHints: true }));
