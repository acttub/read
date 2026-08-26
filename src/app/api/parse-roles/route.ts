import {
  MAX_BODY_BYTES,
  parseRoles,
  validateRequest,
} from "./core";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function json(payload: unknown, status: number): Response {
  return Response.json(payload, { status, headers: NO_STORE_HEADERS });
}

async function readRequestBytes(
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel();
      return new Uint8Array(maximumBytes + 1);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await readRequestBytes(request, MAX_BODY_BYTES);
  let body: unknown = null;
  if (rawBody.byteLength <= MAX_BODY_BYTES) {
    try {
      body = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      // 깨진 JSON 도 잘못된 본문으로 본다 — 검증 계약이 그렇게 되어 있다.
    }
  }

  const validation = validateRequest(body, rawBody.byteLength);
  if (!validation.valid) {
    return json({ error: validation.error }, 400);
  }

  const result = await parseRoles(validation.text);
  if ("error" in result) {
    console.error("parse-roles: HTTP 502");
    return json({ error: result.error }, 502);
  }
  return json(result, 200);
}

function methodNotAllowed(): Response {
  return json({ error: "method must be POST" }, 405);
}

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as HEAD,
  methodNotAllowed as OPTIONS,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
