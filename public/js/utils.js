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
 * Sanitize raw shownotes HTML via DOMPurify (if present in browser) and convert timestamps.
 */
export function renderShownotesHtml(rawHtml) {
  if (typeof rawHtml !== "string" || !rawHtml) return "";
  let clean = rawHtml;
  if (typeof window !== "undefined" && window.DOMPurify) {
    clean = window.DOMPurify.sanitize(rawHtml, {
      FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
      ADD_ATTR: ["target", "rel", "data-timestamp"],
    });
    // Ensure external links open safely in a new tab (skip timestamp anchors)
    clean = clean.replace(
      /<a\b([^>]*?)>/gi,
      (m, attrs) => {
        if (/\bdata-timestamp\b/i.test(attrs)) return m;
        return `<a${attrs.replace(/\btarget\s*=\s*["'][^"']*["']/gi, "").replace(/\brel\s*=\s*["'][^"']*["']/gi, "")} target="_blank" rel="noopener noreferrer">`;
      }
    );
  }
  return injectTimestampButtons(clean);
}
