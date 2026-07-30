import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { trackCore, trackEvent, trackTtsPlay } from "../app/tracking.js";

const originalGlobals = new Map(
  ["location", "navigator", "fetch"].map((key) => [
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

beforeEach(() => {
  setGlobal("location", {
    hostname: "read.acttub.com",
    origin: "https://read.acttub.com",
  });
  setGlobal("fetch", async () => new Response());
});

afterEach(() => {
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("퍼널 이벤트는 발생할 때마다 최소 payload로 보낸다", async () => {
  const sent = [];
  setGlobal("navigator", {
    sendBeacon(url, body) {
      sent.push({ url, body });
      return true;
    },
  });

  trackEvent("landing_view");
  trackEvent("landing_view");

  assert.equal(sent.length, 2);
  const payload = JSON.parse(await sent[0].body.text());
  assert.deepEqual(Object.keys(payload).sort(), ["app", "at", "name", "type"]);
  assert.equal(payload.type, "event");
  assert.equal(payload.app, "read");
  assert.equal(payload.name, "landing_view");
  assert.match(payload.at, /^\d{4}-\d{2}-\d{2}T/);
});

test("tts_play는 두 재생 경로가 함께 써도 모듈에서 첫 한 번만 보낸다", async () => {
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
