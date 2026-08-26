import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_AUDIO_BYTES,
  transcribeAudio,
  validateRequest,
} from "./core";
import { POST } from "./route";

const originalApiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
});

describe("POST /api/transcribe", () => {
  it("허용 목록 밖의 오디오 타입을 거부한다", () => {
    expect(
      validateRequest("application/octet-stream", new Uint8Array([1])),
    ).toEqual({ valid: false, error: "content type is not supported" });
  });

  it("2MB를 넘는 오디오를 거부한다", () => {
    expect(
      validateRequest(
        "audio/webm",
        new Uint8Array(MAX_AUDIO_BYTES + 1),
      ),
    ).toEqual({ valid: false, error: "audio body exceeds 2MB" });
  });

  it("OPENAI_API_KEY가 없으면 조용한 폴백 계약을 반환한다", async () => {
    delete process.env.OPENAI_API_KEY;
    const response = await POST(
      new Request("http://localhost/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "audio/webm" },
        body: new Uint8Array([1, 2, 3]),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      text: null,
      reason: "no_key",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("오디오를 OpenAI multipart 요청으로 보내 변환 텍스트를 반환한다", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const audio = new Uint8Array([10, 20, 30]);
    let request:
      | { input: string | URL | Request; init?: RequestInit }
      | undefined;
    const result = await transcribeAudio(
      audio,
      "audio/mp4",
      "m4a",
      async (input, init) => {
        request = { input, init };
        return new Response(JSON.stringify({ text: "기억한 대사" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );

    expect(result).toEqual({ text: "기억한 대사" });
    expect(request).toBeDefined();
    if (!request?.init) throw new Error("expected an upstream request");
    expect(request.input).toBe(
      "https://api.openai.com/v1/audio/transcriptions",
    );
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toEqual({
      Authorization: "Bearer test-key",
    });
    expect(request.init.body).toBeInstanceOf(FormData);
    const form = request.init.body as FormData;
    expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
    expect(form.get("language")).toBe("ko");
    const file = form.get("file");
    expect(file).toBeInstanceOf(File);
    const audioFile = file as File;
    expect(audioFile.name).toBe("recording.m4a");
    expect(audioFile.type).toBe("audio/mp4");
    expect(new Uint8Array(await audioFile.arrayBuffer())).toEqual(audio);
  });
});
