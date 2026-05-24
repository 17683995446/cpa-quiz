/**
 * 分布式锁模块 - R28并发安全
 * 使用BroadcastChannel实现跨标签页分布式锁
 * @module distributed-lock
 */

/**
 * 锁状态枚举
 */
const LockState = {
    IDLE: 'idle',
    ACQUIRING: 'acquiring',
    HELD: 'held',
    RELEASING: 'releasing',
    EXPIRED: 'expired'
};

/**
 * 锁消息类型
 */
const LockMessageType = {
    ACQUIRE_REQUEST: 'lock:acquire:request',
    ACQUIRE_RESPONSE: 'lock:acquire:response',
    RELEASE: 'lock:release',
    HEARTBEAT: 'lock:heartbeat',
    QUERY: 'lock:query',
    QUERY_RESPONSE: 'lock:query:response',
    FORCE_RELEASE: 'lock:force:release'
};

/**
 * 分布式锁管理器
 * 基于BroadcastChannel实现跨标签页锁协调
 */
class DistributedLockManager {
    constructor(options = {}) {
        this.channelName = options.channelName || 'cpa-quiz-lock-channel';
        this.instanceId = this._generateInstanceId();
        this.defaultTimeout = options.defaultTimeout || 30000; // 默认30秒
        this.heartbeatInterval = options.heartbeatInterval || 5000; // 心跳间隔5秒
        this.heartbeatTimeout = options.heartbeatTimeout || 15000; // 心跳超时15秒
        
        this.channel = null;
        this.locks = new Map(); // 当前持有的锁
        this.waitingQueues = new Map(); // 等待队列
        this.knownLocks = new Map(); // 已知的其他实例持有的锁
        this.heartbeatTimers = new Map();
        this.deadlockDetector = null;
        
        this._messageHandler = this._handleMessage.bind(this);
        this._initialized = false;
        this._listeners = new Map();
    }

