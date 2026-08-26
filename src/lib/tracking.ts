const CORE_TRACK =
  "https://script.google.com/macros/s/AKfycbxmvQWyu-kslgIbVshJolG2KXV_omgT_vcUpmwJljvvYE8MkwUug-WGEhZmWUdU2ErK/exec";
const GA_ID = "G-DRMEWBN9Y9";
const TRACKED_EVENTS_KEY = "read.trackedEvents";
const AD_ID_KEY = "read_ad_id";
const trackedEvents = new Set<string>();

type Gtag = (...args: unknown[]) => void;
type TrackingWindow = Window & {
  dataLayer?: unknown[][];
  gtag?: Gtag;
};

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

export function withInboundAdId(href: string) {
  const adId = inboundAdId();
  if (!adId) return href;
  return `${href}${href.includes("?") ? "&" : "?"}utm_id=${encodeURIComponent(adId)}`;
}

function isProductionHost() {
  if (typeof location === "undefined") return false;
  return /(^|\.)acttub\.com$/.test(location.hostname);
}

/** 프로덕션에서만 GA4를 켠다. consent denied는 반드시 config보다 먼저 쌓는다. */
export function initializeGa4() {
  if (!isProductionHost() || typeof document === "undefined" || typeof window === "undefined") return;
  const trackingWindow = window as TrackingWindow;
  if (trackingWindow.gtag) return;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(script);

  const dataLayer = (trackingWindow.dataLayer = trackingWindow.dataLayer || []);
  trackingWindow.gtag = (...args: unknown[]) => dataLayer.push(args);
  trackingWindow.gtag("js", new Date());
  trackingWindow.gtag("consent", "default", { analytics_storage: "denied" });
  trackingWindow.gtag("config", GA_ID);
}

function hasTrackedEvent(name: string) {
  if (trackedEvents.has(name)) return true;

  try {
    const storedNames: unknown = JSON.parse(sessionStorage.getItem(TRACKED_EVENTS_KEY) || "[]");
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

function rememberTrackedEvent(name: string) {
  trackedEvents.add(name);
  try {
    sessionStorage.setItem(TRACKED_EVENTS_KEY, JSON.stringify([...trackedEvents]));
  } catch {
    // 기록 실패가 사용자 흐름을 막지 않도록 현재 문서의 Set만 유지한다.
  }
}

export function sendToSheet(payload: Record<string, unknown>) {
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

export function trackEvent(name: string) {
  if (!isProductionHost() || hasTrackedEvent(name)) return;
  rememberTrackedEvent(name);
  sendToSheet({
    type: "event",
    app: "read",
    name,
    at: new Date().toISOString(),
  });
}

/** 어느 경로로 들어오든 쿠키 없이 방문 한 건을 남긴다. */
export function trackVisit() {
  trackEvent("visit");
}

/** 세션 중복 제거 없이 대본·연습 횟수를 세는 파생 지표를 남긴다. */
export function trackMetric(name: string) {
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

export function trackCore(from: string, href: string) {
  try {
    const queryIndex = href.indexOf("?");
    sendToSheet({
      type: "click",
      at: new Date().toISOString(),
      from,
      src: queryIndex < 0 ? "" : href.slice(queryIndex),
      ref: location.origin,
      click_id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    });
  } catch {
    // 기록이 실패해도 acttub 링크 이동은 막지 않는다.
  }
}

export function trackCoreCta(href: string, mode: "read" | "quiz") {
  trackCore("read", href);
  trackEvent("cta_click");
  if (mode === "quiz") trackMetric("quiz_core_click");
  if (typeof window !== "undefined") {
    (window as TrackingWindow).gtag?.("event", "acttub_cta", { from: "read" });
  }
}
