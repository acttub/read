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
import {
  readMode,
  readScript,
  saveMode,
  savePracticeSettings,
} from "./storage.js";
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
  const includedRolesList = document.getElementById("includedRolesList");
  const excludedRolesSection = document.getElementById("excludedRolesSection");
  const excludedRolesToggle = document.getElementById("excludedRolesToggle");
  const excludedRolesSummary = document.getElementById("excludedRolesSummary");
  const excludedRolesAction = document.getElementById("excludedRolesAction");
  const excludedRolesChevron = document.getElementById("excludedRolesChevron");
  const excludedRolesPanel = document.getElementById("excludedRolesPanel");
  const excludedRolesList = document.getElementById("excludedRolesList");
  const roleSettingsList = document.getElementById("roleSettingsList");
  const roleIncludeError = document.getElementById("roleIncludeError");
  const overlapNote = document.getElementById("voiceOverlapNote");
  const remoteVoiceNotice = document.getElementById("remoteVoiceNotice");
  const silenceOptions = document.getElementById("silenceOptions");
  const silenceSec = document.getElementById("silenceSec");
  const silenceSecLabel = document.getElementById("silenceSecLabel");
  const cloudVoiceOptions = document.getElementById("cloudVoiceOptions");
  const cloudVoiceId = document.getElementById("cloudVoiceId");
  const voiceSettingsSummary = document.getElementById(
    "voiceSettingsSummary",
  );
  const advanceSettingsSummary = document.getElementById(
    "advanceSettingsSummary",
  );
  const startButton = document.getElementById("startButton");
  const readingDescription = document.getElementById("readingDescription");
  const readingSettings = document.getElementById("readingSettings");
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
  // 위치는 이 최초 분할로만 정한다. 이후 토글은 상태만 바꾸고 DOM을 옮기지 않는다.
  const initiallyExcludedRoles = new Set(initialRolePartition.excluded);
  const roleDisplayOrder = [
    ...initialRolePartition.included,
    ...initialRolePartition.excluded,
  ];
  let selectedRole = initialSelectedRole;
  let koVoices = getKoreanVoices();

  function getSelectedProductMode() {
    return document.querySelector(
      'input[name="practiceMode"]:checked',
    ).value;
  }

  roles.forEach((role, index) => {
    const palette = ROLE_VOICE_PALETTE[index % ROLE_VOICE_PALETTE.length];
    roleParams[role] = {
      voiceName: null,
      rate: palette.rate,
      pitch: palette.pitch,
    };
    roleElements.set(role, {
      pickers: [],
      selectionMarks: [],
      includeToggles: [],
      tileSurface: null,
      setting: null,
      settingBody: null,
      selectedNote: null,
      deviceControls: null,
      previewButton: null,
      voiceSelect: null,
      voiceNote: null,
      rateValue: null,
      pitchValue: null,
    });
  });

  function createSelectionMark() {
    const mark = document.createElement("span");
    mark.className = "shrink-0 text-[12px] font-semibold text-primary-strong";
    mark.textContent = "내 배역";
    mark.hidden = true;
    mark.setAttribute("aria-hidden", "true");
    return mark;
  }

  function createRolePickerInput(role) {
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "myRole";
    input.value = role;
    input.className = "role-picker-input";
    roleElements.get(role).pickers.push(input);
    return input;
  }

  function createRoleTile(role) {
    const tile = document.createElement("label");
    tile.className = "role-picker cursor-pointer rounded-lg p-md";
    tile.dataset.roleTile = role;

    const surface = document.createElement("span");
    surface.className =
      "pointer-events-none absolute inset-0 rounded-lg bg-surface shadow-card";
    surface.setAttribute("aria-hidden", "true");

    const picker = createRolePickerInput(role);
    const copy = document.createElement("span");
    copy.className = "relative flex min-w-0 items-center gap-md";

    const avatar = document.createElement("span");
    avatar.className = "role-avatar shrink-0";
    avatar.textContent = role.slice(0, 1);
    avatar.setAttribute("aria-hidden", "true");

    const roleCopy = document.createElement("span");
    roleCopy.className = "min-w-0 flex-1";

    const nameRow = document.createElement("span");
    nameRow.className = "flex min-w-0 items-start justify-between gap-sm";

    const roleName = document.createElement("span");
    roleName.className = "min-w-0 text-[17px] font-bold text-ink";
    roleName.textContent = role;

    const selectionMark = createSelectionMark();
    nameRow.append(roleName, selectionMark);

    const roleMeta = document.createElement("span");
    roleMeta.className =
      "mt-xs block text-[13px] font-medium text-ink-sub";
    roleMeta.textContent = `대사 ${roleLineCounts.get(role)}줄`;

    roleCopy.append(nameRow, roleMeta);
    copy.append(avatar, roleCopy);
    tile.append(surface, picker, copy);

    const elements = roleElements.get(role);
    elements.tileSurface = surface;
    elements.selectionMarks.push(selectionMark);
    return tile;
  }

  function createIncludeToggle(role) {
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "include-input shrink-0";
    toggle.dataset.includeRole = role;
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-label", `${role} 읽기에 포함`);
    roleElements.get(role).includeToggles.push(toggle);
    return toggle;
  }

  function createExcludedRoleRow(role) {
    const row = document.createElement("div");
    row.className = "flex items-center gap-sm border-t border-line py-sm";

    const pickerLabel = document.createElement("label");
    pickerLabel.className =
      "role-picker flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col justify-center rounded-sm";
    const picker = createRolePickerInput(role);

    const nameRow = document.createElement("span");
    nameRow.className = "flex min-w-0 items-start justify-between gap-sm";
    const roleName = document.createElement("span");
    roleName.className = "min-w-0 text-[15px] font-semibold text-ink";
    roleName.textContent = role;
    const selectionMark = createSelectionMark();
    nameRow.append(roleName, selectionMark);

    const roleMeta = document.createElement("span");
    roleMeta.className = "text-[12px] font-medium text-ink-sub";
    roleMeta.textContent = `대사 ${roleLineCounts.get(role)}줄`;
    pickerLabel.append(picker, nameRow, roleMeta);

    const toggle = createIncludeToggle(role);
    row.append(pickerLabel, toggle);
    roleElements.get(role).selectionMarks.push(selectionMark);
    return row;
  }

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
    labelRow.className = "flex items-center justify-between gap-sm";
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

  function createRoleSetting(role, settingIndex) {
    const originalIndex = roles.indexOf(role);
    const palette =
      ROLE_VOICE_PALETTE[originalIndex % ROLE_VOICE_PALETTE.length];
    const setting = document.createElement("section");
    setting.className = "py-sm";
    if (settingIndex > 0) setting.classList.add("border-t", "border-line");
    setting.dataset.roleSetting = role;

    const header = document.createElement("div");
    header.className = "flex min-h-11 items-center gap-sm";

    const identity = document.createElement("div");
    identity.className = "min-w-0 flex-1";
    const nameRow = document.createElement("div");
    nameRow.className = "flex min-w-0 items-start gap-sm";
    const roleName = document.createElement("span");
    roleName.className = "min-w-0 text-[15px] font-semibold text-ink";
    roleName.textContent = role;
    const selectionMark = createSelectionMark();
    nameRow.append(roleName, selectionMark);
    const roleMeta = document.createElement("span");
    roleMeta.className = "block text-[12px] font-medium text-ink-tertiary";
    roleMeta.textContent = `대사 ${roleLineCounts.get(role)}줄`;
    identity.append(nameRow, roleMeta);

    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.className =
      "shrink-0 rounded-md bg-transparent px-sm text-[14px] font-semibold text-primary-strong active:bg-primary-soft";
    previewButton.textContent = "미리듣기";
    previewButton.dataset.previewRole = role;

    const includeToggle = createIncludeToggle(role);
    header.append(identity, previewButton, includeToggle);

    const settingBody = document.createElement("div");
    settingBody.className = "pb-sm";

    const selectedNote = document.createElement("p");
    selectedNote.className =
      "m-0 pt-sm text-[12px] font-medium text-ink-tertiary";
    selectedNote.textContent = "고른 배역은 읽지 않고 기다릴게요.";

    const deviceControls = document.createElement("div");
    deviceControls.className = "space-y-sm pt-sm";

    const voiceLabel = document.createElement("label");
    voiceLabel.className = "block text-[13px] font-medium text-ink-sub";
    voiceLabel.textContent = "음성";
    const voiceSelect = document.createElement("select");
    voiceSelect.className =
      "mt-xs min-h-11 w-full rounded-md border-0 bg-surface-sub px-md text-ink";
    voiceSelect.dataset.voiceRole = role;
    voiceLabel.append(voiceSelect);

    const sliders = document.createElement("div");
    sliders.className = "grid grid-cols-2 gap-md";
    const rateControl = createRangeControl({
      role,
      param: "rate",
      label: "속도",
      min: "0.5",
      max: "2.0",
      value: palette.rate,
      index: originalIndex,
    });
    const pitchControl = createRangeControl({
      role,
      param: "pitch",
      label: "피치",
      min: "0",
      max: "2.0",
      value: palette.pitch,
      index: originalIndex,
    });
    sliders.append(rateControl.wrapper, pitchControl.wrapper);

    const voiceNote = document.createElement("p");
    voiceNote.className =
      "m-0 text-[12px] font-medium text-danger empty:hidden";
    voiceNote.setAttribute("aria-live", "polite");

    deviceControls.append(voiceLabel, sliders, voiceNote);
    settingBody.append(selectedNote, deviceControls);
    setting.append(header, settingBody);

    const elements = roleElements.get(role);
    elements.setting = setting;
    elements.settingBody = settingBody;
    elements.selectedNote = selectedNote;
    elements.deviceControls = deviceControls;
    elements.previewButton = previewButton;
    elements.voiceSelect = voiceSelect;
    elements.voiceNote = voiceNote;
    elements.rateValue = rateControl.valueLabel;
    elements.pitchValue = pitchControl.valueLabel;
    elements.selectionMarks.push(selectionMark);
    return setting;
  }

  initialRolePartition.included.forEach((role) => {
    includedRolesList.append(createRoleTile(role));
  });
  initialRolePartition.excluded.forEach((role) => {
    excludedRolesList.append(createExcludedRoleRow(role));
  });
  roleDisplayOrder.forEach((role, index) => {
    roleSettingsList.append(createRoleSetting(role, index));
  });

  function updateRangeFill(range) {
    const min = Number.parseFloat(range.min) || 0;
    const max = Number.parseFloat(range.max);
    const value = Number.parseFloat(range.value);
    const percentage = max > min ? ((value - min) / (max - min)) * 100 : 0;
    range.style.setProperty("--range-pct", `${percentage}%`);
  }

  function getSelectedEngine() {
    return document.querySelector('input[name="engine"]:checked').value;
  }

  function getSelectedAdvanceMode() {
    return document.querySelector(
      'input[name="advanceMode"]:checked',
    ).value;
  }

  function getReadingRoleCount() {
    return [...includedRoles].filter((role) => role !== selectedRole).length;
  }

  function updateSettingsSummaries() {
    const engineName =
      getSelectedEngine() === "device" ? "기기 음성" : "자연스러운 음성";
    voiceSettingsSummary.textContent =
      `${engineName} · 읽기에 포함 ${getReadingRoleCount()}명`;

    const selectedMode = getSelectedAdvanceMode();
    const modeName = {
      tap: "탭",
      silence: "침묵 감지",
      cue: "큐 단어",
    }[selectedMode];
    advanceSettingsSummary.textContent =
      selectedMode === "silence"
        ? `${modeName} · ${Number.parseFloat(silenceSec.value).toFixed(1)}초`
        : modeName;
  }

  function updateRoleUI() {
    const deviceEngine = getSelectedEngine() === "device";
    const quizMode = getSelectedProductMode() === "quiz";

    for (const [role, elements] of roleElements) {
      const selected = role === selectedRole;
      const included = includedRoles.has(role);

      elements.pickers.forEach((picker) => {
        picker.checked = selected;
      });
      elements.selectionMarks.forEach((mark) => {
        mark.hidden = !selected;
      });
      elements.includeToggles.forEach((toggle) => {
        toggle.checked = included;
        toggle.disabled = selected;
      });

      if (elements.tileSurface) {
        elements.tileSurface.classList.toggle("border-2", selected);
        elements.tileSurface.classList.toggle("border-primary", selected);
        elements.tileSurface.classList.toggle("bg-primary-soft", selected);
        elements.tileSurface.classList.toggle("bg-surface", !selected);
        elements.tileSurface.classList.toggle("shadow-card", !selected);
      }

      elements.setting.hidden =
        initiallyExcludedRoles.has(role) && !included && !selected;
      elements.previewButton.hidden = selected || !included || !deviceEngine;
      elements.selectedNote.hidden = !selected;
      elements.deviceControls.hidden = selected || !included || !deviceEngine;
      elements.settingBody.hidden =
        elements.selectedNote.hidden && elements.deviceControls.hidden;
    }

    startButton.disabled = !selectedRole || (!quizMode && includedRoles.size < 2);
    if (!quizMode && includedRoles.size < 2) {
      roleIncludeError.textContent =
        "연습하려면 읽기에 포함할 배역을 2개 이상 골라주세요.";
    } else if (quizMode) {
      roleIncludeError.textContent = "";
    }

    updateSettingsSummaries();
    updateVoiceOverlapNote();
  }

  function syncProductMode() {
    const quizMode = getSelectedProductMode() === "quiz";
    readingDescription.hidden = quizMode;
    readingSettings.hidden = quizMode;
    updateRoleUI();
  }

  function updateVoiceOverlapNote() {
    const includedCount = getReadingRoleCount();
    const deviceEngine = getSelectedEngine() === "device";
    const overlapMessage =
      deviceEngine && koVoices.length < includedCount
        ? `이 기기에서는 한국어 음성이 ${koVoices.length}개라 포함한 배역 ${includedCount}개 중 일부는 속도·피치로만 구분됩니다.`
        : "";
    overlapNote.textContent = overlapMessage;
    overlapNote.classList.toggle("hidden", overlapMessage === "");

    // getKoreanVoices()가 localService를 우선 정렬해 두므로, 있다면 항상 koVoices[0]이
    // 로컬이다 — 그게 원격이면 이 기기엔 로컬 한국어 음성이 아예 없다는 뜻이다.
    const hasLocalVoice = koVoices.length > 0 && Boolean(koVoices[0].localService);
    remoteVoiceNotice.classList.toggle(
      "hidden",
      !deviceEngine || koVoices.length === 0 || hasLocalVoice,
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

  function bindDisclosure(toggleId, panelId, chevronId) {
    const toggle = document.getElementById(toggleId);
    const panel = document.getElementById(panelId);
    const chevron = document.getElementById(chevronId);
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      panel.classList.toggle("hidden", expanded);
      chevron.classList.toggle("rotate-180", !expanded);
    });
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
      excludedRolesChevron.classList.toggle("rotate-180", !expanded);
    });
  } else {
    excludedRolesSection.remove();
  }

  bindDisclosure(
    "voiceSettingsToggle",
    "voiceSettingsPanel",
    "voiceSettingsChevron",
  );
  bindDisclosure(
    "advanceSettingsToggle",
    "advanceSettingsPanel",
    "advanceSettingsChevron",
  );

  rolesList.addEventListener("change", (event) => {
    const target = event.target;

    if (target.matches('input[name="myRole"]')) {
      selectedRole = target.value;
      includedRoles.add(selectedRole);
      roleIncludeError.textContent = "";
      updateRoleUI();
      return;
    }

    if (target.matches("input[data-include-role]")) {
      const role = target.dataset.includeRole;
      if (role === selectedRole) {
        includedRoles.add(role);
        updateRoleUI();
        return;
      }
      if (!target.checked && includedRoles.size <= 2) {
        roleIncludeError.textContent =
          "상대 배역을 읽으려면 배역 2개 이상을 포함해야 해요.";
        updateRoleUI();
        return;
      }

      if (target.checked) includedRoles.add(role);
      else includedRoles.delete(role);
      roleIncludeError.textContent = "";
      updateRoleUI();
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
    if (button) previewRole(button.dataset.previewRole);
  });

  const cueNotice = document.getElementById("cueNotice");

  function syncAdvanceModeOptions() {
    const selectedMode = getSelectedAdvanceMode();
    silenceOptions.classList.toggle("hidden", selectedMode !== "silence");
    // 큐 단어는 구조적으로 목소리를 브라우저 음성 인식 서비스로 보내야 동작한다 —
    // 막을 방법이 없어서, 고를 때마다 그 사실을 알린다.
    cueNotice.classList.toggle("hidden", selectedMode !== "cue");
    updateSettingsSummaries();
  }

  document
    .querySelectorAll('input[name="advanceMode"]')
    .forEach((radio) => {
      radio.addEventListener("change", syncAdvanceModeOptions);
    });

  function syncEngineOptions() {
    const selectedEngine = getSelectedEngine();
    cloudVoiceOptions.classList.toggle("hidden", selectedEngine !== "cloud");
    updateRoleUI();
  }

  document.querySelectorAll('input[name="engine"]').forEach((radio) => {
    radio.addEventListener("change", syncEngineOptions);
  });

  document.querySelectorAll('input[name="practiceMode"]').forEach((radio) => {
    radio.addEventListener("change", syncProductMode);
  });

  silenceSec.addEventListener("input", () => {
    updateRangeFill(silenceSec);
    silenceSecLabel.textContent =
      `${Number.parseFloat(silenceSec.value).toFixed(1)}초`;
    updateSettingsSummaries();
  });

  document.getElementById("backButton").addEventListener("click", () => {
    window.location.href = "/input";
  });

  startButton.addEventListener("click", () => {
    const productMode = getSelectedProductMode();
    if (productMode === "read" && includedRoles.size < 2) {
      roleIncludeError.textContent =
        "연습하려면 읽기에 포함할 배역을 2개 이상 골라주세요.";
      return;
    }

    if (productMode === "read") unlockSpeechSynthesis();
    const selectedMode = getSelectedAdvanceMode();
    const selectedEngine = getSelectedEngine();
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
    saveMode(productMode);
    trackEvent("char_select");
    if (roles.length === 1) trackMetric("roles_1");
    else if (roles.length === 2) trackMetric("roles_2");
    else if (roles.length >= 3) trackMetric("roles_3plus");
    window.location.href = productMode === "quiz" ? "/quiz" : "/prac";
  });

  if (supportsSpeechSynthesis()) {
    window.speechSynthesis.onvoiceschanged = () => {
      koVoices = getKoreanVoices();
      repopulateVoiceSelects();
    };
  }

  repopulateVoiceSelects();
  const initialProductMode = readMode();
  document.querySelector(
    `input[name="practiceMode"][value="${initialProductMode}"]`,
  ).checked = true;
  syncAdvanceModeOptions();
  syncEngineOptions();
  syncProductMode();
  updateRangeFill(silenceSec);
}
