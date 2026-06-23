import type { DayDoc, Entry } from "../src/types";

export interface Env {
  ASSETS: Fetcher;
  TRACKER_KV: KVNamespace;
  AUTH_TOKEN: string;
}

/** KV key for a given user and ISO date (YYYY-MM-DD). */
export function dayKey(userId: string, date: string): string {
  return `log:${userId}:${date}`;
}

function emptyDoc(): DayDoc {
  return { version: 0, updatedAt: 0, entries: [] };
}

export async function readDay(
  env: Env,
  userId: string,
  date: string,
): Promise<DayDoc> {
  const raw = await env.TRACKER_KV.get(dayKey(userId, date));
  if (!raw) return emptyDoc();
  try {
    const parsed = JSON.parse(raw);
    // Legacy format: a bare array of entries (version 0).
    if (Array.isArray(parsed)) {
      return { version: 0, updatedAt: 0, entries: parsed as Entry[] };
    }
    return {
      version: typeof parsed.version === "number" ? parsed.version : 0,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
      entries: Array.isArray(parsed.entries) ? (parsed.entries as Entry[]) : [],
    };
  } catch {
    return emptyDoc();
  }
}

export async function writeDay(
  env: Env,
  userId: string,
  date: string,
  doc: DayDoc,
): Promise<void> {
  await env.TRACKER_KV.put(dayKey(userId, date), JSON.stringify(doc));
}
