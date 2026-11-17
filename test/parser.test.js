import test from "node:test";
import assert from "node:assert/strict";
import { extractNextData, parseEpisodePage, parsePodcastPage } from "../src/utils/parser.js";

function wrapNextHtml(pageProps) {
  const payload = JSON.stringify({ props: { pageProps } });
  return `<!DOCTYPE html><html><head><title>test</title></head><body><script id="__NEXT_DATA__" type="application/json">${payload}</script></body></html>`;
}

test("extractNextData parses Next.js SSR JSON and throws on missing or invalid data", () => {
  const html = wrapNextHtml({ hello: "world" });
  assert.deepEqual(extractNextData(html).props.pageProps, { hello: "world" });
  assert.throws(() => extractNextData("<html><body>no next</body></html>"), /Missing __NEXT_DATA__/);
  assert.throws(
    () => extractNextData('<script id="__NEXT_DATA__" type="application/json">{bad</script>'),
    /Failed to parse __NEXT_DATA__/
  );
});

test("parsePodcastPage extracts podcast metadata and inherits image for episodes", () => {
  const html = wrapNextHtml({
    podcast: {
      pid: "625635587bfca4e73e990703",
      title: "岩中花述",
      author: "GIADA",
      subscriptionCount: 10000,
      episodeCount: 87,
      image: { picUrl: "https://image.xyzcdn.net/pod.jpg" },
      episodes: [
        {
          eid: "ep001",
          title: "第一期",
          duration: 3600,
          enclosure: { url: "https://media.xyzcdn.net/test.m4a" },
          image: null,
          payType: "FREE",
        },
      ],
    },
  });

  const parsed = parsePodcastPage(html, "625635587bfca4e73e990703");
  assert.equal(parsed.podcast.pid, "625635587bfca4e73e990703");
  assert.equal(parsed.podcast.episodeCount, 87);
  assert.equal(parsed.episodes.length, 1);
  assert.equal(parsed.episodes[0].duration, 3600);
  assert.equal(parsed.episodes[0].image, "https://image.xyzcdn.net/pod.jpg");
  assert.equal(parsed.limited, true);
});

test("parseEpisodePage extracts episode, podcast link, shownotes, and nested comments", () => {
  const html = wrapNextHtml({
    episode: {
      eid: "6aec7f8c5b7c4709bfe1a757",
      title: "单集标题",
      duration: 4669,
      shownotes: "<p>01:23 开场</p>",
      payType: "PAY_EPISODE",
      enclosure: { url: "https://media.xyzcdn.net/audio.m4a" },
      podcast: {
        pid: "620e4b8f52d497504647ce24",
        title: "霓达播客",
        image: { thumbnailUrl: "https://image.xyzcdn.net/pod.jpg" },
      },
    },
    comments: [
      {
        id: "c1",
        text: "置顶评论",
        pinned: true,
        likeCount: 71,
        ipLoc: "四川",
        author: { uid: "u1", nickname: "主播", avatar: { picture: { smallPicUrl: "https://image.xyzcdn.net/u1.jpg" } } },
        replies: [
          {
            id: "r1",
            text: "回复内容",
            author: { uid: "u2", nickname: "听友" },
            replyToComment: { author: { nickname: "主播" } },
          },
        ],
      },
    ],
  });

  const parsed = parseEpisodePage(html, "6aec7f8c5b7c4709bfe1a757");
  assert.equal(parsed.episode.podcast.pid, "620e4b8f52d497504647ce24");
  assert.equal(parsed.episode.payType, "PAY_EPISODE");
  assert.equal(parsed.episode.image, "https://image.xyzcdn.net/pod.jpg");
  assert.equal(parsed.comments.length, 1);
  assert.equal(parsed.comments[0].pinned, true);
  assert.equal(parsed.comments[0].replies[0].replyToNickname, "主播");
  assert.equal(parsed.limited, true);
});
