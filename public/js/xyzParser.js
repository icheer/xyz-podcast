function pickImageUrl(imageObj) {
  if (!imageObj || typeof imageObj !== "object") return "";
  const pic = imageObj.picture || imageObj;
  return (
    pic.picUrl ||
    pic.largePicUrl ||
    pic.middlePicUrl ||
    pic.smallPicUrl ||
    pic.thumbnailUrl ||
    ""
  );
}

/**
 * Extract and parse Next.js __NEXT_DATA__ JSON from XiaoYuZhou SSR HTML.
 */
export function extractNextData(html) {
  if (typeof html !== "string" || !html) {
    throw new Error("Empty HTML response from upstream");
  }
  const match = html.match(
    /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!match || !match[1]) {
    throw new Error("Missing __NEXT_DATA__ in XiaoYuZhou HTML");
  }
  try {
    return JSON.parse(match[1]);
  } catch (err) {
    throw new Error(`Failed to parse __NEXT_DATA__ JSON: ${err.message}`, { cause: err });
  }
}

function normalizeEpisodeSummary(ep, fallbackPid = "", fallbackImage = "") {
  return {
    eid: String(ep?.eid || ""),
    pid: String(ep?.pid || fallbackPid || ""),
    title: String(ep?.title || ""),
    description: String(ep?.description || ""),
    duration: Number(ep?.duration) || 0,
    pubDate: String(ep?.pubDate || ""),
    playCount: Number(ep?.playCount) || 0,
    commentCount: Number(ep?.commentCount) || 0,
    clapCount: Number(ep?.clapCount) || 0,
    favoriteCount: Number(ep?.favoriteCount) || 0,
    enclosureUrl: String(ep?.enclosure?.url || ep?.media?.source?.url || ""),
    mediaSize: Number(ep?.media?.size) || 0,
    mimeType: String(ep?.media?.mimeType || "audio/mp4"),
    image: pickImageUrl(ep?.image) || fallbackImage || "",
    payType: String(ep?.payType || "FREE"),
    isPrivateMedia: Boolean(ep?.isPrivateMedia),
  };
}

/**
 * Parse XiaoYuZhou podcast channel HTML into normalized podcast metadata + latest 15 episodes.
 */
export function parsePodcastPage(html, expectedPid = "") {
  const nextData = extractNextData(html);
  const pageProps = nextData?.props?.pageProps || {};
  const pod = pageProps.podcast;

  if (!pod || typeof pod !== "object") {
    const statusCode = pageProps.statusCode || 404;
    const err = new Error("Podcast not found on XiaoYuZhou");
    err.statusCode = statusCode === 200 ? 404 : statusCode;
    throw err;
  }

  const pid = String(pod.pid || expectedPid || "");
  const podcastImage = pickImageUrl(pod.image);
  const rawEpisodes = Array.isArray(pod.episodes) ? pod.episodes : [];

  const podcast = {
    pid,
    title: String(pod.title || ""),
    author: String(pod.author || ""),
    brief: String(pod.brief || ""),
    description: String(pod.description || ""),
    subscriptionCount: Number(pod.subscriptionCount) || 0,
    episodeCount: Number(pod.episodeCount) || rawEpisodes.length,
    payType: String(pod.payType || "FREE"),
    image: podcastImage,
    podcasters: Array.isArray(pod.podcasters)
      ? pod.podcasters.map((p) => ({
          uid: String(p?.uid || ""),
          nickname: String(p?.nickname || ""),
          avatar: pickImageUrl(p?.avatar),
        }))
      : [],
    contacts: Array.isArray(pod.contacts) ? pod.contacts : [],
  };

  const episodes = rawEpisodes.map((ep) =>
    normalizeEpisodeSummary(ep, pid, podcastImage)
  );

  return {
    podcast,
    episodes,
    limited: true,
    limitReason: "网页端仅展示最新 15 集，查看全部历史单集请前往小宇宙 App",
    sourceUrl: `https://www.xiaoyuzhoufm.com/podcast/${pid}`,
  };
}

function normalizeComment(c, depth = 0) {
  const author = c?.author || {};
  const replies =
    depth < 1 && Array.isArray(c?.replies)
      ? c.replies.map((r) => normalizeComment(r, depth + 1))
      : [];

  return {
    id: String(c?.id || ""),
    text: String(c?.text || ""),
    likeCount: Number(c?.likeCount) || 0,
    createdAt: String(c?.createdAt || ""),
    pinned: Boolean(c?.pinned),
    ipLoc: String(c?.ipLoc || author?.ipLoc || ""),
    authorAssociation: String(c?.authorAssociation || "NONE"),
    author: {
      uid: String(author?.uid || ""),
      nickname: String(author?.nickname || "匿名听友"),
      avatar: pickImageUrl(author?.avatar),
    },
    badges: Array.isArray(c?.badges)
      ? c.badges
          .map((b) => ({
            tip: String(b?.tip || ""),
            iconUrl: String(b?.icon?.picUrl || ""),
          }))
          .filter((b) => b.iconUrl || b.tip)
      : [],
    replyToNickname: String(c?.replyToComment?.author?.nickname || ""),
    replyCount: Number(c?.replyCount) || replies.length,
    replies,
  };
}

/**
 * Parse XiaoYuZhou episode HTML into normalized episode details, shownotes, and hot comments.
 */
export function parseEpisodePage(html, expectedEid = "") {
  const nextData = extractNextData(html);
  const pageProps = nextData?.props?.pageProps || {};
  const ep = pageProps.episode;

  if (!ep || typeof ep !== "object") {
    const statusCode = pageProps.statusCode || 404;
    const err = new Error("Episode not found on XiaoYuZhou");
    err.statusCode = statusCode === 200 ? 404 : statusCode;
    throw err;
  }

  const rawPod = ep.podcast || {};
  const podcastImage = pickImageUrl(rawPod.image);
  const podcast = {
    pid: String(rawPod.pid || ep.pid || ""),
    title: String(rawPod.title || ""),
    author: String(rawPod.author || ""),
    subscriptionCount: Number(rawPod.subscriptionCount) || 0,
    image: podcastImage,
    payType: String(rawPod.payType || "FREE"),
  };

  const summary = normalizeEpisodeSummary(ep, podcast.pid, podcastImage);
  const eid = summary.eid || expectedEid;

  const episode = {
    ...summary,
    eid,
    shownotes: String(ep.shownotes || ep.description || ""),
    podcast,
  };

  const rawComments = Array.isArray(pageProps.comments) ? pageProps.comments : [];
  const comments = rawComments.map((c) => normalizeComment(c, 0));

  return {
    episode,
    comments,
    limited: true,
    limitReason: "当前展示网页端热门精选评论，查看更多评论请前往小宇宙 App",
    sourceUrl: `https://www.xiaoyuzhoufm.com/episode/${eid}`,
  };
}
