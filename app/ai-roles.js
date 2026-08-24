import { parseScriptWithRoles } from "./parse.js";

function normalizeRoleNames(roleNames) {
  if (!Array.isArray(roleNames)) return [];
  return [...new Set(
    roleNames
      .filter((name) => typeof name === "string")
      .map((name) => name.trim())
      .filter(Boolean),
  )];
}

// AI가 반환한 것은 이름 후보일 뿐이다. 원문에서 실제 턴이 두 번 이상 잡힌
// 이름만 남긴 뒤, 기존 결정적 파서로 원문을 다시 분할한다.
export function validateAiRoleNames(text, roleNames) {
  const candidates = normalizeRoleNames(roleNames);
  const candidateResult = parseScriptWithRoles(text, candidates);
  const turnCounts = new Map();
  for (const turn of candidateResult.turns) {
    turnCounts.set(turn.role, (turnCounts.get(turn.role) || 0) + 1);
  }

  const verifiedNames = candidates.filter(
    (name) => (turnCounts.get(name) || 0) >= 2,
  );
  if (verifiedNames.length < 2) return null;

  const result = parseScriptWithRoles(text, verifiedNames);
  return result.roles.length >= 2 ? result : null;
}

export async function findAiRoleResult(
  text,
  fetchImpl = fetch,
  { signal } = {},
) {
  try {
    const response = await fetchImpl("/api/parse-roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!response.ok) return null;

    const payload = await response.json();
    return validateAiRoleNames(text, payload.roles);
  } catch {
    return null;
  }
}
