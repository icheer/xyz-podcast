const KEYS = {
  QUEUE: "xyzp_v1_queue",
  PROGRESS: "xyzp_v1_progress",
  PREFS: "xyzp_v1_prefs",
  FAVORITES: "xyzp_v1_favorites",
};

export const MAX_PROGRESS_ENTRIES = 200;
export const MAX_FAVORITES = 300;
export const LOOP_MODES = ["sequential", "repeat-all", "repeat-one"];
export const PLAYBACK_RATES = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

function defaultStorage() {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

function readJson(storage, key, fallback) {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(storage, key, value) {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors cleanly
  }
}

export function loadQueue(storage = defaultStorage()) {
  const data = readJson(storage, KEYS.QUEUE, { items: [], currentEid: null });
  return {
    items: Array.isArray(data.items) ? data.items : [],
    currentEid: typeof data.currentEid === "string" ? data.currentEid : null,
  };
}

export function saveQueue(items, currentEid, storage = defaultStorage()) {
  writeJson(storage, KEYS.QUEUE, {
    items: Array.isArray(items) ? items : [],
    currentEid: currentEid || null,
  });
}

export function loadPrefs(storage = defaultStorage()) {
  const data = readJson(storage, KEYS.PREFS, {});
  const rate = PLAYBACK_RATES.includes(Number(data.playbackRate))
    ? Number(data.playbackRate)
    : 1.0;
  const loopMode = LOOP_MODES.includes(data.loopMode) ? data.loopMode : "sequential";
  let theme = "light";
  if (data.theme === "dark" || data.theme === "light") {
    theme = data.theme;
  } else if (
    storage === defaultStorage() &&
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
  ) {
    theme = "dark";
  }
  return { playbackRate: rate, loopMode, theme };
}

export function savePrefs(prefs, storage = defaultStorage()) {
  writeJson(storage, KEYS.PREFS, {
    playbackRate: prefs.playbackRate || 1.0,
    loopMode: prefs.loopMode || "sequential",
    theme: prefs.theme === "dark" ? "dark" : "light",
  });
}

export function loadProgressMap(storage = defaultStorage()) {
  const map = readJson(storage, KEYS.PROGRESS, {});
  return map && typeof map === "object" && !Array.isArray(map) ? map : {};
}

export function saveProgressMap(map, storage = defaultStorage()) {
  const safe = map && typeof map === "object" && !Array.isArray(map) ? map : {};
  const entries = Object.entries(safe);
  if (entries.length > MAX_PROGRESS_ENTRIES) {
    entries.sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0));
    const trimmed = Object.fromEntries(entries.slice(0, MAX_PROGRESS_ENTRIES));
    writeJson(storage, KEYS.PROGRESS, trimmed);
    return trimmed;
  }
  writeJson(storage, KEYS.PROGRESS, safe);
  return safe;
}

export function getEpisodeProgress(eid, storage = defaultStorage()) {
  if (!eid) return null;
  const map = loadProgressMap(storage);
  return map[eid] || null;
}

/**
 * Persist playback progress (and optional episode metadata for listening history),
 * evicting oldest entries beyond MAX_PROGRESS_ENTRIES.
 */
export function saveEpisodeProgress(
  eid,
  { currentTime, duration, finished = false, updatedAt = Date.now(), meta = null },
  storage = defaultStorage()
) {
  if (!eid) return {};
  const map = loadProgressMap(storage);
  const prev = map[eid] || {};
  const nextEntry = {
    currentTime: Math.max(0, Number(currentTime) || 0),
    duration: Math.max(0, Number(duration) || Number(prev.duration) || 0),
    finished: Boolean(finished),
    updatedAt: Number(updatedAt) || Date.now(),
  };

  const title = meta?.title || prev.title || "";
  const podcastName = meta?.podcastName || prev.podcastName || "";
  const pid = meta?.pid || prev.pid || "";
  const image = meta?.image || prev.image || "";
  const enclosureUrl = meta?.enclosureUrl || prev.enclosureUrl || "";

  if (title) nextEntry.title = String(title);
  if (podcastName) nextEntry.podcastName = String(podcastName);
  if (pid) nextEntry.pid = String(pid);
  if (image) nextEntry.image = String(image);
  if (enclosureUrl) nextEntry.enclosureUrl = String(enclosureUrl);

  map[eid] = nextEntry;
  return saveProgressMap(map, storage);
}

export function removeEpisodeProgress(eid, storage = defaultStorage()) {
  if (!eid) return loadProgressMap(storage);
  const map = loadProgressMap(storage);
  delete map[eid];
  writeJson(storage, KEYS.PROGRESS, map);
  return map;
}

