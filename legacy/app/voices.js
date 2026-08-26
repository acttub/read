export const ROLE_VOICE_PALETTE = [
  { rate: 1.0, pitch: 1.0 },
  { rate: 0.85, pitch: 1.35 },
  { rate: 1.15, pitch: 0.75 },
  { rate: 0.95, pitch: 1.6 },
  { rate: 1.25, pitch: 0.55 },
];

export function supportsSpeechSynthesis() {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function getKoreanVoices() {
  if (!supportsSpeechSynthesis()) return [];
  // 기기 안에서 도는 음성(localService)을 우선한다 — 원격 음성만 쓰면 대사 텍스트가
  // 브라우저 음성 서비스로 전달된다. 로컬이 있으면 항상 그쪽부터 배정되게 정렬만 하고,
  // 목록 자체는 걸러내지 않는다(로컬이 하나도 없는 기기에서는 원격이라도 있어야 한다).
  return window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang && v.lang.toLowerCase().split(/[-_]/)[0] === "ko")
    .sort((a, b) => Number(b.localService) - Number(a.localService));
}

export function resolveVoiceForRole(params) {
  const voices = getKoreanVoices();
  const requestedVoiceName = params && params.voiceName;
  const requestedVoice = requestedVoiceName
    ? voices.find((voice) => voice.name === requestedVoiceName) || null
    : null;

  return {
    voice: requestedVoice || voices[0] || null,
    usedFallback: Boolean(requestedVoiceName && !requestedVoice),
  };
}

export function unlockSpeechSynthesis() {
  if (!supportsSpeechSynthesis()) return false;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(" "));
  return true;
}
