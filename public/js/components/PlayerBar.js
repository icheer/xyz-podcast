import { PLAYBACK_RATES } from "../storage.js";
import { formatDurationSeconds } from "../utils.js";
import AppIcon from "./AppIcon.js";

const LOOP_LABELS = {
  sequential: "顺序播放",
  "repeat-all": "列表循环",
  "repeat-one": "单曲循环",
};

export default {
  name: "PlayerBar",
  components: { AppIcon },
  inject: ["player", "playerActions"],
  data() {
    return {
      isScrubbing: false,
      scrubValue: 0,
      showRatePicker: false,
    };
  },
  computed: {
    track() {
      return this.playerActions.getCurrentTrack();
    },
    effectiveDuration() {
      return this.player.duration || this.track?.duration || 0;
    },
    displayCurrentTime() {
      return this.isScrubbing ? this.scrubValue : this.player.currentTime;
    },
    progressPercent() {
      const dur = this.effectiveDuration;
      if (!dur || dur <= 0) return 0;
      return Math.min(100, Math.max(0, (this.displayCurrentTime / dur) * 100));
    },
    loopLabel() {
      return LOOP_LABELS[this.player.loopMode] || "顺序播放";
    },
    loopIcon() {
      if (this.player.loopMode === "repeat-one") return "repeat-1";
      if (this.player.loopMode === "repeat-all") return "repeat";
      return "arrow-right";
    },
    rates() {
      return PLAYBACK_RATES;
    },
  },
  methods: {
    formatDurationSeconds,
    onScrubInput(evt) {
      this.isScrubbing = true;
      this.scrubValue = Number(evt.target.value) || 0;
    },
    onScrubChange(evt) {
      const target = Number(evt.target.value) || 0;
      this.isScrubbing = false;
      this.playerActions.seekTo(target);
    },
    openEpisodePage() {
      if (!this.track?.eid) return;
      this.playerActions.setExpanded(false);
      this.$router.push(`/episode/${this.track.eid}`);
    },
    openPodcastPage() {
      if (!this.track?.pid) return;
      this.playerActions.setExpanded(false);
      this.$router.push(`/podcast/${this.track.pid}`);
    },
  },
  template: `
    <div v-if="track">
      <!-- Bottom Sticky Mini Player -->
      <aside class="mini-player" aria-label="迷你播放器">
        <div class="mini-progress-track">
          <div class="mini-progress-fill" :style="{ width: progressPercent + '%' }"></div>
        </div>

        <div class="mini-player-inner">
          <button type="button" class="mini-track" @click="playerActions.setExpanded(true)" aria-label="展开播放器">
            <img v-cover class="mini-cover" :src="track.image" :alt="track.title" />
            <div class="mini-meta">
              <div class="mini-title">{{ track.title }}</div>
              <div class="mini-sub tabular">
                <span>{{ formatDurationSeconds(displayCurrentTime) }} / {{ formatDurationSeconds(effectiveDuration) }}</span>
                <span v-if="track.podcastName"> · {{ track.podcastName }}</span>
              </div>
            </div>
          </button>

          <div class="mini-controls">
            <button
              type="button"
              class="skip-icon-btn mini-skip"
              @click="playerActions.skipBy(-15)"
              title="后退 15 秒"
              aria-label="后退 15 秒"
            >
              <app-icon name="skip-back-15" :size="24" />
            </button>

            <button
              type="button"
              class="player-circle-btn primary"
              @click="playerActions.togglePlay()"
              :title="player.isPlaying ? '暂停' : '播放'"
            >
              <app-icon class="buffering-icon" v-if="player.isBuffering" name="loader-circle" :size="18" />
              <app-icon v-else-if="player.isPlaying" name="pause" :size="18" />
              <app-icon v-else name="play" :size="18" />
            </button>

            <button
              type="button"
              class="skip-icon-btn mini-skip"
              @click="playerActions.skipBy(30)"
              title="前进 30 秒"
              aria-label="前进 30 秒"
            >
              <app-icon name="skip-forward-30" :size="24" />
            </button>

            <button
              type="button"
              class="player-circle-btn mini-list-btn"
              @click="playerActions.setPlaylistOpen(true)"
              title="播放列表"
            >
              <app-icon name="list-music" :size="18" />
            </button>

            <button
              type="button"
              class="player-circle-btn mini-expand-btn"
              @click="playerActions.setExpanded(true)"
              title="展开全屏播放器"
            >
              <app-icon name="chevron-up" :size="18" />
            </button>
          </div>
        </div>
      </aside>

      <!-- Fullscreen Expanded Player Overlay -->
      <transition name="player-sheet"><div v-if="player.expanded" v-dialog-focus="() => playerActions.setExpanded(false)" class="full-player-overlay" role="dialog" aria-modal="true" aria-label="播控页">
        <div class="full-player-inner">
          <div class="full-player-head">
            <button type="button" class="icon-btn" @click="playerActions.setExpanded(false)">
              <app-icon name="chevron-down" :size="18" />
              <span>收起</span>
            </button>
            <span style="font-size: 13px; color: var(--text-muted); font-weight: 600;">正在收听</span>
            <button type="button" class="icon-btn" @click="openEpisodePage">
              <span>详情页</span>
            </button>
          </div>

          <div class="full-cover-wrap">
            <img v-cover class="full-cover" :src="track.image" :alt="track.title" />
          </div>

          <div class="full-titles">
            <h2 @click="openEpisodePage" style="cursor:pointer;">{{ track.title }}</h2>
            <button
              v-if="track.pid"
              type="button"
              class="pod-link"
              @click="openPodcastPage"
            >
              {{ track.podcastName || '前往播客频道' }} →
            </button>
            <div v-else style="font-size: 14px; color: var(--text-secondary);">{{ track.podcastName }}</div>
          </div>

          <div class="scrubber-wrap">
            <input
              type="range"
              class="scrubber-range"
              :style="{ '--progress': progressPercent + '%' }"
              min="0"
              :max="Math.max(1, Math.floor(effectiveDuration))"
              :value="Math.floor(displayCurrentTime)"
              @input="onScrubInput"
              @change="onScrubChange"
              aria-label="播放进度"
            />
            <div class="scrubber-times tabular">
              <span>{{ formatDurationSeconds(displayCurrentTime) }}</span>
              <span>-{{ formatDurationSeconds(Math.max(0, effectiveDuration - displayCurrentTime)) }}</span>
            </div>
          </div>

          <div class="transport-row">
            <button type="button" class="player-circle-btn" @click="playerActions.playPrev()" title="上一集">
              <app-icon name="skip-back" :size="22" />
            </button>

            <button type="button" class="transport-skip" @click="playerActions.skipBy(-15)" title="后退 15 秒" aria-label="后退 15 秒">
              <app-icon name="skip-back-15" :size="28" />
            </button>

            <button type="button" class="transport-play" @click="playerActions.togglePlay()" :title="player.isPlaying ? '暂停' : '播放'">
              <app-icon class="buffering-icon" v-if="player.isBuffering" name="loader-circle" :size="28" />
              <app-icon v-else-if="player.isPlaying" name="pause" :size="28" />
              <app-icon v-else name="play" :size="28" />
            </button>

            <button type="button" class="transport-skip" @click="playerActions.skipBy(30)" title="前进 30 秒" aria-label="前进 30 秒">
              <app-icon name="skip-forward-30" :size="28" />
            </button>

            <button type="button" class="player-circle-btn" @click="playerActions.playNext()" title="下一集">
              <app-icon name="skip-forward" :size="22" />
            </button>
          </div>

          <div v-if="showRatePicker" class="speed-pills">
            <button
              v-for="r in rates"
              :key="r"
              type="button"
              class="speed-pill tabular"
              :class="{ active: player.playbackRate === r }"
              @click="playerActions.setPlaybackRate(r); showRatePicker = false"
            >{{ r }}x</button>
          </div>

          <div class="utility-row">
            <button type="button" class="util-btn" @click="showRatePicker = !showRatePicker">
              <strong class="tabular" style="font-size: 14px;">{{ player.playbackRate }}x</strong>
              <span>倍速</span>
            </button>

            <button type="button" class="util-btn" @click="playerActions.cycleLoopMode()">
              <app-icon :name="loopIcon" :size="18" />
              <span>{{ loopLabel }}</span>
            </button>

            <button type="button" class="util-btn" @click="playerActions.setPlaylistOpen(true)">
              <app-icon name="list-music" :size="18" />
              <span>列表 ({{ player.queue.length }})</span>
            </button>
          </div>
        </div>
      </div></transition>
    </div>
  `,
};
