const STORAGE_KEYS = {
  script: "read.script",
  myRole: "read.myRole",
  roleParams: "read.roleParams",
  advanceMode: "read.advanceMode",
  silenceSec: "read.silenceSec",
  engine: "read.engine",
  voiceId: "read.voiceId",
  mode: "read.mode",
  startIndex: "read.startIndex",
};

const ADVANCE_MODES = new Set(["tap", "silence", "cue"]);
const ENGINES = new Set(["device", "cloud"]);
const VOICE_IDS = new Set([
  "cgSgspJ2msm6clMCkdW9",
  "EXAVITQu4vr4xnSDxMaL",
  "bIHbv24MWmeRgasZH58o",
  "cjVigY5qzO86Huf0OWal",
  "iP95p4xoKVk53GoZ742B",
  "SAz9YHcvj6GT2YYXdXww",
]);
const DEFAULT_VOICE_ID = "SAz9YHcvj6GT2YYXdXww";
const MODES = new Set(["read", "quiz"]);

export function saveScript(script) {
  sessionStorage.setItem(STORAGE_KEYS.script, script);
  clearStartIndex();
}

export function readScript() {
  return sessionStorage.getItem(STORAGE_KEYS.script) || "";
}

function validStartIndex(raw, turnCount) {
  if (raw === null || raw.trim() === "") return null;
  const index = Number(raw);
  return Number.isSafeInteger(index) &&
      index >= 0 &&
      Number.isSafeInteger(turnCount) &&
      turnCount > 0 &&
      index < turnCount
    ? index
    : null;
}

export function saveStartIndex(index) {
  sessionStorage.setItem(
    STORAGE_KEYS.startIndex,
    Number.isSafeInteger(index) && index >= 0 ? String(index) : "0",
  );
}

export function clearStartIndex() {
  sessionStorage.setItem(STORAGE_KEYS.startIndex, "");
}

export function hasStartIndex(turnCount) {
  return validStartIndex(
    sessionStorage.getItem(STORAGE_KEYS.startIndex),
    turnCount,
  ) !== null;
}

export function readStartIndex(turnCount) {
  return validStartIndex(
    sessionStorage.getItem(STORAGE_KEYS.startIndex),
    turnCount,
  ) ?? 0;
}

export function savePracticeSettings({
  myRole,
  roleParams,
  advanceMode,
  silenceSec,
  engine,
  voiceId,
}) {
  sessionStorage.setItem(STORAGE_KEYS.myRole, myRole);
  sessionStorage.setItem(STORAGE_KEYS.roleParams, JSON.stringify(roleParams));
  sessionStorage.setItem(STORAGE_KEYS.advanceMode, advanceMode);
  sessionStorage.setItem(STORAGE_KEYS.silenceSec, String(silenceSec));
  sessionStorage.setItem(STORAGE_KEYS.engine, engine);
  sessionStorage.setItem(STORAGE_KEYS.voiceId, voiceId);
}

export function readMyRole() {
  return sessionStorage.getItem(STORAGE_KEYS.myRole) || "";
}

export function readRoleParams() {
  const raw = sessionStorage.getItem(STORAGE_KEYS.roleParams);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export function readAdvanceMode() {
  const stored = sessionStorage.getItem(STORAGE_KEYS.advanceMode);
  return ADVANCE_MODES.has(stored) ? stored : "tap";
}

export function readSilenceSec() {
  const stored = Number.parseFloat(
    sessionStorage.getItem(STORAGE_KEYS.silenceSec) || "",
  );
  return Number.isFinite(stored) && stored >= 0.3 && stored <= 3.0
    ? stored
    : 1.2;
}

export function readEngine() {
  const stored = sessionStorage.getItem(STORAGE_KEYS.engine);
  return ENGINES.has(stored) ? stored : "device";
}

export function readVoiceId() {
  const stored = sessionStorage.getItem(STORAGE_KEYS.voiceId);
  return VOICE_IDS.has(stored) ? stored : DEFAULT_VOICE_ID;
}

export function saveMode(mode) {
  sessionStorage.setItem(
    STORAGE_KEYS.mode,
    MODES.has(mode) ? mode : "quiz",
  );
}

export function readMode() {
  const stored = sessionStorage.getItem(STORAGE_KEYS.mode);
  return MODES.has(stored) ? stored : "quiz";
}
