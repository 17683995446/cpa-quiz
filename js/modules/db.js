/**
 * IndexedDB核心模块 - R26重构
 * 提供数据库连接、对象存储管理和基础CRUD操作
 * @module db
 */

const DB_NAME = 'CPAQuizDB';
const DB_VERSION = 1;

// 对象存储定义
const STORE_DEFINITIONS = {
    answers: {
        keyPath: 'questionKey',
        indexes: [
            { name: 'subjectId', keyPath: 'subjectId', unique: false },
            { name: 'timestamp', keyPath: 'timestamp', unique: false },
            { name: 'isCorrect', keyPath: 'isCorrect', unique: false }
        ]
    },
    wrong_questions: {
        keyPath: 'key',
        indexes: [
            { name: 'subjectId', keyPath: 'subjectId', unique: false },
            { name: 'addedAt', keyPath: 'addedAt', unique: false }
        ]
    },
    favorites: {
        keyPath: 'key',
        indexes: [
            { name: 'subjectId', keyPath: 'subjectId', unique: false },
            { name: 'addedAt', keyPath: 'addedAt', unique: false }
        ]
    },
    notes: {
        keyPath: 'key',
        indexes: [
            { name: 'updatedAt', keyPath: 'updatedAt', unique: false },
            { name: 'tags', keyPath: 'tags', unique: false, multiEntry: true }
        ]
    },
    stats: {
        keyPath: 'id',
        indexes: []
    },
    exam_state: {
        keyPath: 'id',
        indexes: [
            { name: 'timestamp', keyPath: 'timestamp', unique: false }
        ]
    },
    settings: {
        keyPath: 'key',
        indexes: []
    }
};

/**
 * IndexedDB管理器类
 */
class IndexedDBManager {
    constructor() {
        this.db = null;
        this.isOpen = false;
        this._initPromise = null;
        this._listeners = new Map();
    }

