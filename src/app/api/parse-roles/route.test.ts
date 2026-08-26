import { afterEach, describe, expect, it } from "vitest";

import {
  cleanRoles,
  MAX_BODY_BYTES,
  MAX_TEXT_CHARACTERS,
  parseRoles,
  validateRequest,
} from "./core";
import { POST } from "./route";

const originalApiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
});

describe("POST /api/parse-roles", () => {
  it("512KB를 넘는 JSON 본문을 거부한다", () => {
    expect(validateRequest({ text: "가".repeat(MAX_BODY_BYTES) })).toEqual({
      valid: false,
      error: "body exceeds 512KB",
    });
  });

  it("검증은 대본의 앞 100,000자만 외부 호출 대상으로 쓴다", () => {
    const validation = validateRequest(
      { text: "가".repeat(MAX_TEXT_CHARACTERS + 10) },
      MAX_TEXT_CHARACTERS + 30,
    );

    expect(validation.valid).toBe(true);
    if (!validation.valid) throw new Error("expected a valid request");
    expect(validation.text).toHaveLength(MAX_TEXT_CHARACTERS);
  });

  it("OPENAI_API_KEY가 없으면 조용한 폴백 계약을 반환한다", async () => {
    delete process.env.OPENAI_API_KEY;
    const response = await POST(
      new Request("http://localhost/api/parse-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "민수 대사" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      roles: null,
      reason: "no_key",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("대본을 Chat Completions JSON 스키마 요청으로 보내 이름만 받는다", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    let request:
      | { input: string | URL | Request; init?: RequestInit }
      | undefined;
    const result = await parseRoles("민수 첫 대사", async (input, init) => {
      request = { input, init };
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify({ roles: ["민수"] }) } },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    expect(result).toEqual({ roles: ["민수"] });
    expect(request).toBeDefined();
    if (!request?.init) throw new Error("expected an upstream request");
    expect(request.input).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toEqual({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(request.init.body));
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.messages[1].content).toBe("민수 첫 대사");
    expect(body.messages[0].content).toBe(
      "다음 연극/드라마 대본에서 말하는 등장인물(배역) 이름 목록만 JSON으로 반환. 배우·스태프 이름 제외.",
    );
  });

  it("roles는 문자열만 정리해 12자·20개 상한과 중복 제거를 적용한다", () => {
    const roles = [
      "  민수  ",
      "민수",
      "열두글자를넘어가는아주긴배역이름",
      42,
      "",
      ...Array.from({ length: 25 }, (_, index) => `배역${index}`),
    ];
    const cleaned = cleanRoles(roles);

    expect(cleaned).toHaveLength(20);
    expect(cleaned?.[0]).toBe("민수");
    expect(cleaned?.[1]).toBe("열두글자를넘어가는아주긴");
    expect(cleaned?.every((name) => name.length <= 12)).toBe(true);
    expect(new Set(cleaned).size).toBe(cleaned?.length);
  });
});
