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
    // Phase 2 will plug the batch relay sync runner in here.
    ctx.waitUntil(Promise.resolve({ cron: event?.cron || null }));
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

  return errorJson("API endpoint not found", 404);
}
