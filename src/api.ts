import type { DayDoc, Entry } from "./types";

const TOKEN_KEY = "dt_token";
const cacheKey = (date: string) => `dt_log_${date}`;
const verKey = (date: string) => `dt_ver_${date}`;

/** Thrown when a PUT is rejected because the server has a newer version. */
export class ConflictError extends Error {
  constructor(public doc: DayDoc) {
    super("version conflict");
    this.name = "ConflictError";
  }
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/** Read the cached day from localStorage (instant load / offline). */
export function readCache(date: string): Entry[] {
  const raw = localStorage.getItem(cacheKey(date));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Entry[]) : [];
  } catch {
    return [];
  }
}

export function readCachedVersion(date: string): number {
  return Number(localStorage.getItem(verKey(date)) ?? "0") || 0;
}

function writeCache(date: string, entries: Entry[], version: number): void {
  localStorage.setItem(cacheKey(date), JSON.stringify(entries));
  localStorage.setItem(verKey(date), String(version));
}

function authHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${getToken()}`,
  };
}

/** Fetch a day (with version) from the server; updates the cache on success. */
export async function fetchDay(date: string): Promise<DayDoc> {
  const res = await fetch(`/api/log?date=${date}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const doc = (await res.json()) as DayDoc;
  writeCache(date, doc.entries, doc.version);
  return doc;
}

/**
 * Persist a day with optimistic concurrency. Writes the cache immediately, then
 * PUTs against `baseVersion`. A 409 means the server moved on — throws
 * ConflictError with the current server doc so the caller can merge and retry.
 * Returns the new version on success.
 */
export async function saveDay(
  date: string,
  baseVersion: number,
  entries: Entry[],
): Promise<number> {
  writeCache(date, entries, baseVersion);
  const res = await fetch(`/api/log?date=${date}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ version: baseVersion, entries }),
  });
  if (res.status === 409) {
    const doc = (await res.json()) as DayDoc;
    writeCache(date, doc.entries, doc.version);
    throw new ConflictError(doc);
  }
  if (!res.ok) throw new Error(`save failed: ${res.status}`);
  const { version } = (await res.json()) as { version: number };
  writeCache(date, entries, version);
  return version;
}

const RECENTS_CACHE_KEY = "dt_recents";

/** Read the cached recent titles (instant load / offline). */
export function readCachedRecents(): string[] {
  const raw = localStorage.getItem(RECENTS_CACHE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function writeRecentsCache(titles: string[]): void {
  localStorage.setItem(RECENTS_CACHE_KEY, JSON.stringify(titles));
}

/** Fetch the user's recent task titles from the server. */
export async function fetchRecents(): Promise<string[]> {
  const res = await fetch(`/api/recents`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`recents fetch failed: ${res.status}`);
  const { titles } = (await res.json()) as { titles: string[] };
  writeRecentsCache(titles);
  return titles;
}

/** Record a title as recently used; returns the updated list. */
export async function pushRecent(title: string): Promise<string[]> {
  const res = await fetch(`/api/recents`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`recents push failed: ${res.status}`);
  const { titles } = (await res.json()) as { titles: string[] };
  writeRecentsCache(titles);
  return titles;
}
