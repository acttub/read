import assert from "node:assert/strict";
import test from "node:test";

import { parseScript } from "../app/parse.js";
import { SAMPLE_SCRIPT } from "../app/sample-script.js";

test("예시 대본은 두 배역이 여섯 턴씩 전부 대사로 파싱된다", () => {
  const result = parseScript(SAMPLE_SCRIPT);

  assert.deepEqual(result.roles, ["지우", "민준"]);
  assert.equal(result.turns.length, 12);
  assert.equal(result.turns.filter(({ isDirection }) => isDirection).length, 0);
  assert.equal(result.turns.filter(({ role }) => role === "지우").length, 6);
  assert.equal(result.turns.filter(({ role }) => role === "민준").length, 6);
});
