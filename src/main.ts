import type { Entry } from "./types";
import {
  DEFAULT_TARGET_MIN,
  adjustTarget,
  targetEndMs,
  targetReached,
  formatDuration,
} from "./timer";
import {
  dateKey,
  openSegment,
  startUntracked,
  startTracked,
  reconcile,
  mergeEntries,
  normalizeOpen,
  entriesSignature,
} from "./log";
import { ensurePermission, notifyTargetReached } from "./notify";
import {
  fetchDay,
  saveDay,
  readCache,
  readCachedVersion,
  getToken,
  setToken,
  ConflictError,
} from "./api";
import { appShell, renderLog, editForm } from "./ui/render";
import { attachGestures } from "./gestures";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}

// iOS Safari ignores user-scalable=no, so block pinch-zoom in JS. We only
// preventDefault for multi-touch, leaving single-finger scroll/typing intact.
document.addEventListener(
  "touchmove",
  (e) => {
    if ((e as TouchEvent).touches.length > 1) e.preventDefault();
  },
  { passive: false },
);
// iOS also drives pinch-zoom through these non-standard gesture events.
for (const t of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(t, (e) => e.preventDefault());
}

const date = dateKey();
let entries: Entry[] = [];
// Version of the day doc we last synced with the server (optimistic concurrency).
let version = 0;
// True when a write failed and local changes still need pushing.
let dirty = false;
// Target shown for the *next* tracked session while untracked.
let nextTargetMin = DEFAULT_TARGET_MIN;
// Whether the running tracked session has fired its target notification.
let notified = false;
const POLL_MS = 20_000;
const WRITE_DEBOUNCE_MS = 1_500;

const app = document.getElementById("app")!;
app.innerHTML = appShell();

const $title = document.getElementById("title") as HTMLInputElement;
const $display = document.getElementById("display")!;
const $target = document.getElementById("target")!;
const $toggle = document.getElementById("toggle")!;
const $list = document.getElementById("log-list")!;
const $logPanel = document.getElementById("log-panel")!;
const $logToggle = document.getElementById("log-toggle")!;
const $titleDisplay = document.getElementById("title-display")!;
const $modeToggle = document.getElementById("mode-toggle")!;
const $hold = document.getElementById("hold-bar")!;
const $wheel = document.getElementById("wheel")!;
const $wheelTrack = document.getElementById("wheel-track")!;

const isTouch = window.matchMedia("(pointer: coarse)").matches;
// Touch devices default to gestures; the choice is then remembered.
let gestureMode =
  (localStorage.getItem("gestureMode") ?? (isTouch ? "1" : "0")) === "1";

function isTracking(): boolean {
  const open = openSegment(entries);
  return open?.kind === "tracked";
}

function renderControls() {
  const open = openSegment(entries);
  const tracking = open?.kind === "tracked";
  $toggle.textContent = tracking ? "Stop" : "Start";
  $toggle.classList.toggle("running", tracking);
  if (tracking && open) {
    $target.textContent = `${open.targetMin} min`;
  } else {
    $target.textContent = `${nextTargetMin} min`;
  }
}

function renderDisplay() {
  const open = openSegment(entries);
  const now = Date.now();
  const ms = open ? now - open.start : 0;
  $display.textContent = formatDuration(ms);
  const over = !!open && open.kind === "tracked" && targetReached(open.start, open.targetMin, now);
  $display.classList.toggle("overtime", over);
  $display.classList.toggle("untracked", !!open && open.kind === "untracked");
}

function renderList() {
  $list.innerHTML = renderLog(entries, Date.now());
}

/** Mirror the title input into the static line shown above the clock. */
function renderTitle() {
  const v = ($title as HTMLInputElement).value.trim();
  $titleDisplay.textContent = v || "What are you working on?";
  $titleDisplay.classList.toggle("empty", !v);
}

let detachGestures: (() => void) | null = null;

function applyMode() {
  document.body.classList.toggle("gesture-mode", gestureMode);
  $modeToggle.textContent = gestureMode ? "Buttons" : "Gestures";
  renderTitle();
  detachGestures?.();
  detachGestures = null;
  if (gestureMode) {
    detachGestures = attachGestures(
      document.querySelector(".timer-panel") as HTMLElement,
      {
        onPullTitle: openTitleSheet,
        onTargetScrub: (step) => onAdjust(step * WHEEL_STEP),
        onToggle: () => {
          renderHold(null);
          pulseDisplay();
          void onToggle();
        },
        onHold: renderHold,
      },
      // Don't capture gestures while the title sheet is open for editing.
      () => document.body.classList.contains("title-open"),
    );
  } else {
    closeTitleSheet();
  }
}

