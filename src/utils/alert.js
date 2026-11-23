// Notifications for a sync that stays unfinished. Nothing is sent unless the
// Worker has an ALERT_WEBHOOK_URL, so the site needs no outside service by default.
const ALERT_TIMEOUT_MS = 10_000;

/**
 * Send `message` to the webhook in `env.ALERT_WEBHOOK_URL`.
 *
 * A URL that contains `{text}` gets the message in its place and is requested
 * with GET, which covers push services addressed by URL (Bark, Server酱, …).
 * Any other URL gets `{"text": message}` posted as JSON, as Slack-style
 * incoming webhooks expect.
 *
 * Resolves to whether the endpoint accepted it. Without a configured URL, or
 * when the request fails, it resolves to false: an alert must never break the
 * sync that is trying to send it.
 */
export async function sendAlert(env, message, fetchFn = fetch) {
  const template = typeof env?.ALERT_WEBHOOK_URL === "string" ? env.ALERT_WEBHOOK_URL.trim() : "";
  if (!template) return false;

  let url = template;
  const init = { method: "POST", signal: AbortSignal.timeout(ALERT_TIMEOUT_MS) };
  if (template.includes("{text}")) {
    url = template.split("{text}").join(encodeURIComponent(message));
    init.method = "GET";
  } else {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify({ text: message });
  }

  try {
    const res = await fetchFn(url, init);
    return Boolean(res?.ok);
  } catch (err) {
    console.error("Sync alert could not be delivered:", err);
    return false;
  }
}
