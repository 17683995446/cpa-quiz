/**
 * Storage兼容层 - R28重构
 * 提供与原有Storage API兼容的接口，支持IndexedDB和localStorage自动降级
 * 集成分布式锁、事务管理和版本控制
 * @module storage-adapter
 */

import { db, STORE_DEFINITIONS } from './db.js';
import { lockManager, ReadWriteLock } from './distributed-lock.js';
import { transactionManager, OptimisticTransaction } from './transaction-manager.js';
import { versionController, syncCoordinator, MergeStrategy } from './version-control.js';

/**
 * Storage适配器类
 * 兼容原有Storage API，底层使用IndexedDB，支持自动降级到localStorage
 * 集成分布式锁、事务封装和版本控制
 */
class StorageAdapter {
    constructor() {
        this._version = 0;
        this._storageListeners = [];
        this._isReady = false;
        this._readyPromise = null;
        this._fallbackMode = false;
        this._initError = null;
        
        // R28新增：并发控制
        this._lockManager = lockManager;
        this._transactionManager = transactionManager;
        this._versionController = versionController;
        this._syncCoordinator = syncCoordinator;
        
        // R28新增：防抖和节流
        this._debounceMap = new Map();
        this._throttleMap = new Map();
        
        // R28新增：读写锁缓存
        this._rwLocks = new Map();
        
        // R28新增：配置
        this._config = {
            lockTimeout: 30000,
            transactionTimeout: 30000,
            debounceTime: 100,
            retryAttempts: 3,
            retryDelay: 100,
            enableVersionControl: true,
            enableDistributedLock: true
        };
    }

    /**
     * 初始化Storage适配器
     * @returns {Promise<boolean>}
     */
    async init() {
        if (this._readyPromise) {
            return this._readyPromise;
        }

        this._readyPromise = this._doInit();
        return this._readyPromise;
    }

    async _doInit() {
        try {
            // 初始化分布式锁
            if (this._config.enableDistributedLock) {
                await this._lockManager.init();
            }
            
            // 初始化同步协调器
            await this._syncCoordinator.init();
            
            // 监听远程变更
            this._syncCoordinator.onSync((event) => {
                this._handleRemoteSync(event);
            });

            // 尝试初始化IndexedDB
            await db.init();
            this._isReady = true;
            this._fallbackMode = false;
            console.log('StorageAdapter: IndexedDB initialized successfully with R28 concurrency support');
            return true;
        } catch (error) {
            console.warn('StorageAdapter: IndexedDB init failed, falling back to localStorage:', error);
            this._initError = error;
            this._fallbackMode = true;
            this._isReady = true;
            
            // 初始化localStorage监听器
            this._initLocalStorageListener();
            return false;
        }
    }

    /**
     * 等待适配器就绪
     */
    async ready() {
        if (!this._readyPromise) {
            await this.init();
        } else {
            await this._readyPromise;
        }
    }

    /**
     * 检查是否使用降级模式
     */
    isFallbackMode() {
        return this._fallbackMode;
    }

    /**
     * 获取初始化错误信息
     */
    getInitError() {
        return this._initError;
    }

    /**
     * 更新配置
     */
    configure(options) {
        this._config = { ...this._config, ...options };
    }

    // ==================== R28: 核心读写方法（带锁和事务）====================

    /**
     * 获取数据 - 兼容原有API，集成读写锁
     * @param {string} key
     * @param {any} defaultValue
     * @param {object} options
     */
    async get(key, defaultValue = null, options = {}) {
        await this.ready();

        const useLock = options.useLock !== false && this._config.enableDistributedLock;
        const lockToken = useLock ? await this._acquireReadLock(key) : null;

        try {
            if (this._fallbackMode) {
                return this._localStorageGet(key, defaultValue, options);
            }

            return await this._getWithTransaction(key, defaultValue, options);
        } finally {
            if (lockToken) {
                await this._releaseReadLock(key, lockToken);
            }
        }
    }

    /**
     * 设置数据 - 兼容原有API，集成分布式锁和事务
     * @param {string} key
     * @param {any} value
     * @param {object} options
     */
    async set(key, value, options = {}) {
        await this.ready();

        // 防抖处理
        if (options.debounce) {
            return this._debouncedSet(key, value, options);
        }

        const useLock = options.useLock !== false && this._config.enableDistributedLock;
        const lockToken = useLock ? await this._acquireWriteLock(key) : null;

        try {
            if (this._fallbackMode) {
                return this._localStorageSet(key, value);
            }

            return await this._setWithTransaction(key, value, options);
        } finally {
            if (lockToken) {
                await this._releaseWriteLock(key, lockToken);
            }
        }
    }

