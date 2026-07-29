const STORAGE_KEYS = {
  script: "read.script",
  myRole: "read.myRole",
  roleParams: "read.roleParams",
  advanceMode: "read.advanceMode",
  silenceSec: "read.silenceSec",
};

const ADVANCE_MODES = new Set(["tap", "silence", "cue"]);

export function saveScript(script) {
  sessionStorage.setItem(STORAGE_KEYS.script, script);
}

export function readScript() {
  return sessionStorage.getItem(STORAGE_KEYS.script) || "";
}

export function savePracticeSettings({
  myRole,
  roleParams,
  advanceMode,
  silenceSec,
}) {
  sessionStorage.setItem(STORAGE_KEYS.myRole, myRole);
  sessionStorage.setItem(STORAGE_KEYS.roleParams, JSON.stringify(roleParams));
  sessionStorage.setItem(STORAGE_KEYS.advanceMode, advanceMode);
  sessionStorage.setItem(STORAGE_KEYS.silenceSec, String(silenceSec));
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
