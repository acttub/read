/**
 * 상대 대사를 소리로 내보내는 곳. 세 가지 엔진이 있다.
 *
 *  device     — 기기 내장 speechSynthesis. 기본값이다.
 *  supertonic — 브라우저 안에서 도는 신경망 음성. 사용자가 모델을 받은 뒤에 쓴다.
 *  cloud      — 시작 전에 서버에서 미리 만든 유료 음성. 준비에 실패한 줄은 device로 읽는다.
 *
 * device·supertonic은 대본을 우리 서버로 보내지 않는다 — 단, 기기에 원격 음성밖에 없으면
 * speechSynthesis 는 텍스트를 브라우저 음성 서비스로 넘긴다. `isRemoteOnly()` 로 알린다.
 */
import { speakableText } from "../script/parse";
import {
  assignCloudVoiceIds,
  clearCloudAudio,
  playCloudAudio,
  prepareCloudAudio as preparePaidAudio,
  preparedCloudAudio,
  unlockCloudAudio,
  type CloudLine,
} from "./cloud";
import { synthesize, load as loadSupertonic } from "./supertonic/engine";
import { playSynthesized, unlockAudio } from "./supertonic/play";
import { VOICE_PRESETS, type VoicePreset } from "./supertonic/models";

export type Engine = "supertonic" | "device" | "cloud";

/** 기기 내장 음성의 말투. 엔진이 포먼트를 보정하지 못하므로 크게 흔들지 않는다. */
export interface VoiceStyle {
  rate: number;
  pitch: number;
  /**
   * 쓸 음성의 순번(품질 순 목록 기준). 목록보다 크면 돌려 쓴다.
   *
   * 예전에는 배역과 무관하게 늘 0번(가장 좋은 것)만 썼다. 그러면 모델을 안 받은 사람에게는
   * 모든 배역이 같은 목소리로 들린다 — 피치만 0.9~1.12 로 흔들 뿐이라 구분이 안 된다.
   * 모델을 안 받은 상태가 첫 방문자의 기본값이라 그쪽이 곧 제품이다.
   */
  voiceIndex: number;
  /**
   * 사용자가 배역에 직접 고른 음성 이름. 고르지 않았으면 없다.
   *
   * ⚠️ 이름을 **말할 때** 목록에서 찾는다. 배정 시점에 인덱스로 바꿔 두면 안 된다 —
   * 크롬은 음성 목록이 비동기로 늦게 차서, 목록이 비어 있는 순간에 배정하면
   * 고른 것이 조용히 버려지고 그 마운트 동안 복구되지 않는다.
   */
  voiceName?: string;
}

/** 배역 하나에 배정된 목소리. 엔진이 바뀌어도 같은 배역은 같은 목소리로 들려야 한다. */
export interface RoleVoice {
  device: VoiceStyle;
  preset: VoicePreset;
  cloudVoiceId: string;
}

/**
 * 기기 음성용 말투 팔레트.
 *
 * 예전에는 pitch 를 0.65~1.5 까지 벌렸는데, 배역은 구분됐지만 사람 목소리에서
 * 멀어졌다. 이제 배역 구분은 Supertonic 프리셋이 맡으므로 여기서는 좁게 둔다.
 */
const DEVICE_STYLES: VoiceStyle[] = [
  { rate: 1.0, pitch: 1.0, voiceIndex: 0 },
  { rate: 0.96, pitch: 1.12, voiceIndex: 1 },
  { rate: 1.04, pitch: 0.9, voiceIndex: 2 },
  { rate: 0.98, pitch: 1.06, voiceIndex: 3 },
  { rate: 1.02, pitch: 0.95, voiceIndex: 4 },
];

/** 남녀가 번갈아 나오도록 섞어 둔다 — 등장 순서대로 집으면 대개 대화처럼 들린다. */
const PRESET_ORDER: VoicePreset[] = ["F1", "M1", "F2", "M2", "F3", "M3", "F4", "M4", "F5", "M5"];

/**
 * 배역 목록을 받아 배역마다 목소리를 정한다.
 * 순서만 보고 정하므로, 같은 대본이면 다시 들어와도 같은 목소리가 나온다.
 */
export function assignVoices(
  roles: string[],
  selectedDeviceVoices: Readonly<Record<string, string>> = {},
): Record<string, RoleVoice> {
  const out: Record<string, RoleVoice> = {};
  const cloudVoiceIds = assignCloudVoiceIds(roles);
  roles.forEach((role, i) => {
    const automaticDevice = DEVICE_STYLES[i % DEVICE_STYLES.length];
    const chosen = selectedDeviceVoices[role];
    out[role] = {
      device: chosen ? { ...automaticDevice, voiceName: chosen } : automaticDevice,
      preset: PRESET_ORDER[i % PRESET_ORDER.length],
      cloudVoiceId: cloudVoiceIds[role],
    };
  });
  return out;
}