    /**
     * 生成唯一实例ID
     */
    _generateInstanceId() {
        return `${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 初始化BroadcastChannel
     */
    async init() {
        if (this._initialized) return;

        if (!window.BroadcastChannel) {
            console.warn('DistributedLock: BroadcastChannel not supported, using fallback');
            this._useFallback = true;
            this._initialized = true;
            return;
        }

        try {
            this.channel = new BroadcastChannel(this.channelName);
            this.channel.onmessage = this._messageHandler;
            this._initialized = true;
            
            // 启动死锁检测
            this._startDeadlockDetection();
            
            console.log('DistributedLock: Initialized with instanceId:', this.instanceId);
        } catch (error) {
            console.error('DistributedLock: Failed to initialize:', error);
            this._useFallback = true;
            this._initialized = true;
        }
    }

    /**
     * 获取锁
     * @param {string} lockName - 锁名称
     * @param {object} options - 选项
     * @returns {Promise<LockToken>}
     */
    async acquire(lockName, options = {}) {
        await this._ensureInitialized();

        const timeout = options.timeout || this.defaultTimeout;
        const waitTimeout = options.waitTimeout || 60000; // 默认等待60秒
        const priority = options.priority || 0;

        // 检查是否已持有该锁
        if (this.locks.has(lockName)) {
            const existingLock = this.locks.get(lockName);
            if (existingLock.state === LockState.HELD) {
                // 重入锁，增加计数
                existingLock.reentrantCount++;
                return existingLock.token;
            }
        }

        // 如果使用fallback模式，直接返回本地锁
        if (this._useFallback) {
            return this._acquireFallback(lockName, timeout);
        }

        // 创建锁请求
        const lockRequest = {
            lockName,
            instanceId: this.instanceId,
            timestamp: Date.now(),
            timeout,
            priority,
            state: LockState.ACQUIRING
        };

        // 检查是否可以直接获取锁
        if (await this._canAcquireLock(lockName)) {
            return this._doAcquire(lockRequest);
        }

        // 加入等待队列
        return new Promise((resolve, reject) => {
            const waitEntry = {
                resolve,
                reject,
                request: lockRequest,
                timeoutId: setTimeout(() => {
                    this._removeFromWaitingQueue(lockName, waitEntry);
                    reject(new Error(`Lock acquisition timeout: ${lockName}`));
                }, waitTimeout)
            };

            if (!this.waitingQueues.has(lockName)) {
                this.waitingQueues.set(lockName, []);
            }
            
            // 按优先级插入
            const queue = this.waitingQueues.get(lockName);
            const insertIndex = queue.findIndex(e => e.request.priority < priority);
            if (insertIndex === -1) {
                queue.push(waitEntry);
            } else {
                queue.splice(insertIndex, 0, waitEntry);
            }

            // 广播获取请求
            this._broadcast({
                type: LockMessageType.ACQUIRE_REQUEST,
                payload: {
                    lockName,
                    instanceId: this.instanceId,
                    timestamp: lockRequest.timestamp,
                    priority
                }
            });
        });
    }

    /**
     * 释放锁
     * @param {string} lockToken - 锁令牌
     * @returns {Promise<boolean>}
     */
    async release(lockToken) {
        await this._ensureInitialized();

        // 查找对应的锁
        let lockName = null;
        let lockInfo = null;
        
        for (const [name, info] of this.locks) {
            if (info.token === lockToken) {
                lockName = name;
                lockInfo = info;
                break;
            }
        }

        if (!lockInfo) {
            console.warn('DistributedLock: Attempting to release unknown lock:', lockToken);
            return false;
        }

        // 处理重入锁
        if (lockInfo.reentrantCount > 1) {
            lockInfo.reentrantCount--;
            return true;
        }

        lockInfo.state = LockState.RELEASING;

        // 停止心跳
        this._stopHeartbeat(lockName);

        // 移除锁记录
        this.locks.delete(lockName);

        // 广播释放消息
        if (!this._useFallback) {
            this._broadcast({
                type: LockMessageType.RELEASE,
                payload: {
                    lockName,
                    instanceId: this.instanceId,
                    timestamp: Date.now()
                }
            });
        }

        // 通知等待队列中的下一个
        this._notifyNextWaiter(lockName);

        this._emit('lockReleased', { lockName, token: lockToken });
        
        return true;
    }

    /**
     * 续期锁
     * @param {string} lockToken - 锁令牌
     * @param {number} extensionTime - 续期时间(ms)
     * @returns {Promise<boolean>}
     */
    async extend(lockToken, extensionTime = 30000) {
        await this._ensureInitialized();

        let lockInfo = null;
        for (const info of this.locks.values()) {
            if (info.token === lockToken) {
                lockInfo = info;
                break;
            }
        }

        if (!lockInfo || lockInfo.state !== LockState.HELD) {
            return false;
        }

        lockInfo.expiresAt = Date.now() + extensionTime;
        
        // 广播心跳（包含续期信息）
        if (!this._useFallback) {
            this._broadcast({
                type: LockMessageType.HEARTBEAT,
                payload: {
                    lockName: lockInfo.lockName,
                    instanceId: this.instanceId,
                    expiresAt: lockInfo.expiresAt
                }
            });
        }

        return true;
    }

    /**
     * 强制释放锁（用于死锁恢复）
     * @param {string} lockName - 锁名称
     * @param {string} targetInstanceId - 目标实例ID
     */
    async forceRelease(lockName, targetInstanceId) {
        await this._ensureInitialized();

        this._broadcast({
            type: LockMessageType.FORCE_RELEASE,
            payload: {
                lockName,
                targetInstanceId,
                requestedBy: this.instanceId,
                timestamp: Date.now()
            }
        });

        // 从已知锁中移除
        this.knownLocks.delete(`${targetInstanceId}:${lockName}`);
        
        // 尝试通知等待队列
        this._notifyNextWaiter(lockName);
    }

    /**
     * 查询锁状态
     * @param {string} lockName - 锁名称
     * @returns {Promise<object>}
     */
    async queryLock(lockName) {
        await this._ensureInitialized();

        if (this._useFallback) {
            return {
                locked: this.locks.has(lockName),
                holder: this.locks.has(lockName) ? this.instanceId : null
            };
        }

        return new Promise((resolve) => {
            const responses = new Map();
            const timeoutId = setTimeout(() => {
                resolve({
                    lockName,
                    responses: Array.from(responses.values()),
                    localHeld: this.locks.has(lockName)
                });
            }, 1000);

            // 临时监听响应
            const handler = (event) => {
                const { type, payload } = event.data || {};
                if (type === LockMessageType.QUERY_RESPONSE && payload.lockName === lockName) {
                    responses.set(payload.instanceId, payload);
                }
            };

            this.channel.addEventListener('message', handler);

            // 广播查询
            this._broadcast({
                type: LockMessageType.QUERY,
                payload: {
                    lockName,
                    queryId: this.instanceId,
                    timestamp: Date.now()
                }
            });
        });
    }

    /**
     * 检查是否持有锁
     * @param {string} lockName - 锁名称
     */
    isHeld(lockName) {
        const lock = this.locks.get(lockName);
        return lock && lock.state === LockState.HELD;
    }

    /**
     * 获取当前持有的所有锁
     */
    getHeldLocks() {
        return Array.from(this.locks.entries())
            .filter(([_, info]) => info.state === LockState.HELD)
            .map(([name, info]) => ({
                name,
                token: info.token,
                acquiredAt: info.acquiredAt,
                expiresAt: info.expiresAt
            }));
    }

    /**
     * 添加事件监听器
     */
    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(callback);
        return () => this.off(event, callback);
    }

    /**
     * 移除事件监听器
     */
    off(event, callback) {
        const listeners = this._listeners.get(event);
        if (listeners) {
            listeners.delete(callback);
        }
    }

    /**
     * 销毁管理器
     */
    async destroy() {
        // 释放所有持有的锁
        const releasePromises = Array.from(this.locks.keys()).map(name => {
            const lock = this.locks.get(name);
            return this.release(lock.token);
        });
        await Promise.all(releasePromises);

        // 停止死锁检测
        if (this.deadlockDetector) {
            clearInterval(this.deadlockDetector);
            this.deadlockDetector = null;
        }

        // 关闭channel
        if (this.channel) {
            this.channel.close();
            this.channel = null;
        }

        this._initialized = false;
    }

    // ==================== 私有方法 ====================

    async _ensureInitialized() {
        if (!this._initialized) {
            await this.init();
        }
    }

    _broadcast(message) {
        if (this.channel && this.channel.postMessage) {
            this.channel.postMessage(message);
        }
    }

    _handleMessage(event) {
        const { type, payload } = event.data || {};
        if (!type || !payload) return;

        // 忽略自己的消息
        if (payload.instanceId === this.instanceId && 
            type !== LockMessageType.QUERY_RESPONSE) {
            return;
        }

        switch (type) {
            case LockMessageType.ACQUIRE_REQUEST:
                this._handleAcquireRequest(payload);
                break;
            case LockMessageType.ACQUIRE_RESPONSE:
                this._handleAcquireResponse(payload);
                break;
            case LockMessageType.RELEASE:
                this._handleRelease(payload);
                break;
            case LockMessageType.HEARTBEAT:
                this._handleHeartbeat(payload);
                break;
            case LockMessageType.QUERY:
                this._handleQuery(payload);
                break;
            case LockMessageType.FORCE_RELEASE:
                this._handleForceRelease(payload);
                break;
        }
    }

    _handleAcquireRequest(payload) {
        const { lockName, instanceId, timestamp, priority } = payload;

        // 如果自己持有该锁，发送响应
        if (this.locks.has(lockName)) {
            const lock = this.locks.get(lockName);
            this._broadcast({
                type: LockMessageType.ACQUIRE_RESPONSE,
                payload: {
                    lockName,
                    instanceId: this.instanceId,
                    requesterId: instanceId,
                    held: true,
                    expiresAt: lock.expiresAt,
                    priority: lock.priority
                }
            });
        }

        // 记录其他实例的锁请求
        this.knownLocks.set(`${instanceId}:${lockName}`, {
            instanceId,
            lockName,
            timestamp,
            priority,
            expiresAt: Date.now() + this.defaultTimeout
        });
    }

    _handleAcquireResponse(payload) {
        // 更新已知锁信息
        if (payload.held) {
            this.knownLocks.set(`${payload.instanceId}:${payload.lockName}`, {
                instanceId: payload.instanceId,
                lockName: payload.lockName,
                expiresAt: payload.expiresAt,
                priority: payload.priority
            });
        }
    }

    _handleRelease(payload) {
        const { lockName, instanceId } = payload;
        
        // 从已知锁中移除
        this.knownLocks.delete(`${instanceId}:${lockName}`);

        // 检查是否有等待队列
        this._notifyNextWaiter(lockName);
    }

    _handleHeartbeat(payload) {
        const { lockName, instanceId, expiresAt } = payload;
        const key = `${instanceId}:${lockName}`;
        
        const knownLock = this.knownLocks.get(key);
        if (knownLock) {
            knownLock.expiresAt = expiresAt;
            knownLock.lastHeartbeat = Date.now();
        } else {
            this.knownLocks.set(key, {
                instanceId,
                lockName,
                expiresAt,
                lastHeartbeat: Date.now()
            });
        }
    }

    _handleQuery(payload) {
        const { lockName, queryId } = payload;
        
        const held = this.locks.has(lockName);
        const lock = held ? this.locks.get(lockName) : null;

        this._broadcast({
            type: LockMessageType.QUERY_RESPONSE,
            payload: {
                lockName,
                instanceId: this.instanceId,
                queryId,
                held,
                expiresAt: lock ? lock.expiresAt : null
            }
        });
    }

    _handleForceRelease(payload) {
        const { lockName, targetInstanceId } = payload;
        
        // 如果被强制释放的是自己持有的锁
        if (targetInstanceId === this.instanceId && this.locks.has(lockName)) {
            console.warn('DistributedLock: Lock forcefully released:', lockName);
            const lock = this.locks.get(lockName);
            lock.state = LockState.EXPIRED;
            this.locks.delete(lockName);
            this._stopHeartbeat(lockName);
            this._emit('lockForceReleased', { lockName });
        }

        // 从已知锁中移除
        this.knownLocks.delete(`${targetInstanceId}:${lockName}`);
    }

    async _canAcquireLock(lockName) {
        const now = Date.now();
        
        // 检查已知锁
        for (const [key, knownLock] of this.knownLocks) {
            if (knownLock.lockName === lockName) {
                // 检查是否过期
                if (knownLock.expiresAt && knownLock.expiresAt < now) {
                    // 锁已过期，可以获取
                    this.knownLocks.delete(key);
                    continue;
                }
                // 锁仍有效
                return false;
            }
        }

        return true;
    }

    async _doAcquire(lockRequest) {
        const { lockName, timeout } = lockRequest;
        const token = this._generateToken();
        const now = Date.now();

        const lockInfo = {
            lockName,
            token,
            instanceId: this.instanceId,
            state: LockState.HELD,
            acquiredAt: now,
            expiresAt: now + timeout,
            reentrantCount: 1,
            priority: lockRequest.priority
        };

        this.locks.set(lockName, lockInfo);

        // 启动心跳
        this._startHeartbeat(lockName);

        this._emit('lockAcquired', { lockName, token });

        return token;
    }

    _generateToken() {
        return `lock-${this.instanceId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    _startHeartbeat(lockName) {
        // 清除现有心跳定时器
        this._stopHeartbeat(lockName);

        const heartbeatFn = () => {
            const lock = this.locks.get(lockName);
            if (!lock || lock.state !== LockState.HELD) {
                return;
            }

            this._broadcast({
                type: LockMessageType.HEARTBEAT,
                payload: {
                    lockName,
                    instanceId: this.instanceId,
                    expiresAt: lock.expiresAt
                }
            });
        };

        const timerId = setInterval(heartbeatFn, this.heartbeatInterval);
        this.heartbeatTimers.set(lockName, timerId);
    }

    _stopHeartbeat(lockName) {
        const timerId = this.heartbeatTimers.get(lockName);
        if (timerId) {
            clearInterval(timerId);
            this.heartbeatTimers.delete(lockName);
        }
    }

    _removeFromWaitingQueue(lockName, entry) {
        const queue = this.waitingQueues.get(lockName);
        if (queue) {
            const idx = queue.indexOf(entry);
            if (idx >= 0) {
                queue.splice(idx, 1);
            }
        }
        clearTimeout(entry.timeoutId);
    }

    _notifyNextWaiter(lockName) {
        const queue = this.waitingQueues.get(lockName);
        if (!queue || queue.length === 0) return;

        // 获取队列中的第一个
        const next = queue.shift();
        
        // 尝试获取锁
        this._canAcquireLock(lockName).then(canAcquire => {
            if (canAcquire) {
                clearTimeout(next.timeoutId);
                this._doAcquire(next.request).then(token => {
                    next.resolve(token);
                });
            } else {
                // 还不能获取，放回队列
                queue.unshift(next);
            }
        });
    }

    _startDeadlockDetection() {
        this.deadlockDetector = setInterval(() => {
            this._detectAndResolveDeadlocks();
            this._cleanupExpiredLocks();
        }, 10000); // 每10秒检测一次
    }

    _detectAndResolveDeadlocks() {
        // 简单的死锁检测：检查长时间持有的锁
        const now = Date.now();
        const maxHoldTime = 5 * 60 * 1000; // 5分钟

        for (const [key, knownLock] of this.knownLocks) {
            if (knownLock.lastHeartbeat) {
                const timeSinceHeartbeat = now - knownLock.lastHeartbeat;
                
                // 如果长时间没有心跳，可能是持有者崩溃
                if (timeSinceHeartbeat > this.heartbeatTimeout) {
                    console.warn('DistributedLock: Detected stale lock:', key);
                    this.knownLocks.delete(key);
                    this._notifyNextWaiter(knownLock.lockName);
                }
            }
        }
    }

    _cleanupExpiredLocks() {
        const now = Date.now();
        
        for (const [key, knownLock] of this.knownLocks) {
            if (knownLock.expiresAt && knownLock.expiresAt < now) {
                this.knownLocks.delete(key);
                this._notifyNextWaiter(knownLock.lockName);
            }
        }
    }

    _acquireFallback(lockName, timeout) {
        // Fallback模式：仅本地锁
        const token = this._generateToken();
        const now = Date.now();

        const lockInfo = {
            lockName,
            token,
            instanceId: this.instanceId,
            state: LockState.HELD,
            acquiredAt: now,
            expiresAt: now + timeout,
            reentrantCount: 1
        };

        this.locks.set(lockName, lockInfo);

        // 设置自动过期
        setTimeout(() => {
            if (this.locks.has(lockName) && this.locks.get(lockName).token === token) {
                this.locks.delete(lockName);
            }
        }, timeout);

        return token;
    }

    _emit(event, data) {
        const listeners = this._listeners.get(event);
        if (listeners) {
            listeners.forEach(callback => {
                try {
                    callback(data);
                } catch (e) {
                    console.error('Lock event listener error:', e);
                }
            });
        }
    }
}

/**
 * 读写锁
 * 支持多个读锁或一个写锁
 */
class ReadWriteLock {
    constructor(manager, lockName) {
        this.manager = manager;
        this.lockName = lockName;
        this.readLockName = `${lockName}:read`;
        this.writeLockName = `${lockName}:write`;
    }

    /**
     * 获取读锁
     */
    async acquireRead(options = {}) {
        return this.manager.acquire(this.readLockName, {
            ...options,
            priority: (options.priority || 0) - 1 // 读锁优先级略低
        });
    }

    /**
     * 获取写锁
     */
    async acquireWrite(options = {}) {
        return this.manager.acquire(this.writeLockName, options);
    }

    /**
     * 释放读锁
     */
    async releaseRead(token) {
        return this.manager.release(token);
    }

    /**
     * 释放写锁
     */
    async releaseWrite(token) {
        return this.manager.release(token);
    }
}

// 导出单例实例
const lockManager = new DistributedLockManager();

export { 
    DistributedLockManager, 
    ReadWriteLock, 
    lockManager,
    LockState,
    LockMessageType
};
export default lockManager;
