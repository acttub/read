import { SAMPLE_SCRIPT } from "./sample-script.js";
import { saveScript } from "./storage.js";
import { trackEvent } from "./tracking.js";

// `/`가 실제 홈 화면이 된 뒤에도 기존 퍼널의 첫 이벤트 이름을 그대로 쓴다.
// /input에서도 같은 이름을 보내지만 세션 중복 제거 계약이 중복 전송을 막는다.
trackEvent("landing_view");

document.getElementById("sampleScriptButton").addEventListener("click", () => {
  saveScript(SAMPLE_SCRIPT);
  trackEvent("sample_script_load");
  window.location.href = "/char";
});
