import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SAMPLE_SCRIPT } from "../app/sample-script.js";

class FakeElement {
  constructor() {
    this.children = [];
    this.classNames = new Set();
    this.classList = {
      toggle: (name, enabled) => {
        if (enabled) this.classNames.add(name);
        else this.classNames.delete(name);
      },
    };
    this.disabled = false;
    this.files = [];
    this.hidden = false;
    this.listeners = new Map();
    this.scrollHeight = 320;
    this.style = {};
    this.textContent = "";
    this.value = "";
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  append(...children) {
    this.children.push(...children);
  }

  click() {
    return this.listeners.get("click")?.();
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute() {}
}

function makeSessionStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function makeDocument(ids) {
  const elements = new Map(ids.map((id) => [id, new FakeElement()]));
  return {
    createElement: () => new FakeElement(),
    getElementById: (id) => elements.get(id),
    elements,
  };
}

test("랜딩 히어로의 두 CTA는 같은 크기의 버튼으로 나란히 놓인다", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/input.css", import.meta.url), "utf8"),
  ]);
  const actions = html.match(/<div class="home-actions">([\s\S]*?)<\/div>/)?.[1];

  assert.ok(actions);
  assert.match(actions, /class="button-primary button-large"[^>]*>대본 넣기<\/a>/);
  assert.match(actions, /class="button-secondary button-large"[^>]*>예시 대본으로 해보기<\/button>/);
  assert.equal(actions.match(/button-large/g)?.length, 2);
  assert.doesNotMatch(html, /class="button-text[^"]*"[^>]*>예시 대본/);
  assert.match(
    css,
    /\.home-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.doesNotMatch(
    css,
    /\.home-actions\s*\{[^}]*grid-template-columns:\s*auto auto/,
  );
});

test("두 예시 입구가 같은 대본을 쓰고 사용 이벤트는 세션에서 한 번만 보낸다", async () => {
  const originalGlobals = new Map(
    ["document", "getComputedStyle", "location", "navigator", "sessionStorage", "window"]
      .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const sent = [];

  try {
    Object.defineProperties(globalThis, {
      location: {
        configurable: true,
        value: {
          hostname: "read.acttub.com",
          origin: "https://read.acttub.com",
          search: "",
        },
      },
      navigator: {
        configurable: true,
        value: {
          sendBeacon(url, body) {
            sent.push({ url, body });
            return true;
          },
        },
      },
      sessionStorage: { configurable: true, value: makeSessionStorage() },
    });

    const homeDocument = makeDocument(["sampleScriptButton"]);
    const homeWindow = { location: { href: "" } };
    Object.defineProperties(globalThis, {
      document: { configurable: true, value: homeDocument },
      window: { configurable: true, value: homeWindow },
    });

    await import(`../app/home.js?sample-entry=${Date.now()}`);
    homeDocument.elements.get("sampleScriptButton").click();

    assert.equal(sessionStorage.getItem("read.script"), SAMPLE_SCRIPT);
    assert.equal(homeWindow.location.href, "/script");

    const inputIds = [
      "scriptInput",
      "continueButton",
      "scriptError",
      "emptyState",
      "inputState",
      "pasteButton",
      "writeButton",
      "sampleScriptButton",
      "resetButton",
      "pasteGuidance",
      "scriptFileInput",
      "scriptFileButton",
      "scriptFileButtonText",
      "scriptFileStatus",
      "roleChips",
      "roleLookupStatus",
      "manualRolesField",
      "manualRolesInput",
    ];
    const inputDocument = makeDocument(inputIds);
    const inputWindow = { addEventListener() {}, location: { href: "" } };
    Object.defineProperties(globalThis, {
      document: { configurable: true, value: inputDocument },
      getComputedStyle: {
        configurable: true,
        value: () => ({ maxHeight: "520px" }),
      },
      window: {
        configurable: true,
        value: inputWindow,
      },
    });

    await import(`../app/input.js?sample-entry=${Date.now()}`);
    inputDocument.elements.get("sampleScriptButton").click();

    assert.equal(inputDocument.elements.get("scriptInput").value, SAMPLE_SCRIPT);
    assert.equal(inputDocument.elements.get("emptyState").hidden, true);
    assert.equal(inputDocument.elements.get("inputState").hidden, false);
    assert.equal(inputDocument.elements.get("continueButton").disabled, false);
    assert.equal(inputDocument.elements.get("roleChips").children.length, 2);

    inputDocument.elements.get("continueButton").click();
    assert.equal(inputWindow.location.href, "/script");

    const payloads = await Promise.all(
      sent.map(async ({ body }) => JSON.parse(await body.text())),
    );
    assert.equal(
      payloads.filter(({ name }) => name === "sample_script_load").length,
      1,
    );
    assert.equal(
      payloads.filter(({ name }) => name === "script_submit").length,
      1,
    );
  } finally {
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
