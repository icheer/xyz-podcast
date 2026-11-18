import { fetchEpisodeDetail } from "../api.js";
import { resolveResumeSeconds } from "../storage.js";
import {
  formatCount,
  formatDateTime,
  formatDurationSeconds,
  loadDOMPurify,
  parseTextWithTimestamps,
  renderShownotesHtml,
} from "../utils.js";
import AppIcon from "./AppIcon.js";

export default {
  name: "EpisodeView",
  components: { AppIcon },
  inject: ["player", "playerActions"],
  data() {
    return {
      loading: true,
      errorMsg: "",
      episode: null,
      comments: [],
      expandedReplies: {},
      shownotesHtml: null,
      shownotesExpanded: false,
      shownotesCanCollapse: false,
      sourceUrl: "",
      limitReason: "",
    };
  },
  computed: {
    eid() {
      return this.$route.params.eid;
    },
    hasHistoryBack() {
      void this.$route.fullPath;
      return Boolean(typeof window !== "undefined" && window.history.state?.back);
    },
    isCurrent() {
      return this.player.currentEid === this.eid;
    },
    isCurrentPlaying() {
      return this.isCurrent && this.player.isPlaying;
    },
    isInQueue() {
      return this.player.queue.some((t) => t.eid === this.eid);
    },
    resumeSeconds() {
      if (!this.episode) return 0;
      const entry = this.player.progressMap[this.eid];
      return resolveResumeSeconds(entry, this.episode.duration);
    },
    displayResumeSeconds() {
      if (this.isCurrent) {
        return this.player.currentTime > 5 ? this.player.currentTime : 0;
      }
      return this.resumeSeconds;
    },
    hasShownotesTimestamps() {
      if (!this.shownotesHtml) return false;
      const template = document.createElement("template");
      template.innerHTML = this.shownotesHtml;
      return Boolean(template.content.querySelector("button.ts-jump-btn[data-seconds]"));
    },
    isPaidContent() {
      const p = this.episode?.payType;
      return Boolean(p && p !== "FREE");
    },
  },
  watch: {
    eid: {
      immediate: true,
      handler() {
        this.loadData();
      },
    },
  },
  beforeUnmount() {
    this._episodeRequest = null;
    this._shownotesObserver?.disconnect();
  },
  methods: {
    formatCount,
    formatDateTime,
    formatDurationSeconds,
    observeShownotes() {
      this._shownotesObserver?.disconnect();
      const body = this.$refs.shownotesBody;
      if (!body) return;
      const measure = () => {
        this.shownotesCanCollapse = body.getBoundingClientRect().height > 241;
      };
      measure();
      this._shownotesObserver = new ResizeObserver(measure);
      this._shownotesObserver.observe(body);
    },
    toggleShownotes() {
      this.shownotesExpanded = !this.shownotesExpanded;
      if (!this.shownotesExpanded) {
        const section = this.$refs.shownotesSection;
        const headerHeight = document.querySelector('.site-header')?.getBoundingClientRect().height || 0;
        if (section.getBoundingClientRect().top < headerHeight) {
          window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top - headerHeight - 16 });
          this.$refs.shownotesTitle.focus({ preventScroll: true });
        }
      }
    },
    async loadData() {
      if (!this.eid) return;
      this.loading = true;
      this._shownotesObserver?.disconnect();
      this.shownotesHtml = null;
      this.shownotesExpanded = false;
      this.shownotesCanCollapse = false;
      this.errorMsg = "";
      const request = fetchEpisodeDetail(this.eid);
      this._episodeRequest = request;
      const purifyReady = loadDOMPurify().catch(() => null);
      try {
        const res = await request;
        if (this._episodeRequest !== request) return;
        this.episode = res.episode;
        this.comments = res.comments || [];
        this.sourceUrl = res.sourceUrl || `https://www.xiaoyuzhoufm.com/episode/${this.eid}`;
        this.limitReason = res.limitReason || "";
      } catch (err) {
        if (this._episodeRequest !== request) return;
        this.errorMsg = err?.message || "加载单集详情失败";
        this.loading = false;
        return;
      }

      this.loading = false;
      const rawHtml = this.episode?.shownotes;
      if (!rawHtml) return;
      const html = await purifyReady.then(purify => renderShownotesHtml(rawHtml, purify)).catch(() => "");
      if (this._episodeRequest !== request) return;
      this.shownotesHtml = html;
      this.$nextTick(this.observeShownotes);
    },
    buildTrack() {
      const ep = this.episode;
      return {
        eid: ep.eid,
        pid: ep.podcast?.pid || ep.pid || "",
        title: ep.title,
        podcastName: ep.podcast?.title || "",
        image: ep.image || ep.podcast?.image || "",
        duration: ep.duration,
        enclosureUrl: ep.enclosureUrl,
        payType: ep.payType,
        link: this.sourceUrl,
      };
    },
    handlePlayClick() {
      if (!this.episode?.enclosureUrl) {
        this.playerActions.showToast("当前单集没有可用的公开音频地址");
        return;
      }
      if (this.isCurrent) {
        this.playerActions.togglePlay();
        return;
      }
      this.playerActions.playTrack(this.buildTrack());
    },
    handleEnqueue() {
      if (!this.episode?.enclosureUrl) {
        this.playerActions.showToast("当前单集没有可用的公开音频地址");
        return;
      }
      this.playerActions.enqueueTrack(this.buildTrack());
    },
    handlePlayNext() {
      if (!this.episode?.enclosureUrl) {
        this.playerActions.showToast("当前单集没有可用的公开音频地址");
        return;
      }
      this.playerActions.enqueueNext(this.buildTrack());
    },
    commentSegments(text) {
      return parseTextWithTimestamps(text, this.episode?.duration || 0);
    },
    jumpToEpisodeSeconds(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) return;
      if (!this.episode?.enclosureUrl) {
        this.playerActions.showToast("暂无可用音频地址");
        return;
      }
      if (this.isCurrent) {
        this.playerActions.seekTo(seconds);
        if (!this.player.isPlaying) {
          this.playerActions.togglePlay();
        }
      } else {
        this.playerActions.playTrack(this.buildTrack(), { seekTo: seconds });
      }
      this.playerActions.showToast(`已跳转到 ${formatDurationSeconds(seconds)}`);
    },
    onShownotesClick(evt) {
      const btn = evt.target?.closest?.(".ts-jump-btn");
      if (!btn) return;
      const seconds = Number(btn.getAttribute("data-seconds"));
      this.jumpToEpisodeSeconds(seconds);
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
        <div v-for="n in 3" :key="n" class="skeleton-card"><span class="skeleton-cover"></span><span class="skeleton-copy"><i></i><i></i></span></div>
      </div>

      <div v-else-if="errorMsg" class="state-box error">
        <p>{{ errorMsg }}</p>
        <div style="margin-top: 12px; display: flex; gap: 8px; justify-content: center;">
          <button type="button" class="btn sm" @click="loadData">重试</button>
          <a
            class="btn sm primary"
            :href="'https://www.xiaoyuzhoufm.com/episode/' + eid"
            target="_blank"
            rel="noopener noreferrer"
          >去小宇宙官网查看</a>
        </div>
      </div>

      <template v-else-if="episode">
        <section class="hero-card">
          <div class="hero-main">
            <img v-cover class="hero-cover" :src="episode.image" :alt="episode.title" />
            <div class="hero-info">
              <router-link
                v-if="episode.podcast?.pid"
                :to="'/podcast/' + episode.podcast.pid"
                class="podcast-link-pill"
              >
                <img v-cover v-if="episode.podcast.image" :src="episode.podcast.image" :alt="episode.podcast.title" />
                <span>{{ episode.podcast.title }}</span>
                <app-icon name="arrow-right" :size="13" />
              </router-link>

              <h1 class="hero-title">{{ episode.title }}</h1>

              <div class="hero-meta tabular">
                <span><app-icon name="clock" :size="13" /> {{ formatDurationSeconds(episode.duration) }}</span>
                <span>{{ formatDateTime(episode.pubDate) }}</span>
                <span>▶ {{ formatCount(episode.playCount) }}</span>
                <span>👏 {{ formatCount(episode.clapCount) }}</span>
                <span>💬 {{ formatCount(episode.commentCount) }}</span>
              </div>
            </div>
          </div>

          <div class="hero-actions">
            <button type="button" class="btn primary" @click="handlePlayClick">
              <app-icon :name="isCurrentPlaying ? 'pause' : 'play'" :size="16" />
              <span v-if="isCurrentPlaying">暂停播放</span>
              <span v-else-if="displayResumeSeconds > 0">继续播放 ({{ formatDurationSeconds(displayResumeSeconds) }})</span>
              <span v-else>播放本集</span>
            </button>

            <button type="button" class="btn" @click="handleEnqueue">
              <app-icon :name="isInQueue ? 'check' : 'plus'" :size="16" />
              <span>{{ isInQueue ? '已在队列中' : '加入播放列表' }}</span>
            </button>

            <button
              v-if="player.currentEid && !isCurrent"
              type="button"
              class="btn"
              @click="handlePlayNext"
            >
              <app-icon name="play" :size="15" />
              <span>下一首播放</span>
            </button>
          </div>
        </section>

        <div class="notice-banner warn" v-if="isPaidContent">
          <span style="display:flex;align-items:center;gap:6px;">
            <app-icon name="triangle-alert" :size="16" />
            <span>本集为付费/订阅限定节目（{{ episode.payType }}），未登录状态下可能仅支持试听片段。</span>
          </span>
        </div>

        <section class="section-card reading-section" ref="shownotesSection">
          <div class="section-title" ref="shownotesTitle" tabindex="-1">
            <span>Shownotes 节目简介</span>
            <span v-if="hasShownotesTimestamps" style="font-size: 12px; font-weight: 400; color: var(--text-muted);">点击文内时间戳可跳转</span>
          </div>
          <template v-if="shownotesHtml">
            <div :id="'shownotes-' + eid" class="shownotes-preview" :class="{ 'is-collapsed': !shownotesExpanded, 'has-fade': shownotesCanCollapse && !shownotesExpanded }">
              <div
                ref="shownotesBody"
                class="shownotes-body"
                :inert="shownotesCanCollapse && !shownotesExpanded ? true : null"
                v-html="shownotesHtml"
                @click="onShownotesClick"
              ></div>
            </div>
            <button v-if="shownotesCanCollapse" type="button" class="shownotes-toggle" :aria-expanded="shownotesExpanded" :aria-controls="'shownotes-' + eid" @click="toggleShownotes">
              <span>{{ shownotesExpanded ? '收起节目简介' : '展开完整节目简介' }}</span>
              <app-icon :name="shownotesExpanded ? 'chevron-up' : 'chevron-down'" :size="16" />
            </button>
          </template>
          <p v-else style="color: var(--text-muted);">{{ !episode.shownotes ? '暂无节目简介' : shownotesHtml === null ? '正在加载节目简介…' : '节目简介暂不可用' }}</p>
        </section>

        <section class="section-card reading-section">
          <div class="section-title">
            <span>热门评论 ({{ comments.length }})</span>
          </div>

          <div class="notice-banner" v-if="limitReason">
            <span style="display:flex;align-items:center;gap:6px;">
              <app-icon name="info" :size="15" />
              <span>{{ limitReason }}</span>
            </span>
            <a :href="sourceUrl" target="_blank" rel="noopener noreferrer" style="color:var(--accent);font-weight:600;white-space:nowrap;">
              看全部 ↗
            </a>
          </div>

          <div v-if="comments.length === 0" style="color: var(--text-muted);">暂无评论</div>

          <div class="comment-list" v-else>
            <article v-for="c in comments" :key="c.id" class="comment-item">
              <div class="comment-head">
                <img v-cover class="comment-avatar" :src="c.author.avatar" :alt="c.author.nickname" loading="lazy" />
                <div style="flex:1; min-width:0;">
                  <div class="comment-author">
                    <span>{{ c.author.nickname }}</span>
                    <span v-if="c.pinned" class="comment-tag">置顶</span>
                    <span v-if="c.authorAssociation === 'PODCASTER'" class="comment-tag">主播</span>
                    <span
                      v-for="(b, bi) in c.badges"
                      :key="bi"
                      class="comment-tag"
                      :title="b.tip"
                    >{{ b.tip || '认证徽章' }}</span>
                  </div>
                  <div class="comment-meta tabular">
                    {{ formatDateTime(c.createdAt) }}
                    <span v-if="c.ipLoc"> · {{ c.ipLoc }}</span>
                  </div>
                </div>
                <div class="comment-meta tabular" style="display:flex;align-items:center;gap:4px;">
                  <app-icon name="heart" :size="13" />
                  <span>{{ c.likeCount }}</span>
                </div>
              </div>

              <div class="comment-text"><template v-for="(seg, si) in commentSegments(c.text)" :key="si"><button v-if="seg.type === 'ts'" type="button" class="ts-jump-btn comment-ts-btn" @click="jumpToEpisodeSeconds(seg.seconds)">{{ seg.text }}</button><template v-else>{{ seg.text }}</template></template></div>

              <div v-if="c.replies && c.replies.length > 0" class="comment-replies" :class="{ collapsed: c.replies.length >= 3 && !expandedReplies[c.id] }" :id="'replies-' + c.id">
                <div v-for="r in c.replies" :key="r.id" class="reply-item">
                  <strong>{{ r.author.nickname }}</strong>
                  <span v-if="r.replyToNickname" style="color: var(--text-muted);"> 回复 @{{ r.replyToNickname }}</span>：<template v-for="(seg, si) in commentSegments(r.text)" :key="si"><button v-if="seg.type === 'ts'" type="button" class="ts-jump-btn comment-ts-btn" @click="jumpToEpisodeSeconds(seg.seconds)">{{ seg.text }}</button><template v-else>{{ seg.text }}</template></template>
                </div>
              </div>
              <button v-if="c.replies?.length >= 3" type="button" class="replies-toggle" :aria-expanded="!!expandedReplies[c.id]" :aria-controls="'replies-' + c.id" @click="expandedReplies[c.id] = !expandedReplies[c.id]">{{ expandedReplies[c.id] ? '收起回复' : '展开回复 (' + c.replies.length + ')' }}</button>
            </article>
          </div>
        </section>
      </template>
    </div>
  `,
};
