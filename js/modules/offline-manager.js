/**
 * CPA智刷 - 离线管理模块
 * R27 PWA离线支持功能
 * 
 * 功能：
 * - 网络状态监测（online/offline事件）
 * - 离线答题队列（IndexedDB存储）
 * - 网络恢复后自动同步
 * - 同步冲突处理
 * - 用户提示（Toast通知）
 */

import { db } from './db.js';

// ============================================
// 常量定义
// ============================================
const OFFLINE_STORE_NAME = 'offline_queue';
const SYNC_STATUS_STORE = 'sync_status';
const MAX_RETRY_COUNT = 3;
const SYNC_INTERVAL = 5000; // 同步检查间隔（毫秒）
const TOAST_DURATION = 3000;

// ============================================
// 离线管理器类
// ============================================
class OfflineManager {
    constructor() {
        this.isOnline = navigator.onLine;
        this.syncInProgress = false;
        this.pendingCount = 0;
        this.listeners = new Map();
        this.syncInterval = null;
        this._initialized = false;
        
        // 绑定事件处理函数
        this._handleOnline = this._handleOnline.bind(this);
        this._handleOffline = this._handleOffline.bind(this);
        this._handleVisibilityChange = this._handleVisibilityChange.bind(this);
    }

    /**
     * 初始化离线管理器
     */
    async init() {
        if (this._initialized) return;
        
        console.log('[OfflineManager] Initializing...');
        
        // 确保IndexedDB已初始化
        await db.init();
        
        // 创建离线队列存储（如果不存在）
        await this._ensureOfflineStore();
        
        // 绑定网络状态事件
        window.addEventListener('online', this._handleOnline);
        window.addEventListener('offline', this._handleOffline);
        document.addEventListener('visibilitychange', this._handleVisibilityChange);
        
        // 注册Service Worker消息监听
        this._setupServiceWorkerListener();
        
        // 启动定期同步检查
        this._startSyncInterval();
        
        // 更新待同步数量
        await this.updatePendingCount();
        
        this._initialized = true;
        
        // 显示初始状态
        if (!this.isOnline) {
            this._showOfflineToast();
        }
        
        console.log('[OfflineManager] Initialized, online:', this.isOnline);
    }

    /**
     * 确保离线队列存储存在
     */
    async _ensureOfflineStore() {
        // 使用db模块的batchPut方法，它会自动处理存储创建
        // 这里我们只需确保数据库已打开
        return db.init();
    }

    /**
     * 设置Service Worker消息监听
     */
    _setupServiceWorkerListener() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', (event) => {
                const { type, data } = event.data;
                
