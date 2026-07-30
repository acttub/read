const CORE_TRACK =
  "https://script.google.com/macros/s/AKfycbxmvQWyu-kslgIbVshJolG2KXV_omgT_vcUpmwJljvvYE8MkwUug-WGEhZmWUdU2ErK/exec";
const TRACKED_EVENTS_KEY = "read.trackedEvents";
const trackedEvents = new Set();

function isProductionHost() {
  return /(^|\.)acttub\.com$/.test(location.hostname);
}

function hasTrackedEvent(name) {
  if (trackedEvents.has(name)) return true;

  try {
    const storedNames = JSON.parse(
      sessionStorage.getItem(TRACKED_EVENTS_KEY) || "[]",
    );
    if (Array.isArray(storedNames)) {
      for (const storedName of storedNames) {
        if (typeof storedName === "string") trackedEvents.add(storedName);
      }
    }
  } catch {
    // 저장소를 쓸 수 없는 환경에서도 현재 문서 안의 중복은 Set으로 막는다.
  }

  return trackedEvents.has(name);
}

function rememberTrackedEvent(name) {
  trackedEvents.add(name);
  try {
    sessionStorage.setItem(
      TRACKED_EVENTS_KEY,
      JSON.stringify([...trackedEvents]),
    );
  } catch {
    // 기록 실패가 사용자 흐름을 막지 않도록 현재 문서의 Set만 유지한다.
  }
}

export function sendToSheet(payload) {
  if (!isProductionHost()) return;
  try {
    const body = JSON.stringify(payload);
    const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
    if (!(navigator.sendBeacon && navigator.sendBeacon(CORE_TRACK, blob))) {
      fetch(CORE_TRACK, {
        method: "POST",
        mode: "no-cors",
        keepalive: true,
        body,
      }).catch(() => {});
    }
  } catch {
    // 기록이 실패해도 대본 입력·재생·이동은 계속되어야 한다.
  }
}

export function trackEvent(name) {
  if (!isProductionHost() || hasTrackedEvent(name)) return;
  rememberTrackedEvent(name);
  sendToSheet({
    type: "event",
    app: "read",
    name,
    at: new Date().toISOString(),
  });
}

export function trackTtsPlay() {
  trackEvent("tts_play");
}

export function trackCore(from, href) {
  try {
    const queryIndex = href.indexOf("?");
    sendToSheet({
      type: "click",
      at: new Date().toISOString(),
      from,
      src: queryIndex < 0 ? "" : href.slice(queryIndex),
      ref: location.origin,
      click_id:
        Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    });
  } catch {
    // 기록이 실패해도 acttub 링크 이동은 막지 않는다.
  }
}
