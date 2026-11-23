import { parseEpisodePage, parsePodcastPage } from "./xyzParser.js";

const MAX_DETAIL_CACHE = 60;
const episodeDetailCache = new Map();
const podcastDetailCache = new Map();

function setBoundedCache(cache, key, value) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > MAX_DETAIL_CACHE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
}

async function requestJson(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `请求失败 (${res.status})`);
  }
  return data;
}

export function fetchBoardsMeta() {
  return requestJson("/api/boards/meta");
}

export function fetchBoard(board, params = {}) {
  const search = new URLSearchParams();
  if (params.offset !== undefined) search.set("offset", String(params.offset));
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.q) search.set("q", params.q);
  if (params.genre && params.genre !== "all") search.set("genre", params.genre);
  if (params.sort) search.set("sort", params.sort);
  if (params.dir) search.set("dir", params.dir);
  return requestJson(`/api/boards/${encodeURIComponent(board)}?${search.toString()}`);
}

async function fetchXiaoYuZhouDirect(url, timeoutMs = 12000) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller ? controller.signal : undefined,
    });
    if (res.status === 404) {
      const err = new Error("未找到对应的小宇宙内容");
      err.statusCode = 404;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`小宇宙页面响应异常 (${res.status})`);
      err.statusCode = res.status;
      throw err;
    }
    return await res.text();
  } catch (err) {
    if (err?.name === "AbortError") {
      const timeoutErr = new Error("请求小宇宙官网超时，请稍后重试");
      timeoutErr.statusCode = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchWithFallback(directUrl, fallbackApiUrl, parseFn, id) {
  try {
    const html = await fetchXiaoYuZhouDirect(directUrl);
    return parseFn(html, id);
  } catch (directErr) {
    if (directErr?.statusCode === 404) throw directErr;
    let fallbackErr;
    try {
      return await requestJson(fallbackApiUrl);
    } catch (err) {
      fallbackErr = err;
    }
    if (!String(fallbackErr?.message || "").includes("CF-Worker")) throw fallbackErr;
    throw new Error(
      directErr?.statusCode === 504
        ? directErr.message
        : "暂无法从网页获取该小宇宙内容（可能为无效 ID、受限页面或网络异常），请前往小宇宙官网查看",
      { cause: directErr }
    );
  }
}

export async function fetchPodcastDetail(pid, { forceRefresh = false } = {}) {
  if (!forceRefresh && podcastDetailCache.has(pid)) {
    return podcastDetailCache.get(pid);
  }
  const data = await fetchWithFallback(
    `https://www.xiaoyuzhoufm.com/podcast/${pid}`,
    `/api/xiaoyuzhou/podcast/${encodeURIComponent(pid)}`,
    parsePodcastPage,
    pid
  );
  setBoundedCache(podcastDetailCache, pid, data);
  return data;
}

export async function fetchEpisodeDetail(eid, { forceRefresh = false } = {}) {
  if (!forceRefresh && episodeDetailCache.has(eid)) {
    return episodeDetailCache.get(eid);
  }
  const data = await fetchWithFallback(
    `https://www.xiaoyuzhoufm.com/episode/${eid}`,
    `/api/xiaoyuzhou/episode/${encodeURIComponent(eid)}`,
    parseEpisodePage,
    eid
  );
  setBoundedCache(episodeDetailCache, eid, data);
  return data;
}
