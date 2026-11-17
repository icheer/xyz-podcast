import { fetchBoard, fetchEpisodeDetail } from "../api.js";
import {
  computeVirtualWindow,
  formatCount,
  formatMinutes,
  formatPercent,
  formatRelativeDays,
  scrollKeeperMixin,
} from "../utils.js";
import AppIcon from "./AppIcon.js";

const MOBILE_ROW_DEFAULT_HEIGHT = 128;
const DESKTOP_ROW_DEFAULT_HEIGHT = 70;
const VIRTUAL_OVERSCAN_PX = 520;

const EPISODE_SORTS = [
  { key: "rank", label: "默认排名" },
  { key: "playCount", label: "播放量" },
  { key: "commentCount", label: "评论量" },
  { key: "interactiveRate", label: "互动率" },
  { key: "openRate", label: "打开率" },
  { key: "duration", label: "时长" },
  { key: "postTime", label: "发布时间" },
];

const PODCAST_SORTS = [
  { key: "rank", label: "默认排名" },
  { key: "avgPlayCount", label: "平均播放" },
  { key: "avgCommentCount", label: "平均评论" },
  { key: "avgInteractIndicator", label: "千播互动" },
  { key: "avgOpenRate", label: "平均打开率" },
  { key: "avgUpdateFreq", label: "更新频率" },
  { key: "lastReleaseDateDayCount", label: "最近更新" },
  { key: "trackCount", label: "总集数" },
  { key: "avgDuration", label: "平均时长" },
];

