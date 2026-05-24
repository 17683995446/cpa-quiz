/**
 * Storage兼容层 - 同步API包装器
 * R26重构：为现有代码提供同步风格的Storage API
 * 
 * 此模块将异步的IndexedDB适配器包装为同步API（通过缓存），
 * 使现有代码无需大量修改即可使用新的IndexedDB后端。
 * 
 * @module storage-compat
 */

import { storageAdapter } from './storage-adapter.js';

/**
 * 同步风格的Storage API包装器
 * 使用内存缓存实现同步读取，后台异步同步到IndexedDB
 */
class StorageCompat {
    constructor() {
        this._cache = new Map();
        this._initialized = false;
        this._version = 0;
        this._storageListeners = [];
        this._flushTimer = null;
        this._pendingWrites = new Set();
        
        // 初始化缓存
        this._initCache();
    }

    /**
     * 初始化缓存
     */
    async _initCache() {
        await storageAdapter.ready();
        
        // 预加载常用数据到缓存
        const keys = ['answers', 'wrong_questions', 'favorites', 'notes', 'stats', 'exam_state', 'daily_status', 'ranking'];
        
        for (const key of keys) {
            try {
                const value = await storageAdapter.get(key, this._getDefaultValue(key));
                this._cache.set(key, value);
            } catch (e) {
                console.warn(`Failed to cache ${key}:`, e);
                this._cache.set(key, this._getDefaultValue(key));
            }
        }
        
        this._initialized = true;
        console.log('StorageCompat: Cache initialized');
    }

    /**
     * 获取默认值
     */
    _getDefaultValue(key) {
        const defaults = {
            'answers': {},
            'wrong_questions': [],
            'favorites': [],
            'notes': [],
            'stats': {
                totalAnswered: 0,
                totalCorrect: 0,
                dailyStreak: 0,
                lastStudyDate: null,
                subjectStats: {},
                dailyHistory: []
            },
            'exam_state': null,
            'daily_status': {},
            'ranking': null
        };
        return defaults[key] || null;
    }

    /**
     * 等待初始化完成
     */
    async ready() {
        if (!this._initialized) {
            await this._initPromise;
        }
    }

    /**
     * 同步获取数据（从缓存）
     */
    get(key, defaultValue = null, options = {}) {
        // 如果缓存中有，直接返回
        if (this._cache.has(key)) {
            const value = this._cache.get(key);
            const { skipClone = false } = options;
            if (skipClone) return value;
            try {
                return JSON.parse(JSON.stringify(value));
            } catch (e) {
                return value;
            }
        }
        
        // 缓存未命中，返回默认值
        return defaultValue !== null ? defaultValue : this._getDefaultValue(key);
    }

    /**
     * 同步设置数据（更新缓存，异步写入IndexedDB）
     */
    set(key, value) {
        // 更新缓存
        this._cache.set(key, value);
        this._version++;
        
        // 标记为待写入
        this._pendingWrites.add(key);
        
        // 延迟写入
        this._scheduleFlush();
        
        // 通知监听器
        this._notifyListeners(key, value);
        
        return true;
    }

    /**
     * 原子更新操作
     */
    update(key, updater, defaultValue = null) {
        const current = this.get(key, defaultValue, { skipClone: true });
        
        // 深拷贝防止updater直接修改原始对象
        let cloned;
        try {
            cloned = JSON.parse(JSON.stringify(current));
        } catch (cloneErr) {
            cloned = current;
        }
        
        try {
            const updated = updater(cloned);
            this.set(key, updated);
            return updated;
        } catch (e) {
            console.error('StorageCompat.update updater error:', e);
            try {
                return typeof defaultValue === 'object' && defaultValue !== null 
                    ? JSON.parse(JSON.stringify(defaultValue)) 
                    : defaultValue;
            } catch (cloneErr) {
                return defaultValue;
            }
        }
    }

