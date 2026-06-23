/** Ask for notification permission (call on a user gesture, e.g. Start). */
export async function ensurePermission(): Promise<void> {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      // ignore — we still beep
    }
  }
}

let audioCtx: AudioContext | null = null;

/** One marimba-like note with a fast attack and exponential decay. */
function playNote(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  at: number,
  dur: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.9, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(dest);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

/**
 * iOS-style ascending three-note chime via WebAudio. Louder and longer than a
 * plain beep; works even when system notifications are denied.
 */
export function beep(): void {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const master = ctx.createGain();
    master.gain.value = 1.0;
    master.connect(ctx.destination);
    const t = ctx.currentTime;
    // Ascending arpeggio: A5 → D6 → G6, each with a soft octave overtone.
    const notes: Array<[number, number]> = [
      [440.0, 0.0],
      [587.33, 0.14],
      [783.99, 0.28],
    ];
    for (const [freq, offset] of notes) {
      playNote(ctx, master, freq, t + offset, 0.6);
      playNote(ctx, master, freq * 2, t + offset, 0.45);
    }
  } catch {
    // no audio available — nothing else to do
  }
}

/** Fire the target-reached notification: system notification + beep. */
export function notifyTargetReached(title: string): void {
  beep();
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Target reached", {
      body: title || "Time's up",
    });
  }
}
