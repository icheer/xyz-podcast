import { runSyncBatch } from "./db/sync.js";
import { handleAdminSync, handleAdminSyncStatus } from "./handlers/admin.js";
import { handleBoardQuery, handleBoardsMeta } from "./handlers/boards.js";
import { handleHealth } from "./handlers/health.js";
import { handleEpisodeDetail, handlePodcastDetail } from "./handlers/xiaoyuzhou.js";
import { sendAlert } from "./utils/alert.js";
import { errorJson } from "./utils/http.js";

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
      runSyncBatch(env.DB, { now, onAlert: (message) => sendAlert(env, message) })
        .then((result) => {
          console.log({
            message: result.skipped
              ? `Scheduled sync skipped: ${result.reason}`
              : result.done
                ? "Scheduled sync completed"
                : "Scheduled sync progressed",
            run: result.run?.run_id,
            catchUp: result.catchUp,
            pages: result.batchPages,
            fetched: result.run?.pages_fetched,
            failures: result.run?.retry_count,
          });
        })
        .catch((err) => {
          console.error("Scheduled sync batch failed:", err);
        })
    );
  },
};

async function handleApi(request, env, ctx, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/health" && method === "GET") {
    return handleHealth(env);
  }

  if (path === "/api/boards/meta" && method === "GET") {
    return handleBoardsMeta(env, request, ctx);
  }

  const boardMatch = path.match(/^\/api\/boards\/([a-z-]+)$/);
  if (boardMatch && method === "GET") {
    return handleBoardQuery(boardMatch[1], url, env, request, ctx);
  }

  const podcastMatch = path.match(/^\/api\/xiaoyuzhou\/podcast\/([^/]+)$/);
  if (podcastMatch && method === "GET") {
    return handlePodcastDetail(podcastMatch[1], env);
  }

  const episodeMatch = path.match(/^\/api\/xiaoyuzhou\/episode\/([^/]+)$/);
  if (episodeMatch && method === "GET") {
    return handleEpisodeDetail(episodeMatch[1], env);
  }

  if (path === "/api/admin/sync" && method === "POST") {
    return handleAdminSync(request, env);
  }

  if (path === "/api/admin/sync/status" && method === "GET") {
    return handleAdminSyncStatus(request, env);
  }

  return errorJson("API endpoint not found", 404);
}
