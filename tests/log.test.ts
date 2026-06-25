import { describe, it, expect } from "vitest";
import {
  dateKey,
  resolveEnd,
  openSegment,
  startUntracked,
  startTracked,
  closeOpen,
  reconcile,
  mergeEntries,
  normalizeOpen,
  coalesceUntracked,
  continueAsTracked,
} from "../src/log";
import type { Entry } from "../src/types";

const MIN = 60_000;

describe("open segment model", () => {
  it("starts untracked: one open untracked entry", () => {
    const entries: Entry[] = [];
    const e = startUntracked(entries, 1000);
    expect(entries).toHaveLength(1);
    expect(openSegment(entries)).toBe(e);
    expect(e.kind).toBe("untracked");
    expect(e.end).toBeNull();
  });

  it("starting tracked closes the prior open untracked segment", () => {
    const entries: Entry[] = [];
    startUntracked(entries, 0);
    const t = startTracked(entries, 5 * MIN, "  write spec ", 25);
    expect(entries).toHaveLength(2);
    expect(entries[0].end).toBe(5 * MIN); // untracked closed
    expect(t.kind).toBe("tracked");
    expect(t.title).toBe("write spec");
    expect(t.end).toBeNull();
    expect(openSegment(entries)).toBe(t);
  });

  it("untitled tracked sessions fall back to a title", () => {
    const entries: Entry[] = [];
    const t = startTracked(entries, 0, "   ", 25);
    expect(t.title).toBe("Untitled");
  });

  it("closeOpen finalizes the current segment", () => {
    const entries: Entry[] = [];
    startUntracked(entries, 0);
    closeOpen(entries, 1000);
    expect(entries[0].end).toBe(1000);
    expect(openSegment(entries)).toBeUndefined();
  });

  it("resolveEnd uses now for open entries", () => {
    const open: Entry = { id: "a", start: 0, end: null, title: "x", targetMin: 0, kind: "untracked" };
    const closed: Entry = { ...open, id: "b", end: 500 };
    expect(resolveEnd(open, 999)).toBe(999);
    expect(resolveEnd(closed, 999)).toBe(500);
  });
});

describe("reconcile", () => {
  it("with no open segment, begins untracked", () => {
    const entries: Entry[] = [];
    const r = reconcile(entries, 1000);
    expect(r.changed).toBe(true);
    expect(openSegment(entries)?.kind).toBe("untracked");
  });

  it("keeps an open untracked segment growing", () => {
    const entries: Entry[] = [];
    startUntracked(entries, 0);
    const r = reconcile(entries, 10 * MIN);
    expect(r).toEqual({ resume: false, changed: false });
    expect(entries).toHaveLength(1);
    expect(openSegment(entries)?.end).toBeNull();
  });

  it("resumes a tracked session still within target", () => {
    const entries: Entry[] = [];
    startTracked(entries, 0, "task", 25);
    const r = reconcile(entries, 10 * MIN);
    expect(r.resume).toBe(true);
    expect(openSegment(entries)?.kind).toBe("tracked");
  });

  it("finalizes a tracked session past target, untracked since", () => {
    const entries: Entry[] = [];
    startTracked(entries, 0, "task", 25);
    const r = reconcile(entries, 40 * MIN);
    expect(r.changed).toBe(true);
    expect(entries).toHaveLength(2);
    expect(entries[0].end).toBe(25 * MIN); // finalized at target
    expect(entries[1].kind).toBe("untracked");
    expect(entries[1].start).toBe(25 * MIN);
    expect(entries[1].end).toBeNull();
  });
});

function mk(id: string, start: number, updated: number, over: Partial<Entry> = {}): Entry {
  return {
    id,
    start,
    end: start + 1000,
    title: id,
    targetMin: 25,
    kind: "tracked",
    updated,
    ...over,
  };
}

