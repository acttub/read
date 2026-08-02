import { parseScript } from "./parse.js";
import {
  getInitialRoleInclusion,
  partitionRolesByInitialInclusion,
} from "./role-inclusion.js";
import {
  getKoreanVoices,
  resolveVoiceForRole,
  ROLE_VOICE_PALETTE,
  supportsSpeechSynthesis,
  unlockSpeechSynthesis,
} from "./voices.js";
import { readScript, savePracticeSettings } from "./storage.js";
import { trackEvent, trackMetric } from "./tracking.js";

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
  const cloudVoiceOptions = document.getElementById("cloudVoiceOptions");
  const cloudVoiceId = document.getElementById("cloudVoiceId");
  const includedRolesList = document.getElementById("includedRolesList");
  const excludedRolesSection = document.getElementById("excludedRolesSection");
  const excludedRolesToggle = document.getElementById("excludedRolesToggle");
  const excludedRolesSummary = document.getElementById("excludedRolesSummary");
  const excludedRolesAction = document.getElementById("excludedRolesAction");
  const excludedRolesPanel = document.getElementById("excludedRolesPanel");
  const roleIncludeError = document.getElementById("roleIncludeError");
  const startButton = document.getElementById("startButton");
  const roleParams = {};
  const roleElements = new Map();
  const {
    lineCounts: roleLineCounts,
    selectedRole: initialSelectedRole,
    includedRoles,
  } = getInitialRoleInclusion(turns, roles);
  const initialRolePartition = partitionRolesByInitialInclusion(
    roles,
    includedRoles,
  );
  // 카드 위치는 이 최초 분할로만 정한다. 이후 토글은 상태만 바꾸고 DOM을 옮기지 않는다.
  const initiallyExcludedRoles = new Set(initialRolePartition.excluded);
  let selectedRole = initialSelectedRole;
  let koVoices = getKoreanVoices();

  roles.forEach((role, index) => {
    const palette = ROLE_VOICE_PALETTE[index % ROLE_VOICE_PALETTE.length];
    roleParams[role] = {
      voiceName: null,
      rate: palette.rate,
      pitch: palette.pitch,
    };

    const card = document.createElement("article");
    card.className = "rounded-xl";
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
    radio.checked = role === selectedRole;
    radio.className = "radio-input shrink-0";

    const roleCopy = document.createElement("span");
    roleCopy.className = "min-w-0";

    const roleName = document.createElement("span");
    roleName.className = "block text-[17px] font-bold text-ink";
    roleName.textContent = role;

    const lineCount = roleLineCounts.get(role);
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

    const includeRow = document.createElement("label");
    includeRow.className =
      "mt-sm flex min-h-11 cursor-pointer items-center justify-between gap-md";

    const includeText = document.createElement("span");
    includeText.className = "text-[14px] font-semibold text-ink-sub";
    includeText.textContent = "읽기에 포함";

    const includeToggle = document.createElement("input");
    includeToggle.type = "checkbox";
    includeToggle.className = "include-input shrink-0";
    includeToggle.checked = includedRoles.has(role);
    includeToggle.dataset.includeRole = role;
    includeToggle.setAttribute("role", "switch");
    includeToggle.setAttribute("aria-label", `${role} 읽기에 포함`);

    includeRow.append(includeText, includeToggle);

    const controls = document.createElement("div");
    controls.className = "mt-md space-y-sm";

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
    card.append(headerRow, includeRow, controls);
    const cardList = initiallyExcludedRoles.has(role)
      ? excludedRolesPanel
      : includedRolesList;
    cardList.append(card);

    roleElements.set(role, {
      card,
      radio,
      roleMeta,
      lineCount,
      includeToggle,
      controls,
      previewButton,
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

  function updateRoleCards() {
    for (const [role, elements] of roleElements) {
      const selected = role === selectedRole;
      const included = includedRoles.has(role);
      elements.includeToggle.checked = included;
      elements.includeToggle.disabled = selected;
      elements.controls.hidden = !included;
      elements.previewButton.hidden = !included;

      elements.card.classList.toggle("bg-primary-soft", selected);
      elements.card.classList.toggle("bg-surface", included && !selected);
      elements.card.classList.toggle("bg-surface-sub", !included);
      elements.card.classList.toggle("p-lg", included);
      elements.card.classList.toggle("p-md", !included);
      elements.card.classList.toggle("shadow-card", included);
      elements.roleMeta.textContent = selected
        ? `내 배역 · 대사 ${elements.lineCount}줄`
        : included
          ? `대사 ${elements.lineCount}줄`
          : `대사 ${elements.lineCount}줄 · 읽기 제외`;
      elements.roleMeta.classList.toggle("text-primary", selected);
      elements.roleMeta.classList.toggle("font-semibold", selected);
      elements.roleMeta.classList.toggle("text-ink-tertiary", !selected);
      elements.roleMeta.classList.toggle("font-medium", !selected);
    }

    startButton.disabled = includedRoles.size < 2;
    if (includedRoles.size < 2) {
      roleIncludeError.textContent =
        "연습하려면 읽기에 포함할 배역을 2개 이상 골라주세요.";
    }

    updateVoiceOverlapNote();
  }

  if (initialRolePartition.excluded.length > 0) {
    excludedRolesSummary.textContent =
      `대사 1줄 이하라 ${initialRolePartition.excluded.length}개 뺐어요`;
    excludedRolesSection.classList.remove("hidden");
    excludedRolesToggle.addEventListener("click", () => {
      const expanded =
        excludedRolesToggle.getAttribute("aria-expanded") === "true";
      excludedRolesToggle.setAttribute("aria-expanded", String(!expanded));
      excludedRolesPanel.classList.toggle("hidden", expanded);
      excludedRolesAction.textContent = expanded ? "펼치기" : "접기";
    });
  } else {
    excludedRolesSection.remove();
  }

  function updateVoiceOverlapNote() {
    const includedCount = includedRoles.size;
    overlapNote.textContent =
      koVoices.length < includedCount
        ? `이 기기에서는 한국어 음성이 ${koVoices.length}개라 포함한 배역 ${includedCount}개 중 일부는 속도·피치로만 구분됩니다.`
        : "";

    // getKoreanVoices()가 localService를 우선 정렬해 두므로, 있다면 항상 koVoices[0]이
    // 로컬이다 — 그게 원격이면 이 기기엔 로컬 한국어 음성이 아예 없다는 뜻이다.
    const hasLocalVoice = koVoices.length > 0 && Boolean(koVoices[0].localService);
    remoteVoiceNotice.classList.toggle(
      "hidden",
      koVoices.length === 0 || hasLocalVoice,
    );
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
      includedRoles.add(selectedRole);
      roleIncludeError.textContent = "";
      updateRoleCards();
      return;
    }

    if (target.matches("input[data-include-role]")) {
      const role = target.dataset.includeRole;
      if (!target.checked && includedRoles.size <= 2) {
        target.checked = true;
        roleIncludeError.textContent =
          "상대 배역을 읽으려면 배역 2개 이상을 포함해야 해요.";
        return;
      }

      if (target.checked) includedRoles.add(role);
      else includedRoles.delete(role);
      roleIncludeError.textContent = "";
      updateRoleCards();
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
    includedRoles.add(selectedRole);
    roleElements.get(selectedRole).radio.checked = true;
    roleIncludeError.textContent = "";
    updateRoleCards();
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

  function syncEngineOptions() {
    const selectedEngine = document.querySelector(
      'input[name="engine"]:checked',
    ).value;
    cloudVoiceOptions.classList.toggle("hidden", selectedEngine !== "cloud");
  }

  document
    .querySelectorAll('input[name="engine"]')
    .forEach((radio) => {
      radio.addEventListener("change", syncEngineOptions);
    });
  syncEngineOptions();

  silenceSec.addEventListener("input", () => {
    updateRangeFill(silenceSec);
    silenceSecLabel.textContent =
      `${Number.parseFloat(silenceSec.value).toFixed(1)}초`;
  });

  document.getElementById("backButton").addEventListener("click", () => {
    window.location.href = "/input";
  });

  startButton.addEventListener("click", () => {
    if (includedRoles.size < 2) {
      roleIncludeError.textContent =
        "연습하려면 읽기에 포함할 배역을 2개 이상 골라주세요.";
      return;
    }

    unlockSpeechSynthesis();
    const selectedMode = document.querySelector(
      'input[name="advanceMode"]:checked',
    ).value;
    const selectedEngine = document.querySelector(
      'input[name="engine"]:checked',
    ).value;

    const includedRoleParams = Object.fromEntries(
      roles
        .filter((role) => includedRoles.has(role))
        .map((role) => [role, roleParams[role]]),
    );

    savePracticeSettings({
      myRole: selectedRole,
      roleParams: includedRoleParams,
      advanceMode: selectedMode,
      silenceSec: Number.parseFloat(silenceSec.value),
      engine: selectedEngine,
      voiceId: cloudVoiceId.value,
    });
    trackEvent("char_select");
    if (roles.length === 1) trackMetric("roles_1");
    else if (roles.length === 2) trackMetric("roles_2");
    else if (roles.length >= 3) trackMetric("roles_3plus");
    window.location.href = "/prac";
  });

  if (supportsSpeechSynthesis()) {
    window.speechSynthesis.onvoiceschanged = () => {
      koVoices = getKoreanVoices();
      repopulateVoiceSelects();
    };
  }

  repopulateVoiceSelects();
  updateRoleCards();
  updateRangeFill(silenceSec);
}
