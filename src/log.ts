import type { Entry } from "./types";
import { targetEndMs } from "./timer";

/** Local ISO date (YYYY-MM-DD) for a timestamp, in the user's timezone. */
export function dateKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Effective end of an entry: its stored end, or `now` while still open. */
export function resolveEnd(e: Entry, now: number): number {
  return e.end ?? now;
}

/** The current open segment (last entry with no end), if any. */
export function openSegment(entries: Entry[]): Entry | undefined {
  const last = entries[entries.length - 1];
  return last && last.end === null ? last : undefined;
}

/** Close the current open segment at `now`. */
export function closeOpen(entries: Entry[], now: number): void {
  const open = openSegment(entries);
  if (open) {
    open.end = now;
    open.updated = now;
  }
}

/** Close any open segment and begin an open untracked segment at `now`. */
export function startUntracked(entries: Entry[], now: number): Entry {
  closeOpen(entries, now);
  const e: Entry = {
    id: newId(),
    start: now,
    end: null,
    title: "Untracked",
    targetMin: 0,
    kind: "untracked",
    updated: now,
  };
  entries.push(e);
  return e;
}

/** Close any open segment and begin an open tracked session at `now`. */
export function startTracked(
  entries: Entry[],
  now: number,
  title: string,
  targetMin: number,
): Entry {
  closeOpen(entries, now);
  const e: Entry = {
    id: newId(),
    start: now,
    end: null,
    title: title.trim() || "Untitled",
    targetMin,
    kind: "tracked",
    updated: now,
  };
  entries.push(e);
  return e;
}

/**
 * Convert the open untracked segment in place to a tracked session: the gap
 * that was ticking becomes logged work under `title`, keeping its start so the
 * timer continues from the already-elapsed time. Returns the entry, or
 * undefined if there is no open untracked segment to continue.
 */
export function continueAsTracked(
  entries: Entry[],
  title: string,
  targetMin: number,
  now: number,
): Entry | undefined {
  const open = openSegment(entries);
  if (!open || open.kind !== "untracked") return undefined;
  open.kind = "tracked";
  open.title = title.trim() || "Untitled";
  open.targetMin = targetMin;
  open.updated = now;
  return open;
}

/** An untracked gap with no user-supplied title or note — safe to merge. */
function isPlainUntracked(e: Entry): boolean {
  return (
    e.kind === "untracked" &&
    !e.description &&
    (e.title === "Untracked" || !e.title)
  );
}

/**
 * Merge runs of contiguous plain-untracked entries into one block. A refresh or
 * a second device each begins its own untracked segment, so the timeline
 * accumulates back-to-back gaps; this collapses them (earliest id and start,
 * latest end) so untracked time reads as a single span.
 */
export function coalesceUntracked(entries: Entry[], now: number): Entry[] {
  const sorted = [...entries].sort((a, b) => a.start - b.start);
  const out: Entry[] = [];
  for (const e of sorted) {
    const prev = out[out.length - 1];
    if (
      prev &&
      isPlainUntracked(prev) &&
      isPlainUntracked(e) &&
      prev.end !== null &&
      prev.end >= e.start
    ) {
      prev.end = e.end === null ? null : Math.max(prev.end, e.end);
      prev.updated = now;
    } else {
      out.push(e);
    }
  }
  return out;
}

/**
 * Merge two entry sets by id, newest `updated` wins. Used to reconcile a
 * locally-edited day with the server copy without clobbering either side.
 */
export function mergeEntries(base: Entry[], incoming: Entry[]): Entry[] {
  const byId = new Map<string, Entry>();
  for (const e of base) byId.set(e.id, e);
  for (const e of incoming) {
    const existing = byId.get(e.id);
    if (!existing || (e.updated ?? 0) >= (existing.updated ?? 0)) {
      byId.set(e.id, e);
    }
  }
  return [...byId.values()].sort((a, b) => a.start - b.start);
}

/**
 * Ensure at most one open segment after a merge (each device may have started
 * its own). All but the latest open entry are closed at the next entry's start
 * so the timeline stays continuous.
 */
export function normalizeOpen(entries: Entry[], now: number): Entry[] {
  const sorted = [...entries].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (e.end !== null) continue;
    const next = sorted[i + 1];
    if (next) {
      e.end = Math.max(e.start, next.start);
      e.updated = now;
    }
  }
  return sorted;
}

/** Stable content signature, ignoring `updated`, to detect real changes. */
export function entriesSignature(entries: Entry[]): string {
  return [...entries]
    .sort((a, b) => a.start - b.start)
    .map(
      (e) =>
        `${e.id}|${e.start}|${e.end ?? ""}|${e.title}|${e.targetMin}|${e.kind}|${e.description ?? ""}`,
    )
    .join("\n");
}

export interface Reconciliation {
  /** A tracked session is still within its target and should keep running. */
  resume: boolean;
  /** Entries were modified and should be persisted. */
  changed: boolean;
}

/**
 * Bring loaded entries into a consistent state for "now":
 * - no open segment            → begin untracked (track all time from now)
 * - open untracked             → keep growing (captures time away)
 * - open tracked, within target → resume the running timer
 * - open tracked, past target   → finalize at target, untracked since
 */
export function reconcile(entries: Entry[], now: number): Reconciliation {
  const open = openSegment(entries);
  if (!open) {
    startUntracked(entries, now);
    return { resume: false, changed: true };
  }
  if (open.kind === "tracked") {
    const tEnd = targetEndMs(open.start, open.targetMin);
    if (now >= tEnd) {
      open.end = tEnd;
      open.updated = now;
      startUntracked(entries, tEnd);
      return { resume: false, changed: true };
    }
    return { resume: true, changed: false };
  }
  return { resume: false, changed: false };
}
