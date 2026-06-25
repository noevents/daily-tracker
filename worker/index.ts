import type { DayDoc, Entry } from "../src/types";
import { readDay, writeDay, readRecents, pushRecent, type Env } from "./store";

// Single user for now; tokens map to userIds when this goes multi-user.
const USER_ID = "me";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function authorized(req: Request, env: Env): boolean {
  if (!env.AUTH_TOKEN) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  return token === env.AUTH_TOKEN;
}

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  if (!authorized(req, env)) return json({ error: "unauthorized" }, 401);

  if (url.pathname === "/api/log") {
    const date = url.searchParams.get("date") ?? "";
    if (!DATE_RE.test(date)) return json({ error: "invalid date" }, 400);

    if (req.method === "GET") {
      return json(await readDay(env, USER_ID, date));
    }
    if (req.method === "PUT") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      const { version, entries } = (body ?? {}) as {
        version?: unknown;
        entries?: unknown;
      };
      if (typeof version !== "number" || !Array.isArray(entries)) {
        return json({ error: "expected { version, entries }" }, 400);
      }
      // Optimistic concurrency: reject stale writes; client merges + retries.
      const current = await readDay(env, USER_ID, date);
      if (current.version !== version) {
        return json(current, 409);
      }
      const doc: DayDoc = {
        version: version + 1,
        updatedAt: Date.now(),
        entries: entries as Entry[],
      };
      await writeDay(env, USER_ID, date, doc);
      return json({ version: doc.version });
    }
    return json({ error: "method not allowed" }, 405);
  }

  if (url.pathname === "/api/recents") {
    if (req.method === "GET") {
      return json({ titles: await readRecents(env, USER_ID) });
    }
    if (req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      const { title } = (body ?? {}) as { title?: unknown };
      if (typeof title !== "string") {
        return json({ error: "expected { title }" }, 400);
      }
      return json({ titles: await pushRecent(env, USER_ID, title) });
    }
    return json({ error: "method not allowed" }, 405);
  }

  return json({ error: "not found" }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(req, env, url);
    }
    return env.ASSETS.fetch(req);
  },
};
