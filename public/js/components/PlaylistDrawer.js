import { formatDurationSeconds } from "../utils.js";
import AppIcon from "./AppIcon.js";

export default {
  name: "PlaylistDrawer",
  components: { AppIcon },
  inject: ["player", "playerActions"],
  data() {
    return {
      sortableInstance: null,
    };
  },
  watch: {
    "player.playlistOpen"(isOpen) {
      if (isOpen) {
        this.$nextTick(() => this.initSortable());
      } else {
        this.destroySortable();
      }
    },
  },
  beforeUnmount() {
    this.destroySortable();
  },
  methods: {
    formatDurationSeconds,
    initSortable() {
      this.destroySortable();
      const el = this.$refs.queueList;
      const Sortable = typeof window !== "undefined" ? window.Sortable : null;
      if (!el || !Sortable) return;

      this.sortableInstance = Sortable.create(el, {
        handle: ".drag-handle",
        animation: 150,
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
      const p = this.player.progressMap[track.eid];
      if (!p) return "";
      if (p.finished) return "已播完";
      const dur = track.duration || p.duration || 0;
      if (dur <= 0 || p.currentTime <= 5) return "";
      const pct = Math.min(99, Math.round((p.currentTime / dur) * 100));
      return `已听 ${pct}%`;
    },
  },
  template: `
    <div
      v-if="player.playlistOpen"
      class="drawer-backdrop"
      @click.self="playerActions.setPlaylistOpen(false)"
      role="dialog"
      aria-modal="true"
      aria-label="播放列表"
    >
      <div class="drawer-panel">
        <div class="drawer-grabber" aria-hidden="true"></div>
        <div class="drawer-header">
          <div style="display:flex;align-items:center;gap:8px;">
            <app-icon name="list-music" :size="18" />
            <strong>播放列表 ({{ player.queue.length }})</strong>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <button
              v-if="player.queue.length > 0"
              type="button"
              class="btn sm"
              @click="playerActions.clearQueue()"
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
            <span class="drag-handle" title="拖拽调整顺序">
              <app-icon name="grip-vertical" :size="16" />
            </span>

            <img class="cover-thumb" style="width:42px;height:42px;border-radius:9px;" :src="item.image" :alt="item.title" />

            <div class="queue-info" @click="playerActions.playTrack(item)">
              <div class="queue-title">{{ item.title }}</div>
              <div class="queue-sub tabular">
                <span>{{ item.podcastName || '小宇宙播客' }}</span>
                <span v-if="item.duration"> · {{ formatDurationSeconds(item.duration) }}</span>
                <span v-if="progressText(item)" style="color:var(--accent);font-weight:600;"> · {{ progressText(item) }}</span>
              </div>
            </div>

            <div class="queue-item-actions">
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
                @click="playerActions.removeFromQueue(item.eid)"
                title="移除"
              >
                <app-icon name="x" :size="14" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
};
