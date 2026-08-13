import { compare, normalize } from "./match.js";
import { parseScript } from "./parse.js";
import { readMyRole, readScript } from "./storage.js";
import { trackMetric, withInboundAdId } from "./tracking.js";

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
  const state = {
    index: 0,
    status: new Map(),
    attempts: new Map(),
    hintWords: new Map(),
    voiceMode: !inAppBrowser,
  };

  const emptyState = document.getElementById("emptyState");
  const quizStage = document.getElementById("quizStage");
  const completionState = document.getElementById("completionState");
  const reviewSection = document.getElementById("reviewSection");
  const reviewList = document.getElementById("reviewList");
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
  let micRequestVersion = 0;
  let turnVersion = 0;
  let reviewTurnIndex = null;
  let sessionActive = true;
  let voiceResultTracked = false;
  let voiceDeadTracked = false;
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

  function stopRecognition() {
    micRequestVersion += 1;
    clearRecognitionWatchdog();
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

    if (
      phase === "ready" &&
      currentTurn()?.role === myRole &&
      !currentTurn()?.isDirection
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
    state.voiceMode = enabled;
    phase = phase === "listening" ? "ready" : phase;
    speakButton.textContent = "말하기";
    setNotice(message);
    syncModeControls();
  }

  function maskedText(text, revealedWordCount) {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (revealedWordCount <= 0) {
      const characterCount = [...text].filter((character) => !/\s/.test(character)).length;
      return "•".repeat(Math.min(characterCount, 24));
    }

    let maskBudget = 24;
    return words.map((word, index) => {
      if (index < revealedWordCount) return word;
      const size = Math.min([...word].length, maskBudget);
      maskBudget -= size;
      return "•".repeat(size);
    }).filter(Boolean).join(" ");
  }

  // data-masked는 CSS만 쓴다 — 가려진 점은 넓은 화면에서 한 줄로 퍼지면
  // 구분선처럼 보여서, 그때만 글줄 폭을 좁혀 접는다(src/input.css).
  function setLine(text, { masked = false } = {}) {
    lineDisplay.textContent = text;
    lineDisplay.toggleAttribute("data-masked", masked);
  }

  function renderMaskedLine(turn) {
    const text = maskedText(turn.text, state.hintWords.get(state.index) || 0);
    // 힌트로 어절이 전부 드러나면 더 이상 마스크가 아니다. 그때도 data-masked를
    // 남기면 데스크톱에서 드러난 원문이 좁은 글줄 폭(14em)에 묶여 어색하게 접힌다.
    setLine(text, { masked: text.includes("•") });
  }

  function renderDifferentWords(segments) {
    differentWords.replaceChildren();
    for (const segment of segments) {
      if (segment.matched) continue;
      const word = document.createElement("span");
      word.className =
        "rounded-md bg-primary-soft px-sm py-xs font-script text-body-md font-semibold text-primary-strong";
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
    setLine("");
    renderDifferentWords(closest.segments);
    setOnlyActions(retryButton, overrideButton, originalButton);
  }

  async function startRecognition() {
    if (phase === "listening") return;

    // WKWebView는 webkitSpeechRecognition을 노출하고도 동작하지 않는다. 따라서 이
    // 프로퍼티는 가용성 판정에 쓰지 않고, 생성 가능할 때도 실제 start()와 8초 동안의
    // 이벤트를 확인한다. 생성자 자체가 없을 때만 시도를 시작할 수 없어 무음으로 간다.
    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
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
    speakButton.textContent = "인식 중";
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

    if (state.index >= turns.length) {
      showCompletion();
      return;
    }

    const turn = currentTurn();
    lineCard.classList.toggle("bg-surface-sub", turn.isDirection);
    lineCard.classList.toggle("bg-surface", !turn.isDirection);
    roleName.hidden = turn.isDirection;
    roleName.textContent = turn.role;

    if (turn.isDirection) {
      setLine(turn.text);
      lineDisplay.className =
        "m-0 min-h-[3.5rem] font-script text-body-lg font-medium leading-[1.6] text-ink-sub";
      setOnlyActions();
      directionTimer = window.setTimeout(advanceTurn, 700);
      return;
    }

    lineDisplay.className =
      "m-0 min-h-[3.5rem] font-script text-[22px] font-semibold leading-[1.5] text-ink";
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
      .filter(([, status]) => status === "revealed")
      .map(([index]) => index);
    reviewList.replaceChildren();
    for (const index of revealedIndexes) {
      const turn = turns[index];
      const item = document.createElement("article");
      item.className = "rounded-lg bg-surface p-md shadow-card";
      const name = document.createElement("p");
      name.className = "m-0 text-label text-primary-strong";
      name.textContent = turn.role;
      const row = document.createElement("div");
      row.className = "mt-xs flex items-start gap-sm";
      const text = document.createElement("p");
      text.className = "m-0 min-w-0 flex-1 font-script text-body-md text-ink";
      text.textContent = turn.text;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className =
        "shrink-0 rounded-md bg-primary-soft px-sm text-[14px] font-semibold text-primary-strong active:bg-primary-soft-hover";
      retry.textContent = "다시";
      retry.dataset.reviewIndex = String(index);
      row.append(text, retry);
      item.append(name, row);
      reviewList.append(item);
    }
    reviewSection.hidden = revealedIndexes.length === 0;
  }

  function showNoDialogue() {
    stopRecognition();
    clearTurnTimers();
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
    const wordCount = turn.text.trim().split(/\s+/).filter(Boolean).length;
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
    if (turn?.role === myRole && !turn.isDirection) markPassed(state.index);
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
    (turn) => turn.role === myRole && !turn.isDirection,
  );
  if (!hasMyDialogue) showNoDialogue();
  else renderTurn();
}
