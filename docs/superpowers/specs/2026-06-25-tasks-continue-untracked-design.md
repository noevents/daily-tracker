# Tasks list, Continue button, untracked cleanup

Three changes to the daily-tracker UI/model.

## 1. Recent-titles task list

A clickable list of recent task titles with a pinned **"Break"** on top, placed
beside the timer.

- **Layout:** three regions — `log sidebar | timer | task list`. Timer + task
  list are the two main columns; the log stays an independent sidebar (overlay
  on mobile, unchanged).
  - Desktop: `#app` grid `340px minmax(0,1fr) 220px`. Timer = `1fr` (largest),
    task list a fixed ~200px column.
  - Mobile (`≤900px` / landscape phone): task list collapses to a horizontal,
    scrollable chip strip below the Start/Continue row.
- Each item is a button; long titles truncate with `text-overflow: ellipsis`.
  Click sets the timer's title input (does **not** rename a running session).
- **Storage (KV):** new `recents:{userId}` key, `GET /api/recents` and
  `POST /api/recents {title}` (server dedupes, prepends, caps ~15). Client loads
  on init and posts the title whenever a tracked session starts or continues.
  "Break" is pinned client-side and filtered out of stored recents.

## 2. Continue button

Right of Start. Resumes the title currently in the box, continuing the clock
from that title's total logged time today.

- New optional `Entry.baseMs` (default 0). Continue starts a tracked session for
  the current title-box value with `baseMs = sum of today's logged ms for that
  exact title`.
- Display = `baseMs + (now − start)`. Target fires on the running total
  (`now ≥ start + target − baseMs`), then auto-finalizes to untracked as today.
  Edge: if already past target at Continue, it runs in overtime instead of
  beeping instantly (`notified` pre-set).
- The log entry records its own wall-clock duration (`end − start`); only the
  big clock shows the cumulative total.
- Continue is hidden/disabled while a session is running.

## 3. Untracked cleanup

- Remove the `untracked` badge entirely from `render.ts`.
- Renaming a closed untracked block flips its `kind` to `tracked` (loses red).
  The open segment is not converted (avoids a 0-target instant finalize).
- Coalesce consecutive untracked: merge adjacent plain-untracked entries
  (contiguous, no description, default title) into one — earliest start, latest
  end, earliest id. Runs in the merge/normalize pipeline so refresh /
  multi-device duplicates collapse and persist.

## Testing

Unit tests for `baseMs` target math, untracked coalescing, and rename→tracked
conversion (extend `tests/log.test.ts`, `tests/timer.test.ts`).