export default {
  name: "RankBoard",
  components: { AppIcon },
  mixins: [scrollKeeperMixin],
  inject: ["player", "playerActions"],
  props: {
    searchQuery: { type: String, default: "" },
    boardMeta: { type: Object, default: () => ({}) },
  },
  created() {
    this._mobileHeights = Object.create(null);
    this._desktopHeights = Object.create(null);
    this._vScrollRaf = 0;
    this._vScrollHandler = null;
    this._vResizeHandler = null;
    this._lastViewportWidth = typeof window !== "undefined" ? window.innerWidth : 0;
  },
  data() {
    return {
      items: [],
      total: 0,
      offset: 0,
      limit: 40,
      sortField: "rank",
      sortDir: "asc",
      selectedGenre: "all",
      medianValues: {},
      loading: false,
      noMore: false,
      fetched: false,
      errorMsg: "",
      fetchGen: 0,
      busyMap: {},
      observer: null,
      searchTimer: null,
      lastFetchedQuery: "",
      isDesktop: typeof window !== "undefined" ? window.innerWidth >= 768 : false,
      vStart: 0,
      vEnd: 24,
      virtualTopPx: 0,
      virtualBottomPx: 0,
    };
  },
  computed: {
    boardKey() {
      return this.$route.meta.board || "episodes";
    },
    isEpisodeBoard() {
      return this.$route.meta.columnType === "episode";
    },
    sortOptions() {
      return this.isEpisodeBoard ? EPISODE_SORTS : PODCAST_SORTS;
    },
    genreOptions() {
      const info = this.boardMeta?.boards?.[this.boardKey];
      return Array.isArray(info?.genres) ? info.genres : [];
    },
    visibleEntries() {
      const len = this.items.length;
      if (len === 0) return [];
      const start = Math.max(0, Math.min(this.vStart, len));
      const end = Math.max(start, Math.min(this.vEnd, len));
      const slice = [];
      for (let i = start; i < end; i += 1) {
        const item = this.items[i];
        slice.push({
          index: i,
          item,
          key: item.eid || item.id || `row-${i}`,
        });
      }
      return slice;
    },
  },
  watch: {
    searchQuery() {
      if (!this.isKeepAliveActive) return;
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
        this.lastFetchedQuery = this.searchQuery;
        this.resetAndFetch();
      }, 380);
    },
  },
  mounted() {
    this.lastFetchedQuery = this.searchQuery;
    this.attachVirtualListeners();
    this.resetAndFetch();
    this.setupObserver();
  },
  beforeUnmount() {
    this.detachVirtualListeners();
    if (this.observer) this.observer.disconnect();
    if (this.searchTimer) clearTimeout(this.searchTimer);
  },
  methods: {
    onKeepAliveActivated() {
      this.syncResponsiveMode();
      this.attachVirtualListeners();
      this.setupObserver();
      if (this.searchQuery !== this.lastFetchedQuery) {
        this.savedScrollY = 0;
        this.lastFetchedQuery = this.searchQuery;
        window.scrollTo(0, 0);
        this.resetAndFetch();
        this.attachScrollKeeper();
        return true;
      }
      return false;
    },
    onAfterScrollRestore() {
      this.updateVirtualRange({ measure: true });
    },
    onKeepAliveDeactivated() {
      this.detachVirtualListeners();
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
    },
    formatCount,
    formatMinutes,
    formatPercent,
    formatRelativeDays,
    formatUpdateDays(hours) {
      const h = Number(hours);
      if (!Number.isFinite(h) || h <= 0) return "-";
      return `${(h / 24).toFixed(1)}天`;
    },
    rankBadgeClass(rank) {
      if (rank === 1) return "top-1";
      if (rank === 2) return "top-2";
      if (rank === 3) return "top-3";
      return "";
    },
    isCurrentPlaying(eid) {
      return Boolean(eid && this.player.currentEid === eid && this.player.isPlaying);
    },
    isInQueue(eid) {
      return Boolean(eid && this.player.queue.some((t) => t.eid === eid));
    },
    activeHeightCache() {
      return this.isDesktop ? this._desktopHeights : this._mobileHeights;
    },
    syncResponsiveMode() {
      if (typeof window === "undefined") return false;
      const w = window.innerWidth;
      const nextDesktop = w >= 768;
      const widthChanged = Math.abs(w - (this._lastViewportWidth || 0)) > 8;
      const modeChanged = nextDesktop !== this.isDesktop;
      if (widthChanged) {
        this._lastViewportWidth = w;
        if (nextDesktop) {
          this._desktopHeights = Object.create(null);
        } else {
          this._mobileHeights = Object.create(null);
        }
      }
      if (modeChanged) {
        this.isDesktop = nextDesktop;
      }
      return widthChanged || modeChanged;
    },
    attachVirtualListeners() {
      if (typeof window === "undefined" || this._vScrollHandler) return;
      this._vScrollHandler = () => this.scheduleVirtualUpdate(true);
      this._vResizeHandler = () => {
        if (this.syncResponsiveMode()) {
          this.$nextTick(() => this.updateVirtualRange({ measure: true }));
        } else {
          this.scheduleVirtualUpdate(false);
        }
      };
      window.addEventListener("scroll", this._vScrollHandler, { passive: true });
      window.addEventListener("resize", this._vResizeHandler, { passive: true });
    },
    detachVirtualListeners() {
      if (this._vScrollRaf && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(this._vScrollRaf);
        this._vScrollRaf = 0;
      }
      if (typeof window === "undefined") return;
      if (this._vScrollHandler) {
        window.removeEventListener("scroll", this._vScrollHandler);
        this._vScrollHandler = null;
      }
      if (this._vResizeHandler) {
        window.removeEventListener("resize", this._vResizeHandler);
        this._vResizeHandler = null;
      }
    },
    scheduleVirtualUpdate(measureAfter = false) {
      if (this._vScrollRaf || typeof requestAnimationFrame === "undefined") return;
      this._vScrollRaf = requestAnimationFrame(() => {
        this._vScrollRaf = 0;
        this.updateVirtualRange({ measure: measureAfter });
      });
    },
    measureRenderedRows() {
      const container = this.isDesktop ? this.$refs.tableBody : this.$refs.cardsContainer;
      if (!container) return false;
      const cache = this.activeHeightCache();
      const rows = container.querySelectorAll("[data-vindex]");
      let changed = false;
      for (let i = 0; i < rows.length; i += 1) {
        const el = rows[i];
        const idx = Number(el.getAttribute("data-vindex"));
        if (!Number.isInteger(idx) || idx < 0) continue;
        // Skip already-measured rows while viewport width remains unchanged
        if (cache[idx] !== undefined) continue;
        const rectH = el.getBoundingClientRect().height;
        if (!(rectH > 0)) continue;
        cache[idx] = this.isDesktop ? rectH : rectH + 10;
        changed = true;
      }
      return changed;
    },
    updateVirtualRange({ measure = false } = {}) {
      const len = this.items.length;
      if (len === 0) {
        this.vStart = 0;
        this.vEnd = 0;
        this.virtualTopPx = 0;
        this.virtualBottomPx = 0;
        return;
      }

      if (measure) {
        this.measureRenderedRows();
      }

      const container = this.isDesktop ? this.$refs.tableBody : this.$refs.cardsContainer;
      const defaultHeight = this.isDesktop
        ? DESKTOP_ROW_DEFAULT_HEIGHT
        : MOBILE_ROW_DEFAULT_HEIGHT;

      if (!container || typeof window === "undefined") {
        this.vStart = 0;
        this.vEnd = Math.min(len, 24);
        this.virtualTopPx = 0;
        this.virtualBottomPx = Math.max(0, (len - this.vEnd) * defaultHeight);
        return;
      }

      const scrollY = window.scrollY || 0;
      const headerEl = document.querySelector(".site-header");
      const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0;
      const listDocTop = container.getBoundingClientRect().top + scrollY;
      const scrollRelTop = scrollY + headerH - listDocTop;
      const visibleHeight = Math.max(0, window.innerHeight - headerH);

      const win = computeVirtualWindow({
        count: len,
        scrollRelTop,
        viewportHeight: visibleHeight,
        overscanPx: VIRTUAL_OVERSCAN_PX,
        defaultHeight,
        heightCache: this.activeHeightCache(),
      });

      this.vStart = win.startIndex;
      this.vEnd = win.endIndex;
      this.virtualTopPx = win.topSpacerPx;
      this.virtualBottomPx = win.bottomSpacerPx;

      this.$nextTick(() => {
        if (this.measureRenderedRows()) {
          this.updateVirtualRange({ measure: false });
        }
      });
    },
    resetAndFetch() {
      if (typeof window !== "undefined" && this.fetched) {
        window.scrollTo(0, 0);
      }
      this.savedScrollY = 0;
      this._mobileHeights = Object.create(null);
      this._desktopHeights = Object.create(null);
      this.vStart = 0;
      this.vEnd = 24;
      this.virtualTopPx = 0;
      this.virtualBottomPx = 0;
      this.fetchGen += 1;
      this.items = [];
      this.total = 0;
      this.offset = 0;
      this.noMore = false;
      this.fetched = false;
      this.loading = false;
      this.errorMsg = "";
      this.fetchNextPage();
    },
    async fetchNextPage() {
      if (this.loading || this.noMore) return;
      this.loading = true;
      this.errorMsg = "";
      const gen = this.fetchGen;
      try {
        const res = await fetchBoard(this.boardKey, {
          offset: this.offset,
          limit: this.limit,
          q: this.searchQuery.trim(),
          genre: this.selectedGenre,
          sort: this.sortField,
          dir: this.sortDir,
        });
        if (gen !== this.fetchGen) return;
        const batch = Array.isArray(res.items) ? res.items : [];
        this.items = [...this.items, ...batch];
        this.total = Number(res.total) || 0;
        this.offset += batch.length;
        this.medianValues = res.medianValues || {};
        this.noMore = this.offset >= this.total || batch.length === 0;
        this.fetched = true;
        this.$nextTick(() => this.updateVirtualRange({ measure: true }));
      } catch (err) {
        if (gen !== this.fetchGen) return;
        this.errorMsg = err?.message || "加载榜单数据失败";
      } finally {
        if (gen === this.fetchGen) {
          this.loading = false;
        }
      }
    },
    onSortSelectChange(evt) {
      const next = evt.target.value;
      this.sortField = next;
      this.sortDir = next === "rank" ? "asc" : "desc";
      this.resetAndFetch();
    },
    toggleSortDir() {
      this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
      this.resetAndFetch();
    },
    toggleColumnSort(field) {
      if (this.sortField === field) {
        this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
      } else {
        this.sortField = field;
        this.sortDir = field === "rank" ? "asc" : "desc";
      }
      this.resetAndFetch();
    },
    onGenreChange() {
      this.resetAndFetch();
    },
    setupObserver() {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      const el = this.$refs.sentinel;
      if (!el || typeof IntersectionObserver === "undefined") return;
      this.observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting && !this.loading && !this.noMore && this.fetched) {
            this.fetchNextPage();
          }
        },
        { rootMargin: "240px" }
      );
      this.observer.observe(el);
    },
    openItem(item) {
      this.savedScrollY = window.scrollY || 0;
      if (this.isEpisodeBoard) {
        if (item.eid && !item.eid.startsWith("raw-")) {
          this.$router.push(`/episode/${item.eid}`);
        } else if (item.link) {
          window.open(item.link, "_blank", "noopener,noreferrer");
        }
      } else {
        if (item.pid) {
          this.$router.push(`/podcast/${item.pid}`);
        } else if (item.xyzUrl) {
          window.open(item.xyzUrl, "_blank", "noopener,noreferrer");
        }
      }
    },
    async handleQuickEpisodeAction(item, mode) {
      if (!item?.eid || item.eid.startsWith("raw-")) {
        this.playerActions.showToast("暂无可用的小宇宙单集 ID");
        return;
      }
      if (mode === "play" && this.player.currentEid === item.eid) {
        this.playerActions.togglePlay();
        return;
      }
      if (this.busyMap[item.eid]) return;
      this.busyMap = { ...this.busyMap, [item.eid]: true };
      try {
        const detail = await fetchEpisodeDetail(item.eid);
        const ep = detail.episode;
        if (!ep?.enclosureUrl) {
          this.playerActions.showToast("未能获取到音频链接，请进入详情页查看");
          return;
        }
        const track = {
          eid: ep.eid,
          pid: ep.podcast?.pid || ep.pid || "",
          title: ep.title || item.title,
          podcastName: ep.podcast?.title || item.podcastName,
          image: ep.image || item.logoURL,
          duration: ep.duration,
          enclosureUrl: ep.enclosureUrl,
          payType: ep.payType,
          link: item.link || detail.sourceUrl,
        };
        if (mode === "play") {
          await this.playerActions.playTrack(track);
        } else {
          this.playerActions.enqueueTrack(track);
        }
      } catch (err) {
        this.playerActions.showToast(err?.message || "获取单集音频失败");
      } finally {
        const next = { ...this.busyMap };
        delete next[item.eid];
        this.busyMap = next;
      }
    },
    sortIndicator(field) {
      if (this.sortField !== field) return "";
      return this.sortDir === "asc" ? " ↑" : " ↓";
    },
  },
  template: `
    <section class="rank-board">
      <div class="board-toolbar">
        <div class="toolbar-filters">
          <select class="select-ctrl" v-model="selectedGenre" @change="onGenreChange" aria-label="按分类筛选">
            <option value="all">全部分类</option>
            <option v-for="g in genreOptions" :key="g.genre" :value="g.genre">
              {{ g.genre }} ({{ g.count }})
            </option>
          </select>

          <select class="select-ctrl" :value="sortField" @change="onSortSelectChange" aria-label="排序字段">
            <option v-for="opt in sortOptions" :key="opt.key" :value="opt.key">
              排序: {{ opt.label }}
            </option>
          </select>

          <button type="button" class="icon-btn" @click="toggleSortDir" :title="sortDir === 'asc' ? '升序' : '降序'">
            <app-icon name="arrow-up-down" :size="14" />
            <span>{{ sortDir === 'asc' ? '升序' : '降序' }}</span>
          </button>
        </div>

        <div class="board-summary tabular" v-if="fetched">
          共 {{ total.toLocaleString() }} 条 · 已加载 {{ items.length }} 条
        </div>
      </div>

      <div v-if="!fetched && loading" class="skeleton-list" aria-label="加载中">
        <div v-for="n in 5" :key="n" class="skeleton-card"></div>
      </div>

      <div v-else-if="errorMsg && items.length === 0" class="state-box error">
        <p>{{ errorMsg }}</p>
        <button type="button" class="btn sm" style="margin-top: 10px" @click="resetAndFetch">重试</button>
      </div>

      <div v-else-if="fetched && items.length === 0" class="state-box">
        暂无匹配的榜单记录，请尝试更换搜索词或分类。
      </div>

      <!-- Mobile Card Stream (Editorial 2-Zone, Virtualized) -->
      <div
        v-if="items.length > 0 && !isDesktop"
        ref="cardsContainer"
        class="rank-cards"
        :style="{ paddingTop: virtualTopPx + 'px', paddingBottom: virtualBottomPx + 'px' }"
      >
        <article
          v-for="entry in visibleEntries"
          :key="entry.key"
          :data-vindex="entry.index"
          class="rank-card"
          @click="openItem(entry.item)"
        >
          <div class="card-main-row">
            <div class="rank-num tabular" :class="rankBadgeClass(entry.item.rank)">{{ entry.item.rank }}</div>
            <img class="cover-thumb" :src="entry.item.logoURL" :alt="entry.item.title || entry.item.name" loading="lazy" />

            <div class="card-head-text">
              <div class="card-title">{{ isEpisodeBoard ? entry.item.title : entry.item.name }}</div>
              <div class="card-sub-row">
                <span class="card-subtitle">
                  {{ isEpisodeBoard ? entry.item.podcastName : (entry.item.authorsText || '-') }}
                </span>
                <span v-if="entry.item.primaryGenreName" class="genre-tag">{{ entry.item.primaryGenreName }}</span>
              </div>
            </div>
          </div>

          <div class="card-footer-row">
            <div class="card-stats-line tabular" v-if="isEpisodeBoard">
              <span class="stat-strong">▶ {{ formatCount(entry.item.playCount) }}</span>
              <span>💬 {{ formatCount(entry.item.commentCount) }}</span>
              <span>{{ formatMinutes(entry.item.duration) }}</span>
              <span>{{ formatRelativeDays(entry.item.lastReleaseDateDayCount) }}</span>
            </div>

            <div class="card-stats-line tabular" v-else>
              <span class="stat-strong">均播 {{ formatCount(entry.item.avgPlayCount) }}</span>
              <span>每{{ formatUpdateDays(entry.item.avgUpdateFreq) }}更新</span>
              <span>{{ entry.item.trackCount }} 集</span>
            </div>

            <div class="card-pill-actions" v-if="isEpisodeBoard" @click.stop>
              <button
                type="button"
                class="pill-play-btn"
                :class="{ active: isCurrentPlaying(entry.item.eid) }"
                :disabled="busyMap[entry.item.eid]"
                @click="handleQuickEpisodeAction(entry.item, 'play')"
                :title="isCurrentPlaying(entry.item.eid) ? '暂停' : '立即播放'"
              >
                <app-icon v-if="busyMap[entry.item.eid]" name="loader-circle" :size="13" />
                <app-icon v-else-if="isCurrentPlaying(entry.item.eid)" name="pause" :size="13" />
                <app-icon v-else name="play" :size="13" />
                <span>{{ isCurrentPlaying(entry.item.eid) ? '暂停' : '播放' }}</span>
              </button>
              <button
                type="button"
                class="circle-queue-btn"
                :class="{ queued: isInQueue(entry.item.eid) }"
                :disabled="busyMap[entry.item.eid]"
                @click="handleQuickEpisodeAction(entry.item, 'queue')"
                title="加入播放列表"
              >
                <app-icon v-if="isInQueue(entry.item.eid)" name="check" :size="14" />
                <app-icon v-else name="plus" :size="14" />
              </button>
            </div>

            <div class="card-enter-hint" v-else>
              <span>频道</span>
              <app-icon name="arrow-right" :size="13" />
            </div>
          </div>
        </article>
      </div>

      <!-- Desktop Responsive Table (Virtualized) -->
      <div class="rank-table-wrap" v-else-if="items.length > 0">
        <table class="rank-table" v-if="isEpisodeBoard">
          <thead>
            <tr>
              <th class="sortable" @click="toggleColumnSort('rank')">#{{ sortIndicator('rank') }}</th>
              <th>节目名称</th>
              <th class="sortable" @click="toggleColumnSort('playCount')">
                播放量{{ sortIndicator('playCount') }}
                <span class="median-hint" v-if="medianValues.playCount">中位 {{ formatCount(medianValues.playCount) }}</span>
              </th>
              <th class="sortable" @click="toggleColumnSort('commentCount')">
                评论{{ sortIndicator('commentCount') }}
                <span class="median-hint" v-if="medianValues.commentCount">中位 {{ formatCount(medianValues.commentCount) }}</span>
              </th>
              <th class="sortable" @click="toggleColumnSort('interactiveRate')">
                互动率{{ sortIndicator('interactiveRate') }}
                <span class="median-hint" v-if="medianValues.interactiveRate">中位 {{ formatPercent(medianValues.interactiveRate) }}</span>
              </th>
              <th class="sortable" @click="toggleColumnSort('openRate')">
                打开率{{ sortIndicator('openRate') }}
                <span class="median-hint" v-if="medianValues.openRate">中位 {{ formatPercent(medianValues.openRate) }}</span>
              </th>
              <th class="sortable" @click="toggleColumnSort('duration')">
                时长{{ sortIndicator('duration') }}
                <span class="median-hint" v-if="medianValues.duration">中位 {{ formatMinutes(medianValues.duration) }}</span>
              </th>
              <th class="sortable" @click="toggleColumnSort('postTime')">发布{{ sortIndicator('postTime') }}</th>
              <th>分类</th>
              <th>收听</th>
            </tr>
          </thead>
          <tbody ref="tableBody" class="tabular">
            <tr v-if="virtualTopPx > 0" class="virtual-spacer-row" aria-hidden="true" :style="{ height: virtualTopPx + 'px' }">
              <td colspan="10" :style="{ height: virtualTopPx + 'px' }"></td>
            </tr>
            <tr
              v-for="entry in visibleEntries"
              :key="entry.key"
              :data-vindex="entry.index"
              @click="openItem(entry.item)"
            >
              <td>
                <span class="rank-num" :class="rankBadgeClass(entry.item.rank)">{{ entry.item.rank }}</span>
              </td>
              <td class="title-col">
                <div class="table-item-cell">
                  <img class="table-cover" :src="entry.item.logoURL" :alt="entry.item.title" loading="lazy" />
                  <div style="min-width:0">
                    <div class="table-title">{{ entry.item.title }}</div>
                    <div class="table-sub">{{ entry.item.podcastName }}</div>
                  </div>
                </div>
              </td>
              <td>{{ formatCount(entry.item.playCount) }}</td>
              <td>{{ formatCount(entry.item.commentCount) }}</td>
              <td>{{ formatPercent(entry.item.interactiveRate) }}</td>
              <td>{{ formatPercent(entry.item.openRate) }}</td>
              <td>{{ formatMinutes(entry.item.duration) }}</td>
              <td>{{ formatRelativeDays(entry.item.lastReleaseDateDayCount) }}</td>
              <td><span class="genre-tag" v-if="entry.item.primaryGenreName">{{ entry.item.primaryGenreName }}</span></td>
              <td @click.stop>
                <div class="table-actions">
                  <button
                    type="button"
                    class="circle-queue-btn"
                    :class="{ queued: isCurrentPlaying(entry.item.eid) }"
                    :disabled="busyMap[entry.item.eid]"
                    @click="handleQuickEpisodeAction(entry.item, 'play')"
                    :title="isCurrentPlaying(entry.item.eid) ? '暂停' : '立即播放'"
                  >
                    <app-icon v-if="busyMap[entry.item.eid]" name="loader-circle" :size="14" />
                    <app-icon v-else-if="isCurrentPlaying(entry.item.eid)" name="pause" :size="14" />
                    <app-icon v-else name="play" :size="14" />
                  </button>
                  <button
                    type="button"
                    class="circle-queue-btn"
                    :class="{ queued: isInQueue(entry.item.eid) }"
                    :disabled="busyMap[entry.item.eid]"
                    @click="handleQuickEpisodeAction(entry.item, 'queue')"
                    title="加入播放列表"
                  >
                    <app-icon v-if="isInQueue(entry.item.eid)" name="check" :size="14" />
                    <app-icon v-else name="plus" :size="14" />
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="virtualBottomPx > 0" class="virtual-spacer-row" aria-hidden="true" :style="{ height: virtualBottomPx + 'px' }">
              <td colspan="10" :style="{ height: virtualBottomPx + 'px' }"></td>
            </tr>
          </tbody>
        </table>

        <table class="rank-table" v-else>
          <thead>
            <tr>
              <th class="sortable" @click="toggleColumnSort('rank')">#{{ sortIndicator('rank') }}</th>
              <th>播客电台</th>
              <th>分类</th>
              <th class="sortable" @click="toggleColumnSort('avgUpdateFreq')">
                更新频率{{ sortIndicator('avgUpdateFreq') }}
                <span class="median-hint" v-if="medianValues.avgUpdateFreq">中位 {{ formatUpdateDays(medianValues.avgUpdateFreq) }}</span>
              </th>
              <th class="sortable" @click="toggleColumnSort('lastReleaseDateDayCount')">最近更新{{ sortIndicator('lastReleaseDateDayCount') }}</th>
              <th class="sortable" @click="toggleColumnSort('trackCount')">总集数{{ sortIndicator('trackCount') }}</th>
              <th class="sortable" @click="toggleColumnSort('avgDuration')">平均时长{{ sortIndicator('avgDuration') }}</th>
              <th class="sortable" @click="toggleColumnSort('avgPlayCount')">
                平均播放{{ sortIndicator('avgPlayCount') }}
                <span class="median-hint" v-if="medianValues.avgPlayCount">中位 {{ formatCount(medianValues.avgPlayCount) }}</span>
              </th>
              <th class="sortable" @click="toggleColumnSort('avgCommentCount')">平均评论{{ sortIndicator('avgCommentCount') }}</th>
              <th class="sortable" @click="toggleColumnSort('avgOpenRate')">打开率{{ sortIndicator('avgOpenRate') }}</th>
            </tr>
          </thead>
          <tbody ref="tableBody" class="tabular">
            <tr v-if="virtualTopPx > 0" class="virtual-spacer-row" aria-hidden="true" :style="{ height: virtualTopPx + 'px' }">
              <td colspan="10" :style="{ height: virtualTopPx + 'px' }"></td>
            </tr>
            <tr
              v-for="entry in visibleEntries"
              :key="entry.key"
              :data-vindex="entry.index"
              @click="openItem(entry.item)"
            >
              <td>
                <span class="rank-num" :class="rankBadgeClass(entry.item.rank)">{{ entry.item.rank }}</span>
              </td>
              <td class="title-col">
                <div class="table-item-cell">
                  <img class="table-cover" :src="entry.item.logoURL" :alt="entry.item.name" loading="lazy" />
                  <div style="min-width:0">
                    <div class="table-title">{{ entry.item.name }}</div>
                    <div class="table-sub">{{ entry.item.authorsText || '-' }}</div>
                  </div>
                </div>
              </td>
              <td><span class="genre-tag" v-if="entry.item.primaryGenreName">{{ entry.item.primaryGenreName }}</span></td>
              <td>{{ formatUpdateDays(entry.item.avgUpdateFreq) }}</td>
              <td>{{ formatRelativeDays(entry.item.lastReleaseDateDayCount) }}</td>
              <td>{{ entry.item.trackCount }}</td>
              <td>{{ formatMinutes(entry.item.avgDuration) }}</td>
              <td>{{ formatCount(entry.item.avgPlayCount) }}</td>
              <td>{{ formatCount(entry.item.avgCommentCount) }}</td>
              <td>{{ formatPercent(entry.item.avgOpenRate) }}</td>
            </tr>
            <tr v-if="virtualBottomPx > 0" class="virtual-spacer-row" aria-hidden="true" :style="{ height: virtualBottomPx + 'px' }">
              <td colspan="10" :style="{ height: virtualBottomPx + 'px' }"></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div ref="sentinel" class="load-more-wrap">
        <div v-if="loading" style="color: var(--text-muted); padding: 12px;">正在加载更多...</div>
        <button v-else-if="!noMore && items.length > 0" type="button" class="btn sm" @click="fetchNextPage">
          加载更多
        </button>
        <div v-else-if="fetched && items.length > 0" style="color: var(--text-muted); font-size: 12px; padding: 8px;">
          已显示全部 {{ items.length }} 条结果
        </div>
      </div>
    </section>
  `,
};
