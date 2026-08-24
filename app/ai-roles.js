import { parseScriptWithRoles } from "./parse.js";

const AI_ROLE_CACHE_KEY = "read.aiRoleLookup";

function normalizeRoleNames(roleNames) {
  if (!Array.isArray(roleNames)) return [];
  return [...new Set(
    roleNames
      .filter((name) => typeof name === "string")
      .map((name) => name.trim())
      .filter(Boolean),
  )];
}

// AI가 반환한 것은 이름 후보일 뿐이다. 원문에서 실제 턴이 한 번 이상 잡힌
// 이름만 남긴 뒤, 기존 결정적 파서로 원문을 다시 분할한다.
export function validateAiRoleNames(text, roleNames) {
  const candidates = normalizeRoleNames(roleNames);
  const candidateResult = parseScriptWithRoles(text, candidates);
  const turnCounts = new Map();
  for (const turn of candidateResult.turns) {
    turnCounts.set(turn.role, (turnCounts.get(turn.role) || 0) + 1);
  }

  const verifiedNames = candidates.filter(
    (name) => (turnCounts.get(name) || 0) >= 1,
  );
  if (verifiedNames.length < 2) return null;

  const result = parseScriptWithRoles(text, verifiedNames);
  return result.roles.length >= 2 ? result : null;
}

function scriptFingerprint(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

function readRoleCache(storage) {
  try {
    const cached = JSON.parse(storage?.getItem(AI_ROLE_CACHE_KEY) || "[]");
    return Array.isArray(cached) ? cached : [];
  } catch {
    return [];
  }
}

function readCachedRoleNames(storage, fingerprint) {
  const cached = readRoleCache(storage).find(
    (entry) => entry?.fingerprint === fingerprint,
  );
  if (!cached) return undefined;
  return Array.isArray(cached.roles) ? cached.roles : null;
}

function writeCachedRoleNames(storage, fingerprint, roles) {
  try {
    const cached = readRoleCache(storage).filter(
      (entry) => entry?.fingerprint !== fingerprint,
    );
    cached.push({ fingerprint, roles: Array.isArray(roles) ? roles : null });
    storage?.setItem(AI_ROLE_CACHE_KEY, JSON.stringify(cached));
  } catch {
    // 캐시를 쓸 수 없어도 현재 페이지의 메모리 캐시로 중복을 막는다.
  }
}

// 같은 대본은 성공·실패 여부와 관계없이 현재 페이지에서 한 번만 요청한다.
// 요청한 대본은 짧은 지문과 이름 목록만 sessionStorage에 남겨 새로고침 뒤에도
// 같은 브라우저 세션에서 다시 전송하지 않는다.
export function createAiRoleLookup(
  fetchImpl = fetch,
  { storage = globalThis.sessionStorage } = {},
) {
  const lookups = new Map();

  return (text) => {
    if (lookups.has(text)) return lookups.get(text);

    const fingerprint = scriptFingerprint(text);
    const cachedRoleNames = readCachedRoleNames(storage, fingerprint);
    if (cachedRoleNames !== undefined) {
      const result = cachedRoleNames
        ? validateAiRoleNames(text, cachedRoleNames)
        : null;
      const lookup = Promise.resolve(result);
      lookups.set(text, lookup);
      return lookup;
    }

    // 요청을 시작한 사실부터 기록해 페이지가 닫히거나 요청이 중단돼도 같은
    // 본문을 세션 중 다시 전송하지 않는다. 성공하면 이름 목록만 덧씌운다.
    writeCachedRoleNames(storage, fingerprint, null);
    const lookup = findAiRoleResult(text, fetchImpl).then((result) => {
      writeCachedRoleNames(storage, fingerprint, result?.roles);
      return result;
    });
    lookups.set(text, lookup);
    return lookup;
  };
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
