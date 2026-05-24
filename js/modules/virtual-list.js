/**
 * CPA智刷 - 虚拟滚动模块
 * R29: 虚拟滚动与渲染优化
 * @module virtual-list
 *
 * 功能：
 * - 只渲染可视区域内的DOM元素
 * - 支持动态行高（每项高度可不同）
 * - 支持固定行高模式（性能更好）
 * - 滚动事件优化（requestAnimationFrame节流）
 * - 支持键盘导航
 * - 支持快速跳转到指定索引
 * - 支持搜索过滤
 * - 支持分页预加载
 * - 回收DOM元素池（减少GC压力）
 * - 滚动位置记忆（切换页面后恢复）
 */

/**
 * DOM元素池 - 回收和复用DOM节点以减少GC压力
 */
class DOMNodePool {
    constructor(createNode, resetNode) {
        this._pool = [];
        this._createNode = createNode;
        this._resetNode = resetNode;
        this._createdCount = 0;
        this._reusedCount = 0;
    }

    /**
     * 从池中获取一个节点，如果没有可用节点则创建新的
     * @returns {HTMLElement}
     */
    acquire() {
        if (this._pool.length > 0) {
            this._reusedCount++;
            return this._pool.pop();
        }
        this._createdCount++;
        return this._createNode();
    }

    /**
     * 将节点归还到池中
     * @param {HTMLElement} node
     */
    release(node) {
        if (this._resetNode) {
            this._resetNode(node);
        }
        // 限制池大小，防止内存泄漏
        if (this._pool.length < 200) {
            this._pool.push(node);
        }
    }

    /**
     * 清空池
     */
    clear() {
        this._pool.length = 0;
        this._createdCount = 0;
        this._reusedCount = 0;
    }

    /**
     * 获取池统计信息
     */
    getStats() {
        return {
            poolSize: this._pool.length,
            createdCount: this._createdCount,
            reusedCount: this._reusedCount
        };
    }
}

/**
 * 滚动位置记忆管理器
 */
class ScrollMemory {
    constructor() {
        this._storage = new Map();
        this._prefix = 'vl_scroll_';
    }

    /**
     * 保存滚动位置
     * @param {string} key - 记忆键
     * @param {number} scrollTop - 滚动位置
     * @param {number} focusedIndex - 聚焦的索引
     */
    save(key, scrollTop, focusedIndex = -1) {
        this._storage.set(this._prefix + key, {
            scrollTop,
            focusedIndex,
            timestamp: Date.now()
        });
    }

    /**
     * 恢复滚动位置
     * @param {string} key - 记忆键
     * @returns {{ scrollTop: number, focusedIndex: number } | null}
     */
    restore(key) {
        const data = this._storage.get(this._prefix + key);
        if (!data) return null;
        return {
            scrollTop: data.scrollTop,
            focusedIndex: data.focusedIndex
        };
    }

    /**
     * 清除指定键的记忆
     * @param {string} key
     */
    clear(key) {
        if (key) {
            this._storage.delete(this._prefix + key);
        } else {
            this._storage.clear();
        }
    }
}

/**
 * 虚拟列表核心类
 */
export class VirtualList {
    // 静态滚动位置记忆（跨实例共享）
    static _sharedScrollMemory = new ScrollMemory();

