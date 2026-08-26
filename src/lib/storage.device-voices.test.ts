import { describe, expect, it } from "vitest";
import { restoreDeviceVoices, setDeviceVoice } from "./storage";

describe("배역별 기기 음성 저장과 복원", () => {
  it("고른 음성을 새 객체에 저장한다", () => {
    const saved = { 윤서: "기존 음성" };
    const next = setDeviceVoice(saved, "태오", "새 음성");

    expect(next).toEqual({ 윤서: "기존 음성", 태오: "새 음성" });
    expect(saved).toEqual({ 윤서: "기존 음성" });
  });

  it("자동 배정을 고르면 저장한 선택을 지운다", () => {
    expect(setDeviceVoice({ 윤서: "고른 음성", 태오: "다른 음성" }, "윤서", "")).toEqual({ 태오: "다른 음성" });
  });

  it("다시 들어오면 지금 대본의 유효한 선택만 복원한다", () => {
    const restored = restoreDeviceVoices(
      { 윤서: "고른 음성", 사라진배역: "다른 음성", 빈값: "" },
      ["윤서", "태오", "빈값"],
    );

    expect(restored).toEqual({ 윤서: "고른 음성" });
  });
});
