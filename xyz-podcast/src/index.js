import { runSyncBatch } from "./db/sync.js";
import { handleAdminSync, handleAdminSyncStatus } from "./handlers/admin.js";
import { handleBoardQuery, handleBoardsMeta } from "./handlers/boards.js";
import { errorJson, json } from "./utils/http.js";

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (path.startsWith("/api/")) {
        return await handleApi(request, env, ctx, url);
      }

      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }
      return errorJson("Static assets binding is not configured", 500);
    } catch (err) {
      console.error("Unhandled worker error:", err);
      return errorJson(err?.message || "Internal Server Error", 500);
    }
  },

  async scheduled(event, env, ctx) {
    const now = event?.scheduledTime ? new Date(event.scheduledTime) : new Date();
    ctx.waitUntil(
      runSyncBatch(env.DB, { now }).catch((err) => {
        console.error("Scheduled sync batch failed:", err);
      })
    );
  },
};

async function handleApi(request, env, _ctx, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/health" && method === "GET") {
    if (!env.DB) {
      return errorJson("D1 binding DB is not configured", 500);
    }
    const check = await env.DB.prepare("SELECT 1 AS ok").first();
    return json({
      ok: check?.ok === 1,
      db: "ok",
      timestamp: new Date().toISOString(),
    });
  }

  if (path === "/api/boards/meta" && method === "GET") {
    return handleBoardsMeta(env);
  }

  const boardMatch = path.match(/^\/api\/boards\/([a-z-]+)$/);
  if (boardMatch && method === "GET") {
    return handleBoardQuery(boardMatch[1], url, env);
  }

  if (path === "/api/admin/sync" && method === "POST") {
    return handleAdminSync(request, env);
  }

  if (path === "/api/admin/sync/status" && method === "GET") {
    return handleAdminSyncStatus(request, env);
  }

  return errorJson("API endpoint not found", 404);
}