describe("mergeEntries", () => {
  it("unions by id and keeps the newest-updated version", () => {
    const base = [mk("a", 0, 100, { title: "old" })];
    const incoming = [mk("a", 0, 200, { title: "new" }), mk("b", 5 * MIN, 50)];
    const merged = mergeEntries(base, incoming);
    expect(merged.map((e) => e.id)).toEqual(["a", "b"]);
    expect(merged.find((e) => e.id === "a")!.title).toBe("new");
  });

  it("keeps the existing version when incoming is older", () => {
    const base = [mk("a", 0, 200, { title: "keep" })];
    const incoming = [mk("a", 0, 100, { title: "stale" })];
    expect(mergeEntries(base, incoming)[0].title).toBe("keep");
  });
});

describe("normalizeOpen", () => {
  it("closes all but the latest open segment at the next start", () => {
    const a = mk("a", 0, 1, { end: null });
    const b = mk("b", 10 * MIN, 1, { end: null });
    const result = normalizeOpen([a, b], 99 * MIN);
    expect(result.find((e) => e.id === "a")!.end).toBe(10 * MIN);
    expect(result.find((e) => e.id === "b")!.end).toBeNull();
  });

  it("leaves a single open segment untouched", () => {
    const a = mk("a", 0, 1, { end: 1000 });
    const b = mk("b", 10 * MIN, 1, { end: null });
    const result = normalizeOpen([a, b], 99 * MIN);
    expect(result.find((e) => e.id === "b")!.end).toBeNull();
  });
});

function untracked(id: string, start: number, end: number | null, over: Partial<Entry> = {}): Entry {
  return { id, start, end, title: "Untracked", targetMin: 0, kind: "untracked", updated: 1, ...over };
}

describe("coalesceUntracked", () => {
  it("merges consecutive plain untracked into one, keeping the earliest id", () => {
    const result = coalesceUntracked(
      [untracked("a", 0, 10 * MIN), untracked("b", 10 * MIN, 25 * MIN)],
      99 * MIN,
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(25 * MIN);
  });

  it("extends into an open trailing untracked (end stays null)", () => {
    const result = coalesceUntracked(
      [untracked("a", 0, 10 * MIN), untracked("b", 10 * MIN, null)],
      99 * MIN,
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
    expect(result[0].end).toBeNull();
  });

  it("does not merge across a tracked entry", () => {
    const tracked = mk("t", 10 * MIN, 1, { end: 20 * MIN });
    const result = coalesceUntracked(
      [untracked("a", 0, 10 * MIN), tracked, untracked("b", 20 * MIN, null)],
      99 * MIN,
    );
    expect(result.map((e) => e.id)).toEqual(["a", "t", "b"]);
  });

  it("preserves an untracked block that carries a description", () => {
    const result = coalesceUntracked(
      [untracked("a", 0, 10 * MIN, { description: "lunch" }), untracked("b", 10 * MIN, null)],
      99 * MIN,
    );
    expect(result.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("does not merge a renamed (tracked) block back in", () => {
    const renamed = untracked("a", 0, 10 * MIN, { kind: "tracked", title: "email" });
    const result = coalesceUntracked([renamed, untracked("b", 10 * MIN, null)], 99 * MIN);
    expect(result.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("continueAsTracked", () => {
  it("converts the open untracked gap in place, keeping its start", () => {
    const entries: Entry[] = [];
    startUntracked(entries, 5 * MIN);
    const e = continueAsTracked(entries, "  write spec ", 25, 12 * MIN);
    expect(entries).toHaveLength(1); // same entry, not a new one
    expect(e).toBe(openSegment(entries));
    expect(e!.kind).toBe("tracked");
    expect(e!.title).toBe("write spec");
    expect(e!.targetMin).toBe(25);
    expect(e!.start).toBe(5 * MIN); // start preserved → timer continues
    expect(e!.end).toBeNull();
  });

  it("does nothing when the open segment is not untracked", () => {
    const entries: Entry[] = [];
    startTracked(entries, 0, "task", 25);
    expect(continueAsTracked(entries, "x", 25, 10 * MIN)).toBeUndefined();
    expect(openSegment(entries)!.title).toBe("task");
  });
});

describe("dateKey", () => {
  it("formats a local YYYY-MM-DD", () => {
    const ts = new Date(2026, 5, 23, 10, 30).getTime();
    expect(dateKey(ts)).toBe("2026-06-23");
  });
});
