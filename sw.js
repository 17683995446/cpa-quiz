/**
 * CPA智刷 - Service Worker
 * R27 PWA离线支持功能
 * 
 * 功能：
 * - 安装阶段：缓存静态资源（HTML、CSS、JS、字体）
 * - 激活阶段：清理旧缓存
 * - 拦截策略：
 *   - 静态资源：Cache First（优先从缓存读取）
 *   - 题目数据：Stale While Revalidate（先返回缓存，后台更新）
 *   - API请求：Network First（优先网络，失败回退缓存）
 * - 消息通信：与主页面通信，通知缓存更新
 */

const CACHE_VERSION = 'v27.0.0';
const STATIC_CACHE = `cpa-quiz-static-${CACHE_VERSION}`;
const DATA_CACHE = `cpa-quiz-data-${CACHE_VERSION}`;
const IMAGE_CACHE = `cpa-quiz-images-${CACHE_VERSION}`;

// 静态资源列表
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/data.js',
    '/js/app.js',
    '/js/modules/db.js',
    '/js/modules/index.js',
    '/js/modules/storage-adapter.js',
    '/js/modules/storage-compat.js',
    '/js/modules/migration.js',
    '/js/modules/offline-manager.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700;900&display=swap'
];

// 题目数据URL模式
const DATA_URL_PATTERNS = [
    /\/data\/.*\.json$/,
    /\/api\/questions/,
    /\/api\/subjects/
];

// API请求URL模式
const API_URL_PATTERNS = [
    /\/api\//,
    /\/sync\//
];

// 图片URL模式
const IMAGE_URL_PATTERNS = [
    /\.(png|jpg|jpeg|gif|webp|svg)$/i,
    /cdnjs\.cloudflare\.com/,
    /fonts\.googleapis\.com/,
    /fonts\.gstatic\.com/
];

// ============================================
// 安装阶段 - 缓存静态资源
// ============================================
self.addEventListener('install', (event) => {
    console.log('[SW] Installing...');
    
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => {
                console.log('[SW] Caching static assets...');
                return cache.addAll(STATIC_ASSETS.map(url => {
                    // 处理相对路径
                    if (url.startsWith('/')) {
                        return new Request(url, { cache: 'reload' });
                    }
                    return url;
                }));
            })
            .then(() => {
                console.log('[SW] Static assets cached successfully');
                return self.skipWaiting();
            })
            .catch((error) => {
                console.error('[SW] Failed to cache static assets:', error);
            })
    );
});

// ============================================
// 激活阶段 - 清理旧缓存
// ============================================
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating...');
    
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((cacheName) => {
                            // 只清理CPA智刷相关的缓存
                            return cacheName.startsWith('cpa-quiz-') && 
                                   !cacheName.includes(CACHE_VERSION);
                        })
                        .map((cacheName) => {
                            console.log('[SW] Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        })
                );
            })
            .then(() => {
                console.log('[SW] Old caches cleaned up');
                return self.clients.claim();
            })
    );
});

// ============================================
// 请求拦截 - 不同策略处理不同类型请求
// ============================================
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);
    
    // 跳过非GET请求
    if (request.method !== 'GET') {
        return;
    }
    
    // 跳过Chrome扩展请求
    if (url.protocol === 'chrome-extension:') {
        return;
    }
    
    // 判断请求类型并应用相应策略
    if (isStaticAsset(url)) {
        event.respondWith(cacheFirstStrategy(request));
    } else if (isDataRequest(url)) {
        event.respondWith(staleWhileRevalidateStrategy(request));
    } else if (isImageRequest(url)) {
        event.respondWith(imageCacheStrategy(request));
    } else if (isAPIRequest(url)) {
        event.respondWith(networkFirstStrategy(request));
    }
    // 其他请求使用默认的网络优先策略
});

// ============================================
// 请求类型判断
// ============================================

