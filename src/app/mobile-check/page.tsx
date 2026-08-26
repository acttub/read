"use client";

/**
 * 이 기기에서 음성이 쓸 만한지 재 보는 화면.
 *
 * 휴대폰은 기기마다 사정이 크게 다르다 — WebGPU 가 아예 없기도 하고, 있어도
 * 데스크톱보다 한참 느리다. 짐작하지 말고 숫자를 보고 판단하려고 만들었다.
 */
import { useCallback, useState } from "react";
import { load, synthesize, currentBackend, currentVariant, type LoadProgress } from "../../lib/audio/supertonic/engine";
import { isCached } from "../../lib/audio/supertonic/cache";
import { FORCED_BACKEND, MODEL_VARIANTS, variantBytes, variantForBackend, type BackendName } from "../../lib/audio/supertonic/models";
import { playSynthesized, unlockAudio } from "../../lib/audio/supertonic/play";

const LINE = "달라지지. 나는 알잖아, 네가 그거 얼마나 준비했는지.";
/** 되돌리기 단계. 줄이면 계산이 준다 — 어디까지 줄여야 쓸 만해지는지 한 번에 본다. */
const STEP_TRIALS = [8, 6, 4];
const mb = (n: number) => `${Math.round(n / 1024 / 1024)}MB`;

interface Row {
  label: string;
  value: string;
  good?: boolean;
}

export default function MobileCheck() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [done, setDone] = useState(false);

  const add = (r: Row) => setRows((v) => [...v, r]);

  const run = useCallback(async () => {
    unlockAudio();
    setBusy(true);
    setRows([]);
    setDone(false);
    try {
      const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> }; deviceMemory?: number };
      add({ label: "브라우저", value: navigator.userAgent.slice(0, 70) });

      let hasGpu = false;
      try {
        hasGpu = !!nav.gpu && !!(await nav.gpu.requestAdapter());
      } catch {
        hasGpu = false;
      }
      add({ label: "WebGPU", value: hasGpu ? "있음" : "없음", good: undefined });

      // wasm 을 여러 스레드로 돌리려면 교차 출처 격리가 살아 있어야 한다.
      // ⚠️ http://LAN-IP 는 secure context 가 아니라 SharedArrayBuffer 자체가 없다 —
      //    이 줄이 "꺼짐"이면 아래 속도는 1스레드 숫자다. HTTPS 에서 다시 재라.
      const isolated = typeof window !== "undefined" && window.crossOriginIsolated === true;
      const cores = navigator.hardwareConcurrency || 2;
      const threads = isolated ? Math.max(1, Math.min(4, cores - 1)) : 1;
      add({ label: "교차 출처 격리", value: isolated ? "켜짐" : "꺼짐 — HTTPS 에서 재야 한다", good: isolated });
      add({ label: "wasm 스레드", value: `${threads}개 (코어 ${cores})`, good: threads > 1 });
      if (nav.deviceMemory) add({ label: "기기 메모리", value: `약 ${nav.deviceMemory}GB` });

      // ?backend=webgpu / ?backend=wasm 으로 강제할 수 있다. 없으면 앱이 쓰는 그대로.
      // 두 길이 맞바꾸는 것이 다르므로(용량 vs 속도) 같은 기기에서 둘 다 재 보라고 열어 뒀다.
      const asked = new URLSearchParams(window.location.search).get("backend");
      const prefer: BackendName | undefined = asked === "webgpu" || asked === "wasm" ? asked : undefined;
      const variant = variantForBackend(prefer ?? FORCED_BACKEND ?? (hasGpu ? "webgpu" : "wasm"));
      const size = variantBytes(variant);
      const cached = await isCached(Object.values(MODEL_VARIANTS[variant].urls));
      add({ label: "받아야 할 용량", value: `${mb(size)}${cached ? " (이미 받아 둠)" : ""}` });

      const t0 = performance.now();
      await load(setProgress, prefer);
      const loadSec = (performance.now() - t0) / 1000;
      add({ label: "준비 시간", value: `${loadSec.toFixed(1)}초`, good: loadSec < 30 });
      add({ label: "쓰는 방식", value: `${currentBackend()} + ${currentVariant()}` });

      // 처음 한 번은 밑준비가 섞이므로 버린다.
      let last = await synthesize(LINE, "F1", { gapSec: 0.1 });
      let best = Infinity;
      for (const steps of STEP_TRIALS) {
        const t1 = performance.now();
        const audio = await synthesize(LINE, "M1", { gapSec: 0.1, steps });
        const gen = (performance.now() - t1) / 1000;
        const rtf = gen / audio.duration;
        best = Math.min(best, rtf);
        last = audio;
        add({
          label: `만드는 속도 (단계 ${steps})`,
          value: `${audio.duration.toFixed(1)}초 대사에 ${gen.toFixed(1)}초 — RTF ${rtf.toFixed(2)}`,
          good: rtf < 0.8,
        });
      }
      add({
        label: "쓸 만한가",
        value: best < 0.5 ? "넉넉하다" : best < 0.8 ? "쓸 만하다" : best < 1.2 ? "빠듯하다" : "느려서 기다림이 생긴다",
        good: best < 0.8,
      });

      await playSynthesized(last);
      setDone(true);
    } catch (e) {
      add({ label: "실패", value: e instanceof Error ? e.message : String(e), good: false });
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: 20, fontFamily: "system-ui, sans-serif", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>이 기기에서 되는지 보기</h1>
      <p style={{ fontSize: 14, color: "#666", marginTop: 0 }}>
        음성 모델을 받아 한 줄 만들어 보고, 소리까지 내 봅니다. 처음이면 시간이 걸려요.
      </p>

      <button
        onClick={() => void run()}
        disabled={busy}
        style={{
          width: "100%",
          padding: "14px 16px",
          fontSize: 16,
          fontWeight: 700,
          border: "none",
          borderRadius: 12,
          background: busy ? "#c8d6e5" : "#0a79fb",
          color: "#fff",
          marginTop: 8,
        }}
      >
        {busy ? "재는 중…" : "검사 시작"}
      </button>

      {busy && progress && !progress.cached && (
        <div style={{ marginTop: 12 }}>
          <div style={{ height: 6, background: "#e5e5e5", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress.ratio * 100}%`, background: "#0a79fb" }} />
          </div>
          <small style={{ color: "#666" }}>
            {mb(progress.loaded)} / {mb(progress.total)}
          </small>
        </div>
      )}

      <div style={{ marginTop: 18, display: "grid", gap: 8 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ border: "1px solid #e5e5e5", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 12, color: "#888" }}>{r.label}</div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                wordBreak: "break-all",
                color: r.good === undefined ? "#111" : r.good ? "#1a7f4b" : "#c92a2a",
              }}
            >
              {r.value}
            </div>
          </div>
        ))}
      </div>

      {done && <p style={{ marginTop: 16, fontSize: 14 }}>소리가 났고 끊기지 않았다면 이 기기에서 쓸 수 있어요.</p>}
    </main>
  );
}
