import { parseScript } from "./parse.js";
import { readScriptFile, ScriptFileError } from "./scriptfile.js";
import { saveScript } from "./storage.js";

const scriptInput = document.getElementById("scriptInput");
const continueButton = document.getElementById("continueButton");
const scriptError = document.getElementById("scriptError");
const scriptFileInput = document.getElementById("scriptFileInput");
const scriptFileButton = document.getElementById("scriptFileButton");
const scriptFileButtonText = document.getElementById("scriptFileButtonText");
const scriptFileStatus = document.getElementById("scriptFileStatus");

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

function showFileStatus(message, isError = false) {
  scriptFileStatus.textContent = message;
  scriptFileStatus.hidden = !message;
  scriptFileStatus.classList.toggle("text-danger", isError);
  scriptFileStatus.classList.toggle("text-ink-sub", !isError);
}

function setFileReading(isReading) {
  scriptFileInput.disabled = isReading;
  scriptFileButton.disabled = isReading;
  scriptFileButtonText.textContent = isReading ? "읽는 중…" : "대본 파일 열기";
}

scriptFileButton.addEventListener("click", () => {
  scriptFileInput.click();
});

scriptFileInput.addEventListener("change", async () => {
  const [file] = scriptFileInput.files;
  if (!file) return;

  setFileReading(true);
  showFileStatus("");

  try {
    const result = await readScriptFile(file);
    if (result.kind === "guidance" || result.kind === "error") {
      showFileStatus(result.message, result.kind === "error");
      return;
    }

    scriptInput.value = result.text;
    hasInteracted = true;
    validateScript();
    showFileStatus(result.warning);
  } catch (error) {
    const message =
      error instanceof ScriptFileError
        ? error.message
        : "파일을 읽지 못했어요. 다른 파일을 골라주세요.";
    showFileStatus(message, true);
  } finally {
    setFileReading(false);
    scriptFileInput.value = "";
  }
});

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
