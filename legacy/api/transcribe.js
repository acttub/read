const AUDIO_TYPES = new Map([
  ["audio/webm", "webm"],
  ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/wav", "wav"],
  ["audio/ogg", "ogg"],
]);

export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

// audio/* 본문을 문자열이나 객체로 바꾸지 않고 받은 바이트 그대로 읽는다.
export const config = {
  api: { bodyParser: false },
};

function normalizeContentType(contentType) {
  return String(contentType || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function asBytes(body) {
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  return null;
}

export function validateRequest(contentType, body) {
  const audioType = normalizeContentType(contentType);
  if (!AUDIO_TYPES.has(audioType)) {
    return { valid: false, error: "content type is not supported" };
  }

  const audio = asBytes(body);
  if (!audio || audio.byteLength === 0) {
    return { valid: false, error: "audio body must not be empty" };
  }
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    return { valid: false, error: "audio body exceeds 2MB" };
  }

  return {
    valid: true,
    audio,
    audioType,
    extension: AUDIO_TYPES.get(audioType),
  };
}

export async function transcribeAudio(
  audio,
  audioType,
  extension,
  fetchImpl = fetch,
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { text: null, reason: "no_key" };

  const form = new FormData();
  form.set("model", "gpt-4o-mini-transcribe");
  form.set("language", "ko");
  form.set(
    "file",
    new Blob([audio], { type: audioType }),
    `recording.${extension}`,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    return {
      error: error?.name === "AbortError"
        ? "transcription timed out"
        : "transcription request failed",
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) return { error: "transcription request failed" };

  try {
    const result = await response.json();
    if (typeof result.text !== "string") {
      return { error: "transcription response was invalid" };
    }
    return { text: result.text };
  } catch {
    return { error: "transcription response was invalid" };
  }
}

async function readRequestBody(req) {
  if (req.body !== undefined && req.body !== null) return req.body;

  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    length += bytes.byteLength;
    if (length > MAX_AUDIO_BYTES) return Buffer.alloc(length);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method must be POST" });
  }

  const body = await readRequestBody(req);
  const validation = validateRequest(req.headers?.["content-type"], body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  const result = await transcribeAudio(
    validation.audio,
    validation.audioType,
    validation.extension,
  );
  if (result.error) {
    // 녹음도 변환 텍스트도 크기도 남기지 않는다 — privacy.html이 "응답 상태까지만"이라고 약속한다.
    console.error("transcribe: HTTP 502");
    return res.status(502).json({ error: result.error });
  }
  return res.status(200).json(result);
}
