import { parseScript } from "./parse.js";
import { readScript } from "./storage.js";

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
  const chooseRoleButton = document.getElementById("chooseRoleButton");

  const turnElements = turns.map((turn, index) => {
    const card = document.createElement("article");
    card.className = `script-turn${turn.isDirection ? " is-direction" : ""}`;
    card.setAttribute("aria-label", `${index + 1}번째 대사`);

    const role = document.createElement("p");
    role.className = "script-turn-role";
    role.textContent = turn.role;

    const text = document.createElement("p");
    text.className = "script-turn-text";
    text.textContent = turn.text;

    card.append(role, text);
    return card;
  });

  scriptTurns.replaceChildren(...turnElements);
  chooseRoleButton.addEventListener("click", () => {
    window.location.href = "/char";
  });
}
