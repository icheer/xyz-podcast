import { formatDurationSeconds, formatProgressBadge, loadSortable } from "../utils.js";
import AppIcon from "./AppIcon.js";

export default {
  name: "PlaylistDrawer",
  components: { AppIcon },
  inject: ["player", "playerActions"],
  data() {
    return {
      sortableInstance: null,
      expandedActions: null,
      undoState: null,
      undoTimer: null,
    };
  },
  computed: {
    finishedCount() {
      return this.player.queue.filter(
        (item) =>
          item.eid !== this.player.currentEid &&
          Boolean(this.player.progressMap[item.eid]?.finished)
      ).length;
    },
  },
  watch: {
    "player.queue.length"() {
      if (this.player.playlistOpen) this.$nextTick(() => this.initSortable());
    },
    "player.playlistOpen"(isOpen) {
      if (isOpen) {
        this.$nextTick(() => this.initSortable());
      } else {
        this.expandedActions = null;
        this.destroySortable();
      }
    },
  },
  beforeUnmount() {
    this.destroySortable();
    clearTimeout(this.undoTimer);
  },
  methods: {
    formatDurationSeconds,
    saveUndoSnapshot(
      message,
      snapshot = { items: [...this.player.queue], currentEid: this.player.currentEid }
    ) {
      this.undoState = { message, ...snapshot };
      clearTimeout(this.undoTimer);
      this.undoTimer = setTimeout(() => {
        this.undoState = null;
      }, 5000);
    },
    removeItem(item) {
      this.saveUndoSnapshot("已移出播放列表");
      if (this.expandedActions === item.eid) {
        this.expandedActions = null;
      }
      this.playerActions.removeFromQueue(item.eid);
    },
    handleClearFinished() {
      if (this.finishedCount <= 0) return;
      const snapshot = {
        items: [...this.player.queue],
        currentEid: this.player.currentEid,
      };
      const removed = this.playerActions.clearFinishedFromQueue();
      if (removed > 0) {
        this.saveUndoSnapshot(`已移除 ${removed} 集已播完节目`, snapshot);
      }
    },
    handleClearAll() {
      if (this.player.queue.length === 0) return;
      this.saveUndoSnapshot(`已清空 ${this.player.queue.length} 集播放列表`);
      this.expandedActions = null;
      this.playerActions.clearQueue({ silentToast: true });
    },
    undoRemove() {
      if (!this.undoState) return;
      const { items, currentEid } = this.undoState;
      this.playerActions.restoreQueueSnapshot(items, currentEid);
      clearTimeout(this.undoTimer);
      this.undoState = null;
    },
    playNextItem(item) {
      this.playerActions.enqueueNext(item);
      this.expandedActions = null;
    },
    async initSortable() {
      this.destroySortable();
      const el = this.$refs.queueList;
      if (!el || !this.player.playlistOpen) return;
      const Sortable = await loadSortable().catch(() => null);
      if (!Sortable || !this.player.playlistOpen || el !== this.$refs.queueList || this.sortableInstance) return;

      this.sortableInstance = Sortable.create(el, {
        handle: ".drag-handle",
        animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 150,
        onEnd: (evt) => {
          const { oldIndex, newIndex, item, from } = evt;
          if (
            oldIndex === undefined ||
            newIndex === undefined ||
            oldIndex === newIndex
          ) {
            return;
          }
          // Restore DOM node position so Vue's keyed VDOM patching stays consistent
          from.removeChild(item);
          from.insertBefore(item, from.children[oldIndex] || null);
          this.playerActions.reorderQueue(oldIndex, newIndex);
        },
      });
    },
    destroySortable() {
      if (this.sortableInstance) {
        this.sortableInstance.destroy();
        this.sortableInstance = null;
      }
    },
    progressText(track) {
      return formatProgressBadge(this.player.progressMap[track.eid], track.duration);
    },
  },
  template: `
    <transition name="queue-sheet"><div
      v-if="player.playlistOpen"
      v-dialog-focus="() => playerActions.setPlaylistOpen(false)"
      class="drawer-backdrop"
      @click.self="playerActions.setPlaylistOpen(false)"
      role="dialog"
      aria-modal="true"
      aria-label="播放列表"
    >
      <div class="drawer-panel">
        <div class="drawer-grabber" aria-hidden="true"></div>
        <div class="drawer-header">
          <div class="drawer-head-title">
            <app-icon name="list-music" :size="18" />
            <strong>播放列表 ({{ player.queue.length }})</strong>
          </div>
          <div class="drawer-head-actions">
            <button
              v-if="finishedCount > 0"
              type="button"
              class="btn sm"
              @click="handleClearFinished"
              title="移除列表中已播完的单集"
            >
              <span>清已播 ({{ finishedCount }})</span>
            </button>
            <button
              v-if="player.queue.length > 0"
              type="button"
              class="btn sm"
              @click="handleClearAll"
            >
              <app-icon name="trash-2" :size="14" />
              <span>清空</span>
            </button>
            <button
              type="button"
              class="icon-btn"
              @click="playerActions.setPlaylistOpen(false)"
              aria-label="关闭播放列表"
            >
              <app-icon name="x" :size="16" />
            </button>
          </div>
        </div>

        <div v-if="player.queue.length === 0" class="queue-empty">
          <app-icon name="list-music" :size="28" />
          <p>播放列表还是空的<br />在榜单或频道页点击「+」即可加入队列</p>
        </div>

        <div v-else ref="queueList" class="drawer-body">
          <div
            v-for="(item, idx) in player.queue"
            :key="item.eid"
            class="queue-item"
            :class="{ active: item.eid === player.currentEid }"
          >
            <span class="drag-handle" :style="{ visibility: sortableInstance ? 'visible' : 'hidden' }" title="拖拽调整顺序">
              <app-icon name="grip-vertical" :size="16" />
            </span>

            <img v-cover class="cover-thumb drawer-thumb" :src="item.image" :alt="item.title" />

            <button type="button" class="queue-info" @click="playerActions.playTrack(item)">
              <div class="queue-title">{{ item.title }}</div>
              <div class="queue-sub tabular">
                <span>{{ item.podcastName || '小宇宙播客' }}</span>
                <span v-if="item.duration"> · {{ formatDurationSeconds(item.duration) }}</span>
                <span v-if="progressText(item)" class="accent-text"> · {{ progressText(item) }}</span>
              </div>
            </button>

            <div class="queue-item-actions">
              <button
                type="button"
                class="queue-icon-btn"
                :aria-expanded="expandedActions === item.eid"
                :aria-label="'调整顺序：' + item.title"
                @click="expandedActions = expandedActions === item.eid ? null : item.eid"
              ><app-icon name="ellipsis" :size="18" /></button>
              <div v-if="expandedActions === item.eid" class="queue-order-menu">
                <button
                  v-if="item.eid !== player.currentEid"
                  type="button"
                  class="queue-menu-text-btn"
                  @click="playNextItem(item)"
                  title="移到当前播放单集之后"
                >下一首</button>
                <button
                  type="button"
                  class="queue-icon-btn"
                  :disabled="idx === 0"
                  @click="playerActions.reorderQueue(idx, idx - 1)"
                  title="上移"
                >
                  <app-icon name="arrow-up" :size="14" />
                </button>
                <button
                  type="button"
                  class="queue-icon-btn"
                  :disabled="idx === player.queue.length - 1"
                  @click="playerActions.reorderQueue(idx, idx + 1)"
                  title="下移"
                >
                  <app-icon name="arrow-down" :size="14" />
                </button>
                <button
                  type="button"
                  class="queue-icon-btn"
                  :disabled="idx === 0"
                  @click="playerActions.reorderQueue(idx, 0)"
                  title="置顶"
                ><app-icon name="arrow-up-to-line" :size="14" /></button>
              </div>
              <button
                type="button"
                class="queue-icon-btn"
                @click="removeItem(item)"
                title="移除"
              >
                <app-icon name="x" :size="14" />
              </button>
            </div>
          </div>
        </div>
        <div v-if="undoState" class="queue-undo" role="status">
          <span>{{ undoState.message }}</span>
          <button type="button" class="btn sm" @click="undoRemove">撤销</button>
        </div>
      </div>
    </div></transition>
  `,
};
