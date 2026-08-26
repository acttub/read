import { describe, expect, it, vi } from "vitest";
import { transcribeRecording } from "./transcribe";

describe("transcribeRecording", () => {
  it("녹음을 원문 바디로 보내고 받은 글자를 반환한다", async () => {
    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm;codecs=opus" });
    const fetchImpl = vi.fn(async () => Response.json({ text: " 기억한 대사 " }));

    await expect(transcribeRecording(audio, fetchImpl)).resolves.toEqual({
      kind: "text",
      text: "기억한 대사",
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/transcribe", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "audio/webm;codecs=opus" },
      body: audio,
    }));
  });

  it("no_key와 서버 오류는 브라우저 인식 폴백 계약으로 바꾼다", async () => {
    const audio = new Blob(["audio"], { type: "audio/mp4" });
    await expect(transcribeRecording(audio, async () => Response.json({ text: null, reason: "no_key" })))
      .resolves.toEqual({ kind: "fallback", reason: "no_key" });
    await expect(transcribeRecording(audio, async () => new Response(null, { status: 502 })))
      .resolves.toEqual({ kind: "fallback", reason: "failed" });
  });
});
