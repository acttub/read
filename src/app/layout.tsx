import type { Metadata, Viewport } from "next";
import { Tracking } from "../components/Tracking";
import "./globals.css";

export const metadata: Metadata = {
  title: "상대역 — 대본 리허설",
  description: "대본을 넣고 내 배역을 고르면, 나머지 배역을 AI가 소리 내어 연기해 줘요.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0b0f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <link
          rel="stylesheet"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <Tracking />
        {children}
        {/* 앱 화면은 클라이언트에서만 그려져 서버 HTML 에 링크가 하나도 없다. 검색엔진이
            read 를 acttub.com 과 같은 서비스로 잇는 근거(백링크)는 서버가 내보내는 이 줄뿐이다.
            화면(Page)이 min-h-svh 라 첫 화면 아래, 스크롤해야 보이는 자리에 놓인다. */}
        <footer className="px-5 py-4 text-center text-[11.5px] text-ink-4">
          상대역 리딩은{" "}
          <a
            href="https://acttub.com/?utm_source=read&utm_medium=subproject&utm_campaign=footer"
            className="underline underline-offset-2 font-bold text-ink-3"
          >
            AI 연기 코칭 앱 Acttub
          </a>
          이 만든 대본 리허설 도구예요.
        </footer>
      </body>
    </html>
  );
}
