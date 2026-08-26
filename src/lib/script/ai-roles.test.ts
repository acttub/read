import { describe, expect, it } from "vitest";
import {
  createAiRoleLookup,
  DIRECT_INPUT_LOOKUP_DELAY_MS,
  findAiRoleNames,
  validateAiRoleNames,
} from "./ai-roles";

const SCRIPT = [
  "민수: 첫 번째 대사.",
  "영희: 한 마디뿐인 답.",
  "민수: 두 번째 대사.",
].join("\n");

function makeSessionStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
  };
}

describe("AI 배역 판별", () => {
  it("AI가 배역이라 한 이름은 원문에서 한 턴만 잡혀도 채택한다", () => {
    expect(validateAiRoleNames(SCRIPT, ["민수", "영희", "환각 배역"])).toEqual(["민수", "영희"]);
  });

  it("검증된 이름이 두 개 미만이면 휴리스틱 폴백을 위해 null을 반환한다", async () => {
    const result = await findAiRoleNames(SCRIPT, async () =>
      Response.json({ roles: ["민수", "연출"] }));
    expect(result).toBeNull();
  });

  it("no_key와 API 오류는 모두 조용히 폴백한다", async () => {
    const noKey = await findAiRoleNames(SCRIPT, async () =>
      Response.json({ roles: null, reason: "no_key" }));
    const failed = await findAiRoleNames(SCRIPT, async () =>
      Response.json({ error: "failed" }, { status: 502 }));
    expect(noKey).toBeNull();
    expect(failed).toBeNull();
  });

  it("같은 대본은 현재 페이지와 같은 세션에서 한 번만 호출한다", async () => {
    const storage = makeSessionStorage();
    let calls = 0;
    const fetchRoles = async () => {
      calls += 1;
      return Response.json({ roles: ["민수", "영희"] });
    };
    const lookup = createAiRoleLookup(fetchRoles, { storage });
    const [first, concurrent, repeated] = await Promise.all([
      lookup(SCRIPT), lookup(SCRIPT), lookup(SCRIPT),
    ]);
    const restored = await createAiRoleLookup(fetchRoles, { storage })(SCRIPT);

    expect(calls).toBe(1);
    expect(concurrent).toEqual(first);
    expect(repeated).toEqual(first);
    expect(restored).toEqual(first);
  });

  it("실패한 같은 대본도 세션에서 다시 호출하지 않는다", async () => {
    const storage = makeSessionStorage();
    let calls = 0;
    const fetchFailure = async () => {
      calls += 1;
      return Response.json({ error: "failed" }, { status: 502 });
    };
    const firstLookup = createAiRoleLookup(fetchFailure, { storage });
    expect(await firstLookup(SCRIPT)).toBeNull();
    expect(await firstLookup(SCRIPT)).toBeNull();
    expect(await createAiRoleLookup(fetchFailure, { storage })(SCRIPT)).toBeNull();
    expect(calls).toBe(1);
  });

  it("직접 입력은 AI 확인을 1초 이상 디바운스한다", () => {
    expect(DIRECT_INPUT_LOOKUP_DELAY_MS).toBeGreaterThanOrEqual(1000);
  });
});
