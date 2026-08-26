"use client";

import type { ReactNode } from "react";

/** 폰은 꽉 채우고, 데스크톱은 위 브랜드 바 + 가운데 폭 제한 (wide면 전체 폭) */
export function Page({ children, wide = false, className = "" }: { children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <div className="min-h-svh flex flex-col">
      <div className="hidden md:flex h-12 items-center gap-2 px-6 bg-surface border-b border-line-soft">
        <span className="w-6 h-6 rounded-[7px] bg-blue" />
        <span className="text-[14px] font-black text-ink">acttub read</span>
        <span className="text-[12px] text-ink-4 ml-1">상대역 리딩</span>
      </div>
      <main className={`flex-1 flex flex-col w-full ${wide ? "" : "md:max-w-[960px] md:mx-auto md:px-5 md:py-8"} ${className}`}>{children}</main>
    </div>
  );
}

export function fmtClock(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
