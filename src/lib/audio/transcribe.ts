import { createSilenceDetector, DEFAULT_VAD, rmsOf, type VadOptions } from "./vad";

export type TranscriptionFallback = "no_key" | "failed";

export type TranscriptionResult =
  | { kind: "text"; text: string }
  | { kind: "fallback"; reason: TranscriptionFallback };

export async function transcribeRecording(
  audio: Blob,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  try {
    const response = await fetchImpl("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": audio.type },
      body: audio,
      signal,
    });
    if (!response.ok) return { kind: "fallback", reason: "failed" };

    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return { kind: "fallback", reason: "failed" };
    if ("text" in payload && typeof payload.text === "string" && payload.text.trim()) {
      return { kind: "text", text: payload.text.trim() };
    }
    if ("reason" in payload && payload.reason === "no_key") {
      return { kind: "fallback", reason: "no_key" };
    }
    return { kind: "fallback", reason: "failed" };
  } catch {
    return { kind: "fallback", reason: "failed" };
  }
}

export type ServerRecordingError = TranscriptionFallback | "unavailable" | "denied" | "no-speech";

export interface ServerRecordingCallbacks {
  onListening?: () => void;
  onTranscribing?: () => void;
  onText: (text: string) => void;
  onFallback: (reason: ServerRecordingError) => void;
}

export interface ServerListening {
  /** 지금까지 녹음한 음성을 서버로 보낸다. */
  finish(): void;
  /** 녹음을 버리고 마이크와 진행 중인 전송을 끝낸다. */
  abort(): void;
}

const MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/webm",
  "audio/ogg;codecs=opus",
];
const TICK_MS = 50;

export function serverRecordingAvailable(): boolean {
  return typeof navigator !== "undefined"
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== "undefined"
    && typeof AudioContext !== "undefined";
}

function supportedMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

function permissionDenied(error: unknown): boolean {
  return error instanceof DOMException
    && (error.name === "NotAllowedError" || error.name === "SecurityError");
}

/**
 * 전사용 녹음을 시작한다. 음량은 말 끝을 찾는 데만 쓰고, 녹음은 전송 뒤 참조를 버린다.
 * abort/finish는 마이크 획득 중에도 호출할 수 있다.
 */
export function startServerRecording(
  cb: ServerRecordingCallbacks,
  opts: VadOptions = DEFAULT_VAD,
): ServerListening {
  let aborted = false;
  let ending = false;
  let finishPending = false;
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let context: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let request: AbortController | null = null;
  const chunks: Blob[] = [];

  const stopHardware = () => {
    if (timer) clearInterval(timer);
    timer = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    source?.disconnect();
    source = null;
    if (context) void context.close();
    context = null;
  };

  const failWithoutSending = (reason: ServerRecordingError) => {
    if (aborted || ending) return;
    ending = true;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
    }
    chunks.length = 0;
    stopHardware();
    cb.onFallback(reason);
  };

  const finish = () => {
    if (aborted || ending) return;
    if (!recorder) {
      finishPending = true;
      return;
    }
    ending = true;
    if (recorder.state === "inactive") {
      chunks.length = 0;
      stopHardware();
      cb.onFallback("no-speech");
      return;
    }
    recorder.stop();
    stopHardware();
  };

  void (async () => {
    const mimeType = supportedMimeType();
    if (!serverRecordingAvailable() || !mimeType) {
      failWithoutSending("unavailable");
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      if (aborted) {
        stopHardware();
        return;
      }

      recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 });
      context = new AudioContext();
      source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const detector = createSilenceDetector(opts, performance.now());

      recorder.ondataavailable = (event) => {
        if (!aborted && event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (aborted) {
          chunks.length = 0;
          return;
        }
        const audio = new Blob(chunks, { type: mimeType });
        chunks.length = 0;
        if (!audio.size) {
          cb.onFallback("no-speech");
          return;
        }
        cb.onTranscribing?.();
        request = new AbortController();
        void transcribeRecording(audio, fetch, request.signal).then((result) => {
          request = null;
          if (aborted) return;
          if (result.kind === "text") cb.onText(result.text);
          else cb.onFallback(result.reason);
        });
      };
      recorder.start();
      cb.onListening?.();

      timer = setInterval(() => {
        if (aborted || ending) return;
        analyser.getFloatTimeDomainData(samples);
        const event = detector.feed(rmsOf(samples), performance.now());
        if (event === "speech_end") finish();
        else if (event === "timeout") failWithoutSending("no-speech");
      }, TICK_MS);

      if (finishPending) finish();
    } catch (error) {
      failWithoutSending(permissionDenied(error) ? "denied" : "unavailable");
    }
  })();

  return {
    finish,
    abort() {
      if (aborted) return;
      aborted = true;
      request?.abort();
      request = null;
      if (recorder && recorder.state !== "inactive") {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
      chunks.length = 0;
      stopHardware();
      recorder = null;
    },
  };
}
