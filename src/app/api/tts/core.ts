const ALLOWED_VOICE_IDS = new Set([
  "cgSgspJ2msm6clMCkdW9",
  "EXAVITQu4vr4xnSDxMaL",
  "bIHbv24MWmeRgasZH58o",
  "cjVigY5qzO86Huf0OWal",
  "iP95p4xoKVk53GoZ742B",
  "SAz9YHcvj6GT2YYXdXww",
]);

// 한 번에 띄우는 요청 수. 실측(2026-07-29, 실제 키)에서 이렇게 갈렸다:
//   20줄 한꺼번에 → 성공 4 / 실패 16
//   동시 1 → 10/10 · 2385ms   동시 2 → 10/10 · 1121ms
//   동시 3 → 10/10 ·  900ms   동시 5 →  8/10 · HTTP 401
// ⚠️ 초과하면 429 가 아니라 401 로 온다 — 키 문제로 오해하기 쉽다. 3이 안전한 상한이다.
// 올리기 전에 실제 키로 다시 재라. 코드만 보고 판단할 수 없는 값이다.
const CONCURRENCY = 3;

type ValidTtsRequest = {
  valid: true;
  lines: string[];
  voiceId: string;
};

type InvalidTtsRequest = {
  valid: false;
  error: string;
};

export type TtsValidation = ValidTtsRequest | InvalidTtsRequest;
export type TtsReason = "ok" | "no_key" | "upstream_error";

export function validateRequest(body: unknown): TtsValidation {
  if (!body || typeof body !== "object" || !("lines" in body)) {
    return { valid: false, error: "lines must be an array" };
  }

  const { lines } = body;
  if (!Array.isArray(lines)) {
    return { valid: false, error: "lines must be an array" };
  }
  if (lines.length === 0) {
    return { valid: false, error: "lines must not be empty" };
  }
  if (lines.length > 200) {
    return { valid: false, error: "lines exceed 200" };
  }
  if (lines.some((line) => typeof line !== "string")) {
    return { valid: false, error: "lines must contain only strings" };
  }

  const stringLines = lines as string[];
  const totalCharacters = stringLines.reduce(
    (total, line) => total + line.length,
    0,
  );
  if (totalCharacters > 3000) {
    return { valid: false, error: "total characters exceed 3000" };
  }

  const voiceId = "voiceId" in body ? body.voiceId : undefined;
  if (typeof voiceId !== "string" || !ALLOWED_VOICE_IDS.has(voiceId)) {
    return { valid: false, error: "voiceId is not allowed" };
  }

  return { valid: true, lines: stringLines, voiceId };
}

export async function synthesizeLines(
  lines: string[],
  voiceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ audio: Array<string | null>; reason: TtsReason }> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return { audio: lines.map(() => null), reason: "no_key" };
  }

  const endpoint =
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}` +
    "?output_format=mp3_44100_128";

  // ⚠️ 대본 본문은 어떤 로그에도 남기지 않는다. 줄 번호와 상태 코드까지만.
  const speak = async (index: number): Promise<string | null> => {
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: lines[index],
          model_id: "eleven_flash_v2_5",
        }),
      });

      if (!response.ok) {
        console.error(`tts line ${index}: HTTP ${response.status}`);
        return null;
      }

      const audioBuffer = await response.arrayBuffer();
      return Buffer.from(audioBuffer).toString("base64");
    } catch {
      console.error(`tts line ${index}: HTTP 502`);
      return null;
    }
  };

  const audio: Array<string | null> = new Array(lines.length).fill(null);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, lines.length) }, async () => {
      while (cursor < lines.length) {
        const index = cursor;
        cursor += 1;
        audio[index] = await speak(index);
      }
    }),
  );

  // 실패한 줄만 한 번 더 — 요청이 몰렸을 때의 일시적 거부가 대부분이라
  // 순차로 다시 부르면 대개 살아난다.
  for (let index = 0; index < audio.length; index += 1) {
    if (audio[index] === null) audio[index] = await speak(index);
  }

  return {
    audio,
    reason: audio.includes(null) ? "upstream_error" : "ok",
  };
}
