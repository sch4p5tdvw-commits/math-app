const CACHE_NAME = "marathon-cache-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

// このアプリは外部通信を一切行わない。入力は localStorage に端末内だけで
// 保存され、Service Worker もこのオリジンの静的ファイルしか扱わない。

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
            // 同じオリジンにある他のアプリのキャッシュまで消さないよう、
            // 自分の名前で始まるものだけを片づける
            .filter((key) => key.startsWith("marathon-cache-") && key !== CACHE_NAME)
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
  // GitHub Pages は十数分のキャッシュを指示するため、no-store で必ず取りにいく。
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
