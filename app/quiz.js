import {
  compare,
  normalize,
  scoreAttempt,
  summarizeAttempts,
} from "./match.js";
import { parseScript } from "./parse.js";
import { readMyRole, readScript, readStartIndex } from "./storage.js";
import { trackMetric, withInboundAdId } from "./tracking.js";

const TRANSCRIBE_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
]);
const PAST_TURN_CONTEXT_LIMIT = 12;

// 괄호를 지우고도 말이 남으면 대사다 — parse.js의 startsWith("(") 오분류를 quiz에서만 바로잡는다
const isEffectiveDirection = (turn) =>
  turn.isDirection && normalize(turn.text) === "";

const script = readScript();
const myRole = readMyRole();

if (!script || !myRole) {
  window.location.replace("/input");
} else {
  initializeQuiz();
}

function initializeQuiz() {
  const { turns } = parseScript(script);
  const inAppBrowser = /Instagram|FBAN|FBAV|KAKAOTALK|Line\//i.test(
    navigator.userAgent,
  );
  const SpeechRecognitionCtor =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  const hasMicrophoneAccess = Boolean(
    navigator.mediaDevices?.getUserMedia,
  );
  const initialVoiceEngine = hasMicrophoneAccess && window.MediaRecorder
    ? "server"
    : hasMicrophoneAccess && SpeechRecognitionCtor
    ? "browser"
    : null;
  const state = {
    index: readStartIndex(turns.length),
    status: new Map(),
    attempts: new Map(),
    scoredAttempts: [],
    hintWords: new Map(),
    quizMode: !inAppBrowser && initialVoiceEngine !== null ? "voice" : "silent",
    voiceEngine: initialVoiceEngine,
  };

  const emptyState = document.getElementById("emptyState");
  const quizStage = document.getElementById("quizStage");
  const completionState = document.getElementById("completionState");
  const summaryMetrics = document.getElementById("summaryMetrics");
  const reviewSection = document.getElementById("reviewSection");
  const reviewList = document.getElementById("reviewList");
  const progressBar = document.getElementById("progressBar");
  const quizRemaining = document.getElementById("quizRemaining");
  const quizRemainingDesktop = document.getElementById("quizRemainingDesktop");
  const quizElapsed = document.getElementById("quizElapsed");
  const quizElapsedDesktop = document.getElementById("quizElapsedDesktop");
  const sceneLabel = document.getElementById("sceneLabel");
  const pastTurns = document.getElementById("pastTurns");
  const futureMarker = document.getElementById("futureMarker");
  const lineCard = document.getElementById("lineCard");
  const roleName = document.getElementById("roleName");
  const lineDisplay = document.getElementById("lineDisplay");
  const differentWords = document.getElementById("differentWords");
  const actionArea = document.getElementById("actionArea");
  const modeControls = document.getElementById("modeControls");
  const voiceModeInput = document.getElementById("voiceModeInput");
  const silentModeInput = document.getElementById("silentModeInput");
  const textModeInput = document.getElementById("textModeInput");
  const voiceDisclosure = document.getElementById("voiceDisclosure");
  const textDisclosure = document.getElementById("textDisclosure");
  const modeNotice = document.getElementById("modeNotice");
  const textAnswerForm = document.getElementById("textAnswerForm");
  const textAnswerInput = document.getElementById("textAnswerInput");
  const speakButton = document.getElementById("speakButton");
  const silentRecallButton = document.getElementById("silentRecallButton");
  const nextButton = document.getElementById("nextButton");
  const retryButton = document.getElementById("retryButton");
  const overrideButton = document.getElementById("overrideButton");
  const hintButton = document.getElementById("hintButton");
  const originalButton = document.getElementById("originalButton");
  const summaryDescription = document.getElementById("summaryDescription");
  const coreLink = document.getElementById("coreLink");
  coreLink.href = withInboundAdId(coreLink.getAttribute("href"));
  const actionButtons = [
    speakButton,
    silentRecallButton,
    nextButton,
    retryButton,
    overrideButton,
    hintButton,
    originalButton,
  ];

  let phase = "ready";
  let directionTimer = null;
  let passTimer = null;
  let recognitionWatchdog = null;
  let recognition = null;
  let micStream = null;
  let recordingTimer = null;
  let mediaRecorder = null;
  let recordingChunks = [];
  let transcriptionController = null;
  let micRequestVersion = 0;
  let turnVersion = 0;
  let reviewTurnIndex = null;
  let sessionActive = true;
  let voiceResultTracked = false;
  let voiceDeadTracked = false;
  let voiceFallbackTracked = false;
  let finishTracked = false;
  const sessionStartedAt = Date.now();
  let sessionClockTimer = null;

  trackMetric("quiz_start");

  function formatElapsed(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function updateElapsedTime() {
    const value = formatElapsed(Date.now() - sessionStartedAt);
    if (quizElapsed) quizElapsed.textContent = value;
    if (quizElapsedDesktop) quizElapsedDesktop.textContent = value;
  }

  function scheduleSessionClock() {
    updateElapsedTime();
    sessionClockTimer = window.setTimeout(() => {
      sessionClockTimer = null;
      if (!sessionActive || finishTracked) return;
      scheduleSessionClock();
    }, 1000);
  }

  function stopSessionClock() {
    if (sessionClockTimer) window.clearTimeout(sessionClockTimer);
    sessionClockTimer = null;
    updateElapsedTime();
  }

  function setNotice(message) {
    modeNotice.textContent = message;
  }

  function setOnlyActions(...visibleButtons) {
    const visible = new Set(visibleButtons);
    for (const button of actionButtons) {
      button.hidden = !visible.has(button);
      button.disabled = false;
    }
    actionArea.hidden = visible.size === 0;
  }

  function clearTurnTimers() {
    if (directionTimer) clearTimeout(directionTimer);
    if (passTimer) clearTimeout(passTimer);
    directionTimer = null;
    passTimer = null;
  }

  function releaseMic() {
    if (!micStream) return;
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }

  function clearRecognitionWatchdog() {
    if (!recognitionWatchdog) return;
    clearTimeout(recognitionWatchdog);
    recognitionWatchdog = null;
  }

  function clearRecordingTimer() {
    if (!recordingTimer) return;
    clearTimeout(recordingTimer);
    recordingTimer = null;
  }

  function resetSpeakButton() {
    speakButton.disabled = false;
    speakButton.textContent = "말하기";
    speakButton.classList.remove("animate-pulse");
  }

  function stopRecognition() {
    micRequestVersion += 1;
    clearRecognitionWatchdog();
    clearRecordingTimer();
    if (transcriptionController) {
      transcriptionController.abort();
      transcriptionController = null;
    }
    if (mediaRecorder) {
      const instance = mediaRecorder;
      mediaRecorder = null;
      instance.ondataavailable = null;
      instance.onerror = null;
      instance.onstop = null;
      if (instance.state !== "inactive") {
        try {
          instance.stop();
        } catch {
          // 이미 멈추는 중인 녹음기는 더 중단할 것이 없다.
        }
      }
    }
    recordingChunks = [];
    if (recognition) {
      recognition.onstart = null;
      recognition.onaudiostart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        // 이미 끝난 인식기는 중단할 것이 없다.
      }
      recognition = null;
    }
    releaseMic();
    resetSpeakButton();
  }

  function currentTurn() {
    return turns[state.index];
  }

  function markPassed(index) {
    if (state.status.get(index) !== "revealed") {
      state.status.set(index, "passed");
    }
  }

  function clearTextAnswer() {
    textAnswerInput.value = "";
  }

  function syncTextAnswerForm() {
    const turn = currentTurn();
    textAnswerForm.hidden = !(
      state.quizMode === "text" &&
      phase === "ready" &&
      turn?.role === myRole &&
      !isEffectiveDirection(turn)
    );
    if (textAnswerForm.hidden) clearTextAnswer();
  }

  function syncModeControls() {
    voiceModeInput.checked = state.quizMode === "voice";
    silentModeInput.checked = state.quizMode === "silent";
    textModeInput.checked = state.quizMode === "text";
    voiceDisclosure.hidden = state.quizMode !== "voice";
    textDisclosure.hidden = state.quizMode !== "text";
    voiceDisclosure.textContent = state.voiceEngine === "server"
      ? "말하기를 쓰면 말소리가 acttub 서버를 거쳐 OpenAI로 전송돼 글자로 바뀌어요. 바뀐 뒤 녹음은 바로 버려요."
      : "말하기를 쓰면 말소리가 브라우저 제공사 서버로 전송돼요.";
    textDisclosure.textContent = "대사를 쓰면 원문과 맞춰봐요.";
    syncTextAnswerForm();

    if (
      phase === "ready" &&
      currentTurn()?.role === myRole &&
      !isEffectiveDirection(currentTurn())
    ) {
      const primaryAction = state.quizMode === "voice"
        ? speakButton
        : state.quizMode === "silent"
        ? silentRecallButton
        : null;
      const actions = [hintButton, originalButton];
      if (primaryAction) actions.unshift(primaryAction);
      setOnlyActions(...actions);
    }
  }

  function setQuizMode(mode, message = "") {
    stopRecognition();
    clearTextAnswer();
    state.quizMode = mode === "voice" && state.voiceEngine === null
      ? "silent"
      : mode;
    if (["listening", "recording", "processing"].includes(phase)) {
      phase = "ready";
    }
    if (mode === "voice" && state.voiceEngine === null && !message) {
      message =
        "이 브라우저에서는 말하기가 안 되네요. 떠올리고 확인하는 방식으로 이어갈게요.";
    }
    setNotice(message);
    syncModeControls();
  }

  function spokenWords(text) {
    return normalize(text).split(/\s+/).filter(Boolean);
  }

  function setLine(text) {
    lineDisplay.removeAttribute("aria-label");
    lineDisplay.replaceChildren(document.createTextNode(text));
  }

  function renderMaskedLine(turn) {
    const words = spokenWords(turn.text);
    const revealedWordCount = state.hintWords.get(state.index) || 0;
    const veil = document.createElement("span");
    veil.className = "quiz-word-veil";

    for (const [index, word] of words.entries()) {
      if (index < revealedWordCount) {
        const hint = document.createElement("span");
        hint.className = "quiz-word-hint";
        hint.textContent = word;
        veil.append(hint);
        continue;
      }

      const mask = document.createElement("span");
      mask.className = "quiz-word-mask";
      mask.style.setProperty("--quiz-mask-characters", String([...word].length));
      mask.setAttribute("aria-hidden", "true");
      veil.append(mask);
    }

    lineDisplay.replaceChildren(veil);
    const revealedWords = words.slice(0, revealedWordCount).join(" ");
    lineDisplay.setAttribute(
      "aria-label",
      revealedWords ? `가려진 대사. 힌트: ${revealedWords}` : "가려진 대사",
    );
  }

  function renderDifferentWords(segments) {
    differentWords.replaceChildren();
    for (const segment of segments) {
      if (segment.matched) continue;
      const word = document.createElement("span");
      word.className =
        "rounded-md border border-line bg-neutral px-sm py-xs font-script text-body-md font-semibold text-ink-sub";
      word.textContent = segment.text;
      differentWords.append(word);
    }
    differentWords.hidden = differentWords.childElementCount === 0;
  }

  function showReadyMyTurn(turn) {
    phase = "ready";
    differentWords.hidden = true;
    renderMaskedLine(turn);
    syncModeControls();
  }

  function showOriginal({ remember }) {
    const turn = currentTurn();
    if (!turn) return;
    stopRecognition();
    if (remember) state.status.set(state.index, "revealed");
    phase = "revealed";
    syncTextAnswerForm();
    setLine(turn.text);
    differentWords.hidden = true;
    setOnlyActions(nextButton, retryButton);
  }

  function advanceTurn() {
    stopRecognition();
    clearTurnTimers();
    setNotice("");
    if (reviewTurnIndex !== null) {
      reviewTurnIndex = null;
      showCompletion();
      return;
    }
    state.index += 1;
    renderTurn();
  }

  function flashOriginalAndAdvance() {
    const turn = currentTurn();
    if (!turn) return;
    phase = "passing";
    syncTextAnswerForm();
    setLine(turn.text);
    differentWords.hidden = true;
    setOnlyActions();
    passTimer = window.setTimeout(advanceTurn, 650);
  }

  function showPassed() {
    if (!currentTurn()) return;
    markPassed(state.index);
    flashOriginalAndAdvance();
  }

  function handleRecognitionResults(transcripts, source = "voice") {
    const turn = currentTurn();
    if (!turn) return;

    if (transcripts.length === 0) {
      phase = "ready";
      setNotice(
        source === "text"
          ? "대사를 쓰고 확인해 주세요"
          : "안 들렸어요, 다시 눌러주세요",
      );
      showReadyMyTurn(turn);
      return;
    }

    for (const transcript of transcripts) {
      state.scoredAttempts.push({
        lineIndex: state.index,
        ...scoreAttempt(turn.text, transcript, source),
      });
    }

    const results = transcripts.map((transcript) =>
      compare(turn.text, transcript, { mode: "느슨하게" })
    );
    if (results.some(({ passed }) => passed)) {
      setNotice("");
      showPassed();
      return;
    }

    const attempts = (state.attempts.get(state.index) || 0) + 1;
    state.attempts.set(state.index, attempts);
    if (attempts >= 2) {
      markPassed(state.index);
      setNotice("");
      advanceTurn();
      return;
    }

    const closest = results.reduce((selected, result) => {
      const different = result.segments.filter(({ matched }) => !matched).length;
      const selectedDifferent = selected.segments
        .filter(({ matched }) => !matched).length;
      return different < selectedDifferent ? result : selected;
    });
    phase = "failed";
    syncTextAnswerForm();
    renderMaskedLine(turn);
    renderDifferentWords(closest.segments);
    setOnlyActions(retryButton, overrideButton, originalButton);
  }

  function canUseBrowserRecognition() {
    return Boolean(
      SpeechRecognitionCtor && navigator.mediaDevices?.getUserMedia,
    );
  }

  function showUnheard(message = "안 들렸어요, 다시 눌러주세요") {
    const turn = currentTurn();
    if (!turn) return;
    resetSpeakButton();
    phase = "ready";
    showReadyMyTurn(turn);
    setNotice(message);
  }

  function fallbackFromServer() {
    if (canUseBrowserRecognition()) {
      state.voiceEngine = "browser";
      if (!voiceFallbackTracked) {
        voiceFallbackTracked = true;
        trackMetric("quiz_voice_fallback");
      }
      showUnheard(
        "이 기기의 음성 인식으로 이어갈게요",
      );
      return;
    }

    state.voiceEngine = null;
    setQuizMode(
      "silent",
      "이 브라우저에서는 말하기가 안 되네요. 떠올리고 확인하는 방식으로 이어갈게요.",
    );
  }

  async function transcribeRecording(
    chunks,
    recordedType,
    requestVersion,
    activeTurnVersion,
  ) {
    let audioBlob = new Blob(chunks, { type: recordedType });
    chunks.length = 0;
    if (audioBlob.size === 0) {
      audioBlob = null;
      showUnheard();
      return;
    }

    const audioType = audioBlob.type
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!TRANSCRIBE_AUDIO_TYPES.has(audioType)) {
      audioBlob = null;
      fallbackFromServer();
      return;
    }

    const controller = new AbortController();
    transcriptionController = controller;
    let responseData = null;
    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": audioType },
        body: audioBlob,
        signal: controller.signal,
      });
      responseData = await response.json().catch(() => null);

      if (
        requestVersion !== micRequestVersion ||
        activeTurnVersion !== turnVersion ||
        !sessionActive ||
        state.quizMode !== "voice" ||
        state.voiceEngine !== "server"
      ) return;

      if (responseData?.reason === "no_key" || response.status >= 500) {
        fallbackFromServer();
        return;
      }
      if (!response.ok) {
        showUnheard();
        return;
      }
      if (typeof responseData?.text !== "string") {
        fallbackFromServer();
        return;
      }

      if (!voiceResultTracked) {
        voiceResultTracked = true;
        trackMetric("quiz_voice_ok");
      }
      const transcript = responseData.text.trim();
      resetSpeakButton();
      handleRecognitionResults(transcript ? [transcript] : []);
    } catch {
      if (
        requestVersion === micRequestVersion &&
        activeTurnVersion === turnVersion &&
        sessionActive &&
        state.quizMode === "voice" &&
        state.voiceEngine === "server"
      ) fallbackFromServer();
    } finally {
      if (transcriptionController === controller) {
        transcriptionController = null;
      }
      audioBlob = null;
      responseData = null;
    }
  }

  function finishServerRecording() {
    if (phase !== "recording" || !mediaRecorder) return;

    phase = "processing";
    clearRecordingTimer();
    speakButton.disabled = true;
    speakButton.textContent = "확인 중…";
    speakButton.classList.remove("animate-pulse");
    try {
      mediaRecorder.stop();
      // stop 이벤트를 기다리는 동안에도 마이크가 켜져 있지 않게 즉시 트랙을 끈다.
      releaseMic();
    } catch {
      mediaRecorder = null;
      recordingChunks = [];
      releaseMic();
      fallbackFromServer();
    }
  }

  async function startServerRecording() {
    if (["listening", "recording", "processing"].includes(phase)) return;

    phase = "listening";
    setNotice("");
    setOnlyActions(speakButton);
    speakButton.disabled = true;
    const requestVersion = ++micRequestVersion;
    const activeTurnVersion = turnVersion;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (requestVersion !== micRequestVersion) return;
      setQuizMode(
        "silent",
        "말하기는 브라우저에서 마이크를 허용하면 쓸 수 있어요",
      );
      return;
    }

    if (
      requestVersion !== micRequestVersion ||
      activeTurnVersion !== turnVersion ||
      !sessionActive ||
      state.quizMode !== "voice" ||
      state.voiceEngine !== "server"
    ) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    let instance;
    try {
      instance = new window.MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      fallbackFromServer();
      return;
    }

    micStream = stream;
    mediaRecorder = instance;
    recordingChunks = [];

    function isCurrent() {
      return mediaRecorder === instance &&
        requestVersion === micRequestVersion &&
        activeTurnVersion === turnVersion &&
        sessionActive &&
        state.quizMode === "voice" &&
        state.voiceEngine === "server";
    }

    function failRecording() {
      if (!isCurrent()) return;
      clearRecordingTimer();
      mediaRecorder = null;
      instance.ondataavailable = null;
      instance.onerror = null;
      instance.onstop = null;
      if (instance.state !== "inactive") {
        try {
          instance.stop();
        } catch {
          // 실패 뒤 이미 멈춘 녹음기일 수 있다.
        }
      }
      recordingChunks = [];
      releaseMic();
      fallbackFromServer();
    }

    instance.ondataavailable = (event) => {
      if (isCurrent() && event.data.size > 0) recordingChunks.push(event.data);
    };
    instance.onerror = failRecording;
    instance.onstop = () => {
      const current = isCurrent();
      const chunks = recordingChunks;
      const recordedType = instance.mimeType || chunks[0]?.type || "";
      mediaRecorder = null;
      recordingChunks = [];
      instance.ondataavailable = null;
      instance.onerror = null;
      instance.onstop = null;
      if (!current) return;
      void transcribeRecording(
        chunks,
        recordedType,
        requestVersion,
        activeTurnVersion,
      );
    };

    try {
      instance.start();
    } catch {
      failRecording();
      return;
    }
    phase = "recording";
    speakButton.disabled = false;
    speakButton.textContent = "다 말했어요";
    speakButton.classList.add("animate-pulse");
    recordingTimer = window.setTimeout(finishServerRecording, 30000);
  }

  async function startBrowserRecognition() {
    if (phase === "listening") return;

    // WKWebView는 webkitSpeechRecognition을 노출하고도 동작하지 않는다. 따라서 이
    // 프로퍼티는 가용성 판정에 쓰지 않고, 생성 가능할 때도 실제 start()와 8초 동안의
    // 이벤트를 확인한다. 생성자 자체가 없을 때만 시도를 시작할 수 없어 무음으로 간다.
    if (!SpeechRecognitionCtor) {
      state.voiceEngine = null;
      setQuizMode(
        "silent",
        "이 브라우저에서는 말하기가 안 되네요. 떠올리고 확인하는 방식으로 이어갈게요.",
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setQuizMode(
        "silent",
        "말하기는 브라우저에서 마이크를 허용하면 쓸 수 있어요",
      );
      return;
    }

    phase = "listening";
    setNotice("");
    setOnlyActions(speakButton);
    speakButton.disabled = true;
    speakButton.textContent = "듣는 중…";
    speakButton.classList.add("animate-pulse");
    const requestVersion = ++micRequestVersion;
    const activeTurnVersion = turnVersion;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (requestVersion !== micRequestVersion) return;
      setQuizMode(
        "silent",
        "말하기는 브라우저에서 마이크를 허용하면 쓸 수 있어요",
      );
      return;
    }

    if (
      requestVersion !== micRequestVersion ||
      activeTurnVersion !== turnVersion ||
      !sessionActive ||
      state.quizMode !== "voice"
    ) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    micStream = stream;

    const instance = new SpeechRecognitionCtor();
    recognition = instance;
    instance.lang = "ko-KR";
    instance.continuous = false;
    instance.interimResults = false;
    instance.maxAlternatives = 3;
    let settled = false;
    let receivedActivity = false;

    function isCurrent() {
      return recognition === instance &&
        activeTurnVersion === turnVersion &&
        sessionActive;
    }

    function markActivity() {
      receivedActivity = true;
      clearRecognitionWatchdog();
    }

    function finishInstance() {
      if (recognition === instance) recognition = null;
      try {
        instance.stop();
      } catch {
        // 결과·오류·종료 이벤트 뒤에는 이미 멈춘 인식기일 수 있다.
      }
      try {
        // stop()은 남은 결과를 마저 처리하느라 세션을 바로 끊지 않는다. 8초 타임아웃으로
        // 무음 모드로 물러나는 경로에서는 화면이 "무음"이라고 말하는 동안 인식 세션이
        // 살아서 소리를 벤더 서버로 계속 보낼 수 있다. 아래에서 핸들러를 끊으므로
        // 남은 결과도 쓸 데가 없다 — 확실히 끊는다.
        instance.abort();
      } catch {
        // 이미 끝난 인식기에는 abort가 던질 수 있다.
      }
      instance.onstart = null;
      instance.onaudiostart = null;
      instance.onresult = null;
      instance.onerror = null;
      instance.onend = null;
      clearRecognitionWatchdog();
      releaseMic();
      speakButton.textContent = "말하기";
      speakButton.classList.remove("animate-pulse");
    }

    instance.onstart = markActivity;
    instance.onaudiostart = markActivity;
    instance.onresult = (event) => {
      if (!isCurrent() || settled) return;
      markActivity();
      settled = true;
      if (!voiceResultTracked) {
        voiceResultTracked = true;
        trackMetric("quiz_voice_ok");
      }

      const transcripts = [];
      for (let resultIndex = event.resultIndex; resultIndex < event.results.length; resultIndex += 1) {
        const result = event.results[resultIndex];
        for (let alternativeIndex = 0; alternativeIndex < Math.min(result.length, 3); alternativeIndex += 1) {
          const transcript = result[alternativeIndex].transcript.trim();
          if (transcript) transcripts.push(transcript);
        }
      }
      finishInstance();
      handleRecognitionResults(transcripts);
    };
    instance.onerror = (event) => {
      if (!isCurrent() || settled) return;
      markActivity();
      settled = true;
      const permissionDenied =
        event.error === "not-allowed" || event.error === "service-not-allowed";
      finishInstance();
      if (permissionDenied) {
        setQuizMode(
          "silent",
          "말하기는 브라우저에서 마이크를 허용하면 쓸 수 있어요",
        );
      } else {
        phase = "ready";
        setNotice("안 들렸어요, 다시 눌러주세요");
        showReadyMyTurn(currentTurn());
      }
    };
    instance.onend = () => {
      if (!isCurrent() || settled) return;
      if (!receivedActivity) {
        recognition = null;
        instance.onstart = null;
        instance.onaudiostart = null;
        instance.onresult = null;
        instance.onerror = null;
        instance.onend = null;
        releaseMic();
        return;
      }
      settled = true;
      finishInstance();
      phase = "ready";
      setNotice("안 들렸어요, 다시 눌러주세요");
      showReadyMyTurn(currentTurn());
    };

    try {
      instance.start();
      recognitionWatchdog = window.setTimeout(() => {
        if (settled || activeTurnVersion !== turnVersion) return;
        settled = true;
        finishInstance();
        if (!voiceDeadTracked) {
          voiceDeadTracked = true;
          trackMetric("quiz_voice_dead");
        }
        setQuizMode(
          "silent",
          "이 브라우저에서는 말하기가 안 되네요. 떠올리고 확인하는 방식으로 이어갈게요.",
        );
      }, 8000);
    } catch {
      settled = true;
      finishInstance();
      setQuizMode(
        "silent",
        "이 브라우저에서는 말하기가 안 되네요. 떠올리고 확인하는 방식으로 이어갈게요.",
      );
    }
  }

  function startRecognition() {
    if (phase === "recording") {
      finishServerRecording();
      return;
    }
    if (["listening", "processing"].includes(phase)) return;
    if (state.voiceEngine === "server") {
      void startServerRecording();
      return;
    }
    if (state.voiceEngine === "browser") {
      void startBrowserRecognition();
      return;
    }
    setQuizMode(
      "silent",
      "이 브라우저에서는 말하기가 안 되네요. 떠올리고 확인하는 방식으로 이어갈게요.",
    );
  }

  function updateProgress(index = state.index) {
    const fraction = turns.length === 0
      ? 0
      : Math.min(Math.max(index / turns.length, 0), 1);
    progressBar.style.width = `${fraction * 100}%`;
    const remaining = Math.max(turns.length - index, 0);
    if (quizRemaining) quizRemaining.textContent = String(remaining);
    if (quizRemainingDesktop) quizRemainingDesktop.textContent = String(remaining);
  }

  function makePastTurn(turn) {
    const item = document.createElement("div");
    item.className = "quiz-turn quiz-turn-past";
    const direction = isEffectiveDirection(turn);
    item.classList.toggle("quiz-turn-direction", direction);
    item.classList.toggle("quiz-turn-me", turn.role === myRole && !direction);

    if (!direction) {
      const name = document.createElement("p");
      name.className = "quiz-turn-role";
      name.textContent = turn.role;
      item.append(name);
    }

    const text = document.createElement("p");
    text.className = "quiz-turn-text";
    text.textContent = turn.text;
    item.append(text);
    return item;
  }

  function renderPastTurns() {
    // 시작 지점이 뒤쪽이어도 앞선 대사 전체를 DOM으로 만들지 않는다. 현재 턴에
    // 가까운 몇 줄만 문맥으로 유지하면 매 렌더 비용도 일정하다.
    const fragment = document.createDocumentFragment();
    const firstContextIndex = Math.max(
      0,
      state.index - PAST_TURN_CONTEXT_LIMIT,
    );
    for (let index = firstContextIndex; index < state.index; index += 1) {
      fragment.append(makePastTurn(turns[index]));
    }
    pastTurns.replaceChildren(fragment);
  }

  function scrollCurrentTurnIntoView() {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.requestAnimationFrame(() => {
      if (lineCard.hidden || quizStage.hidden) return;
      lineCard.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "end",
      });
    });
  }

  function renderTurn() {
    stopRecognition();
    clearTurnTimers();
    turnVersion += 1;
    phase = "ready";
    differentWords.hidden = true;
    quizStage.hidden = false;
    completionState.hidden = true;
    emptyState.hidden = true;
    modeControls.hidden = false;
    syncModeControls();
    updateProgress();

    if (state.index >= turns.length) {
      showCompletion();
      return;
    }

    const turn = currentTurn();
    const direction = isEffectiveDirection(turn);
    renderPastTurns();
    sceneLabel.textContent = `내 배역 — ${myRole}`;
    futureMarker.hidden = state.index >= turns.length - 1;
    lineCard.classList.toggle("quiz-turn-direction", direction);
    lineCard.classList.toggle(
      "quiz-turn-me",
      turn.role === myRole && !direction,
    );
    roleName.hidden = direction;
    roleName.textContent =
      turn.role === myRole && !direction
        ? `${turn.role} · 내 대사`
        : turn.role;
    scrollCurrentTurnIntoView();

    if (direction) {
      setLine(turn.text);
      setOnlyActions();
      directionTimer = window.setTimeout(advanceTurn, 700);
      return;
    }

    if (turn.role !== myRole) {
      setLine(turn.text);
      setOnlyActions(nextButton);
      return;
    }

    if (!normalize(turn.text).replace(/\s/g, "")) {
      markPassed(state.index);
      advanceTurn();
      return;
    }
    showReadyMyTurn(turn);
  }

  function showCompletion() {
    stopRecognition();
    clearTurnTimers();
    updateProgress(turns.length);
    quizStage.hidden = true;
    emptyState.hidden = true;
    completionState.hidden = false;
    modeControls.hidden = true;
    voiceDisclosure.hidden = true;
    textDisclosure.hidden = true;
    textAnswerForm.hidden = true;
    clearTextAnswer();
    setOnlyActions();
    if (!finishTracked) {
      finishTracked = true;
      trackMetric("quiz_finish");
    }
    stopSessionClock();

    const summary = summarizeAttempts(state.scoredAttempts);
    summaryMetrics.replaceChildren();
    if (summary) {
      const metrics = [
        ["대사 정확도", summary.dialogueAccuracy],
      ];
      if (Number.isFinite(summary.pronunciationAccuracy)) {
        metrics.push(["발음 정확도", summary.pronunciationAccuracy]);
      }
      summaryDescription.textContent = metrics.length === 2
        ? "대사 정확도와 발음 정확도를 정리했습니다."
        : "대사 정확도를 정리했습니다.";
      const fragment = document.createDocumentFragment();
      for (const [label, value] of metrics) {
        const card = document.createElement("article");
        card.className = "summary-card";
        const valueElement = document.createElement("p");
        valueElement.className = "summary-value";
        valueElement.textContent = `${value}%`;
        const labelElement = document.createElement("p");
        labelElement.className = "summary-label";
        labelElement.textContent = label;
        card.append(valueElement, labelElement);
        fragment.append(card);
      }
      summaryMetrics.append(fragment);
      summaryMetrics.hidden = false;
    } else {
      summaryDescription.textContent = "암기 테스트를 마쳤습니다.";
      summaryMetrics.hidden = true;
    }

    const revealedIndexes = [...state.status]
      .filter(([index, status]) =>
        status === "revealed" && !isEffectiveDirection(turns[index])
      )
      .map(([index]) => index);
    reviewList.replaceChildren();
    for (const index of revealedIndexes) {
      const turn = turns[index];
      const item = document.createElement("button");
      item.type = "button";
      item.className = "review-item";
      item.dataset.reviewIndex = String(index);
      const name = document.createElement("p");
      name.className = "m-0 text-label text-primary-strong";
      name.textContent = turn.role;
      const row = document.createElement("div");
      row.className = "mt-xs flex items-start gap-sm";
      const text = document.createElement("p");
      text.className = "m-0 min-w-0 flex-1 font-script text-body-md text-ink";
      text.textContent = turn.text;
      const retry = document.createElement("span");
      retry.className = "shrink-0 text-[14px] font-semibold text-primary-strong";
      retry.textContent = "다시";
      row.append(text, retry);
      item.append(name, row);
      reviewList.append(item);
    }
    reviewSection.hidden = revealedIndexes.length === 0;
  }

  function showNoDialogue() {
    stopRecognition();
    clearTurnTimers();
    updateProgress(0);
    quizStage.hidden = true;
    completionState.hidden = true;
    emptyState.hidden = false;
    modeControls.hidden = true;
    voiceDisclosure.hidden = true;
    textDisclosure.hidden = true;
    textAnswerForm.hidden = true;
    clearTextAnswer();
    setNotice("");
    setOnlyActions();
  }

  voiceModeInput.addEventListener("change", () => {
    if (voiceModeInput.checked) setQuizMode("voice");
  });
  silentModeInput.addEventListener("change", () => {
    if (silentModeInput.checked) setQuizMode("silent");
  });
  textModeInput.addEventListener("change", () => {
    if (textModeInput.checked) setQuizMode("text");
  });
  textAnswerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.quizMode !== "text" || phase !== "ready") return;
    const answer = textAnswerInput.value.trim();
    clearTextAnswer();
    handleRecognitionResults(answer ? [answer] : [], "text");
  });
  textAnswerInput.addEventListener("focus", () => {
    window.requestAnimationFrame(() => {
      if (textAnswerForm.hidden) return;
      textAnswerForm.scrollIntoView({ block: "center" });
    });
  });
  speakButton.addEventListener("click", startRecognition);
  silentRecallButton.addEventListener("click", () => {
    flashOriginalAndAdvance();
  });
  hintButton.addEventListener("click", () => {
    const turn = currentTurn();
    if (!turn) return;
    const wordCount = spokenWords(turn.text).length;
    const nextHint = Math.min(
      (state.hintWords.get(state.index) || 0) + 1,
      wordCount,
    );
    state.hintWords.set(state.index, nextHint);
    renderMaskedLine(turn);
  });
  originalButton.addEventListener("click", () => {
    showOriginal({ remember: true });
  });
  nextButton.addEventListener("click", () => {
    const turn = currentTurn();
    if (
      turn?.role === myRole &&
      !isEffectiveDirection(turn)
    ) markPassed(state.index);
    advanceTurn();
  });
  retryButton.addEventListener("click", () => {
    stopRecognition();
    setNotice("");
    showReadyMyTurn(currentTurn());
  });
  overrideButton.addEventListener("click", () => {
    setNotice("");
    showPassed();
  });
  reviewList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-review-index]");
    if (!button) return;
    const index = Number.parseInt(button.dataset.reviewIndex, 10);
    if (!Number.isInteger(index) || !turns[index]) return;
    state.index = index;
    state.attempts.delete(index);
    state.hintWords.delete(index);
    reviewTurnIndex = index;
    renderTurn();
  });
  coreLink.addEventListener("click", () => {
    trackMetric("quiz_core_click");
  });
  document.getElementById("exitButton").addEventListener("click", () => {
    sessionActive = false;
    stopSessionClock();
    stopRecognition();
    clearTurnTimers();
    window.location.href = "/input";
  });
  window.addEventListener("pagehide", () => {
    sessionActive = false;
    clearTextAnswer();
    stopSessionClock();
    stopRecognition();
    clearTurnTimers();
  }, { once: true });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  });

  scheduleSessionClock();
  voiceModeInput.checked = state.quizMode === "voice";
  silentModeInput.checked = state.quizMode === "silent";
  textModeInput.checked = state.quizMode === "text";
  if (inAppBrowser) {
    setNotice("브라우저로 열면 말하기로도 할 수 있어요");
  }

  const hasMyDialogue = turns.some(
    (turn) => turn.role === myRole && !isEffectiveDirection(turn),
  );
  if (!hasMyDialogue) showNoDialogue();
  else renderTurn();
}
