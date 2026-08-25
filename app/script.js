import { parseScript } from "./parse.js";
import {
  clearStartIndex,
  hasStartIndex,
  readScript,
  readStartIndex,
  saveStartIndex,
} from "./storage.js";
import { trackVisit } from "./tracking.js";

trackVisit();

const script = readScript();

if (!script) {
  window.location.replace("/input");
} else {
  initializeScriptPage(script);
}

function initializeScriptPage(scriptText) {
  const { turns, roles } = parseScript(scriptText);
  if (roles.length === 0 || turns.length === 0) {
    window.location.replace("/input");
    return;
  }

  const scriptTurns = document.getElementById("scriptTurns");
  const startPointStatus = document.getElementById("startPointStatus");
  let selectedStartIndex = hasStartIndex(turns.length)
    ? readStartIndex(turns.length)
    : null;

  const turnElements = turns.map((turn, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.setAttribute("aria-label", `${index + 1}번째 대사`);

    const role = document.createElement("span");
    role.className = "script-turn-role";
    role.textContent = turn.role;

    const text = document.createElement("span");
    text.className = "script-turn-text";
    text.textContent = turn.text;

    const marker = document.createElement("span");
    marker.className = "script-turn-start-marker";
    marker.textContent = "여기부터 시작";

    card.append(role, text, marker);
    card.addEventListener("click", () => {
      if (selectedStartIndex === index) {
        selectedStartIndex = null;
        clearStartIndex();
      } else {
        selectedStartIndex = index;
        saveStartIndex(index);
      }
      renderStartPoint();
    });
    return card;
  });

  function renderStartPoint() {
    startPointStatus.textContent = selectedStartIndex === null
      ? "처음부터 시작해요"
      : `${selectedStartIndex + 1}번째 대사부터 시작해요`;

    turnElements.forEach((card, index) => {
      const selected = index === selectedStartIndex;
      const directionClass = turns[index].isDirection ? " is-direction" : "";
      card.className = `script-turn${directionClass}${selected ? " is-start" : ""}`;
      card.setAttribute("aria-pressed", String(selected));
      card.children[2].hidden = !selected;
    });
  }

  renderStartPoint();
  scriptTurns.replaceChildren(...turnElements);
}
