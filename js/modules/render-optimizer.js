/**
 * CPA智刷 - 渲染优化模块
 * R29: 虚拟滚动与渲染优化
 * @module render-optimizer
 *
 * 功能：
 * - DOM批量更新（DocumentFragment）
 * - requestAnimationFrame调度器
 * - DOM diff算法（最小化DOM操作）
 * - 模板缓存（避免重复字符串拼接）
 * - 图片/资源懒加载
 */

// ============================================
// DOM批量更新
// ============================================

/**
 * DOM批量更新器 - 使用DocumentFragment减少重排重绘
 */
export class DOMBatchUpdater {
    constructor() {
        this._queue = [];
        this._scheduled = false;
        this._stats = {
            batchCount: 0,
            totalOperations: 0,
            fragmentUsed: 0
        };
    }

    /**
     * 添加DOM操作到批量队列
     * @param {Function} operation - DOM操作函数 (fragment) => void
     * @param {HTMLElement} [parent] - 父容器，操作完成后自动append
     * @returns {number} 操作ID
     */
    enqueue(operation, parent = null) {
        const id = this._queue.length;
        this._queue.push({ operation, parent });
        this._stats.totalOperations++;

        if (!this._scheduled) {
            this._scheduleFlush();
        }

        return id;
    }

    /**
     * 调度批量刷新
     */
    _scheduleFlush() {
        this._scheduled = true;
        requestAnimationFrame(() => {
            this.flush();
        });
    }

    /**
     * 立即执行所有排队的DOM操作
     */
    flush() {
        if (this._queue.length === 0) {
            this._scheduled = false;
            return;
        }

        this._stats.batchCount++;

        // 按父容器分组
        const groups = new Map();
        const noParentOps = [];

        for (const item of this._queue) {
            if (item.parent) {
                if (!groups.has(item.parent)) {
                    groups.set(item.parent, []);
                }
                groups.get(item.parent).push(item.operation);
            } else {
                noParentOps.push(item.operation);
            }
        }

        // 对每个父容器使用DocumentFragment批量插入
        for (const [parent, operations] of groups) {
            const fragment = document.createDocumentFragment();
            for (const op of operations) {
                op(fragment);
            }
            parent.appendChild(fragment);
            this._stats.fragmentUsed++;
        }

        // 无父容器的操作直接执行
        for (const op of noParentOps) {
            const fragment = document.createDocumentFragment();
            op(fragment);
            this._stats.fragmentUsed++;
        }

        this._queue.length = 0;
        this._scheduled = false;
    }

    /**
     * 批量创建并插入DOM元素
     * @param {HTMLElement} parent - 父容器
     * @param {Array<{tag: string, attrs?: Object, children?: Array, text?: string}>} items - 元素描述
     * @returns {DocumentFragment}
     */
    static createBatch(parent, items) {
        const fragment = document.createDocumentFragment();

        for (const item of items) {
            const el = document.createElement(item.tag);
            if (item.attrs) {
                for (const [key, value] of Object.entries(item.attrs)) {
                    if (key === 'className') {
                        el.className = value;
                    } else if (key === 'style' && typeof value === 'object') {
                        Object.assign(el.style, value);
                    } else if (key.startsWith('data-')) {
                        el.setAttribute(key, value);
                    } else {
                        el.setAttribute(key, value);
                    }
                }
            }
            if (item.text) {
                el.textContent = item.text;
            }
            if (item.children) {
                for (const child of item.children) {
                    if (typeof child === 'string') {
                        el.appendChild(document.createTextNode(child));
                    } else if (child instanceof HTMLElement) {
                        el.appendChild(child);
                    }
                }
            }
            fragment.appendChild(el);
        }

        if (parent) {
            parent.appendChild(fragment);
        }

        return fragment;
    }

    /**
     * 获取统计信息
     */
    getStats() {
        return { ...this._stats };
    }

    /**
     * 重置统计
     */
    resetStats() {
        this._stats = { batchCount: 0, totalOperations: 0, fragmentUsed: 0 };
    }
}

// ============================================
// requestAnimationFrame调度器
// ============================================

/**
 * RAF调度器 - 管理requestAnimationFrame回调，避免重复注册
 */
