import { describe, expect, it } from "vitest";
import { FORCED_BACKEND, MODEL_VARIANTS, variantBytes, variantForBackend } from "./models";

/**
 * 이 파일이 지키는 것은 코드가 아니라 **약속**이다.
 *
 * 첫 방문자가 인스타에서 들어온다. 그 사람에게 요구하는 다운로드 용량이 조용히
 * 늘어나면(=WebGPU 경로가 다시 켜지면 398MB) 서비스가 아니라 이탈이 된다.
 */
describe("받는 용량", () => {
  it("이 앱이 실제로 받는 가중치는 160MB 를 넘지 않는다", () => {
    const variant = FORCED_BACKEND ? variantForBackend(FORCED_BACKEND) : "int8";
    expect(variantBytes(variant) / 1024 / 1024).toBeLessThan(160);
  });

  it("화면 안내와 실제 다운로드가 같은 값에서 나온다", () => {
    // guessVariant(화면)과 pickBackend(워커)가 둘 다 FORCED_BACKEND 를 본다.
    // 여기서 매핑이 하나뿐이라는 것만 확인한다 — 둘로 늘어나면 갈라진다.
    expect(variantForBackend("wasm")).toBe("int8");
    expect(variantForBackend("webgpu")).toBe("fp32");
  });

  it("fp32 는 아이폰에 요구할 수 없는 용량이라는 것을 숫자로 남긴다", () => {
    // 이 숫자가 줄어들면(더 작은 가중치가 생기면) WebGPU 경로를 다시 볼 만하다.
    expect(Math.round(variantBytes("fp32") / 1024 / 1024)).toBe(380);
    expect(Math.round(variantBytes("int8") / 1024 / 1024)).toBe(138);
  });

  it("두 벌 모두 같은 4개 모델을 가리킨다", () => {
    expect(Object.keys(MODEL_VARIANTS.fp32.urls)).toEqual(Object.keys(MODEL_VARIANTS.int8.urls));
  });
});
