import { describe, expect, it } from "vitest";
import { FORCED_BACKEND, MODEL_VARIANTS, variantBytes, variantForBackend } from "./models";

/**
 * 이 파일이 지키는 것은 **맞바꿈의 숫자**다.
 *
 * 가중치 두 벌은 용량과 속도를 맞바꾼다. 어느 쪽이 얼마인지 잊으면
 * "용량을 줄이자"는 말이 "소리가 끊기게 하자"가 된다(2026-08-26 에 실제로 그럴 뻔했다).
 */
describe("가중치 두 벌의 맞바꿈", () => {
  it("용량을 숫자로 못박는다 — 이게 줄어들면 결정을 다시 볼 만하다", () => {
    expect(Math.round(variantBytes("fp32") / 1024 / 1024)).toBe(380);
    expect(Math.round(variantBytes("int8") / 1024 / 1024)).toBe(138);
  });

  it("장치와 가중치의 짝은 한 군데서만 정한다", () => {
    // 화면 안내(guessVariant)와 워커(pickBackend)가 둘 다 이 함수를 본다.
    // 매핑이 둘로 늘어나면 "138MB 받는다" 하고 380MB 를 받는 일이 생긴다.
    expect(variantForBackend("wasm")).toBe("int8");
    expect(variantForBackend("webgpu")).toBe("fp32");
  });

  it("장치를 고정한다면 wasm 이어서는 안 된다", () => {
    // 실측: wasm+int8 은 맥 15코어에서도 기본 단계 RTF 1.52 로 실시간을 못 따라간다.
    // 고정이 필요해지면 webgpu 쪽이다. null(기기 보고 고르기)이 기본.
    expect(FORCED_BACKEND).not.toBe("wasm");
  });

  it("두 벌 모두 같은 4개 모델을 가리킨다", () => {
    expect(Object.keys(MODEL_VARIANTS.fp32.urls)).toEqual(Object.keys(MODEL_VARIANTS.int8.urls));
  });
});
