export function smallImageUrl(src) {
  if (typeof src !== "string") return "";
  return src.trim().replace(
    /^((?:https?:)?\/\/(?:image\.xyzcdn\.net|xyzrank\.justinbot\.com)\/[^?#]+?)(?:(?:@|%40)(?:thumbnail|small|middle|large))*([?#].*)?$/i,
    "$1@small$2"
  );
}

export function originalRankImageUrl(src) {
  try {
    const proxy = new URL(src);
    if (proxy.hostname !== "xyzrank.justinbot.com") return "";

    // Some xyzrank covers encode the source URL in the proxy's image key.
    const key = /^\/([a-z0-9+/_-]+={0,2})\.[a-z0-9]+@small$/i
      .exec(decodeURIComponent(proxy.pathname))?.[1];
    if (!key) return "";

    const decoded = atob(key.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    const original = new URL(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (original.protocol !== "https:" || original.username || original.password ||
        original.hostname === proxy.hostname) return "";
    return original.href;
  } catch {
    return "";
  }
}

export function parsePodcastId(input) {
  const value = typeof input === "string" ? input.trim() : "";
  const idPattern = /^[a-zA-Z0-9]{16,40}$/;
  if (idPattern.test(value)) return value;

  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      !["www.xiaoyuzhoufm.com", "xiaoyuzhoufm.com"].includes(url.hostname) ||
      url.port || url.username || url.password
    ) return "";

    const pid = /^\/podcast\/([^/]+)\/?$/.exec(url.pathname)?.[1] || "";
    return idPattern.test(pid) ? pid : "";
  } catch {
    return "";
  }
}

/**
 * Format seconds into MM:SS or HH:MM:SS.
 */
export function formatDurationSeconds(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const mm = String(mins).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  if (hrs > 0) {
    return `${hrs}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Format minutes (from xyzrank) concisely.
 */
export function formatMinutes(minutes) {
  const m = Math.round(Number(minutes) || 0);
  if (m <= 0) return "-";
  return `${m}′`;
}

/**
 * Format large integer counts into concise Chinese units (e.g. 42.9万).
 */
export function formatCount(num) {
  const n = Number(num);
  if (!Number.isFinite(n) || n < 0) return "-";
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}亿`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(Math.round(n));
}

export function formatPercent(ratio) {
  const n = Number(ratio);
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(1)}%`;
}

export function formatRelativeDays(daysFloat) {
  const n = Number(daysFloat);
  if (!Number.isFinite(n)) return "-";
  if (n < 1) return "今天";
  return `${Math.round(n)}天前`;
}

export function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Compute episode listening progress percentage (0 to 100) for visual progress bars.
 */
export function computeProgressPercent(
  entry,
  fallbackDurationSec = 0,
  { minSeconds = 5 } = {}
) {
  if (!entry) return 0;
  if (entry.finished) return 100;
  const cur = Number(entry.currentTime) || 0;
  if (!(cur > minSeconds)) return 0;
  const dur = Number(entry.duration) || Number(fallbackDurationSec) || 0;
  if (!(dur > 0)) return 0;
  return Math.min(99.5, Math.max(1, Number(((cur / dur) * 100).toFixed(1))));
}

/**
 * Format saved episode progress into a unified badge label ("已播完", "已听 XX%", etc.).
 */
export function formatProgressBadge(
  entry,
  fallbackDurationSec = 0,
  { includeTime = false, minSeconds = 5 } = {}
) {
  if (!entry) return "";
  if (entry.finished) return "已播完";
  const cur = Number(entry.currentTime) || 0;
  if (!(cur > minSeconds)) return "";
  const dur = Number(entry.duration) || Number(fallbackDurationSec) || 0;
  if (dur > 0) {
    const pct = Math.min(99, Math.max(1, Math.round((cur / dur) * 100)));
    return includeTime ? `已听 ${pct}% (${formatDurationSeconds(cur)})` : `已听 ${pct}%`;
  }
  return includeTime ? `听至 ${formatDurationSeconds(cur)}` : "";
}

/**
 * Parse HH:MM:SS or MM:SS timestamp text into total seconds.
 */
export function parseTimestampToSeconds(ts) {
  if (typeof ts !== "string") return null;
  const parts = ts.trim().split(":").map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) {
    const [m, s] = parts;
    if (s >= 60) return null;
    return m * 60 + s;
  }
  if (parts.length === 3) {
    const [h, m, s] = parts;
    if (m >= 60 || s >= 60) return null;
    return h * 3600 + m * 60 + s;
  }
  return null;
}

/**
 * Split plain text (such as comments and replies) into safe text/timestamp tokens
 * without using HTML injection, optionally ignoring timestamps beyond maxSeconds.
 */
export function parseTextWithTimestamps(text, maxSeconds = 0) {
  const raw = String(text ?? "");
  if (!raw) return [];

  const maxDur = Number(maxSeconds) > 0 ? Number(maxSeconds) : 0;
  const regex = /(?<![\d:])((?:\d{1,2}:)?\d{1,2}:\d{2})(?!\d)/g;
  const segments = [];
  let lastIndex = 0;

  for (const match of raw.matchAll(regex)) {
    const token = match[1];
    const start = match.index ?? 0;
    const secs = parseTimestampToSeconds(token);
    if (secs === null || (maxDur > 0 && secs > maxDur)) {
      continue;
    }
    if (start > lastIndex) {
      segments.push({ type: "text", text: raw.slice(lastIndex, start) });
    }
    segments.push({ type: "ts", text: token, seconds: secs });
    lastIndex = start + token.length;
  }

  if (lastIndex < raw.length) {
    segments.push({ type: "text", text: raw.slice(lastIndex) });
  }
  return segments;
}

/**
 * Replace timestamps in plain text segments (never touching HTML tags or anchor contents)
 * with clickable jump buttons.
 */
export function injectTimestampButtons(sanitizedHtml) {
  if (typeof sanitizedHtml !== "string" || !sanitizedHtml) return "";

  // First convert XiaoYuZhou's native <a class="timestamp" data-timestamp="282">04:42</a>
  const withNativeTs = sanitizedHtml.replace(
    /<a\b([^>]*\bdata-timestamp=["'](\d+)["'][^>]*)>([\s\S]*?)<\/a>/gi,
    (_m, _attrs, secs, label) =>
      `<button type="button" class="ts-jump-btn" data-seconds="${secs}">${label}</button>`
  );

  // Then split around HTML tags so plain-text timestamps outside <a>/<button> also work
  const tokens = withNativeTs.split(/(<[^>]+>)/g);
  let interactiveDepth = 0;

  return tokens
    .map((token) => {
      if (token.startsWith("<")) {
        if (/^<(?:a|button)[\s>]/i.test(token)) interactiveDepth += 1;
        else if (/^<\/(?:a|button)>/i.test(token)) interactiveDepth = Math.max(0, interactiveDepth - 1);
        return token;
      }
      if (interactiveDepth > 0) return token;

      return token.replace(
        /(?<![\d:])((?:\d{1,2}:)?\d{1,2}:\d{2})(?!\d)/g,
        (match) => {
          const secs = parseTimestampToSeconds(match);
          if (secs === null) return match;
          return `<button type="button" class="ts-jump-btn" data-seconds="${secs}">${match}</button>`;
        }
      );
    })
    .join("");
}

/**
 * Sanitize shownotes before converting timestamps and rendering the markup.
 */
export function renderShownotesHtml(rawHtml, purify) {
  if (typeof rawHtml !== "string" || !rawHtml || !purify?.isSupported) return "";
  const clean = purify.sanitize(rawHtml, {
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
    ADD_ATTR: ["target", "rel", "data-timestamp"],
    RETURN_DOM_FRAGMENT: true,
  });
  for (const img of clean.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src");
    const smallSrc = smallImageUrl(src);
    if (smallSrc !== src) img.setAttribute("src", smallSrc);
  }
  const template = document.createElement("template");
  template.content.append(clean);
  // Ensure external links open safely in a new tab (skip timestamp anchors)
  const withSafeLinks = template.innerHTML.replace(
    /<a\b([^>]*?)>/gi,
    (m, attrs) => {
      if (/\bdata-timestamp\b/i.test(attrs)) return m;
      return `<a${attrs.replace(/\btarget\s*=\s*["'][^"']*["']/gi, "").replace(/\brel\s*=\s*["'][^"']*["']/gi, "")} target="_blank" rel="noopener noreferrer">`;
    }
  );
  return injectTimestampButtons(withSafeLinks);
}

// Optional browser libraries share one in-flight request per URL.
const pendingScripts = new Map();

function loadScript(url, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (pendingScripts.has(url)) return pendingScripts.get(url);

  const script = document.createElement("script");
  script.src = url;
  script.async = true;

  const pending = new Promise((resolve, reject) => {
    const fail = () => {
      script.remove();
      reject(new Error(`Unable to load ${globalName}`));
    };
    script.onload = () => {
      const library = window[globalName];
      if (library) resolve(library);
      else fail();
    };
    script.onerror = fail;
    document.head.append(script);
  }).finally(() => pendingScripts.delete(url));

  pendingScripts.set(url, pending);
  return pending;
}

export function loadDOMPurify() {
  return loadScript("https://unpkg.com/dompurify@3.4.18/dist/purify.min.js", "DOMPurify");
}

export function loadSortable() {
  return loadScript("https://unpkg.com/sortablejs@1.15.7/Sortable.min.js", "Sortable");
}

/**
 * Shared Vue Options API mixin for <keep-alive> views to preserve vertical scroll position
 * across detail/back navigation without losing state or triggering redundant reloads.
 */
export const scrollKeeperMixin = {
  data() {
    return {
      isKeepAliveActive: false,
      savedScrollY: 0,
      _scrollKeeperFn: null,
    };
  },
  mounted() {
    this.isKeepAliveActive = true;
    if (typeof window !== "undefined") {
      window.scrollTo(0, 0);
      this.attachScrollKeeper();
    }
  },
  activated() {
    this.isKeepAliveActive = true;
    if (typeof this.onKeepAliveActivated === "function") {
      const handled = this.onKeepAliveActivated(this.savedScrollY || 0);
      if (handled) return;
    }
    if (typeof window !== "undefined") {
      this.$nextTick(() => {
        requestAnimationFrame(() => {
          if (!this.isKeepAliveActive) return;
          const targetY = this.savedScrollY || 0;
          window.scrollTo(0, targetY);
          this.attachScrollKeeper();
          if (typeof this.onAfterScrollRestore === "function") {
            this.onAfterScrollRestore(targetY);
          }
        });
      });
    }
  },
  deactivated() {
    this.isKeepAliveActive = false;
    this.detachScrollKeeper();
    if (typeof this.onKeepAliveDeactivated === "function") {
      this.onKeepAliveDeactivated();
    }
  },
  beforeUnmount() {
    this.isKeepAliveActive = false;
    this.detachScrollKeeper();
  },
  beforeRouteLeave() {
    if (typeof window !== "undefined") {
      this.savedScrollY = window.scrollY || 0;
      // Router scrolling can happen while the leaving transition is still mounted.
      this.isKeepAliveActive = false;
      this.detachScrollKeeper();
    }
  },
  methods: {
    attachScrollKeeper() {
      if (this._scrollKeeperFn || typeof window === "undefined") return;
      this._scrollKeeperFn = () => {
        if (this.isKeepAliveActive) {
          this.savedScrollY = window.scrollY || 0;
        }
      };
      window.addEventListener("scroll", this._scrollKeeperFn, { passive: true });
    },
    detachScrollKeeper() {
      if (!this._scrollKeeperFn || typeof window === "undefined") return;
      window.removeEventListener("scroll", this._scrollKeeperFn);
      this._scrollKeeperFn = null;
    },
  },
};

/**
 * Shared Vue Options API mixin for inline two-step confirmation on destructive buttons
 * (1st tap arms red confirmation state for 3.5s; 2nd tap executes; tapping elsewhere disarms).
 */
export const inlineConfirmMixin = {
  data() {
    return {
      confirmingClear: false,
      _clearConfirmTimer: null,
    };
  },
  beforeUnmount() {
    this.resetClearConfirm();
  },
  methods: {
    resetClearConfirm() {
      this.confirmingClear = false;
      if (this._clearConfirmTimer) {
        clearTimeout(this._clearConfirmTimer);
        this._clearConfirmTimer = null;
      }
    },
    triggerInlineClearConfirm(onConfirmed, timeoutMs = 3500) {
      if (!this.confirmingClear) {
        this.confirmingClear = true;
        clearTimeout(this._clearConfirmTimer);
        this._clearConfirmTimer = setTimeout(() => {
          this.confirmingClear = false;
          this._clearConfirmTimer = null;
        }, timeoutMs);
        return false;
      }
      this.resetClearConfirm();
      if (typeof onConfirmed === "function") {
        onConfirmed();
      }
      return true;
    },
    onConfirmScopePointerDown(evt) {
      if (this.confirmingClear && !evt?.target?.closest?.("[data-clear-confirm]")) {
        this.resetClearConfirm();
      }
    },
  },
};

/**
 * Compute visible [startIndex, endIndex) window and spacer heights for a variable-height virtual list.
 * Supports Map or plain object/array heightCache keyed by item index.
 */
export function computeVirtualWindow({
  count,
  scrollRelTop = 0,
  viewportHeight = 800,
  overscanPx = 500,
  defaultHeight = 132,
  heightCache = null,
}) {
  const n = Math.max(0, Number(count) || 0);
  if (n === 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      topSpacerPx: 0,
      bottomSpacerPx: 0,
      totalHeight: 0,
    };
  }

  const est = Math.max(24, Number(defaultHeight) || 132);
  const overscan = Math.max(0, Number(overscanPx) || 0);
  const viewH = Math.max(0, Number(viewportHeight) || 0);
  const relTop = Number.isFinite(Number(scrollRelTop)) ? Number(scrollRelTop) : 0;

  const getItemHeight = (idx) => {
    if (!heightCache) return est;
    const v =
      typeof heightCache.get === "function"
        ? heightCache.get(idx)
        : heightCache[idx];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : est;
  };

  const offsets = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) {
    offsets[i + 1] = offsets[i] + getItemHeight(i);
  }
  const totalHeight = offsets[n];

  const windowTop = Math.max(0, relTop - overscan);
  const windowBottom = Math.min(totalHeight, relTop + viewH + overscan);

  if (windowBottom <= windowTop) {
    if (windowTop >= totalHeight) {
      return {
        startIndex: n,
        endIndex: n,
        topSpacerPx: Math.round(totalHeight),
        bottomSpacerPx: 0,
        totalHeight: Math.round(totalHeight),
      };
    }
    return {
      startIndex: 0,
      endIndex: 0,
      topSpacerPx: 0,
      bottomSpacerPx: Math.round(totalHeight),
      totalHeight: Math.round(totalHeight),
    };
  }

  let lo = 0;
  let hi = n - 1;
  let startIndex = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1] > windowTop) {
      startIndex = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  let endIndex = startIndex + 1;
  while (endIndex < n && offsets[endIndex] < windowBottom) {
    endIndex += 1;
  }

  return {
    startIndex,
    endIndex,
    topSpacerPx: Math.round(offsets[startIndex]),
    bottomSpacerPx: Math.round(Math.max(0, totalHeight - offsets[endIndex])),
    totalHeight: Math.round(totalHeight),
  };
}

/**
 * Determine whether a global PC keyboard shortcut should be suppressed
 * so native typing, IME composition, browser combos, and button activation stay intact.
 */
export function shouldIgnoreGlobalHotkey(event) {
  if (!event || event.defaultPrevented) return true;
  if (event.ctrlKey || event.metaKey || event.altKey) return true;
  if (event.isComposing || event.keyCode === 229) return true;

  const target = event.target;
  if (!target || typeof target !== "object") return false;
  if (target.isContentEditable) return true;

  const tag = String(target.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }

  // Space activates focused buttons/links natively — never hijack focused interactive controls
  if (event.key === " " || event.code === "Space") {
    if (tag === "BUTTON" || tag === "A" || tag === "SUMMARY") return true;
    if (typeof target.closest === "function") {
      if (target.closest('button, a[href], summary, [role="button"], [role="link"]')) {
        return true;
      }
    }
  }

  return false;
}