    /**
     * 批量更新
     */
    batchUpdate(updates) {
        const results = {};
        try {
            updates.forEach(({ key, updater, defaultValue }) => {
                const current = this.get(key, defaultValue, { skipClone: true });
                let cloned;
                try {
                    cloned = JSON.parse(JSON.stringify(current));
                } catch (e) {
                    cloned = current;
                }
                results[key] = updater(cloned);
            });
            
            // 一次性写入所有结果
            Object.entries(results).forEach(([key, value]) => {
                this.set(key, value);
            });
        } catch (e) {
            console.error('StorageCompat.batchUpdate error:', e);
        }
        return results;
    }

    /**
     * 注册存储变化监听器
     */
    onChange(key, callback) {
        const listener = { key, callback };
        this._storageListeners.push(listener);
        
        return () => {
            const idx = this._storageListeners.indexOf(listener);
            if (idx >= 0) this._storageListeners.splice(idx, 1);
        };
    }

    /**
     * 通知监听器
     */
    _notifyListeners(key, value) {
        this._storageListeners.forEach(listener => {
            if (listener.key === key || listener.key === '*') {
                try {
                    listener.callback(key, value);
                } catch (e) { /* ignore */ }
            }
        });
    }

    /**
     * 调度延迟写入
     */
    _scheduleFlush() {
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
        }
        
