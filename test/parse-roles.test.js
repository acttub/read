import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import handler, {
  cleanRoles,
  MAX_BODY_BYTES,
  MAX_TEXT_CHARACTERS,
  parseRoles,
  validateRequest,
} from "../api/parse-roles.js";

const originalApiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
});

function makeResponse() {
  return {
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
}

test("512KB를 넘는 JSON 본문을 거부한다", () => {
  assert.deepEqual(validateRequest({ text: "가".repeat(MAX_BODY_BYTES) }), {
    valid: false,
    error: "body exceeds 512KB",
  });
});

test("검증은 대본의 앞 100,000자만 외부 호출 대상으로 쓴다", () => {
  const validation = validateRequest(
    { text: "가".repeat(MAX_TEXT_CHARACTERS + 10) },
    MAX_TEXT_CHARACTERS + 30,
  );
  assert.equal(validation.valid, true);
  assert.equal(validation.text.length, MAX_TEXT_CHARACTERS);
});

test("OPENAI_API_KEY가 없으면 조용한 폴백 계약을 반환한다", async () => {
  delete process.env.OPENAI_API_KEY;
  const response = makeResponse();
  await handler({ method: "POST", body: { text: "민수 대사" } }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, { roles: null, reason: "no_key" });
  assert.equal(response.headers["Cache-Control"], "no-store");
});

test("대본을 Chat Completions JSON 스키마 요청으로 보내 이름만 받는다", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  let request;
  const result = await parseRoles("민수 첫 대사", async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ roles: ["민수"] }) } }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  assert.deepEqual(result, { roles: ["민수"] });
  assert.equal(request.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, "gpt-4o-mini");
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.messages[1].content, "민수 첫 대사");
  assert.equal(
    body.messages[0].content,
    "다음 연극/드라마 대본에서 말하는 등장인물(배역) 이름 목록만 JSON으로 반환. 배우·스태프 이름 제외.",
  );
});

test("roles는 문자열만 정리해 12자·20개 상한과 중복 제거를 적용한다", () => {
  const roles = [
    "  민수  ",
    "민수",
    "열두글자를넘어가는아주긴배역이름",
    42,
    "",
    ...Array.from({ length: 25 }, (_, index) => `배역${index}`),
  ];
  const cleaned = cleanRoles(roles);

  assert.equal(cleaned.length, 20);
  assert.equal(cleaned[0], "민수");
  assert.equal(cleaned[1], "열두글자를넘어가는아주긴");
  assert.ok(cleaned.every((name) => name.length <= 12));
  assert.equal(new Set(cleaned).size, cleaned.length);
});
