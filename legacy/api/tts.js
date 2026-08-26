const ALLOWED_VOICE_IDS = new Set([
  "cgSgspJ2msm6clMCkdW9",
  "EXAVITQu4vr4xnSDxMaL",
  "bIHbv24MWmeRgasZH58o",
  "cjVigY5qzO86Huf0OWal",
  "iP95p4xoKVk53GoZ742B",
  "SAz9YHcvj6GT2YYXdXww",
]);

export function validateRequest(body) {
  if (!body || !Array.isArray(body.lines)) {
    return { valid: false, error: "lines must be an array" };
  }
  if (body.lines.length === 0) {
    return { valid: false, error: "lines must not be empty" };
  }
  if (body.lines.length > 200) {
    return { valid: false, error: "lines exceed 200" };
  }
  if (body.lines.some((line) => typeof line !== "string")) {
    return { valid: false, error: "lines must contain only strings" };
  }

  const totalCharacters = body.lines.reduce(
    (total, line) => total + line.length,
    0,
  );
  if (totalCharacters > 3000) {
    return { valid: false, error: "total characters exceed 3000" };
  }
  if (!ALLOWED_VOICE_IDS.has(body.voiceId)) {
    return { valid: false, error: "voiceId is not allowed" };
  }

  return {
    valid: true,
    lines: body.lines,
    voiceId: body.voiceId,
  };
}

// 한 번에 띄우는 요청 수. 실측(2026-07-29, 실제 키)에서 이렇게 갈렸다:
//   20줄 한꺼번에 → 성공 4 / 실패 16
//   동시 1 → 10/10 · 2385ms   동시 2 → 10/10 · 1121ms
//   동시 3 → 10/10 ·  900ms   동시 5 →  8/10 · HTTP 401
// 초과 시 429가 아니라 401로 오기 때문에 키 문제로 오해하기 쉽다. 3이 안전한 상한이다.
const CONCURRENCY = 3;

export async function synthesizeLines(
  lines,
  voiceId,
  fetchImpl = fetch,
) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return { audio: lines.map(() => null), reason: "no_key" };
  }

  const endpoint =
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}` +
    "?output_format=mp3_44100_128";

  // 대본 본문은 어떤 로그에도 남기지 않는다. 줄 번호와 상태 코드까지만.
  const speak = async (index) => {
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
        console.error(
          `tts line ${index}: HTTP ${response.status} (voice ${voiceId})`,
        );
        return null;
      }

      const audioBuffer = await response.arrayBuffer();
      return Buffer.from(audioBuffer).toString("base64");
    } catch (error) {
      console.error(`tts line ${index}: ${error.name} (voice ${voiceId})`);
      return null;
    }
  };

  const audio = new Array(lines.length).fill(null);
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

  const failed = audio.filter((item) => item === null).length;
  if (failed > 0) {
    console.error(`tts: ${failed}/${lines.length} lines failed`);
  }
  return { audio, reason: failed === 0 ? "ok" : "upstream_error" };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method must be POST" });
  }

  const validation = validateRequest(req.body);
  if (!validation.valid) {
    // 왜 거절됐는지 프런트가 구분할 수 있게 사유를 같이 준다.
    const reason = validation.error.includes("exceed") ? "too_long" : "invalid";
    return res.status(400).json({ error: validation.error, reason });
  }

  const { audio, reason } = await synthesizeLines(
    validation.lines,
    validation.voiceId,
  );
  // reason은 ok / no_key / upstream_error. 사용자에게 보이는 문구는 같아도 되지만,
  // 배포 환경에서 키가 빠졌을 때 조용한 폴백과 구분하려면 이게 있어야 한다.
  return res.status(200).json({ audio, reason });
}
