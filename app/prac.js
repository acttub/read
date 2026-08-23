import { lastWord, parseScript } from "./parse.js";
import { filterTurnsByRoleParams } from "./role-inclusion.js";
import {
  resolveVoiceForRole,
  supportsSpeechSynthesis,
  unlockSpeechSynthesis,
} from "./voices.js";
import {
  readAdvanceMode,
  readEngine,
  readMyRole,
  readRoleParams,
  readScript,
  readSilenceSec,
  readVoiceId,
} from "./storage.js";
import { trackCore, trackEvent, trackMetric, trackTtsPlay } from "./tracking.js";

const myRole = readMyRole();

if (!myRole) {
  window.location.replace("/char");
} else {
  initializePracticePage();
}

function initializePracticePage() {
  const { turns: parsedTurns } = parseScript(readScript());
  const roleParams = readRoleParams();
  // 옛 세션은 roleParams가 비어 있을 수 있다. 그 경우에는 이전 동작처럼 전부 읽는다.
  const turns = filterTurnsByRoleParams(parsedTurns, roleParams);
  const advanceMode = readAdvanceMode();
  let engine = readEngine();
  const voiceId = readVoiceId();
  const silenceThresholdMs = readSilenceSec() * 1000;
  trackEvent("practice_start");
  const practiceStartedAt = Date.now();
  let staySent = false;

  const readingSurface = document.getElementById("readingSurface");
  const currentLineCard = document.getElementById("currentLineCard");
  const currentRoleName = document.getElementById("currentRoleName");
  const currentLineText = document.getElementById("currentLineText");
  const progressText = document.getElementById("progressText");
  const mobileRemaining = document.getElementById("mobileRemaining");
  const elapsedTime = document.getElementById("elapsedTime");
  const mobileElapsed = document.getElementById("mobileElapsed");
  const readingPastTurns = document.getElementById("readingPastTurns");
  const readingNextTurn = document.getElementById("readingNextTurn");
  const statusPill = document.getElementById("statusPill");
  const modeError = document.getElementById("modeError");
  const completionMessage = document.getElementById("completionMessage");
  const pauseButton = document.getElementById("pauseButton");
  const nextButton = document.getElementById("nextButton");
  const modeHint = document.getElementById("modeHint");
  document.getElementById("sessionTitle").textContent = `리딩 중 · ${myRole}`;

  const RMS_THRESHOLD = 0.02;
  const SpeechRecognitionCtor =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  // 그 순간 눌러야 할 것이 항상 파란 주 버튼이 되게 한다(시작 전엔 "시작", 내 차례를
  // 기다릴 땐 "다음"). syncControls()가 이 두 클래스를 오가며 갈아 끼운다.
  const PRIMARY_BUTTON_CLASS =
    "session-control-primary";
  const SECONDARY_BUTTON_CLASS =
    "session-control-secondary";

  let idx = 0;
  let sessionActive = true;
  let started = false;
  let paused = true;
  let ended = false;
  let waitingForMyTurn = false;

  let currentUtterance = null;
  let speechWasPaused = false;
  let pendingSpeechAdvance = false;
  const cloudAudioByTurn = new Map();
  let showedCloudLineFallback = false;

  let directionTimer = null;
  let directionDueAt = 0;
  let directionRemainingMs = 700;

  let audioCtx = null;
  let analyser = null;
  let micStream = null;
  let micAcquisitionPromise = null;
  let micRequestActive = false;
  let silenceRafId = null;
  let silenceState = "idle";
  let hasSpokenOnce = false;
  let silenceStartTs = 0;
  let silenceElapsedBeforePause = 0;

  let recognition = null;
  let cueRestartTimer = null;
  let cueRestartAllowed = false;

  // 발화가 onend/onerror 둘 다 없이 조용히 죽는 사례가 실제로 재현됐다(28초 동안 멈춤).
  // 그러면 "다음"이 그때까진 비활성이라 나가기밖에 할 게 없었다 — 그래서 다음도 항상
  // 누를 수 있게 하고, 이 워치독으로 응답이 없으면 스스로 넘어가게 한다.
  let speechWatchdogTimer = null;
  let speechWatchdogDueAt = 0;
  let speechWatchdogRemainingMs = 0;
  let sessionClockTimer = null;

  const modeHints = {
    tap: "화면을 누르면 다음으로",
    silence: "말이 끝나고 잠깐 조용해지면 다음으로 넘어가요",
    cue: "마지막 어절이 들리면 다음으로",
  };

  function setStatus(text, tone = "neutral") {
    statusPill.textContent = text;
    statusPill.className = "sr-only";
  }

  function formatElapsed(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function updateElapsedTime() {
    const value = formatElapsed(Date.now() - practiceStartedAt);
    elapsedTime.textContent = value;
    mobileElapsed.textContent = value;
  }

  function scheduleSessionClock() {
    updateElapsedTime();
    sessionClockTimer = window.setTimeout(() => {
      sessionClockTimer = null;
      if (!sessionActive || ended) return;
      scheduleSessionClock();
    }, 1000);
  }

  function makeContextTurn(turn, className) {
    const item = document.createElement("div");
    item.className = className;
    if (!turn.isDirection) {
      const role = document.createElement("p");
      role.textContent = turn.role === myRole ? `${turn.role} · 내 대사` : turn.role;
      item.append(role);
    }
    const text = document.createElement("p");
    text.className = "font-script";
    text.textContent = turn.text;
    item.append(text);
    return item;
  }

  function renderTurnContext() {
    const fragment = document.createDocumentFragment();
    for (let index = Math.max(0, idx - 2); index < idx; index += 1) {
      fragment.append(makeContextTurn(turns[index], "reading-context-turn"));
    }
    readingPastTurns.replaceChildren(fragment);

    readingNextTurn.replaceChildren();
    const nextTurn = turns[idx + 1];
    if (nextTurn) {
      readingNextTurn.append(makeContextTurn(nextTurn, "reading-context-turn"));
      readingNextTurn.hidden = false;
    } else {
      readingNextTurn.hidden = true;
    }
  }

  function renderCurrentTurn(turn) {
    const remaining = Math.max(turns.length - idx, 0);
    progressText.textContent = String(remaining);
    mobileRemaining.textContent = String(remaining);
    renderTurnContext();
    currentRoleName.textContent =
      turn.role === myRole && !turn.isDirection
        ? `${turn.role} · 내 차례`
        : turn.role;
    currentLineText.textContent = turn.text;

    const isMyTurn = turn.role === myRole && !turn.isDirection;
    currentLineCard.classList.toggle("bg-primary-soft", isMyTurn);
    currentLineCard.classList.toggle("bg-surface", !isMyTurn);

    currentLineText.className = turn.isDirection
      ? "font-script is-direction"
      : "font-script";
  }

  function renderInitialState() {
    completionMessage.classList.add("hidden");

    if (turns.length === 0) {
      showEnd();
      return;
    }

    renderCurrentTurn(turns[0]);
    // "/char"에서 이미 "연습 시작"을 눌렀는데 여기서 또 눌러야 해서(iOS 발화 잠금 때문에
    // 불가피하다) 화면이 침묵하면 멈춘 것처럼 보인다. 알약과 힌트가 먼저 무엇을 눌러야
    // 하는지 말한다. 넘김 방식별 힌트("화면을 누르면 다음으로" 등)는 실제로 시작한 뒤에나
    // 의미가 있으므로 그 전엔 보여주지 않는다.
    setStatus("누르면 시작해요");
    modeHint.textContent = "시작을 누르면 읽어드릴게요";
    syncControls();
  }

  // 버튼 활성/비활성과 "지금 눌러야 할 파란 버튼이 어느 쪽인가"를 한곳에서 정한다.
  // 상태(started/paused/ended/waitingForMyTurn)가 바뀌는 모든 지점에서 이것 하나만 부른다.
  function syncControls() {
    pauseButton.disabled = ended;
    // "다음"은 내 차례를 기다릴 때만이 아니라, 시작한 뒤라면(상대역이 읽어주는 중이든
    // 지문 자동 넘김 중이든) 언제나 눌러서 강제로 넘길 수 있다 — 발화가 응답 없이
    // 멈췄을 때 나가기 말고 쓸 수 있는 탈출구이자, 이미 아는 대사를 건너뛰는 자연스러운
    // 동작이기도 하다.
    nextButton.disabled = !started || paused || ended;

    const pauseIsPrimary = !started || paused;
    pauseButton.className = pauseIsPrimary
      ? PRIMARY_BUTTON_CLASS
      : SECONDARY_BUTTON_CLASS;

    const nextIsPrimary = started && !paused && !ended && waitingForMyTurn;
    nextButton.className = nextIsPrimary
      ? PRIMARY_BUTTON_CLASS
      : SECONDARY_BUTTON_CLASS;
  }

  function stopDirectionTimer({ preserveRemaining = false } = {}) {
    if (!directionTimer) return;
    if (preserveRemaining) {
      directionRemainingMs = Math.max(0, directionDueAt - performance.now());
    }
    clearTimeout(directionTimer);
    directionTimer = null;
  }

  function scheduleDirectionAdvance(turn, delay = 700) {
    directionRemainingMs = delay;
    directionDueAt = performance.now() + delay;
    directionTimer = window.setTimeout(() => {
      directionTimer = null;
      directionRemainingMs = 700;
      if (!sessionActive || paused || turns[idx] !== turn) return;
      idx += 1;
      processTurn();
    }, delay);
  }

  function computeWatchdogMs(text) {
    const estimated = 2000 + (text ? text.length : 0) * 180;
    return Math.min(30000, Math.max(5000, estimated));
  }

  function stopSpeechWatchdog({ preserveRemaining = false } = {}) {
    if (!speechWatchdogTimer) return;
    if (preserveRemaining) {
      speechWatchdogRemainingMs = Math.max(
        0,
        speechWatchdogDueAt - performance.now(),
      );
    }
    clearTimeout(speechWatchdogTimer);
    speechWatchdogTimer = null;
  }

  function scheduleSpeechWatchdog(turn, delay) {
    speechWatchdogRemainingMs = delay;
    speechWatchdogDueAt = performance.now() + delay;
    speechWatchdogTimer = window.setTimeout(() => {
      speechWatchdogTimer = null;
      if (!sessionActive || paused || turns[idx] !== turn) return;
      // 여기서 modeError에 안내를 남겨도 바로 이어지는 processTurn()이 다음 줄을
      // 그리면서 즉시 지운다(그 함수가 매번 modeError를 비운다) — 같은 동기 흐름 안이라
      // 사용자는 볼 틈이 없다. 억지로 지연시켜 보여주면 그사이 일시정지가 끼어드는
      // 경합만 늘어나므로, 메시지 없이 조용히 넘긴다.
      if (currentUtterance) {
        currentUtterance.onend = null;
        currentUtterance.onerror = null;
      }
      if (supportsSpeechSynthesis()) window.speechSynthesis.cancel();
      handleSpeechFinished(turn);
    }, delay);
  }

  function handleSpeechFinished(turn) {
    currentUtterance = null;
    speechWasPaused = false;
    if (!sessionActive || turns[idx] !== turn) return;

    if (paused) {
      pendingSpeechAdvance = true;
      return;
    }

    idx += 1;
    processTurn();
  }

  function isCloudUtterance(utterance = currentUtterance) {
    return Boolean(utterance && utterance.kind === "cloud");
  }

  function finishCloudSpeech(audio, turn, errorMessage = "") {
    if (currentUtterance !== audio || turns[idx] !== turn) return;

    audio.onend = null;
    audio.onerror = null;
    stopSpeechWatchdog();
    if (errorMessage) modeError.textContent = errorMessage;
    handleSpeechFinished(turn);
  }

  function playCloudAudio(audio, turn) {
    const playPromise = audio.play();
    trackTtsPlay();
    if (!playPromise || typeof playPromise.catch !== "function") return;

    playPromise.catch(() => {
      // pause() 직후 play()의 Promise가 AbortError로 거절될 수 있다. 일시정지나
      // 수동 스킵으로 이미 재생 대상이 바뀐 경우에는 재생 오류로 처리하지 않는다.
      if (paused || currentUtterance !== audio) return;
      finishCloudSpeech(
        audio,
        turn,
        "자연스러운 음성을 재생하지 못해 다음 대사로 넘어갑니다.",
      );
    });
  }

  function speakLineCloud(turn, source) {
    const audio = new Audio(source);
    audio.kind = "cloud";

    // 기존 워치독과 수동 스킵은 currentUtterance.onend = null로 콜백을 끊는다.
    // Audio의 실제 이벤트 이름인 onended를 이 계약에 맞추고, 워치독이 발동하면
    // 다음 줄로 넘어가는 동안 이전 mp3도 실제로 멈추게 한다.
    Object.defineProperty(audio, "onend", {
      configurable: true,
      get() {
        return audio.onended;
      },
      set(handler) {
        audio.onended = handler;
        if (handler === null) audio.pause();
      },
    });

    currentUtterance = audio;
    scheduleSpeechWatchdog(turn, computeWatchdogMs(turn.text));
    audio.onend = () => {
      finishCloudSpeech(audio, turn);
    };
    audio.onerror = () => {
      finishCloudSpeech(
        audio,
        turn,
        "자연스러운 음성을 재생하지 못해 다음 대사로 넘어갑니다.",
      );
    };
    playCloudAudio(audio, turn);
  }

  function speakLine(turn) {
    if (engine === "cloud") {
      const cloudSource = cloudAudioByTurn.get(idx);
      if (cloudSource) {
        speakLineCloud(turn, cloudSource);
        return;
      }

      if (!showedCloudLineFallback) {
        showedCloudLineFallback = true;
        modeError.textContent =
          "일부 대사는 자연스러운 음성으로 준비되지 못해 기기 음성으로 대신 읽습니다.";
      }
    }

    if (!supportsSpeechSynthesis()) {
      setStatus("음성 합성 미지원");
      modeError.textContent =
        "이 브라우저에서 음성 합성을 지원하지 않습니다.";
      return;
    }

    const params = roleParams[turn.role] || {
      voiceName: null,
      rate: 1,
      pitch: 1,
    };
    const { voice, usedFallback } = resolveVoiceForRole(params);

    if (usedFallback && voice) {
      modeError.textContent =
        `설정한 음성을 찾을 수 없어 "${voice.name}"(으)로 대신 읽습니다.`;
    } else if (!voice) {
      modeError.textContent =
        "사용 가능한 한국어 음성이 없어 브라우저 기본 음성으로 읽습니다.";
    }

    const utterance = new SpeechSynthesisUtterance(turn.text);
    utterance.lang = "ko-KR";
    utterance.rate = Number(params.rate) || 1;
    utterance.pitch = Number.isFinite(Number(params.pitch))
      ? Number(params.pitch)
      : 1;
    if (voice) utterance.voice = voice;

    currentUtterance = utterance;
    scheduleSpeechWatchdog(turn, computeWatchdogMs(turn.text));
    utterance.onend = () => {
      stopSpeechWatchdog();
      handleSpeechFinished(turn);
    };
    utterance.onerror = (event) => {
      stopSpeechWatchdog();
      modeError.textContent =
        `음성 재생 오류: ${event.error || "알 수 없는 오류"}`;
      handleSpeechFinished(turn);
    };
    window.speechSynthesis.speak(utterance);
    trackTtsPlay();
  }

  async function prepareCloudAudio() {
    const cloudTurns = [];
    turns.forEach((turn, turnIndex) => {
      if (turn.role !== myRole && !turn.isDirection) {
        cloudTurns.push({ turnIndex, text: turn.text });
      }
    });

    const lineCount = cloudTurns.length;
    pauseButton.disabled = true;
    pauseButton.textContent = `목소리 준비 중… (${lineCount}줄)`;
    setStatus(`목소리 준비 중… (${lineCount}줄)`, "primary");

    try {
      if (lineCount === 0) return true;

      const response = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lines: cloudTurns.map(({ text }) => text),
          voiceId,
        }),
      });
      if (!response.ok) throw new Error("tts request failed");

      const payload = await response.json();
      if (!Array.isArray(payload.audio)) {
        throw new Error("tts response is invalid");
      }

      payload.audio.forEach((base64Audio, lineIndex) => {
        const cloudTurn = cloudTurns[lineIndex];
        if (
          cloudTurn &&
          typeof base64Audio === "string" &&
          base64Audio.length > 0
        ) {
          cloudAudioByTurn.set(
            cloudTurn.turnIndex,
            `data:audio/mpeg;base64,${base64Audio}`,
          );
        }
      });

      if (cloudAudioByTurn.size === 0) {
        throw new Error("tts response has no audio");
      }
      return true;
    } catch {
      engine = "device";
      cloudAudioByTurn.clear();
      return false;
    } finally {
      pauseButton.disabled = false;
      pauseButton.textContent = "일시정지";
    }
  }

  function ensureMic() {
    if (micStream && analyser) {
      if (audioCtx && audioCtx.state === "suspended") {
        return audioCtx.resume().then(() => true).catch((error) => {
          modeError.textContent =
            `마이크 재연결 실패: ${error.name}${error.message ? ` — ${error.message}` : ""}`;
          return false;
        });
      }
      return Promise.resolve(true);
    }

    // 이미 요청이 진행 중이면 새로 하나 더 걸지 않고 그 결과를 같이 기다린다 —
    // 안 그러면 겹친 호출이 서로 다른 스트림을 받아 micStream을 덮어써 먼저 받은
    // 스트림의 트랙을 추적 못 하고 흘려버릴 수 있다.
    if (micAcquisitionPromise) return micAcquisitionPromise;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      modeError.textContent =
        "이 브라우저에서 마이크 입력(getUserMedia)을 지원하지 않습니다.";
      return Promise.resolve(false);
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      modeError.textContent =
        "이 브라우저에서 오디오 분석(AudioContext)을 지원하지 않습니다.";
      return Promise.resolve(false);
    }

    micRequestActive = true;
    micAcquisitionPromise = navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        micAcquisitionPromise = null;
        // 기다리는 사이 일시정지·나가기 등으로 더 이상 마이크가 필요 없어졌으면
        // 방금 받은 스트림을 바로 끈다 — 안 그러면 화면은 꺼졌는데 마이크만 켜진 채
        // 남는다.
        if (!micRequestActive) {
          stream.getTracks().forEach((track) => track.stop());
          return false;
        }
        micStream = stream;
        audioCtx = new AudioContextCtor();
        const source = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        return true;
      })
      .catch((error) => {
        micAcquisitionPromise = null;
        modeError.textContent =
          `마이크 접근 실패: ${error.name}${error.message ? ` — ${error.message}` : ""}`;
        return false;
      });
    return micAcquisitionPromise;
  }

  function stopSilenceLoop({ preserveState = false } = {}) {
    if (silenceRafId) {
      cancelAnimationFrame(silenceRafId);
      silenceRafId = null;
    }

    if (
      preserveState &&
      silenceState === "silence" &&
      silenceStartTs > 0
    ) {
      silenceElapsedBeforePause = Math.max(
        0,
        performance.now() - silenceStartTs,
      );
    }
  }

  function startSilenceMode(turn, { reset = true } = {}) {
    if (reset) {
      silenceState = "idle";
      hasSpokenOnce = false;
      silenceStartTs = 0;
      silenceElapsedBeforePause = 0;
    } else if (silenceState === "silence") {
      silenceStartTs =
        performance.now() - silenceElapsedBeforePause;
    }

    ensureMic().then((ready) => {
      if (
        !ready ||
        !sessionActive ||
        paused ||
        !waitingForMyTurn ||
        advanceMode !== "silence" ||
        turns[idx] !== turn
      ) {
        return;
      }

      const data = new Uint8Array(analyser.fftSize);

      function tick() {
        if (
          !sessionActive ||
          paused ||
          !waitingForMyTurn ||
          advanceMode !== "silence" ||
          turns[idx] !== turn
        ) {
          return;
        }

        analyser.getByteTimeDomainData(data);
        let sumSq = 0;
        for (let index = 0; index < data.length; index += 1) {
          const value = (data[index] - 128) / 128;
          sumSq += value * value;
        }
        const rms = Math.sqrt(sumSq / data.length);

        if (rms > RMS_THRESHOLD) {
          hasSpokenOnce = true;
          silenceState = "speaking";
          silenceStartTs = 0;
          silenceElapsedBeforePause = 0;
        } else if (hasSpokenOnce) {
          if (silenceState !== "silence") {
            silenceState = "silence";
            silenceStartTs =
              performance.now() - silenceElapsedBeforePause;
          }

          if (
            performance.now() - silenceStartTs >=
            silenceThresholdMs
          ) {
            advanceFromMyTurn();
            return;
          }
        }

        silenceRafId = requestAnimationFrame(tick);
      }

      silenceRafId = requestAnimationFrame(tick);
    });
  }

  function stopCueRecognition() {
    cueRestartAllowed = false;
    if (cueRestartTimer) {
      clearTimeout(cueRestartTimer);
      cueRestartTimer = null;
    }
    if (!recognition) return;

    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.stop();
    } catch {
      // The recognition instance may already be stopped.
    }
    recognition = null;
  }

  function startCueMode(turn) {
    if (!SpeechRecognitionCtor) {
      modeError.textContent =
        "이 브라우저에서 음성 인식(SpeechRecognition)을 지원하지 않습니다.";
      return;
    }

    const target = lastWord(turn.text);
    if (!target) {
      modeError.textContent = "마지막 어절을 찾을 수 없습니다.";
      return;
    }

    stopCueRecognition();
    recognition = new SpeechRecognitionCtor();
    recognition.lang = "ko-KR";
    recognition.continuous = true;
    recognition.interimResults = true;
    cueRestartAllowed = true;
    let finalTranscript = "";

    recognition.onresult = (event) => {
      let interimTranscript = "";
      for (
        let resultIndex = event.resultIndex;
        resultIndex < event.results.length;
        resultIndex += 1
      ) {
        const transcript = event.results[resultIndex][0].transcript;
        if (event.results[resultIndex].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      const fullTranscript = finalTranscript + interimTranscript;
      const normalizedTarget = target.replace(/\s/g, "");
      if (
        normalizedTarget &&
        fullTranscript.replace(/\s/g, "").includes(normalizedTarget)
      ) {
        cueRestartAllowed = false;
        advanceFromMyTurn();
      }
    };

    recognition.onerror = (event) => {
      modeError.textContent = `음성 인식 오류: ${event.error}`;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        cueRestartAllowed = false;
      }
    };

    recognition.onend = () => {
      if (
        !cueRestartAllowed ||
        !sessionActive ||
        paused ||
        !waitingForMyTurn ||
        advanceMode !== "cue" ||
        turns[idx] !== turn
      ) {
        return;
      }

      cueRestartTimer = window.setTimeout(() => {
        cueRestartTimer = null;
        if (!recognition || paused || !waitingForMyTurn) return;
        try {
          recognition.start();
        } catch (error) {
          modeError.textContent = `인식 다시 시작 실패: ${error.message}`;
        }
      }, 150);
    };

    try {
      recognition.start();
    } catch (error) {
      cueRestartAllowed = false;
      modeError.textContent = `인식 시작 실패: ${error.message}`;
    }
  }

  function stopAdvanceListeners({ preserveSilence = false } = {}) {
    stopSilenceLoop({ preserveState: preserveSilence });
    stopCueRecognition();
  }

  function showMyTurn(turn, { reset = true } = {}) {
    waitingForMyTurn = true;
    setStatus("말이 끝나길 기다리는 중");
    syncControls();

    if (advanceMode === "silence") {
      startSilenceMode(turn, { reset });
    } else if (advanceMode === "cue") {
      startCueMode(turn);
    }
  }

  function advanceFromMyTurn() {
    if (
      !sessionActive ||
      paused ||
      !waitingForMyTurn ||
      idx >= turns.length
    ) {
      return;
    }

    waitingForMyTurn = false;
    stopAdvanceListeners();
    idx += 1;
    processTurn();
  }

  function processTurn() {
    if (!sessionActive || !started || paused || ended) return;

    modeError.textContent = "";
    waitingForMyTurn = false;
    syncControls();

    if (idx >= turns.length) {
      showEnd();
      return;
    }

    const turn = turns[idx];
    renderCurrentTurn(turn);

    if (turn.isDirection) {
      setStatus("지문");
      directionRemainingMs = 700;
      scheduleDirectionAdvance(turn, directionRemainingMs);
      return;
    }

    if (turn.role === myRole) {
      showMyTurn(turn);
      return;
    }

    setStatus("읽어주는 중", "primary");
    speakLine(turn);
  }

  function pauseReading() {
    if (!started || paused || ended) return;

    paused = true;
    pauseButton.textContent = "이어하기";
    setStatus("일시정지");
    syncControls();

    if (isCloudUtterance()) {
      currentUtterance.pause();
      speechWasPaused = true;
      stopSpeechWatchdog({ preserveRemaining: true });
    } else if (currentUtterance && supportsSpeechSynthesis()) {
      window.speechSynthesis.pause();
      speechWasPaused = true;
      stopSpeechWatchdog({ preserveRemaining: true });
    }

    if (directionTimer) {
      stopDirectionTimer({ preserveRemaining: true });
    }

    if (waitingForMyTurn) {
      if (advanceMode === "silence") {
        stopSilenceLoop({ preserveState: true });
        // 분석 루프만 멈추면 마이크 표시등은 계속 켜져 있다 — 일시정지면 트랙 자체를
        // 끈다. 이어하기에서 ensureMic()이 새로 얻는다(같은 탭이라 권한은 다시 안 묻는다).
        releaseMic();
      } else if (advanceMode === "cue") {
        stopCueRecognition();
      }
    }
  }

  function resumeReading() {
    if (!started || !paused || ended) return;

    paused = false;
    pauseButton.textContent = "일시정지";

    if (pendingSpeechAdvance) {
      pendingSpeechAdvance = false;
      idx += 1;
      processTurn();
      return;
    }

    if (isCloudUtterance() && speechWasPaused) {
      speechWasPaused = false;
      setStatus("읽어주는 중", "primary");
      playCloudAudio(currentUtterance, turns[idx]);
      scheduleSpeechWatchdog(
        turns[idx],
        Math.max(1000, speechWatchdogRemainingMs),
      );
      syncControls();
      return;
    }

    if (currentUtterance && speechWasPaused && supportsSpeechSynthesis()) {
      speechWasPaused = false;
      setStatus("읽어주는 중", "primary");
      window.speechSynthesis.resume();
      scheduleSpeechWatchdog(
        turns[idx],
        Math.max(1000, speechWatchdogRemainingMs),
      );
      syncControls();
      return;
    }

    const turn = turns[idx];
    if (!turn) {
      showEnd();
      return;
    }

    if (turn.isDirection && directionRemainingMs >= 0) {
      setStatus("지문");
      scheduleDirectionAdvance(turn, directionRemainingMs);
      syncControls();
      return;
    }

    if (waitingForMyTurn) {
      showMyTurn(turn, { reset: false });
      return;
    }

    processTurn();
  }

  function showEnd() {
    ended = true;
    paused = false;
    waitingForMyTurn = false;
    stopAdvanceListeners();
    stopDirectionTimer();
    stopSpeechWatchdog();
    const endingUtterance = currentUtterance;
    currentUtterance = null;

    if (isCloudUtterance(endingUtterance)) {
      endingUtterance.onend = null;
      endingUtterance.onerror = null;
      endingUtterance.pause();
    } else if (supportsSpeechSynthesis()) {
      window.speechSynthesis.cancel();
    }

    progressText.textContent = "0";
    mobileRemaining.textContent = "0";
    updateElapsedTime();
    if (sessionClockTimer) window.clearTimeout(sessionClockTimer);
    sessionClockTimer = null;
    currentRoleName.textContent = "";
    currentLineText.textContent = "대본을 다 읽었어요";
    currentLineText.className =
      "m-0 font-script text-[22px] font-bold leading-[1.45] text-ink";
    currentLineCard.classList.remove("bg-primary-soft");
    currentLineCard.classList.add("bg-surface");
    completionMessage.classList.remove("hidden");
    readingSurface.classList.add("reading-complete");
    setStatus("완료");
    modeError.textContent = "";
    pauseButton.textContent = "일시정지";
    syncControls();
    cleanupMedia();
  }

  function releaseMic() {
    micRequestActive = false;
    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
      micStream = null;
    }
    analyser = null;

    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
  }

  function cleanupMedia() {
    stopSilenceLoop();
    stopCueRecognition();
    releaseMic();
  }

  function stopSession() {
    sessionActive = false;
    waitingForMyTurn = false;
    stopDirectionTimer();
    stopSpeechWatchdog();
    cleanupMedia();
    if (sessionClockTimer) window.clearTimeout(sessionClockTimer);
    sessionClockTimer = null;
    if (isCloudUtterance()) {
      currentUtterance.onend = null;
      currentUtterance.onerror = null;
      currentUtterance.pause();
      currentUtterance = null;
    } else if (supportsSpeechSynthesis()) {
      window.speechSynthesis.cancel();
    }

    // 나가기 버튼과 pagehide 가 둘 다 이걸 부른다. 경계를 걸치면 인접한 두 구간이
    // 모두 찍히므로 한 번만 보낸다.
    // 이름이 practice_* 가 아니라 stay_* 인 이유: 준비·일시정지·백그라운드가 다 들어간
    // 화면 체류 시간이지 실제로 소리 내어 연습한 시간이 아니다.
    if (!staySent && practiceStartedAt) {
      staySent = true;
      const elapsedMs = Date.now() - practiceStartedAt;
      if (elapsedMs < 60000) trackMetric("stay_under_1m");
      else if (elapsedMs <= 300000) trackMetric("stay_1_5m");
      else trackMetric("stay_over_5m");
    }
  }

  // 상대역 대사가 재생 중이거나 지문 자동 넘김을 기다리는 중에 "다음"을 눌렀을 때만 온다
  // (내 차례 대기 중이면 nextButton 클릭 핸들러가 advanceFromMyTurn으로 보낸다).
  // 응답 없이 멈춘 발화의 탈출구이자, 이미 아는 대사를 건너뛰는 동작이기도 하다.
  function skipCurrentAutoTurn() {
    stopSpeechWatchdog();
    stopDirectionTimer();

    if (currentUtterance) {
      currentUtterance.onend = null;
      currentUtterance.onerror = null;
    }
    if (isCloudUtterance()) {
      currentUtterance.pause();
    } else if (supportsSpeechSynthesis()) {
      window.speechSynthesis.cancel();
    }
    currentUtterance = null;

    idx += 1;
    processTurn();
  }

  pauseButton.addEventListener("click", async () => {
    if (ended) return;

    if (!started) {
      unlockSpeechSynthesis();

      if (engine === "cloud") {
        const cloudReady = await prepareCloudAudio();
        if (!sessionActive || ended) return;

        started = true;
        paused = false;
        pauseButton.textContent = "일시정지";
        processTurn();
        if (!cloudReady && !ended) {
          modeError.textContent =
            "자연스러운 음성을 준비하지 못해 기기 음성으로 시작합니다.";
        }
        return;
      }

      started = true;
      paused = false;
      pauseButton.textContent = "일시정지";
      processTurn();
      return;
    }

    if (paused) {
      resumeReading();
    } else {
      pauseReading();
    }
  });

  nextButton.addEventListener("click", () => {
    if (!sessionActive || !started || paused || ended) return;
    if (waitingForMyTurn) {
      advanceFromMyTurn();
      return;
    }
    skipCurrentAutoTurn();
  });

  readingSurface.addEventListener("click", (event) => {
    if (
      event.target.closest("button, a, input, select, textarea, label")
    ) {
      return;
    }

    if (
      started &&
      sessionActive &&
      !paused &&
      advanceMode === "tap" &&
      waitingForMyTurn
    ) {
      advanceFromMyTurn();
    }
  });

  document.getElementById("exitButton").addEventListener("click", () => {
    stopSession();
    window.location.href = "/input";
  });

  const coreLink = completionMessage.querySelector(
    'a[href="https://acttub.com"]',
  );
  if (coreLink) {
    coreLink.addEventListener("click", () => {
      trackCore("read", coreLink.href);
      trackEvent("cta_click");
      if (window.gtag) window.gtag("event", "acttub_cta", { from: "read" });
    });
  }

  window.addEventListener("pagehide", stopSession, { once: true });

  // bfcache로 이 페이지에 뒤로 돌아오면(event.persisted) 스크립트는 다시 안 돌고
  // DOM만 그대로 복원된다 — pagehide가 이미 sessionActive를 꺼놨으므로 그 상태로
  // 영구히 멈춰 있게 된다. 가장 안전한 복구는 새로 불러오는 것이다 —
  // sessionStorage는 bfcache에 영향받지 않으므로 스크립트/배역/설정이 그대로 살아 있다.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      window.location.reload();
    }
  });

  scheduleSessionClock();
  renderInitialState();
}
