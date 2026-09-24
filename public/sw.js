// Offline shell: the texts and course are bundled, so the daily path works
// without a connection. The tutor needs the network.
const CACHE = "stoa-v11";
const SHELL = [
  "./", "index.html", "css/app.css", "js/app.js", "js/logic.js", "js/store.js", "js/prompts.js", "js/direct.js", "js/themes.js", "data/volumes/index.json", "data/explainers/meditations.json",
  "data/library.json", "data/course-meditations.json", "manifest.webmanifest", "icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first for the app itself (so updates land), cache as fallback.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.includes("/api/")) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))),
  );
});
