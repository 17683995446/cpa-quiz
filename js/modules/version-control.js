/**
 * 版本控制与冲突检测模块 - R28并发安全
 * 数据版本号管理、冲突检测与合并策略
 * @module version-control
 */

import { db } from './db.js';

/**
 * 冲突类型
 */
const ConflictType = {
    NONE: 'none',
    VERSION_MISMATCH: 'version_mismatch',
    CONCURRENT_EDIT: 'concurrent_edit',
    DELETE_EDIT: 'delete_edit',
    FIELD_CONFLICT: 'field_conflict'
};

/**
 * 合并策略
 */
const MergeStrategy = {
    LAST_WRITE_WINS: 'last_write_wins',      // 以最新时间戳为准
    FIRST_WRITE_WINS: 'first_write_wins',    // 以最早时间戳为准
    MANUAL_MERGE: 'manual_merge',            // 手动合并
    CUSTOM_MERGE: 'custom_merge'             // 自定义合并函数
};

/**
 * 版本控制器
 */
class VersionController {
    constructor(options = {}) {
        this.versionField = options.versionField || '_v';
        this.timestampField = options.timestampField || '_updatedAt';
        this.sourceField = options.sourceField || '_source';
        this.mergeStrategy = options.mergeStrategy || MergeStrategy.LAST_WRITE_WINS;
        this.customMerger = options.customMerger || null;
        this.conflictListeners = [];
        this.versionHistory = new Map(); // 版本历史缓存
        this.maxHistorySize = options.maxHistorySize || 10;
    }

    /**
     * 获取数据的当前版本
     */
    getVersion(data) {
        if (!data) return 0;
        return data[this.versionField] || 0;
    }

    /**
     * 获取数据的时间戳
     */
    getTimestamp(data) {
        if (!data) return 0;
        return data[this.timestampField] || 0;
    }

    /**
     * 增加版本号
     */
    incrementVersion(data, source = 'local') {
        const currentVersion = this.getVersion(data);
        return {
            ...data,
            [this.versionField]: currentVersion + 1,
            [this.timestampField]: Date.now(),
            [this.sourceField]: source
        };
    }

    /**
     * 检测冲突
     */
    detectConflict(localData, remoteData, baseData = null) {
        // 如果数据相同，无冲突
        if (this._deepEqual(localData, remoteData)) {
            return { type: ConflictType.NONE };
        }

        // 如果本地或远程为null（删除）
        if (!localData || !remoteData) {
            return {
                type: ConflictType.DELETE_EDIT,
                localData,
                remoteData,
                description: !localData ? 'Local deleted, remote modified' : 'Remote deleted, local modified'
            };
        }

        const localVersion = this.getVersion(localData);
        const remoteVersion = this.getVersion(remoteData);
        const baseVersion = baseData ? this.getVersion(baseData) : 0;

        // 版本号相同但数据不同（异常情况）
        if (localVersion === remoteVersion && localVersion > 0) {
            return {
                type: ConflictType.CONCURRENT_EDIT,
                localData,
                remoteData,
                baseData,
                description: 'Same version but different data'
            };
        }

        // 版本号不同
        if (localVersion !== remoteVersion) {
            // 检查是否是基于同一版本的并发修改
            if (baseVersion > 0 && 
                ((localVersion > baseVersion && remoteVersion > baseVersion))) {
                return {
                    type: ConflictType.CONCURRENT_EDIT,
                    localData,
                    remoteData,
                    baseData,
                    description: 'Concurrent modifications from same base'
                };
            }

            return {
                type: ConflictType.VERSION_MISMATCH,
                localData,
                remoteData,
                description: `Version mismatch: local=${localVersion}, remote=${remoteVersion}`
            };
        }

        // 字段级冲突检测
        const fieldConflicts = this._detectFieldConflicts(localData, remoteData, baseData);
        if (fieldConflicts.length > 0) {
            return {
                type: ConflictType.FIELD_CONFLICT,
                localData,
                remoteData,
                baseData,
                fieldConflicts,
                description: `Field conflicts: ${fieldConflicts.map(f => f.field).join(', ')}`
            };
        }

        return { type: ConflictType.NONE };
    }