/** SpeechSynthesisVoice 중 우리가 보는 부분만. 테스트에서 만들어 넣기 위해 좁혀 뒀다. */
export interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
}

/**
 * 한국어 음성을 품질 순으로 정렬한다.
 *
 * 예전에는 localService 를 우선했는데, 윈도우의 유일한 한국어 로컬 음성이
 * 구형 SAPI5 인 Heami 라서 항상 가장 나쁜 것을 골랐다. 이제는 이름으로 판별한다 —
 * Natural/Neural 계열이 가장 낫고, Heami 는 다른 선택지가 있으면 뒤로 민다.
 */
export function rankKoreanVoices<T extends VoiceLike>(voices: T[]): T[] {
  const score = (v: T): number => {
    const n = v.name.toLowerCase();
    if (/heami/.test(n)) return 0;
    if (/natural|neural/.test(n)) return 4;
    if (/google/.test(n)) return 3;
    return 2;
  };
  return voices
    .filter((v) => v.lang && v.lang.toLowerCase().split(/[-_]/)[0] === "ko")
    .map((v, i) => ({ v, i, s: score(v) }))
    // 점수가 같으면 기기 안에서 도는 쪽이 낫다 — 오프라인이고 대본이 나가지 않는다.
    .sort((a, b) => b.s - a.s || Number(b.v.localService) - Number(a.v.localService) || a.i - b.i)
    .map((x) => x.v);
}

// ─── 기기 내장 음성 ────────────────────────────────────────────────

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function getKoreanVoices(): SpeechSynthesisVoice[] {
  if (!ttsSupported()) return [];
  return rankKoreanVoices(window.speechSynthesis.getVoices() as unknown as VoiceLike[]) as unknown as SpeechSynthesisVoice[];
}

/** 한국어 음성이 있는데 전부 원격이면 true — 화면에서 알려 준다 */
export function isRemoteOnly(): boolean {
  const voices = getKoreanVoices();
  return voices.length > 0 && voices.every((v) => !v.localService);
}

/** Chrome은 getVoices()가 처음엔 빈 배열이라 voiceschanged를 기다린다 */
export function waitForVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  if (!ttsSupported()) return Promise.resolve([]);
  const now = getKoreanVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", done);
      resolve(getKoreanVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", done);
    setTimeout(done, timeoutMs);
  });
}

/**
 * 이 말투로 어떤 음성을 쓸지 고른다.
 * 고른 이름이 있으면 그것, 지금 기기에 없으면 자동 배정 순번으로 돌아간다.
 */
export function pickDeviceVoice<T extends Pick<VoiceLike, "name">>(voices: T[], style: VoiceStyle): T | undefined {
  if (!voices.length) return undefined;
  if (style.voiceName) {
    const chosen = voices.find((v) => v.name === style.voiceName);
    if (chosen) return chosen;
  }
  return voices[style.voiceIndex % voices.length];
}

function speakWithDevice(body: string, style: VoiceStyle, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(body);
    // 배역마다 다른 음성을 준다. 한국어 음성이 하나뿐인 기기에서는 결국 같은 것으로
    // 돌아오고, 그때는 rate·pitch 가 유일한 구분이 된다.
    const voice = pickDeviceVoice(getKoreanVoices(), style);
    if (voice) u.voice = voice;
    u.lang = "ko-KR";
    u.rate = style.rate;
    u.pitch = style.pitch;

    let finished = false;
    let ping: ReturnType<typeof setInterval> | null = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (ping) clearInterval(ping);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      synth.cancel();
      finish();
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort);

    u.onend = finish;
    u.onerror = finish;
    synth.cancel();
    synth.speak(u);
    // Chrome은 15초 넘는 발화를 조용히 끊으므로 pause/resume 핑을 돈다.
    ping = setInterval(() => {
      if (!synth.speaking) return;
      synth.pause();
      synth.resume();
    }, 10000);
  });
}

// ─── 엔진 선택 ────────────────────────────────────────────────────

let engine: Engine = "device";
let playing: AbortController | null = null;

export function getEngine(): Engine {
  return engine;
}

export function setEngine(next: Engine): void {
  if (next === engine) return;
  cancelSpeech();
  if (engine === "cloud") clearCloudAudio();
  engine = next;
}

/**
 * Supertonic 을 켠다. 모델을 받고 한 번 데워 둔다 —
 * WebGPU 는 첫 합성에서 셰이더를 컴파일하느라 3초 넘게 걸린다.
 */
export async function enableSupertonic(onProgress?: Parameters<typeof loadSupertonic>[0]): Promise<void> {
  // 워커가 모델을 연 직후에 스스로 한 번 데우므로 여기서 따로 하지 않는다.
  await loadSupertonic(onProgress);
  engine = "supertonic";
}

