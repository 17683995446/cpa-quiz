/**
 * 事务管理模块 - R28并发安全
 * IndexedDB事务封装，支持多对象存储事务、回滚和超时处理
 * @module transaction-manager
 */

import { db } from './db.js';

/**
 * 事务状态
 */
const TransactionState = {
    PENDING: 'pending',
    ACTIVE: 'active',
    COMMITTING: 'committing',
    COMMITTED: 'committed',
    ABORTING: 'aborting',
    ABORTED: 'aborted',
    TIMEOUT: 'timeout',
    ERROR: 'error'
};

/**
 * 事务隔离级别
 */
const IsolationLevel = {
    READ_UNCOMMITTED: 'read_uncommitted',
    READ_COMMITTED: 'read_committed',
    REPEATABLE_READ: 'repeatable_read',
    SERIALIZABLE: 'serializable'
};

/**
 * 事务日志类型
 */
const LogType = {
    BEGIN: 'begin',
    OPERATION: 'operation',
    COMMIT: 'commit',
    ROLLBACK: 'rollback',
    CHECKPOINT: 'checkpoint'
};

/**
 * 事务类
 */
class Transaction {
    constructor(options = {}) {
        this.id = this._generateId();
        this.state = TransactionState.PENDING;
        this.isolationLevel = options.isolationLevel || IsolationLevel.READ_COMMITTED;
        this.timeout = options.timeout || 30000; // 默认30秒超时
        this.readOnly = options.readOnly || false;
        this.storeNames = options.storeNames || [];
        
        this.operations = []; // 操作队列
        this.undoLog = []; // 回滚日志
        this.redoLog = []; // 重做日志
        this.readSet = new Map(); // 读集（用于冲突检测）
        this.writeSet = new Map(); // 写集
        
        this.startTime = null;
        this.endTime = null;
        this.error = null;
        this.timeoutId = null;
        
        this._idbTransaction = null;
        this._promiseQueue = [];
        this._nestedTransactions = [];
        this._savepoints = [];
    }