    /**
     * @param {Object} options
     * @param {HTMLElement} options.container - 滚动容器元素
     * @param {Array} options.items - 数据项数组
     * @param {Function} options.renderItem - 渲染单项的函数 (item, index) => HTMLElement
     * @param {number} [options.itemHeight=50] - 固定行高（固定模式）
     * @param {Function} [options.estimateHeight] - 动态行高估算函数 (item, index) => number
     * @param {number} [options.overscan=5] - 可视区域外额外渲染的项数
     * @param {string} [options.memoryKey] - 滚动位置记忆键
     * @param {Function} [options.onLoadMore] - 分页预加载回调 (startIndex, count) => Promise
     * @param {number} [options.loadMoreThreshold=200] - 触发预加载的剩余像素阈值
     * @param {boolean} [options.keyboardNav=true] - 是否启用键盘导航
     * @param {Function} [options.onItemFocus] - 键盘聚焦回调 (index, item) => void
     */
    constructor(options) {
        this.container = options.container;
        this.items = options.items || [];
        this.renderItem = options.renderItem;
        this.itemHeight = options.itemHeight || 50;
        this.estimateHeight = options.estimateHeight || (() => this.itemHeight);
        this.overscan = options.overscan || 5;
        this.memoryKey = options.memoryKey || '';
        this.onLoadMore = options.onLoadMore || null;
        this.loadMoreThreshold = options.loadMoreThreshold || 200;
        this.keyboardNav = options.keyboardNav !== false;
        this.onItemFocus = options.onItemFocus || null;

        // 固定行高 vs 动态行高
        this.fixedHeight = options.estimateHeight ? false : true;

        // 内部状态
        this._scrollTop = 0;
        this._viewportHeight = 0;
        this._startIndex = 0;
        this._endIndex = 0;
        this._focusedIndex = -1;
        this._filteredItems = null; // 搜索过滤后的数据
        this._filterText = '';
        this._isScrolling = false;
        this._rafId = null;
        this._lastScrollTime = 0;
        this._loadingMore = false;
        this._destroyed = false;

        // 动态行高缓存
        this._heightCache = new Map();
        this._totalHeight = 0;
        this._positions = []; // 累积位置数组

        // DOM元素池
        this._nodePool = new DOMNodePool(
            () => document.createElement('div'),
            (node) => {
                node.innerHTML = '';
                node.className = '';
                node.style.cssText = '';
            }
        );

        // 已渲染的节点映射 { index => { node, top, height } }
        this._renderedNodes = new Map();

        // 创建内部结构
        this._spacer = document.createElement('div');
        this._spacer.style.cssText = 'position:relative;width:100%;pointer-events:none;';
        this._content = document.createElement('div');
        this._content.style.cssText = 'position:absolute;top:0;left:0;width:100%;';

        this.container.style.cssText += 'overflow-y:auto;position:relative;';
        this.container.appendChild(this._spacer);
        this.container.appendChild(this._content);

        // 初始化
        this._initPositions();
        this._bindEvents();
        this._updateViewport();
        this._calculateVisibleRange();
        this.render();

        // 恢复滚动位置
        if (this.memoryKey) {
            this.restoreScroll();
        }
    }

    /**
     * 初始化位置数组（用于动态行高模式）
     */
    _initPositions() {
        const items = this._filteredItems || this.items;
        this._positions = new Array(items.length + 1);
        this._positions[0] = 0;
        for (let i = 0; i < items.length; i++) {
            const h = this._heightCache.has(i) ? this._heightCache.get(i) : this.estimateHeight(items[i], i);
            this._positions[i + 1] = this._positions[i] + h;
        }
        this._totalHeight = this._positions[items.length];
        this._spacer.style.height = this._totalHeight + 'px';
    }

    /**
     * 绑定事件
     */
    _bindEvents() {
        this._onScroll = () => {
            this._scheduleUpdate();
        };

        this._onResize = () => {
            this._updateViewport();
            this.render();
        };

        this._onKeyDown = (e) => {
            if (!this.keyboardNav) return;
            this._handleKeyboard(e);
        };

        this.container.addEventListener('scroll', this._onScroll, { passive: true });
        this._resizeObserver = new ResizeObserver(this._onResize);
        this._resizeObserver.observe(this.container);
        this.container.addEventListener('keydown', this._onKeyDown);

        this._boundResize = this._onResize;
        window.addEventListener('resize', this._boundResize);
    }

    /**
     * 更新视口尺寸
     */
    _updateViewport() {
        this._viewportHeight = this.container.clientHeight;
    }

