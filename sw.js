/**
 * sw.js — BOSS AI Hub v1.0 offline service worker (PWA shell).
 *
 * Strategy:
 *  - install: precache the complete app shell (cache-first guarantee offline).
 *  - fetch:   cache-first for same-origin GET, network fallback, background
 *             cache refresh so redeploys propagate without a hard reload.
 *  - activate: drop stale cache versions.
 *
 * Zero external origins are cached. No credentials, no cross-origin calls.
 */

const CACHE_NAME = 'boss-ai-shell-v1';
const SHELL_URLS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './src/StorageAdapter.js',
  './src/TaskEngine.js',
  './src/ProjectEngine.js',
  './src/NoteEngine.js',
  './src/SearchEngine.js',
  './src/BackupEngine.js',
  './src/AgentRegistry.js',
  './src/TaskStateMachine.js',
  './src/PolicyEvaluator.js',
  './src/ToolBroker.js',
  './src/ScopedMemory.js',
  './src/AIAdapter.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
