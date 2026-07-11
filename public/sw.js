// 云相册 Service Worker
// 缓存策略：
// - 导航请求（HTML）：Network-First（始终获取最新 HTML，避免引用过期资源）
// - 静态资源（JS/CSS/字体）：Cache-First（Vite 构建带 hash，文件名变化即新版本）
// - 缩略图和原图：Stale-While-Revalidate
// - 缓存上限约 200MB，LRU 淘汰

const CACHE_VERSION = 'v2'
const STATIC_CACHE = `myphotos-static-${CACHE_VERSION}`
const MEDIA_CACHE = `myphotos-media-${CACHE_VERSION}`

// 安装时跳过等待，立即激活
self.addEventListener('install', () => {
  self.skipWaiting()
})

// 激活时清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('myphotos-') && name !== STATIC_CACHE && name !== MEDIA_CACHE)
          .map((name) => caches.delete(name))
      )
    })
  )
  self.clients.claim()
})

// 请求拦截
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // 导航请求（HTML）：Network-First，确保始终获取最新的 index.html
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, STATIC_CACHE))
    return
  }

  // 静态资源：Cache-First（Vite 带 hash，文件名变化即新版本）
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'font' ||
    url.pathname.match(/\.(js|css|woff2?)$/)
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  // Gitee API 图片/缩略图：Stale-While-Revalidate
  if (
    url.hostname === 'gitee.com' &&
    url.pathname.includes('/contents/')
  ) {
    event.respondWith(staleWhileRevalidate(request, MEDIA_CACHE))
    return
  }

  // 其他请求：网络优先
  event.respondWith(fetch(request).catch(() => caches.match(request)))
})

// Network-First 策略（用于导航请求）
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    return new Response('离线状态下不可用', { status: 503 })
  }
}

// Cache-First 策略
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    const cache = await caches.open(cacheName)
    cache.put(request, response.clone())
    return response
  } catch {
    return new Response('离线状态下不可用', { status: 503 })
  }
}

// Stale-While-Revalidate 策略
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)

  const fetchPromise = fetch(request).then((response) => {
    cache.put(request, response.clone())
    return response
  }).catch(() => null)

  return cached || fetchPromise
}