    /**
     * 合并数据
     */
    async merge(conflict, strategy = null) {
        const mergeStrategy = strategy || this.mergeStrategy;

        switch (mergeStrategy) {
            case MergeStrategy.LAST_WRITE_WINS:
                return this._mergeLastWriteWins(conflict);
            case MergeStrategy.FIRST_WRITE_WINS:
                return this._mergeFirstWriteWins(conflict);
            case MergeStrategy.MANUAL_MERGE:
                return this._mergeManual(conflict);
            case MergeStrategy.CUSTOM_MERGE:
                return this._mergeCustom(conflict);
            default:
                throw new Error(`Unknown merge strategy: ${mergeStrategy}`);
        }
    }

    /**
     * 自动合并（尝试自动解决冲突）
     */
    async autoMerge(localData, remoteData, baseData = null) {
        const conflict = this.detectConflict(localData, remoteData, baseData);

        if (conflict.type === ConflictType.NONE) {
            return {
                success: true,
                data: remoteData || localData,
                conflict: null,
                autoResolved: true
            };
        }

        // 尝试自动合并
        try {
            const merged = await this.merge(conflict, this.mergeStrategy);
            return {
                success: true,
                data: merged,
                conflict,
                autoResolved: true
            };
        } catch (error) {
            // 自动合并失败，需要手动解决
            return {
                success: false,
                data: null,
                conflict,
                autoResolved: false,
                error: error.message
            };
        }
    }

    /**
     * 保存版本历史
     */
    saveVersionHistory(key, data) {
        if (!this.versionHistory.has(key)) {
            this.versionHistory.set(key, []);
        }

        const history = this.versionHistory.get(key);
        history.push({
            version: this.getVersion(data),
            timestamp: Date.now(),
            data: this._deepClone(data)
        });

        // 限制历史大小
        if (history.length > this.maxHistorySize) {
            history.shift();
        }
    }

    /**
     * 获取版本历史
     */
    getVersionHistory(key) {
        return this.versionHistory.get(key) || [];
    }

    /**
     * 恢复到指定版本
     */
    async restoreVersion(key, version) {
        const history = this.versionHistory.get(key);
        if (!history) {
            throw new Error(`No version history found for key: ${key}`);
        }

        const versionEntry = history.find(h => h.version === version);
        if (!versionEntry) {
            throw new Error(`Version ${version} not found in history`);
        }

        return this._deepClone(versionEntry.data);
    }

    /**
     * 比较两个版本
     */
    compareVersions(version1, version2) {
        if (version1 === version2) return 0;
        return version1 > version2 ? 1 : -1;
    }

    /**
     * 添加冲突监听器
     */
    onConflict(callback) {
        this.conflictListeners.push(callback);
        return () => {
            const index = this.conflictListeners.indexOf(callback);
            if (index >= 0) {
                this.conflictListeners.splice(index, 1);
            }
        };
    }

    /**
     * 通知冲突
     */
    _notifyConflict(conflict, resolution = null) {
        this.conflictListeners.forEach(callback => {
            try {
                callback(conflict, resolution);
            } catch (e) {
                console.error('Conflict listener error:', e);
            }
        });
    }

    // ==================== 合并策略实现 ====================

    _mergeLastWriteWins(conflict) {
        const { localData, remoteData } = conflict;
        const localTime = this.getTimestamp(localData);
        const remoteTime = this.getTimestamp(remoteData);

        // 以最新时间戳为准
        const winner = localTime >= remoteTime ? localData : remoteData;
        const merged = this.incrementVersion(winner, localTime >= remoteTime ? 'local' : 'remote');

        this._notifyConflict(conflict, { strategy: MergeStrategy.LAST_WRITE_WINS, winner: merged });
        
        return merged;
    }

    _mergeFirstWriteWins(conflict) {
        const { localData, remoteData } = conflict;
        const localTime = this.getTimestamp(localData);
        const remoteTime = this.getTimestamp(remoteData);

        // 以最早时间戳为准
        const winner = localTime <= remoteTime ? localData : remoteData;
        const merged = this.incrementVersion(winner, localTime <= remoteTime ? 'local' : 'remote');

        this._notifyConflict(conflict, { strategy: MergeStrategy.FIRST_WRITE_WINS, winner: merged });
        
        return merged;
    }

