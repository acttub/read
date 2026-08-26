/**
 * 유료 음성의 준비와 재생.
 *
 * 대사는 리허설 시작 버튼을 누른 뒤에만 서버로 보내며, 받은 오디오는 메모리에만 둔다.
 * 준비되지 않은 줄은 호출자가 기기 음성으로 읽을 수 있도록 null 을 돌려준다.
 */
import { speakableText } from "../script/parse";

export const CLOUD_VOICE_IDS = [
  "cgSgspJ2msm6clMCkdW9",
  "EXAVITQu4vr4xnSDxMaL",
  "bIHbv24MWmeRgasZH58o",
  "cjVigY5qzO86Huf0OWal",
  "iP95p4xoKVk53GoZ742B",
  "SAz9YHcvj6GT2YYXdXww",
] as const;

export interface CloudLine {
  lineId: number;
  text: string;
  voiceId: string;
}

export interface CloudAudioEntry {
  line: CloudLine;
  base64Audio: string;
}

const MAX_LINES_PER_REQUEST = 200;
const MAX_CHARACTERS_PER_REQUEST = 3000;
const prepared = new Map<string, string>();
let player: HTMLAudioElement | null = null;
let preparationId = 0;

/** 등장 순서만으로 정하므로 같은 대본의 같은 배역에는 늘 같은 voiceId가 간다. */
export function assignCloudVoiceIds(roles: string[]): Record<string, string> {
  const assigned: Record<string, string> = {};
  roles.forEach((role, index) => {
    assigned[role] = CLOUD_VOICE_IDS[index % CLOUD_VOICE_IDS.length];
  });
  return assigned;
}

/**
 * 서버 응답에서 실제로 준비된 줄만 고른다.
 * null·빈 문자열·짧은 응답은 실패한 줄이므로 결과에 넣지 않는다.
 */
export function selectCloudAudio(lines: CloudLine[], audio: unknown): CloudAudioEntry[] {
  if (!Array.isArray(audio)) return [];
  const entries: CloudAudioEntry[] = [];
  lines.forEach((line, index) => {
    const value = audio[index];
    if (typeof value === "string" && value.length > 0) {
      entries.push({ line, base64Audio: value });
    }
  });
  return entries;
}

function normalized(lines: CloudLine[]): CloudLine[] {
  return lines.flatMap((line) => {
    const text = speakableText(line.text);
    return text && text.length <= MAX_CHARACTERS_PER_REQUEST ? [{ ...line, text }] : [];
  });
}

/** 라우트의 줄 수·글자 수 상한을 넘지 않으며, 한 요청에는 한 배역의 voiceId만 넣는다. */
export function planCloudRequests(lines: CloudLine[]): CloudLine[][] {
  const byVoice = new Map<string, CloudLine[]>();
  for (const line of normalized(lines)) {
    const group = byVoice.get(line.voiceId) ?? [];
    group.push(line);
    byVoice.set(line.voiceId, group);
  }

  const requests: CloudLine[][] = [];
  for (const group of byVoice.values()) {
    let batch: CloudLine[] = [];
    let characters = 0;
    for (const line of group) {
      if (batch.length >= MAX_LINES_PER_REQUEST || characters + line.text.length > MAX_CHARACTERS_PER_REQUEST) {
        requests.push(batch);
        batch = [];
        characters = 0;
      }
      batch.push(line);
      characters += line.text.length;
    }
    if (batch.length > 0) requests.push(batch);
  }
  return requests;
}

/** 모든 상대 대사를 준비한다. 실패는 기록하지 않아 그 줄만 기기 음성으로 내려간다. */
export async function prepareCloudAudio(lines: CloudLine[]): Promise<void> {
  const currentPreparation = ++preparationId;
  prepared.clear();

  // 라우트 하나가 ElevenLabs 동시 요청 수를 안전한 3개로 제한한다. 여러 라우트 요청을
  // 겹치면 그 상한을 우회하므로 배치는 순서대로 보낸다.
  for (const batch of planCloudRequests(lines)) {
    if (currentPreparation !== preparationId) return;
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: batch.map((line) => line.text),
          voiceId: batch[0].voiceId,
        }),
      });
      if (!response.ok) continue;

      const payload = (await response.json()) as { audio?: unknown; reason?: unknown };
      if (currentPreparation !== preparationId) return;
      for (const entry of selectCloudAudio(batch, payload.audio)) {
        prepared.set(String(entry.line.lineId), `data:audio/mpeg;base64,${entry.base64Audio}`);
      }
      // 키가 없으면 뒤 배치도 모두 같은 결과다. 화면에 오류를 띄우지 않고 준비를 끝낸다.
      if (payload.reason === "no_key") break;
    } catch {
      // 이 배치의 줄만 기기 음성으로 읽는다. 나머지 배치는 계속 준비한다.
    }
  }
}

export function preparedCloudAudio(lineId: number): string | null {
  return prepared.get(String(lineId)) ?? null;
}

export function clearCloudAudio(): void {
  preparationId += 1;
  prepared.clear();
  if (player) {
    player.pause();
    player.removeAttribute("src");
  }
}

function audioElement(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!player) {
    player = new Audio();
    player.preload = "auto";
  }
  return player;
}

/** iOS 자동 재생 제한을 시작 버튼의 사용자 제스처 안에서 미리 연다. */
export function unlockCloudAudio(): void {
  const audio = audioElement();
  if (!audio) return;
  audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
  void audio.play().catch(() => {
    // 첫 실제 재생에서 다시 시도한다.
  });
}

export function playCloudAudio(source: string, signal?: AbortSignal): Promise<boolean> {
  const audio = audioElement();
  if (!audio || signal?.aborted) return Promise.resolve(false);

  return new Promise((resolve) => {
    audio.pause();
    let done = false;
    const finish = (played: boolean) => {
      if (done) return;
      done = true;
      signal?.removeEventListener("abort", onAbort);
      audio.onended = null;
      audio.onerror = null;
      resolve(played);
    };
    const onAbort = () => {
      audio.pause();
      finish(true);
    };

    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    signal?.addEventListener("abort", onAbort);
    audio.src = source;
    void audio.play().catch(() => finish(false));
  });
}
