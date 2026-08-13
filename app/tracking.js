const CORE_TRACK =
  "https://script.google.com/macros/s/AKfycbxmvQWyu-kslgIbVshJolG2KXV_omgT_vcUpmwJljvvYE8MkwUug-WGEhZmWUdU2ErK/exec";
const TRACKED_EVENTS_KEY = "read.trackedEvents";
const AD_ID_KEY = "read_ad_id";
const trackedEvents = new Set();

(function captureInboundUpstream() {
  if (typeof location === "undefined") return;
  const params = new URLSearchParams(location.search);
  const adId = ["utm_medium", "utm_campaign", "utm_content"]
    .map((key) => (params.get(key) || "").trim())
    .filter(Boolean)
    .join("-");
  if (adId) {
    try {
      sessionStorage.setItem(AD_ID_KEY, adId);
    } catch {
      // 저장 안 돼도 흐름은 계속한다.
    }
  }
})();

export function inboundAdId() {
  try {
    return sessionStorage.getItem(AD_ID_KEY) || "";
  } catch {
    return "";
  }
}

export function withInboundAdId(href) {
  const adId = inboundAdId();
  if (!adId) return href;
  return `${href}${href.includes("?") ? "&" : "?"}utm_id=${encodeURIComponent(adId)}`;
}

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

/**
 * 파생 지표(대본 크기·배역 수·체류 구간)를 보낸다.
 *
 * `trackEvent`와 달리 **세션 중복제거를 타지 않는다.** 퍼널 이벤트는 "이 방문에서
 * 일어났나"가 궁금하지만, 이쪽은 "대본을 몇 개 넣었나 / 몇 번 연습했나"라서
 * 한 번만 세면 뜻이 달라진다 — 같은 탭에서 작은 대본을 셋 넣으면 3건이어야 한다.
 */
export function trackMetric(name) {
  if (!isProductionHost()) return;
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
