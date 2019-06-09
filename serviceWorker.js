// from https://serviceworke.rs/strategy-cache-and-update_service-worker_doc.html
var CACHE = 'cache-and-update';
var SCOPE = self.registration.scope;

// On install, cache some resources.
self.addEventListener('install', function(evt) {
  console.log('The service worker is being installed.');

  // Ask the service worker to keep installing until the returning promise resolves.
  evt.waitUntil(precache());

  // clean old service worker caches
  evt.waitUntil(cleanup());
});

// On fetch, use cache but update the entry with the latest contents from the server.
self.addEventListener('fetch', function(evt) {
  console.log('The service worker is serving the asset.');
  
  // You can use respondWith() to answer immediately, without waiting for the network response to reach the service worker…
  evt.respondWith(fromCache(evt.request));
  
  // ...and waitUntil() to prevent the worker from being killed until the cache is updated.
  evt.waitUntil(update(evt.request));
});

// Open a cache and use addAll() with an array of assets to add all of them to the cache. Return a promise resolving when all the assets are added.
function precache() {
  return caches.open(CACHE).then(function (cache) {
    return cache.addAll([
      SCOPE + '/index.html',
      SCOPE + '/bluetooth.js',
      SCOPE + '/style.css',
      SCOPE + '/feather.min.js'
    ]);
  });
}

// Open the cache where the assets were stored and search for the requested resource. Notice that in case of no matching, the promise still resolves but it does with undefined as value.
function fromCache(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request).then(function (matching) {
      return matching || Promise.reject('no-match');
    });
  });
}

// Update consists in opening the cache, performing a network request and storing the new response data.
function update(request) {
  return caches.open(CACHE).then(function (cache) {
    return fetch(request).then(function (response) {
      return cache.put(request, response);
    });
  });
}

// Wipe no longer useful caches
function cleanup() {
  return caches.keys().then(cacheNames => {
      return Promise.all(
          cacheNames.filter(cacheName => {
              return cacheName !== CACHE;
          }).map(cacheName => {
              console.log("Deleting old service worker cache", cacheName);
              return caches.delete(cacheName);
          })
      );
  });
}