// Run before the app and CDN scripts so WeChat's text scaling is reset early.
(() => {
  if (!/MicroMessenger/i.test(navigator.userAgent)) return;
  document.documentElement.setAttribute("data-wechat", "true");
  let subscribedBridge;

  function resetFontSize() {
    const bridge = window.WeixinJSBridge;
    if (typeof bridge?.invoke !== "function") return;
    try {
      bridge.invoke("setFontSizeCallback", { fontSize: 0 }, () => {});
    } catch {
      // Some clients do not expose this native API; CSS still fixes text inflation.
    }
  }

  function onBridgeReady() {
    resetFontSize();
    const bridge = window.WeixinJSBridge;
    if (typeof bridge?.on !== "function" || bridge === subscribedBridge) return;
    try {
      bridge.on("menu:setfont", resetFontSize);
      subscribedBridge = bridge;
    } catch {
      // Keep the page usable when the host does not support this bridge event.
    }
  }

  document.addEventListener("WeixinJSBridgeReady", onBridgeReady);
  window.addEventListener("pageshow", onBridgeReady);
  onBridgeReady();
})();
