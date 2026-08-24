import assert from "node:assert/strict";
import test from "node:test";

import {
  findAiRoleResult,
  validateAiRoleNames,
} from "../app/ai-roles.js";

const SCRIPT = [
  "등장인물 민수와 영희",
  "민수 첫 번째 대사.",
  "영희 첫 번째 답.",
  "민수 두 번째 대사.",
  "영희 두 번째 답.",
].join("\n");

test("AI 이름은 원문 줄 시작에서 두 턴 이상 잡힌 것만 채택한다", () => {
  const result = validateAiRoleNames(SCRIPT, ["민수", "영희", "등장인물"]);

  assert.deepEqual(result.roles, ["민수", "영희"]);
  assert.deepEqual(result.turns.map(({ role, text }) => [role, text]), [
    ["민수", "첫 번째 대사."],
    ["영희", "첫 번째 답."],
    ["민수", "두 번째 대사."],
    ["영희", "두 번째 답."],
  ]);
});

test("검증을 통과한 이름이 두 개 미만이면 수동 입력 폴백을 위해 null을 반환한다", async () => {
  const result = await findAiRoleResult(SCRIPT, async () =>
    new Response(JSON.stringify({ roles: ["민수", "연출"] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

  assert.equal(result, null);
});

test("no_key와 API 오류는 모두 수동 입력 폴백을 위해 null을 반환한다", async () => {
  const noKey = await findAiRoleResult(SCRIPT, async () =>
    new Response(JSON.stringify({ roles: null, reason: "no_key" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  const failed = await findAiRoleResult(SCRIPT, async () =>
    new Response(JSON.stringify({ error: "failed" }), { status: 502 }));

  assert.equal(noKey, null);
  assert.equal(failed, null);
});