    _mergeManual(conflict) {
        // 手动合并需要UI支持，这里抛出错误
        this._notifyConflict(conflict, { strategy: MergeStrategy.MANUAL_MERGE, needsResolution: true });
        throw new Error('Manual merge required', { cause: conflict });
    }

    _mergeCustom(conflict) {
        if (!this.customMerger) {
            throw new Error('Custom merger not provided');
        }

        const merged = this.customMerger(conflict);
        const versioned = this.incrementVersion(merged, 'custom');

        this._notifyConflict(conflict, { strategy: MergeStrategy.CUSTOM_MERGE, winner: versioned });
        
        return versioned;
    }

    // ==================== 字段级合并 ====================

    /**
     * 三向合并（Three-way merge）
     */
    threeWayMerge(base, local, remote) {
        const merged = { ...base };
        const conflicts = [];

        // 获取所有字段
        const allKeys = new Set([
            ...Object.keys(base || {}),
            ...Object.keys(local || {}),
            ...Object.keys(remote || {})
        ]);

        for (const key of allKeys) {
            // 跳过元数据字段
            if (key.startsWith('_')) continue;

            const baseVal = base?.[key];
            const localVal = local?.[key];
            const remoteVal = remote?.[key];

            // 本地和远程相同，使用本地值
            if (this._deepEqual(localVal, remoteVal)) {
                merged[key] = localVal;
                continue;
            }

            // 本地未修改，使用远程值
            if (this._deepEqual(baseVal, localVal)) {
                merged[key] = remoteVal;
                continue;
            }

            // 远程未修改，使用本地值
            if (this._deepEqual(baseVal, remoteVal)) {
                merged[key] = localVal;
                continue;
            }

            // 都修改了，记录冲突
            conflicts.push({
                field: key,
                base: baseVal,
                local: localVal,
                remote: remoteVal
            });

            // 默认使用本地值
            merged[key] = localVal;
        }

        return {
            merged: this.incrementVersion(merged),
            conflicts,
            hasConflicts: conflicts.length > 0
        };
    }

    /**
     * 深度合并对象
     */
    deepMerge(target, source, options = {}) {
        const result = this._deepClone(target);
        
        for (const key of Object.keys(source)) {
            if (key.startsWith('_')) continue; // 跳过元数据

            const targetVal = result[key];
            const sourceVal = source[key];

            if (this._isObject(targetVal) && this._isObject(sourceVal)) {
                result[key] = this.deepMerge(targetVal, sourceVal, options);
            } else {
                // 根据策略决定使用哪个值
                if (options.arrayMerge === 'concat' && Array.isArray(targetVal) && Array.isArray(sourceVal)) {
                    result[key] = [...targetVal, ...sourceVal];
                } else if (options.arrayMerge === 'union' && Array.isArray(targetVal) && Array.isArray(sourceVal)) {
                    result[key] = [...new Set([...targetVal, ...sourceVal])];
                } else {
                    result[key] = sourceVal !== undefined ? sourceVal : targetVal;
                }
            }
        }

        return this.incrementVersion(result);
    }

    // ==================== 私有方法 ====================

    _detectFieldConflicts(localData, remoteData, baseData) {
        const conflicts = [];
        const allKeys = new Set([
            ...Object.keys(localData),
            ...Object.keys(remoteData)
        ]);

        for (const key of allKeys) {
            if (key.startsWith('_')) continue; // 跳过元数据字段

            const localVal = localData[key];
            const remoteVal = remoteData[key];
            const baseVal = baseData?.[key];

            // 如果本地和远程相同，无冲突
            if (this._deepEqual(localVal, remoteVal)) continue;

            // 如果基于base，检查是否都修改了
            if (baseData !== null) {
                const localModified = !this._deepEqual(baseVal, localVal);
                const remoteModified = !this._deepEqual(baseVal, remoteVal);

                if (localModified && remoteModified) {
                    conflicts.push({
                        field: key,
                        base: baseVal,
                        local: localVal,
                        remote: remoteVal
                    });
                }
            } else {
                // 没有base数据，只要不同就认为是冲突
                conflicts.push({
                    field: key,
                    local: localVal,
                    remote: remoteVal
                });
            }
        }

        return conflicts;
    }

