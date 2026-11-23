import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../public/js/api.js";
import * as overlayHistory from "../public/js/overlayHistory.js";
import * as storage from "../public/js/storage.js";
import * as utils from "../public/js/utils.js";

// The root component mounts itself when imported, so its methods are loaded
// from source and driven with a fake <audio> element and a fake localStorage.
const START_MARK = "\n  methods: {\n";
const END_MARK = "\n  },\n  template: `";

const memory = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  },
  addEventListener() {},
  removeEventListener() {},
};

function loadRootMethods() {
  const source = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");
  const start = source.indexOf(START_MARK);
  const end = source.indexOf(END_MARK, start);
  assert.notEqual(start, -1, "could not find the root component's methods block in app.js");
  assert.notEqual(end, -1, "could not find the end of the methods block in app.js");
  const deps = { ...storage, ...utils, ...api, ...overlayHistory };
  return new Function(...Object.keys(deps), `return {${source.slice(start + START_MARK.length, end)}};`)(
    ...Object.values(deps)
  );
}

const methods = loadRootMethods();
const settle = () => new Promise((resolve) => setImmediate(resolve));
const track = (eid) => ({
  eid,
  pid: `pod-${eid}`,
  title: `Episode ${eid}`,
  podcastName: "Podcast",
  image: "",
  duration: 600,
  enclosureUrl: `https://media.example/${eid}.m4a`,
});

/** The root component's real methods bound to a minimal fake of their surroundings. */
function createHarness({ queue, currentEid, currentTime = 0, duration = 0, paused = true, ended = false }) {
  const toasts = [];
  const calls = [];
  const audio = {
    src: "",
    currentTime,
    duration,
    paused,
    ended,
    playbackRate: 1,
    muted: false,
    calls,
    load() {
      calls.push("load");
      audio.ended = false;
    },
    pause() {
      calls.push("pause");
      audio.paused = true;
    },
    async play() {
      calls.push("play");
      audio.paused = false;
      audio.ended = false;
    },
    removeAttribute(name) {
      if (name === "src") audio.src = "";
    },
    getAttribute(name) {
      return name === "src" ? audio.src : null;
    },
  };
  const ctx = { ...methods };
  for (const name of Object.keys(methods)) ctx[name] = methods[name].bind(ctx);
  ctx.$refs = { audioEl: audio };
  ctx.player = {
    queue,
    currentEid,
    progressMap: storage.loadProgressMap(),
    favorites: [],
    isPlaying: !paused,
    isBuffering: false,
    isMuted: false,
    currentTime,
    duration,
    playbackRate: 1,
    loopMode: "sequential",
    sleepMode: "off",
  };
  ctx.showToast = (message) => toasts.push(message);
  ctx.setExpanded = () => {};
  const current = queue.find((item) => item.eid === currentEid);
  audio.src = current?.enclosureUrl || "";
  return { ctx, audio, toasts };
}

function savedProgress(eid) {
  const entry = storage.loadProgressMap()[eid];
  return entry && { currentTime: entry.currentTime, duration: entry.duration, finished: entry.finished };
}

test("an episode that ends and moves on to the next one stays marked as finished", async () => {
  const a = track("a");
  const b = track("b");
  const { ctx, audio } = createHarness({ queue: [a, b], currentEid: "a", currentTime: 600, duration: 600, ended: true });

  ctx.onAudioEnded();
  await settle();

  assert.deepEqual(savedProgress("a"), { currentTime: 600, duration: 600, finished: true });
  assert.equal(ctx.player.currentEid, "b");
  assert.equal(audio.src, b.enclosureUrl);
  assert.deepEqual(audio.calls, ["load", "play"], "the next episode starts playing");
});

test("leaving the page after the last episode ends keeps it marked as finished", async () => {
  const { ctx } = createHarness({ queue: [track("a")], currentEid: "a", currentTime: 600, duration: 600, ended: true });

  ctx.onAudioEnded();
  await settle();
  // pagehide / beforeunload flush the progress of the current episode.
  ctx.flushProgressNow();

  assert.deepEqual(savedProgress("a"), { currentTime: 600, duration: 600, finished: true });
});

test("removing the current episode while paused loads the next one without playing it", async () => {
  const a = track("a");
  const b = track("b");
  const { ctx, audio } = createHarness({ queue: [a, b], currentEid: "a", currentTime: 120, duration: 600, paused: true });

  await ctx.removeFromQueue("a");
  await settle();

  assert.equal(ctx.player.currentEid, "b");
  assert.deepEqual(ctx.player.queue.map((item) => item.eid), ["b"]);
  assert.equal(audio.src, b.enclosureUrl);
  assert.ok(audio.calls.includes("load"), "the next episode is loaded");
  assert.ok(!audio.calls.includes("play"), "a paused player must not start playing");
  assert.equal(audio.paused, true);
  assert.equal(ctx.player.isPlaying, false);
  assert.equal(ctx.player.isBuffering, false, "the play button is shown, not a spinner");
});

test("removing the current episode while playing starts the next one", async () => {
  const a = track("a");
  const b = track("b");
  const { ctx, audio } = createHarness({ queue: [a, b], currentEid: "a", currentTime: 120, duration: 600, paused: false });

  await ctx.removeFromQueue("a");
  await settle();

  assert.equal(ctx.player.currentEid, "b");
  assert.deepEqual(audio.calls, ["load", "play"]);
  assert.equal(audio.paused, false);
});

test("switching to another episode in the middle saves the position without marking it finished", async () => {
  const a = track("a");
  const b = track("b");
  const { ctx, audio } = createHarness({ queue: [a, b], currentEid: "a", currentTime: 120, duration: 600, paused: false });

  await ctx.playTrack(b, { moveToFront: true });

  assert.deepEqual(savedProgress("a"), { currentTime: 120, duration: 600, finished: false });
  assert.deepEqual(ctx.player.queue.map((item) => item.eid), ["b", "a"]);
  assert.deepEqual(audio.calls, ["load", "play"]);
});
