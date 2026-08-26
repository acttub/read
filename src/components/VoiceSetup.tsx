"use client";

/**
 * 자연스러운 음성을 켜는 자리.
 *
 * 모델은 100MB 를 훌쩍 넘으므로 몰래 받지 않는다 — 용량을 보여 주고 누를 때만 받는다.
 * 받지 않아도 리허설은 기기 내장 음성으로 그대로 돌아간다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { enableSupertonic, getEngine, isRemoteOnly, setEngine, ttsSupported, waitForVoices, type Engine } from "../lib/audio/tts";
import { downloadSize, hasCachedModels, type LoadProgress } from "../lib/audio/supertonic/engine";
import { MODEL_ATTRIBUTION } from "../lib/audio/supertonic/models";

const mb = (n: number) => `${Math.round(n / 1024 / 1024)}MB`;

type Phase = "확인중" | "받을수있음" | "받는중" | "켜짐" | "실패";

export function VoiceSetup({ onEngineChange }: { onEngineChange?: (e: Engine) => void } = {}) {
  // 부모가 매 렌더마다 새 함수를 넘겨도 효과가 다시 돌지 않게 ref 로 잡아 둔다.
  const notify = useRef(onEngineChange);
  useEffect(() => {
    notify.current = onEngineChange;
  });

  const [phase, setPhase] = useState<Phase>("확인중");
  const [selected, setSelected] = useState<Engine>(getEngine);
  const [size, setSize] = useState(0);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  // 지원 여부는 그리기 전에 알 수 있다. effect 안에서 setState 하지 않는다.
  const [deviceNote, setDeviceNote] = useState<string | null>(() =>
    ttsSupported() ? null : "이 브라우저는 기기 음성을 지원하지 않아요.",
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [cached, bytes] = await Promise.all([hasCachedModels(), downloadSize()]);
      if (!alive) return;
      setSize(bytes);
      // 이미 받아 둔 것이 있으면 물어볼 것 없이 바로 켠다.
      if (cached) {
        setPhase("받는중");
        try {
          await enableSupertonic(setProgress);
          if (alive) { setPhase("켜짐"); setSelected("supertonic"); notify.current?.("supertonic"); }
        } catch {
          if (alive) setPhase("실패");
        }
        return;
      }
      setPhase(getEngine() === "supertonic" ? "켜짐" : "받을수있음");
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 기기 음성으로 읽게 될 경우에 대비해 미리 알려 준다.
  // 목록은 크롬에서 늦게 채워지므로 기다렸다가 확인한다.
  useEffect(() => {
    if (!ttsSupported()) return;
    let alive = true;
    void waitForVoices().then((v) => {
      if (!alive) return;
      if (v.length === 0) setDeviceNote("기기에 한국어 음성이 없어요.");
      else if (isRemoteOnly()) setDeviceNote("기기 음성으로 읽으면 대사가 브라우저 음성 서비스로 전달돼요.");
    });
    return () => {
      alive = false;
    };
  }, []);

  const enable = useCallback(async () => {
    setPhase("받는중");
    try {
      await enableSupertonic(setProgress);
      setPhase("켜짐");
      setSelected("supertonic");
      notify.current?.("supertonic");
    } catch {
      setPhase("실패");
    }
  }, []);

  const chooseCloud = useCallback(() => {
    setEngine("cloud");
    setSelected("cloud");
    notify.current?.("cloud");
  }, []);

  const chooseLocal = useCallback(() => {
    const next: Engine = phase === "켜짐" ? "supertonic" : "device";
    setEngine(next);
    setSelected(next);
    notify.current?.(next);
  }, [phase]);

  if (phase === "확인중") return null;

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 text-sm">
      {selected === "cloud" ? (
        <>
          <p className="font-medium text-neutral-900">자연스러운 음성으로 읽어요</p>
          <p className="mt-1 text-neutral-600">
            시작 전에 상대 배역 대사만 acttub 서버를 거쳐 음성 서비스로 보내 미리 준비해요.
            준비하지 못한 줄은 기기 음성으로 읽어요.
          </p>
          <button onClick={chooseLocal} className="mt-3 rounded-xl bg-neutral-100 px-4 py-2 text-neutral-800">
            {phase === "켜짐" ? "기기 안 음성 쓰기" : "기기 음성 쓰기"}
          </button>
        </>
      ) : phase === "켜짐" ? (
        <p className="text-neutral-700">
          자연스러운 음성으로 읽어요. 대사는 기기 밖으로 나가지 않아요.
        </p>
      ) : phase === "받는중" ? (
        <>
          <p className="text-neutral-700">
            음성을 준비하고 있어요{progress?.cached ? "" : ` — ${mb(progress?.loaded ?? 0)} / ${mb(progress?.total ?? size)}`}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200">
            <div
              className="h-full bg-neutral-800 transition-[width]"
              style={{ width: `${Math.round((progress?.ratio ?? 0) * 100)}%` }}
            />
          </div>
        </>
      ) : (
        <>
          <p className="font-medium text-neutral-900">더 자연스러운 목소리로 들을 수 있어요</p>
          <p className="mt-1 text-neutral-600">
            음성 모델 {mb(size)}를 한 번 받아 두면 그다음부터는 받지 않아요. 받은 뒤에도 대사는 기기 안에서만 처리돼요.
          </p>
          {deviceNote && <p className="mt-1 text-neutral-500">받지 않으면 기기 음성으로 읽어요. {deviceNote}</p>}
          {phase === "실패" && (
            <p className="mt-1 text-red-600">음성을 준비하지 못했어요. 기기 음성으로 진행할게요.</p>
          )}
          <button
            onClick={() => void enable()}
            className="mt-3 rounded-xl bg-neutral-900 px-4 py-2 text-white"
          >
            {phase === "실패" ? "다시 시도" : `음성 받기 (${mb(size)})`}
          </button>
        </>
      )}
      {selected !== "cloud" && phase !== "받는중" && (
        <div className="mt-3 border-t border-neutral-100 pt-3">
          <p className="font-medium text-neutral-900">받지 않고 바로 쓰기</p>
          <p className="mt-1 text-neutral-600">
            상대 배역 대사를 시작 전에 미리 준비해서 리허설 중에 끊기지 않아요.
            대신 그 대사가 acttub 서버를 거쳐 음성 서비스로 전송돼요.
          </p>
          <button onClick={chooseCloud} className="mt-3 rounded-xl bg-neutral-100 px-4 py-2 text-neutral-800">
            바로 쓰는 음성 켜기
          </button>
        </div>
      )}
      {selected !== "cloud" && (
        <p className="mt-3 text-[11px] leading-relaxed text-neutral-400">
          음성 모델 {MODEL_ATTRIBUTION.name} · {MODEL_ATTRIBUTION.author} · {MODEL_ATTRIBUTION.license}
        </p>
      )}
    </div>
  );
}
