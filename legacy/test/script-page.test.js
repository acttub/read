import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SAMPLE_SCRIPT } from "../app/sample-script.js";

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.children = [];
    this.className = "";
    this.hidden = false;
    this.listeners = new Map();
    this.textContent = "";
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

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

function makeDocument() {
  const elements = new Map([
    ["scriptTurns", new FakeElement()],
    ["startPointStatus", new FakeElement()],
  ]);
  return {
    createElement: () => new FakeElement(),
    getElementById: (id) => elements.get(id),
    elements,
  };
}

function makeSessionStorage(script = "", startIndex = null) {
  const values = new Map();
  if (script) values.set("read.script", script);
  if (startIndex !== null) values.set("read.startIndex", String(startIndex));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    values,
  };
}

async function withScriptPage(script, run, startIndex = null) {
  const originalGlobals = new Map(
    ["document", "sessionStorage", "window"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const document = makeDocument();
  const storage = makeSessionStorage(script, startIndex);
  const replaced = [];
  const window = {
    location: {
      href: "",
      replace(path) {
        replaced.push(path);
      },
    },
  };

  try {
    Object.defineProperties(globalThis, {
      document: { configurable: true, value: document },
      sessionStorage: {
        configurable: true,
        value: storage,
      },
      window: { configurable: true, value: window },
    });

    await import(`../app/script.js?script-page=${Date.now()}-${Math.random()}`);
    await run({ document, replaced, storage, window });
  } finally {
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test("/script는 예시 대본의 12턴을 배역명과 대사로 전부 렌더한다", async () => {
  const html = await readFile(
    new URL("../script/index.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /id="scriptTurns"/);
  assert.match(html, /script-review-actions-top/);
  assert.match(html, /id="startPointStatus"/);
  assert.match(html, /href="\/char"/);

  await withScriptPage(SAMPLE_SCRIPT, ({ document, replaced }) => {
    const turns = document.elements.get("scriptTurns").children;
    assert.deepEqual(replaced, []);
    assert.equal(turns.length, 12);
    assert.equal(turns[0].children[0].textContent, "지우");
    assert.equal(turns[0].children[1].textContent, "나 오늘 좀 이상하지. 말이 자꾸 꼬여.");
    assert.equal(turns[11].children[0].textContent, "민준");
    assert.equal(turns[11].children[1].textContent, "그럼 처음부터. 내가 먼저 갈게.");
  });
});

test("/script 대사 카드는 시작 지점을 즉시 저장하고 같은 카드를 누르면 해제한다", async () => {
  await withScriptPage(SAMPLE_SCRIPT, ({ document, storage }) => {
    const turns = document.elements.get("scriptTurns").children;
    const status = document.elements.get("startPointStatus");

    assert.equal(status.textContent, "처음부터 시작해요");
    assert.equal(turns[0].attributes.get("aria-pressed"), "false");

    turns[11].click();
    assert.equal(storage.values.get("read.startIndex"), "11");
    assert.equal(status.textContent, "12번째 대사부터 시작해요");
    assert.equal(turns[11].attributes.get("aria-pressed"), "true");
    assert.match(turns[11].className, /is-start/);
    assert.equal(turns[11].children[2].textContent, "여기부터 시작");
    assert.equal(turns[11].children[2].hidden, false);

    turns[11].click();
    assert.equal(storage.values.get("read.startIndex"), "");
    assert.equal(status.textContent, "처음부터 시작해요");
    assert.equal(turns[11].attributes.get("aria-pressed"), "false");
    assert.doesNotMatch(turns[11].className, /is-start/);
    assert.equal(turns[11].children[2].hidden, true);

    turns[0].click();
    assert.equal(storage.values.get("read.startIndex"), "0");
    assert.equal(turns[0].attributes.get("aria-pressed"), "true");
  });
});

test("/script는 저장된 시작 지점을 선택 상태로 복원한다", async () => {
  await withScriptPage(SAMPLE_SCRIPT, ({ document }) => {
    const turns = document.elements.get("scriptTurns").children;
    assert.equal(
      document.elements.get("startPointStatus").textContent,
      "4번째 대사부터 시작해요",
    );
    assert.equal(turns[3].attributes.get("aria-pressed"), "true");
    assert.match(turns[3].className, /is-start/);
  }, 3);
});

test("/script는 저장된 대본이 없으면 /input으로 돌려보낸다", async () => {
  await withScriptPage("", ({ document, replaced }) => {
    assert.deepEqual(replaced, ["/input"]);
    assert.equal(document.elements.get("scriptTurns").children.length, 0);
  });
});
