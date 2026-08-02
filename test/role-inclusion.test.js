import assert from "node:assert/strict";
import test from "node:test";

import { parseScript } from "../app/parse.js";
import {
  filterTurnsByRoleParams,
  getInitialRoleInclusion,
  partitionRolesByInitialInclusion,
} from "../app/role-inclusion.js";

function makeSixRoleScript() {
  const lines = ["연출\t한서린", "조명\t김빛", "기획\t이막"];
  for (const role of ["가은", "나래", "다온", "라희", "마루", "바다"]) {
    lines.push(`${role}\t${role}의 첫 번째 대사입니다.`);
    lines.push(`${role}\t${role}의 두 번째 대사입니다.`);
  }
  return parseScript(lines.join("\n"));
}

test("2줄 배역 6개는 기본 포함하고 1줄 크레딧은 제외한다", () => {
  const { turns, roles } = makeSixRoleScript();
  const { lineCounts, selectedRole, includedRoles } =
    getInitialRoleInclusion(turns, roles);

  assert.equal(selectedRole, "가은");
  assert.deepEqual([...includedRoles], ["가은", "나래", "다온", "라희", "마루", "바다"]);
  assert.equal(lineCounts.get("연출"), 1);
  assert.equal(lineCounts.get("가은"), 2);
});

test("최초 한 번만 포함 배역을 앞에 두고 각 묶음의 등장 순서를 유지한다", () => {
  const { turns, roles } = makeSixRoleScript();
  const { includedRoles } = getInitialRoleInclusion(turns, roles);
  const partition = partitionRolesByInitialInclusion(roles, includedRoles);

  assert.deepEqual(partition.included, [
    "가은",
    "나래",
    "다온",
    "라희",
    "마루",
    "바다",
  ]);
  assert.deepEqual(partition.excluded, ["연출", "조명", "기획"]);

  includedRoles.add("연출");
  includedRoles.delete("나래");
  assert.deepEqual(partition.included, [
    "가은",
    "나래",
    "다온",
    "라희",
    "마루",
    "바다",
  ]);
  assert.deepEqual(partition.excluded, ["연출", "조명", "기획"]);
});

test("roleParams에 없는 배역의 turn을 제외한다", () => {
  const { turns } = makeSixRoleScript();
  const filtered = filterTurnsByRoleParams(turns, {
    가은: {},
    나래: {},
    다온: {},
    라희: {},
    마루: {},
  });

  assert.equal(filtered.length, 10);
  assert.equal(filtered.some((turn) => turn.role === "바다"), false);
  assert.equal(filtered.some((turn) => turn.role === "연출"), false);
});

test("빈 roleParams는 옛 세션 호환을 위해 모든 turn을 유지한다", () => {
  const { turns } = makeSixRoleScript();
  const filtered = filterTurnsByRoleParams(turns, {});

  assert.strictEqual(filtered, turns);
  assert.equal(filtered.length, 15);
});
