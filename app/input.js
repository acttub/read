import { parseScript, parseScriptWithRoles } from "./parse.js";
import { readScriptFile, ScriptFileError } from "./scriptfile.js";
import { saveScript } from "./storage.js";
import { trackEvent, trackMetric } from "./tracking.js";

trackEvent("landing_view");

const scriptInput = document.getElementById("scriptInput");
const continueButton = document.getElementById("continueButton");
const scriptError = document.getElementById("scriptError");
const scriptFileInput = document.getElementById("scriptFileInput");
const scriptFileButton = document.getElementById("scriptFileButton");
const scriptFileButtonText = document.getElementById("scriptFileButtonText");
const scriptFileStatus = document.getElementById("scriptFileStatus");
const manualRolesField = document.getElementById("manualRolesField");
const manualRolesInput = document.getElementById("manualRolesInput");

// 페이지를 열자마자(아직 아무 것도 안 건드렸는데) 빈 textarea를 "틀렸다"고 빨간 글씨로
// 알리면 안 된다. 사용자가 한 번이라도 입력을 건드린 뒤에만 형식 오류를 보여준다.
let hasInteracted = false;

function validateScript() {
  const script = scriptInput.value;

  if (!script.trim()) {
    manualRolesField.hidden = true;
    continueButton.disabled = true;
    scriptError.textContent = hasInteracted ? "대본을 붙여넣어 주세요." : "";
    return false;
  }

  const automaticResult = parseScript(script);
  manualRolesField.hidden = automaticResult.roles.length > 0;
  const manualRoleNames = manualRolesInput.value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const result = automaticResult.roles.length > 0
    ? automaticResult
    : parseScriptWithRoles(script, manualRoleNames);

  if (result.roles.length === 0) {
    continueButton.disabled = true;
    scriptError.textContent =
      "배역명과 대사가 구분되어 있는지 확인해 주세요.";
    return false;
  }

  continueButton.disabled = false;
  scriptError.textContent = "";
  return true;
}

function scriptForStorage() {
  const script = scriptInput.value;
  if (parseScript(script).roles.length > 0) return script;

  const roleNames = manualRolesInput.value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const { turns } = parseScriptWithRoles(script, roleNames);
  // 이후 화면은 parseScript(readScript())로 같은 파서를 다시 쓴다. 직접 받은 이름으로
  // 찾은 턴만 기존 콜론 형식으로 정리해 저장하면 새 저장 키 없이 그 계약을 지킬 수 있다.
  return turns
    .map(({ role, text }) => `${role}: ${text.replace(/\s*\n\s*/g, " ")}`)
    .join("\n");
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

manualRolesInput.addEventListener("input", () => {
  hasInteracted = true;
  validateScript();
});

continueButton.addEventListener("click", () => {
  hasInteracted = true;
  if (!validateScript()) return;
  saveScript(scriptForStorage());
  trackEvent("script_submit");

  const script = scriptInput.value;
  const charCount = script.length;
  if (charCount < 500) trackMetric("script_len_s");
  else if (charCount <= 2000) trackMetric("script_len_m");
  else trackMetric("script_len_l");

  const lineCount = script
    .split("\n")
    .filter((line) => line.trim() !== "").length;
  if (lineCount < 20) trackMetric("script_lines_s");
  else if (lineCount <= 60) trackMetric("script_lines_m");
  else trackMetric("script_lines_l");

  window.location.href = "/char";
});

validateScript();
