export type EntryKind = "tracked" | "untracked";

/**
 * A log entry. Times are epoch milliseconds. `end` is null while the entry is
 * the current open segment (still accumulating). There is always exactly one
 * open segment — either a running tracked session or ongoing untracked time.
 */
export interface Entry {
  id: string;
  start: number;
  end: number | null;
  title: string;
  /** Target minutes for tracked sessions; 0 for untracked. */
  targetMin: number;
  kind: EntryKind;
  description?: string;
  /** Last-modified epoch ms; drives newest-wins merge across devices. */
  updated?: number;
}

/** A day's stored document: entries plus a version for optimistic concurrency. */
export interface DayDoc {
  version: number;
  updatedAt: number;
  entries: Entry[];
}
