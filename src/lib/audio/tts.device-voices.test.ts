import { describe, expect, it } from "vitest";
import { assignVoices, pickDeviceVoice } from "./tts";

const koreanVoices = [{ name: "첫 음성" }, { name: "둘째 음성" }, { name: "셋째 음성" }];

describe("배역별 기기 음성 배정", () => {
  it("고른 음성은 이름 그대로 들고 간다", () => {
    // 인덱스로 미리 바꾸지 않는다 — 배정 시점에 음성 목록이 비어 있을 수 있다.
    const voices = assignVoices(["윤서", "태오"], { 윤서: "셋째 음성" });
    expect(voices.윤서.device.voiceName).toBe("셋째 음성");
  });

  it("고르지 않은 배역은 자동 배정을 그대로 쓴다", () => {
    const automatic = assignVoices(["윤서", "태오"]);
    const selected = assignVoices(["윤서", "태오"], { 윤서: "셋째 음성" });
    expect(selected.태오).toEqual(automatic.태오);
  });
});

describe("pickDeviceVoice", () => {
  it("고른 이름이 지금 기기에 있으면 그것을 쓴다", () => {
    const { device } = assignVoices(["윤서"], { 윤서: "셋째 음성" }).윤서;
    expect(pickDeviceVoice(koreanVoices, device)?.name).toBe("셋째 음성");
  });

  it("고른 이름이 지금 기기에 없으면 자동 배정 순번으로 돌아간다", () => {
    // 다른 기기에서 고른 설정을 그대로 들고 왔을 때. 조용히 되지 않고 소리는 난다.
    const { device } = assignVoices(["윤서"], { 윤서: "사라진 음성" }).윤서;
    expect(pickDeviceVoice(koreanVoices, device)?.name).toBe("첫 음성");
  });

  it("음성 목록이 아직 비어 있으면 아무것도 고르지 않는다", () => {
    // 크롬은 목록이 늦게 찬다. 이때 브라우저 기본 음성으로 읽게 두는 편이 맞다.
    const { device } = assignVoices(["윤서"], { 윤서: "셋째 음성" }).윤서;
    expect(pickDeviceVoice([], device)).toBeUndefined();
  });

  it("배역이 여럿이면 자동 배정만으로도 서로 다른 음성이 된다", () => {
    const got = assignVoices(["윤서", "태오", "민재"]);
    const names = Object.values(got).map((v) => pickDeviceVoice(koreanVoices, v.device)?.name);
    expect(new Set(names).size).toBe(3);
  });
});
