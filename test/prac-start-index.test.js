import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const ELEMENT_IDS = [
  "readingSurface",
  "currentLineCard",
  "currentRoleName",
  "currentLineText",
  "progressText",
  "mobileRemaining",
  "elapsedTime",
  "mobileElapsed",
  "readingPastTurns",
  "readingNextTurn",
  "statusPill",
  "modeError",
  "completionMessage",
  "pauseButton",
  "nextButton",
  "modeHint",
  "sessionTitle",
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
    else Reflect.deleteProperty(globalThis, name);
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
  constructor(tagName = "div", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.classList = new FakeClassList();
    this.disabled = false;
    this.hidden = false;
    this.listeners = new Map();
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

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
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

  querySelector() {
    return null;
  }
}

class FakeDocument {
  constructor() {
    this.elements = new Map(
      ELEMENT_IDS.map((id) => [id, new FakeElement("div", id)]),
    );
  }

  getElementById(id) {
    return this.elements.get(id) || null;
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  createDocumentFragment() {
    return new FakeElement("#fragment");
  }
}

function makeStorage(script, startIndex) {
  const values = new Map([
    ["read.script", script],
    ["read.myRole", "나"],
    ["read.startIndex", String(startIndex)],
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

function makeScript(length) {
  return Array.from({ length }, (_, index) =>
    `${index % 2 === 0 ? "상대" : "나"}: ${index + 1}번째 대사`
  ).join("\n");
}

async function startPractice(startIndex) {
  const document = new FakeDocument();
  const location = {
    hostname: "localhost",
    origin: "http://localhost",
    search: "",
    href: "http://localhost/prac",
    replace() {},
  };
  const window = {
    location,
    addEventListener() {},
    clearTimeout() {},
    setTimeout() {
      return 1;
    },
  };

  setGlobal("document", document);
  setGlobal("location", location);
  setGlobal("navigator", { userAgent: "local-test" });
  setGlobal("sessionStorage", makeStorage(makeScript(20), startIndex));
  setGlobal("window", window);

  importSequence += 1;
  await import(`../app/prac.js?start-index-test=${importSequence}`);
  return document;
}

test("prac은 저장한 시작 지점부터 출발한다", async () => {
  const document = await startPractice(15);

  assert.equal(document.getElementById("currentRoleName").textContent, "나 · 내 차례");
  assert.equal(document.getElementById("currentLineText").textContent, "16번째 대사");
  assert.equal(document.getElementById("progressText").textContent, "5");
  assert.equal(document.getElementById("mobileRemaining").textContent, "5");
  assert.equal(document.getElementById("readingPastTurns").children.length, 2);
  assert.match(
    document.getElementById("readingNextTurn").textContent,
    /17번째 대사/,
  );
});

test("prac은 범위 밖 시작 지점을 0으로 처리한다", async () => {
  const document = await startPractice(20);

  assert.equal(document.getElementById("currentRoleName").textContent, "상대");
  assert.equal(document.getElementById("currentLineText").textContent, "1번째 대사");
  assert.equal(document.getElementById("progressText").textContent, "20");
  assert.equal(document.getElementById("readingPastTurns").children.length, 0);
});