function setMode(on: boolean) {
  gestureMode = on;
  localStorage.setItem("gestureMode", on ? "1" : "0");
  applyMode();
}

function openTitleSheet() {
  document.body.classList.add("title-open");
  const input = $title as HTMLInputElement;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function closeTitleSheet() {
  document.body.classList.remove("title-open");
  ($title as HTMLInputElement).blur();
}

/** Persist a confirmed title and reflect it above the clock. */
function confirmTitle() {
  renderTitle();
  const open = openSegment(entries);
  if (open?.kind === "tracked") {
    open.title = ($title as HTMLInputElement).value.trim() || "Untitled";
    open.updated = Date.now();
    renderList();
    void persist();
  }
  closeTitleSheet();
}

/** Reflect press-and-hold progress (0..1) as a filling bar; null clears it. */
function renderHold(progress: number | null) {
  if (progress === null) {
    $hold.classList.remove("active");
    $hold.style.setProperty("--p", "0");
    return;
  }
  $hold.classList.add("active");
  $hold.style.setProperty("--p", String(progress));
}

function pulseDisplay() {
  $display.classList.remove("tapped");
  void $display.offsetWidth; // restart the animation
  $display.classList.add("tapped");
}

/** Write to the server, resolving version conflicts by merge-and-retry. */
async function persist(retries = 5): Promise<void> {
  try {
    version = await saveDay(date, version, entries);
    dirty = false;
  } catch (err) {
    if (err instanceof ConflictError && retries > 0) {
      entries = normalizeOpen(
        mergeEntries(err.doc.entries, entries),
        Date.now(),
      );
      version = err.doc.version;
      renderControls();
      renderList();
      renderDisplay();
      return persist(retries - 1);
    }
    dirty = true;
    console.error("save failed", err);
  }
}

let writeTimer: number | null = null;
/** Coalesce rapid writes (e.g. target ± taps) to protect the KV write budget. */
function persistDebounced() {
  dirty = true;
  if (writeTimer !== null) window.clearTimeout(writeTimer);
  writeTimer = window.setTimeout(() => {
    writeTimer = null;
    void persist();
  }, WRITE_DEBOUNCE_MS);
}

/** Pull the server copy and merge in remote changes. Read-only unless a real
 *  local change still needs pushing (keeps polling off the KV write budget). */
async function refresh() {
  if (document.hidden) return;
  try {
    const doc = await fetchDay(date);
    const now = Date.now();
    const merged = normalizeOpen(mergeEntries(doc.entries, entries), now);
    const localHasChanges =
      entriesSignature(merged) !== entriesSignature(doc.entries);
    entries = merged;
    version = doc.version;
    const r = reconcile(entries, now);
    renderControls();
    renderList();
    renderDisplay();
    if (localHasChanges || r.changed || dirty) void persist();
  } catch (err) {
    console.error("refresh failed", err);
  }
}

function tick() {
  renderDisplay();
  const open = openSegment(entries);
  if (
    open &&
    open.kind === "tracked" &&
    !notified &&
    targetReached(open.start, open.targetMin, Date.now())
  ) {
    notified = true;
    void finishTracked();
    return;
  }
  // Live-update only the open entry's duration (don't clobber edit forms).
  if (open) {
    const el = $list.querySelector(
      `.entry[data-id="${open.id}"] .entry-dur`,
    );
    if (el) el.textContent = formatDuration(Date.now() - open.start);
  }
}

/** Auto-finalize the running session at its target and resume untracked. */
async function finishTracked() {
  const open = openSegment(entries);
  if (!open || open.kind !== "tracked") return;
  const tEnd = targetEndMs(open.start, open.targetMin);
  open.end = tEnd;
  open.updated = Date.now();
  notifyTargetReached(open.title);
  startUntracked(entries, Math.max(tEnd, Date.now()));
  renderControls();
  renderList();
  await persist();
}

async function onToggle() {
  const now = Date.now();
  if (isTracking()) {
    startUntracked(entries, now);
  } else {
    notified = false;
    startTracked(entries, now, $title.value, nextTargetMin);
    await ensurePermission();
  }
  renderControls();
  renderDisplay();
  renderList();
  await persist();
}

function onAdjust(delta: number) {
  const open = openSegment(entries);
  if (open?.kind === "tracked") {
    open.targetMin = adjustTarget(open.targetMin, delta);
    open.updated = Date.now();
    persistDebounced();
  } else {
    nextTargetMin = adjustTarget(nextTargetMin, delta);
  }
  renderControls();
  renderDisplay();
  flashScrub();
}

const WHEEL_MIN = 5;
const WHEEL_MAX = 180;
const WHEEL_STEP = 5; // minutes per scrub increment
const WHEEL_ITEM = 96; // px; must match .wheel-num flex-basis
let wheelBuilt = false;
let scrubTimer: number | null = null;

function currentTargetMin(): number {
  const open = openSegment(entries);
  return open?.kind === "tracked" ? open.targetMin : nextTargetMin;
}

/** Populate the scroll wheel once with every selectable minute value. */
function buildWheel() {
  if (wheelBuilt) return;
  const html: string[] = [];
  for (let v = WHEEL_MIN; v <= WHEEL_MAX; v += WHEEL_STEP) {
    html.push(`<span class="wheel-num" data-v="${v}">${v}</span>`);
  }
  $wheelTrack.innerHTML = html.join("");
  wheelBuilt = true;
}

/** Center the wheel on `target` and mark it current. */
function positionWheel(target: number) {
  const index = (target - WHEEL_MIN) / WHEEL_STEP;
  const center = $wheel.clientWidth / 2;
  const x = center - index * WHEEL_ITEM - WHEEL_ITEM / 2;
  $wheelTrack.style.transform = `translateX(${x}px)`;
  $wheelTrack.querySelector(".wheel-num.current")?.classList.remove("current");
  $wheelTrack
    .querySelector(`.wheel-num[data-v="${target}"]`)
    ?.classList.add("current");
}

/** Reveal the wheel and slide it to the current target; auto-hides when idle. */
function flashScrub() {
  if (!gestureMode) return;
  buildWheel();
  positionWheel(currentTargetMin());
  document.body.classList.add("scrubbing");
  if (scrubTimer !== null) window.clearTimeout(scrubTimer);
  scrubTimer = window.setTimeout(
    () => document.body.classList.remove("scrubbing"),
    650,
  );
}

function onEditField(li: HTMLElement, field: "title" | "description") {
  const id = li.dataset.id!;
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  const trigger = li.querySelector(
    `.field-edit[data-field="${field}"]`,
  ) as HTMLElement;
  const multiline = field === "description";
  const current = field === "title" ? entry.title : (entry.description ?? "");
  trigger.insertAdjacentHTML("afterend", editForm(current, multiline));
  trigger.style.display = "none";
  const form = li.querySelector(".edit-form") as HTMLFormElement;
  const input = form.querySelector(".edit-input") as
    | HTMLInputElement
    | HTMLTextAreaElement;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  const close = () => renderList();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (field === "title") {
      entry.title = value || (entry.kind === "untracked" ? "Untracked" : "Untitled");
    } else {
      entry.description = value || undefined;
    }
    entry.updated = Date.now();
    void persist();
    renderList();
  });
  form.querySelector(".edit-cancel")!.addEventListener("click", close);
  (input as HTMLElement).addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    } else if (e.key === "Escape") {
      close();
    }
  });
}

