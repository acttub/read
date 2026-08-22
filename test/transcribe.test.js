import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import handler, {
  MAX_AUDIO_BYTES,
  transcribeAudio,
  validateRequest,
} from "../api/transcribe.js";

const originalApiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
});

test("허용 목록 밖의 오디오 타입을 거부한다", () => {
  assert.deepEqual(
    validateRequest("application/octet-stream", new Uint8Array([1])),
    { valid: false, error: "content type is not supported" },
  );
});

test("2MB를 넘는 오디오를 거부한다", () => {
  assert.deepEqual(
    validateRequest("audio/webm", new Uint8Array(MAX_AUDIO_BYTES + 1)),
    { valid: false, error: "audio body exceeds 2MB" },
  );
});

test("OPENAI_API_KEY가 없으면 조용한 폴백 계약을 반환한다", async () => {
  delete process.env.OPENAI_API_KEY;
  const response = {
    statusCode: 0,
    payload: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  await handler({
    method: "POST",
    headers: { "content-type": "audio/webm" },
    body: new Uint8Array([1, 2, 3]),
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, { text: null, reason: "no_key" });
  assert.equal(response.headers["Cache-Control"], "no-store");
});

test("오디오를 OpenAI multipart 요청으로 보내 변환 텍스트를 반환한다", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const audio = new Uint8Array([10, 20, 30]);
  let request;
  const result = await transcribeAudio(
    audio,
    "audio/mp4",
    "m4a",
    async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ text: "기억한 대사" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );

  assert.deepEqual(result, { text: "기억한 대사" });
  assert.equal(request.url, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
  assert.equal(request.options.body.get("model"), "gpt-4o-mini-transcribe");
  assert.equal(request.options.body.get("language"), "ko");
  const file = request.options.body.get("file");
  assert.equal(file.name, "recording.m4a");
  assert.equal(file.type, "audio/mp4");
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), audio);
});