export class RAFScheduler {
    constructor() {
        this._callbacks = new Map();
        this._rafId = null;
        this._running = false;
        this._stats = {
            totalFrames: 0,
            totalCallbacks: 0,
            skippedFrames: 0
        };
    }

    /**
     * 注册一个回调到下一帧
     * @param {string} id - 回调唯一标识
     * @param {Function} callback - 帧回调
     * @param {Object} [options]
     * @param {boolean} [options.persistent=false] - 是否持续注册（每帧都执行）
     */
    schedule(id, callback, options = {}) {
        const { persistent = false } = options;
        this._callbacks.set(id, { callback, persistent });
        this._stats.totalCallbacks++;

        if (!this._running) {
            this._start();
        }
    }

    /**
     * 取消回调
     * @param {string} id
     */
    cancel(id) {
        this._callbacks.delete(id);
        if (this._callbacks.size === 0 && this._running) {
            this._stop();
        }
    }

    /**
     * 启动帧循环
     */
    _start() {
        this._running = true;
        this._tick();
    }

    /**
     * 停止帧循环
     */
    _stop() {
        this._running = false;
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    /**
     * 帧循环
     */
    _tick() {
        if (!this._running || this._callbacks.size === 0) {
            this._stop();
            return;
        }

        this._stats.totalFrames++;

        const toRemove = [];
        for (const [id, entry] of this._callbacks) {
            try {
                entry.callback();
            } catch (e) {
                console.error(`RAFScheduler callback error [${id}]:`, e);
            }
            if (!entry.persistent) {
                toRemove.push(id);
            }
        }

        for (const id of toRemove) {
            this._callbacks.delete(id);
        }

        if (this._callbacks.size > 0) {
            this._rafId = requestAnimationFrame(() => this._tick());
        } else {
            this._stop();
        }
    }

    /**
     * 执行一次性的下一帧回调（便捷方法）
     * @param {Function} callback
     * @returns {Function} 取消函数
     */
    nextFrame(callback) {
        const id = `once_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        this.schedule(id, callback);
        return () => this.cancel(id);
    }

    /**
     * 获取统计信息
     */
    getStats() {
        return { ...this._stats, activeCallbacks: this._callbacks.size };
    }

    /**
     * 销毁调度器
     */
    destroy() {
        this._stop();
        this._callbacks.clear();
    }
}

// ============================================
// DOM Diff算法
// ============================================

/**
 * 简易DOM Diff引擎 - 最小化DOM操作
 * 基于key的列表diff，支持新增、删除、移动
 */
export class DOMDiffer {
    /**
     * Diff两个列表并生成操作补丁
     * @param {Array<{key: string, data: any}>} oldList - 旧列表
     * @param {Array<{key: string, data: any}>} newList - 新列表
     * @returns {Array<{type: string, key: string, index: number, data: any}>}
     */
    static diff(oldList, newList) {
        const patches = [];
        const oldMap = new Map();
        const newMap = new Map();

        // 建立key到索引的映射
        for (let i = 0; i < oldList.length; i++) {
            oldMap.set(oldList[i].key, { index: i, data: oldList[i].data });
        }
        for (let i = 0; i < newList.length; i++) {
            newMap.set(newList[i].key, { index: i, data: newList[i].data });
        }

        // 1. 找出删除的项
        for (const [key, oldEntry] of oldMap) {
            if (!newMap.has(key)) {
                patches.push({
                    type: 'remove',
                    key,
                    index: oldEntry.index
                });
            }
        }

        // 2. 找出新增的项
        for (const [key, newEntry] of newMap) {
            if (!oldMap.has(key)) {
                patches.push({
                    type: 'add',
                    key,
                    index: newEntry.index,
                    data: newEntry.data
                });
            }
        }

        // 3. 找出需要更新的项（数据变化）
        for (const [key, newEntry] of newMap) {
            if (oldMap.has(key)) {
                const oldEntry = oldMap.get(key);
                if (oldEntry.index !== newEntry.index) {
                    patches.push({
                        type: 'move',
                        key,
                        fromIndex: oldEntry.index,
                        toIndex: newEntry.index
                    });
                }
                if (oldEntry.data !== newEntry.data) {
                    patches.push({
                        type: 'update',
                        key,
                        index: newEntry.index,
                        data: newEntry.data
                    });
                }
            }
        }

        return patches;
    }

    /**
     * 应用补丁到DOM容器
     * @param {HTMLElement} container - 容器元素
     * @param {Array} patches - diff补丁
     * @param {Function} createElement - 创建元素的函数 (data) => HTMLElement
     * @param {Function} updateElement - 更新元素的函数 (element, data) => void
     * @param {Map<string, HTMLElement>} elementMap - key到元素的映射（会被修改）
     */
    static applyPatches(container, patches, createElement, updateElement, elementMap) {
        // 先处理删除
        for (const patch of patches) {
            if (patch.type === 'remove') {
                const el = elementMap.get(patch.key);
                if (el && el.parentNode === container) {
                    container.removeChild(el);
                }
                elementMap.delete(patch.key);
            }
        }

        // 再处理新增和更新
        for (const patch of patches) {
            switch (patch.type) {
                case 'add': {
                    const el = createElement(patch.data);
                    elementMap.set(patch.key, el);
                    // 插入到正确位置
                    const referenceNode = container.children[patch.index];
                    if (referenceNode) {
                        container.insertBefore(el, referenceNode);
                    } else {
                        container.appendChild(el);
                    }
                    break;
                }
                case 'update': {
                    const el = elementMap.get(patch.key);
                    if (el && updateElement) {
                        updateElement(el, patch.data);
                    }
                    break;
                }
                case 'move': {
                    const el = elementMap.get(patch.key);
                    if (el) {
                        const referenceNode = container.children[patch.toIndex];
                        if (referenceNode) {
                            container.insertBefore(el, referenceNode);
                        } else {
                            container.appendChild(el);
                        }
                    }
                    break;
                }
            }
        }
    }
}

// ============================================
// 模板缓存
// ============================================

/**
 * 模板缓存管理器 - 避免重复字符串拼接
 * 支持模板预编译和缓存
 */
export class TemplateCache {
    constructor() {
        this._cache = new Map();
        this._stats = {
            hits: 0,
            misses: 0,
            compiledCount: 0
        };
    }

    /**
     * 编译模板字符串
     * 将 {{variable}} 格式的占位符替换为实际值
     * @param {string} templateStr - 模板字符串
     * @returns {Function} 编译后的模板函数 (data) => string
     */
    compile(templateStr) {
        if (this._cache.has(templateStr)) {
            this._stats.hits++;
            return this._cache.get(templateStr);
        }

        this._stats.misses++;
        this._stats.compiledCount++;

        // 简单模板编译：将 {{key}} 替换为 data[key]
        // 使用正则提取所有占位符
        const placeholders = [];
        const regex = /\{\{(\w+(?:\.\w+)*)\}\}/g;
        let match;

        while ((match = regex.exec(templateStr)) !== null) {
            placeholders.push({
                full: match[0],
                path: match[1]
            });
        }

        // 生成编译后的函数
        const compiled = (data) => {
            let result = templateStr;
            for (const ph of placeholders) {
                const value = this._resolvePath(data, ph.path);
                result = result.replace(ph.full, value != null ? String(value) : '');
            }
            return result;
        };

        this._cache.set(templateStr, compiled);
        return compiled;
    }

    /**
     * 解析对象路径 (e.g., 'user.name' => data.user.name)
     * @param {Object} obj
     * @param {string} path
     * @returns {*}
     */
    _resolvePath(obj, path) {
        const parts = path.split('.');
        let current = obj;
        for (const part of parts) {
            if (current == null) return undefined;
            current = current[part];
        }
        return current;
    }

    /**
     * 使用缓存的模板渲染
     * @param {string} templateStr - 模板字符串
     * @param {Object} data - 数据
     * @returns {string} 渲染后的HTML
     */
    render(templateStr, data) {
        const compiled = this.compile(templateStr);
        return compiled(data);
    }

    /**
     * 预编译模板
     * @param {Object} templates - { name: templateString }
     */
    precompile(templates) {
        for (const [name, templateStr] of Object.entries(templates)) {
            this.compile(templateStr);
        }
    }

    /**
     * 清除缓存
     */
    clear() {
        this._cache.clear();
        this._stats = { hits: 0, misses: 0, compiledCount: 0 };
    }

    /**
     * 获取统计信息
     */
    getStats() {
        return {
            ...this._stats,
            cacheSize: this._cache.size,
            hitRate: this._stats.hits + this._stats.misses > 0
                ? (this._stats.hits / (this._stats.hits + this._stats.misses) * 100).toFixed(1) + '%'
                : '0%'
        };
    }
}

// ============================================
// 图片/资源懒加载
// ============================================

/**
 * 懒加载管理器 - 基于IntersectionObserver
 */
export class LazyLoader {
    /**
     * @param {Object} [options]
     * @param {number} [options.rootMargin='200px'] - 预加载边距
     * @param {number} [options.threshold=0.01] - 可见度阈值
     * @param {string} [options.dataAttr='data-src'] - 真实资源地址属性
     * @param {Function} [options.onLoad] - 加载完成回调 (element) => void
     * @param {Function} [options.onError] - 加载失败回调 (element, error) => void
     */
    constructor(options = {}) {
        this.rootMargin = options.rootMargin || '200px';
        this.threshold = options.threshold || 0.01;
        this.dataAttr = options.dataAttr || 'data-src';
        this.onLoad = options.onLoad || null;
        this.onError = options.onError || null;

        this._observer = null;
        this._observedElements = new Set();
        this._stats = {
            totalObserved: 0,
            totalLoaded: 0,
            totalError: 0
        };
    }

    /**
     * 初始化IntersectionObserver
     */
    init() {
        if (this._observer) return;

        if (typeof IntersectionObserver === 'undefined') {
            console.warn('LazyLoader: IntersectionObserver not supported, falling back to immediate loading');
            return;
        }

        this._observer = new IntersectionObserver(
            (entries) => this._handleIntersection(entries),
            {
                rootMargin: this.rootMargin,
                threshold: this.threshold
            }
        );
    }

    /**
     * 处理交叉观察事件
     * @param {Array} entries
     */
    _handleIntersection(entries) {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                this._loadElement(entry.target);
                this._observer.unobserve(entry.target);
                this._observedElements.delete(entry.target);
            }
        }
    }

    /**
     * 加载元素资源
     * @param {HTMLElement} el
     */
    _loadElement(el) {
        const src = el.getAttribute(this.dataAttr);
        if (!src) return;

        if (el.tagName === 'IMG') {
            el.onload = () => {
                this._stats.totalLoaded++;
                el.removeAttribute(this.dataAttr);
                if (this.onLoad) this.onLoad(el);
            };
            el.onerror = () => {
                this._stats.totalError++;
                if (this.onError) this.onError(el, new Error('Failed to load image'));
            };
            el.src = src;
        } else if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO' || el.tagName === 'SOURCE') {
            el.src = src;
            el.removeAttribute(this.dataAttr);
            this._stats.totalLoaded++;
            if (this.onLoad) this.onLoad(el);
        } else {
            // 其他元素：设置background-image
            el.style.backgroundImage = `url(${src})`;
            el.removeAttribute(this.dataAttr);
            this._stats.totalLoaded++;
            if (this.onLoad) this.onLoad(el);
        }
    }

    /**
     * 观察一个元素
     * @param {HTMLElement} el
     */
    observe(el) {
        if (!el || !el.hasAttribute(this.dataAttr)) return;

        this.init();

        if (this._observer) {
            this._observer.observe(el);
            this._observedElements.add(el);
            this._stats.totalObserved++;
        } else {
            // 降级：直接加载
            this._loadElement(el);
        }
    }

    /**
     * 批量观察元素
     * @param {NodeList|Array<HTMLElement>} elements
     */
    observeAll(elements) {
        for (const el of elements) {
            this.observe(el);
        }
    }

    /**
     * 扫描容器内所有需要懒加载的元素
     * @param {HTMLElement} container
     * @param {string} [selector] - 选择器，默认为所有带data-src属性的img元素
     */
    scan(container, selector = null) {
        if (!selector) {
            selector = `img[${this.dataAttr}], video[${this.dataAttr}], audio[${this.dataAttr}], source[${this.dataAttr}]`;
        }
        const elements = container.querySelectorAll(selector);
        this.observeAll(elements);
    }

    /**
     * 取消观察所有元素
     */
    unobserveAll() {
        if (this._observer) {
            for (const el of this._observedElements) {
                this._observer.unobserve(el);
            }
        }
        this._observedElements.clear();
    }

    /**
     * 获取统计信息
     */
    getStats() {
        return {
            ...this._stats,
            pendingCount: this._observedElements.size
        };
    }

    /**
     * 销毁懒加载器
     */
    destroy() {
        this.unobserveAll();
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }
    }
}

// ============================================
// 性能监控工具
// ============================================

/**
 * 性能监控器 - 测量渲染性能
 */
export class PerformanceMonitor {
    constructor() {
        this._marks = new Map();
        this._measures = [];
    }

    /**
     * 设置标记点
     * @param {string} name
     */
    mark(name) {
        this._marks.set(name, performance.now());
    }

    /**
     * 测量两个标记之间的时间
     * @param {string} name - 测量名称
     * @param {string} startMark - 开始标记
     * @param {string} [endMark] - 结束标记（默认为当前时间）
     * @returns {number} 耗时(ms)
     */
    measure(name, startMark, endMark = null) {
        const start = this._marks.get(startMark);
        if (!start) {
            console.warn(`PerformanceMonitor: Start mark "${startMark}" not found`);
            return -1;
        }
        const end = endMark ? (this._marks.get(endMark) || performance.now()) : performance.now();
        const duration = end - start;
        this._measures.push({ name, start, end, duration });
        return duration;
    }

    /**
     * 测量函数执行时间
     * @param {string} name - 名称
     * @param {Function} fn - 函数
     * @returns {{ result: any, duration: number }}
     */
    time(name, fn) {
        const start = performance.now();
        const result = fn();
        const duration = performance.now() - start;
        this._measures.push({ name, start, end: start + duration, duration });
        return { result, duration };
    }

    /**
     * 异步测量函数执行时间
     * @param {string} name
     * @param {Function} fn - 异步函数
     * @returns {Promise<{ result: any, duration: number }>}
     */
    async timeAsync(name, fn) {
        const start = performance.now();
        const result = await fn();
        const duration = performance.now() - start;
        this._measures.push({ name, start, end: start + duration, duration });
        return { result, duration };
    }

    /**
     * 测量FPS（帧率）
     * @param {number} [duration=1000] - 测量时长(ms)
     * @returns {Promise<{ avg: number, min: number, max: number, frames: number }>}
     */
    measureFPS(duration = 1000) {
        return new Promise((resolve) => {
            let frames = 0;
            let lastTime = performance.now();
            const frameTimes = [];

            const tick = (now) => {
                frames++;
                frameTimes.push(now - lastTime);
                lastTime = now;

                if (now - frameTimes[0] >= duration) {
                    const avg = 1000 / (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length);
                    const min = 1000 / Math.max(...frameTimes);
                    const max = 1000 / Math.min(...frameTimes);
                    resolve({ avg: Math.round(avg * 10) / 10, min: Math.round(min * 10) / 10, max: Math.round(max * 10) / 10, frames });
                } else {
                    requestAnimationFrame(tick);
                }
            };

            requestAnimationFrame(tick);
        });
    }

    /**
     * 获取所有测量结果
     * @returns {Array}
     */
    getMeasures() {
        return [...this._measures];
    }

    /**
     * 生成报告
     * @returns {string}
     */
    getReport() {
        const lines = ['=== Performance Report ==='];
        for (const m of this._measures) {
            lines.push(`  ${m.name}: ${m.duration.toFixed(2)}ms`);
        }
        return lines.join('\n');
    }

    /**
     * 清除所有数据
     */
    clear() {
        this._marks.clear();
        this._measures.length = 0;
    }
}

export default {
    DOMBatchUpdater,
    RAFScheduler,
    DOMDiffer,
    TemplateCache,
    LazyLoader,
    PerformanceMonitor
};
