const CORE_TRACK =
  "https://script.google.com/macros/s/AKfycbxmvQWyu-kslgIbVshJolG2KXV_omgT_vcUpmwJljvvYE8MkwUug-WGEhZmWUdU2ErK/exec";
let hasTrackedTtsPlay = false;

function isProductionHost() {
  return /(^|\.)acttub\.com$/.test(location.hostname);
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
  if (!isProductionHost()) return;
  sendToSheet({
    type: "event",
    app: "read",
    name,
    at: new Date().toISOString(),
  });
}

export function trackTtsPlay() {
  if (!isProductionHost() || hasTrackedTtsPlay) return;
  hasTrackedTtsPlay = true;
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
