import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createAiRoleLookup,
  findAiRoleResult,
  validateAiRoleNames,
} from "../app/ai-roles.js";

const SCRIPT = [
  "민수: 첫 번째 대사.",
  "영희: 한 마디뿐인 답.",
  "민수: 두 번째 대사.",
].join("\n");

function makeSessionStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test("AI가 배역이라 한 이름은 원문에서 한 턴만 잡혀도 채택한다", () => {
  const result = validateAiRoleNames(SCRIPT, ["민수", "영희", "환각 배역"]);

  assert.deepEqual(result.roles, ["민수", "영희"]);
  assert.deepEqual(result.turns.map(({ role, text }) => [role, text]), [
    ["민수", "첫 번째 대사."],
    ["영희", "한 마디뿐인 답."],
    ["민수", "두 번째 대사."],
  ]);
});

test("검증을 통과한 이름이 두 개 미만이면 휴리스틱 폴백을 위해 null을 반환한다", async () => {
  const result = await findAiRoleResult(SCRIPT, async () =>
    new Response(JSON.stringify({ roles: ["민수", "연출"] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

  assert.equal(result, null);
});

test("no_key와 API 오류는 모두 휴리스틱 폴백을 위해 null을 반환한다", async () => {
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

test("같은 대본은 현재 페이지와 같은 세션에서 한 번만 호출한다", async () => {
  const storage = makeSessionStorage();
  let calls = 0;
  const fetchRoles = async () => {
    calls += 1;
    return new Response(JSON.stringify({ roles: ["민수", "영희"] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const lookup = createAiRoleLookup(fetchRoles, { storage });

  const [first, concurrent, repeated] = await Promise.all([
    lookup(SCRIPT),
    lookup(SCRIPT),
    lookup(SCRIPT),
  ]);
  const lookupAfterReload = createAiRoleLookup(fetchRoles, { storage });
  const restored = await lookupAfterReload(SCRIPT);

  assert.equal(calls, 1);
  assert.deepEqual(concurrent, first);
  assert.deepEqual(repeated, first);
  assert.deepEqual(restored, first);
});

test("실패한 같은 대본도 세션에서 다시 호출하지 않는다", async () => {
  const storage = makeSessionStorage();
  let calls = 0;
  const fetchFailure = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: "failed" }), { status: 502 });
  };
  const firstLookup = createAiRoleLookup(fetchFailure, { storage });
  const secondLookup = createAiRoleLookup(fetchFailure, { storage });

  assert.equal(await firstLookup(SCRIPT), null);
  assert.equal(await firstLookup(SCRIPT), null);
  assert.equal(await secondLookup(SCRIPT), null);
  assert.equal(calls, 1);
});

test("직접 쓰기 입력은 AI 확인을 1초 이상 디바운스한다", async () => {
  const source = await readFile(
    new URL("../app/input.js", import.meta.url),
    "utf8",
  );
  const delay = Number(
    source.match(/DIRECT_INPUT_LOOKUP_DELAY_MS\s*=\s*(\d+)/)?.[1],
  );
  const inputHandler = source.match(
    /scriptInput\.addEventListener\("input",[\s\S]*?^\}\);/m,
  )?.[0];

  assert.ok(delay >= 1000);
  assert.match(
    inputHandler || "",
    /validateScript\(\{ aiLookupDelayMs: DIRECT_INPUT_LOOKUP_DELAY_MS \}\)/,
  );
});
