/* acttub 서브프로젝트 공용 티어 분기 유틸.
   tools/brand-tokens-export.py가 생성한다. 이 파일을 직접 고치지 않는다 —
   티어 경계를 바꾸려면 brand/DESIGN.md의 `breakpoints:`를 고치고 다시 생성한다.
   경계 숫자가 brand/responsive-base.css와 항상 같아야 하므로 둘을 같이 생성한다. */

export const BREAKPOINTS = Object.freeze({
  tablet: 600,
  desktop: 1024,
});

/* 좁은 것부터. phone이 기본값이다(mobile-first). */
export const TIERS = Object.freeze(["phone", "tablet", "desktop"]);

/** 폭(px) → 티어 이름. */
export function tierForWidth(width) {
  if (width >= 1024) return "desktop";
  if (width >= 600) return "tablet";
  return "phone";
}

/** 지금 화면의 티어. 서버 렌더 중에는 phone을 준다. */
export function currentTier() {
  if (typeof window === "undefined") return "phone";
  return tierForWidth(window.innerWidth);
}

/* ── 뷰포트 티어 구독 ──
   resize가 아니라 matchMedia를 쓴다. resize는 스크롤 중 주소창이 접힐 때도 계속
   터지는데(모바일 사파리), 티어는 그때 바뀌지 않는다. matchMedia는 경계를 넘을 때만
   한 번 알려주므로 불필요한 리렌더가 없다. */
const queries = [
  ["tablet", "(min-width: 600px)"],
  ["desktop", "(min-width: 1024px)"],
];

export function subscribeViewportTier(onChange) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const lists = queries.map(([, q]) => window.matchMedia(q));
  const handler = () => onChange();
  lists.forEach((mql) => mql.addEventListener("change", handler));
  return () => lists.forEach((mql) => mql.removeEventListener("change", handler));
}

export const getViewportTierSnapshot = currentTier;

/* React에서:
     import { useSyncExternalStore } from "react";
     import { subscribeViewportTier, getViewportTierSnapshot } from "./responsive-tier.js";

     const tier = useSyncExternalStore(
       subscribeViewportTier,
       getViewportTierSnapshot,
       () => "phone",   // 서버 렌더 폴백
     );
     return tier === "desktop" ? <ResultDesktop … /> : <ResultPhone … />;

   화면 구조가 갈릴 때만 이렇게 나눈다. 여백·글자 크기만 다르면 CSS로 끝낸다 —
   컴포넌트를 나누면 두 파일이 따로 낡는다. */

/* ── 컨테이너 티어 구독 ──
   요소의 실제 폭을 본다. 화면이 아니라 '이 컴포넌트가 놓인 칸'이 기준이라,
   데스크톱의 좁은 사이드바에 놓인 카드가 phone 모양으로 나올 수 있다.
   .tier-root(폭 제한 없는 최상위)에 걸면 뷰포트 기준과 같아진다. */
export function watchTier(target, onChange) {
  if (typeof ResizeObserver === "undefined" || !target) return () => {};
  let last = null;
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const tier = tierForWidth(entry.contentRect.width);
      // 티어가 그대로면 알리지 않는다 — 폭이 1px 변할 때마다 콜백이 돌면 안 된다.
      if (tier !== last) {
        last = tier;
        onChange(tier);
      }
    }
  });
  ro.observe(target);
  return () => ro.disconnect();
}
