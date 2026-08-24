export const MAX_BODY_BYTES = 512 * 1024;
export const MAX_TEXT_CHARACTERS = 100000;

const MAX_ROLES = 20;
const MAX_ROLE_CHARACTERS = 12;
const SYSTEM_PROMPT =
  "다음 연극/드라마 대본에서 말하는 등장인물(배역) 이름 목록만 JSON으로 반환. 배우·스태프 이름 제외.";

// JSON의 실제 바이트 크기를 검사하기 위해 Vercel의 자동 본문 파싱을 끈다.
export const config = {
  api: { bodyParser: false },
};

export function validateRequest(body, bodyBytes) {
  let measuredBodyBytes = bodyBytes;
  if (!Number.isFinite(measuredBodyBytes)) {
    try {
      measuredBodyBytes = Buffer.byteLength(JSON.stringify(body ?? null));
    } catch {
      measuredBodyBytes = MAX_BODY_BYTES + 1;
    }
  }

  if (measuredBodyBytes > MAX_BODY_BYTES) {
    return { valid: false, error: "body exceeds 512KB" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { valid: false, error: "body must be a JSON object" };
  }
  if (typeof body.text !== "string" || !body.text.trim()) {
    return { valid: false, error: "text must be a non-empty string" };
  }

  return {
    valid: true,
    text: body.text.slice(0, MAX_TEXT_CHARACTERS),
  };
}

export function cleanRoles(roles) {
  if (!Array.isArray(roles)) return null;

  const cleaned = [];
  for (const role of roles) {
    if (typeof role !== "string") continue;
    const name = role.trim().slice(0, MAX_ROLE_CHARACTERS);
    if (!name || cleaned.includes(name)) continue;
    cleaned.push(name);
    if (cleaned.length === MAX_ROLES) break;
  }
  return cleaned;
}

export async function parseRoles(text, fetchImpl = fetch) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { roles: null, reason: "no_key" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let response;
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
      error: error?.name === "AbortError"
        ? "role parsing timed out"
        : "role parsing request failed",
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) return { error: "role parsing request failed" };

  try {
    const result = await response.json();
    const content = result?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return { error: "role parsing response was invalid" };
    }
    const roles = cleanRoles(JSON.parse(content)?.roles);
    if (roles === null) {
      return { error: "role parsing response was invalid" };
    }
    return { roles };
  } catch {
    return { error: "role parsing response was invalid" };
  }
}

async function readRequestBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === "string") return Buffer.from(req.body);
    return Buffer.from(JSON.stringify(req.body));
  }

  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    length += bytes.byteLength;
    if (length > MAX_BODY_BYTES) return Buffer.alloc(MAX_BODY_BYTES + 1);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method must be POST" });
  }

  const rawBody = await readRequestBody(req);
  let body = null;
  if (rawBody.byteLength <= MAX_BODY_BYTES) {
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      body = null;
    }
  }

  const validation = validateRequest(body, rawBody.byteLength);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  const result = await parseRoles(validation.text);
  if (result.error) {
    // 대본·크기·OpenAI 응답은 남기지 않고 서버 응답 상태만 기록한다.
    console.error("parse-roles: HTTP 502");
    return res.status(502).json({ error: result.error });
  }
  return res.status(200).json(result);
}
