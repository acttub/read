const AUDIO_TYPES = new Map([
  ["audio/webm", "webm"],
  ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/wav", "wav"],
  ["audio/ogg", "ogg"],
]);

export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

type ValidTranscribeRequest = {
  valid: true;
  audio: Uint8Array;
  audioType: string;
  extension: string;
};

type InvalidTranscribeRequest = {
  valid: false;
  error: string;
};

export type TranscribeValidation =
  | ValidTranscribeRequest
  | InvalidTranscribeRequest;

function normalizeContentType(contentType: string | null | undefined): string {
  return String(contentType || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function asBytes(body: unknown): Uint8Array | null {
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  return null;
}

export function validateRequest(
  contentType: string | null | undefined,
  body: unknown,
): TranscribeValidation {
  const audioType = normalizeContentType(contentType);
  const extension = AUDIO_TYPES.get(audioType);
  if (!extension) {
    return { valid: false, error: "content type is not supported" };
  }

  const audio = asBytes(body);
  if (!audio || audio.byteLength === 0) {
    return { valid: false, error: "audio body must not be empty" };
  }
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    return { valid: false, error: "audio body exceeds 2MB" };
  }

  return { valid: true, audio, audioType, extension };
}

type TranscribeResult =
  | { text: null; reason: "no_key" }
  | { text: string }
  | { error: string };

export async function transcribeAudio(
  audio: Uint8Array,
  audioType: string,
  extension: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TranscribeResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { text: null, reason: "no_key" };

  const form = new FormData();
  form.set("model", "gpt-4o-mini-transcribe");
  form.set("language", "ko");
  form.set(
    "file",
    new Blob([Uint8Array.from(audio)], { type: audioType }),
    `recording.${extension}`,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    return {
      error:
        error instanceof Error && error.name === "AbortError"
          ? "transcription timed out"
          : "transcription request failed",
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) return { error: "transcription request failed" };

  try {
    const result: unknown = await response.json();
    if (
      !result ||
      typeof result !== "object" ||
      !("text" in result) ||
      typeof result.text !== "string"
    ) {
      return { error: "transcription response was invalid" };
    }
    return { text: result.text };
  } catch {
    return { error: "transcription response was invalid" };
  }
}
