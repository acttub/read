export const MAX_BODY_BYTES = 512 * 1024;
export const MAX_TEXT_CHARACTERS = 100000;

const MAX_ROLES = 20;
const MAX_ROLE_CHARACTERS = 12;
const SYSTEM_PROMPT =
  "다음 연극/드라마 대본에서 말하는 등장인물(배역) 이름 목록만 JSON으로 반환. 배우·스태프 이름 제외.";

type ValidParseRolesRequest = {
  valid: true;
  text: string;
};

type InvalidParseRolesRequest = {
  valid: false;
  error: string;
};

export type ParseRolesValidation =
  | ValidParseRolesRequest
  | InvalidParseRolesRequest;

export function validateRequest(
  body: unknown,
  bodyBytes?: number,
): ParseRolesValidation {
  let measuredBodyBytes = bodyBytes;
  if (!Number.isFinite(measuredBodyBytes)) {
    try {
      measuredBodyBytes = Buffer.byteLength(JSON.stringify(body ?? null));
    } catch {
      measuredBodyBytes = MAX_BODY_BYTES + 1;
    }
  }

  if ((measuredBodyBytes as number) > MAX_BODY_BYTES) {
    return { valid: false, error: "body exceeds 512KB" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { valid: false, error: "body must be a JSON object" };
  }
  if (
    !("text" in body) ||
    typeof body.text !== "string" ||
    !body.text.trim()
  ) {
    return { valid: false, error: "text must be a non-empty string" };
  }

  return { valid: true, text: body.text.slice(0, MAX_TEXT_CHARACTERS) };
}

export function cleanRoles(roles: unknown): string[] | null {
  if (!Array.isArray(roles)) return null;

  const cleaned: string[] = [];
  for (const role of roles) {
    if (typeof role !== "string") continue;
    const name = role.trim().slice(0, MAX_ROLE_CHARACTERS);
    if (!name || cleaned.includes(name)) continue;
    cleaned.push(name);
    if (cleaned.length === MAX_ROLES) break;
  }
  return cleaned;
}

type ParseRolesResult =
  | { roles: null; reason: "no_key" }
  | { roles: string[] }
  | { error: string };

export async function parseRoles(
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ParseRolesResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { roles: null, reason: "no_key" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let response: Response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "script_roles",
            strict: true,
            schema: {
              type: "object",
              properties: {
                roles: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["roles"],
              additionalProperties: false,
            },
          },
        },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    return {
      error:
        error instanceof Error && error.name === "AbortError"
          ? "role parsing timed out"
          : "role parsing request failed",
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) return { error: "role parsing request failed" };

  try {
    const result: unknown = await response.json();
    if (
      !result ||
      typeof result !== "object" ||
      !("choices" in result) ||
      !Array.isArray(result.choices)
    ) {
      return { error: "role parsing response was invalid" };
    }
    const firstChoice = result.choices[0];
    if (
      !firstChoice ||
      typeof firstChoice !== "object" ||
      !("message" in firstChoice) ||
      !firstChoice.message ||
      typeof firstChoice.message !== "object" ||
      !("content" in firstChoice.message) ||
      typeof firstChoice.message.content !== "string"
    ) {
      return { error: "role parsing response was invalid" };
    }

    const parsed: unknown = JSON.parse(firstChoice.message.content);
    const roles =
      parsed && typeof parsed === "object" && "roles" in parsed
        ? cleanRoles(parsed.roles)
        : null;
    if (roles === null) {
      return { error: "role parsing response was invalid" };
    }
    return { roles };
  } catch {
    return { error: "role parsing response was invalid" };
  }
}
