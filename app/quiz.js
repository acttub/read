import { compare, normalize } from "./match.js";
import { parseScript } from "./parse.js";
import { readMyRole, readScript } from "./storage.js";
import { trackMetric, withInboundAdId } from "./tracking.js";

const TRANSCRIBE_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
]);

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
    index: 0,
    status: new Map(),
    attempts: new Map(),
    hintWords: new Map(),
    voiceMode: !inAppBrowser && initialVoiceEngine !== null,
    voiceEngine: initialVoiceEngine,
  };

  const emptyState = document.getElementById("emptyState");
  const quizStage = document.getElementById("quizStage");
  const completionState = document.getElementById("completionState");
  const reviewSection = document.getElementById("reviewSection");
  const reviewList = document.getElementById("reviewList");
  const progressBar = document.getElementById("progressBar");
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
  const voiceDisclosure = document.getElementById("voiceDisclosure");
  const modeNotice = document.getElementById("modeNotice");
  const speakButton = document.getElementById("speakButton");
  const silentRecallButton = document.getElementById("silentRecallButton");
  const nextButton = document.getElementById("nextButton");
  const retryButton = document.getElementById("retryButton");
  const overrideButton = document.getElementById("overrideButton");
  const hintButton = document.getElementById("hintButton");
  const originalButton = document.getElementById("originalButton");
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

  trackMetric("quiz_start");

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

  function syncModeControls() {
    voiceModeInput.checked = state.voiceMode;
    silentModeInput.checked = !state.voiceMode;
    voiceDisclosure.hidden = !state.voiceMode;
    voiceDisclosure.textContent = state.voiceEngine === "server"
      ? "말하기를 쓰면 말소리가 acttub 서버를 거쳐 OpenAI로 전송돼 글자로 바뀌어요. 바뀐 뒤 녹음은 바로 버려요."
      : "말하기를 쓰면 말소리가 브라우저 제공사 서버로 전송돼요.";

    if (
      phase === "ready" &&
      currentTurn()?.role === myRole &&
      !isEffectiveDirection(currentTurn())
    ) {
      setOnlyActions(
        state.voiceMode ? speakButton : silentRecallButton,
        hintButton,
        originalButton,
      );
    }
  }

  function setVoiceMode(enabled, message = "") {
    stopRecognition();
    state.voiceMode = enabled && state.voiceEngine !== null;
    if (["listening", "recording", "processing"].includes(phase)) {
      phase = "ready";
    }
    if (enabled && state.voiceEngine === null && !message) {
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

  function showPassed() {
    const turn = currentTurn();
    if (!turn) return;
    markPassed(state.index);
    phase = "passing";
    setLine(turn.text);
    differentWords.hidden = true;
    setOnlyActions();
    passTimer = window.setTimeout(advanceTurn, 650);
  }

  function handleRecognitionResults(transcripts) {
    const turn = currentTurn();
    if (!turn) return;

    if (transcripts.length === 0) {
      phase = "ready";
      setNotice("안 들렸어요, 다시 눌러주세요");
      showReadyMyTurn(turn);
      return;
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
    setVoiceMode(
      false,
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
        !state.voiceMode ||
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
        state.voiceMode &&
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
      setVoiceMode(
        false,
        "말하기는 브라우저에서 마이크를 허용하면 쓸 수 있어요",
      );
      return;
    }

    if (
      requestVersion !== micRequestVersion ||
      activeTurnVersion !== turnVersion ||
      !sessionActive ||
      !state.voiceMode ||
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
        state.voiceMode &&
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
      setVoiceMode(
        false,
        "이 브라우저에서는 말하기가 안 되네요. 떠올리고 확인하는 방식으로 이어갈게요.",
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceMode(
        false,
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
      setVoiceMode(
        false,
        "말하기는 브라우저에서 마이크를 허용하면 쓸 수 있어요",
      );
      return;
    }

    if (
      requestVersion !== micRequestVersion ||
      activeTurnVersion !== turnVersion ||
      !sessionActive ||
      !state.voiceMode
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
        setVoiceMode(
          false,
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
        setVoiceMode(
          false,
          "이 브라우저에서는 말하기가 안 되네요. 떠올리고 확인하는 방식으로 이어갈게요.",
        );
      }, 8000);
    } catch {
      settled = true;
      finishInstance();
      setVoiceMode(
        false,
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
    setVoiceMode(
      false,
      "이 브라우저에서는 말하기가 안 되네요. 떠올리고 확인하는 방식으로 이어갈게요.",
    );
  }

  function updateProgress(index = state.index) {
    const fraction = turns.length === 0
      ? 0
      : Math.min(Math.max(index / turns.length, 0), 1);
    progressBar.style.width = `${fraction * 100}%`;
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
    // 보통은 한 턴 전진이라 그 하나만 붙인다 — 긴 대본에서 매 턴 전체를 다시
    // 그리면 O(N²)이다. 전체 재구성은 재연습으로 뒤로 점프했을 때만.
    const rendered = pastTurns.childElementCount;
    if (state.index === rendered) return;
    if (state.index === rendered + 1) {
      pastTurns.append(makePastTurn(turns[state.index - 1]));
      return;
    }
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < state.index; index += 1) {
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
    roleName.textContent = turn.role;
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
    setOnlyActions();
    if (!finishTracked) {
      finishTracked = true;
      trackMetric("quiz_finish");
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
      item.className =
        "w-full rounded-lg bg-surface p-md text-left shadow-card active:bg-surface-sub";
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
    setNotice("");
    setOnlyActions();
  }

  voiceModeInput.addEventListener("change", () => {
    if (voiceModeInput.checked) setVoiceMode(true);
  });
  silentModeInput.addEventListener("change", () => {
    if (silentModeInput.checked) setVoiceMode(false);
  });
  speakButton.addEventListener("click", startRecognition);
  silentRecallButton.addEventListener("click", () => {
    showOriginal({ remember: false });
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
    stopRecognition();
    clearTurnTimers();
    window.location.href = "/input";
  });
  window.addEventListener("pagehide", () => {
    sessionActive = false;
    stopRecognition();
    clearTurnTimers();
  }, { once: true });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  });

  voiceModeInput.checked = state.voiceMode;
  silentModeInput.checked = !state.voiceMode;
  if (inAppBrowser) {
    setNotice("브라우저로 열면 말하기로도 할 수 있어요");
  }

  const hasMyDialogue = turns.some(
    (turn) => turn.role === myRole && !isEffectiveDirection(turn),
  );
  if (!hasMyDialogue) showNoDialogue();
  else renderTurn();
}
