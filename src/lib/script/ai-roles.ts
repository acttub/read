import { parseScript } from "./parse";

const AI_ROLE_CACHE_KEY = "read.aiRoleLookup";

export const DIRECT_INPUT_LOOKUP_DELAY_MS = 1000;

type RoleStorage = Pick<Storage, "getItem" | "setItem">;
type CachedLookup = { fingerprint: string; roles: string[] | null };

function normalizeRoleNames(roleNames: unknown): string[] {
  if (!Array.isArray(roleNames)) return [];
  return [...new Set(
    roleNames
      .filter((name): name is string => typeof name === "string")
      .map((name) => name.trim())
      .filter(Boolean),
  )];
}

/** AI 응답은 후보일 뿐이다. 원문에서 실제 대사로 한 번 이상 잡힌 이름만 채택한다. */
export function validateAiRoleNames(text: string, roleNames: unknown): string[] | null {
  const candidates = normalizeRoleNames(roleNames);
  const candidateResult = parseScript(text, { roleHints: candidates, onlyHints: true });
  const turnCounts = new Map<string, number>();
  for (const line of candidateResult.lines) {
    if (line.type !== "dialogue") continue;
    turnCounts.set(line.role, (turnCounts.get(line.role) ?? 0) + 1);
  }

  const verified = candidates.filter((name) => (turnCounts.get(name) ?? 0) >= 1);
  return verified.length >= 2 ? verified : null;
}

function scriptFingerprint(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

function readRoleCache(storage: RoleStorage | undefined): CachedLookup[] {
  try {
    const cached: unknown = JSON.parse(storage?.getItem(AI_ROLE_CACHE_KEY) || "[]");
    return Array.isArray(cached) ? cached as CachedLookup[] : [];
  } catch {
    return [];
  }
}

function readCachedRoleNames(storage: RoleStorage | undefined, fingerprint: string): string[] | null | undefined {
  const cached = readRoleCache(storage).find((entry) => entry?.fingerprint === fingerprint);
  if (!cached) return undefined;
  return Array.isArray(cached.roles) ? cached.roles : null;
}

function writeCachedRoleNames(storage: RoleStorage | undefined, fingerprint: string, roles: string[] | null): void {
  try {
    const cached = readRoleCache(storage).filter((entry) => entry?.fingerprint !== fingerprint);
    cached.push({ fingerprint, roles });
    storage?.setItem(AI_ROLE_CACHE_KEY, JSON.stringify(cached));
  } catch {
    // 저장소가 막혀도 현재 페이지의 메모리 캐시가 중복 요청을 막는다.
  }
}

export async function findAiRoleNames(
  text: string,
  fetchImpl: typeof fetch = fetch,
  { signal }: { signal?: AbortSignal } = {},
): Promise<string[] | null> {
  try {
    const response = await fetchImpl("/api/parse-roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!response.ok) return null;

    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("roles" in payload)) return null;
    return validateAiRoleNames(text, payload.roles);
  } catch {
    return null;
  }
}

/** 같은 대본은 성공·실패와 관계없이 현재 탭 세션에서 한 번만 조회한다. */
export function createAiRoleLookup(
  fetchImpl: typeof fetch = fetch,
  { storage = typeof sessionStorage === "undefined" ? undefined : sessionStorage }: { storage?: RoleStorage } = {},
): (text: string) => Promise<string[] | null> {
  const lookups = new Map<string, Promise<string[] | null>>();

  return (text) => {
    const existing = lookups.get(text);
    if (existing) return existing;

    const fingerprint = scriptFingerprint(text);
    const cached = readCachedRoleNames(storage, fingerprint);
    if (cached !== undefined) {
      const lookup = Promise.resolve(cached ? validateAiRoleNames(text, cached) : null);
      lookups.set(text, lookup);
      return lookup;
    }

    // 요청 시작부터 기록해 페이지가 닫혀도 같은 세션에서 본문을 다시 보내지 않는다.
    writeCachedRoleNames(storage, fingerprint, null);
    const lookup = findAiRoleNames(text, fetchImpl).then((roles) => {
      writeCachedRoleNames(storage, fingerprint, roles);
      return roles;
    });
    lookups.set(text, lookup);
    return lookup;
  };
}
