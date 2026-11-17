import test from "node:test";
import assert from "node:assert/strict";
import {
  computeVirtualWindow,
  formatCount,
  formatDurationSeconds,
  formatMinutes,
  formatPercent,
  injectTimestampButtons,
  parseTimestampToSeconds,
} from "../public/js/utils.js";
import {
  MAX_PROGRESS_ENTRIES,
  loadPrefs,
  loadProgressMap,
  loadQueue,
  resolveResumeSeconds,
  saveEpisodeProgress,
  savePrefs,
  saveQueue,
} from "../public/js/storage.js";

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
  };
}

test("utils formatting helpers produce expected strings", () => {
  assert.equal(formatDurationSeconds(65), "01:05");
  assert.equal(formatDurationSeconds(3661), "1:01:01");
  assert.equal(formatMinutes(78), "78′");
  assert.equal(formatCount(428803), "42.9万");
  assert.equal(formatCount(520), "520");
  assert.equal(formatPercent(0.1536), "15.4%");
});

test("parseTimestampToSeconds and injectTimestampButtons convert timestamps safely", () => {
  assert.equal(parseTimestampToSeconds("05:32"), 332);
  assert.equal(parseTimestampToSeconds("1:02:15"), 3735);
  assert.equal(parseTimestampToSeconds("12:99"), null);

  const html =
    '<p><a class="timestamp" data-timestamp="282">04:42</a> 谷雨推荐</p><p>05:32 讨论开始</p><p>链接 <a href="https://example.com/12:34">08:00</a> 不应替换</p><p data-time="01:00">1:02:15 结束</p>';
  const rendered = injectTimestampButtons(html);
  assert.match(rendered, /<button type="button" class="ts-jump-btn" data-seconds="282">04:42<\/button>/);
  assert.match(rendered, /<button type="button" class="ts-jump-btn" data-seconds="332">05:32<\/button>/);
  assert.match(rendered, /<button type="button" class="ts-jump-btn" data-seconds="3735">1:02:15<\/button>/);
  assert.match(rendered, /<a href="https:\/\/example\.com\/12:34">08:00<\/a>/);
  assert.match(rendered, /data-time="01:00"/);
});

test("storage queue and prefs persist and validate defaults", () => {
  const storage = createMemoryStorage();
  assert.deepEqual(loadQueue(storage), { items: [], currentEid: null });
  assert.deepEqual(loadPrefs(storage), {
    playbackRate: 1.0,
    loopMode: "sequential",
    theme: "light",
  });

  saveQueue([{ eid: "ep1", title: "Ep 1" }], "ep1", storage);
  assert.deepEqual(loadQueue(storage), {
    items: [{ eid: "ep1", title: "Ep 1" }],
    currentEid: "ep1",
  });

  savePrefs({ playbackRate: 1.5, loopMode: "repeat-all", theme: "dark" }, storage);
  assert.deepEqual(loadPrefs(storage), {
    playbackRate: 1.5,
    loopMode: "repeat-all",
    theme: "dark",
  });
});

test("storage progress enforces 200-entry eviction and resume thresholds", () => {
  const storage = createMemoryStorage();
  for (let i = 1; i <= MAX_PROGRESS_ENTRIES + 15; i += 1) {
    saveEpisodeProgress(
      `ep-${i}`,
      { currentTime: 100, duration: 1000, finished: false, updatedAt: i * 1000 },
      storage
    );
  }
  const map = loadProgressMap(storage);
  const keys = Object.keys(map);
  assert.equal(keys.length, MAX_PROGRESS_ENTRIES);
  assert.equal(Boolean(map["ep-1"]), false);
  assert.equal(Boolean(map[`ep-${MAX_PROGRESS_ENTRIES + 15}`]), true);

  assert.equal(resolveResumeSeconds({ currentTime: 3, duration: 600, finished: false }, 600), 0);
  assert.equal(resolveResumeSeconds({ currentTime: 597, duration: 600, finished: false }, 600), 0);
  assert.equal(resolveResumeSeconds({ currentTime: 120, duration: 600, finished: true }, 600), 0);
  assert.equal(resolveResumeSeconds({ currentTime: 120, duration: 600, finished: false }, 600), 120);
});

test("computeVirtualWindow slices large lists cleanly with custom height caches", () => {
  assert.deepEqual(computeVirtualWindow({ count: 0, scrollRelTop: 100, viewportHeight: 800 }), {
    startIndex: 0,
    endIndex: 0,
    topSpacerPx: 0,
    bottomSpacerPx: 0,
    totalHeight: 0,
  });

  // 8,191 items (podcasts board full size) mid-scroll
  const win = computeVirtualWindow({
    count: 8191,
    scrollRelTop: 50000,
    viewportHeight: 700,
    overscanPx: 400,
    defaultHeight: 100,
  });
  assert.equal(win.startIndex, 496);
  assert.equal(win.endIndex, 511);
  assert.equal(win.topSpacerPx, 49600);
  assert.equal(win.totalHeight, 819100);
  assert.equal(win.bottomSpacerPx, 819100 - 51100);

  // Mixed cached heights preserve exact spacer math
  const cache = { 0: 150, 1: 200, 2: 80 };
  const varWin = computeVirtualWindow({
    count: 5,
    scrollRelTop: 360,
    viewportHeight: 120,
    overscanPx: 0,
    defaultHeight: 100,
    heightCache: cache,
  });
  // offsets: [0, 150, 350, 430, 530, 630]; window [360, 480) -> items 2 (350..430) & 3 (430..530)
  assert.equal(varWin.startIndex, 2);
  assert.equal(varWin.endIndex, 4);
  assert.equal(varWin.topSpacerPx, 350);
  assert.equal(varWin.bottomSpacerPx, 100);
  assert.equal(varWin.totalHeight, 630);
});
