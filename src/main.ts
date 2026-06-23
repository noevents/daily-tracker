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

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
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
const $testNotif = document.getElementById("test-notif")!;

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
  $testNotif.addEventListener("click", async () => {
    await ensurePermission();
    notifyTargetReached("Test notification");
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