    _deepEqual(obj1, obj2) {
        if (obj1 === obj2) return true;
        if (obj1 == null || obj2 == null) return obj1 === obj2;
        if (typeof obj1 !== typeof obj2) return false;
        if (typeof obj1 !== 'object') return obj1 === obj2;

        const keys1 = Object.keys(obj1);
        const keys2 = Object.keys(obj2);

        if (keys1.length !== keys2.length) return false;

        for (const key of keys1) {
            if (!keys2.includes(key)) return false;
            if (!this._deepEqual(obj1[key], obj2[key])) return false;
        }

        return true;
    }

    _deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj.getTime());
        if (Array.isArray(obj)) return obj.map(item => this._deepClone(item));
        
        const cloned = {};
        for (const key of Object.keys(obj)) {
            cloned[key] = this._deepClone(obj[key]);
        }
        return cloned;
    }

    _isObject(val) {
        return val !== null && typeof val === 'object' && !Array.isArray(val);
    }
}

/**
 * 同步协调器
 * 处理跨标签页/跨设备的数据同步
 */
class SyncCoordinator {
    constructor(options = {}) {
        this.channelName = options.channelName || 'cpa-quiz-sync-channel';
        this.versionController = options.versionController || new VersionController();
        this.pendingChanges = new Map();
        this.syncListeners = [];
        this.channel = null;
        this.instanceId = this._generateInstanceId();
        this._initialized = false;
    }

    async init() {
        if (this._initialized) return;

        if (window.BroadcastChannel) {
            try {
                this.channel = new BroadcastChannel(this.channelName);
                this.channel.onmessage = (event) => this._handleSyncMessage(event.data);
            } catch (e) {
                console.warn('SyncCoordinator: BroadcastChannel not available');
            }
        }

        this._initialized = true;
    }

    /**
     * 广播数据变更
     */
    broadcastChange(storeName, key, data, operation = 'update') {
        if (!this.channel) return;

        const message = {
            type: 'data-change',
            instanceId: this.instanceId,
            timestamp: Date.now(),
            payload: {
                storeName,
                key,
                data,
                operation,
                version: this.versionController.getVersion(data)
            }
        };

        this.channel.postMessage(message);
    }

    /**
     * 请求同步
     */
    requestSync(storeName) {
        if (!this.channel) return;

        this.channel.postMessage({
            type: 'sync-request',
            instanceId: this.instanceId,
            timestamp: Date.now(),
            payload: { storeName }
        });
    }

    /**
     * 处理同步消息
     */
    _handleSyncMessage(message) {
        if (message.instanceId === this.instanceId) return;

        switch (message.type) {
            case 'data-change':
                this._handleRemoteChange(message.payload);
                break;
            case 'sync-request':
                this._handleSyncRequest(message);
                break;
        }
    }

    async _handleRemoteChange(payload) {
        const { storeName, key, data, operation, version } = payload;

        // 通知监听器
        this.syncListeners.forEach(listener => {
            try {
                listener({
                    type: 'remote-change',
                    storeName,
                    key,
                    data,
                    operation,
                    version
                });
            } catch (e) {
                console.error('Sync listener error:', e);
            }
        });
    }

    _handleSyncRequest(message) {
        // 可以在这里响应同步请求，发送本地数据
        this.syncListeners.forEach(listener => {
            try {
                listener({
                    type: 'sync-request',
                    from: message.instanceId,
                    storeName: message.payload.storeName
                });
            } catch (e) {
                console.error('Sync listener error:', e);
            }
        });
    }

    onSync(callback) {
        this.syncListeners.push(callback);
        return () => {
            const index = this.syncListeners.indexOf(callback);
            if (index >= 0) {
                this.syncListeners.splice(index, 1);
            }
        };
    }

