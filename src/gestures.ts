/** Single-finger gesture recognizer for the mobile timer.
 *
 * The state machine is DOM-free so it can be unit-tested with synthetic touch
 * snapshots. `attachGestures` wires real TouchEvents into it.
 *
 * Gestures (one finger, on the timer surface):
 *   - press & hold   → onToggle (start/stop), with onHold(progress) feedback
 *   - drag left/right → onTargetScrub (right decreases, left increases)
 *   - swipe down      → onPullTitle */

export interface Pt {
  x: number;
  y: number;
}

export interface GestureCallbacks {
  /** Swipe down past the pull threshold (fires once per gesture). */
  onPullTitle: () => void;
  /** Horizontal scrub. `step` is signed minutes (right = negative). */
  onTargetScrub: (step: number) => void;
  /** Press-and-hold completed. */
  onToggle: () => void;
  /** Hold progress 0..1 while pressing, or null when idle/cancelled. */
  onHold: (progress: number | null) => void;
}

export interface GestureOptions {
  axisThreshold: number;
  scrubStep: number;
  pullThreshold: number;
  holdMs: number;
  holdCancelMove: number;
}

export const DEFAULT_OPTS: GestureOptions = {
  axisThreshold: 12,
  scrubStep: 24,
  pullThreshold: 48,
  holdMs: 700,
  holdCancelMove: 10,
};

export class GestureRecognizer {
  private o: GestureOptions;
  private cb: GestureCallbacks;
  private active = false;
  private startC: Pt = { x: 0, y: 0 };
  private startT = 0;
  private axis: "h" | "v" | null = null;
  private scrubAnchorX = 0;
  private moved = 0;
  private pulled = false;
  private holdAlive = false;
  private holdFired = false;

  constructor(cb: GestureCallbacks, opts: Partial<GestureOptions> = {}) {
    this.cb = cb;
    this.o = { ...DEFAULT_OPTS, ...opts };
  }

  start(touches: Pt[], time: number): void {
    // Only single-finger gestures; a second finger cancels (and is a pinch we
    // block elsewhere).
    if (touches.length !== 1) {
      this.cancel();
      return;
    }
    this.active = true;
    this.startC = touches[0];
    this.startT = time;
    this.axis = null;
    this.scrubAnchorX = this.startC.x;
    this.moved = 0;
    this.pulled = false;
    this.holdAlive = true;
    this.holdFired = false;
  }

  move(touches: Pt[], _time: number): void {
    if (!this.active || touches.length !== 1) return;
    const c = touches[0];
    const dx = c.x - this.startC.x;
    const dy = c.y - this.startC.y;
    this.moved = Math.max(this.moved, Math.hypot(dx, dy));

    // Any real movement rules out a hold.
    if (this.holdAlive && this.moved > this.o.holdCancelMove) {
      this.holdAlive = false;
      this.cb.onHold(null);
    }

    if (this.axis === null) {
      if (Math.abs(dx) > this.o.axisThreshold || Math.abs(dy) > this.o.axisThreshold) {
        this.axis = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      }
    }

    if (this.axis === "h") {
      const steps = Math.trunc((c.x - this.scrubAnchorX) / this.o.scrubStep);
      if (steps !== 0) {
        // Swipe right (positive) decreases the target.
        this.cb.onTargetScrub(-steps);
        this.scrubAnchorX += steps * this.o.scrubStep;
      }
    } else if (this.axis === "v" && !this.pulled && dy > this.o.pullThreshold) {
      this.pulled = true;
      this.cb.onPullTitle();
    }
  }

  /** Drive the hold timer. The DOM layer calls this on every frame while a
   *  touch is active; tests call it with explicit timestamps. */
  poll(time: number): void {
    if (!this.active || !this.holdAlive || this.holdFired) return;
    const p = (time - this.startT) / this.o.holdMs;
    if (p >= 1) {
      this.holdFired = true;
      this.holdAlive = false;
      this.cb.onHold(null);
      this.cb.onToggle();
    } else {
      this.cb.onHold(p);
    }
  }

  end(_time: number): void {
    if (!this.active) return;
    if (this.holdAlive && !this.holdFired) this.cb.onHold(null);
    this.active = false;
    this.holdAlive = false;
  }

  cancel(): void {
    if (this.holdAlive && !this.holdFired) this.cb.onHold(null);
    this.active = false;
    this.holdAlive = false;
  }
}

function pts(list: TouchList): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < list.length; i++) {
    out.push({ x: list[i].clientX, y: list[i].clientY });
  }
  return out;
}

/** Attach the recognizer to an element. Returns a detach function.
 *  `skip` lets the caller suppress gestures (e.g. while the title sheet edits). */
export function attachGestures(
  el: HTMLElement,
  cb: GestureCallbacks,
  skip: () => boolean,
  opts: Partial<GestureOptions> = {},
): () => void {
  const r = new GestureRecognizer(cb, opts);
  let raf = 0;
  const tick = () => {
    r.poll(performance.now());
    raf = requestAnimationFrame(tick);
  };
  const stopRaf = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const onStart = (e: TouchEvent) => {
    if (skip()) return;
    e.preventDefault(); // stop scroll + double-tap zoom on the timer surface
    r.start(pts(e.touches), performance.now());
    if (!raf) raf = requestAnimationFrame(tick);
  };
  const onMove = (e: TouchEvent) => {
    if (skip()) return;
    e.preventDefault();
    r.move(pts(e.touches), performance.now());
  };
  const onEnd = (e: TouchEvent) => {
    r.end(performance.now());
    if (e.touches.length === 0) stopRaf();
  };

  el.addEventListener("touchstart", onStart, { passive: false });
  el.addEventListener("touchmove", onMove, { passive: false });
  el.addEventListener("touchend", onEnd);
  el.addEventListener("touchcancel", onEnd);
  return () => {
    stopRaf();
    el.removeEventListener("touchstart", onStart);
    el.removeEventListener("touchmove", onMove);
    el.removeEventListener("touchend", onEnd);
    el.removeEventListener("touchcancel", onEnd);
  };
}
