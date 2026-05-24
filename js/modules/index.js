/**
 * CPA智刷 - IndexedDB模块入口
 * R26重构：模块化存储系统
 * @module storage
 */

import { db, IndexedDBManager, DB_NAME, DB_VERSION, STORE_DEFINITIONS } from './db.js';
import { storageAdapter, StorageAdapter } from './storage-adapter.js';
import { migration, MigrationManager } from './migration.js';
import { storageCompat, StorageCompat } from './storage-compat.js';

/**
 * 存储系统初始化管理器
 */
class StorageSystem {
    constructor() {
        this.db = db;
        this.adapter = storageAdapter;
        this.migration = migration;
        this._initialized = false;
        this._initPromise = null;
    }

    /**
     * 初始化存储系统
     * 流程：打开DB → 迁移数据 → 初始化适配器
     * @param {object} options
     * @param {boolean} options.forceMigration - 强制重新迁移
     * @param {function} options.onProgress - 迁移进度回调
     * @returns {Promise<{success: boolean, migrated: boolean, fallback: boolean}>}
     */
    async init(options = {}) {
        if (this._initPromise) {
            return this._initPromise;
        }

        this._initPromise = this._doInit(options);
        return this._initPromise;
    }

    async _doInit(options = {}) {
        const { forceMigration = false, onProgress = null } = options;
        
        console.log('StorageSystem: Initializing...');

        try {
            // 步骤1：初始化IndexedDB
            await this.db.init();
            console.log('StorageSystem: IndexedDB connected');

            // 步骤2：如果需要，执行数据迁移
            let migrated = false;
            if (forceMigration) {
                this.migration.resetMigration();
            }

            if (this.migration.needsMigration()) {
                console.log('StorageSystem: Data migration needed');
                if (onProgress) {
                    this.migration.onProgress(onProgress);
                }
                const result = await this.migration.migrate();
                migrated = result.success;
                
                if (result.success) {
                    console.log('StorageSystem: Migration completed', result.stats);
                    // 迁移成功后清理localStorage（保留标记）
                    this.migration.cleanupLocalStorage(true);
                } else {
                    console.warn('StorageSystem: Migration failed', result.error);
                }
            }

            // 步骤3：初始化Storage适配器
            await this.adapter.init();
            const fallback = this.adapter.isFallbackMode();
            
            if (fallback) {
                console.warn('StorageSystem: Running in fallback mode (localStorage)');
            } else {
                console.log('StorageSystem: Running in IndexedDB mode');
            }

            this._initialized = true;

            return {
                success: true,
                migrated,
                fallback,
                error: null
            };

        } catch (error) {
            console.error('StorageSystem: Initialization failed', error);
            
            // 尝试降级到localStorage
            try {
                await this.adapter.init();
                this._initialized = true;
                return {
                    success: true,
                    migrated: false,
                    fallback: true,
                    error: error.message
                };
            } catch (fallbackError) {
                return {
                    success: false,
                    migrated: false,
                    fallback: false,
                    error: error.message
                };
            }
        }
    }

    /**
     * 等待初始化完成
     */
    async ready() {
        if (!this._initPromise) {
            await this.init();
        } else {
            await this._initPromise;
        }
    }

    /**
     * 检查是否已初始化
     */
    isInitialized() {
        return this._initialized;
    }

    /**
     * 获取存储系统状态
     */
    getStatus() {
        return {
            initialized: this._initialized,
            fallback: this.adapter.isFallbackMode(),
            migration: this.migration.getMigrationInfo()
        };
    }

    /**
     * 重置存储系统（危险操作，用于测试）
     */
    async reset() {
        this._initialized = false;
        this._initPromise = null;
        this.migration.resetMigration();
        await this.db.deleteDatabase();
        console.log('StorageSystem: Reset completed');
    }
}

// 创建全局实例
const storageSystem = new StorageSystem();

// 导出所有模块
export {
    // 核心模块
    db,
    IndexedDBManager,
    DB_NAME,
    DB_VERSION,
    STORE_DEFINITIONS,
    
    // 适配器模块
    storageAdapter,
    StorageAdapter,
    
    // 迁移模块
    migration,
    MigrationManager,
    
    // 兼容层模块
    storageCompat,
    StorageCompat,
    
    // 系统管理
    storageSystem,
    StorageSystem
};

// 默认导出系统管理器
export default storageSystem;
