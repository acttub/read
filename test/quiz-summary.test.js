import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const ELEMENT_IDS = [
  "emptyState",
  "quizStage",
  "completionState",
  "summaryMetrics",
  "reviewSection",
  "reviewList",
  "progressBar",
  "sceneLabel",
  "pastTurns",
  "futureMarker",
  "lineCard",
  "roleName",
  "lineDisplay",
  "differentWords",
  "actionArea",
  "modeControls",
  "voiceModeInput",
  "silentModeInput",
  "textModeInput",
  "voiceDisclosure",
  "textDisclosure",
  "modeNotice",
  "textAnswerForm",
  "textAnswerInput",
  "textAnswerButton",
  "speakButton",
  "silentRecallButton",
  "nextButton",
  "retryButton",
  "overrideButton",
  "hintButton",
  "originalButton",
  "summaryDescription",
  "coreLink",
  "exitButton",
];

const originalGlobals = new Map();
let importSequence = 0;

function setGlobal(name, value) {
  if (!originalGlobals.has(name)) {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

afterEach(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  originalGlobals.clear();
});

class FakeClassList {
  constructor() {
    this.names = new Set();
  }

  setFromString(value) {
    this.names = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  add(...names) {
    names.forEach((name) => this.names.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.names.delete(name));
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.names.has(name) : Boolean(force);
    if (enabled) this.names.add(name);
    else this.names.delete(name);
    return enabled;
  }

  toString() {
    return [...this.names].join(" ");
  }
}

class FakeElement {
  constructor(tagName, id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = "";
    this.dataset = {};
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.style = {
      width: "",
      setProperty(name, value) {
        this[name] = value;
      },
    };
    this._textContent = "";
  }

  set className(value) {
    this.classList.setFromString(value);
  }

  get className() {
    return this.classList.toString();
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
    this.children = [];
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }

  get childElementCount() {
    return this.children.filter((child) => child.tagName !== "#TEXT").length;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node?.tagName === "#FRAGMENT") this.children.push(...node.children);
      else this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._textContent = "";
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click() {
    for (const listener of this.listeners.get("click") || []) {
      listener({ target: this });
    }
  }

  change() {
    for (const listener of this.listeners.get("change") || []) {
      listener({ target: this });
    }
  }

  submit() {
    for (const listener of this.listeners.get("submit") || []) {
      listener({ target: this, preventDefault() {} });
    }
  }

  closest(selector) {
    return selector === "button[data-review-index]" &&
        this.tagName === "BUTTON" &&
        this.dataset.reviewIndex !== undefined
      ? this
      : null;
  }

  scrollIntoView() {}
}

class FakeDocument {
  constructor() {
    this.elements = new Map(
      ELEMENT_IDS.map((id) => [id, new FakeElement("div", id)]),
    );
    for (const id of [
      "emptyState",
      "completionState",
      "summaryMetrics",
      "reviewSection",
      "differentWords",
      "textDisclosure",
      "textAnswerForm",
    ]) {
      this.elements.get(id).hidden = true;
    }
    this.elements.get("coreLink").setAttribute(
      "href",
      "https://acttub.com/?utm_source=read",
    );
  }

  getElementById(id) {
    return this.elements.get(id) || null;
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  createTextNode(text) {
    const node = new FakeElement("#text");
    node.textContent = text;
    return node;
  }

  createDocumentFragment() {
    return new FakeElement("#fragment");
  }
}

function makeStorage(script = "나: 가") {
  const values = new Map([
    ["read.script", script],
    ["read.myRole", "나"],
  ]);
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function makeStream() {
  return {
    getTracks() {
      return [{ stop() {} }];
    },
  };
}

function makeRecognition(transcripts) {
  return class FakeSpeechRecognition {
    start() {
      const transcript = transcripts.shift() ?? "";
      this.onstart?.();
      this.onresult?.({
        resultIndex: 0,
        results: [[{ transcript }]],
      });
    }

    stop() {}

    abort() {}
  };
}

class FakeMediaRecorder {
  constructor() {
    this.state = "inactive";
    this.mimeType = "audio/webm";
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["voice"], { type: this.mimeType }),
    });
    this.onstop?.();
  }
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function startQuiz({
  voice = false,
  serverFallback = false,
  script = "나: 가",
  transcripts = ["가"],
} = {}) {
  const document = new FakeDocument();
  const fetchCalls = [];
  const timers = new Map();
  let nextTimerId = 1;
  const windowListeners = new Map();
  const location = {
    hostname: "localhost",
    origin: "http://localhost",
    search: "",
    href: "http://localhost/quiz",
  };
  const window = {
    location,
    matchMedia: () => ({ matches: true }),
    requestAnimationFrame(callback) {
      callback();
    },
    setTimeout(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
  };

  const navigator = { userAgent: "local-test" };
  if (voice) {
    navigator.mediaDevices = { getUserMedia: async () => makeStream() };
    window.SpeechRecognition = makeRecognition([...transcripts]);
  }
  if (serverFallback) window.MediaRecorder = FakeMediaRecorder;

  setGlobal("document", document);
  setGlobal("window", window);
  setGlobal("location", location);
  setGlobal("navigator", navigator);
  setGlobal("sessionStorage", makeStorage(script));
  setGlobal("fetch", async (...args) => {
    fetchCalls.push(args);
    return {
      status: 200,
      ok: true,
      async json() {
        return { text: null, reason: "no_key" };
      },
    };
  });

  importSequence += 1;
  await import(`../app/quiz.js?summary-test=${importSequence}`);

  return {
    document,
    fetchCalls,
    runTimer(delay) {
      const match = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(match, `${delay}ms timer should exist`);
      const [id, timer] = match;
      timers.delete(id);
      timer.callback();
    },
  };
}

function selectMode(quiz, id) {
  const input = quiz.document.getElementById(id);
  input.checked = true;
  input.change();
}

function submitText(quiz, value) {
  quiz.document.getElementById("textAnswerInput").value = value;
  quiz.document.getElementById("textAnswerForm").submit();
}

test("음성 완주에는 두 요약 지표를 표시한다", async () => {
  const quiz = await startQuiz({ voice: true });

  quiz.document.getElementById("speakButton").click();
  await settle();
  quiz.runTimer(650);

  const summary = quiz.document.getElementById("summaryMetrics");
  assert.equal(summary.hidden, false);
  assert.equal(summary.childElementCount, 2);
  assert.match(summary.textContent, /100%대사 정확도/);
  assert.match(summary.textContent, /100%발음 정확도/);
});

test("무음 완주에는 요약 지표 영역을 렌더하지 않는다", async () => {
  const quiz = await startQuiz();

  quiz.document.getElementById("silentRecallButton").click();
  quiz.runTimer(650);

  const summary = quiz.document.getElementById("summaryMetrics");
  assert.equal(summary.hidden, true);
  assert.equal(summary.childElementCount, 0);
});

test("입력하기는 음성과 같은 느슨한 판정 경로를 타고 대사 지표만 표시한다", async () => {
  const quiz = await startQuiz({ script: "나: 나는 기다려" });

  selectMode(quiz, "textModeInput");
  assert.equal(quiz.document.getElementById("textAnswerForm").hidden, false);
  assert.match(
    quiz.document.getElementById("textDisclosure").textContent,
    /대사를 쓰면 원문과 맞춰봐요/,
  );
  submitText(quiz, "나 기다려");
  assert.equal(quiz.document.getElementById("textAnswerInput").value, "");
  assert.equal(quiz.fetchCalls.length, 0);
  quiz.runTimer(650);

  const summary = quiz.document.getElementById("summaryMetrics");
  assert.equal(summary.hidden, false);
  assert.equal(summary.childElementCount, 1);
  assert.match(summary.textContent, /50%대사 정확도/);
  assert.doesNotMatch(summary.textContent, /발음 정확도/);
});

test("입력하기도 같은 줄이 두 번 미달하면 안내 없이 통과한다", async () => {
  const quiz = await startQuiz();

  selectMode(quiz, "textModeInput");
  submitText(quiz, "힣");
  assert.equal(quiz.document.getElementById("retryButton").hidden, false);
  quiz.document.getElementById("retryButton").click();
  submitText(quiz, "힣");

  const summary = quiz.document.getElementById("summaryMetrics");
  assert.equal(summary.hidden, false);
  assert.equal(summary.childElementCount, 1);
  assert.match(summary.textContent, /0%대사 정확도/);
  assert.equal(quiz.document.getElementById("modeNotice").textContent, "");
});

test("입력과 음성을 섞으면 대사는 전체 시도, 발음은 음성 시도만 표시한다", async () => {
  const quiz = await startQuiz({
    voice: true,
    script: "나: 가\n나: 나",
    transcripts: ["힣", "힣"],
  });

  selectMode(quiz, "textModeInput");
  submitText(quiz, "가");
  quiz.runTimer(650);

  selectMode(quiz, "voiceModeInput");
  quiz.document.getElementById("speakButton").click();
  await settle();
  quiz.document.getElementById("retryButton").click();
  quiz.document.getElementById("speakButton").click();
  await settle();

  const summary = quiz.document.getElementById("summaryMetrics");
  assert.equal(summary.hidden, false);
  assert.equal(summary.childElementCount, 2);
  assert.match(summary.textContent, /50%대사 정확도/);
  assert.match(summary.textContent, /0%발음 정확도/);
});

test("두 번 미달해 조용히 통과한 줄도 요약에 포함한다", async () => {
  const quiz = await startQuiz({
    voice: true,
    transcripts: ["힣", "힣"],
  });

  quiz.document.getElementById("speakButton").click();
  await settle();
  quiz.document.getElementById("retryButton").click();
  quiz.document.getElementById("speakButton").click();
  await settle();

  const summary = quiz.document.getElementById("summaryMetrics");
  assert.equal(summary.hidden, false);
  assert.match(summary.textContent, /0%대사 정확도/);
  assert.match(summary.textContent, /0%발음 정확도/);
});

test("서버에서 브라우저로 폴백한 음성 완주에도 지표를 표시한다", async () => {
  const quiz = await startQuiz({ voice: true, serverFallback: true });
  const speakButton = quiz.document.getElementById("speakButton");

  speakButton.click();
  await settle();
  speakButton.click();
  await settle();
  assert.match(
    quiz.document.getElementById("voiceDisclosure").textContent,
    /브라우저 제공사 서버/,
  );

  speakButton.click();
  await settle();
  quiz.runTimer(650);

  const summary = quiz.document.getElementById("summaryMetrics");
  assert.equal(summary.hidden, false);
  assert.equal(summary.childElementCount, 2);
});
