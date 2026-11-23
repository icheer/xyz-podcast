import { fetchEpisodeDetail } from "../api.js";
import {
  buildOpmlXml,
  exportUserDataObject,
  parseAndMergeBackupJson,
} from "../storage.js";
import {
  formatDateTime,
  formatDurationSeconds,
  formatProgressBadge,
  inlineConfirmMixin,
} from "../utils.js";
import AppIcon from "./AppIcon.js";

function triggerTextDownload(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default {
  name: "LibraryDrawer",
  components: { AppIcon },
  mixins: [inlineConfirmMixin],
  inject: ["player", "playerActions"],
  props: {
    open: { type: Boolean, default: false },
    favorites: { type: Array, default: () => [] },
  },
  emits: ["close"],
  data() {
    return {
      activeTab: "favorites", // "favorites" | "history"
      busyEid: "",
      undoState: null,
      undoTimer: null,
    };
  },
  computed: {
    historyItems() {
      const map = this.player.progressMap || {};
      const list = [];
      for (const [eid, entry] of Object.entries(map)) {
        if (!eid || !entry) continue;
        if (!(entry.currentTime > 0 || entry.finished)) continue;
        list.push({
          eid,
          title: entry.title || `单集 ${eid.slice(0, 8)}`,
          podcastName: entry.podcastName || "",
          pid: entry.pid || "",
          image: entry.image || "",
          enclosureUrl: entry.enclosureUrl || "",
          currentTime: Number(entry.currentTime) || 0,
          duration: Number(entry.duration) || 0,
          finished: Boolean(entry.finished),
          updatedAt: Number(entry.updatedAt) || 0,
        });
      }
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      return list;
    },
  },
  watch: {
    open(isOpen) {
      if (!isOpen) {
        this.resetClearConfirm();
        return;
      }
      if (this.favorites.length === 0 && this.historyItems.length > 0) {
        this.activeTab = "history";
      }
    },
    activeTab() {
      this.resetClearConfirm();
    },
    "historyItems.length"(len) {
      if (len === 0) this.resetClearConfirm();
    },
  },
  beforeUnmount() {
    clearTimeout(this.undoTimer);
  },
  methods: {
    formatDateTime,
    formatDurationSeconds,
    setUndo(payload) {
      this.undoState = payload;
      clearTimeout(this.undoTimer);
      this.undoTimer = setTimeout(() => {
        this.undoState = null;
      }, 5000);
    },
    openPodcast(pid) {
      if (!pid) return;
      this.playerActions.navigateFromPlayer(`/podcast/${pid}`);
    },
    openEpisode(eid) {
      if (!eid) return;
      this.playerActions.navigateFromPlayer(`/episode/${eid}`);
    },
    unfollowPodcast(pod) {
      this.setUndo({
        type: "favorite",
        message: `已取消关注「${pod.title}」`,
        pod: { ...pod },
      });
      this.playerActions.toggleFavoritePodcast(pod, { silentToast: true });
    },
    removeHistoryEntry(item) {
      const prevMap = { ...this.player.progressMap };
      this.setUndo({
        type: "history",
        message: "已移除该条收听记录",
        progressMap: prevMap,
      });
      this.playerActions.removeProgressItem(item.eid);
    },
    handleClearHistory() {
      if (this.historyItems.length === 0) return;
      this.triggerInlineClearConfirm(() => {
        const prevMap = { ...this.player.progressMap };
        this.setUndo({
          type: "history",
          message: `已清空 ${this.historyItems.length} 条收听历史`,
          progressMap: prevMap,
        });
        this.playerActions.clearProgressHistory();
      });
    },
    handleUndo() {
      if (!this.undoState) return;
      if (this.undoState.type === "favorite" && this.undoState.pod) {
        this.playerActions.toggleFavoritePodcast(this.undoState.pod, { silentToast: true });
      } else if (this.undoState.type === "history" && this.undoState.progressMap) {
        this.playerActions.restoreProgressSnapshot(this.undoState.progressMap);
      }
      clearTimeout(this.undoTimer);
      this.undoState = null;
    },
    isItemPlaying(eid) {
      return this.player.currentEid === eid && this.player.isPlaying;
    },
    historyProgressLabel(item) {
      return formatProgressBadge(item, item.duration, {
        includeTime: true,
        minSeconds: 0,
      });
    },
    async playHistoryItem(item) {
      if (this.player.currentEid === item.eid) {
        this.playerActions.togglePlay();
        return;
      }
      if (item.enclosureUrl) {
        await this.playerActions.playTrack(
          {
            eid: item.eid,
            pid: item.pid,
            title: item.title,
            podcastName: item.podcastName,
            image: item.image,
            duration: item.duration,
            enclosureUrl: item.enclosureUrl,
            link: `https://www.xiaoyuzhoufm.com/episode/${item.eid}`,
          },
          { restart: item.finished }
        );
        return;
      }
      if (this.busyEid) return;
      this.busyEid = item.eid;
      try {
        const detail = await fetchEpisodeDetail(item.eid);
        const ep = detail?.episode;
        if (!ep?.enclosureUrl) {
          this.playerActions.showToast("未获取到音频流地址，请进入单集详情页");
          return;
        }
        await this.playerActions.playTrack(
          {
            eid: ep.eid,
            pid: ep.podcast?.pid || ep.pid || item.pid,
            title: ep.title || item.title,
            podcastName: ep.podcast?.title || item.podcastName,
            image: ep.image || item.image,
            duration: ep.duration || item.duration,
            enclosureUrl: ep.enclosureUrl,
            link: detail.sourceUrl,
          },
          { restart: item.finished }
        );
      } catch (err) {
        this.playerActions.showToast(err?.message || "加载单集音频失败");
      } finally {
        this.busyEid = "";
      }
    },
    handleExportJson() {
      const payload = exportUserDataObject();
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      triggerTextDownload(
        `xyz-podcast-backup-${stamp}.json`,
        JSON.stringify(payload, null, 2),
        "application/json;charset=utf-8"
      );
      this.playerActions.showToast("已导出收听备份 JSON");
    },
    handleExportOpml() {
      if (this.favorites.length === 0) {
        this.playerActions.showToast("暂无已关注的播客可导出");
        return;
      }
      const xml = buildOpmlXml(this.favorites);
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      triggerTextDownload(
        `xyz-podcast-subscriptions-${stamp}.opml`,
        xml,
        "text/x-opml;charset=utf-8"
      );
      this.playerActions.showToast(`已导出 ${this.favorites.length} 个关注播客 OPML`);
    },
    triggerImportFile() {
      this.$refs.importInput?.click();
    },
    async onImportFileChange(evt) {
      const file = evt.target?.files?.[0];
      if (evt.target) evt.target.value = "";
      if (!file) return;
      try {
        const text = await file.text();
        const merged = parseAndMergeBackupJson(text);
        this.playerActions.applyImportedBackup(merged);
      } catch (err) {
        this.playerActions.showToast(err?.message || "导入备份失败");
      }
    },
  },
  template: `
    <transition name="queue-sheet"><div
      v-if="open"
      v-dialog-focus="() => $emit('close')"
      class="drawer-backdrop"
      @click.self="$emit('close')"
      role="dialog"
      aria-modal="true"
      aria-label="我的收听"
    >
      <div class="drawer-panel library-panel" @pointerdown="onConfirmScopePointerDown">
        <div class="drawer-grabber" aria-hidden="true"></div>
        <div class="drawer-header">
          <div class="drawer-head-title">
            <app-icon name="bookmark" :size="18" />
            <strong>我的收听</strong>
          </div>
          <div class="drawer-head-actions">
            <button
              v-if="activeTab === 'history' && historyItems.length > 0"
              type="button"
              data-clear-confirm
              class="btn sm"
              :class="{ 'danger-confirm': confirmingClear }"
              @click="handleClearHistory"
              @keydown.esc.stop.prevent="confirmingClear && resetClearConfirm()"
              :title="confirmingClear ? '再次点击确认清空收听历史' : '清空收听历史'"
            >
              <app-icon name="trash-2" :size="14" />
              <span>{{ confirmingClear ? '确认清空' : '清空历史' }}</span>
            </button>
            <button
              type="button"
              class="icon-btn"
              @click="$emit('close')"
              aria-label="关闭我的收听"
            >
              <app-icon name="x" :size="16" />
            </button>
          </div>
        </div>

        <div class="library-tabs" role="tablist" aria-label="我的收听分类">
          <button
            type="button"
            role="tab"
            class="library-tab tabular"
            :class="{ active: activeTab === 'favorites' }"
            :aria-selected="activeTab === 'favorites'"
            @click="activeTab = 'favorites'"
          >关注播客 ({{ favorites.length }})</button>
          <button
            type="button"
            role="tab"
            class="library-tab tabular"
            :class="{ active: activeTab === 'history' }"
            :aria-selected="activeTab === 'history'"
            @click="activeTab = 'history'"
          >收听历史 ({{ historyItems.length }})</button>
        </div>

        <!-- Tab 1: Followed Podcasts -->
        <div v-if="activeTab === 'favorites'" class="drawer-body">
          <div v-if="favorites.length === 0" class="queue-empty">
            <app-icon name="heart" :size="28" />
            <p>还没有关注的播客<br />在热门播客榜或频道页点击「关注」即可收藏</p>
          </div>
          <div
            v-else
            v-for="pod in favorites"
            :key="pod.pid"
            class="queue-item"
          >
            <img v-cover="pod.image" class="cover-thumb drawer-thumb" :alt="pod.title" loading="lazy" />
            <button type="button" class="queue-info" @click="openPodcast(pod.pid)">
              <div class="queue-title">{{ pod.title }}</div>
              <div class="queue-sub">
                <span>{{ pod.author || '小宇宙播客频道' }}</span>
                <span v-if="pod.rssUrl" class="accent-text"> · 含 RSS</span>
              </div>
            </button>
            <button
              type="button"
              class="queue-icon-btn"
              @click="unfollowPodcast(pod)"
              title="取消关注"
              :aria-label="'取消关注 ' + pod.title"
            >
              <app-icon name="x" :size="15" />
            </button>
          </div>
        </div>

        <!-- Tab 2: Listening History -->
        <div v-else class="drawer-body">
          <div v-if="historyItems.length === 0" class="queue-empty">
            <app-icon name="clock" :size="28" />
            <p>暂无收听历史<br />播放任意单集后会自动记录收听进度</p>
          </div>
          <div
            v-else
            v-for="item in historyItems"
            :key="item.eid"
            class="queue-item"
            :class="{ active: item.eid === player.currentEid }"
          >
            <img v-cover="item.image" class="cover-thumb drawer-thumb" :alt="item.title" loading="lazy" />
            <button type="button" class="queue-info" @click="openEpisode(item.eid)">
              <div class="queue-title">{{ item.title }}</div>
              <div class="queue-sub tabular">
                <span v-if="item.podcastName">{{ item.podcastName }} · </span>
                <span class="accent-text">{{ historyProgressLabel(item) }}</span>
                <span v-if="item.updatedAt"> · {{ formatDateTime(new Date(item.updatedAt).toISOString()) }}</span>
              </div>
            </button>
            <div class="queue-item-actions">
              <button
                type="button"
                class="queue-icon-btn"
                :disabled="busyEid === item.eid"
                @click="playHistoryItem(item)"
                :title="isItemPlaying(item.eid) ? '暂停' : (item.finished ? '重新播放' : '继续播放')"
              >
                <app-icon v-if="busyEid === item.eid" class="buffering-icon" name="loader-circle" :size="15" />
                <app-icon v-else-if="isItemPlaying(item.eid)" name="pause" :size="15" />
                <app-icon v-else name="play" :size="15" />
              </button>
              <button
                type="button"
                class="queue-icon-btn"
                @click="removeHistoryEntry(item)"
                title="删除此记录"
              >
                <app-icon name="x" :size="14" />
              </button>
            </div>
          </div>
        </div>

        <div v-if="undoState" class="queue-undo" role="status">
          <span>{{ undoState.message }}</span>
          <button type="button" class="btn sm" @click="handleUndo">撤销</button>
        </div>

        <div class="library-footer">
          <input
            ref="importInput"
            type="file"
            accept=".json,application/json"
            style="display:none;"
            @change="onImportFileChange"
          />
          <button type="button" class="btn sm" @click="handleExportJson" title="导出关注播客、收听进度与播放队列 JSON">
            <app-icon name="download" :size="14" />
            <span>导出备份</span>
          </button>
          <button type="button" class="btn sm" @click="triggerImportFile" title="从 JSON 备份文件合并恢复">
            <app-icon name="upload" :size="14" />
            <span>导入恢复</span>
          </button>
          <button type="button" class="btn sm" @click="handleExportOpml" title="导出关注播客为 OPML 订阅文件">
            <app-icon name="rss" :size="14" />
            <span>OPML</span>
          </button>
        </div>
      </div>
    </div></transition>
  `,
};
