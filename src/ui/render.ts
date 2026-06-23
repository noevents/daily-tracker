import type { Entry } from "../types";
import { formatDuration } from "../timer";
import { resolveEnd } from "../log";

function timeOfDay(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
}

/** Render the left-side log list, newest first. `now` resolves open segments. */
export function renderLog(entries: Entry[], now: number): string {
  if (entries.length === 0) {
    return `<p class="log-empty">No entries yet.</p>`;
  }
  return [...entries]
    .sort((a, b) => a.start - b.start)
    .reverse()
    .map((e) => renderEntry(e, now))
    .join("");
}

function renderEntry(e: Entry, now: number): string {
  const open = e.end === null;
  const cls = [
    "entry",
    e.kind === "untracked" ? "entry--untracked" : "",
    open ? "entry--open" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const dur = formatDuration(resolveEnd(e, now) - e.start);
  const desc = e.description
    ? `<p class="entry-desc">${escapeHtml(e.description)}</p>`
    : "";
  const badge =
    e.kind === "untracked" ? `<span class="badge">untracked</span>` : "";
  const live = open ? `<span class="live" title="in progress"></span>` : "";
  const endLabel = open ? "now" : timeOfDay(resolveEnd(e, now));
  return `
    <li class="${cls}" data-id="${e.id}">
      <div class="entry-head">
        <span class="entry-title">${live}<button class="field-edit" data-field="title" type="button">${escapeHtml(e.title)}</button> ${badge}</span>
        <span class="entry-time">${timeOfDay(e.start)}–${endLabel} · <span class="entry-dur">${dur}</span></span>
      </div>
      ${desc}
      <button class="entry-edit field-edit" data-field="description" type="button">
        ${e.description ? "Edit description" : "Add description"}
      </button>
    </li>`;
}

/** Inline field editor. `multiline` uses a textarea, else a single-line input. */
export function editForm(value: string, multiline: boolean): string {
  const control = multiline
    ? `<textarea class="edit-input" rows="2"
        placeholder="What were you doing? (Enter to save, Esc to cancel)">${escapeHtml(value)}</textarea>`
    : `<input class="edit-input" type="text" value="${escapeHtml(value)}"
        placeholder="Title (Enter to save, Esc to cancel)" />`;
  return `
    <form class="edit-form">
      ${control}
      <div class="edit-actions">
        <button type="submit" class="ghost">Save</button>
        <button type="button" class="ghost edit-cancel">Cancel</button>
      </div>
    </form>`;
}

export function appShell(): string {
  return `
    <button id="log-toggle" class="log-toggle" type="button">☰ Log</button>
    <button id="mode-toggle" class="mode-toggle" type="button"></button>
    <aside class="log-panel" id="log-panel">
      <h2>Today</h2>
      <ul id="log-list"></ul>
    </aside>
    <section class="timer-panel">
      <div id="title-display" class="timer-title"></div>
      <div id="display" class="display">00:00</div>
      <div id="hold-bar" class="hold-bar"><span></span></div>
      <input id="title" class="title-input" type="text"
             placeholder="What are you working on?" autocomplete="off" />
      <div class="target-row">
        <div class="adjusts adjusts--left">
          <button data-delta="-10" type="button">−10</button>
          <button data-delta="-5" type="button">−5</button>
        </div>
        <div id="target" class="target">25 min</div>
        <div id="wheel" class="wheel" aria-hidden="true">
          <div id="wheel-track" class="wheel-track"></div>
        </div>
        <div class="adjusts adjusts--right">
          <button data-delta="5" type="button">+5</button>
          <button data-delta="10" type="button">+10</button>
        </div>
      </div>
      <button id="toggle" class="toggle" type="button">Start</button>
    </section>`;
}
