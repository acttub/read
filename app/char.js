import { parseScript } from "./parse.js";
import {
  getKoreanVoices,
  resolveVoiceForRole,
  ROLE_VOICE_PALETTE,
  supportsSpeechSynthesis,
  unlockSpeechSynthesis,
} from "./voices.js";
import { readScript, savePracticeSettings } from "./storage.js";

const script = readScript();

if (!script) {
  window.location.replace("/input");
} else {
  initializeCharacterPage(script);
}

function initializeCharacterPage(scriptText) {
  const { turns, roles } = parseScript(scriptText);
  if (roles.length === 0) {
    window.location.replace("/input");
    return;
  }

  const rolesList = document.getElementById("rolesList");
  const overlapNote = document.getElementById("voiceOverlapNote");
  const remoteVoiceNotice = document.getElementById("remoteVoiceNotice");
  const silenceOptions = document.getElementById("silenceOptions");
  const silenceSec = document.getElementById("silenceSec");
  const silenceSecLabel = document.getElementById("silenceSecLabel");
  const roleParams = {};
  const roleElements = new Map();
  let selectedRole = roles[0];
  let koVoices = getKoreanVoices();

  roles.forEach((role, index) => {
    const palette = ROLE_VOICE_PALETTE[index % ROLE_VOICE_PALETTE.length];
    roleParams[role] = {
      voiceName: null,
      rate: palette.rate,
      pitch: palette.pitch,
    };

    const card = document.createElement("article");
    card.className = "bg-surface p-5 rounded-xl shadow-card";
    card.dataset.role = role;

    const headerRow = document.createElement("div");
    headerRow.className =
      "radio-tap-target flex cursor-pointer items-center gap-3";
    headerRow.dataset.rolePickerHeader = role;

    const rolePicker = document.createElement("label");
    rolePicker.className =
      "radio-tap-target flex min-w-0 flex-1 cursor-pointer items-center gap-3";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "myRole";
    radio.value = role;
    radio.checked = index === 0;
    radio.className = "radio-input shrink-0";

    const roleCopy = document.createElement("span");
    roleCopy.className = "min-w-0";

    const roleName = document.createElement("span");
    roleName.className = "block text-[17px] font-bold text-ink";
    roleName.textContent = role;

    const lineCount = turns.filter(
      (turn) => turn.role === role && !turn.isDirection,
    ).length;
    const roleMeta = document.createElement("span");
    roleMeta.className =
      "mt-0.5 block text-[13px] font-medium text-ink-tertiary";
    roleMeta.textContent = `대사 ${lineCount}줄`;

    roleCopy.append(roleName, roleMeta);
    rolePicker.append(radio, roleCopy);

    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.className =
      "shrink-0 rounded-md bg-primary-soft px-3 text-[14px] font-semibold text-primary active:bg-primary-soft-hover";
    previewButton.textContent = "미리듣기";
    previewButton.dataset.previewRole = role;

    headerRow.append(rolePicker, previewButton);

    const controls = document.createElement("div");
    controls.className = "mt-4 space-y-3";

    const voiceLabel = document.createElement("label");
    voiceLabel.className =
      "block text-[13px] font-medium text-ink-sub";
    voiceLabel.textContent = "음성";

    const voiceSelect = document.createElement("select");
    voiceSelect.className =
      "mt-1 min-h-11 w-full rounded-md border-0 bg-surface-sub px-3 text-ink";
    voiceSelect.dataset.voiceRole = role;
    voiceLabel.append(voiceSelect);

    const rateControl = createRangeControl({
      role,
      param: "rate",
      label: "속도",
      min: "0.5",
      max: "2.0",
      value: palette.rate,
      index,
    });

    const pitchControl = createRangeControl({
      role,
      param: "pitch",
      label: "피치",
      min: "0",
      max: "2.0",
      value: palette.pitch,
      index,
    });

    const voiceNote = document.createElement("p");
    voiceNote.className = "m-0 min-h-4 text-[12px] font-medium text-danger";
    voiceNote.setAttribute("aria-live", "polite");

    controls.append(voiceLabel, rateControl.wrapper, pitchControl.wrapper, voiceNote);
    card.append(headerRow, controls);
    rolesList.append(card);

    roleElements.set(role, {
      card,
      radio,
      roleMeta,
      lineCount,
      voiceSelect,
      voiceNote,
      rateValue: rateControl.valueLabel,
      pitchValue: pitchControl.valueLabel,
    });
  });

  function createRangeControl({
    role,
    param,
    label,
    min,
    max,
    value,
    index,
  }) {
    const wrapper = document.createElement("label");
    wrapper.className = "block text-[13px] font-medium text-ink-sub";

    const labelRow = document.createElement("span");
    labelRow.className = "flex items-center justify-between";

    const labelText = document.createElement("span");
    labelText.textContent = label;

    const valueLabel = document.createElement("span");
    valueLabel.className = "font-semibold tabular-nums text-primary";
    valueLabel.textContent = Number(value).toFixed(2);

    const range = document.createElement("input");
    range.type = "range";
    range.className = "range-control";
    range.min = min;
    range.max = max;
    range.step = "0.05";
    range.value = String(value);
    range.dataset.rangeRole = role;
    range.dataset.rangeParam = param;
    range.id = `${param}Slider-${index}`;

    labelRow.append(labelText, valueLabel);
    wrapper.append(labelRow, range);
    updateRangeFill(range);

    return { wrapper, valueLabel };
  }

  function updateRangeFill(range) {
    const min = Number.parseFloat(range.min) || 0;
    const max = Number.parseFloat(range.max);
    const value = Number.parseFloat(range.value);
    const percentage = max > min ? ((value - min) / (max - min)) * 100 : 0;
    range.style.setProperty("--range-pct", `${percentage}%`);
  }

  function updateSelectedRole() {
    for (const [role, elements] of roleElements) {
      const selected = role === selectedRole;
      elements.card.classList.toggle("bg-primary-soft", selected);
      elements.card.classList.toggle("bg-surface", !selected);
      elements.roleMeta.textContent = selected
        ? `내 배역 · 대사 ${elements.lineCount}줄`
        : `대사 ${elements.lineCount}줄`;
      elements.roleMeta.classList.toggle("text-primary", selected);
      elements.roleMeta.classList.toggle("font-semibold", selected);
      elements.roleMeta.classList.toggle("text-ink-tertiary", !selected);
      elements.roleMeta.classList.toggle("font-medium", !selected);
    }
  }

  function updateVoiceOverlapNote() {
    overlapNote.textContent =
      koVoices.length < roles.length
        ? `이 기기에서는 한국어 음성이 ${koVoices.length}개라 배역 ${roles.length}개 중 일부는 속도·피치로만 구분됩니다.`
        : "";
  }

  function repopulateVoiceSelects() {
    roles.forEach((role, index) => {
      const elements = roleElements.get(role);
      const select = elements.voiceSelect;
      const currentVoiceName = roleParams[role].voiceName;
      select.replaceChildren();

      if (koVoices.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "(사용 가능한 한국어 음성 없음)";
        select.append(option);
        roleParams[role].voiceName = null;
        return;
      }

      koVoices.forEach((voice) => {
        const option = document.createElement("option");
        option.value = voice.name;
        option.textContent = `${voice.name} (${voice.lang})`;
        select.append(option);
      });

      const currentStillExists =
        currentVoiceName &&
        koVoices.some((voice) => voice.name === currentVoiceName);
      const assignedVoiceName = currentStillExists
        ? currentVoiceName
        : koVoices[index % koVoices.length].name;

      roleParams[role].voiceName = assignedVoiceName;
      select.value = assignedVoiceName;
    });

    updateVoiceOverlapNote();
  }

  function previewRole(role) {
    const elements = roleElements.get(role);
    const params = roleParams[role];
    elements.voiceNote.textContent = "";

    if (!supportsSpeechSynthesis()) {
      elements.voiceNote.textContent =
        "이 브라우저에서 음성 합성을 지원하지 않습니다.";
      return;
    }

    const firstLine = turns.find(
      (turn) => turn.role === role && !turn.isDirection,
    );
    const text = firstLine
      ? firstLine.text
      : "안녕하세요. 잠깐 맞춰볼게요.";
    const { voice, usedFallback } = resolveVoiceForRole(params);

    if (usedFallback && voice) {
      elements.voiceNote.textContent =
        `고른 음성을 찾을 수 없어 "${voice.name}"(으)로 대신 읽습니다.`;
    } else if (!voice) {
      elements.voiceNote.textContent =
        "사용 가능한 한국어 음성이 없어 브라우저 기본 음성으로 읽습니다.";
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ko-KR";
    utterance.rate = params.rate;
    utterance.pitch = params.pitch;
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  }

  rolesList.addEventListener("change", (event) => {
    const target = event.target;

    if (target.matches('input[name="myRole"]')) {
      selectedRole = target.value;
      updateSelectedRole();
      return;
    }

    if (target.matches("select[data-voice-role]")) {
      const role = target.dataset.voiceRole;
      roleParams[role].voiceName = target.value || null;
      roleElements.get(role).voiceNote.textContent = "";
    }
  });

  rolesList.addEventListener("input", (event) => {
    const target = event.target;
    if (!target.matches("input[data-range-role]")) return;

    const role = target.dataset.rangeRole;
    const param = target.dataset.rangeParam;
    const value = Number.parseFloat(target.value);
    roleParams[role][param] = value;
    roleElements.get(role)[`${param}Value`].textContent = value.toFixed(2);
    updateRangeFill(target);
  });

  rolesList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-preview-role]");
    if (button) {
      previewRole(button.dataset.previewRole);
      return;
    }

    const header = event.target.closest("[data-role-picker-header]");
    if (!header) return;
    selectedRole = header.dataset.rolePickerHeader;
    roleElements.get(selectedRole).radio.checked = true;
    updateSelectedRole();
  });

  const cueNotice = document.getElementById("cueNotice");

  function syncAdvanceModeOptions() {
    const selectedMode = document.querySelector(
      'input[name="advanceMode"]:checked',
    ).value;
    silenceOptions.classList.toggle("hidden", selectedMode !== "silence");
    // 큐 단어는 구조적으로 목소리를 브라우저 음성 인식 서비스로 보내야 동작한다 —
    // 막을 방법이 없어서, 고를 때마다 그 사실을 알린다.
    cueNotice.classList.toggle("hidden", selectedMode !== "cue");
  }

  document
    .querySelectorAll('input[name="advanceMode"]')
    .forEach((radio) => {
      radio.addEventListener("change", syncAdvanceModeOptions);
    });
  syncAdvanceModeOptions();

  silenceSec.addEventListener("input", () => {
    updateRangeFill(silenceSec);
    silenceSecLabel.textContent =
      `${Number.parseFloat(silenceSec.value).toFixed(1)}초`;
  });

  document.getElementById("backButton").addEventListener("click", () => {
    window.location.href = "/input";
  });

  document.getElementById("startButton").addEventListener("click", () => {
    unlockSpeechSynthesis();
    const selectedMode = document.querySelector(
      'input[name="advanceMode"]:checked',
    ).value;

    savePracticeSettings({
      myRole: selectedRole,
      roleParams,
      advanceMode: selectedMode,
      silenceSec: Number.parseFloat(silenceSec.value),
    });
    window.location.href = "/prac";
  });

  if (supportsSpeechSynthesis()) {
    window.speechSynthesis.onvoiceschanged = () => {
      koVoices = getKoreanVoices();
      repopulateVoiceSelects();
    };
  }

  updateSelectedRole();
  repopulateVoiceSelects();
  updateRangeFill(silenceSec);
}
