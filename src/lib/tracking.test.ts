import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  initializeGa4,
  trackCore,
  trackEvent,
  trackTtsPlay,
  trackVisit,
} from "./tracking";

const originalGlobals = new Map(
  ["location", "navigator", "fetch", "sessionStorage", "window", "document"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);

function setGlobal(key: string, value: unknown) {
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
}

function makeSessionStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
}

async function importTrackingForPage(page: string) {
  void page;
  vi.resetModules();
  return import("./tracking");
}

function installGaDom(hostname: string) {
  const appendedScripts: Array<{ async?: boolean; src?: string }> = [];
  const trackingWindow: { dataLayer?: unknown[][]; gtag?: (...args: unknown[]) => void } = {};
  setGlobal("location", {
    hostname,
    origin: `https://${hostname}`,
    search: "",
  });
  setGlobal("window", trackingWindow);
  setGlobal("document", {
    createElement: () => ({}),
    head: {
      appendChild(script: { async?: boolean; src?: string }) {
        appendedScripts.push(script);
      },
    },
  });
  return { appendedScripts, trackingWindow };
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
  vi.restoreAllMocks();
});

test("퍼널 이벤트는 같은 세션에서 이름별 첫 한 번만 최소 payload로 보낸다", async () => {
  const sent: Array<{ url: string | URL; body: Blob }> = [];
  setGlobal("navigator", {
    sendBeacon(url: string | URL, body: Blob) {
      sent.push({ url, body });
      return true;
    },
  });

  trackEvent("landing_view");
  trackEvent("landing_view");

  expect(sent).toHaveLength(1);
  const payload = JSON.parse(await sent[0].body.text()) as Record<string, unknown>;
  expect(Object.keys(payload).sort()).toEqual(["app", "at", "name", "type"]);
  expect(payload.type).toBe("event");
  expect(payload.app).toBe("read");
  expect(payload.name).toBe("landing_view");
  expect(payload.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test("페이지 모듈이 바뀌어도 같은 세션의 같은 이벤트는 한 번만 보낸다", async () => {
  const sent: Array<{ body: Blob }> = [];
  setGlobal("navigator", {
    sendBeacon(_url: string | URL, body: Blob) {
      sent.push({ body });
      return true;
    },
  });

  const inputTracking = await importTrackingForPage("input");
  inputTracking.trackEvent("page_boundary_event");
  const charTracking = await importTrackingForPage("char");
  charTracking.trackEvent("page_boundary_event");
  const pracTracking = await importTrackingForPage("prac");
  pracTracking.trackEvent("page_boundary_event");

  expect(sent).toHaveLength(1);
  const payload = JSON.parse(await sent[0].body.text()) as Record<string, unknown>;
  expect(payload.name).toBe("page_boundary_event");
});

test("tts_play는 두 재생 경로가 함께 써도 세션에서 첫 한 번만 보낸다", async () => {
  const sent: Array<{ body: Blob }> = [];
  setGlobal("navigator", {
    sendBeacon(_url: string | URL, body: Blob) {
      sent.push({ body });
      return true;
    },
  });

  trackTtsPlay();
  trackTtsPlay();

  expect(sent).toHaveLength(1);
  const payload = JSON.parse(await sent[0].body.text()) as Record<string, unknown>;
  expect(payload.name).toBe("tts_play");
});

test("프로덕션 호스트가 아니면 이벤트를 전송하지 않는다", () => {
  setGlobal("location", { hostname: "localhost", origin: "http://localhost:3000", search: "" });
  let sent = 0;
  setGlobal("navigator", {
    sendBeacon() {
      sent += 1;
      return true;
    },
  });

  trackEvent("script_submit");

  expect(sent).toBe(0);
});

test("localhost에서는 다섯 진입 경로 모두 gtag 스크립트를 로드하지 않는다", () => {
  for (const page of ["input", "script", "char", "prac", "quiz"]) {
    const { appendedScripts, trackingWindow } = installGaDom("localhost");
    setGlobal("location", { hostname: "localhost", origin: "http://localhost:3000", search: "", pathname: `/${page}` });
    initializeGa4();
    expect(appendedScripts, page).toHaveLength(0);
    expect(trackingWindow.gtag, page).toBeUndefined();
    expect(trackingWindow.dataLayer, page).toBeUndefined();
  }
});

test("다섯 진입 경로 모두 consent denied를 config보다 먼저 dataLayer에 넣는다", () => {
  for (const page of ["input", "script", "char", "prac", "quiz"]) {
    const { appendedScripts, trackingWindow } = installGaDom("read.acttub.com");
    setGlobal("location", {
      hostname: "read.acttub.com",
      origin: "https://read.acttub.com",
      search: "",
      pathname: `/${page}`,
    });
    initializeGa4();

    expect(appendedScripts, page).toHaveLength(1);
    expect(appendedScripts[0].src, page).toBe(
      "https://www.googletagmanager.com/gtag/js?id=G-DRMEWBN9Y9",
    );
    const commands = trackingWindow.dataLayer ?? [];
    const consentIndex = commands.findIndex(
      ([command, mode]) => command === "consent" && mode === "default",
    );
    const configIndex = commands.findIndex(
      ([command, id]) => command === "config" && id === "G-DRMEWBN9Y9",
    );
    expect(consentIndex, `${page} consent missing`).toBeGreaterThanOrEqual(0);
    expect(configIndex, `${page} config must follow consent`).toBeGreaterThan(consentIndex);
    expect((commands[consentIndex][2] as { analytics_storage: string }).analytics_storage, page).toBe("denied");
  }
});

test("sendBeacon이 큐에 넣지 못하면 keepalive fetch로 폴백한다", async () => {
  setGlobal("navigator", { sendBeacon: () => false });
  const calls: Array<{ url: string | URL | Request; options?: RequestInit }> = [];
  setGlobal("fetch", async (url: string | URL | Request, options?: RequestInit) => {
    calls.push({ url, options });
    return new Response();
  });

  trackEvent("practice_start");
  await Promise.resolve();

  expect(calls).toHaveLength(1);
  expect(calls[0].options?.keepalive).toBe(true);
  expect(calls[0].options?.mode).toBe("no-cors");
  expect(JSON.parse(String(calls[0].options?.body)).name).toBe("practice_start");
});

test("코어 클릭은 read 채널만 남기고 사용자 입력을 싣지 않는다", async () => {
  const sent: Array<{ body: Blob }> = [];
  setGlobal("navigator", {
    sendBeacon(_url: string | URL, body: Blob) {
      sent.push({ body });
      return true;
    },
  });

  trackCore("read", "https://acttub.com");

  expect(sent).toHaveLength(1);
  const payload = JSON.parse(await sent[0].body.text()) as Record<string, unknown>;
  expect(Object.keys(payload).sort()).toEqual(["at", "click_id", "from", "ref", "src", "type"].sort());
  expect(payload.type).toBe("click");
  expect(payload.from).toBe("read");
  expect(payload.src).toBe("");
  expect(payload.ref).toBe("https://read.acttub.com");
});

test("인바운드 광고 식별자를 저장해 코어 링크의 utm_id로 넘긴다", async () => {
  setGlobal("location", {
    hostname: "read.acttub.com",
    origin: "https://read.acttub.com",
    search: "?utm_source=instagram&utm_medium=paid&utm_campaign=actors&utm_content=carousel%2001",
  });
  const tracking = await importTrackingForPage("quiz-ad-id");
  const coreHref =
    "https://acttub.com/?utm_source=read&utm_medium=subproject&utm_campaign=read_quiz";

  expect(sessionStorage.getItem("read_ad_id")).toBe("paid-actors-carousel 01");
  expect(tracking.withInboundAdId(coreHref)).toBe(
    `${coreHref}&utm_id=paid-actors-carousel%2001`,
  );
});

test("인바운드 광고 식별자가 없으면 코어 링크는 그대로 둔다", async () => {
  const tracking = await importTrackingForPage("quiz-no-ad-id");
  const coreHref =
    "https://acttub.com/?utm_source=read&utm_medium=subproject&utm_campaign=read_quiz";

  expect(tracking.withInboundAdId(coreHref)).toBe(coreHref);
});

// ⚠️ 아래 셋은 **배선 확인**이지 동작 테스트가 아니다 — 소스 문자열을 찾을 뿐이라
// 리팩터하면 깨지고, 통과해도 실제로 도는지는 말해 주지 않는다. 계측이 통째로 빠지는
// 사고만 막는 용도다. 로직을 검사하려면 순수 함수로 빼서 따로 테스트해라
// (모드 결정은 storage.ts 의 applyInitialMode 와 storage.test.ts 로 그렇게 옮겼다).
test("배선 — 공유 진입 셸이 모든 경로의 방문을 센다", async () => {
  const [layout, trackingComponent] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/Tracking.tsx", import.meta.url), "utf8"),
  ]);
  expect(layout).toMatch(/<Tracking\s*\/>/);
  expect(trackingComponent).toMatch(/\btrackVisit\(\)/);
});

test("방문은 페이지를 옮겨 다녀도 세션당 한 번만 보낸다", async () => {
  const sent: Array<{ body: Blob }> = [];
  setGlobal("navigator", {
    sendBeacon(_url: string | URL, body: Blob) {
      sent.push({ body });
      return true;
    },
  });

  trackVisit();
  const charTracking = await importTrackingForPage("char");
  charTracking.trackVisit();
  const quizTracking = await importTrackingForPage("quiz");
  quizTracking.trackVisit();

  expect(sent).toHaveLength(1);
  const payload = JSON.parse(await sent[0].body.text()) as Record<string, unknown>;
  expect(payload.name).toBe("visit");
  expect(payload.app).toBe("read");
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

  expect(() => trackVisit()).not.toThrow();
  expect(called).toBe(false);
});

test("배선 — acttub으로 나가는 링크가 있는 화면은 코어 클릭을 센다", async () => {
  const source = await readFile(
    new URL("../components/screens/DoneScreen.tsx", import.meta.url),
    "utf8",
  );
  expect(source).toMatch(/https:\/\/acttub\.com/);
  expect(source).toMatch(/\btrackCoreCta\(/);
});

test("배선 — 진입 URL이 초기 모드를 정하고 준비 URL은 홈으로 보낸다", async () => {
  const [quiz, prac, input, char, script, app, setup] = await Promise.all([
    readFile(new URL("../app/quiz/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/prac/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/input/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/char/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/script/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/screens/SetupScreen.tsx", import.meta.url), "utf8"),
  ]);
  expect(quiz).toMatch(/<App initialMode="quiz"\s*\/>/);
  expect(prac).toMatch(/<App initialMode="read"\s*\/>/);
  for (const source of [input, char, script]) expect(source).toMatch(/redirect\("\/"\)/);
  // 모드 결정은 소스 문자열이 아니라 동작으로 확인한다 — 아래 describe 참고.
  expect(app).toMatch(/applyInitialMode\(/);
  expect(setup).toMatch(/initialSetup\?\.mode \?\? initialMode/);
});