    /**
     * 初始化数据库连接
     * @returns {Promise<IDBDatabase>}
     */
    async init() {
        if (this._initPromise) {
            return this._initPromise;
        }

        this._initPromise = new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                reject(new Error('IndexedDB not supported'));
                return;
            }

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                console.error('IndexedDB open error:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                this.isOpen = true;
                
                // 监听数据库连接意外关闭
                this.db.onclose = () => {
                    console.warn('IndexedDB connection closed unexpectedly');
                    this.isOpen = false;
                    this.db = null;
                    this._initPromise = null;
                };

                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                this._createStores(db);
            };
        });

        return this._initPromise;
    }

    /**
     * 创建对象存储和索引
     * @param {IDBDatabase} db
     * @private
     */
    _createStores(db) {
        for (const [storeName, config] of Object.entries(STORE_DEFINITIONS)) {
            if (!db.objectStoreNames.contains(storeName)) {
                const store = db.createObjectStore(storeName, {
                    keyPath: config.keyPath,
                    autoIncrement: config.autoIncrement || false
                });

                // 创建索引
                if (config.indexes) {
                    for (const idx of config.indexes) {
                        store.createIndex(idx.name, idx.keyPath, {
                            unique: idx.unique || false,
                            multiEntry: idx.multiEntry || false
                        });
                    }
                }
            }
        }
    }

    /**
     * 确保数据库已打开
     * @private
     */
    async _ensureOpen() {
        if (!this.isOpen || !this.db) {
            await this.init();
        }
    }

    /**
     * 获取事务
     * @param {string|string[]} storeNames
     * @param {string} mode - 'readonly' | 'readwrite'
     * @returns {IDBTransaction}
     */
    async transaction(storeNames, mode = 'readonly') {
        await this._ensureOpen();
        const stores = Array.isArray(storeNames) ? storeNames : [storeNames];
        return this.db.transaction(stores, mode);
    }

    /**
     * 获取对象存储
     * @param {IDBTransaction} transaction
     * @param {string} storeName
     * @returns {IDBObjectStore}
     */
    getStore(transaction, storeName) {
        return transaction.objectStore(storeName);
    }

    /**
     * 添加数据
     * @param {string} storeName
     * @param {object} data
     * @returns {Promise<string>}
     */
    async add(storeName, data) {
        await this._ensureOpen();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.add(data);

            request.onsuccess = () => {
                this._notifyChange(storeName, 'add', data);
                resolve(request.result);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 更新或插入数据（upsert）
     * @param {string} storeName
     * @param {object} data
     * @returns {Promise<string>}
     */
    async put(storeName, data) {
        await this._ensureOpen();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(data);

            request.onsuccess = () => {
                this._notifyChange(storeName, 'put', data);
                resolve(request.result);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 根据key获取数据
     * @param {string} storeName
     * @param {string} key
     * @returns {Promise<object|null>}
     */
    async get(storeName, key) {
        await this._ensureOpen();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(key);

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 根据索引获取数据
     * @param {string} storeName
     * @param {string} indexName
     * @param {any} key
     * @returns {Promise<object[]>}
     */
    async getByIndex(storeName, indexName, key) {
        await this._ensureOpen();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const index = store.index(indexName);
            const request = index.getAll(key);

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 获取所有数据
     * @param {string} storeName
     * @returns {Promise<object[]>}
     */
    async getAll(storeName) {
        await this._ensureOpen();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 删除数据
     * @param {string} storeName
     * @param {string} key
     * @returns {Promise<void>}
     */
    async delete(storeName, key) {
        await this._ensureOpen();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(key);

            request.onsuccess = () => {
                this._notifyChange(storeName, 'delete', { key });
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 清空对象存储
     * @param {string} storeName
     * @returns {Promise<void>}
     */
    async clear(storeName) {
        await this._ensureOpen();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => {
                this._notifyChange(storeName, 'clear', {});
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 批量添加/更新
     * @param {string} storeName
     * @param {object[]} items
     * @returns {Promise<string[]>}
     */
    async batchPut(storeName, items) {
        await this._ensureOpen();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const keys = [];
            let completed = 0;

            for (const item of items) {
                const request = store.put(item);
                request.onsuccess = () => {
                    keys.push(request.result);
                    completed++;
                    if (completed === items.length) {
                        this._notifyChange(storeName, 'batchPut', { count: items.length });
                        resolve(keys);
                    }
                };
                request.onerror = () => reject(request.error);
            }

            // 处理空数组情况
            if (items.length === 0) {
                resolve([]);
            }
        });
    }

    /**
     * 批量删除
     * @param {string} storeName
     * @param {string[]} keys
     * @returns {Promise<void>}
     */
    async batchDelete(storeName, keys) {
        await this._ensureOpen();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            let completed = 0;

            for (const key of keys) {
                const request = store.delete(key);
                request.onsuccess = () => {
                    completed++;
                    if (completed === keys.length) {
                        this._notifyChange(storeName, 'batchDelete', { count: keys.length });
                        resolve();
                    }
                };
                request.onerror = () => reject(request.error);
            }

            if (keys.length === 0) {
                resolve();
            }
        });
    }

    /**
     * 游标遍历
     * @param {string} storeName
     * @param {function} callback - 对每个记录调用的函数
     * @param {object} options - {index, range, direction}
     * @returns {Promise<number>} 处理的记录数
     */
    async cursor(storeName, callback, options = {}) {
        await this._ensureOpen();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const source = options.index ? store.index(options.index) : store;
            const direction = options.direction || 'next';
            
            const request = options.range 
                ? source.openCursor(options.range, direction)
                : source.openCursor(null, direction);

            let count = 0;
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const result = callback(cursor.value, cursor);
                    if (result === false) {
                        resolve(count);
                    } else {
                        count++;
                        cursor.continue();
                    }
                } else {
                    resolve(count);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 统计记录数
     * @param {string} storeName
     * @returns {Promise<number>}
     */
    async count(storeName) {
        await this._ensureOpen();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.count();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 注册数据变化监听器
     * @param {string} storeName
     * @param {function} callback
     * @returns {function} 取消监听的函数
     */
    onChange(storeName, callback) {
        if (!this._listeners.has(storeName)) {
            this._listeners.set(storeName, new Set());
        }
        this._listeners.get(storeName).add(callback);

        return () => {
            const listeners = this._listeners.get(storeName);
            if (listeners) {
                listeners.delete(callback);
            }
        };
    }

    /**
     * 通知数据变化
     * @private
     */
    _notifyChange(storeName, operation, data) {
        const listeners = this._listeners.get(storeName);
        if (listeners) {
            listeners.forEach(callback => {
                try {
                    callback({ storeName, operation, data, timestamp: Date.now() });
                } catch (e) {
                    console.error('Change listener error:', e);
                }
            });
        }
    }

    /**
     * 关闭数据库连接
     */
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
            this.isOpen = false;
            this._initPromise = null;
        }
    }

    /**
     * 删除数据库（危险操作）
     */
    async deleteDatabase() {
        this.close();
        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(DB_NAME);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('Database deletion blocked'));
        });
    }
}

// 导出单例实例
const db = new IndexedDBManager();

export { db, IndexedDBManager, DB_NAME, DB_VERSION, STORE_DEFINITIONS };
export default db;