                switch (type) {
                    case 'SYNC_ANSWERS':
                        console.log('[OfflineManager] Received sync request from SW');
                        this.syncPendingAnswers();
                        break;
                    case 'data-updated':
                        console.log('[OfflineManager] Data updated:', data);
                        this._emit('dataUpdated', data);
                        break;
                    default:
                        break;
                }
            });
        }
    }

    /**
     * 启动定期同步检查
     */
    _startSyncInterval() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }
        
        this.syncInterval = setInterval(() => {
            if (this.isOnline && this.pendingCount > 0 && !this.syncInProgress) {
                this.syncPendingAnswers();
            }
        }, SYNC_INTERVAL);
    }

    /**
     * 停止定期同步检查
     */
    _stopSyncInterval() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    /**
     * 处理网络恢复
     */
    _handleOnline() {
        console.log('[OfflineManager] Network restored');
        this.isOnline = true;
        
        this._showToast('网络已恢复', 'success');
        this._emit('online', { timestamp: Date.now() });
        
        // 触发同步
        if (this.pendingCount > 0) {
            setTimeout(() => this.syncPendingAnswers(), 1000);
        }
        
        // 注册后台同步
        this._registerBackgroundSync();
    }

    /**
     * 处理网络断开
     */
    _handleOffline() {
        console.log('[OfflineManager] Network lost');
        this.isOnline = false;
        
        this._showOfflineToast();
        this._emit('offline', { timestamp: Date.now() });
    }

    /**
     * 显示离线提示
     */
    _showOfflineToast() {
        this._showToast('已进入离线模式，答题将在网络恢复后同步', 'warning', 5000);
    }

    /**
     * 处理页面可见性变化
     */
    _handleVisibilityChange() {
        if (document.visibilityState === 'visible') {
            // 页面重新可见时检查网络状态
            const wasOnline = this.isOnline;
            this.isOnline = navigator.onLine;
            
            if (!wasOnline && this.isOnline) {
                this._handleOnline();
            } else if (wasOnline && !this.isOnline) {
                this._handleOffline();
            }
            
            // 更新待同步数量
            this.updatePendingCount();
        }
    }

    /**
     * 注册后台同步
     */
    async _registerBackgroundSync() {
        if ('serviceWorker' in navigator && 'SyncManager' in window) {
            try {
                const registration = await navigator.serviceWorker.ready;
                await registration.sync.register('sync-answers');
                console.log('[OfflineManager] Background sync registered');
            } catch (error) {
                console.warn('[OfflineManager] Background sync registration failed:', error);
            }
        }
    }

    // ============================================
    // 答题队列管理
    // ============================================

    /**
     * 添加答题记录到离线队列
     * @param {Object} answerData - 答题数据
     * @returns {Promise<string>} 队列项ID
     */
    async queueAnswer(answerData) {
        const queueItem = {
            id: `answer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'answer',
            data: {
                questionKey: answerData.questionKey,
                subjectId: answerData.subjectId,
                questionId: answerData.questionId,
                userAnswer: answerData.userAnswer,
                isCorrect: answerData.isCorrect,
                timestamp: answerData.timestamp || Date.now(),
                timeSpent: answerData.timeSpent || 0
            },
            status: 'pending',
            retryCount: 0,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        try {
            // 存储到IndexedDB
            await db.put(OFFLINE_STORE_NAME, queueItem);
            
            // 更新待同步计数
            await this.updatePendingCount();
            
            console.log('[OfflineManager] Answer queued:', queueItem.id);
            
            // 如果在线，尝试立即同步
            if (this.isOnline && !this.syncInProgress) {
                this.syncPendingAnswers();
            }
            
            return queueItem.id;
        } catch (error) {
            console.error('[OfflineManager] Failed to queue answer:', error);
            throw error;
        }
    }

    /**
     * 批量添加答题记录
     * @param {Array} answers - 答题数据数组
     * @returns {Promise<string[]>} 队列项ID数组
     */
    async queueAnswersBatch(answers) {
        const queueItems = answers.map(answer => ({
            id: `answer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'answer',
            data: {
                questionKey: answer.questionKey,
                subjectId: answer.subjectId,
                questionId: answer.questionId,
                userAnswer: answer.userAnswer,
                isCorrect: answer.isCorrect,
                timestamp: answer.timestamp || Date.now(),
                timeSpent: answer.timeSpent || 0
            },
            status: 'pending',
            retryCount: 0,
            createdAt: Date.now(),
            updatedAt: Date.now()
        }));

        try {
            await db.batchPut(OFFLINE_STORE_NAME, queueItems);
            await this.updatePendingCount();
            
            console.log('[OfflineManager] Batch answers queued:', queueItems.length);
            
            if (this.isOnline && !this.syncInProgress) {
                this.syncPendingAnswers();
            }
            
            return queueItems.map(item => item.id);
        } catch (error) {
            console.error('[OfflineManager] Failed to queue batch answers:', error);
            throw error;
        }
    }

    /**
     * 获取待同步的答题记录
     * @returns {Promise<Array>}
     */
    async getPendingAnswers() {
        try {
            const allItems = await db.getAll(OFFLINE_STORE_NAME);
            return allItems.filter(item => item.status === 'pending' || item.status === 'failed');
        } catch (error) {
            console.error('[OfflineManager] Failed to get pending answers:', error);
            return [];
        }
    }

    /**
     * 更新待同步计数
     */
    async updatePendingCount() {
        try {
            const pending = await this.getPendingAnswers();
            this.pendingCount = pending.length;
            this._emit('pendingCountChanged', { count: this.pendingCount });
            return this.pendingCount;
        } catch (error) {
            console.error('[OfflineManager] Failed to update pending count:', error);
            return 0;
        }
    }

    /**
     * 获取待同步数量
     * @returns {number}
     */
    getPendingCount() {
        return this.pendingCount;
    }

    // ============================================
    // 同步逻辑
    // ============================================

    /**
     * 同步待处理的答题记录
     * @returns {Promise<Object>} 同步结果
     */
    async syncPendingAnswers() {
        if (this.syncInProgress) {
            console.log('[OfflineManager] Sync already in progress');
            return { synced: 0, skipped: true };
        }

        if (!this.isOnline) {
            console.log('[OfflineManager] Cannot sync while offline');
            return { synced: 0, offline: true };
        }

        this.syncInProgress = true;
        this._emit('syncStarted', { timestamp: Date.now() });

        const result = {
            synced: 0,
            failed: 0,
            conflicts: 0,
            errors: []
        };

        try {
            const pendingAnswers = await this.getPendingAnswers();
            
            if (pendingAnswers.length === 0) {
                console.log('[OfflineManager] No pending answers to sync');
                this.syncInProgress = false;
                return result;
            }

            console.log(`[OfflineManager] Syncing ${pendingAnswers.length} answers...`);
            this._showToast(`正在同步 ${pendingAnswers.length} 条答题记录...`, 'info');

            // 按时间排序，先答的先同步
            pendingAnswers.sort((a, b) => a.data.timestamp - b.data.timestamp);

            for (const item of pendingAnswers) {
                try {
                    const syncResult = await this._syncSingleAnswer(item);
                    
                    if (syncResult.success) {
                        // 同步成功，删除队列项
                        await db.delete(OFFLINE_STORE_NAME, item.id);
                        result.synced++;
                    } else if (syncResult.conflict) {
                        // 冲突处理
                        await this._handleConflict(item, syncResult);
                        result.conflicts++;
                    } else {
                        // 同步失败，增加重试计数
                        await this._incrementRetry(item);
                        result.failed++;
                    }
                } catch (error) {
                    console.error(`[OfflineManager] Sync error for item ${item.id}:`, error);
                    await this._incrementRetry(item);
                    result.failed++;
                    result.errors.push({ id: item.id, error: error.message });
                }
            }

            // 更新待同步计数
            await this.updatePendingCount();

            // 显示同步结果
            if (result.synced > 0) {
                this._showToast(`成功同步 ${result.synced} 条答题记录`, 'success');
            }
            if (result.failed > 0) {
                this._showToast(`${result.failed} 条记录同步失败，将稍后重试`, 'warning');
            }
            if (result.conflicts > 0) {
                this._showToast(`处理了 ${result.conflicts} 条冲突记录`, 'info');
            }

            this._emit('syncCompleted', result);
            console.log('[OfflineManager] Sync completed:', result);

        } catch (error) {
            console.error('[OfflineManager] Sync failed:', error);
            this._emit('syncFailed', { error: error.message });
            this._showToast('同步失败，请检查网络连接', 'error');
        } finally {
            this.syncInProgress = false;
        }

        return result;
    }

    /**
     * 同步单条答题记录
     * @param {Object} item - 队列项
     * @returns {Promise<Object>}
     */
    async _syncSingleAnswer(item) {
        // 这里模拟同步到服务器
        // 实际项目中应该调用真实的API
        
        try {
            // 检查本地是否已有更新的答案
            const { storageSystem } = await import('./index.js');
            const existingAnswer = await storageSystem.get('answers', item.data.questionKey);
            
            if (existingAnswer) {
                // 如果本地已有答案，且时间戳更新，则可能存在冲突
                if (existingAnswer.timestamp > item.data.timestamp) {
                    return {
                        success: false,
                        conflict: true,
                        localData: existingAnswer,
                        queueData: item.data
                    };
                }
            }

            // 保存到本地存储（模拟同步到服务器）
            await storageSystem.set('answers', item.data.questionKey, {
                isCorrect: item.data.isCorrect,
                userAnswer: item.data.userAnswer,
                timestamp: item.data.timestamp,
                timeSpent: item.data.timeSpent,
                synced: true,
                syncedAt: Date.now()
            });

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 处理同步冲突
     * @param {Object} item - 队列项
     * @param {Object} conflictData - 冲突数据
     */
    async _handleConflict(item, conflictData) {
        console.log('[OfflineManager] Handling conflict for:', item.id);
        
        // 冲突解决策略：以最新的答案为准
        const localTime = conflictData.localData.timestamp;
        const queueTime = conflictData.queueData.timestamp;
        
        if (queueTime >= localTime) {
            // 队列中的答案更新，覆盖本地
            const { storageSystem } = await import('./index.js');
            await storageSystem.set('answers', item.data.questionKey, {
                isCorrect: item.data.isCorrect,
                userAnswer: item.data.userAnswer,
                timestamp: item.data.timestamp,
                timeSpent: item.data.timeSpent,
                synced: true,
                syncedAt: Date.now()
            });
        }
        
        // 删除队列项
        await db.delete(OFFLINE_STORE_NAME, item.id);
    }

    /**
     * 增加重试计数
     * @param {Object} item - 队列项
     */
    async _incrementRetry(item) {
        item.retryCount++;
        item.updatedAt = Date.now();
        
        if (item.retryCount >= MAX_RETRY_COUNT) {
            item.status = 'failed';
            console.warn(`[OfflineManager] Item ${item.id} reached max retry count`);
        }
        
        await db.put(OFFLINE_STORE_NAME, item);
    }

    // ============================================
    // 事件系统
    // ============================================

    /**
     * 添加事件监听器
     * @param {string} event - 事件名称
     * @param {Function} callback - 回调函数
     * @returns {Function} 取消监听的函数
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);
        
        return () => this.off(event, callback);
    }

    /**
     * 移除事件监听器
     * @param {string} event - 事件名称
     * @param {Function} callback - 回调函数
     */
    off(event, callback) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).delete(callback);
        }
    }

    /**
     * 触发事件
     * @param {string} event - 事件名称
     * @param {*} data - 事件数据
     */
    _emit(event, data) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error('[OfflineManager] Event listener error:', error);
                }
            });
        }
    }

    // ============================================
    // Toast通知
    // ============================================

    /**
     * 显示Toast通知
     * @param {string} message - 消息内容
     * @param {string} type - 类型：success, error, warning, info
     * @param {number} duration - 显示时长（毫秒）
     */
    _showToast(message, type = 'info', duration = TOAST_DURATION) {
        // 使用全局toast函数（如果存在）
        if (typeof window.showToast === 'function') {
            window.showToast(message, type, duration);
            return;
        }

        // 创建自定义toast
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icons = {
            success: 'check-circle',
            error: 'times-circle',
            warning: 'exclamation-triangle',
            info: 'info-circle'
        };
        
        toast.innerHTML = `
            <i class="fas fa-${icons[type] || 'info-circle'}"></i>
            <span>${message}</span>
        `;
        
        container.appendChild(toast);
        
        // 触发动画
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
        
        // 自动移除
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    // ============================================
    // 公共API
    // ============================================

    /**
     * 检查是否在线
     * @returns {boolean}
     */
    checkOnline() {
        return this.isOnline;
    }

    /**
     * 手动触发同步
     * @returns {Promise<Object>}
     */
    async manualSync() {
        if (!this.isOnline) {
            this._showToast('当前处于离线状态，无法同步', 'warning');
            return { synced: 0, offline: true };
        }
        
        return this.syncPendingAnswers();
    }

    /**
     * 清空离线队列
     * @returns {Promise<void>}
     */
    async clearQueue() {
        try {
            const allItems = await db.getAll(OFFLINE_STORE_NAME);
            const keys = allItems.map(item => item.id);
            await db.batchDelete(OFFLINE_STORE_NAME, keys);
            await this.updatePendingCount();
            this._showToast('离线队列已清空', 'info');
        } catch (error) {
            console.error('[OfflineManager] Failed to clear queue:', error);
            throw error;
        }
    }

    /**
     * 获取同步状态
     * @returns {Object}
     */
    getStatus() {
        return {
            isOnline: this.isOnline,
            syncInProgress: this.syncInProgress,
            pendingCount: this.pendingCount,
            initialized: this._initialized
        };
    }

    /**
     * 销毁管理器
     */
    destroy() {
        this._stopSyncInterval();
        window.removeEventListener('online', this._handleOnline);
        window.removeEventListener('offline', this._handleOffline);
        document.removeEventListener('visibilitychange', this._handleVisibilityChange);
        this.listeners.clear();
        this._initialized = false;
    }
}

// ============================================
// 导出单例
// ============================================
const offlineManager = new OfflineManager();

export { offlineManager, OfflineManager };
export default offlineManager;