export function clearAllProgress(storage = defaultStorage()) {
  writeJson(storage, KEYS.PROGRESS, {});
  return {};
}

/**
 * Determine whether an episode should auto-resume from saved progress.
 */
export function resolveResumeSeconds(entry, durationSec = 0) {
  if (!entry || entry.finished) return 0;
  const pos = Number(entry.currentTime) || 0;
  const dur = Number(durationSec) || Number(entry.duration) || 0;
  if (pos <= 5) return 0;
  if (dur > 0 && dur - pos <= 5) return 0;
  return pos;
}

/**
 * Extract RSS feed URL from xyzrank links array if present.
 */
export function extractRssUrlFromLinks(links) {
  if (!Array.isArray(links)) return "";
  const hit = links.find((l) => {
    if (!l || typeof l.url !== "string") return false;
    const name = String(l.name || "").toLowerCase();
    return (
      name === "rss" ||
      name === "feed" ||
      /\.(?:xml|rss)(?:\?|$)/i.test(l.url) ||
      l.url.includes("/feed")
    );
  });
  return hit ? hit.url : "";
}

export function loadFavorites(storage = defaultStorage()) {
  const list = readJson(storage, KEYS.FAVORITES, []);
  if (!Array.isArray(list)) return [];
  return list.filter((item) => item && typeof item.pid === "string" && item.pid);
}

export function saveFavorites(items, storage = defaultStorage()) {
  const safe = Array.isArray(items)
    ? items
        .filter((item) => item && typeof item.pid === "string" && item.pid)
        .slice(0, MAX_FAVORITES)
    : [];
  writeJson(storage, KEYS.FAVORITES, safe);
  return safe;
}

export function toggleFavoritePodcast(pod, storage = defaultStorage()) {
  const pid = String(pod?.pid || "").trim();
  const current = loadFavorites(storage);
  if (!pid) return { favorites: current, added: false };

  const exists = current.some((item) => item.pid === pid);
  if (exists) {
    const next = saveFavorites(
      current.filter((item) => item.pid !== pid),
      storage
    );
    return { favorites: next, added: false };
  }

  const rssUrl =
    String(pod?.rssUrl || "").trim() || extractRssUrlFromLinks(pod?.links);
  const entry = {
    pid,
    title: String(pod?.title || pod?.name || "未命名播客"),
    author: String(pod?.author || pod?.authorsText || ""),
    image: String(pod?.image || pod?.logoURL || ""),
    rssUrl,
    xyzUrl: `https://www.xiaoyuzhoufm.com/podcast/${pid}`,
    addedAt: Number(pod?.addedAt) || Date.now(),
  };
  const next = saveFavorites([entry, ...current], storage);
  return { favorites: next, added: true };
}

/**
 * Build a portable JSON backup object of local user listening state.
 */
export function exportUserDataObject(storage = defaultStorage()) {
  return {
    app: "xyz-podcast",
    version: 1,
    exportedAt: new Date().toISOString(),
    favorites: loadFavorites(storage),
    queue: loadQueue(storage),
    progress: loadProgressMap(storage),
    prefs: loadPrefs(storage),
  };
}

/**
 * Parse, validate, and merge an imported JSON backup into storage without losing newer local records.
 */