    /**
     * 原子更新操作 - 兼容原有API，集成乐观锁
     * @param {string} key
     * @param {function} updater
     * @param {any} defaultValue
     * @param {object} options
     */
    async update(key, updater, defaultValue = null, options = {}) {
        await this.ready();

        const maxRetries = options.retryAttempts || this._config.retryAttempts;
        let lastError = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const lockToken = await this._acquireWriteLock(key);

            try {
                if (this._fallbackMode) {
                    return this._localStorageUpdate(key, updater, defaultValue);
                }

                return await this._updateWithOptimisticLock(key, updater, defaultValue, options);
            } catch (error) {
                lastError = error;
                
                // 如果是版本冲突，重试
                if (error.message && error.message.includes('conflict')) {
                    await this._delay(this._config.retryDelay * (attempt + 1));
                    continue;
                }
                
                throw error;
            } finally {
                await this._releaseWriteLock(key, lockToken);
            }
        }

        throw new Error(`Update failed after ${maxRetries} attempts: ${lastError?.message}`);
    }

    /**
     * 批量更新 - 兼容原有API，集成事务
     * @param {Array<{key:string, updater:function, defaultValue:any}>} updates
     * @param {object} options
     */
    async batchUpdate(updates, options = {}) {
        await this.ready();

        if (this._fallbackMode) {
            return this._localStorageBatchUpdate(updates);
        }

        // 使用事务包装批量更新
        const storeNames = [...new Set(updates.map(u => this._getStoreName(u.key)))];
        
        return await this._transactionManager.withTransaction({
            storeNames,
            timeout: options.timeout || this._config.transactionTimeout,
            isolationLevel: options.isolationLevel || 'read_committed'
        }, async (tx) => {
            const results = {};
            
            for (const { key, updater, defaultValue } of updates) {
                const storeName = this._getStoreName(key);
                const current = await this._getFromStore(storeName, key, defaultValue);
                
                let cloned;
                try {
                    cloned = JSON.parse(JSON.stringify(current));
                } catch (e) {
                    cloned = current;
                }
                
                const updated = updater(cloned);
                
                // 添加版本号
                if (this._config.enableVersionControl) {
                    updated._v = (current?._v || 0) + 1;
                    updated._updatedAt = Date.now();
                }
                
                await tx.execute({
                    type: 'put',
                    storeName,
                    key: this._getRecordKey(key, storeName),
                    data: updated
                });
                
                results[key] = updated;
            }
            
            return results;
        });
    }

    // ==================== R28: 业务方法（集成并发控制）====================

    /**
     * 设置答题记录（支持批量，带版本控制）
     */
    async setAnswerRecord(questionKey, isCorrect, userAnswer, options = {}) {
        await this.ready();

        const record = {
            questionKey,
            isCorrect,
            userAnswer,
            timestamp: Date.now(),
            subjectId: this._extractSubjectId(questionKey)
        };

        if (this._config.enableVersionControl) {
            record._v = 1;
            record._updatedAt = Date.now();
        }

        return await this._transactionManager.withTransaction({
            storeNames: ['answers'],
            timeout: 10000
        }, async (tx) => {
            // 检查现有记录
            const existing = await tx.execute({
                type: 'get',
                storeName: 'answers',
                key: questionKey
            });

            if (existing) {
                // 版本冲突检测
                if (this._config.enableVersionControl && options.checkVersion) {
                    const conflict = this._versionController.detectConflict(
                        { ...existing, _v: existing._v || 0 },
                        { ...record, _v: (existing._v || 0) + 1 }
                    );

                    if (conflict.type !== 'none') {
                        const merged = await this._versionController.merge(conflict);
                        Object.assign(record, merged);
                    }
                }
                
                record._v = (existing._v || 0) + 1;
            }

            await tx.execute({
                type: 'put',
                storeName: 'answers',
                key: questionKey,
                data: record
            });

            // 广播变更
            this._syncCoordinator.broadcastChange('answers', questionKey, record, 'update');
            
            return record;
        });
    }

    /**
     * 批量设置答题记录（带事务）
     */
    async batchSetAnswerRecords(records, options = {}) {
        await this.ready();

        const items = Object.entries(records).map(([questionKey, data]) => ({
            questionKey,
            ...data,
            subjectId: this._extractSubjectId(questionKey),
            _v: (data._v || 0) + 1,
            _updatedAt: Date.now()
        }));

        // 分批处理大数据量
        if (items.length > 100 && options.useBatches !== false) {
            return this._batchProcess(items, 100, async (batch) => {
                return await this._transactionManager.withTransaction({
                    storeNames: ['answers'],
                    timeout: 30000
                }, async (tx) => {
                    for (const item of batch) {
                        await tx.execute({
                            type: 'put',
                            storeName: 'answers',
                            key: item.questionKey,
                            data: item
                        });
                    }
                    return batch.length;
                });
            });
        }

        return await this._transactionManager.withTransaction({
            storeNames: ['answers'],
            timeout: options.timeout || 30000
        }, async (tx) => {
            for (const item of items) {
                await tx.execute({
                    type: 'put',
                    storeName: 'answers',
                    key: item.questionKey,
                    data: item
                });
            }
            return items.length;
        });
    }

    /**
     * 切换收藏状态（带分布式锁）
     */
    async toggleFavorite(questionKey, subjectId, options = {}) {
        await this.ready();

        const lockName = `favorite:${questionKey}`;
        const lockToken = await this._lockManager.acquire(lockName, {
            timeout: 10000,
            waitTimeout: 5000
        });

        try {
            return await this._transactionManager.withTransaction({
                storeNames: ['favorites'],
                timeout: 10000
            }, async (tx) => {
                const existing = await tx.execute({
                    type: 'get',
                    storeName: 'favorites',
                    key: questionKey
                });

                if (existing) {
                    await tx.execute({
                        type: 'delete',
                        storeName: 'favorites',
                        key: questionKey
                    });
                    
                    this._syncCoordinator.broadcastChange('favorites', questionKey, null, 'delete');
                    return { isFavorite: false, action: 'removed' };
                } else {
                    const record = {
                        key: questionKey,
                        subjectId,
                        addedAt: Date.now(),
                        _v: 1
                    };
                    
                    await tx.execute({
                        type: 'add',
                        storeName: 'favorites',
                        data: record
                    });
                    
                    this._syncCoordinator.broadcastChange('favorites', questionKey, record, 'add');
                    return { isFavorite: true, action: 'added', record };
                }
            });
        } finally {
            await this._lockManager.release(lockToken);
        }
    }

    /**
     * 保存笔记（带乐观锁）
     */
    async saveNote(questionKey, content, tags, options = {}) {
        await this.ready();

        const noteObj = {
            key: questionKey,
            content,
            tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
            updatedAt: Date.now()
        };

        return await this._transactionManager.withTransaction({
            storeNames: ['notes'],
            timeout: 10000
        }, async (tx) => {
            const existing = await tx.execute({
                type: 'get',
                storeName: 'notes',
                key: questionKey
            });

            if (existing) {
                // 乐观锁检查
                if (options.expectedVersion !== undefined) {
                    if ((existing._v || 0) !== options.expectedVersion) {
                        throw new Error(`Version conflict: expected ${options.expectedVersion}, got ${existing._v || 0}`);
                    }
                }
                
                noteObj._v = (existing._v || 0) + 1;
                noteObj.createdAt = existing.createdAt || Date.now();
            } else {
                noteObj._v = 1;
                noteObj.createdAt = Date.now();
            }

            await tx.execute({
                type: 'put',
                storeName: 'notes',
                key: questionKey,
                data: noteObj
            });

            this._syncCoordinator.broadcastChange('notes', questionKey, noteObj, existing ? 'update' : 'add');
            
            return noteObj;
        });
    }

    /**
     * 更新统计信息（带事务和版本控制）
     */
    async updateStats(isCorrect, subjectId, options = {}) {
        await this.ready();

        const lockToken = await this._lockManager.acquire('stats:update', {
            timeout: 15000,
            waitTimeout: 10000
        });

        try {
            return await this._transactionManager.withTransaction({
                storeNames: ['stats'],
                timeout: 15000
            }, async (tx) => {
                const current = await tx.execute({
                    type: 'get',
                    storeName: 'stats',
                    key: 'main'
                });

                const stats = current || {
                    totalAnswered: 0,
                    totalCorrect: 0,
                    dailyStreak: 0,
                    lastStudyDate: null,
                    subjectStats: {},
                    dailyHistory: []
                };

                // 更新统计
                stats.totalAnswered++;
                if (isCorrect) stats.totalCorrect++;

                if (subjectId) {
                    if (!stats.subjectStats[subjectId]) {
                        stats.subjectStats[subjectId] = { answered: 0, correct: 0 };
                    }
                    stats.subjectStats[subjectId].answered++;
                    if (isCorrect) stats.subjectStats[subjectId].correct++;
                }

                // 更新连续学习
                const today = new Date().toDateString();
                const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString();

                if (stats.lastStudyDate !== today) {
                    stats.dailyStreak = stats.lastStudyDate === yesterday ? stats.dailyStreak + 1 : 1;
                    stats.lastStudyDate = today;
                }

                // 更新历史
                if (!stats.dailyHistory) stats.dailyHistory = [];
                const todayEntry = stats.dailyHistory.find(h => h.date === today);
                if (todayEntry) {
                    todayEntry.count++;
                    if (isCorrect) todayEntry.correct++;
                } else {
                    stats.dailyHistory.push({ date: today, count: 1, correct: isCorrect ? 1 : 0 });
                }

                if (stats.dailyHistory.length > 30) {
                    stats.dailyHistory = stats.dailyHistory.slice(-30);
                }

                // 版本号
                stats._v = (stats._v || 0) + 1;
                stats._updatedAt = Date.now();
                stats.id = 'main';

                await tx.execute({
                    type: 'put',
                    storeName: 'stats',
                    key: 'main',
                    data: stats
                });

                this._syncCoordinator.broadcastChange('stats', 'main', stats, 'update');

                return stats;
            });
        } finally {
            await this._lockManager.release(lockToken);
        }
    }

    // ==================== 原有业务方法（保持兼容）====================

    async getAnswerRecord(questionKey) {
        await this.ready();
        
        if (this._fallbackMode) {
            const answers = this._localStorageGet('answers', {});
            return answers[questionKey] || null;
        }

        try {
            const result = await db.get('answers', questionKey);
            if (result) {
                return {
                    isCorrect: result.isCorrect,
                    userAnswer: result.userAnswer,
                    timestamp: result.timestamp
                };
            }
            return null;
        } catch (error) {
            const answers = this._localStorageGet('answers', {});
            return answers[questionKey] || null;
        }
    }

    async getWrongQuestions() {
        await this.ready();

        if (this._fallbackMode) {
            return this._localStorageGet('wrong_questions', []);
        }

        try {
            return await db.getAll('wrong_questions');
        } catch (error) {
            return this._localStorageGet('wrong_questions', []);
        }
    }

    async addWrongQuestion(questionKey, subjectId) {
        await this.ready();

        return await this._transactionManager.withTransaction({
            storeNames: ['wrong_questions'],
            timeout: 10000
        }, async (tx) => {
            const existing = await tx.execute({
                type: 'get',
                storeName: 'wrong_questions',
                key: questionKey
            });

            if (!existing) {
                const record = { 
                    key: questionKey, 
                    subjectId, 
                    addedAt: Date.now(),
                    _v: 1 
                };
                
                await tx.execute({
                    type: 'add',
                    storeName: 'wrong_questions',
                    data: record
                });
                
                return { added: true, record };
            }
            
            return { added: false, record: existing };
        });
    }

    async removeWrongQuestion(questionKey) {
        await this.ready();

        return await this._transactionManager.withTransaction({
            storeNames: ['wrong_questions'],
            timeout: 10000
        }, async (tx) => {
            await tx.execute({
                type: 'delete',
                storeName: 'wrong_questions',
                key: questionKey
            });
            return true;
        });
    }

    async getFavorites() {
        await this.ready();

        if (this._fallbackMode) {
            return this._localStorageGet('favorites', []);
        }

        try {
            return await db.getAll('favorites');
        } catch (error) {
            return this._localStorageGet('favorites', []);
        }
    }

    async isFavorite(questionKey) {
        await this.ready();

        if (this._fallbackMode) {
            const favs = this._localStorageGet('favorites', []);
            return favs.some(f => f.key === questionKey);
        }

        try {
            const result = await db.get('favorites', questionKey);
            return !!result;
        } catch (error) {
            const favs = this._localStorageGet('favorites', []);
            return favs.some(f => f.key === questionKey);
        }
    }

    async getNotes() {
        await this.ready();

        if (this._fallbackMode) {
            return this._localStorageGet('notes', []);
        }

        try {
            return await db.getAll('notes');
        } catch (error) {
            return this._localStorageGet('notes', []);
        }
    }

    async deleteNote(questionKey) {
        await this.ready();

        return await this._transactionManager.withTransaction({
            storeNames: ['notes'],
            timeout: 10000
        }, async (tx) => {
            await tx.execute({
                type: 'delete',
                storeName: 'notes',
                key: questionKey
            });
            return true;
        });
    }

    async getStats() {
        await this.ready();

        const defaultStats = {
            totalAnswered: 0,
            totalCorrect: 0,
            dailyStreak: 0,
            lastStudyDate: null,
            subjectStats: {},
            dailyHistory: []
        };

        if (this._fallbackMode) {
            return this._localStorageGet('stats', defaultStats);
        }

        try {
            const result = await db.get('stats', 'main');
            return result || defaultStats;
        } catch (error) {
            return this._localStorageGet('stats', defaultStats);
        }
    }

    async getDailyStatus() {
        await this.ready();

        const today = new Date().toDateString();

        if (this._fallbackMode) {
            const status = this._localStorageGet('daily_status', {});
            return status.date === today;
        }

        try {
            const result = await db.get('settings', 'daily_status');
            return result && result.value && result.value.date === today;
        } catch (error) {
            const status = this._localStorageGet('daily_status', {});
            return status.date === today;
        }
    }

    async setDailyCompleted() {
        await this.ready();

        const data = { 
            date: new Date().toDateString(), 
            completed: true,
            completedAt: Date.now()
        };

        return await this._transactionManager.withTransaction({
            storeNames: ['settings'],
            timeout: 10000
        }, async (tx) => {
            await tx.execute({
                type: 'put',
                storeName: 'settings',
                key: 'daily_status',
                data: { key: 'daily_status', value: data, _t: Date.now() }
            });
            return true;
        });
    }

    async getRanking() {
        await this.ready();

        if (this._fallbackMode) {
            return this._localStorageGet('ranking', null);
        }

        try {
            const result = await db.get('settings', 'ranking');
            return result ? result.value : null;
        } catch (error) {
            return this._localStorageGet('ranking', null);
        }
    }

    async saveRanking(rankings) {
        await this.ready();

        return await this._transactionManager.withTransaction({
            storeNames: ['settings'],
            timeout: 10000
        }, async (tx) => {
            await tx.execute({
                type: 'put',
                storeName: 'settings',
                key: 'ranking',
                data: { key: 'ranking', value: rankings, _t: Date.now() }
            });
            return true;
        });
    }

    // ==================== R28: 监听和同步 ====================

    /**
     * 注册存储变化监听器 - 兼容原有API
     */
    onChange(key, callback) {
        const listener = { key, callback };
        this._storageListeners.push(listener);
        
        // 如果在IndexedDB模式下，也注册到db的监听器
        if (!this._fallbackMode) {
            const storeName = this._getStoreName(key);
            const unsubscribe = db.onChange(storeName, (event) => {
                callback(key, event.data);
            });
            listener.unsubscribe = unsubscribe;
        }

        return () => {
            const idx = this._storageListeners.indexOf(listener);
            if (idx >= 0) {
                if (listener.unsubscribe) {
                    listener.unsubscribe();
                }
                this._storageListeners.splice(idx, 1);
            }
        };
    }

    /**
     * 处理远程同步事件
     */
    _handleRemoteSync(event) {
        if (event.type === 'remote-change') {
            // 通知本地监听器
            this._notifyListeners(event.storeName, event.data);
        }
    }

    /**
     * 通知监听器
     */
    _notifyListeners(key, value) {
        this._storageListeners.forEach(listener => {
            if (listener.key === key || listener.key === '*') {
                try {
                    const data = typeof value === 'string' ? JSON.parse(value) : value;
                    listener.callback(key, data);
                } catch (e) { /* ignore */ }
            }
        });
    }

    // ==================== R28: 私有辅助方法 ====================

    async _getWithTransaction(key, defaultValue, options) {
        const storeName = this._getStoreName(key);

        return await this._transactionManager.withTransaction({
            storeNames: [storeName],
            readOnly: true,
            timeout: options.timeout || 10000
        }, async (tx) => {
            if (storeName === 'settings') {
                const result = await tx.execute({
                    type: 'get',
                    storeName,
                    key
                });
                return result ? result.value : defaultValue;
            }

            if (['wrong_questions', 'favorites', 'notes'].includes(storeName)) {
                return await tx.execute({
                    type: 'getAll',
                    storeName
                });
            }

            if (storeName === 'answers') {
                const items = await tx.execute({
                    type: 'getAll',
                    storeName
                });
                const result = {};
                items.forEach(item => {
                    result[item.questionKey] = {
                        isCorrect: item.isCorrect,
                        userAnswer: item.userAnswer,
                        timestamp: item.timestamp
                    };
                });
                return Object.keys(result).length > 0 ? result : defaultValue;
            }

            if (storeName === 'stats') {
                const result = await tx.execute({
                    type: 'get',
                    storeName,
                    key: 'main'
                });
                return result || defaultValue;
            }

            if (storeName === 'exam_state') {
                const result = await tx.execute({
                    type: 'get',
                    storeName,
                    key: 'current'
                });
                return result || defaultValue;
            }

            return defaultValue;
        });
    }

    async _setWithTransaction(key, value, options) {
        const storeName = this._getStoreName(key);

        return await this._transactionManager.withTransaction({
            storeNames: [storeName],
            timeout: options.timeout || this._config.transactionTimeout
        }, async (tx) => {
            if (storeName === 'settings') {
                const data = { key, value, _t: Date.now() };
                if (this._config.enableVersionControl) {
                    data._v = (value?._v || 0) + 1;
                }
                
                await tx.execute({
                    type: 'put',
                    storeName,
                    key,
                    data
                });
                
                this._notifyListeners(key, value);
                return true;
            }

            if (storeName === 'stats') {
                const data = { ...value, id: 'main', _t: Date.now() };
                if (this._config.enableVersionControl) {
                    data._v = (value?._v || 0) + 1;
                }
                
                await tx.execute({
                    type: 'put',
                    storeName,
                    key: 'main',
                    data
                });
                
                this._notifyListeners(key, value);
                return true;
            }

            if (storeName === 'exam_state') {
                const data = { ...value, id: 'current', timestamp: Date.now() };
                if (this._config.enableVersionControl) {
                    data._v = (value?._v || 0) + 1;
                }
                
                await tx.execute({
                    type: 'put',
                    storeName,
                    key: 'current',
                    data
                });
                
                this._notifyListeners(key, value);
                return true;
            }

            if (['wrong_questions', 'favorites', 'notes'].includes(storeName)) {
                if (Array.isArray(value)) {
                    await tx.execute({ type: 'clear', storeName });
                    
                    if (value.length > 0) {
                        const versioned = value.map(item => ({
                            ...item,
                            _v: (item._v || 0) + 1,
                            _updatedAt: Date.now()
                        }));
                        
                        await tx.execute({
                            type: 'batchPut',
                            storeName,
                            data: versioned
                        });
                    }
                    
                    this._notifyListeners(key, value);
                    return true;
                }
            }

            if (storeName === 'answers' && typeof value === 'object') {
                await tx.execute({ type: 'clear', storeName });
                
                const items = Object.entries(value).map(([questionKey, data]) => ({
                    questionKey,
                    ...data,
                    subjectId: this._extractSubjectId(questionKey),
                    _v: (data._v || 0) + 1,
                    _updatedAt: Date.now()
                }));
                
                if (items.length > 0) {
                    await tx.execute({
                        type: 'batchPut',
                        storeName,
                        data: items
                    });
                }
                
                this._notifyListeners(key, value);
                return true;
            }

            return false;
        });
    }

    async _updateWithOptimisticLock(key, updater, defaultValue, options) {
        const storeName = this._getStoreName(key);

        return await this._transactionManager.withTransaction({
            storeNames: [storeName],
            timeout: options.timeout || this._config.transactionTimeout
        }, async (tx) => {
            const current = await this._getFromStore(storeName, key, defaultValue);
            
            let cloned;
            try {
                cloned = JSON.parse(JSON.stringify(current));
            } catch (cloneErr) {
                cloned = current;
            }

            const updated = updater(cloned);
            
            // 添加版本号
            if (this._config.enableVersionControl) {
                updated._v = (current?._v || 0) + 1;
                updated._updatedAt = Date.now();
            }

            const recordKey = this._getRecordKey(key, storeName);
            
            await tx.execute({
                type: 'put',
                storeName,
                key: recordKey,
                data: updated
            });

            this._notifyListeners(key, updated);
            return updated;
        });
    }

    async _getFromStore(storeName, key, defaultValue) {
        if (storeName === 'settings') {
            const result = await db.get(storeName, key);
            return result ? result.value : defaultValue;
        }
        if (storeName === 'stats') {
            return await db.get(storeName, 'main') || defaultValue;
        }
        if (storeName === 'exam_state') {
            return await db.get(storeName, 'current') || defaultValue;
        }
        return await db.get(storeName, key) || defaultValue;
    }

    _getRecordKey(key, storeName) {
        if (storeName === 'stats') return 'main';
        if (storeName === 'exam_state') return 'current';
        return key;
    }

    async _acquireReadLock(key) {
        if (!this._config.enableDistributedLock) return null;
        
        const lockName = `storage:${key}`;
        if (!this._rwLocks.has(lockName)) {
            this._rwLocks.set(lockName, new ReadWriteLock(this._lockManager, lockName));
        }
        
        const rwLock = this._rwLocks.get(lockName);
        return await rwLock.acquireRead({ timeout: this._config.lockTimeout });
    }

    async _releaseReadLock(key, token) {
        if (!token) return;
        
        const lockName = `storage:${key}`;
        const rwLock = this._rwLocks.get(lockName);
        if (rwLock) {
            await rwLock.releaseRead(token);
        }
    }

    async _acquireWriteLock(key) {
        if (!this._config.enableDistributedLock) return null;
        
        const lockName = `storage:${key}`;
        if (!this._rwLocks.has(lockName)) {
            this._rwLocks.set(lockName, new ReadWriteLock(this._lockManager, lockName));
        }
        
        const rwLock = this._rwLocks.get(lockName);
        return await rwLock.acquireWrite({ 
            timeout: this._config.lockTimeout,
            waitTimeout: this._config.lockTimeout 
        });
    }

    async _releaseWriteLock(key, token) {
        if (!token) return;
        
        const lockName = `storage:${key}`;
        const rwLock = this._rwLocks.get(lockName);
        if (rwLock) {
            await rwLock.releaseWrite(token);
        }
    }

    _debouncedSet(key, value, options) {
        return new Promise((resolve, reject) => {
            // 清除现有的防抖定时器
            if (this._debounceMap.has(key)) {
                clearTimeout(this._debounceMap.get(key).timer);
            }

            const debounceTime = options.debounceTime || this._config.debounceTime;
            
            const timer = setTimeout(async () => {
                try {
                    this._debounceMap.delete(key);
                    const result = await this.set(key, value, { ...options, debounce: false });
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            }, debounceTime);

            this._debounceMap.set(key, { timer, resolve, reject });
        });
    }

    async _batchProcess(items, batchSize, processor) {
        const batches = [];
        for (let i = 0; i < items.length; i += batchSize) {
            batches.push(items.slice(i, i + batchSize));
        }

        const results = [];
        for (const batch of batches) {
            const result = await processor(batch);
            results.push(result);
        }

        return {
            totalProcessed: items.length,
            batches: batches.length,
            results
        };
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ==================== localStorage降级模式 ====================

    _initLocalStorageListener() {
        window.addEventListener('storage', (e) => {
            if (e.key && e.key.startsWith('cpa_')) {
                this._notifyListeners(e.key.replace('cpa_', ''), e.newValue);
            }
        });
    }

    _localStorageGet(key, defaultValue = null, options = {}) {
        try {
            const data = localStorage.getItem(`cpa_${key}`);
            if (!data) {
                return defaultValue;
            }
            const parsed = JSON.parse(data);
            const raw = parsed.data !== undefined ? parsed.data : parsed;
            const { skipClone = false } = options;
            if (skipClone) return raw;
            try {
                return JSON.parse(JSON.stringify(raw));
            } catch (cloneErr) {
                return raw;
            }
        } catch (e) {
            try {
                localStorage.removeItem(`cpa_${key}`);
            } catch (cleanupErr) { /* ignore */ }
            return defaultValue;
        }
    }

    _localStorageSet(key, value) {
        const _doSet = () => {
            const wrappedValue = {
                _v: ++this._version,
                _t: Date.now(),
                data: value
            };
            localStorage.setItem(`cpa_${key}`, JSON.stringify(wrappedValue));
            this._notifyListeners(key, wrappedValue);
            return true;
        };

        try {
            return _doSet();
        } catch (e) {
            if (e.name === 'QuotaExceededError' || e.code === 22) {
                this._cleanupOldData();
                try {
                    return _doSet();
                } catch (e2) {
                    console.error('StorageAdapter: localStorage quota exceeded');
                }
            }
            return false;
        }
    }

    _localStorageUpdate(key, updater, defaultValue = null) {
        const current = this._localStorageGet(key, defaultValue, { skipClone: true });
        
        let cloned;
        try {
            cloned = JSON.parse(JSON.stringify(current));
        } catch (cloneErr) {
            cloned = current;
        }

        try {
            const updated = updater(cloned);
            return this._localStorageSet(key, updated);
        } catch (e) {
            console.error('StorageAdapter.update updater error:', e);
            return defaultValue;
        }
    }

    _localStorageBatchUpdate(updates) {
        const results = {};
        try {
            for (const { key, updater, defaultValue } of updates) {
                const current = this._localStorageGet(key, defaultValue, { skipClone: true });
                let cloned;
                try {
                    cloned = JSON.parse(JSON.stringify(current));
                } catch (e) {
                    cloned = current;
                }
                results[key] = updater(cloned);
            }
            
            for (const [key, value] of Object.entries(results)) {
                this._localStorageSet(key, value);
            }
        } catch (e) {
            console.error('StorageAdapter.batchUpdate error:', e);
        }
        return results;
    }

    _cleanupOldData() {
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        
        const keysToClean = ['answers', 'wrong_questions', 'favorites', 'notes'];
        keysToClean.forEach(key => {
            try {
                const data = this._localStorageGet(key, null);
                if (!data) return;

                if (Array.isArray(data) && data.length > 500) {
                    const sorted = [...data].sort((a, b) => {
                        const ta = a.addedAt || a.updatedAt || 0;
                        const tb = b.addedAt || b.updatedAt || 0;
                        return tb - ta;
                    });
                    this._localStorageSet(key, sorted.slice(0, 500));
                } else if (typeof data === 'object' && key === 'answers') {
                    const cleaned = {};
                    for (const [k, v] of Object.entries(data)) {
                        if (v && typeof v.timestamp === 'number' && v.timestamp > thirtyDaysAgo) {
                            cleaned[k] = v;
                        }
                    }
                    this._localStorageSet(key, cleaned);
                }
            } catch (e) {
                // ignore
            }
        });
    }

    // ==================== 工具方法 ====================

    _getStoreName(key) {
        const mapping = {
            'answers': 'answers',
            'wrong_questions': 'wrong_questions',
            'favorites': 'favorites',
            'notes': 'notes',
            'stats': 'stats',
            'exam_state': 'exam_state',
            'daily_status': 'settings',
            'ranking': 'settings'
        };
        return mapping[key] || 'settings';
    }

    _extractSubjectId(questionKey) {
        if (!questionKey) return null;
        const parts = String(questionKey).split('_');
        return parts[0] || null;
    }

    // ==================== R28: 统计和诊断 ====================

    /**
     * 获取并发控制统计信息
     */
    getConcurrencyStats() {
        return {
            locks: this._lockManager.getHeldLocks(),
            transactions: this._transactionManager.getStatistics(),
            config: this._config
        };
    }

    /**
     * 强制释放所有锁（用于恢复）
     */
    async forceReleaseAllLocks() {
        const heldLocks = this._lockManager.getHeldLocks();
        for (const lock of heldLocks) {
            await this._lockManager.forceRelease(lock.name, lock.instanceId);
        }
    }
}

// 导出单例实例
const storageAdapter = new StorageAdapter();

export { storageAdapter, StorageAdapter };
export default storageAdapter;