    /**
     * 使用requestAnimationFrame节流滚动更新
     */
    _scheduleUpdate() {
        if (this._rafId !== null) return;
        this._rafId = requestAnimationFrame(() => {
            this._rafId = null;
            if (!this._destroyed) {
                this._onScrollFrame();
            }
        });
    }

    /**
     * 滚动帧处理
     */
    _onScrollFrame() {
        const prevStart = this._startIndex;
        const prevEnd = this._endIndex;

        this._scrollTop = this.container.scrollTop;
        this._calculateVisibleRange();

        // 检查是否需要预加载
        this._checkLoadMore();

        // 只在可见范围变化时重新渲染
        if (this._startIndex !== prevStart || this._endIndex !== prevEnd) {
            this.render();
        }

        // 保存滚动位置
        if (this.memoryKey) {
            VirtualList._sharedScrollMemory.save(this.memoryKey, this._scrollTop, this._focusedIndex);
        }
    }

    /**
     * 计算当前可见范围
     */
    _calculateVisibleRange() {
        const items = this._filteredItems || this.items;
        if (items.length === 0) {
            this._startIndex = 0;
            this._endIndex = 0;
            return;
        }

        if (this.fixedHeight) {
            // 固定行高模式 - O(1)计算
            const startIdx = Math.max(0, Math.floor(this._scrollTop / this.itemHeight) - this.overscan);
            const visibleCount = Math.ceil(this._viewportHeight / this.itemHeight);
            const endIdx = Math.min(items.length, startIdx + visibleCount + this.overscan * 2);
            this._startIndex = startIdx;
            this._endIndex = endIdx;
        } else {
            // 动态行高模式 - 二分查找
            this._startIndex = this._findIndexAtScrollTop(this._scrollTop);
            this._startIndex = Math.max(0, this._startIndex - this.overscan);

            const bottomScroll = this._scrollTop + this._viewportHeight;
            this._endIndex = this._findIndexAtScrollTop(bottomScroll);
            this._endIndex = Math.min(items.length, this._endIndex + this.overscan + 1);
        }
    }