export function parseAndMergeBackupJson(rawText, storage = defaultStorage()) {
  if (typeof rawText !== "string" || !rawText.trim()) {
    throw new Error("备份文件内容为空");
  }
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error("无效的 JSON 备份文件格式");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("备份文件结构不正确");
  }
  if (
    !Array.isArray(data.favorites) &&
    (!data.progress || typeof data.progress !== "object") &&
    (!data.queue || typeof data.queue !== "object")
  ) {
    throw new Error("未识别到有效的收听备份数据");
  }

  // Merge favorites by pid (prefer richer rssUrl/image, keep earliest or imported order)
  const localFavs = loadFavorites(storage);
  const favMap = new Map();
  for (const item of localFavs) {
    favMap.set(item.pid, item);
  }
  if (Array.isArray(data.favorites)) {
    for (const raw of data.favorites) {
      const pid = String(raw?.pid || "").trim();
      if (!pid || !/^[a-zA-Z0-9]{16,40}$/.test(pid)) continue;
      const prev = favMap.get(pid);
      favMap.set(pid, {
        pid,
        title: String(raw.title || prev?.title || "未命名播客"),
        author: String(raw.author || prev?.author || ""),
        image: String(raw.image || prev?.image || ""),
        rssUrl: String(raw.rssUrl || prev?.rssUrl || ""),
        xyzUrl: `https://www.xiaoyuzhoufm.com/podcast/${pid}`,
        addedAt: Number(raw.addedAt) || prev?.addedAt || Date.now(),
      });
    }
  }
  const mergedFavorites = saveFavorites(
    [...favMap.values()].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)),
    storage
  );

  // Merge progress by eid (keep record with newer updatedAt, preserving metadata)
  const localProgress = loadProgressMap(storage);
  const mergedProgressRaw = { ...localProgress };
  if (data.progress && typeof data.progress === "object" && !Array.isArray(data.progress)) {
    for (const [eid, inc] of Object.entries(data.progress)) {
      if (!eid || !inc || typeof inc !== "object") continue;
      const cur = mergedProgressRaw[eid];
      const incTime = Number(inc.updatedAt) || 0;
      const curTime = Number(cur?.updatedAt) || 0;
      const winner = incTime >= curTime ? inc : cur;
      const fallback = incTime >= curTime ? cur : inc;
      const entry = {
        currentTime: Math.max(0, Number(winner.currentTime) || 0),
        duration: Math.max(0, Number(winner.duration) || Number(fallback?.duration) || 0),
        finished: Boolean(winner.finished),
        updatedAt: Math.max(incTime, curTime) || Date.now(),
      };
      const title = winner.title || fallback?.title || "";
      const podcastName = winner.podcastName || fallback?.podcastName || "";
      const pid = winner.pid || fallback?.pid || "";
      const image = winner.image || fallback?.image || "";
      const enclosureUrl = winner.enclosureUrl || fallback?.enclosureUrl || "";
      if (title) entry.title = String(title);
      if (podcastName) entry.podcastName = String(podcastName);
      if (pid) entry.pid = String(pid);
      if (image) entry.image = String(image);
      if (enclosureUrl) entry.enclosureUrl = String(enclosureUrl);
      mergedProgressRaw[eid] = entry;
    }
  }
  const mergedProgress = saveProgressMap(mergedProgressRaw, storage);

  // Merge queue (append non-duplicate valid tracks if local queue exists, or adopt imported currentEid)
  const localQueue = loadQueue(storage);
  const seenEids = new Set(localQueue.items.map((t) => t.eid));
  const mergedQueueItems = [...localQueue.items];
  if (Array.isArray(data.queue?.items)) {
    for (const t of data.queue.items) {
      if (t && typeof t.eid === "string" && t.eid && !seenEids.has(t.eid)) {
        seenEids.add(t.eid);
        mergedQueueItems.push(t);
      }
    }
  }
  const nextCurrentEid =
    localQueue.currentEid ||
    (typeof data.queue?.currentEid === "string" ? data.queue.currentEid : null) ||
    mergedQueueItems[0]?.eid ||
    null;
  saveQueue(mergedQueueItems, nextCurrentEid, storage);

  // Prefs: adopt imported prefs if provided
  const localPrefs = loadPrefs(storage);
  const nextPrefs = {
    playbackRate: PLAYBACK_RATES.includes(Number(data.prefs?.playbackRate))
      ? Number(data.prefs.playbackRate)
      : localPrefs.playbackRate,
    loopMode: LOOP_MODES.includes(data.prefs?.loopMode)
      ? data.prefs.loopMode
      : localPrefs.loopMode,
    theme:
      data.prefs?.theme === "dark" || data.prefs?.theme === "light"
        ? data.prefs.theme
        : localPrefs.theme,
  };
  savePrefs(nextPrefs, storage);

  return {
    favorites: mergedFavorites,
    progressMap: mergedProgress,
    queue: { items: mergedQueueItems, currentEid: nextCurrentEid },
    prefs: nextPrefs,
  };
}

function escapeXml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Export followed podcasts as an OPML 2.0 XML document.
 */
export function buildOpmlXml(favorites = []) {
  const list = Array.isArray(favorites) ? favorites : [];
  const nowUtc = new Date().toUTCString();
  const outlines = list
    .map((item) => {
      const title = escapeXml(item.title || "未命名播客");
      const htmlUrl = escapeXml(
        item.xyzUrl || `https://www.xiaoyuzhoufm.com/podcast/${item.pid}`
      );
      const xmlAttr = item.rssUrl ? ` type="rss" xmlUrl="${escapeXml(item.rssUrl)}"` : "";
      return `      <outline text="${title}" title="${title}"${xmlAttr} htmlUrl="${htmlUrl}" />`;
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    "  <head>",
    "    <title>小宇宙播客热榜 · 关注播客订阅导出</title>",
    `    <dateCreated>${escapeXml(nowUtc)}</dateCreated>`,
    "  </head>",
    "  <body>",
    '    <outline text="小宇宙关注播客" title="小宇宙关注播客">',
    outlines,
    "    </outline>",
    "  </body>",
    "</opml>",
    "",
  ].join("\n");
}
