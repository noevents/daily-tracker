export const DEFAULT_TARGET_MIN = 25;
export const MIN_TARGET_MIN = 5;

/** Clamp a target adjustment to the minimum allowed value. */
export function adjustTarget(targetMin: number, deltaMin: number): number {
  return Math.max(MIN_TARGET_MIN, targetMin + deltaMin);
}

/** Epoch ms at which a tracked session reaches its target. */
export function targetEndMs(start: number, targetMin: number): number {
  return start + targetMin * 60_000;
}

/** True once a tracked session has reached its target. */
export function targetReached(
  start: number,
  targetMin: number,
  now: number,
): boolean {
  return now >= targetEndMs(start, targetMin);
}

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
