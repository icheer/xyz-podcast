import test from "node:test";
import assert from "node:assert/strict";
import {
  computeProgressPercent,
  computeVirtualWindow,
  formatCount,
  formatDurationSeconds,
  formatMinutes,
  formatPercent,
  formatProgressBadge,
  injectTimestampButtons,
  inlineConfirmMixin,
  parseTextWithTimestamps,
  parseTimestampToSeconds,
  shouldIgnoreGlobalHotkey,
} from "../public/js/utils.js";
import {
  MAX_PROGRESS_ENTRIES,
  buildOpmlXml,
  clearAllProgress,
  exportUserDataObject,
  extractRssUrlFromLinks,
  loadFavorites,
  loadPrefs,
  loadProgressMap,
  loadQueue,
  parseAndMergeBackupJson,
  removeEpisodeProgress,
  resolveResumeSeconds,
  saveEpisodeProgress,
  savePrefs,
  saveQueue,
  toggleFavoritePodcast,
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
  assert.equal(formatProgressBadge(null, 600), "");
  assert.equal(formatProgressBadge({ currentTime: 3, duration: 600, finished: false }), "");
  assert.equal(formatProgressBadge({ currentTime: 180, duration: 600, finished: false }), "已听 30%");
  assert.equal(
    formatProgressBadge({ currentTime: 180, duration: 600, finished: false }, 600, { includeTime: true }),
    "已听 30% (03:00)"
  );
  assert.equal(formatProgressBadge({ currentTime: 0, duration: 600, finished: true }), "已播完");
  assert.equal(computeProgressPercent(null, 600), 0);
  assert.equal(computeProgressPercent({ currentTime: 4, duration: 600, finished: false }), 0);
  assert.equal(computeProgressPercent({ currentTime: 150, duration: 600, finished: false }), 25);
  assert.equal(computeProgressPercent({ currentTime: 599, duration: 600, finished: false }), 99.5);
  assert.equal(computeProgressPercent({ currentTime: 0, duration: 600, finished: true }), 100);
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

test("legacy playback speeds migrate from saved preferences and backups", () => {
  const storage = createMemoryStorage();
  storage.setItem("xyzp_v1_prefs", '{"playbackRate":0.75}');
  assert.equal(loadPrefs(storage).playbackRate, 0.9);

  const backup = exportUserDataObject(storage);
  backup.prefs.playbackRate = 1.25;
  parseAndMergeBackupJson(JSON.stringify(backup), storage);
  assert.equal(loadPrefs(storage).playbackRate, 1.3);

  backup.prefs.playbackRate = 1.2;
  parseAndMergeBackupJson(JSON.stringify(backup), storage);
  assert.equal(loadPrefs(storage).playbackRate, 1.2);
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

test("parseTextWithTimestamps splits comment timestamps safely and respects maxSeconds", () => {
  assert.deepEqual(parseTextWithTimestamps(""), []);
  assert.deepEqual(parseTextWithTimestamps("纯文本评论无时间戳"), [
    { type: "text", text: "纯文本评论无时间戳" },
  ]);

  const segs = parseTextWithTimestamps("空降 04:42 太好笑了，1:02:15 总结到位，12:99 无效", 4000);
  assert.deepEqual(segs, [
    { type: "text", text: "空降 " },
    { type: "ts", text: "04:42", seconds: 282 },
    { type: "text", text: " 太好笑了，" },
    { type: "ts", text: "1:02:15", seconds: 3735 },
    { type: "text", text: " 总结到位，12:99 无效" },
  ]);

  // Clock time exceeding episode duration (e.g., 23:30 = 1410s on a 600s episode) stays plain text
  const bounded = parseTextWithTimestamps("02:10 亮点，晚上 23:30 打卡", 600);
  assert.deepEqual(bounded, [
    { type: "ts", text: "02:10", seconds: 130 },
    { type: "text", text: " 亮点，晚上 23:30 打卡" },
  ]);
});

test("favorites, rich history metadata, JSON backup merge, and OPML export work end-to-end", () => {
  const storage = createMemoryStorage();

  // Extract RSS URL from xyzrank links
  const links = [
    { name: "xyz", url: "https://www.xiaoyuzhoufm.com/podcast/6021f949a789fca4eff4492c" },
    { name: "rss", url: "https://feed.xyzfm.space/abc123" },
  ];
  assert.equal(extractRssUrlFromLinks(links), "https://feed.xyzfm.space/abc123");

  // Follow & unfollow podcast
  const res1 = toggleFavoritePodcast(
    {
      pid: "6021f949a789fca4eff4492c",
      name: "无人知晓 & 孟岩",
      authorsText: "孟岩",
      logoURL: "https://img.test/cover.jpg",
      links,
      addedAt: 1000,
    },
    storage
  );
  assert.equal(res1.added, true);
  assert.equal(res1.favorites.length, 1);
  assert.equal(res1.favorites[0].rssUrl, "https://feed.xyzfm.space/abc123");

  // Save rich progress metadata and retain it across subsequent timeupdate saves
  saveEpisodeProgress(
    "65a1b2c3d4e5f6a7b8c9d0e1",
    {
      currentTime: 180,
      duration: 1800,
      finished: false,
      updatedAt: 2000,
      meta: {
        title: "E01 投资与生活",
        podcastName: "无人知晓 & 孟岩",
        pid: "6021f949a789fca4eff4492c",
        image: "https://img.test/ep1.jpg",
        enclosureUrl: "https://media.xyzcdn.net/ep1.m4a",
      },
    },
    storage
  );
  // Subsequent save without meta preserves existing metadata
  const mapAfterUpdate = saveEpisodeProgress(
    "65a1b2c3d4e5f6a7b8c9d0e1",
    { currentTime: 420, duration: 1800, finished: false, updatedAt: 5000 },
    storage
  );
  assert.equal(mapAfterUpdate["65a1b2c3d4e5f6a7b8c9d0e1"].title, "E01 投资与生活");
  assert.equal(mapAfterUpdate["65a1b2c3d4e5f6a7b8c9d0e1"].currentTime, 420);

  // OPML export escapes XML entities and includes xmlUrl + htmlUrl
  const opml = buildOpmlXml(loadFavorites(storage));
  assert.match(opml, /<opml version="2\.0">/);
  assert.match(opml, /text="无人知晓 &amp; 孟岩"/);
  assert.match(opml, /xmlUrl="https:\/\/feed\.xyzfm\.space\/abc123"/);
  assert.match(opml, /htmlUrl="https:\/\/www\.xiaoyuzhoufm\.com\/podcast\/6021f949a789fca4eff4492c"/);

  // Export JSON backup and merge into a second device with newer/older conflicting records
  const backupJson = JSON.stringify(exportUserDataObject(storage));
  const targetStorage = createMemoryStorage();
  toggleFavoritePodcast(
    { pid: "6132a858b890edb5f005503d", title: "知行小酒馆", addedAt: 3000 },
    targetStorage
  );
  // Newer local progress on target device should NOT be overwritten by older backup progress
  saveEpisodeProgress(
    "65a1b2c3d4e5f6a7b8c9d0e1",
    { currentTime: 900, duration: 1800, finished: false, updatedAt: 9000 },
    targetStorage
  );

  const merged = parseAndMergeBackupJson(backupJson, targetStorage);
  assert.equal(merged.favorites.length, 2);
  assert.equal(merged.progressMap["65a1b2c3d4e5f6a7b8c9d0e1"].currentTime, 900);
  // Metadata from backup is preserved even when local timestamp won
  assert.equal(merged.progressMap["65a1b2c3d4e5f6a7b8c9d0e1"].title, "E01 投资与生活");

  // Invalid JSON throws descriptive error
  assert.throws(() => parseAndMergeBackupJson("{bad json", targetStorage), /无效的 JSON/);

  // Remove single & clear all progress
  removeEpisodeProgress("65a1b2c3d4e5f6a7b8c9d0e1", targetStorage);
  assert.equal(Boolean(loadProgressMap(targetStorage)["65a1b2c3d4e5f6a7b8c9d0e1"]), false);
  clearAllProgress(storage);
  assert.deepEqual(loadProgressMap(storage), {});
});

test("shouldIgnoreGlobalHotkey guards typing, modifiers, IME, and focused interactive buttons", () => {
  // Allowed on document body
  assert.equal(
    shouldIgnoreGlobalHotkey({ key: " ", code: "Space", target: { tagName: "BODY" } }),
    false
  );
  assert.equal(
    shouldIgnoreGlobalHotkey({ key: "ArrowRight", target: { tagName: "DIV" } }),
    false
  );
  assert.equal(
    shouldIgnoreGlobalHotkey({ key: "[", target: { tagName: "MAIN" } }),
    false
  );

  // Ignored inside inputs/textareas/selects/contentEditable
  assert.equal(
    shouldIgnoreGlobalHotkey({ key: " ", target: { tagName: "INPUT" } }),
    true
  );
  assert.equal(
    shouldIgnoreGlobalHotkey({ key: "/", target: { tagName: "TEXTAREA" } }),
    true
  );
  assert.equal(
    shouldIgnoreGlobalHotkey({ key: "m", target: { tagName: "DIV", isContentEditable: true } }),
    true
  );

  // Ignored with Ctrl/Meta/Alt or IME composition
  assert.equal(
    shouldIgnoreGlobalHotkey({ key: "ArrowLeft", metaKey: true, target: { tagName: "BODY" } }),
    true
  );
  assert.equal(
    shouldIgnoreGlobalHotkey({ key: " ", isComposing: true, target: { tagName: "BODY" } }),
    true
  );

  // Space ignored on focused BUTTON or inside [role="link"] card, while ArrowRight still works
  const buttonChild = {
    tagName: "SPAN",
    closest: (sel) => (sel.includes("button") ? {} : null),
  };
  assert.equal(shouldIgnoreGlobalHotkey({ key: " ", target: { tagName: "BUTTON" } }), true);
  assert.equal(shouldIgnoreGlobalHotkey({ key: " ", target: buttonChild }), true);
  assert.equal(shouldIgnoreGlobalHotkey({ key: "ArrowRight", target: buttonChild }), false);
});

test("inlineConfirmMixin arms on first click, executes on second click, and disarms on outside tap or timeout", async () => {
  const ctx = {
    ...inlineConfirmMixin.data(),
    ...inlineConfirmMixin.methods,
  };
  let executed = 0;

  // First click only arms confirmation
  const first = ctx.triggerInlineClearConfirm(() => {
    executed += 1;
  }, 50);
  assert.equal(first, false);
  assert.equal(ctx.confirmingClear, true);
  assert.equal(executed, 0);

  // Tapping outside [data-clear-confirm] disarms immediately
  ctx.onConfirmScopePointerDown({ target: { closest: () => null } });
  assert.equal(ctx.confirmingClear, false);

  // Arm again -> second click executes and resets state
  ctx.triggerInlineClearConfirm(() => {
    executed += 1;
  }, 50);
  assert.equal(ctx.confirmingClear, true);
  const second = ctx.triggerInlineClearConfirm(() => {
    executed += 1;
  }, 50);
  assert.equal(second, true);
  assert.equal(ctx.confirmingClear, false);
  assert.equal(executed, 1);

  // Auto-disarms after timeout if not clicked a second time
  ctx.triggerInlineClearConfirm(() => {
    executed += 1;
  }, 25);
  assert.equal(ctx.confirmingClear, true);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(ctx.confirmingClear, false);
  assert.equal(executed, 1);
});
