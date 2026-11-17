const KEYS = {
  QUEUE: "xyzp_v1_queue",
  PROGRESS: "xyzp_v1_progress",
  PREFS: "xyzp_v1_prefs",
};

export const MAX_PROGRESS_ENTRIES = 200;
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
  const theme = data.theme === "dark" ? "dark" : "light";
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

export function getEpisodeProgress(eid, storage = defaultStorage()) {
  if (!eid) return null;
  const map = loadProgressMap(storage);
  return map[eid] || null;
}

/**
 * Persist playback progress for an episode, evicting oldest entries beyond MAX_PROGRESS_ENTRIES.
 */
export function saveEpisodeProgress(
  eid,
  { currentTime, duration, finished = false, updatedAt = Date.now() },
  storage = defaultStorage()
) {
  if (!eid) return {};
  const map = loadProgressMap(storage);
  map[eid] = {
    currentTime: Math.max(0, Number(currentTime) || 0),
    duration: Math.max(0, Number(duration) || 0),
    finished: Boolean(finished),
    updatedAt: Number(updatedAt) || Date.now(),
  };

  const entries = Object.entries(map);
  if (entries.length > MAX_PROGRESS_ENTRIES) {
    entries.sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0));
    const trimmed = Object.fromEntries(entries.slice(0, MAX_PROGRESS_ENTRIES));
    writeJson(storage, KEYS.PROGRESS, trimmed);
    return trimmed;
  }

  writeJson(storage, KEYS.PROGRESS, map);
  return map;
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
