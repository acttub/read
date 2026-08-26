import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // pdf.js 워커 사본 — 우리 코드가 아니다
    "public/**",
    // 정적 사이트 원본. 이관 중에만 참고용으로 두는 것이라 이 저장소의 규칙을 적용하지 않는다.
    // 이관이 끝나면 폴더째 지우고 이 줄도 지운다.
    "legacy/**",
  ]),
]);

export default eslintConfig;
