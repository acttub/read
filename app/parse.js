export function parseScript(text) {
  const lines = text.split("\n");
  const turns = [];
  const roles = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const sepIdx = line.search(/[:：]/);
    if (sepIdx === -1) continue;

    const role = line.slice(0, sepIdx).trim();
    const rest = line.slice(sepIdx + 1).trim();
    if (!role || !rest) continue;

    const isDirection = rest.startsWith("(");
    if (!roles.includes(role)) roles.push(role);
    turns.push({ role, text: rest, isDirection });
  }

  return { turns, roles };
}

export function lastWord(text) {
  const cleaned = text.replace(/[.,!?…"'）)]+$/g, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}
