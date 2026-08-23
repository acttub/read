import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SAMPLE_SCRIPT } from "../app/sample-script.js";

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.children = [];
    this.className = "";
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
    ["chooseRoleButton", new FakeElement()],
  ]);
  return {
    createElement: () => new FakeElement(),
    getElementById: (id) => elements.get(id),
    elements,
  };
}

function makeSessionStorage(script = "") {
  const values = new Map();
  if (script) values.set("read.script", script);
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

async function withScriptPage(script, run) {
  const originalGlobals = new Map(
    ["document", "sessionStorage", "window"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const document = makeDocument();
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
        value: makeSessionStorage(script),
      },
      window: { configurable: true, value: window },
    });

    await import(`../app/script.js?script-page=${Date.now()}-${Math.random()}`);
    await run({ document, replaced, window });
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
  assert.match(html, /id="chooseRoleButton"/);

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

test("/script는 저장된 대본이 없으면 /input으로 돌려보낸다", async () => {
  await withScriptPage("", ({ document, replaced }) => {
    assert.deepEqual(replaced, ["/input"]);
    assert.equal(document.elements.get("scriptTurns").children.length, 0);
  });
});

test("/script의 배역 고르기 CTA는 /char로 이동한다", async () => {
  await withScriptPage(SAMPLE_SCRIPT, ({ document, window }) => {
    document.elements.get("chooseRoleButton").click();
    assert.equal(window.location.href, "/char");
  });
});