        this._flushTimer = setTimeout(() => {
            this._flushPendingWrites();
        }, 100);
    }

    /**
     * 刷写待写入的数据
     */
    async _flushPendingWrites() {
        if (this._pendingWrites.size === 0) return;
        
        const keys = Array.from(this._pendingWrites);
        this._pendingWrites.clear();
        
        for (const key of keys) {
            try {
                const value = this._cache.get(key);
                await storageAdapter.set(key, value);
            } catch (e) {
                console.error(`Failed to flush ${key}:`, e);
                // 重新加入待写入队列
                this._pendingWrites.add(key);
            }
        }
    }

    /**
     * 立即刷写所有缓存
     */
    async flush() {
        await this._flushPendingWrites();
    }

    // ==================== 业务方法（同步风格）====================

    /**
     * 获取答题记录
     */
    getAnswerRecord(questionKey) {
        // 优先从缓存读取
        const answers = this.get('answers', {});
        return answers[questionKey] || null;
    }

    /**
     * 设置答题记录（使用缓存队列优化）
     */
    setAnswerRecord(questionKey, isCorrect, userAnswer) {
        this.update('answers', (answers) => {
            answers[questionKey] = { isCorrect, userAnswer, timestamp: Date.now() };
            return answers;
        }, {});
    }

    /**
     * 获取错题列表
     */
    getWrongQuestions() {
        return this.get('wrong_questions', []);
    }

    /**
     * 添加错题
     */
    addWrongQuestion(questionKey, subjectId) {
        this.update('wrong_questions', (wrong) => {
            if (!wrong.find(w => w.key === questionKey)) {
                wrong.push({ key: questionKey, subjectId, addedAt: Date.now() });
            }
            return wrong;
        }, []);
    }

    /**
     * 移除错题
     */
    removeWrongQuestion(questionKey) {
        this.update('wrong_questions', (wrong) => {
            return wrong.filter(w => w.key !== questionKey);
        }, []);
    }

    /**
     * 获取收藏列表
     */
    getFavorites() {
        return this.get('favorites', []);
    }

    /**
     * 切换收藏状态
     */
    toggleFavorite(questionKey, subjectId) {
        let result = false;
        this.update('favorites', (favs) => {
            const idx = favs.findIndex(f => f.key === questionKey);
            if (idx >= 0) {
                favs.splice(idx, 1);
                result = false;
            } else {
                favs.push({ key: questionKey, subjectId, addedAt: Date.now() });
                result = true;
            }
            return favs;
        }, []);
        return result;
    }

    /**
     * 检查是否已收藏
     */
    isFavorite(questionKey) {
        const favs = this.get('favorites', []);
        return favs.some(f => f.key === questionKey);
    }

    /**
     * 获取笔记列表
     */
    getNotes() {
        return this.get('notes', []);
    }

    /**
     * 保存笔记
     */
    saveNote(questionKey, content, tags) {
        this.update('notes', (notes) => {
            const idx = notes.findIndex(n => n.key === questionKey);
            const noteObj = {
                key: questionKey,
                content,
                tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
                updatedAt: Date.now()
            };
            if (idx >= 0) {
                notes[idx] = { ...notes[idx], ...noteObj };
            } else {
                notes.unshift(noteObj);
            }
            return notes;
        }, []);
    }

    /**
     * 删除笔记
     */
    deleteNote(questionKey) {
        this.update('notes', (notes) => {
            return notes.filter(n => n.key !== questionKey);
        }, []);
    }

    /**
     * 获取统计信息
     */
    getStats() {
        return this.get('stats', {
            totalAnswered: 0,
            totalCorrect: 0,
            dailyStreak: 0,
            lastStudyDate: null,
            subjectStats: {},
            dailyHistory: []
        });
    }

    /**
     * 更新统计信息
     */
    updateStats(isCorrect, subjectId) {
        const batchMode = typeof isCorrect === 'number' && typeof subjectId === 'number';
        const correctCount = batchMode ? isCorrect : (isCorrect ? 1 : 0);
        const totalCount = batchMode ? subjectId : 1;
        const singleSubjectId = batchMode ? null : subjectId;

        this.update('stats', (stats) => {
            if (!stats || typeof stats !== 'object') {
                stats = {
                    totalAnswered: 0,
                    totalCorrect: 0,
                    dailyStreak: 0,
                    lastStudyDate: null,
                    subjectStats: {},
                    dailyHistory: []
                };
            }

            stats.totalAnswered += totalCount;
            stats.totalCorrect += correctCount;

            if (singleSubjectId) {
                if (!stats.subjectStats[singleSubjectId]) {
                    stats.subjectStats[singleSubjectId] = { answered: 0, correct: 0 };
                }
                stats.subjectStats[singleSubjectId].answered++;
                if (!batchMode && isCorrect) stats.subjectStats[singleSubjectId].correct++;
            }

            const today = new Date().toDateString();
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString();

            if (stats.lastStudyDate !== today) {
                if (stats.lastStudyDate === yesterday) {
                    stats.dailyStreak++;
                } else {
                    stats.dailyStreak = 1;
                }
                stats.lastStudyDate = today;
            }

            if (!stats.dailyHistory) stats.dailyHistory = [];
            const todayEntry = stats.dailyHistory.find(h => h.date === today);
            if (todayEntry) {
                todayEntry.count += totalCount;
                todayEntry.correct += correctCount;
            } else {
                stats.dailyHistory.push({ date: today, count: totalCount, correct: correctCount });
            }
            if (stats.dailyHistory.length > 30) {
                stats.dailyHistory = stats.dailyHistory.slice(-30);
            }

            return stats;
        }, {});
    }

    /**
     * 获取每日一练状态
     */
    getDailyStatus() {
        const today = new Date().toDateString();
        const status = this.get('daily_status', {});
        return status.date === today;
    }

    /**
     * 设置每日一练完成
     */
    setDailyCompleted() {
        this.set('daily_status', { 
            date: new Date().toDateString(), 
            completed: true,
            completedAt: Date.now()
        });
    }

    /**
     * 获取排行榜
     */
    getRanking() {
        return this.get('ranking', null);
    }

    /**
     * 保存排行榜
     */
    saveRanking(rankings) {
        this.set('ranking', rankings);
    }
}

// 创建单例实例
const storageCompat = new StorageCompat();

export { storageCompat, StorageCompat };
export default storageCompat;
