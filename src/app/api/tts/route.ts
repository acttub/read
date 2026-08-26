import { synthesizeLines, validateRequest } from "./core";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function json(payload: unknown, status: number): Response {
  return Response.json(payload, { status, headers: NO_STORE_HEADERS });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // 깨진 JSON 도 다른 잘못된 본문과 똑같이 다룬다 — 검증 계약이 그렇게 되어 있다.
  }

  const validation = validateRequest(body);
  if (!validation.valid) {
    const reason = validation.error.includes("exceed")
      ? "too_long"
      : "invalid";
    return json({ error: validation.error, reason }, 400);
  }

  const result = await synthesizeLines(validation.lines, validation.voiceId);
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
