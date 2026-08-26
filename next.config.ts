import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 폰에서 LAN IP 로 dev 서버에 붙을 때 JS 청크가 cross-origin 으로 막힌다. 사설망 대역을 통째로 연다.
  allowedDevOrigins: ["10.*.*.*", "192.168.*.*", "172.16.*.*"],
  // 교차 출처 격리 — SharedArrayBuffer 를 열어 onnxruntime wasm 을 멀티스레드로 돌린다.
  //
  // credentialless 였는데 require-corp 로 바꿨다: **Safari 가 credentialless 를 지원하지 않는다.**
  // 그대로 두면 아이폰에서 격리가 서지 않아 스레드가 1개로 떨어지고, 폰 1스레드는 RTF 2.5 라 끊긴다.
  // require-corp 는 Safari 15.2+ 에서 동작한다. 대신 교차 출처 리소스가 CORP 를 주거나
  // CORS 모드로 받아져야 하는데, 우리가 쓰는 것은 전부 조건을 만족한다(2026-08-26 헤더 확인):
  //   jsdelivr(폰트 CSS) · googletagmanager · fonts.gstatic → cross-origin-resource-policy: cross-origin
  //   HuggingFace CDN(모델) → CORP 는 없지만 fetch() 가 기본 CORS 모드라 통과한다
  // ⚠️ 새 외부 리소스를 붙일 때는 이 조건을 먼저 확인한다. 안 그러면 조용히 차단된다.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
  turbopack: {
    resolveAlias: {
      // hwp.js 는 파일 경로로도 읽을 수 있게 만들어져 `fs` 를 부른다.
      // 브라우저에는 그런 것이 없고, 우리는 바이트를 직접 넘기므로 빈 것으로 바꾼다.
      fs: { browser: "./src/lib/script/fs-stub.ts" },
    },
  },
};

export default nextConfig;