    /**
     * 二分查找：找到scrollTop对应的索引
     * @param {number} scrollTop
     * @returns {number}
     */
    _findIndexAtScrollTop(scrollTop) {
        const items = this._filteredItems || this.items;
        let low = 0;
        let high = items.length;

        while (low < high) {
            const mid = (low + high) >> 1;
            if (this._positions[mid] <= scrollTop) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        return Math.max(0, low - 1);
    }

    /**
     * 检查是否需要预加载更多数据
     */
    _checkLoadMore() {
        if (!this.onLoadMore || this._loadingMore) return;

        const items = this._filteredItems || this.items;
        const scrollBottom = this._scrollTop + this._viewportHeight;
        const distanceToBottom = this._totalHeight - scrollBottom;

        if (distanceToBottom < this.loadMoreThreshold) {
            this._loadingMore = true;
            this.onLoadMore(items.length, 50).then((newItems) => {
                if (newItems && newItems.length > 0) {
                    this.items = this.items.concat(newItems);
                    if (this._filteredItems) {
                        // 重新应用过滤
                        this._applyFilter(this._filterText);
                    } else {
                        this._initPositions();
                        this.render();
                    }
                }
                this._loadingMore = false;
            }).catch(() => {
                this._loadingMore = false;
            });
        }
    }

    /**
     * 渲染当前可见范围
     */
    render() {
        const items = this._filteredItems || this.items;

        // 回收所有已渲染的节点
        for (const [idx, entry] of this._renderedNodes) {
            this._nodePool.release(entry.node);
        }
        this._renderedNodes.clear();
        this._content.innerHTML = '';

        if (items.length === 0) {
            return;
        }

        // 渲染可见项
        const fragment = document.createDocumentFragment();
        for (let i = this._startIndex; i < this._endIndex; i++) {
            const item = items[i];
            const node = this._nodePool.acquire();

            // 调用渲染函数
            const rendered = this.renderItem(item, i);
            if (rendered) {
                if (rendered.nodeType === 1) {
                    node.appendChild(rendered);
                } else {
                    node.innerHTML = String(rendered);
                }
            }

            // 设置位置
            let top, height;
            if (this.fixedHeight) {
                top = i * this.itemHeight;
                height = this.itemHeight;
            } else {
                top = this._positions[i];
                height = this._positions[i + 1] - this._positions[i];
            }

            node.style.position = 'absolute';
            node.style.top = top + 'px';
            node.style.left = '0';
            node.style.width = '100%';
            node.style.minHeight = height + 'px';

            // 键盘聚焦样式
            if (i === this._focusedIndex) {
                node.classList.add('vl-focused');
                node.setAttribute('tabindex', '0');
            }

            // 更新动态行高缓存
            if (!this.fixedHeight) {
                const actualHeight = node.offsetHeight || height;
                if (actualHeight !== height) {
                    this._heightCache.set(i, actualHeight);
                }
            }

            this._renderedNodes.set(i, { node, top, height });
            fragment.appendChild(node);
        }

        this._content.appendChild(fragment);
    }

    /**
     * 键盘导航处理
     * @param {KeyboardEvent} e
     */
    _handleKeyboard(e) {
        const items = this._filteredItems || this.items;
        if (items.length === 0) return;

        let newIndex = this._focusedIndex;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                newIndex = Math.min(items.length - 1, this._focusedIndex + 1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                newIndex = Math.max(0, this._focusedIndex - 1);
                break;
            case 'Home':
                e.preventDefault();
                newIndex = 0;
                break;
            case 'End':
                e.preventDefault();
                newIndex = items.length - 1;
                break;
            case 'PageDown':
                e.preventDefault();
                newIndex = Math.min(items.length - 1, this._focusedIndex + Math.floor(this._viewportHeight / this.itemHeight));
                break;
            case 'PageUp':
                e.preventDefault();
                newIndex = Math.max(0, this._focusedIndex - Math.floor(this._viewportHeight / this.itemHeight));
                break;
            case 'Enter':
                if (this._focusedIndex >= 0 && this.onItemFocus) {
                    this.onItemFocus(this._focusedIndex, items[this._focusedIndex]);
                }
                return;
            default:
                return;
        }

        if (newIndex !== this._focusedIndex) {
            this._focusedIndex = newIndex;
            this.scrollToIndex(newIndex);
            this.render();

            if (this.onItemFocus) {
                this.onItemFocus(newIndex, items[newIndex]);
            }
        }
    }

    /**
     * 跳转到指定索引
     * @param {number} index - 目标索引
     * @param {string} [behavior='smooth'] - 滚动行为 'smooth' | 'auto'
     */
    scrollToIndex(index, behavior = 'smooth') {
        const items = this._filteredItems || this.items;
        if (index < 0 || index >= items.length) return;

        let top;
        if (this.fixedHeight) {
            top = index * this.itemHeight;
        } else {
            top = this._positions[index];
        }

        // 确保目标项在视口中间
        const targetScroll = Math.max(0, top - this._viewportHeight / 2 + this.itemHeight / 2);

        if (behavior === 'auto') {
            this.container.scrollTop = targetScroll;
            this._scrollTop = targetScroll;
            this._calculateVisibleRange();
            this.render();
        } else {
            this.container.scrollTo({
                top: targetScroll,
                behavior: 'smooth'
            });
        }

        this._focusedIndex = index;
    }

    /**
     * 搜索过滤
     * @param {string} text - 搜索文本
     * @param {Function} [filterFn] - 自定义过滤函数 (item, text) => boolean
     */
    filter(text, filterFn = null) {
        this._filterText = text;
        this._applyFilter(text, filterFn);
    }

    /**
     * 应用过滤
     * @param {string} text
     * @param {Function} [filterFn]
     */
    _applyFilter(text, filterFn = null) {
        if (!text && !filterFn) {
            this._filteredItems = null;
        } else {
            const lowerText = text.toLowerCase();
            this._filteredItems = this.items.filter((item, idx) => {
                if (filterFn) return filterFn(item, text, idx);
                // 默认搜索：匹配item的字符串表示
                const str = JSON.stringify(item).toLowerCase();
                return str.includes(lowerText);
            });
        }

        this._focusedIndex = -1;
        this._initPositions();
        this.container.scrollTop = 0;
        this._scrollTop = 0;
        this._calculateVisibleRange();
        this.render();
    }

    /**
     * 清除过滤
     */
    clearFilter() {
        this.filter('');
    }

    /**
     * 获取当前过滤后的项数
     * @returns {number}
     */
    getFilteredCount() {
        if (this._filteredItems) return this._filteredItems.length;
        return this.items.length;
    }

    /**
     * 保存滚动位置
     */
    saveScroll() {
        if (this.memoryKey) {
            VirtualList._sharedScrollMemory.save(this.memoryKey, this._scrollTop, this._focusedIndex);
        }
    }

    /**
     * 恢复滚动位置
     * @returns {boolean} 是否成功恢复
     */
    restoreScroll() {
        if (!this.memoryKey) return false;
        const pos = VirtualList._sharedScrollMemory.restore(this.memoryKey);
        if (!pos) return false;

        this.container.scrollTop = pos.scrollTop;
        this._scrollTop = pos.scrollTop;
        if (pos.focusedIndex >= 0) {
            this._focusedIndex = pos.focusedIndex;
        }
        this._calculateVisibleRange();
        this.render();
        return true;
    }

    /**
     * 更新数据源
     * @param {Array} newItems - 新数据
     * @param {boolean} [resetScroll=true] - 是否重置滚动位置
     */
    setItems(newItems, resetScroll = true) {
        this.items = newItems;
        this._filteredItems = null;
        this._filterText = '';
        this._heightCache.clear();
        this._focusedIndex = -1;

        if (resetScroll) {
            this.container.scrollTop = 0;
            this._scrollTop = 0;
        }

        this._initPositions();
        this._calculateVisibleRange();
        this.render();
    }

    /**
     * 获取性能统计信息
     * @returns {Object}
     */
    getStats() {
        return {
            totalItems: this.items.length,
            filteredItems: this._filteredItems ? this._filteredItems.length : this.items.length,
            visibleRange: [this._startIndex, this._endIndex],
            renderedCount: this._endIndex - this._startIndex,
            focusedIndex: this._focusedIndex,
            scrollTop: this._scrollTop,
            totalHeight: this._totalHeight,
            fixedHeight: this.fixedHeight,
            nodePool: this._nodePool.getStats(),
            heightCacheSize: this._heightCache.size
        };
    }

    /**
     * 测量并更新动态行高
     * 在DOM更新后调用以获取真实高度
     */
    measureItems() {
        if (this.fixedHeight) return;

        let needsUpdate = false;
        for (const [idx, entry] of this._renderedNodes) {
            const actualHeight = entry.node.offsetHeight;
            if (actualHeight > 0 && actualHeight !== this._heightCache.get(idx)) {
                this._heightCache.set(idx, actualHeight);
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            this._initPositions();
        }
    }

    /**
     * 销毁虚拟列表，释放资源
     */
    destroy() {
        this._destroyed = true;

        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }

        this.container.removeEventListener('scroll', this._onScroll);
        this.container.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('resize', this._boundResize);

        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
        }

        // 保存滚动位置
        this.saveScroll();

        // 清理DOM
        this._nodePool.clear();
        this._renderedNodes.clear();
        this._heightCache.clear();
        this._positions.length = 0;

        if (this._spacer.parentNode) {
            this._spacer.parentNode.removeChild(this._spacer);
        }
        if (this._content.parentNode) {
            this._content.parentNode.removeChild(this._content);
        }
    }
}

/**
 * DOMNodePool 导出（供外部使用）
 */
export { DOMNodePool, ScrollMemory };

export default VirtualList;