function isStaticAsset(url) {
    const staticExtensions = ['.html', '.css', '.js', '.json'];
    const path = url.pathname;
    
    // 检查是否是静态资源
    if (staticExtensions.some(ext => path.endsWith(ext))) {
        return true;
    }
    
    // 检查是否是CDN资源
    if (url.hostname.includes('cdnjs.cloudflare.com') ||
        url.hostname.includes('fonts.googleapis.com')) {
        return true;
    }
    
    return false;
}

function isDataRequest(url) {
    return DATA_URL_PATTERNS.some(pattern => pattern.test(url.pathname));
}

function isAPIRequest(url) {
    return API_URL_PATTERNS.some(pattern => pattern.test(url.pathname));
}

function isImageRequest(url) {
    return IMAGE_URL_PATTERNS.some(pattern => pattern.test(url.href));
}

// ============================================
// 缓存策略实现
// ============================================

/**
 * Cache First策略 - 优先从缓存读取
 * 适用于静态资源（HTML、CSS、JS）
 */
async function cacheFirstStrategy(request) {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    
    if (cached) {
        // 后台更新缓存
        fetch(request)
            .then((response) => {
                if (response.ok) {
                    cache.put(request, response.clone());
                }
            })
            .catch(() => {});
        
        return cached;
    }
    
    try {
        const response = await fetch(request);
        if (response.ok) {
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        console.error('[SW] Cache first failed:', error);
        return new Response('Offline - Resource not available', {
            status: 503,
            statusText: 'Service Unavailable'
        });
    }
}

/**
 * Stale While Revalidate策略 - 先返回缓存，后台更新
 * 适用于题目数据
 */
async function staleWhileRevalidateStrategy(request) {
    const cache = await caches.open(DATA_CACHE);
    const cached = await cache.match(request);
    
    // 后台更新
    const fetchPromise = fetch(request)
        .then((response) => {
            if (response.ok) {
                cache.put(request, response.clone());
                // 通知客户端数据已更新
                notifyClients('data-updated', { url: request.url });
            }
            return response;
        })
        .catch((error) => {
            console.log('[SW] Network fetch failed, using cache:', error.message);
            return cached;
        });
    
    // 如果有缓存，先返回缓存
    if (cached) {
        return cached;
    }
    
    // 没有缓存，等待网络请求
    try {
        return await fetchPromise;
    } catch (error) {
        return new Response(JSON.stringify({ error: 'Offline', offline: true }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

/**
 * Network First策略 - 优先网络，失败回退缓存
 * 适用于API请求
 */
async function networkFirstStrategy(request) {
    const cache = await caches.open(DATA_CACHE);
    
    try {
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            // 更新缓存
            cache.put(request, networkResponse.clone());
            return networkResponse;
        }
        
        throw new Error('Network response not ok');
    } catch (error) {
        console.log('[SW] Network failed, trying cache:', error.message);
        
        const cached = await cache.match(request);
        if (cached) {
            return cached;
        }
        
        return new Response(JSON.stringify({ 
            error: 'Offline', 
            offline: true,
            message: 'Network unavailable and no cached data'
        }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

/**
 * 图片缓存策略 - 缓存优先，支持过期
 */
async function imageCacheStrategy(request) {
    const cache = await caches.open(IMAGE_CACHE);
    const cached = await cache.match(request);
    
    if (cached) {
        return cached;
    }
    
    try {
        const response = await fetch(request);
        if (response.ok) {
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        // 图片加载失败返回透明占位图
        return new Response(
            'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
            { headers: { 'Content-Type': 'image/svg+xml' } }
        );
    }
}

// ============================================
// 后台同步
// ============================================
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-answers') {
        console.log('[SW] Background sync triggered: sync-answers');
        event.waitUntil(syncAnswers());
    }
});

/**
 * 同步离线答题数据
 */
async function syncAnswers() {
    // 获取所有客户端
    const clients = await self.clients.matchAll();
    
    if (clients.length === 0) {
        console.log('[SW] No clients available for sync');
        return;
    }
    
    // 通知主页面执行同步
    clients.forEach(client => {
        client.postMessage({
            type: 'SYNC_ANSWERS',
            timestamp: Date.now()
        });
    });
}

// ============================================
// 推送通知（预留）
// ============================================
self.addEventListener('push', (event) => {
    const data = event.data?.json() || {};
    
    const options = {
        body: data.body || 'CPA智刷通知',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/badge-72x72.png',
        tag: data.tag || 'default',
        requireInteraction: data.requireInteraction || false,
        data: data.data || {}
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title || 'CPA智刷', options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    event.waitUntil(
        self.clients.openWindow('/')
    );
});

// ============================================
// 消息通信 - 与主页面通信
// ============================================
self.addEventListener('message', (event) => {
    const { type, data } = event.data;
    
    switch (type) {
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;
            
        case 'GET_VERSION':
            event.ports[0]?.postMessage({
                version: CACHE_VERSION,
                timestamp: Date.now()
            });
            break;
            
        case 'CLEAR_CACHES':
            clearAllCaches()
                .then(() => {
                    event.ports[0]?.postMessage({ success: true });
                })
                .catch((error) => {
                    event.ports[0]?.postMessage({ success: false, error: error.message });
                });
            break;
            
        case 'CACHE_URLS':
            cacheUrls(data.urls)
                .then((result) => {
                    event.ports[0]?.postMessage({ success: true, result });
                })
                .catch((error) => {
                    event.ports[0]?.postMessage({ success: false, error: error.message });
                });
            break;
            
        case 'GET_CACHE_STATUS':
            getCacheStatus()
                .then((status) => {
                    event.ports[0]?.postMessage({ success: true, status });
                })
                .catch((error) => {
                    event.ports[0]?.postMessage({ success: false, error: error.message });
                });
            break;
            
        default:
            console.log('[SW] Unknown message type:', type);
    }
});

/**
 * 通知所有客户端
 */
async function notifyClients(type, data) {
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
        client.postMessage({
            type,
            data,
            timestamp: Date.now()
        });
    });
}

/**
 * 清除所有缓存
 */
async function clearAllCaches() {
    const cacheNames = await caches.keys();
    const cpaCaches = cacheNames.filter(name => name.startsWith('cpa-quiz-'));
    
    await Promise.all(cpaCaches.map(name => caches.delete(name)));
    console.log('[SW] All caches cleared');
    
    return { cleared: cpaCaches.length };
}

/**
 * 缓存指定URL列表
 */
async function cacheUrls(urls) {
    const cache = await caches.open(STATIC_CACHE);
    const results = { success: [], failed: [] };
    
    await Promise.all(
        urls.map(async (url) => {
            try {
                const response = await fetch(url);
                if (response.ok) {
                    await cache.put(url, response);
                    results.success.push(url);
                } else {
                    results.failed.push({ url, error: 'Response not ok' });
                }
            } catch (error) {
                results.failed.push({ url, error: error.message });
            }
        })
    );
    
    return results;
}

/**
 * 获取缓存状态
 */
async function getCacheStatus() {
    const cacheNames = await caches.keys();
    const status = {
        version: CACHE_VERSION,
        caches: {}
    };
    
    for (const name of cacheNames) {
        if (name.startsWith('cpa-quiz-')) {
            const cache = await caches.open(name);
            const keys = await cache.keys();
            status.caches[name] = keys.length;
        }
    }
    
    return status;
}

// ============================================
// 周期性后台同步（预留）
// ============================================
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'update-questions') {
        console.log('[SW] Periodic sync: update-questions');
        event.waitUntil(updateQuestionCache());
    }
});

async function updateQuestionCache() {
    // 预留：定期更新题目缓存
    console.log('[SW] Updating question cache...');
}

console.log('[SW] Service Worker loaded');
