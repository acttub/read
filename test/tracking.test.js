import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, test } from "node:test";
import vm from "node:vm";

import { trackCore, trackEvent, trackTtsPlay, trackVisit } from "../app/tracking.js";

const originalGlobals = new Map(
  ["location", "navigator", "fetch", "sessionStorage"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);

function setGlobal(key, value) {
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
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

async function importTrackingForPage(page) {
  const url = new URL("../app/tracking.js", import.meta.url);
  url.searchParams.set("page", `${page}-${Date.now()}-${Math.random()}`);
  return import(url.href);
}

async function readGaSnippet(page) {
  const html = await readFile(new URL(`../${page}/index.html`, import.meta.url), "utf8");
  const match = html.match(/<!-- GA4[\s\S]*?<script>([\s\S]*?)<\/script>/);
  assert.ok(match, `${page} GA4 snippet missing`);
  return match[1];
}

function runGaSnippet(source, hostname) {
  const appendedScripts = [];
  const context = {
    Date,
    location: { hostname },
    document: {
      createElement: () => ({}),
      head: {
        appendChild(script) {
          appendedScripts.push(script);
        },
      },
    },
    window: {},
  };
  vm.runInNewContext(source, context);
  return { appendedScripts, window: context.window };
}

beforeEach(() => {
  setGlobal("location", {
    hostname: "read.acttub.com",
    origin: "https://read.acttub.com",
    search: "",
  });
  setGlobal("fetch", async () => new Response());
  setGlobal("sessionStorage", makeSessionStorage());
});

afterEach(() => {
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("퍼널 이벤트는 같은 세션에서 이름별 첫 한 번만 최소 payload로 보낸다", async () => {
  const sent = [];
  setGlobal("navigator", {
    sendBeacon(url, body) {
      sent.push({ url, body });
      return true;
    },
  });

  trackEvent("landing_view");
  trackEvent("landing_view");

  assert.equal(sent.length, 1);
  const payload = JSON.parse(await sent[0].body.text());
  assert.deepEqual(Object.keys(payload).sort(), ["app", "at", "name", "type"]);
  assert.equal(payload.type, "event");
  assert.equal(payload.app, "read");
  assert.equal(payload.name, "landing_view");
  assert.match(payload.at, /^\d{4}-\d{2}-\d{2}T/);
});

test("페이지 모듈이 바뀌어도 같은 세션의 같은 이벤트는 한 번만 보낸다", async () => {
  const sent = [];
  setGlobal("navigator", {
    sendBeacon(url, body) {
      sent.push({ url, body });
      return true;
    },
  });

  const inputTracking = await importTrackingForPage("input");
  inputTracking.trackEvent("page_boundary_event");
  const charTracking = await importTrackingForPage("char");
  charTracking.trackEvent("page_boundary_event");
  const pracTracking = await importTrackingForPage("prac");
  pracTracking.trackEvent("page_boundary_event");

  assert.equal(sent.length, 1);
  const payload = JSON.parse(await sent[0].body.text());
  assert.equal(payload.name, "page_boundary_event");
});

test("tts_play는 두 재생 경로가 함께 써도 세션에서 첫 한 번만 보낸다", async () => {
  const sent = [];
  setGlobal("navigator", {
    sendBeacon(url, body) {
      sent.push({ url, body });
      return true;
    },
  });

  trackTtsPlay();
  trackTtsPlay();

  assert.equal(sent.length, 1);
  const payload = JSON.parse(await sent[0].body.text());
  assert.equal(payload.name, "tts_play");
});

test("프로덕션 호스트가 아니면 이벤트를 전송하지 않는다", () => {
  setGlobal("location", {
    hostname: "localhost",
    origin: "http://localhost:3000",
  });
  let sent = 0;
  setGlobal("navigator", {
    sendBeacon() {
      sent += 1;
      return true;
    },
  });

  trackEvent("script_submit");

  assert.equal(sent, 0);
});

test("localhost에서는 다섯 페이지 모두 gtag 스크립트를 로드하지 않는다", async () => {
  for (const page of ["input", "script", "char", "prac", "quiz"]) {
    const result = runGaSnippet(await readGaSnippet(page), "localhost");
    assert.equal(result.appendedScripts.length, 0, page);
    assert.equal(result.window.gtag, undefined, page);
    assert.equal(result.window.dataLayer, undefined, page);
  }
});

test("다섯 페이지 모두 consent denied를 config보다 먼저 dataLayer에 넣는다", async () => {
  for (const page of ["input", "script", "char", "prac", "quiz"]) {
    const result = runGaSnippet(await readGaSnippet(page), "read.acttub.com");
    assert.equal(result.appendedScripts.length, 1, page);
    assert.equal(
      result.appendedScripts[0].src,
      "https://www.googletagmanager.com/gtag/js?id=G-DRMEWBN9Y9",
      page,
    );

    const commands = result.window.dataLayer.map((entry) => Array.from(entry));
    const consentIndex = commands.findIndex(
      ([command, mode]) => command === "consent" && mode === "default",
    );
    const configIndex = commands.findIndex(
      ([command, id]) => command === "config" && id === "G-DRMEWBN9Y9",
    );
    assert.ok(consentIndex >= 0, `${page} consent missing`);
    assert.ok(configIndex > consentIndex, `${page} config must follow consent`);
    assert.equal(commands[consentIndex][2].analytics_storage, "denied", page);
  }
});

test("sendBeacon이 큐에 넣지 못하면 keepalive fetch로 폴백한다", async () => {
  setGlobal("navigator", { sendBeacon: () => false });
  const calls = [];
  setGlobal("fetch", async (url, options) => {
    calls.push({ url, options });
    return new Response();
  });

  trackEvent("practice_start");
  await Promise.resolve();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.keepalive, true);
  assert.equal(calls[0].options.mode, "no-cors");
  assert.equal(JSON.parse(calls[0].options.body).name, "practice_start");
});

test("코어 클릭은 read 채널만 남기고 사용자 입력을 싣지 않는다", async () => {
  const sent = [];
  setGlobal("navigator", {
    sendBeacon(url, body) {
      sent.push({ url, body });
      return true;
    },
  });

  trackCore("read", "https://acttub.com");

  assert.equal(sent.length, 1);
  const payload = JSON.parse(await sent[0].body.text());
  assert.deepEqual(
    Object.keys(payload).sort(),
    ["at", "click_id", "from", "ref", "src", "type"].sort(),
  );
  assert.equal(payload.type, "click");
  assert.equal(payload.from, "read");
  assert.equal(payload.src, "");
  assert.equal(payload.ref, "https://read.acttub.com");
});

test("인바운드 광고 식별자를 저장해 코어 링크의 utm_id로 넘긴다", async () => {
  setGlobal("location", {
    hostname: "read.acttub.com",
    origin: "https://read.acttub.com",
    search:
      "?utm_source=instagram&utm_medium=paid&utm_campaign=actors&utm_content=carousel%2001",
  });
  const tracking = await importTrackingForPage("quiz-ad-id");
  const coreHref =
    "https://acttub.com/?utm_source=read&utm_medium=subproject&utm_campaign=read_quiz";

  assert.equal(
    sessionStorage.getItem("read_ad_id"),
    "paid-actors-carousel 01",
  );
  assert.equal(
    tracking.withInboundAdId(coreHref),
    `${coreHref}&utm_id=paid-actors-carousel%2001`,
  );
});

test("인바운드 광고 식별자가 없으면 코어 링크는 그대로 둔다", async () => {
  const tracking = await importTrackingForPage("quiz-no-ad-id");
  const coreHref =
    "https://acttub.com/?utm_source=read&utm_medium=subproject&utm_campaign=read_quiz";

  assert.equal(tracking.withInboundAdId(coreHref), coreHref);
});

/* 쿠키 없이 도는 앱이라 GA4가 방문을 세지 못한다. ops의 서브프로젝트 방문자 칸은
   이 `visit` 하나에 걸려 있으므로, 진입 페이지가 늘었는데 호출을 빠뜨리면 그 칸이
   조용히 작아진다 — 소스로 못을 박아 둔다. */
test("진입 스크립트 여섯 개가 모두 방문을 센다", async () => {
  for (const page of ["home", "input", "script", "char", "prac", "quiz"]) {
    const source = await readFile(new URL(`../app/${page}.js`, import.meta.url), "utf8");
    assert.match(source, /\btrackVisit\(\)/, `${page}.js가 trackVisit()을 부르지 않는다`);
  }
});

test("방문은 페이지를 옮겨 다녀도 세션당 한 번만 보낸다", async () => {
  const sent = [];
  setGlobal("navigator", {
    sendBeacon(url, body) {
      sent.push({ url, body });
      return true;
    },
  });

  trackVisit();
  const charTracking = await importTrackingForPage("char");
  charTracking.trackVisit();
  const quizTracking = await importTrackingForPage("quiz");
  quizTracking.trackVisit();

  assert.equal(sent.length, 1);
  const payload = JSON.parse(await sent[0].body.text());
  assert.equal(payload.name, "visit");
  assert.equal(payload.app, "read");
});

test("location이 없는 환경에서는 방문을 보내지 않고 조용히 넘어간다", () => {
  Reflect.deleteProperty(globalThis, "location");
  let called = false;
  setGlobal("navigator", {
    sendBeacon() {
      called = true;
      return true;
    },
  });

  assert.doesNotThrow(() => trackVisit());
  assert.equal(called, false);
});

/* 코어로 나가는 링크가 시트 '유입'(클릭) 탭에 잡히는 유일한 경로가 trackCore다.
   링크만 놓고 이걸 빠뜨리면 ops의 "어떻게 들어오나"에 read 채널이 아예 안 생긴다 —
   /quiz 완주 CTA가 정확히 그 상태로 오래 있었다. 링크가 있는 페이지는 반드시 부른다. */
test("acttub으로 나가는 링크가 있는 페이지는 코어 클릭을 센다", async () => {
  const pages = ["input", "script", "char", "prac", "quiz"];
  const withLink = [];
  for (const page of pages) {
    const html = await readFile(new URL(`../${page}/index.html`, import.meta.url), "utf8");
    if (/href="https:\/\/acttub\.com/.test(html)) withLink.push(page);
  }
  assert.ok(withLink.length > 0, "코어 링크가 있는 페이지를 하나도 못 찾았다");

  for (const page of withLink) {
    const source = await readFile(new URL(`../app/${page}.js`, import.meta.url), "utf8");
    assert.match(
      source,
      /trackCore\(\s*"read"/,
      `${page}.js가 코어 링크를 두고도 trackCore("read", …)를 부르지 않는다`,
    );
  }
});
