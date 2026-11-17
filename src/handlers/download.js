import { errorJson } from "../utils/http.js";

const ALLOWED_AUDIO_EXACT_HOSTS = new Set([
  "media.xyzcdn.net",
  "media.xiaoyuzhoufm.com",
  "static.xiaoyuzhoufm.com",
]);

const ALLOWED_AUDIO_SUFFIXES = [".xyzcdn.net", ".xiaoyuzhoufm.com"];
const ALLOWED_AUDIO_EXTS = new Set([".m4a", ".mp3", ".aac", ".ogg", ".wav", ".flac", ".mp4"]);

/**
 * Validate whether a URL is an allowed HTTPS audio URL from XiaoYuZhou / xyzcdn.
 */
export function validateAudioUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return { ok: false, reason: "Missing url parameter" };
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { ok: false, reason: "Malformed URL" };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "Only https URLs are allowed" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "Credentials in URL are not allowed" };
  }
  if (parsed.port && parsed.port !== "443") {
    return { ok: false, reason: "Non-standard ports are not allowed" };
  }

  const host = parsed.hostname.toLowerCase();
  const hostAllowed =
    ALLOWED_AUDIO_EXACT_HOSTS.has(host) ||
    ALLOWED_AUDIO_SUFFIXES.some(
      (suffix) => host.endsWith(suffix) && host.length > suffix.length
    );

  if (!hostAllowed) {
    return { ok: false, reason: "Audio host is not in allowlist" };
  }

  return { ok: true, url: parsed };
}

/**
 * Sanitize requested filename and ensure an audio file extension.
 */
export function sanitizeDownloadFilename(rawName, sourcePathname = "") {
  const pathMatch = String(sourcePathname || "").match(/(\.[a-zA-Z0-9]{2,5})$/);
  const sourceExt =
    pathMatch && ALLOWED_AUDIO_EXTS.has(pathMatch[1].toLowerCase())
      ? pathMatch[1].toLowerCase()
      : ".m4a";

  let cleaned = String(rawName || "")
    .replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    cleaned = `podcast-episode${sourceExt}`;
  } else {
    const extMatch = cleaned.match(/(\.[a-zA-Z0-9]{2,5})$/);
    if (!extMatch || !ALLOWED_AUDIO_EXTS.has(extMatch[1].toLowerCase())) {
      cleaned = `${cleaned}${sourceExt}`;
    }
  }

  if (cleaned.length > 140) {
    const ext = cleaned.match(/(\.[a-zA-Z0-9]{2,5})$/)?.[1] || sourceExt;
    cleaned = `${cleaned.slice(0, 140 - ext.length).trim()}${ext}`;
  }

  return cleaned;
}

export async function handleAudioDownload(request, url) {
  const rawAudioUrl = url.searchParams.get("url");
  const check = validateAudioUrl(rawAudioUrl);
  if (!check.ok) {
    return errorJson(check.reason, check.reason.includes("allowlist") ? 403 : 400);
  }

  const rawFilename = url.searchParams.get("filename") || "";
  const safeFilename = sanitizeDownloadFilename(rawFilename, check.url.pathname);
  const ext = safeFilename.match(/(\.[a-zA-Z0-9]{2,5})$/)?.[1] || ".m4a";

  const upstreamHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Referer: "https://www.xiaoyuzhoufm.com/",
  };
  const range = request.headers.get("Range");
  if (range) {
    upstreamHeaders.Range = range;
  }

  const upstream = await fetch(check.url.toString(), {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers: upstreamHeaders,
    redirect: "follow",
  });

  if (!upstream.ok && upstream.status !== 206) {
    return errorJson(`Upstream audio responded with HTTP ${upstream.status}`, 502);
  }

  const respHeaders = new Headers();
  const contentType = upstream.headers.get("Content-Type") || "audio/mp4";
  respHeaders.set("Content-Type", contentType);
  const contentLength = upstream.headers.get("Content-Length");
  if (contentLength) respHeaders.set("Content-Length", contentLength);
  const contentRange = upstream.headers.get("Content-Range");
  if (contentRange) respHeaders.set("Content-Range", contentRange);
  const acceptRanges = upstream.headers.get("Accept-Ranges");
  if (acceptRanges) respHeaders.set("Accept-Ranges", acceptRanges);

  const encodedUtf8 = encodeURIComponent(safeFilename);
  respHeaders.set(
    "Content-Disposition",
    `attachment; filename="episode${ext}"; filename*=UTF-8''${encodedUtf8}`
  );
  respHeaders.set("X-Content-Type-Options", "nosniff");
  respHeaders.set("Cache-Control", "private, max-age=3600");

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  });
}
