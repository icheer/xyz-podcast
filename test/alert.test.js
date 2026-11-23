import test from "node:test";
import assert from "node:assert/strict";
import { sendAlert } from "../src/utils/alert.js";

const ok = () => new Response("ok", { status: 200 });

async function withFetch(responder, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return responder(calls.length);
  };
  try {
    return { result: await run(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

const webhook = { ALERT_WEBHOOK_URL: "https://hooks.example.com/T000/B000/xxxx" };

test("nothing is sent without a configured webhook", async () => {
  const { result, calls } = await withFetch(ok, () => sendAlert({}, "消息"));
  assert.deepEqual([result, calls.length], [false, 0]);
  assert.equal(await sendAlert({ ALERT_WEBHOOK_URL: "   " }, "消息"), false);
});

test("a plain webhook gets the message posted as JSON", async () => {
  const { result, calls } = await withFetch(ok, () => sendAlert(webhook, "榜单同步没有完成"));
  assert.equal(result, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, webhook.ALERT_WEBHOOK_URL);
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(calls[0].options.headers, { "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(calls[0].options.body), { text: "榜单同步没有完成" });
});

test("a URL with {text} gets the message encoded into it and is requested with GET", async () => {
  const message = "榜单同步没有完成（20261123T00）：a/b?c=1&d";
  const { result, calls } = await withFetch(
    ok,
    () => sendAlert({ ALERT_WEBHOOK_URL: "https://api.day.app/key/榜单同步/{text}" }, message)
  );
  assert.equal(result, true);
  assert.equal(calls[0].url, `https://api.day.app/key/榜单同步/${encodeURIComponent(message)}`);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.body, undefined);
});

test("a rejected or unreachable endpoint is reported, not thrown", async () => {
  const rejected = await withFetch(() => new Response("no", { status: 500 }), () => sendAlert(webhook, "消息"));
  assert.equal(rejected.result, false);

  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  let unreachable;
  try {
    unreachable = await withFetch(() => {
      throw new Error("connection refused");
    }, () => sendAlert(webhook, "消息"));
  } finally {
    console.error = originalError;
  }
  assert.equal(unreachable.result, false);
  assert.equal(logged.length, 1);
});
