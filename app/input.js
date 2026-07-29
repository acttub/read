import { parseScript } from "./parse.js";
import { saveScript } from "./storage.js";

const scriptInput = document.getElementById("scriptInput");
const continueButton = document.getElementById("continueButton");
const scriptError = document.getElementById("scriptError");

// 페이지를 열자마자(아직 아무 것도 안 건드렸는데) 빈 textarea를 "틀렸다"고 빨간 글씨로
// 알리면 안 된다. 사용자가 한 번이라도 입력을 건드린 뒤에만 형식 오류를 보여준다.
let hasInteracted = false;

function validateScript() {
  const script = scriptInput.value;

  if (!script.trim()) {
    continueButton.disabled = true;
    scriptError.textContent = hasInteracted ? "대본을 붙여넣어 주세요." : "";
    return false;
  }

  if (parseScript(script).roles.length === 0) {
    continueButton.disabled = true;
    scriptError.textContent = "배역명: 대사 형식인지 확인해 주세요.";
    return false;
  }

  continueButton.disabled = false;
  scriptError.textContent = "";
  return true;
}

scriptInput.addEventListener("input", () => {
  hasInteracted = true;
  validateScript();
});

continueButton.addEventListener("click", () => {
  hasInteracted = true;
  if (!validateScript()) return;
  saveScript(scriptInput.value);
  window.location.href = "/char";
});

validateScript();
