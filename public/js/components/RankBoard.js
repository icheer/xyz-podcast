import { fetchBoard, fetchEpisodeDetail } from "../api.js";
import {
  formatCount,
  formatMinutes,
  formatPercent,
  formatRelativeDays,
} from "../utils.js";
import AppIcon from "./AppIcon.js";

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
  inject: ["player", "playerActions"],
  props: {
    searchQuery: { type: String, default: "" },
    boardMeta: { type: Object, default: () => ({}) },
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
  },
  watch: {
    boardKey() {
      this.sortField = "rank";
      this.sortDir = "asc";
      this.selectedGenre = "all";
      this.resetAndFetch();
    },
    searchQuery() {
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
        this.resetAndFetch();
      }, 380);
    },
  },
  mounted() {
    this.resetAndFetch();
    this.setupObserver();
  },
  beforeUnmount() {
    if (this.observer) this.observer.disconnect();
    if (this.searchTimer) clearTimeout(this.searchTimer);
  },
  methods: {
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
    resetAndFetch() {
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

      <div v-if="errorMsg && items.length === 0" class="state-box error">
        <p>{{ errorMsg }}</p>
        <button type="button" class="btn sm" style="margin-top: 10px" @click="resetAndFetch">重试</button>
      </div>

      <div v-else-if="fetched && items.length === 0" class="state-box">
        暂无匹配的榜单记录，请尝试更换搜索词或分类。
      </div>

      <!-- Mobile Card Stream -->
      <div class="rank-cards" v-if="items.length > 0">
        <article
          v-for="item in items"
          :key="item.eid || item.id || item.rank"
          class="rank-card"
          @click="openItem(item)"
        >
          <div class="rank-badge tabular" :class="rankBadgeClass(item.rank)">{{ item.rank }}</div>
          <img class="cover-thumb" :src="item.logoURL" :alt="item.title || item.name" loading="lazy" />

          <div class="card-body">
            <div class="card-title">{{ isEpisodeBoard ? item.title : item.name }}</div>
            <div class="card-subtitle">
              {{ isEpisodeBoard ? item.podcastName : (item.authorsText || '-') }}
            </div>

            <div class="metrics-row tabular" v-if="isEpisodeBoard">
              <span v-if="item.primaryGenreName" class="metric-chip genre">{{ item.primaryGenreName }}</span>
              <span class="metric-chip">▶ {{ formatCount(item.playCount) }}</span>
              <span class="metric-chip">💬 {{ formatCount(item.commentCount) }}</span>
              <span class="metric-chip">{{ formatMinutes(item.duration) }}</span>
              <span class="metric-chip">{{ formatRelativeDays(item.lastReleaseDateDayCount) }}</span>
            </div>

            <div class="metrics-row tabular" v-else>
              <span v-if="item.primaryGenreName" class="metric-chip genre">{{ item.primaryGenreName }}</span>
              <span class="metric-chip">均播 {{ formatCount(item.avgPlayCount) }}</span>
              <span class="metric-chip">更新 {{ formatUpdateDays(item.avgUpdateFreq) }}</span>
              <span class="metric-chip">{{ item.trackCount }} 集</span>
            </div>
          </div>

          <div class="card-actions" v-if="isEpisodeBoard" @click.stop>
            <button
              type="button"
              class="mini-action-btn play"
              :class="{ active: isCurrentPlaying(item.eid) }"
              :disabled="busyMap[item.eid]"
              @click="handleQuickEpisodeAction(item, 'play')"
              :title="isCurrentPlaying(item.eid) ? '暂停' : '立即播放'"
            >
              <app-icon v-if="busyMap[item.eid]" name="loader-circle" :size="16" />
              <app-icon v-else-if="isCurrentPlaying(item.eid)" name="pause" :size="16" />
              <app-icon v-else name="play" :size="16" />
            </button>
            <button
              type="button"
              class="mini-action-btn"
              :disabled="busyMap[item.eid]"
              @click="handleQuickEpisodeAction(item, 'queue')"
              title="加入播放列表"
            >
              <app-icon v-if="isInQueue(item.eid)" name="check" :size="15" />
              <app-icon v-else name="plus" :size="15" />
            </button>
          </div>
        </article>
      </div>

      <!-- Desktop Responsive Table -->
      <div class="rank-table-wrap" v-if="items.length > 0">
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
          <tbody class="tabular">
            <tr v-for="item in items" :key="item.eid || item.rank" @click="openItem(item)">
              <td>
                <span class="rank-badge" :class="rankBadgeClass(item.rank)">{{ item.rank }}</span>
              </td>
              <td>
                <div class="table-item-cell">
                  <img class="table-cover" :src="item.logoURL" :alt="item.title" loading="lazy" />
                  <div style="min-width:0">
                    <div class="table-title">{{ item.title }}</div>
                    <div class="table-sub">{{ item.podcastName }}</div>
                  </div>
                </div>
              </td>
              <td>{{ formatCount(item.playCount) }}</td>
              <td>{{ formatCount(item.commentCount) }}</td>
              <td>{{ formatPercent(item.interactiveRate) }}</td>
              <td>{{ formatPercent(item.openRate) }}</td>
              <td>{{ formatMinutes(item.duration) }}</td>
              <td>{{ formatRelativeDays(item.lastReleaseDateDayCount) }}</td>
              <td><span class="metric-chip genre" v-if="item.primaryGenreName">{{ item.primaryGenreName }}</span></td>
              <td @click.stop>
                <div class="table-actions">
                  <button
                    type="button"
                    class="mini-action-btn play"
                    :class="{ active: isCurrentPlaying(item.eid) }"
                    :disabled="busyMap[item.eid]"
                    @click="handleQuickEpisodeAction(item, 'play')"
                    :title="isCurrentPlaying(item.eid) ? '暂停' : '立即播放'"
                  >
                    <app-icon v-if="busyMap[item.eid]" name="loader-circle" :size="15" />
                    <app-icon v-else-if="isCurrentPlaying(item.eid)" name="pause" :size="15" />
                    <app-icon v-else name="play" :size="15" />
                  </button>
                  <button
                    type="button"
                    class="mini-action-btn"
                    :disabled="busyMap[item.eid]"
                    @click="handleQuickEpisodeAction(item, 'queue')"
                    title="加入播放列表"
                  >
                    <app-icon v-if="isInQueue(item.eid)" name="check" :size="15" />
                    <app-icon v-else name="plus" :size="15" />
                  </button>
                </div>
              </td>
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
          <tbody class="tabular">
            <tr v-for="item in items" :key="item.id || item.rank" @click="openItem(item)">
              <td>
                <span class="rank-badge" :class="rankBadgeClass(item.rank)">{{ item.rank }}</span>
              </td>
              <td>
                <div class="table-item-cell">
                  <img class="table-cover" :src="item.logoURL" :alt="item.name" loading="lazy" />
                  <div style="min-width:0">
                    <div class="table-title">{{ item.name }}</div>
                    <div class="table-sub">{{ item.authorsText || '-' }}</div>
                  </div>
                </div>
              </td>
              <td><span class="metric-chip genre" v-if="item.primaryGenreName">{{ item.primaryGenreName }}</span></td>
              <td>{{ formatUpdateDays(item.avgUpdateFreq) }}</td>
              <td>{{ formatRelativeDays(item.lastReleaseDateDayCount) }}</td>
              <td>{{ item.trackCount }}</td>
              <td>{{ formatMinutes(item.avgDuration) }}</td>
              <td>{{ formatCount(item.avgPlayCount) }}</td>
              <td>{{ formatCount(item.avgCommentCount) }}</td>
              <td>{{ formatPercent(item.avgOpenRate) }}</td>
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