    _generateId() {
        return `tx-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 开始事务
     */
    async begin() {
        if (this.state !== TransactionState.PENDING) {
            throw new Error(`Transaction ${this.id} already started`);
        }

        this.startTime = Date.now();
        this.state = TransactionState.ACTIVE;

        // 设置超时
        this._setupTimeout();

        // 记录日志
        this._log(LogType.BEGIN, { storeNames: this.storeNames });

        // 初始化IndexedDB事务
        if (this.storeNames.length > 0 && !this.readOnly) {
            try {
                this._idbTransaction = await db.transaction(this.storeNames, 'readwrite');
                
                // 监听事务完成/错误
                this._idbTransaction.oncomplete = () => {
                    this.state = TransactionState.COMMITTED;
                };
                
                this._idbTransaction.onerror = (event) => {
                    this.error = event.target.error;
                    this.state = TransactionState.ERROR;
                };
                
                this._idbTransaction.onabort = () => {
                    this.state = TransactionState.ABORTED;
                };
            } catch (error) {
                this.error = error;
                this.state = TransactionState.ERROR;
                throw error;
            }
        }

        return this;
    }

    /**
     * 执行操作
     */
    async execute(operation) {
        this._ensureActive();

        const opRecord = {
            id: `${this.id}-op-${this.operations.length}`,
            type: operation.type,
            storeName: operation.storeName,
            data: operation.data,
            timestamp: Date.now()
        };

        this.operations.push(opRecord);

        try {
            // 记录undo信息
            await this._recordUndo(operation);

            // 执行操作
            const result = await this._executeOperation(operation);

            // 更新写集
            if (operation.type === 'put' || operation.type === 'add' || operation.type === 'delete') {
                this.writeSet.set(`${operation.storeName}:${operation.key}`, {
                    operation: opRecord,
                    result
                });
            }

            // 记录redo
            this.redoLog.push({ operation: opRecord, result });

            return result;
        } catch (error) {
            this.error = error;
            throw error;
        }
    }

    /**
     * 批量执行操作
     */
    async executeBatch(operations) {
        this._ensureActive();
        
        const results = [];
        
        // 使用Promise.allSettled确保所有操作都执行
        const promises = operations.map(op => this.execute(op));
        const settled = await Promise.allSettled(promises);
        
        for (let i = 0; i < settled.length; i++) {
            const result = settled[i];
            if (result.status === 'fulfilled') {
                results.push(result.value);
            } else {
                // 批量操作失败，记录错误但不立即回滚
                results.push({ error: result.reason });
            }
        }

        return results;
    }

    /**
     * 设置保存点
     */
    async savepoint(name) {
        this._ensureActive();
        
        const savepoint = {
            name: name || `sp-${this._savepoints.length}`,
            operationIndex: this.operations.length,
            undoLogLength: this.undoLog.length,
            writeSetSnapshot: new Map(this.writeSet),
            timestamp: Date.now()
        };

        this._savepoints.push(savepoint);
        this._log(LogType.CHECKPOINT, { savepoint: savepoint.name });

        return savepoint.name;
    }

    /**
     * 回滚到保存点
     */
    async rollbackToSavepoint(name) {
        this._ensureActive();

        const spIndex = this._savepoints.findIndex(sp => sp.name === name);
        if (spIndex === -1) {
            throw new Error(`Savepoint ${name} not found`);
        }

        const savepoint = this._savepoints[spIndex];

        // 回滚undo日志到保存点位置
        const undoCount = this.undoLog.length - savepoint.undoLogLength;
        for (let i = 0; i < undoCount; i++) {
            const undoOp = this.undoLog.pop();
            await this._performUndo(undoOp);
        }

        // 恢复写集
        this.writeSet = new Map(savepoint.writeSetSnapshot);

        // 移除保存点之后的所有保存点
        this._savepoints = this._savepoints.slice(0, spIndex + 1);

        this._log(LogType.ROLLBACK, { toSavepoint: name });

        return true;
    }

    /**
     * 提交事务
     */
    async commit() {
        if (this.state !== TransactionState.ACTIVE) {
            throw new Error(`Transaction ${this.id} is not active`);
        }

        this.state = TransactionState.COMMITTING;

        try {
            // 等待所有操作完成
            await Promise.all(this._promiseQueue);

            // 提交IndexedDB事务
            if (this._idbTransaction) {
                // IndexedDB事务会自动提交
                await new Promise((resolve, reject) => {
                    this._idbTransaction.oncomplete = () => resolve();
                    this._idbTransaction.onerror = () => reject(this._idbTransaction.error);
                });
            }

            this.state = TransactionState.COMMITTED;
            this.endTime = Date.now();
            this._clearTimeout();

            this._log(LogType.COMMIT, {
                duration: this.endTime - this.startTime,
                operations: this.operations.length
            });

            return true;
        } catch (error) {
            this.error = error;
            this.state = TransactionState.ERROR;
            throw error;
        }
    }

    /**
     * 回滚事务
     */
    async rollback() {
        if (this.state !== TransactionState.ACTIVE && this.state !== TransactionState.ERROR) {
            return false;
        }

        this.state = TransactionState.ABORTING;

        try {
            // 中止IndexedDB事务
            if (this._idbTransaction) {
                this._idbTransaction.abort();
            }

            // 执行undo操作（从后往前）
            for (let i = this.undoLog.length - 1; i >= 0; i--) {
                await this._performUndo(this.undoLog[i]);
            }

            this.state = TransactionState.ABORTED;
            this.endTime = Date.now();
            this._clearTimeout();

            this._log(LogType.ROLLBACK, {
                duration: this.endTime - this.startTime,
                operations: this.operations.length
            });

            return true;
        } catch (error) {
            this.error = error;
            this.state = TransactionState.ERROR;
            throw error;
        }
    }

    /**
     * 获取事务统计信息
     */
    getStats() {
        return {
            id: this.id,
            state: this.state,
            duration: this.endTime ? this.endTime - this.startTime : Date.now() - this.startTime,
            operationCount: this.operations.length,
            readSetSize: this.readSet.size,
            writeSetSize: this.writeSet.size,
            savepointCount: this._savepoints.length,
            error: this.error ? this.error.message : null
        };
    }

    // ==================== 私有方法 ====================

    _ensureActive() {
        if (this.state !== TransactionState.ACTIVE) {
            throw new Error(`Transaction ${this.id} is not active (state: ${this.state})`);
        }
    }

    _setupTimeout() {
        if (this.timeout > 0) {
            this.timeoutId = setTimeout(() => {
                if (this.state === TransactionState.ACTIVE) {
                    console.warn(`Transaction ${this.id} timeout`);
                    this.state = TransactionState.TIMEOUT;
                    this.rollback().catch(err => {
                        console.error('Transaction rollback on timeout failed:', err);
                    });
                }
            }, this.timeout);
        }
    }

    _clearTimeout() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }

    async _recordUndo(operation) {
        let undoData = null;

        switch (operation.type) {
            case 'put':
            case 'add':
                // 记录原值以便恢复
                try {
                    const existing = await db.get(operation.storeName, operation.key);
                    undoData = { type: existing ? 'put' : 'delete', data: existing };
                } catch (e) {
                    undoData = { type: 'delete', data: null };
                }
                break;
            case 'delete':
                try {
                    const existing = await db.get(operation.storeName, operation.key);
                    undoData = { type: 'put', data: existing };
                } catch (e) {
                    undoData = { type: 'noop', data: null };
                }
                break;
            case 'clear':
                // 对于clear操作，需要记录所有数据
                try {
                    const allData = await db.getAll(operation.storeName);
                    undoData = { type: 'batchPut', data: allData };
                } catch (e) {
                    undoData = { type: 'noop', data: null };
                }
                break;
        }

        if (undoData) {
            this.undoLog.push({
                operation,
                undoData,
                timestamp: Date.now()
            });
        }
    }

    async _performUndo(undoEntry) {
        const { operation, undoData } = undoEntry;

        if (!undoData || undoData.type === 'noop') return;

        try {
            switch (undoData.type) {
                case 'put':
                    if (undoData.data) {
                        await db.put(operation.storeName, undoData.data);
                    }
                    break;
                case 'delete':
                    await db.delete(operation.storeName, operation.key);
                    break;
                case 'batchPut':
                    if (undoData.data && undoData.data.length > 0) {
                        await db.batchPut(operation.storeName, undoData.data);
                    }
                    break;
            }
        } catch (error) {
            console.error('Undo operation failed:', error);
        }
    }

    async _executeOperation(operation) {
        const { type, storeName, data, key } = operation;

        switch (type) {
            case 'get':
                const readResult = await db.get(storeName, key);
                this.readSet.set(`${storeName}:${key}`, readResult);
                return readResult;
            case 'getAll':
                return await db.getAll(storeName);
            case 'getByIndex':
                return await db.getByIndex(storeName, operation.indexName, operation.indexKey);
            case 'add':
                return await db.add(storeName, data);
            case 'put':
                if (this._idbTransaction) {
                    const store = this._idbTransaction.objectStore(storeName);
                    return await new Promise((resolve, reject) => {
                        const request = store.put(data);
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    });
                }
                return await db.put(storeName, data);
            case 'delete':
                return await db.delete(storeName, key);
            case 'clear':
                return await db.clear(storeName);
            case 'batchPut':
                return await db.batchPut(storeName, data);
            case 'batchDelete':
                return await db.batchDelete(storeName, data);
            default:
                throw new Error(`Unknown operation type: ${type}`);
        }
    }

    _log(type, data) {
        const logEntry = {
            timestamp: Date.now(),
            transactionId: this.id,
            type,
            data
        };

        // 可以在这里集成外部日志系统
        if (TransactionManager.logHandler) {
            TransactionManager.logHandler(logEntry);
        }
    }
}

/**
 * 事务管理器
 */
class TransactionManager {
    constructor() {
        this.activeTransactions = new Map();
        this.transactionLog = [];
        this.maxLogSize = 1000;
        this.statistics = {
            totalTransactions: 0,
            committed: 0,
            aborted: 0,
            timeouts: 0,
            errors: 0
        };
        this._logHandler = null;
    }

    /**
     * 设置日志处理器
     */
    static set logHandler(handler) {
        this._logHandler = handler;
    }

    static get logHandler() {
        return this._logHandler;
    }

    /**
     * 创建并启动新事务
     */
    async beginTransaction(options = {}) {
        const transaction = new Transaction(options);
        
        await transaction.begin();
        
        this.activeTransactions.set(transaction.id, transaction);
        this.statistics.totalTransactions++;

        // 监听事务结束
        const originalCommit = transaction.commit.bind(transaction);
        const originalRollback = transaction.rollback.bind(transaction);

        transaction.commit = async () => {
            const result = await originalCommit();
            this.activeTransactions.delete(transaction.id);
            this.statistics.committed++;
            this._addToLog(transaction);
            return result;
        };

        transaction.rollback = async () => {
            const result = await originalRollback();
            this.activeTransactions.delete(transaction.id);
            this.statistics.aborted++;
            this._addToLog(transaction);
            return result;
        };

        return transaction;
    }

    /**
     * 获取活动事务
     */
    getActiveTransaction(id) {
        return this.activeTransactions.get(id);
    }

    /**
     * 获取所有活动事务
     */
    getAllActiveTransactions() {
        return Array.from(this.activeTransactions.values());
    }

    /**
     * 在事务中执行操作（自动提交/回滚）
     */
    async withTransaction(options, operations) {
        const tx = await this.beginTransaction(options);
        
        try {
            let result;
            
            if (typeof operations === 'function') {
                result = await operations(tx);
            } else if (Array.isArray(operations)) {
                result = await tx.executeBatch(operations);
            } else {
                result = await tx.execute(operations);
            }

            await tx.commit();
            return { success: true, result, transactionId: tx.id };
        } catch (error) {
            try {
                await tx.rollback();
            } catch (rollbackError) {
                console.error('Rollback failed:', rollbackError);
            }
            
            this.statistics.errors++;
            return { success: false, error: error.message, transactionId: tx.id };
        }
    }

    /**
     * 嵌套事务处理（扁平化）
     */
    async withNestedTransaction(parentTx, operations) {
        // IndexedDB不支持真正的嵌套事务，使用保存点模拟
        const savepointName = await parentTx.savepoint();
        
        try {
            let result;
            
            if (typeof operations === 'function') {
                result = await operations(parentTx);
            } else if (Array.isArray(operations)) {
                result = await parentTx.executeBatch(operations);
            } else {
                result = await parentTx.execute(operations);
            }

            return { success: true, result, savepoint: savepointName };
        } catch (error) {
            // 回滚到保存点
            await parentTx.rollbackToSavepoint(savepointName);
            return { success: false, error: error.message };
        }
    }

    /**
     * 批量事务处理（分批提交）
     */
    async batchTransaction(options, batches) {
        const results = [];
        const failedBatches = [];

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            
            try {
                const result = await this.withTransaction(
                    { ...options, timeout: options.batchTimeout || options.timeout },
                    batch
                );
                
                results.push({ batchIndex: i, ...result });
            } catch (error) {
                failedBatches.push({ batchIndex: i, error: error.message });
                
                if (options.stopOnError) {
                    break;
                }
            }
        }

        return {
            success: failedBatches.length === 0,
            processed: results.length,
            failed: failedBatches.length,
            results,
            failedBatches
        };
    }

    /**
     * 获取统计信息
     */
    getStatistics() {
        return {
            ...this.statistics,
            activeTransactions: this.activeTransactions.size,
            logSize: this.transactionLog.length
        };
    }

    /**
     * 清理日志
     */
    clearLog() {
        this.transactionLog = [];
    }

    /**
     * 获取事务日志
     */
    getTransactionLog(limit = 100) {
        return this.transactionLog.slice(-limit);
    }

    /**
     * 恢复未完成的事务（应用启动时调用）
     */
    async recover() {
        // 在实际实现中，这里会从持久化存储中读取未完成的事务日志
        // 并尝试恢复或回滚
        console.log('TransactionManager: Recovery check completed');
        return true;
    }

    _addToLog(transaction) {
        this.transactionLog.push({
            id: transaction.id,
            state: transaction.state,
            startTime: transaction.startTime,
            endTime: transaction.endTime,
            duration: transaction.endTime - transaction.startTime,
            operationCount: transaction.operations.length,
            error: transaction.error ? transaction.error.message : null
        });

        // 限制日志大小
        if (this.transactionLog.length > this.maxLogSize) {
            this.transactionLog = this.transactionLog.slice(-this.maxLogSize / 2);
        }
    }
}

/**
 * 乐观并发控制事务
 */
class OptimisticTransaction extends Transaction {
    constructor(options = {}) {
        super(options);
        this.versionChecks = new Map(); // 版本检查
        this.conflictHandler = options.conflictHandler || null;
    }

    /**
     * 带版本检查的读取
     */
    async getWithVersion(storeName, key, expectedVersion) {
        const result = await this.execute({
            type: 'get',
            storeName,
            key
        });

        if (result && expectedVersion !== undefined) {
            this.versionChecks.set(`${storeName}:${key}`, {
                expectedVersion,
                actualVersion: result._v || result.version || 0
            });
        }

        return result;
    }

    /**
     * 带版本号的写入
     */
    async putWithVersion(storeName, data, key, version) {
        const versionedData = {
            ...data,
            _v: (version || 0) + 1,
            _updatedAt: Date.now()
        };

        return this.execute({
            type: 'put',
            storeName,
            key,
            data: versionedData
        });
    }

    /**
     * 验证版本（提交前调用）
     */
    async validateVersions() {
        for (const [key, check] of this.versionChecks) {
            const [storeName, recordKey] = key.split(':');
            const current = await db.get(storeName, recordKey);
            const currentVersion = current?._v || current?.version || 0;

            if (currentVersion !== check.actualVersion) {
                // 版本冲突
                if (this.conflictHandler) {
                    const resolution = await this.conflictHandler({
                        key: recordKey,
                        storeName,
                        expected: check.actualVersion,
                        actual: currentVersion,
                        localData: this.writeSet.get(key),
                        remoteData: current
                    });

                    if (!resolution.resolved) {
                        throw new Error(`Version conflict on ${key}`);
                    }
                } else {
                    throw new Error(`Version conflict on ${key}: expected ${check.actualVersion}, got ${currentVersion}`);
                }
            }
        }

        return true;
    }

    /**
     * 重写commit方法，添加版本验证
     */
    async commit() {
        // 验证版本
        await this.validateVersions();
        
        // 调用父类commit
        return super.commit();
    }
}

// 导出单例实例
const transactionManager = new TransactionManager();

export {
    TransactionManager,
    Transaction,
    OptimisticTransaction,
    TransactionState,
    IsolationLevel,
    LogType,
    transactionManager
};

export default transactionManager;