/** iOS 는 사용자 제스처 안에서 한 번 소리를 내야 그 뒤 자동 재생이 된다. 버튼 핸들러에서 부른다. */
export function unlockTts(): void {
  unlockAudio();
  unlockCloudAudio();
  if (!ttsSupported()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  window.speechSynthesis.speak(u);
}

export function cancelSpeech(): void {
  playing?.abort();
  playing = null;
  if (ttsSupported()) window.speechSynthesis.cancel();
}

/**
 * 한 대사를 읽고 끝나면 resolve. signal 이 abort 되면 즉시 멈추고 조용히 resolve 한다.
 * Supertonic 이 실패하면 그 자리에서 기기 음성으로 읽는다 — 리허설이 멈추면 안 된다.
 */
export async function speak(text: string, voice: RoleVoice, signal?: AbortSignal, cloudLineId?: number): Promise<void> {
  const body = speakableText(text);
  if (!body) return;

  if (engine === "cloud" && cloudLineId !== undefined) {
    const source = preparedCloudAudio(cloudLineId);
    if (source) {
      const ac = new AbortController();
      playing = ac;
      signal?.addEventListener("abort", () => ac.abort());
      const played = await playCloudAudio(source, ac.signal);
      if (played || signal?.aborted) return;
    }
  }

  if (engine === "supertonic") {
    try {
      const audio = await synthesize(body, voice.preset);
      if (signal?.aborted) return;
      const ac = new AbortController();
      playing = ac;
      signal?.addEventListener("abort", () => ac.abort());
      await playSynthesized(audio, ac.signal);
      return;
    } catch {
      // 아래 기기 음성으로 떨어진다.
    }
  }

  if (!ttsSupported()) return;
  return speakWithDevice(body, voice.device, signal);
}

/** 다음에 나올 대사를 미리 만들어 둔다. 내 차례일 때 불러 두면 상대 대사가 곧바로 나온다. */
export async function prefetch(text: string, voice: RoleVoice): Promise<void> {
  if (engine !== "supertonic") return;
  const body = speakableText(text);
  if (!body) return;
  await synthesize(body, voice.preset).catch(() => {
    // 미리 만들어 두는 것뿐이라 실패해도 그냥 넘어간다.
  });
}

export interface CloudPreparationItem {
  lineId: number;
  text: string;
  voice: RoleVoice;
}

/** 시작 전에 상대 대사를 전부 유료 음성으로 만든다. cloud가 아니면 아무 일도 하지 않는다. */
export async function prepareCloudAudio(items: CloudPreparationItem[]): Promise<void> {
  if (engine !== "cloud") return;
  const lines: CloudLine[] = items.map(({ lineId, text, voice }) => ({ lineId, text, voiceId: voice.cloudVoiceId }));
  await preparePaidAudio(lines);
}

export function clearPreparedCloudAudio(): void {
  clearCloudAudio();
}

// ─── 앞으로 나올 대사를 순서대로 미리 만들어 두는 큐 ───────────────────────
//
// 느린 기기(WebGPU 없는 폰)는 합성이 재생보다 오래 걸린다(RTF > 1). 한 줄만 미리 만들면
// 내 차례가 짧을 때 따라잡지 못해 상대 대사 앞에 침묵이 생긴다. 그래서 앞의 몇 줄을
// 한 번에 하나씩 순서대로 만들어 둔다. 한 번에 하나만 돌리므로 지금 당장 필요한 줄의
// 합성은 길어야 한 줄만 기다린다. 만든 결과는 엔진 캐시에 남는다.

interface PrefetchItem {
  text: string;
  voice: RoleVoice;
}

let prefetchQueue: PrefetchItem[] = [];
let prefetchRunning = false;
let prefetchPaused = false;

async function runPrefetch(): Promise<void> {
  if (prefetchRunning) return;
  prefetchRunning = true;
  try {
    while (prefetchQueue.length > 0 && !prefetchPaused && engine === "supertonic") {
      const item = prefetchQueue.shift()!;
      const body = speakableText(item.text);
      if (!body) continue;
      await synthesize(body, item.voice.preset).catch(() => {
        // 미리 만드는 것뿐이라 실패는 넘어간다. speak 이 다시 시도한다.
      });
    }
  } finally {
    prefetchRunning = false;
  }
}

/** 앞으로 나올 상대 대사들을 순서대로 등록한다. 이미 만든 것은 캐시가 바로 돌려주므로 비용이 없다. */
export function queuePrefetch(items: PrefetchItem[]): void {
  if (engine !== "supertonic") return;
  prefetchQueue = items.slice();
  void runPrefetch();
}

/** 상대가 읽는 동안에는 멈춘다 — 합성과 재생이 자원을 다투면 소리가 끊긴다. */
export function setPrefetchPaused(paused: boolean): void {
  prefetchPaused = paused;
  if (!paused) void runPrefetch();
}

export function clearPrefetch(): void {
  prefetchQueue = [];
}

export { VOICE_PRESETS, type VoicePreset };
