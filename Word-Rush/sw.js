const CACHE_PREFIX = "word-rush-assets-";
const META_CACHE = "word-rush-meta";
const MANIFEST_PATH = "cache-manifest.json";

let manifestState = null;

function scopedUrl(path) {
  return new URL(path, self.registration.scope).href;
}

function manifestRequest() {
  return new Request(scopedUrl(MANIFEST_PATH), { cache: "no-store" });
}

function cacheName(version) {
  return `${CACHE_PREFIX}${version}`;
}

function isSameScope(url) {
  return url.origin === self.location.origin && url.href.startsWith(self.registration.scope);
}

function toManifestUrl(asset) {
  return scopedUrl(asset.url);
}

function buildAssetMap(manifest) {
  return new Map((manifest.assets || []).map((asset) => [toManifestUrl(asset), asset]));
}

async function readStoredManifest() {
  const cache = await caches.open(META_CACHE);
  const response = await cache.match(MANIFEST_PATH);
  if (!response) {
    return null;
  }
  return response.json();
}

async function storeManifest(manifest) {
  const cache = await caches.open(META_CACHE);
  await cache.put(
    MANIFEST_PATH,
    new Response(JSON.stringify(manifest), {
      headers: { "Content-Type": "application/json; charset=utf-8" }
    })
  );
}

async function deleteOldAssetCaches(currentVersion) {
  const keep = cacheName(currentVersion);
  const names = await caches.keys();
  await Promise.all(names
    .filter((name) => name.startsWith(CACHE_PREFIX) && name !== keep)
    .map((name) => caches.delete(name)));
}

async function refreshManifest() {
  const response = await fetch(manifestRequest());
  if (!response.ok) {
    throw new Error(`Manifest load failed: ${response.status}`);
  }
  const manifest = await response.json();
  manifestState = {
    ...manifest,
    assetMap: buildAssetMap(manifest)
  };
  await storeManifest(manifest);
  await deleteOldAssetCaches(manifest.version);
  return manifestState;
}

async function getManifest(options = {}) {
  if (options.refresh) {
    try {
      return await refreshManifest();
    } catch {
      // If the server is temporarily unavailable, fall back to the last known manifest.
    }
  }

  if (manifestState) {
    return manifestState;
  }

  const stored = await readStoredManifest();
  if (stored) {
    manifestState = {
      ...stored,
      assetMap: buildAssetMap(stored)
    };
    return manifestState;
  }

  return refreshManifest();
}

async function cacheFirst(request, manifest) {
  const cache = await caches.open(cacheName(manifest.version));
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) {
    return cached;
  }

  const response = await fetch(new Request(request, { cache: "no-store" }));
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

function parseRange(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || "");
  if (!match) {
    return null;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return null;
  }
  return {
    start,
    end: Math.min(end, size - 1)
  };
}

async function rangeResponseFromCache(request, manifest) {
  const cache = await caches.open(cacheName(manifest.version));
  const fullRequest = new Request(request.url, {
    cache: "no-store",
    credentials: request.credentials,
    headers: new Headers(),
    mode: "same-origin",
    redirect: "follow"
  });
  let response = await cache.match(fullRequest, { ignoreSearch: true });
  if (!response) {
    response = await fetch(fullRequest);
    if (!response.ok) {
      return response;
    }
    await cache.put(fullRequest, response.clone());
  }

  const buffer = await response.arrayBuffer();
  const range = parseRange(request.headers.get("range"), buffer.byteLength);
  if (!range) {
    return response;
  }

  const chunk = buffer.slice(range.start, range.end + 1);
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Length": String(chunk.byteLength),
    "Content-Range": `bytes ${range.start}-${range.end}/${buffer.byteLength}`,
    "Content-Type": response.headers.get("Content-Type") || "application/octet-stream"
  });
  return new Response(chunk, {
    status: 206,
    statusText: "Partial Content",
    headers
  });
}

async function handleNavigation(request) {
  const manifest = await getManifest({ refresh: true });
  const indexUrl = scopedUrl("index.html");
  const indexRequest = new Request(indexUrl, {
    cache: "no-store",
    credentials: "same-origin"
  });
  return cacheFirst(indexRequest, manifest);
}

async function handleAsset(request) {
  const url = new URL(request.url);
  if (!isSameScope(url) || url.pathname.endsWith(`/${MANIFEST_PATH}`)) {
    return fetch(request);
  }

  const manifest = await getManifest();
  if (!manifest.assetMap.has(url.href)) {
    return fetch(request);
  }

  if (request.headers.has("range")) {
    return rangeResponseFromCache(request, manifest);
  }

  return cacheFirst(request, manifest);
}

self.addEventListener("install", (event) => {
  event.waitUntil(refreshManifest().catch(() => null));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const manifest = await getManifest().catch(() => null);
    if (manifest) {
      await deleteOldAssetCaches(manifest.version);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(handleNavigation(event.request));
    return;
  }

  event.respondWith(handleAsset(event.request));
});
