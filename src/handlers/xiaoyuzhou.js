import { errorJson, isValidXyzId, json } from "../utils/http.js";
import { parseEpisodePage, parsePodcastPage } from "../utils/parser.js";

const XYZ_HTML_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Referer: "https://www.xiaoyuzhoufm.com/",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9",
};

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

async function fetchXiaoYuZhouHtml(targetUrl, env = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const relayBase = typeof env?.XYZ_RELAY_URL === "string" ? env.XYZ_RELAY_URL.trim() : "";
  const fetchUrl = relayBase
    ? `${relayBase}${relayBase.includes("?") ? "&" : "?"}url=${encodeURIComponent(targetUrl)}`
    : targetUrl;

  const headers = { ...XYZ_HTML_HEADERS };
  if (relayBase && env?.XYZ_RELAY_TOKEN) {
    headers["X-Relay-Token"] = env.XYZ_RELAY_TOKEN;
  }

  try {
    const res = await fetch(fetchUrl, {
      headers,
      signal: controller.signal,
      redirect: "follow",
    });
    if (res.status === 404) {
      const err = new Error("Not Found on XiaoYuZhou");
      err.statusCode = 404;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(
        res.status === 403 && !relayBase
          ? "XiaoYuZhou blocked Cloudflare Worker CF-Worker header (use browser CORS fetch or configure XYZ_RELAY_URL)"
          : `Upstream XiaoYuZhou returned HTTP ${res.status}`
      );
      err.statusCode = res.status === 403 ? 403 : 502;
      throw err;
    }
    return await res.text();
  } catch (err) {
    if (err?.name === "AbortError") {
      const timeoutErr = new Error("Upstream XiaoYuZhou request timed out");
      timeoutErr.statusCode = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function handlePodcastDetail(pid, env) {
  if (!isValidXyzId(pid)) {
    return errorJson("Invalid podcast ID", 400);
  }
  const targetUrl = `https://www.xiaoyuzhoufm.com/podcast/${pid}`;
  try {
    const html = await fetchXiaoYuZhouHtml(targetUrl, env);
    const data = parsePodcastPage(html, pid);
    return json(data, 200, NO_STORE_HEADERS);
  } catch (err) {
    const status = err?.statusCode || 502;
    return errorJson(err?.message || "Failed to load podcast from XiaoYuZhou", status);
  }
}

export async function handleEpisodeDetail(eid, env) {
  if (!isValidXyzId(eid)) {
    return errorJson("Invalid episode ID", 400);
  }
  const targetUrl = `https://www.xiaoyuzhoufm.com/episode/${eid}`;
  try {
    const html = await fetchXiaoYuZhouHtml(targetUrl, env);
    const data = parseEpisodePage(html, eid);
    return json(data, 200, NO_STORE_HEADERS);
  } catch (err) {
    const status = err?.statusCode || 502;
    return errorJson(err?.message || "Failed to load episode from XiaoYuZhou", status);
  }
}
