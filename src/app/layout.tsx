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
      </body>
    </html>
  );
}
