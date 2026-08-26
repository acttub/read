import { afterEach, describe, expect, it } from "vitest";
import { isViableHere } from "./engine";

type GpuNav = Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
const nav = () => globalThis.navigator as GpuNav;
const original = Object.getOwnPropertyDescriptor(globalThis.navigator, "gpu");

function setGpu(value: unknown) {
  Object.defineProperty(globalThis.navigator, "gpu", { value, configurable: true });
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis.navigator, "gpu", original);
  else delete (nav() as { gpu?: unknown }).gpu;
});

/**
 * 이 판정이 "브라우저 안 음성을 권할까"를 혼자 정한다.
 * 잘못 true 가 되면 느린 기기에 138MB 를 받게 해 놓고 소리가 끊긴다.
 */
describe("isViableHere", () => {
  it("WebGPU 가 없으면 권하지 않는다", async () => {
    setGpu(undefined);
    expect(await isViableHere()).toBe(false);
  });

  it("어댑터를 못 얻으면 권하지 않는다", async () => {
    // gpu 객체는 있는데 실제 장치를 못 잡는 경우가 있다 — 있다는 것만 보고 믿으면 안 된다.
    setGpu({ requestAdapter: async () => null });
    expect(await isViableHere()).toBe(false);
  });

  it("어댑터를 얻으면 권한다", async () => {
    setGpu({ requestAdapter: async () => ({}) });
    expect(await isViableHere()).toBe(true);
  });

  it("어댑터 요청이 던져도 조용히 권하지 않는다", async () => {
    setGpu({ requestAdapter: async () => { throw new Error("no"); } });
    expect(await isViableHere()).toBe(false);
  });
});
