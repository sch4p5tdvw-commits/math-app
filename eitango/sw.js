const CACHE_NAME = "eitango-cache-v6";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./store.js",
  "./speech.js",
  "./sound.js",
  "./sounds/correct.mp3",
  "./sounds/wrong.mp3",
  "./csv.js",
  "./quiz.js",
  "./srs.js",
  "./wordbank.js",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

// このアプリは外部通信を一切行わない。単語と記録は localStorage に端末内だけで保存し、
// Service Worker もこのフォルダの静的ファイルしかキャッシュしない。

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
            .filter((key) => key.startsWith("eitango-cache-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ネットにつながっていれば最新を取りにいき、つながらなければ保存しておいたものを使う。
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (new URL(event.request.url).origin !== self.location.origin) return;

  // fetch(event.request) はブラウザの HTTP キャッシュを経由するため、GitHub Pages が
  // 指示する十数分のキャッシュのあいだ、更新しても古いファイルが返ることがある。
  // no-store をつけて必ず取りにいく。
  event.respondWith(
    fetch(event.request.url, { cache: "no-store" })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
