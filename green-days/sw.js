const CACHE_NAME = "greendays-cache-v6";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// このアプリは外部通信を一切行わない。すべてのデータは localStorage に
// 端末内だけで保存され、Service Worker もこのオリジンの静的ファイルしか
// キャッシュしない。

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // 取り込み直すときも必ず新しいものを取りにいく
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            // 同じオリジンにある算数アプリのキャッシュまで消さないよう、
            // 自分の名前で始まるものだけを片づける
            .filter((key) => key.startsWith("greendays-cache-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (new URL(event.request.url).origin !== self.location.origin) return;

  // fetch(event.request) はブラウザの HTTP キャッシュを経由するので、
  // 「ネットワーク優先」と書いていても配信済みの古いファイルが返ることがある。
  // GitHub Pages は十数分のキャッシュを指示するため、更新したのに直らない、
  // という状態がその間続いてしまう。no-store で必ず取りにいく。
  event.respondWith(
    fetch(event.request.url, { cache: "no-store" })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
