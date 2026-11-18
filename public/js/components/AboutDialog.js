import AppIcon from "./AppIcon.js";

export default {
  name: "AboutDialog",
  components: { AppIcon },
  props: { open: Boolean },
  emits: ["close"],
  methods: {
    onTouchStart(event) {
      this._touchY = event.touches[0]?.clientY;
    },
    onTouchMove(event) {
      if (event.touches.length !== 1) return;
      const y = event.touches[0].clientY;
      const delta = y - (this._touchY ?? y);
      this._touchY = y;
      const panel = this.$refs.panel;
      // Stop native scroll chaining, including iOS when the panel cannot scroll.
      const inside = panel?.contains(event.target);
      const atTop = panel && panel.scrollTop <= 0;
      const atBottom = panel && panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 1;
      if (!inside || panel.scrollHeight <= panel.clientHeight || (atTop && delta > 0) || (atBottom && delta < 0)) {
        if (event.cancelable) event.preventDefault();
      }
    },
  },
  template: `
    <transition name="about-dialog">
      <div v-if="open" class="about-backdrop" @click.self="$emit('close')" @touchstart.passive="onTouchStart" @touchmove.stop="onTouchMove">
        <section ref="panel" class="about-panel" role="dialog" aria-modal="true" aria-labelledby="about-title" v-dialog-focus="() => $emit('close')">
          <div class="about-heading">
            <span class="about-eyebrow">ABOUT THE PROJECT</span>
            <button type="button" class="icon-btn" aria-label="关闭项目介绍" @click="$emit('close')"><app-icon name="x" :size="20" /></button>
          </div>
          <div class="brand-mark about-mark"><app-icon name="headphones" :size="24" /></div>
          <h2 id="about-title">小宇宙播客热榜</h2>
          <p class="about-lead">发现好播客，让收听更简单。</p>
          <div class="about-copy">
            <p>一个独立开源的播客发现与在线收听项目。汇集热门节目、热门播客与新作榜单，帮你找到下一期想听的声音。</p>
            <p>边逛边听，切换页面也不断播。支持播放队列、关注播客、收听历史备份与断点续播，还可以通过节目与热评中的时间戳跳到感兴趣的段落。</p>
          </div>
          <div class="about-shortcuts" aria-label="桌面端键盘快捷键">
            <div class="about-shortcuts-title"><app-icon name="keyboard" :size="14" /><span>桌面端快捷键</span></div>
            <div class="about-shortcuts-grid">
              <span><kbd>Space</kbd> 播放/暂停</span>
              <span><kbd>←</kbd> <kbd>→</kbd> -15s / +30s</span>
              <span><kbd>[</kbd> <kbd>]</kbd> 倍速调节</span>
              <span><kbd>M</kbd> 静音 · <kbd>/</kbd> 搜索</span>
            </div>
          </div>
          <a class="about-github" href="https://github.com/icheer/xyz-podcast" target="_blank" rel="noopener noreferrer">
            <app-icon name="code" :size="21" />
            <span class="about-github-label"><strong>在 GitHub 查看项目</strong><span>icheer/xyz-podcast</span></span>
            <app-icon name="arrow-up-right" :size="18" />
          </a>
          <p class="about-credit">榜单来自 <a href="https://xyzrank.com/" target="_blank" rel="noopener noreferrer">中文播客榜</a>，节目资料来自 <a href="https://www.xiaoyuzhoufm.com/" target="_blank" rel="noopener noreferrer">小宇宙</a> 公开页面。本项目与小宇宙无官方关联，音频及节目内容版权归原权利人所有。</p>
        </section>
      </div>
    </transition>
  `,
};
