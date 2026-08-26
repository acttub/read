import { describe, expect, it } from "vitest";
import { applyInitialMode, type Setup } from "./storage";

const saved: Setup = { myRole: "윤서", start: 0, end: 10, mode: "quiz", advanceMode: "silence" };

describe("applyInitialMode", () => {
  it("주소가 모드를 말하면 저장된 모드를 덮는다", () => {
    // /prac 으로 들어온 사람은 읽어주기를 하러 온 것이다.
    expect(applyInitialMode(saved, "read")?.mode).toBe("read");
  });

  it("주소가 모드를 말하지 않으면 저장된 모드를 그대로 둔다", () => {
    // `/` 는 모드를 말하는 주소가 아니다. 화면 안에서 암기 대조로 바꿔 쓰던 사람이
    // 새로고침할 때마다 읽어주기로 튕기면 안 된다.
    expect(applyInitialMode(saved, undefined)?.mode).toBe("quiz");
  });

  it("모드 말고는 아무것도 바꾸지 않는다", () => {
    const got = applyInitialMode(saved, "read");
    expect(got).toEqual({ ...saved, mode: "read" });
  });

  it("저장된 설정을 제자리에서 고치지 않는다", () => {
    applyInitialMode(saved, "read");
    expect(saved.mode).toBe("quiz");
  });

  it("저장된 것이 없으면 없는 채로 둔다", () => {
    expect(applyInitialMode(null, "quiz")).toBeNull();
  });
});
