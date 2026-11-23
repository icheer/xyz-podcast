import test from "node:test";
import assert from "node:assert/strict";
import { fetchEpisodeDetail, fetchPodcastDetail } from "../public/js/api.js";

// Each test uses its own ID: fetched details are cached per ID for the module's lifetime.
const PAGE = "https://www.xiaoyuzhoufm.com/podcast/";
const pid = (n) => n.repeat(24).slice(0, 24);

function podcastPage(id, title = "岩中花述") {
  const payload = JSON.stringify({
    props: {
      pageProps: {
        podcast: { pid: id, title, author: "GIADA", episodes: [] },
      },
    },
  });
  return `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">${payload}</script></body></html>`;
}

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const pageResponse = (body, status = 200) => new Response(body, { status });
const blockedFallback = () => jsonResponse({ error: "upstream rejected the CF-Worker request (403)" }, 502);

async function withFetch(responder, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return responder(String(url), calls.length);
  };
  try {
    return { result: await run(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

test("the Xiaoyuzhou page is fetched cross-origin and parsed without the Worker fallback", async () => {
  const id = pid("a1");
  const { result, calls } = await withFetch(() => pageResponse(podcastPage(id)), () => fetchPodcastDetail(id));

  assert.equal(result.podcast.title, "岩中花述");
  assert.deepEqual(
    calls.map((call) => call.url),
    [`${PAGE}${id}`]
  );
  assert.equal(calls[0].options.mode, "cors");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.referrerPolicy, "no-referrer");
});

test("a missing page is reported without trying the fallback", async () => {
  const id = pid("b2");
  const { calls } = await withFetch(() => pageResponse("not found", 404), async () => {
    await assert.rejects(fetchPodcastDetail(id), /未找到对应的小宇宙内容/);
  });

  assert.deepEqual(
    calls.map((call) => call.url),
    [`${PAGE}${id}`]
  );
});

test("the Worker endpoint is used when the page cannot be fetched", async () => {
  const id = pid("c3");
  const fallbackBody = { podcast: { pid: id, title: "来自兜底" }, episodes: [], limited: true };
  const { result, calls } = await withFetch(
    (url) => (url.startsWith(PAGE) ? pageResponse("boom", 500) : jsonResponse(fallbackBody)),
    () => fetchEpisodeDetail(id)
  );

  assert.deepEqual(result, fallbackBody);
  assert.deepEqual(
    calls.map((call) => call.url),
    [`https://www.xiaoyuzhoufm.com/episode/${id}`, `/api/xiaoyuzhou/episode/${id}`]
  );
});

test("when the fallback is blocked on Cloudflare, the page error is kept as the cause", async () => {
  const id = pid("d4");
  const { result } = await withFetch(
    (url) => (url.startsWith(PAGE) ? pageResponse("boom", 500) : blockedFallback()),
    async () => {
      try {
        await fetchPodcastDetail(id);
        return null;
      } catch (err) {
        return err;
      }
    }
  );

  assert.match(result.message, /暂无法从网页获取该小宇宙内容/);
  assert.equal(result.cause?.message, "小宇宙页面响应异常 (500)");
});

test("when the page times out and the fallback is blocked, the timeout message is kept", async () => {
  const id = pid("e5");
  const { result } = await withFetch(
    (url) => {
      if (url.startsWith(PAGE)) {
        throw Object.assign(new Error("The user aborted a request."), { name: "AbortError" });
      }
      return blockedFallback();
    },
    async () => {
      try {
        await fetchPodcastDetail(id);
        return null;
      } catch (err) {
        return err;
      }
    }
  );

  assert.equal(result.message, "请求小宇宙官网超时，请稍后重试");
  assert.equal(result.cause?.message, "请求小宇宙官网超时，请稍后重试");
});

test("a fallback that fails for another reason reports its own error", async () => {
  const id = pid("f6");
  const { result } = await withFetch(
    (url) => (url.startsWith(PAGE) ? pageResponse("boom", 500) : jsonResponse({ error: "榜单服务暂不可用" }, 503)),
    async () => {
      try {
        await fetchPodcastDetail(id);
        return null;
      } catch (err) {
        return err;
      }
    }
  );

  assert.equal(result.message, "榜单服务暂不可用");
});
