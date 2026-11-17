import { fetchBoardsMeta } from "./api.js";
import { createOverlayHistory } from "./overlayHistory.js";
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
import AboutDialog from "./components/AboutDialog.js";
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
  scrollBehavior(to, from, savedPosition) {
    // Same-URL overlay history must not move the underlying page.
    if (to.fullPath === from.fullPath) return false;
    if (to.meta?.board || to.name === "PodcastView") {
      // RankBoard & PodcastView live inside <keep-alive> and restore their own scrollY
      return false;
    }
    if (savedPosition) return savedPosition;
    return { top: 0 };
  },
});

const AppRoot = {
  name: "XyzPodcastApp",
  components: {
    AppIcon,
    AboutDialog,
    PlayerBar,
    PlaylistDrawer,
  },
  data() {
    const prefs = loadPrefs();
    const queueData = loadQueue();
    const progressMap = loadProgressMap();

    return {
      searchQuery: "",
      searchOpen: false,
      aboutOpen: false,
      boardMeta: {},
      theme: prefs.theme,
      deferredInstallPrompt: null,
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
        setExpanded: this.setExpanded,
        setPlaylistOpen: this.setPlaylistOpen,
        navigateFromPlayer: this.navigateFromPlayer,
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
  watch: {
    "$route.fullPath"() {
      this.$nextTick(() => this.syncHeaderHeight());
    },
    syncBadgeText() {
      this.$nextTick(() => this.syncHeaderHeight());
    },
    deferredInstallPrompt() {
      this.$nextTick(() => this.syncHeaderHeight());
    },
  },
  mounted() {
    this._overlayHistory = createOverlayHistory(router, stack => {
      this.player.expanded = stack.includes("player") && this.hasCurrentTrack;
      this.player.playlistOpen = stack.includes("queue");
      this.aboutOpen = stack.includes("about");
    }, () => this.showToast("切换弹窗失败，请重试"));
    this._overlayHistory.sync();
    this.applyTheme();
    this.loadMeta();
    this.restoreCurrentTrackOnBoot();
    this.setupMediaSessionHandlers();
    this.registerPwa();
    this.initHeaderObserver();
    window.addEventListener("pagehide", this.flushProgressNow);
    window.addEventListener("beforeunload", this.flushProgressNow);
  },
  beforeUnmount() {
    this._overlayHistory?.destroy();
    this.flushProgressNow();
    this.destroyHeaderObserver();
    window.removeEventListener("pagehide", this.flushProgressNow);
    window.removeEventListener("beforeunload", this.flushProgressNow);
  },
  methods: {
    setAboutOpen(open) {
      if (!open) this.aboutOpen = false;
      return this._overlayHistory.set("about", Boolean(open));
    },
    setExpanded(open) {
      if (!open) this.player.expanded = false;
      return this._overlayHistory.set("player", Boolean(open));
    },
    setPlaylistOpen(open) {
      if (!open) this.player.playlistOpen = false;
      return this._overlayHistory.set("queue", Boolean(open));
    },
    navigateFromPlayer(path) {
      return this._overlayHistory.navigate(path);
    },
    finishPageLeave(_el, done) {
      // Remove the old view before Vue Router resets the document scroll position.
      done();
    },
    syncHeaderHeight() {
      const el = this.$refs.siteHeader;
      if (!el || typeof document === "undefined") return;
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 0) {
        document.documentElement.style.setProperty("--header-h", `${h}px`);
      }
    },
    initHeaderObserver() {
      this._headerResizeObserver = null;
      this.syncHeaderHeight();
      const el = this.$refs.siteHeader;
      if (el && typeof ResizeObserver !== "undefined") {
        this._headerResizeObserver = new ResizeObserver(() => this.syncHeaderHeight());
        this._headerResizeObserver.observe(el);
      }
      window.addEventListener("resize", this.syncHeaderHeight, { passive: true });
    },
    destroyHeaderObserver() {
      if (this._headerResizeObserver) {
        this._headerResizeObserver.disconnect();
        this._headerResizeObserver = null;
      }
      window.removeEventListener("resize", this.syncHeaderHeight);
    },
    onNavClick(path) {
      if (this.$route.path === path) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    onBoardTouchStart(event) {
      this._boardSwipe = null;
      if (!this.isBoardRoute || window.innerWidth >= 768 || event.touches.length !== 1 ||
          this.aboutOpen || this.player.expanded || this.player.playlistOpen) return;
      if (!event.target.closest('.rank-board') ||
          event.target.closest('button, a, input, select, textarea, [role="slider"]')) return;
      const touch = event.touches[0];
      // Leave native browser Back/Forward gestures at the screen edges alone.
      if (touch.clientX < 24 || touch.clientX > window.innerWidth - 24) return;
      this._boardSwipe = {
        x: touch.clientX, y: touch.clientY, started: performance.now(),
        path: this.$route.path, axis: null,
      };
    },
    onBoardTouchMove(event) {
      const swipe = this._boardSwipe;
      if (!swipe) return;
      if (event.touches.length !== 1) { this._boardSwipe = null; return; }
      const dx = Math.abs(event.touches[0].clientX - swipe.x);
      const dy = Math.abs(event.touches[0].clientY - swipe.y);
      if (!swipe.axis && Math.max(dx, dy) >= 12) {
        if (dx > dy * 1.5) swipe.axis = 'x';
        else { this._boardSwipe = null; return; }
      }
      if (swipe.axis === 'x' && event.cancelable) event.preventDefault();
    },
    onBoardTouchEnd(event) {
      const swipe = this._boardSwipe;
      this._boardSwipe = null;
      if (!swipe || swipe.axis !== 'x' || event.touches.length ||
          performance.now() - swipe.started > 700 || this.$route.path !== swipe.path ||
          window.innerWidth >= 768 || this.aboutOpen || this.player.expanded || this.player.playlistOpen) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - swipe.x;
      const dy = touch.clientY - swipe.y;
      if (Math.abs(dx) < 64 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
      this._boardSwipeClickUntil = performance.now() + 350;
      const index = BOARD_TABS.findIndex(tab => tab.path === swipe.path);
      const next = BOARD_TABS[index + (dx < 0 ? 1 : -1)];
      if (next) this.$router.push(next.path);
    },
    cancelBoardSwipe() {
      this._boardSwipe = null;
    },
    onBoardSwipeClick(event) {
      if (event.detail && performance.now() < this._boardSwipeClickUntil) {
        event.preventDefault();
        event.stopPropagation();
        this._boardSwipeClickUntil = 0;
      }
    },
    registerPwa() {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
      }
      window.addEventListener("beforeinstallprompt", (evt) => {
        evt.preventDefault();
        this.deferredInstallPrompt = evt;
      });
      window.addEventListener("appinstalled", () => {
        this.deferredInstallPrompt = null;
      });
    },
    async installPwa() {
      if (!this.deferredInstallPrompt) return;
      this.deferredInstallPrompt.prompt();
      await this.deferredInstallPrompt.userChoice.catch(() => {});
      this.deferredInstallPrompt = null;
    },
    async loadMeta() {
      try {
        this.boardMeta = await fetchBoardsMeta();
      } catch {
        // Non-blocking metadata call
      }
    },
    applyTheme() {
      document.documentElement.setAttribute("data-theme", this.theme);
      const color = this.theme === "dark" ? "#111114" : "#f7f4ec";
      const metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) metaTheme.setAttribute("content", color);
      const appleBar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
      if (appleBar) appleBar.setAttribute("content", this.theme === "dark" ? "black-translucent" : "default");
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
          this.setExpanded(false);
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
      this.setExpanded(false);
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
    <div class="app-shell" :class="{ 'has-player': hasCurrentTrack, 'detail-route': !isBoardRoute }">
      <header class="site-header" ref="siteHeader">
        <div class="container">
          <div class="header-top">
            <button type="button" class="brand" aria-label="关于小宇宙播客热榜" aria-haspopup="dialog" :aria-expanded="aboutOpen" @click="setAboutOpen(true)">
              <div class="brand-mark">
                <app-icon name="headphones" :size="18" />
              </div>
              <div style="min-width:0;">
                <div class="brand-title">小宇宙播客热榜</div>
                <div class="brand-sub" v-if="syncBadgeText" :title="syncBadgeText">{{ syncBadgeText }}</div>
              </div>
            </button>

            <div class="header-actions">
              <button v-if="isBoardRoute" type="button" class="icon-btn mobile-search-toggle" aria-label="搜索榜单" :aria-expanded="searchOpen || !!searchQuery" @click="searchOpen = !searchOpen; searchOpen && $nextTick(() => $refs.searchInput.focus())"><app-icon name="search" :size="17" /></button>
              <button
                v-if="deferredInstallPrompt"
                type="button"
                class="icon-btn"
                @click="installPwa"
                title="安装桌面应用"
              >
                <app-icon name="download" :size="15" />
                <span>安装</span>
              </button>

              <button
                type="button"
                class="icon-btn"
                @click="setPlaylistOpen(true)"
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

          <div class="header-controls" v-if="isBoardRoute">
            <nav class="board-tabs" aria-label="榜单切换">
              <router-link
                v-for="tab in boardTabs"
                :key="tab.path"
                :to="tab.path"
                class="board-tab"
                :class="{ active: $route.path === tab.path }"
                @click="onNavClick(tab.path)"
              >{{ tab.label }}</router-link>
            </nav>

            <div class="search-wrap" :class="{ 'search-open': searchOpen || searchQuery }" v-if="isBoardRoute">
              <app-icon name="search" :size="15" class="search-icon" />
              <input
                ref="searchInput"
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

      <main class="main-content" @touchstart.passive="onBoardTouchStart" @touchmove="onBoardTouchMove" @touchend.passive="onBoardTouchEnd" @touchcancel="cancelBoardSwipe" @click.capture="onBoardSwipeClick">
        <div class="container">
          <router-view v-slot="{ Component, route }">
            <transition name="page" mode="out-in" @leave="finishPageLeave"><keep-alive include="RankBoard,PodcastView" :max="8">
              <component
                :is="Component"
                :key="route.meta && route.meta.board ? 'board-' + route.meta.board : (route.name === 'PodcastView' ? 'podcast-' + route.params.pid : route.fullPath)"
                :search-query="searchQuery"
                :board-meta="boardMeta"
              />
            </keep-alive></transition>
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
      <about-dialog :open="aboutOpen" @close="setAboutOpen(false)" />

      <transition name="toast"><div v-if="toastMessage" class="toast-pill" role="status">{{ toastMessage }}</div></transition>
    </div>
  `,
};

const app = createApp(AppRoot);
// Keep keyboard focus inside the topmost dialog and restore it after leaving.
let dialogCount = 0;
let previousOverflow = "";
app.directive("dialog-focus", {
  mounted(el, binding) {
    const trigger = document.activeElement;
    if (dialogCount++ === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    const focusable = () => [...el.querySelectorAll('button:not(:disabled), a[href], input, select, [tabindex="0"]')].filter(n => n.getClientRects().length);
    el.tabIndex = -1;
    const focusTimer = setTimeout(() => (focusable()[0] || el).focus({ preventScroll: true }), 0);
    const onKey = event => {
      const dialogs = [...document.querySelectorAll('[aria-modal="true"]')];
      if (dialogs.at(-1) !== el) return;
      if (event.key === "Escape") { event.preventDefault(); binding.value(); }
      if (event.key === "Tab") {
        const nodes = focusable(), first = nodes[0], last = nodes.at(-1);
        if (!first) { event.preventDefault(); el.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    el._dialogCleanup = () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
      if (--dialogCount === 0) document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  },
  unmounted(el) { el._dialogCleanup?.(); },
});
app.directive("cover", {
  mounted(el) {
    el._coverError = () => {
      if (el.getAttribute("src") !== "/icon.svg") { el.src = "/icon.svg"; el.classList.add("cover-fallback"); }
    };
    el.addEventListener("error", el._coverError);
    if (!el.getAttribute("src") || (el.complete && !el.naturalWidth)) el._coverError();
  },
  updated(el) { if (el.complete && !el.naturalWidth) el._coverError(); },
  unmounted(el) { el.removeEventListener("error", el._coverError); },
});
app.use(router);
app.mount("#app");
