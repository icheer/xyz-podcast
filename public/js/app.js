import { fetchBoardsMeta } from "./api.js";
import {
  LOOP_MODES,
  loadPrefs,
  loadProgressMap,
  loadQueue,
  resolveResumeSeconds,
  saveEpisodeProgress,
  savePrefs,
  saveQueue,
} from "./storage.js";
import { formatDurationSeconds } from "./utils.js";
import AppIcon from "./components/AppIcon.js";
import EpisodeView from "./components/EpisodeView.js";
import PlayerBar from "./components/PlayerBar.js";
import PlaylistDrawer from "./components/PlaylistDrawer.js";
import PodcastView from "./components/PodcastView.js";
import RankBoard from "./components/RankBoard.js";

const { createApp } = window.Vue;
const { createRouter, createWebHistory } = window.VueRouter;

const BOARD_TABS = [
  { path: "/", board: "episodes", label: "热门节目" },
  { path: "/hot-podcasts", board: "podcasts", label: "热门播客" },
  { path: "/hot-episodes-new", board: "new-episodes", label: "新锐节目" },
  { path: "/new-podcasts", board: "new-podcasts", label: "新锐播客" },
];

const routes = [
  {
    path: "/",
    name: "Home",
    component: RankBoard,
    meta: { board: "episodes", columnType: "episode" },
  },
  {
    path: "/hot-podcasts",
    name: "HotPodcasts",
    component: RankBoard,
    meta: { board: "podcasts", columnType: "podcast" },
  },
  {
    path: "/hot-episodes-new",
    name: "HotEpisodesNew",
    component: RankBoard,
    meta: { board: "new-episodes", columnType: "episode" },
  },
  {
    path: "/new-podcasts",
    name: "NewPodcasts",
    component: RankBoard,
    meta: { board: "new-podcasts", columnType: "podcast" },
  },
  {
    path: "/podcast/:pid",
    name: "PodcastView",
    component: PodcastView,
  },
  {
    path: "/episode/:eid",
    name: "EpisodeView",
    component: EpisodeView,
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(_to, _from, savedPosition) {
    if (savedPosition) return savedPosition;
    return { top: 0 };
  },
});