    _generateInstanceId() {
        return `sync-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
    }
}

/**
 * 冲突解决UI支持
 */
class ConflictResolverUI {
    constructor(options = {}) {
        this.container = options.container || null;
        this.onResolve = options.onResolve || null;
        this.onCancel = options.onCancel || null;
    }

    /**
     * 显示冲突解决对话框
     */
    show(conflict, options = {}) {
        const { localData, remoteData, baseData, fieldConflicts } = conflict;

        // 如果没有容器，返回Promise让用户手动处理
        if (!this.container) {
            return new Promise((resolve, reject) => {
                // 存储resolve/reject供后续使用
                this._pendingResolution = { resolve, reject, conflict };
            });
        }

        // 渲染冲突解决UI
        this._renderConflictUI(conflict, options);
    }

    /**
     * 创建冲突解决UI的HTML
     */
    createConflictHTML(conflict) {
        const { localData, remoteData, fieldConflicts = [] } = conflict;

        let html = `
            <div class="conflict-resolver">
                <h3>数据冲突</h3>
                <p>${conflict.description}</p>
                
                <div class="conflict-options">
                    <button class="btn-choose-local">使用本地版本</button>
                    <button class="btn-choose-remote">使用远程版本</button>
                    <button class="btn-merge">合并两者</button>
                </div>
        `;

        // 如果有字段级冲突，显示详细信息
        if (fieldConflicts.length > 0) {
            html += `
                <div class="field-conflicts">
                    <h4>冲突字段</h4>
                    <table>
                        <thead>
                            <tr>
                                <th>字段</th>
                                <th>本地值</th>
                                <th>远程值</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            for (const field of fieldConflicts) {
                html += `
                    <tr>
                        <td>${field.field}</td>
                        <td>${this._formatValue(field.local)}</td>
                        <td>${this._formatValue(field.remote)}</td>
                    </tr>
                `;
            }

            html += `
                        </tbody>
                    </table>
                </div>
            `;
        }

        html += '</div>';
        return html;
    }

    /**
     * 解析冲突（程序化方式）
     */
    resolve(conflict, choice, customData = null) {
        let result;

        switch (choice) {
            case 'local':
                result = conflict.localData;
                break;
            case 'remote':
                result = conflict.remoteData;
                break;
            case 'merge':
                // 使用三向合并
                const merger = new VersionController();
                const mergeResult = merger.threeWayMerge(
                    conflict.baseData,
                    conflict.localData,
                    conflict.remoteData
                );
                result = mergeResult.merged;
                break;
            case 'custom':
                result = customData;
                break;
            default:
                throw new Error(`Unknown resolution choice: ${choice}`);
        }

        if (this._pendingResolution) {
            this._pendingResolution.resolve({
                choice,
                data: result,
                conflict
            });
            this._pendingResolution = null;
        }

        if (this.onResolve) {
            this.onResolve({ choice, data: result, conflict });
        }

        return result;
    }

    _renderConflictUI(conflict, options) {
        if (!this.container) return;

        this.container.innerHTML = this.createConflictHTML(conflict);

        // 绑定事件
        const localBtn = this.container.querySelector('.btn-choose-local');
        const remoteBtn = this.container.querySelector('.btn-choose-remote');
        const mergeBtn = this.container.querySelector('.btn-merge');

        if (localBtn) {
            localBtn.addEventListener('click', () => this.resolve(conflict, 'local'));
        }
        if (remoteBtn) {
            remoteBtn.addEventListener('click', () => this.resolve(conflict, 'remote'));
        }
        if (mergeBtn) {
            mergeBtn.addEventListener('click', () => this.resolve(conflict, 'merge'));
        }
    }

    _formatValue(value) {
        if (value === null || value === undefined) return '(空)';
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    }
}

// 导出单例实例
const versionController = new VersionController();
const syncCoordinator = new SyncCoordinator();

export {
    VersionController,
    SyncCoordinator,
    ConflictResolverUI,
    versionController,
    syncCoordinator,
    ConflictType,
    MergeStrategy
};

export default versionController;
