/* Spec2Test 离线外壳：只缓存 web 静态资源与非 /api 数据，绝不缓存 API。 */
const VERSION = "s2t-v1";
const SHELL = VERSION + "-shell";
const ASSETS = VERSION + "-assets";
const DATA = VERSION + "-data";
const SHELL_URLS = ["/web/", "/web/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await Promise.all(
        SHELL_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "no-store" });
            if (res.ok) await cache.put(url, res.clone());
          } catch {
            /* 单个外壳资源失败不影响安装 */
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // 绝不缓存 API

  // 页面导航：network-first，失败回退缓存的 SPA 外壳
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh.ok) {
            const cache = await caches.open(SHELL);
            cache.put("/web/index.html", fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch {
          return (
            (await caches.match("/web/index.html")) ||
            (await caches.match("/web/")) ||
            new Response("离线且没有缓存", {
              status: 503,
              headers: { "content-type": "text/plain; charset=utf-8" },
            })
          );
        }
      })()
    );
    return;
  }

  // 指纹静态资源：cache-first
  if (url.pathname.startsWith("/web/assets/")) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const fresh = await fetch(req);
        if (fresh.ok) {
          const cache = await caches.open(ASSETS);
          cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      })()
    );
    return;
  }

  // 数据快照：stale-while-revalidate，离线可看上次数据
  if (url.pathname.startsWith("/results/") || url.pathname.startsWith("/data/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(DATA);
        const hit = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone()).catch(() => {});
            return res;
          })
          .catch(() => null);
        if (hit) return hit;
        const fresh = await network;
        return (
          fresh ||
          new Response(JSON.stringify({ error: "offline" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          })
        );
      })()
    );
  }
});