const AppRoot = {
  name: "XyzPodcastApp",
  components: {
    AppIcon,
    PlayerBar,
    PlaylistDrawer,
  },
  data() {
    const prefs = loadPrefs();
    const queueData = loadQueue();
    const progressMap = loadProgressMap();

    return {
      searchQuery: "",
      boardMeta: {},
      theme: prefs.theme,
      toastMessage: "",
      toastTimer: null,
      pendingSeekSeconds: null,
      lastProgressSaveMs: 0,
      player: {
        queue: queueData.items,
        currentEid: queueData.currentEid,
        progressMap,
        isPlaying: false,
        isBuffering: false,
        currentTime: 0,
        duration: 0,
        playbackRate: prefs.playbackRate,
        loopMode: prefs.loopMode,
        expanded: false,
        playlistOpen: false,
      },
    };
  },
  provide() {
    return {
      player: this.player,
      playerActions: {
        getCurrentTrack: this.getCurrentTrack,
        playTrack: this.playTrack,
        enqueueTrack: this.enqueueTrack,
        enqueueMany: this.enqueueMany,
        removeFromQueue: this.removeFromQueue,
        clearQueue: this.clearQueue,
        reorderQueue: this.reorderQueue,
        togglePlay: this.togglePlay,
        seekTo: this.seekTo,
        skipBy: this.skipBy,
        setPlaybackRate: this.setPlaybackRate,
        cycleLoopMode: this.cycleLoopMode,
        playNext: this.playNext,
        playPrev: this.playPrev,
        setExpanded: (v) => {
          this.player.expanded = Boolean(v);
        },
        setPlaylistOpen: (v) => {
          this.player.playlistOpen = Boolean(v);
        },
        showToast: this.showToast,
      },
    };
  },
  computed: {
    boardTabs() {
      return BOARD_TABS;
    },
    isBoardRoute() {
      return Boolean(this.$route.meta?.board);
    },
    syncBadgeText() {
      const updated = this.boardMeta?.updatedAt;
      if (!updated) return "数据同步中";
      const d = new Date(updated);
      if (Number.isNaN(d.getTime())) return "";
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `更新于 ${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
    },
    hasCurrentTrack() {
      return Boolean(this.getCurrentTrack());
    },
  },
  mounted() {
    this.applyTheme();
    this.loadMeta();
    this.restoreCurrentTrackOnBoot();
    this.setupMediaSessionHandlers();
    window.addEventListener("pagehide", this.flushProgressNow);
    window.addEventListener("beforeunload", this.flushProgressNow);
  },
  beforeUnmount() {
    this.flushProgressNow();
    window.removeEventListener("pagehide", this.flushProgressNow);
    window.removeEventListener("beforeunload", this.flushProgressNow);
  },
  methods: {
    async loadMeta() {
      try {
        this.boardMeta = await fetchBoardsMeta();
      } catch {
        // Non-blocking metadata call
      }
    },
    applyTheme() {
      document.documentElement.setAttribute("data-theme", this.theme);
    },
    toggleTheme() {
      this.theme = this.theme === "dark" ? "light" : "dark";
      this.applyTheme();
      savePrefs({
        playbackRate: this.player.playbackRate,
        loopMode: this.player.loopMode,
        theme: this.theme,
      });
    },
    showToast(msg) {
      this.toastMessage = msg;
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        this.toastMessage = "";
      }, 2600);
    },
    getCurrentTrack() {
      if (!this.player.currentEid) return null;
      return this.player.queue.find((t) => t.eid === this.player.currentEid) || null;
    },
    restoreCurrentTrackOnBoot() {
      const track = this.getCurrentTrack();
      const audio = this.$refs.audioEl;
      if (!track || !audio || !track.enclosureUrl) return;
      const saved = this.player.progressMap[track.eid];
      const resumeAt = resolveResumeSeconds(saved, track.duration);
      this.pendingSeekSeconds = resumeAt > 0 ? resumeAt : null;
      this.player.currentTime = resumeAt;
      this.player.duration = track.duration || saved?.duration || 0;
      audio.src = track.enclosureUrl;
      audio.playbackRate = this.player.playbackRate;
      this.updateMediaSessionMetadata(track);
    },
    async playTrack(track, options = {}) {
      if (!track?.eid || !track.enclosureUrl) {
        this.showToast("暂无可用的音频流地址");
        return;
      }
      const audio = this.$refs.audioEl;
      if (!audio) return;

      this.flushProgressNow();

      const existsIdx = this.player.queue.findIndex((t) => t.eid === track.eid);
      if (existsIdx === -1) {
        const curIdx = this.player.queue.findIndex((t) => t.eid === this.player.currentEid);
        const insertAt = curIdx >= 0 ? curIdx + 1 : 0;
        const nextQueue = [...this.player.queue];
        nextQueue.splice(insertAt, 0, track);
        this.player.queue = nextQueue;
      } else {
        const nextQueue = [...this.player.queue];
        nextQueue[existsIdx] = { ...nextQueue[existsIdx], ...track };
        this.player.queue = nextQueue;
      }

      const isSameSrc = this.player.currentEid === track.eid && audio.src === track.enclosureUrl;
      this.player.currentEid = track.eid;
      saveQueue(this.player.queue, this.player.currentEid);

      let targetSeek = null;
      if (typeof options.seekTo === "number" && Number.isFinite(options.seekTo)) {
        targetSeek = Math.max(0, options.seekTo);
      } else if (!options.restart) {
        const saved = this.player.progressMap[track.eid];
        const resumeAt = resolveResumeSeconds(saved, track.duration);
        if (resumeAt > 0) {
          targetSeek = resumeAt;
          this.showToast(`已恢复至 ${formatDurationSeconds(resumeAt)}`);
        }
      }

      if (!isSameSrc) {
        this.pendingSeekSeconds = targetSeek;
        this.player.currentTime = targetSeek || 0;
        this.player.duration = track.duration || 0;
        this.player.isBuffering = true;
        audio.src = track.enclosureUrl;
        audio.load();
      } else if (targetSeek !== null) {
        audio.currentTime = targetSeek;
        this.player.currentTime = targetSeek;
      }

      if (targetSeek !== null) {
        this.persistProgress(false, true);
      }

      audio.playbackRate = this.player.playbackRate;
      this.updateMediaSessionMetadata(track);

      try {
        await audio.play();
      } catch {
        this.player.isPlaying = false;
        this.player.isBuffering = false;
      }
    },
    enqueueTrack(track) {
      if (!track?.eid) return;
      if (this.player.queue.some((t) => t.eid === track.eid)) {
        this.showToast("已在播放列表中");
        return;
      }
      this.player.queue = [...this.player.queue, track];
      if (!this.player.currentEid) {
        this.player.currentEid = track.eid;
        this.restoreCurrentTrackOnBoot();
      }
      saveQueue(this.player.queue, this.player.currentEid);
      this.showToast("已加入播放列表");
    },
    enqueueMany(tracks) {
      const existing = new Set(this.player.queue.map((t) => t.eid));
      const fresh = tracks.filter((t) => t?.eid && !existing.has(t.eid));
      if (fresh.length === 0) {
        this.showToast("这些单集都已在列表中");
        return;
      }
      this.player.queue = [...this.player.queue, ...fresh];
      if (!this.player.currentEid && this.player.queue[0]) {
        this.player.currentEid = this.player.queue[0].eid;
        this.restoreCurrentTrackOnBoot();
      }
      saveQueue(this.player.queue, this.player.currentEid);
      this.showToast(`已加入 ${fresh.length} 集到播放列表`);
    },
    removeFromQueue(eid) {
      const idx = this.player.queue.findIndex((t) => t.eid === eid);
      if (idx === -1) return;
      const nextQueue = this.player.queue.filter((t) => t.eid !== eid);
      this.player.queue = nextQueue;

      if (this.player.currentEid === eid) {
        const audio = this.$refs.audioEl;
        if (nextQueue.length === 0) {
          this.player.currentEid = null;
          this.player.isPlaying = false;
          this.player.expanded = false;
          if (audio) {
            audio.pause();
            audio.removeAttribute("src");
          }
        } else {
          const nextTrack = nextQueue[Math.min(idx, nextQueue.length - 1)];
          this.playTrack(nextTrack);
          return;
        }
      }
      saveQueue(this.player.queue, this.player.currentEid);
    },
    clearQueue() {
      const audio = this.$refs.audioEl;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
      }
      this.player.queue = [];
      this.player.currentEid = null;
      this.player.isPlaying = false;
      this.player.currentTime = 0;
      this.player.duration = 0;
      this.player.expanded = false;
      saveQueue([], null);
      this.showToast("已清空播放列表");
    },
    reorderQueue(fromIndex, toIndex) {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= this.player.queue.length ||
        toIndex >= this.player.queue.length ||
        fromIndex === toIndex
      ) {
        return;
      }
      const next = [...this.player.queue];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      this.player.queue = next;
      saveQueue(this.player.queue, this.player.currentEid);
    },
    async togglePlay() {
      const audio = this.$refs.audioEl;
      const track = this.getCurrentTrack();
      if (!audio || !track) return;
      if (!audio.src && track.enclosureUrl) {
        await this.playTrack(track);
        return;
      }
      if (audio.paused) {
        try {
          await audio.play();
        } catch {
          this.showToast("播放被浏览器阻止或音频加载失败");
        }
      } else {
        audio.pause();
      }
    },
    seekTo(seconds) {
      const audio = this.$refs.audioEl;
      if (!audio) return;
      const dur = Number.isFinite(audio.duration) ? audio.duration : this.player.duration;
      const clamped = Math.max(0, Math.min(dur || seconds, Number(seconds) || 0));
      if (audio.readyState >= 1) {
        audio.currentTime = clamped;
      } else {
        this.pendingSeekSeconds = clamped;
      }
      this.player.currentTime = clamped;
      this.persistProgress(false, true);
    },
    skipBy(deltaSeconds) {
      const audio = this.$refs.audioEl;
      const base = audio && audio.readyState >= 1 ? audio.currentTime : this.player.currentTime;
      this.seekTo(base + deltaSeconds);
    },
    setPlaybackRate(rate) {
      this.player.playbackRate = rate;
      const audio = this.$refs.audioEl;
      if (audio) audio.playbackRate = rate;
      savePrefs({
        playbackRate: this.player.playbackRate,
        loopMode: this.player.loopMode,
        theme: this.theme,
      });
      this.showToast(`倍速切换为 ${rate}x`);
    },
    cycleLoopMode() {
      const idx = LOOP_MODES.indexOf(this.player.loopMode);
      const next = LOOP_MODES[(idx + 1) % LOOP_MODES.length];
      this.player.loopMode = next;
      savePrefs({
        playbackRate: this.player.playbackRate,
        loopMode: this.player.loopMode,
        theme: this.theme,
      });
      const labels = {
        sequential: "顺序播放",
        "repeat-all": "列表循环",
        "repeat-one": "单曲循环",
      };
      this.showToast(labels[next]);
    },
    playNext() {
      const len = this.player.queue.length;
      if (len === 0) return;
      const idx = this.player.queue.findIndex((t) => t.eid === this.player.currentEid);
      if (idx + 1 < len) {
        this.playTrack(this.player.queue[idx + 1]);
      } else if (this.player.loopMode === "repeat-all") {
        this.playTrack(this.player.queue[0]);
      } else {
        this.showToast("已是最后一集");
      }
    },
    playPrev() {
      const len = this.player.queue.length;
      if (len === 0) return;
      const idx = this.player.queue.findIndex((t) => t.eid === this.player.currentEid);
      if (idx > 0) {
        this.playTrack(this.player.queue[idx - 1]);
      } else if (this.player.loopMode === "repeat-all") {
        this.playTrack(this.player.queue[len - 1]);
      } else {
        this.seekTo(0);
      }
    },
    persistProgress(finished = false, force = false) {
      const eid = this.player.currentEid;
      if (!eid) return;
      const now = Date.now();
      if (!force && now - this.lastProgressSaveMs < 3000) return;
      this.lastProgressSaveMs = now;
      this.player.progressMap = saveEpisodeProgress(eid, {
        currentTime: this.player.currentTime,
        duration: this.player.duration,
        finished,
        updatedAt: now,
      });
    },
    flushProgressNow() {
      if (this.player.currentEid && this.player.currentTime > 0) {
        this.persistProgress(false, true);
      }
    },
    onAudioLoadedMetadata() {
      const audio = this.$refs.audioEl;
      if (!audio) return;
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        this.player.duration = audio.duration;
      }
      audio.playbackRate = this.player.playbackRate;
      if (this.pendingSeekSeconds !== null) {
        const maxDur = Number.isFinite(audio.duration) ? audio.duration : this.pendingSeekSeconds;
        audio.currentTime = Math.min(this.pendingSeekSeconds, Math.max(0, maxDur - 1));
        this.player.currentTime = audio.currentTime;
        this.pendingSeekSeconds = null;
      }
    },
    onAudioTimeUpdate() {
      const audio = this.$refs.audioEl;
      if (!audio) return;
      this.player.currentTime = audio.currentTime || 0;
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        this.player.duration = audio.duration;
      }
      this.persistProgress(false, false);
    },
    onAudioEnded() {
      this.player.isPlaying = false;
      if (this.player.loopMode === "repeat-one") {
        const audio = this.$refs.audioEl;
        if (audio) {
          audio.currentTime = 0;
          audio.play().catch(() => {});
        }
        return;
      }
      this.persistProgress(true, true);
      const idx = this.player.queue.findIndex((t) => t.eid === this.player.currentEid);
      if (idx >= 0 && idx + 1 < this.player.queue.length) {
        this.playTrack(this.player.queue[idx + 1]);
      } else if (this.player.loopMode === "repeat-all" && this.player.queue.length > 0) {
        this.playTrack(this.player.queue[0]);
      }
    },
    onAudioError() {
      if (!this.player.currentEid || !this.$refs.audioEl?.getAttribute("src")) {
        return;
      }
      this.player.isPlaying = false;
      this.player.isBuffering = false;
      this.showToast("音频加载失败，请检查网络或前往小宇宙官网试听");
    },
    updateMediaSessionMetadata(track) {
      if (typeof navigator === "undefined" || !("mediaSession" in navigator) || !window.MediaMetadata) {
        return;
      }
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: track.title || "",
        artist: track.podcastName || "小宇宙播客",
        artwork: track.image ? [{ src: track.image, sizes: "512x512", type: "image/jpeg" }] : [],
      });
    },
    setupMediaSessionHandlers() {
      if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
      const ms = navigator.mediaSession;
      const safeSet = (action, fn) => {
        try { ms.setActionHandler(action, fn); } catch {}
      };
      safeSet("play", () => this.togglePlay());
      safeSet("pause", () => this.togglePlay());
      safeSet("seekbackward", () => this.skipBy(-15));
      safeSet("seekforward", () => this.skipBy(30));
      safeSet("previoustrack", () => this.playPrev());
      safeSet("nexttrack", () => this.playNext());
      safeSet("seekto", (d) => {
        if (typeof d?.seekTime === "number") this.seekTo(d.seekTime);
      });
    },
  },
  template: `
    <div class="app-shell" :class="{ 'has-player': hasCurrentTrack }">
      <header class="site-header">
        <div class="container">
          <div class="header-top">
            <router-link to="/" class="brand">
              <div class="brand-mark">
                <app-icon name="headphones" :size="18" />
              </div>
              <div style="min-width:0;">
                <div class="brand-title">小宇宙热榜收听</div>
                <div class="brand-sub" v-if="syncBadgeText">{{ syncBadgeText }}</div>
              </div>
            </router-link>

            <div class="header-actions">
              <button
                type="button"
                class="icon-btn"
                @click="player.playlistOpen = true"
                title="打开播放列表"
              >
                <app-icon name="list-music" :size="16" />
                <span class="tabular">{{ player.queue.length }}</span>
              </button>

              <button
                type="button"
                class="icon-btn"
                @click="toggleTheme"
                :title="theme === 'dark' ? '切换浅色模式' : '切换深色模式'"
              >
                <app-icon :name="theme === 'dark' ? 'sun' : 'moon'" :size="16" />
              </button>
            </div>
          </div>

          <div class="header-controls">
            <nav class="board-tabs" aria-label="榜单切换">
              <router-link
                v-for="tab in boardTabs"
                :key="tab.path"
                :to="tab.path"
                class="board-tab"
                :class="{ active: $route.path === tab.path }"
              >{{ tab.label }}</router-link>
            </nav>

            <div class="search-wrap" v-if="isBoardRoute">
              <app-icon name="search" :size="15" class="search-icon" />
              <input
                v-model="searchQuery"
                type="search"
                class="search-input"
                placeholder="搜索单集、播客、主播或分类..."
                aria-label="搜索榜单"
              />
              <button
                v-if="searchQuery"
                type="button"
                class="search-clear"
                @click="searchQuery = ''"
                aria-label="清空搜索"
              >
                <app-icon name="x" :size="14" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main class="main-content">
        <div class="container">
          <router-view v-slot="{ Component }">
            <component
              :is="Component"
              :search-query="searchQuery"
              :board-meta="boardMeta"
            />
          </router-view>
        </div>
      </main>

      <audio
        ref="audioEl"
        preload="metadata"
        @loadedmetadata="onAudioLoadedMetadata"
        @playing="player.isPlaying = true; player.isBuffering = false"
        @pause="player.isPlaying = false; persistProgress(false, true)"
        @waiting="player.isBuffering = true"
        @canplay="player.isBuffering = false"
        @seeked="persistProgress(false, true)"
        @timeupdate="onAudioTimeUpdate"
        @ended="onAudioEnded"
        @error="onAudioError"
      ></audio>

      <player-bar />
      <playlist-drawer />

      <div v-if="toastMessage" class="toast-pill" role="status">{{ toastMessage }}</div>
    </div>
  `,
};

const app = createApp(AppRoot);
app.use(router);
app.mount("#app");
