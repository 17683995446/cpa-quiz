/**
 * 数据迁移模块 - R26重构
 * 负责将localStorage数据自动迁移到IndexedDB
 * @module migration
 */

import { db } from './db.js';

/**
 * 迁移管理器类
 */
class MigrationManager {
    constructor() {
        this.MIGRATION_KEY = 'cpa_db_migration_completed';
        this.MIGRATION_VERSION = '1.0';
        this._progressCallback = null;
        this._isMigrating = false;
    }

    /**
     * 检查是否需要迁移
     * @returns {boolean}
     */
    needsMigration() {
        // 检查localStorage是否有CPA数据
        const hasLocalData = this._hasLocalStorageData();
        
        // 检查是否已完成迁移
        const migrationCompleted = this._isMigrationCompleted();
        
        return hasLocalData && !migrationCompleted;
    }

    /**
     * 检查localStorage是否有CPA数据
     * @private
     */
    _hasLocalStorageData() {
        const keys = ['cpa_answers', 'cpa_wrong_questions', 'cpa_favorites', 
                      'cpa_notes', 'cpa_stats', 'cpa_exam_state'];
        for (const key of keys) {
            if (localStorage.getItem(key)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 检查迁移是否已完成
     * @private
     */
    _isMigrationCompleted() {
        const completed = localStorage.getItem(this.MIGRATION_KEY);
        if (completed) {
            try {
                const info = JSON.parse(completed);
                return info.version === this.MIGRATION_VERSION && info.completed === true;
            } catch (e) {
                return false;
            }
        }
        return false;
    }

    /**
     * 设置迁移完成标记
     * @private
     */
    _setMigrationCompleted() {
        localStorage.setItem(this.MIGRATION_KEY, JSON.stringify({
            version: this.MIGRATION_VERSION,
            completed: true,
            timestamp: Date.now()
        }));
    }

    /**
     * 注册进度回调
     * @param {function} callback - 回调函数(progress, message)
     */
    onProgress(callback) {
        this._progressCallback = callback;
    }

    /**
     * 报告进度
     * @private
     */
    _reportProgress(progress, message) {
        if (this._progressCallback) {
            this._progressCallback(progress, message);
        }
        console.log(`Migration: ${Math.round(progress * 100)}% - ${message}`);
    }

    /**
     * 执行数据迁移
     * @returns {Promise<{success: boolean, stats: object, error?: string}>}
     */
    async migrate() {
        if (this._isMigrating) {
            return { success: false, error: 'Migration already in progress', stats: {} };
        }

        this._isMigrating = true;
        const stats = {
            answers: 0,
            wrongQuestions: 0,
            favorites: 0,
            notes: 0,
            stats: 0,
            examState: 0,
            settings: 0,
            errors: []
        };

        try {
            this._reportProgress(0, '开始数据迁移...');

            // 确保IndexedDB已初始化
            await db.init();
            this._reportProgress(0.1, 'IndexedDB已就绪');

            // 迁移答题记录
            await this._migrateAnswers(stats);
            this._reportProgress(0.3, `答题记录迁移完成 (${stats.answers}条)`);

            // 迁移错题本
            await this._migrateWrongQuestions(stats);
            this._reportProgress(0.5, `错题本迁移完成 (${stats.wrongQuestions}条)`);

            // 迁移收藏
            await this._migrateFavorites(stats);
            this._reportProgress(0.6, `收藏夹迁移完成 (${stats.favorites}条)`);

            // 迁移笔记
            await this._migrateNotes(stats);
            this._reportProgress(0.7, `笔记迁移完成 (${stats.notes}条)`);

            // 迁移统计
            await this._migrateStats(stats);
            this._reportProgress(0.8, `统计数据迁移完成`);

            // 迁移考试状态
            await this._migrateExamState(stats);
            this._reportProgress(0.9, `考试状态迁移完成`);

            // 迁移其他设置
            await this._migrateSettings(stats);
            this._reportProgress(0.95, `设置项迁移完成`);

            // 标记迁移完成
            this._setMigrationCompleted();
            this._reportProgress(1, '数据迁移全部完成');

            return { success: true, stats };

        } catch (error) {
            console.error('Migration failed:', error);
            stats.errors.push(error.message);
            return { success: false, error: error.message, stats };
        } finally {
            this._isMigrating = false;
        }
    }

    /**
     * 迁移答题记录
     * @private
     */
    async _migrateAnswers(stats) {
        try {
            const data = localStorage.getItem('cpa_answers');
            if (!data) return;

            const answers = JSON.parse(data);
            const raw = answers.data !== undefined ? answers.data : answers;

            if (typeof raw === 'object' && raw !== null) {
                const items = Object.entries(raw).map(([questionKey, record]) => ({
                    questionKey,
                    isCorrect: record.isCorrect,
                    userAnswer: record.userAnswer,
                    timestamp: record.timestamp || Date.now(),
                    subjectId: this._extractSubjectId(questionKey)
                }));

                if (items.length > 0) {
                    await db.batchPut('answers', items);
                    stats.answers = items.length;
                }
            }
        } catch (error) {
            console.error('Failed to migrate answers:', error);
            stats.errors.push(`answers: ${error.message}`);
        }
    }

    /**
     * 迁移错题本
     * @private
     */
    async _migrateWrongQuestions(stats) {
        try {
            const data = localStorage.getItem('cpa_wrong_questions');
            if (!data) return;

            const wrong = JSON.parse(data);
            const raw = wrong.data !== undefined ? wrong.data : wrong;

            if (Array.isArray(raw) && raw.length > 0) {
                const items = raw.map(item => ({
                    key: item.key,
                    subjectId: item.subjectId,
                    addedAt: item.addedAt || Date.now()
                }));

                await db.batchPut('wrong_questions', items);
                stats.wrongQuestions = items.length;
            }
        } catch (error) {
            console.error('Failed to migrate wrong questions:', error);
            stats.errors.push(`wrong_questions: ${error.message}`);
        }
    }

    /**
     * 迁移收藏
     * @private
     */
    async _migrateFavorites(stats) {
        try {
            const data = localStorage.getItem('cpa_favorites');
            if (!data) return;

            const favorites = JSON.parse(data);
            const raw = favorites.data !== undefined ? favorites.data : favorites;

            if (Array.isArray(raw) && raw.length > 0) {
                const items = raw.map(item => ({
                    key: item.key,
                    subjectId: item.subjectId,
                    addedAt: item.addedAt || Date.now()
                }));

                await db.batchPut('favorites', items);
                stats.favorites = items.length;
            }
        } catch (error) {
            console.error('Failed to migrate favorites:', error);
            stats.errors.push(`favorites: ${error.message}`);
        }
    }

    /**
     * 迁移笔记
     * @private
     */
    async _migrateNotes(stats) {
        try {
            const data = localStorage.getItem('cpa_notes');
            if (!data) return;

            const notes = JSON.parse(data);
            const raw = notes.data !== undefined ? notes.data : notes;

            if (Array.isArray(raw) && raw.length > 0) {
                const items = raw.map(item => ({
                    key: item.key,
                    content: item.content || '',
                    tags: Array.isArray(item.tags) ? item.tags : [],
                    updatedAt: item.updatedAt || Date.now()
                }));

                await db.batchPut('notes', items);
                stats.notes = items.length;
            }
        } catch (error) {
            console.error('Failed to migrate notes:', error);
            stats.errors.push(`notes: ${error.message}`);
        }
    }

    /**
     * 迁移统计数据
     * @private
     */
    async _migrateStats(stats) {
        try {
            const data = localStorage.getItem('cpa_stats');
            if (!data) return;

            const statsData = JSON.parse(data);
            const raw = statsData.data !== undefined ? statsData.data : statsData;

            if (raw && typeof raw === 'object') {
                const item = {
                    id: 'main',
                    totalAnswered: raw.totalAnswered || 0,
                    totalCorrect: raw.totalCorrect || 0,
                    dailyStreak: raw.dailyStreak || 0,
                    lastStudyDate: raw.lastStudyDate,
                    subjectStats: raw.subjectStats || {},
                    dailyHistory: Array.isArray(raw.dailyHistory) ? raw.dailyHistory : [],
                    _t: Date.now()
                };

                await db.put('stats', item);
                stats.stats = 1;
            }
        } catch (error) {
            console.error('Failed to migrate stats:', error);
            stats.errors.push(`stats: ${error.message}`);
        }
    }

    /**
     * 迁移考试状态
     * @private
     */
    async _migrateExamState(stats) {
        try {
            const data = localStorage.getItem('cpa_exam_state');
            if (!data) return;

            const examState = JSON.parse(data);
            const raw = examState.data !== undefined ? examState.data : examState;

            if (raw && typeof raw === 'object') {
                const item = {
                    id: 'current',
                    ...raw,
                    timestamp: Date.now()
                };

                await db.put('exam_state', item);
                stats.examState = 1;
            }
        } catch (error) {
            console.error('Failed to migrate exam state:', error);
            stats.errors.push(`exam_state: ${error.message}`);
        }
    }

    /**
     * 迁移其他设置
     * @private
     */
    async _migrateSettings(stats) {
        const settingsKeys = ['cpa_daily_status', 'cpa_ranking'];
        
        for (const key of settingsKeys) {
            try {
                const data = localStorage.getItem(key);
                if (!data) continue;

                const parsed = JSON.parse(data);
                const raw = parsed.data !== undefined ? parsed.data : parsed;
                const settingKey = key.replace('cpa_', '');

                await db.put('settings', {
                    key: settingKey,
                    value: raw,
                    _t: Date.now()
                });
                stats.settings++;
            } catch (error) {
                console.error(`Failed to migrate ${key}:`, error);
                stats.errors.push(`${key}: ${error.message}`);
            }
        }
    }

    /**
     * 从questionKey提取subjectId
     * @private
     */
    _extractSubjectId(questionKey) {
        if (!questionKey) return null;
        const parts = String(questionKey).split('_');
        return parts[0] || null;
    }

    /**
     * 清理localStorage中的CPA数据（迁移后调用）
     * @param {boolean} keepMigrationFlag - 是否保留迁移标记
     */
    cleanupLocalStorage(keepMigrationFlag = true) {
        const keysToRemove = [
            'cpa_answers',
            'cpa_wrong_questions',
            'cpa_favorites',
            'cpa_notes',
            'cpa_stats',
            'cpa_exam_state',
            'cpa_daily_status',
            'cpa_ranking'
        ];

        for (const key of keysToRemove) {
            try {
                localStorage.removeItem(key);
            } catch (e) {
                console.warn(`Failed to remove ${key}:`, e);
            }
        }

        if (!keepMigrationFlag) {
            localStorage.removeItem(this.MIGRATION_KEY);
        }

        console.log('Migration: localStorage cleaned up');
    }

    /**
     * 获取迁移状态信息
     */
    getMigrationInfo() {
        const completed = this._isMigrationCompleted();
        const hasLocalData = this._hasLocalStorageData();
        
        let info = null;
        if (completed) {
            try {
                info = JSON.parse(localStorage.getItem(this.MIGRATION_KEY));
            } catch (e) {
                // ignore
            }
        }

        return {
            completed,
            hasLocalData,
            needsMigration: hasLocalData && !completed,
            info,
            version: this.MIGRATION_VERSION
        };
    }

    /**
     * 重置迁移状态（用于测试）
     */
    resetMigration() {
        localStorage.removeItem(this.MIGRATION_KEY);
        console.log('Migration: status reset');
    }
}

// 导出单例实例
const migration = new MigrationManager();

export { migration, MigrationManager };
export default migration;
