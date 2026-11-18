import { fetchPodcastDetail } from "../api.js";
import {
  formatCount,
  formatDateTime,
  formatDurationSeconds,
  scrollKeeperMixin,
} from "../utils.js";
import AppIcon from "./AppIcon.js";

export default {
  name: "PodcastView",
  components: { AppIcon },
  mixins: [scrollKeeperMixin],
  inject: ["player", "playerActions"],
  data() {
    return {
      loading: true,
      errorMsg: "",
      loadedPid: "",
      podcast: null,
      episodes: [],
      sourceUrl: "",
      limitReason: "",
      descExpanded: false,
    };
  },
  computed: {
    pid() {
      return this.$route.params.pid;
    },
    hasHistoryBack() {
      void this.$route.fullPath;
      return Boolean(typeof window !== "undefined" && window.history.state?.back);
    },
  },
  watch: {
    pid: {
      immediate: true,
      handler(newPid) {
        if (newPid && newPid !== this.loadedPid) {
          this.loadData();
        }
      },
    },
  },
  methods: {
    formatCount,
    formatDateTime,
    formatDurationSeconds,
    async loadData() {
      if (!this.pid) return;
      this.loading = true;
      this.errorMsg = "";
      try {
        const res = await fetchPodcastDetail(this.pid);
        this.loadedPid = this.pid;
        this.podcast = res.podcast;
        this.episodes = res.episodes || [];
        this.sourceUrl = res.sourceUrl || `https://www.xiaoyuzhoufm.com/podcast/${this.pid}`;
        this.limitReason = res.limitReason || "";
      } catch (err) {
        this.errorMsg = err?.message || "加载播客频道失败";
      } finally {
        this.loading = false;
      }
    },
    buildTrack(ep) {
      return {
        eid: ep.eid,
        pid: this.podcast?.pid || this.pid,
        title: ep.title,
        podcastName: this.podcast?.title || "",
        image: ep.image || this.podcast?.image || "",
        duration: ep.duration,
        enclosureUrl: ep.enclosureUrl,
        payType: ep.payType,
        link: `https://www.xiaoyuzhoufm.com/episode/${ep.eid}`,
      };
    },
    playEpisode(ep) {
      if (this.player.currentEid === ep.eid) {
        this.playerActions.togglePlay();
        return;
      }
      if (!ep.enclosureUrl) {
        this.playerActions.showToast("该单集暂无可直接播放的音频地址");
        return;
      }
      this.playerActions.playTrack(this.buildTrack(ep));
    },
    enqueueEpisode(ep) {
      if (!ep.enclosureUrl) {
        this.playerActions.showToast("该单集暂无音频地址");
        return;
      }
      this.playerActions.enqueueTrack(this.buildTrack(ep));
    },
    enqueueAll() {
      const tracks = this.episodes.filter((ep) => ep.enclosureUrl).map((ep) => this.buildTrack(ep));
      if (tracks.length === 0) {
        this.playerActions.showToast("暂无可加入队列的音频");
        return;
      }
      this.playerActions.enqueueMany(tracks);
    },
    isCurrentPlaying(eid) {
      return this.player.currentEid === eid && this.player.isPlaying;
    },
    isInQueue(eid) {
      return this.player.queue.some((t) => t.eid === eid);
    },
    progressPercent(eid, duration) {
      const p = this.player.progressMap[eid];
      if (!p) return 0;
      if (p.finished) return 100;
      const dur = duration || p.duration || 0;
      if (dur <= 0) return 0;
      return Math.min(100, Math.round((p.currentTime / dur) * 100));
    },
  },
  template: `
    <div>
      <div class="back-bar">
        <button type="button" class="btn sm" @click="playerActions.smartBack()">
          <app-icon :name="hasHistoryBack ? 'arrow-left' : 'home'" :size="15" />
          <span>{{ hasHistoryBack ? '返回' : '逛热榜首页' }}</span>
        </button>
        <a
          v-if="sourceUrl"
          class="btn sm"
          :href="sourceUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>去小宇宙官网</span>
          <app-icon name="external-link" :size="14" />
        </a>
      </div>

      <div v-if="loading" class="skeleton-list" aria-label="加载中">
        <div v-for="n in 4" :key="n" class="skeleton-card"><span class="skeleton-cover"></span><span class="skeleton-copy"><i></i><i></i></span></div>
      </div>

      <div v-else-if="errorMsg" class="state-box error">
        <p>{{ errorMsg }}</p>
        <div style="margin-top: 12px; display: flex; gap: 8px; justify-content: center;">
          <button type="button" class="btn sm" @click="loadData">重试</button>
          <a
            class="btn sm primary"
            :href="'https://www.xiaoyuzhoufm.com/podcast/' + pid"
            target="_blank"
            rel="noopener noreferrer"
          >去小宇宙官网查看</a>
        </div>
      </div>

      <template v-else-if="podcast">
        <section class="hero-card">
          <div class="hero-main">
            <img v-cover class="hero-cover" :src="podcast.image" :alt="podcast.title" />
            <div class="hero-info">
              <h1 class="hero-title">{{ podcast.title }}</h1>
              <div class="hero-meta tabular">
                <span v-if="podcast.author">主播: {{ podcast.author }}</span>
                <span><app-icon name="users" :size="13" /> {{ formatCount(podcast.subscriptionCount) }} 订阅</span>
                <span>共 {{ podcast.episodeCount }} 集</span>
              </div>
              <div v-if="podcast.brief" style="font-size: 13px; color: var(--text-secondary);">
                {{ podcast.brief }}
              </div>
            </div>
          </div>

          <div class="hero-actions">
            <button
              v-if="episodes.length > 0"
              type="button"
              class="btn primary sm"
              @click="playEpisode(episodes[0])"
            >
              <app-icon name="play" :size="15" />
              <span>播放最新一集</span>
            </button>
            <button
              v-if="episodes.length > 0"
              type="button"
              class="btn sm"
              @click="enqueueAll"
            >
              <app-icon name="list-music" :size="15" />
              <span>将本页 {{ episodes.length }} 集全部加入队列</span>
            </button>
          </div>

          <div v-if="podcast.description" class="hero-description">
            <p class="hero-desc" :class="{ collapsed: !descExpanded }">{{ podcast.description }}</p>
            <button
              type="button"
              style="margin-top: 6px; font-size: 12px; color: var(--accent); font-weight: 600;"
              @click="descExpanded = !descExpanded"
            >
              {{ descExpanded ? '收起简介' : '展开全部简介' }}
            </button>
          </div>
        </section>

        <div class="notice-banner" v-if="limitReason">
          <span style="display:flex;align-items:center;gap:6px;">
            <app-icon name="info" :size="16" />
            <span>{{ limitReason }}</span>
          </span>
          <a
            :href="sourceUrl"
            target="_blank"
            rel="noopener noreferrer"
            style="color: var(--accent); font-weight: 600; white-space: nowrap;"
          >去官网 ↗</a>
        </div>

        <section class="section-card">
          <div class="section-title">
            <span>最新单集 ({{ episodes.length }})</span>
          </div>

          <div class="ep-list">
            <article v-for="ep in episodes" :key="ep.eid" class="ep-row" role="link" tabindex="0" :aria-label="ep.title"
              @click="$router.push('/episode/' + ep.eid)"
              @keydown.enter.self="$router.push('/episode/' + ep.eid)"
              @keydown.space.self.prevent="$router.push('/episode/' + ep.eid)">
              <div class="ep-row-top">
                <img v-cover
                  class="cover-thumb"
                  style="width: 52px; height: 52px;"
                  :src="ep.image || podcast.image"
                  :alt="ep.title"
                  loading="lazy"
                />
                <div style="flex:1; min-width:0;">
                  <h3 class="ep-row-title">
                    {{ ep.title }}
                  </h3>
                  <p v-if="ep.description" class="ep-row-desc">{{ ep.description }}</p>
                </div>
              </div>

              <div class="ep-row-footer">
                <div class="card-stats-line episode-stats tabular">
                  <span>{{ formatDateTime(ep.pubDate) }}</span>
                  <span class="stat-strong">{{ formatDurationSeconds(ep.duration) }}</span>
                  <span>▶ {{ formatCount(ep.playCount) }}</span>
                  <span>💬 {{ formatCount(ep.commentCount) }}</span>
                </div>

                <span v-if="progressPercent(ep.eid, ep.duration) > 0" class="genre-tag ep-progress">已听 {{ progressPercent(ep.eid, ep.duration) }}%</span>
                <div class="ep-actions" @click.stop>
                  <button
                    type="button"
                    class="btn sm"
                    :class="{ primary: isCurrentPlaying(ep.eid) }"
                    @click="playEpisode(ep)"
                  >
                    <app-icon :name="isCurrentPlaying(ep.eid) ? 'pause' : 'play'" :size="14" />
                    <span>{{ isCurrentPlaying(ep.eid) ? '暂停' : '播放' }}</span>
                  </button>
                  <button type="button" class="btn sm" @click="enqueueEpisode(ep)">
                    <app-icon :name="isInQueue(ep.eid) ? 'check' : 'plus'" :size="14" />
                    <span>{{ isInQueue(ep.eid) ? '已在队列' : '队列' }}</span>
                  </button>
                </div>
              </div>
            </article>
          </div>
        </section>
      </template>
    </div>
  `,
};