function wireEvents() {
  $toggle.addEventListener("click", () => void onToggle());
  document.querySelectorAll<HTMLButtonElement>(".adjusts button").forEach((b) => {
    b.addEventListener("click", () => onAdjust(Number(b.dataset.delta)));
  });
  $list.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".field-edit") as HTMLElement;
    if (!btn) return;
    const field = btn.dataset.field === "title" ? "title" : "description";
    onEditField(btn.closest(".entry") as HTMLElement, field);
  });
  $logToggle.addEventListener("click", () => $logPanel.classList.toggle("open"));
  $modeToggle.addEventListener("click", () => setMode(!gestureMode));
  $title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmTitle();
    } else if (e.key === "Escape") {
      closeTitleSheet();
    }
  });
  // Confirm the title sheet when focus leaves it (gesture mode only).
  $title.addEventListener("blur", () => {
    if (document.body.classList.contains("title-open")) confirmTitle();
  });
  // Pull remote changes when returning to the tab, plus a gentle poll.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refresh();
  });
  window.addEventListener("focus", () => void refresh());
  window.setInterval(() => void refresh(), POLL_MS);
}

async function init() {
  if (!getToken()) {
    const token = window.prompt("Enter access token:");
    if (token) setToken(token);
  }
  entries = readCache(date);
  version = readCachedVersion(date);
  const local = reconcile(entries, Date.now());

  wireEvents();
  applyMode();
  renderControls();
  renderDisplay();
  renderList();
  if (local.changed) void persist();

  try {
    const doc = await fetchDay(date);
    const now = Date.now();
    const merged = normalizeOpen(mergeEntries(doc.entries, entries), now);
    const localHasChanges =
      entriesSignature(merged) !== entriesSignature(doc.entries);
    entries = merged;
    version = doc.version;
    const r = reconcile(entries, now);
    renderControls();
    renderList();
    renderDisplay();
    if (localHasChanges || r.changed) void persist();
  } catch (err) {
    console.error("initial fetch failed; using cache", err);
  }

  window.setInterval(tick, 250);
}

void init();
