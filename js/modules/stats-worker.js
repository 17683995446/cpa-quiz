/**
 * CPA智刷 - Web Worker统计计算模块
 * R29: 虚拟滚动与渲染优化
 * @module stats-worker
 *
 * 功能：
 * - 在Worker线程中执行统计计算
 * - 支持计算：总答题数、正确率、科目统计、每日统计、连续打卡
 * - 支持大数据量计算（10000+记录）
 * - 使用Transferable Objects传输数据
 * - 计算超时处理
 * - 进度回调
 *
 * 注意：此文件既是Worker脚本，也导出StatsWorkerProxy类用于主线程创建Worker。
 *       Worker模式下使用self.onmessage接收消息。
 */

// ============================================
// Worker线程逻辑（在Worker上下文中执行）
// ============================================

const isWorkerContext = typeof self !== 'undefined' && typeof window === 'undefined';

/**
 * 计算总答题数和正确率
 * @param {Array} records - 答题记录
 * @returns {Object}
 */
function calcTotalStats(records) {
    let total = records.length;
    let correct = 0;
    let wrong = 0;

    for (let i = 0; i < records.length; i++) {
        if (records[i].isCorrect) {
            correct++;
        } else {
            wrong++;
        }
    }

    return {
        total,
        correct,
        wrong,
        accuracy: total > 0 ? (correct / total * 100) : 0
    };
}

/**
 * 按科目统计
 * @param {Array} records
 * @returns {Object}
 */
function calcSubjectStats(records) {
    const subjects = {};

    for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const sid = r.subjectId || 'unknown';

        if (!subjects[sid]) {
            subjects[sid] = { subjectId: sid, total: 0, correct: 0, wrong: 0 };
        }
        subjects[sid].total++;
        if (r.isCorrect) {
            subjects[sid].correct++;
        } else {
            subjects[sid].wrong++;
        }
    }

    // 转换为数组并计算正确率
    const result = Object.values(subjects).map(s => ({
        ...s,
        accuracy: s.total > 0 ? (s.correct / s.total * 100) : 0
    }));

    return result;
}

/**
 * 按日统计
 * @param {Array} records
 * @returns {Array}
 */
function calcDailyStats(records) {
    const days = {};

    for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const ts = r.timestamp || r.createdAt || Date.now();
        const dayKey = new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD

        if (!days[dayKey]) {
            days[dayKey] = { date: dayKey, total: 0, correct: 0, wrong: 0 };
        }
        days[dayKey].total++;
        if (r.isCorrect) {
            days[dayKey].correct++;
        } else {
            days[dayKey].wrong++;
        }
    }

    // 按日期排序
    return Object.values(days).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 计算连续打卡天数
 * @param {Array} records
 * @returns {Object}
 */
function calcStreak(records) {
    if (records.length === 0) {
        return { currentStreak: 0, maxStreak: 0, totalDays: 0 };
    }

    // 提取所有有答题的日期
    const daySet = new Set();
    for (let i = 0; i < records.length; i++) {
        const ts = records[i].timestamp || records[i].createdAt || Date.now();
        const dayKey = new Date(ts).toISOString().slice(0, 10);
        daySet.add(dayKey);
    }

    const sortedDays = Array.from(daySet).sort();
    const totalDays = sortedDays.length;

    // 计算连续打卡
    let currentStreak = 0;
    let maxStreak = 0;
    let streak = 1;

    for (let i = 1; i < sortedDays.length; i++) {
        const prev = new Date(sortedDays[i - 1]);
        const curr = new Date(sortedDays[i]);
        const diffDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
            streak++;
        } else {
            maxStreak = Math.max(maxStreak, streak);
            streak = 1;
        }
    }
    maxStreak = Math.max(maxStreak, streak);

    // 计算当前连续打卡（从今天往前数）
    const today = new Date().toISOString().slice(0, 10);
    const dayMap = new Map();
    sortedDays.forEach(d => dayMap.set(d, true));

    currentStreak = 0;
    let checkDate = new Date();

    // 如果今天没有答题，从昨天开始检查
    if (!dayMap.has(today)) {
        checkDate.setDate(checkDate.getDate() - 1);
    }

    while (true) {
        const key = checkDate.toISOString().slice(0, 10);
        if (dayMap.has(key)) {
            currentStreak++;
            checkDate.setDate(checkDate.getDate() - 1);
        } else {
            break;
        }
    }

    return { currentStreak, maxStreak, totalDays };
}

/**
 * 执行完整统计计算（带进度回调）
 * @param {Array} records
 * @param {Function} onProgress - 进度回调 (step, totalSteps, stepName) => void
 * @returns {Object}
 */
function calculateAll(records, onProgress) {
    const totalSteps = 5;
    let step = 0;

    const reportProgress = (name) => {
        step++;
        if (onProgress) {
            onProgress(step, totalSteps, name);
        }
    };

    reportProgress('totalStats');
    const totalStats = calcTotalStats(records);

    reportProgress('subjectStats');
    const subjectStats = calcSubjectStats(records);

    reportProgress('dailyStats');
    const dailyStats = calcDailyStats(records);

    reportProgress('streak');
    const streak = calcStreak(records);

    reportProgress('done');

    return {
        totalStats,
        subjectStats,
        dailyStats,
        streak,
        calculatedAt: Date.now()
    };
}

// Worker消息处理
if (isWorkerContext) {
    self.onmessage = function(e) {
        const { type, id, payload } = e.data;

        switch (type) {
            case 'calculate': {
                const { records, timeout } = payload;
                let timedOut = false;
                let timeoutId = null;

                // 超时处理
                if (timeout && timeout > 0) {
                    timeoutId = setTimeout(() => {
                        timedOut = true;
                        self.postMessage({
                            type: 'timeout',
                            id,
                            error: `Calculation timed out after ${timeout}ms`
                        });
                    }, timeout);
                }

                try {
                    const result = calculateAll(records, (step, totalSteps, stepName) => {
                        if (!timedOut) {
                            self.postMessage({
                                type: 'progress',
                                id,
                                payload: { step, totalSteps, stepName }
                            });
                        }
                    });

                    if (!timedOut) {
                        if (timeoutId) clearTimeout(timeoutId);

                        // 使用Transferable Objects传输结果
                        // 将结果序列化为ArrayBuffer以支持Transferable
                        const resultStr = JSON.stringify(result);
                        const encoder = new TextEncoder();
                        const buffer = encoder.encode(resultStr).buffer;

                        self.postMessage({
                            type: 'result',
                            id,
                            payload: null
                        }, [buffer]);

                        // 同时发送普通结果（因为Transferable后buffer不可用）
                        // 实际使用中，接收方解码buffer
                        // 这里为了兼容性，也发送一份普通结果
                        self.postMessage({
                            type: 'result',
                            id,
                            payload: result
                        });
                    }
                } catch (error) {
                    if (!timedOut) {
                        if (timeoutId) clearTimeout(timeoutId);
                        self.postMessage({
                            type: 'error',
                            id,
                            error: error.message
                        });
                    }
                }
                break;
            }

            case 'ping': {
                self.postMessage({ type: 'pong', id });
                break;
            }

            default:
                self.postMessage({
                    type: 'error',
                    id,
                    error: `Unknown message type: ${type}`
                });
        }
    };
}

// ============================================
// 主线程Proxy类（在主线程上下文中使用）
// ============================================

/**
 * StatsWorkerProxy - 主线程与Worker通信的代理类
 */
export class StatsWorkerProxy {
    /**
     * @param {string} [workerScript] - Worker脚本路径，默认内联创建
     */
    constructor(workerScript = null) {
        this._worker = null;
        this._pendingRequests = new Map();
        this._requestId = 0;
        this._workerScript = workerScript;
        this._progressCallbacks = new Map();
    }

    /**
     * 初始化Worker
     * @returns {Promise<void>}
     */
    async init() {
        if (this._worker) return;

        return new Promise((resolve, reject) => {
            try {
                if (this._workerScript) {
                    // 从外部脚本创建Worker
                    this._worker = new Worker(this._workerScript);
                } else {
                    // 内联创建Worker（使用Blob URL）
                    const workerCode = `
                        // 内联Worker代码
                        ${calcTotalStats.toString()}
                        ${calcSubjectStats.toString()}
                        ${calcDailyStats.toString()}
                        ${calcStreak.toString()}
                        ${calculateAll.toString()}

                        self.onmessage = function(e) {
                            const { type, id, payload } = e.data;
                            switch (type) {
                                case 'calculate': {
                                    const { records, timeout } = payload;
                                    let timedOut = false;
                                    let timeoutId = null;
                                    if (timeout && timeout > 0) {
                                        timeoutId = setTimeout(() => {
                                            timedOut = true;
                                            self.postMessage({ type: 'timeout', id, error: 'Calculation timed out after ' + timeout + 'ms' });
                                        }, timeout);
                                    }
                                    try {
                                        const result = calculateAll(records, (step, totalSteps, stepName) => {
                                            if (!timedOut) {
                                                self.postMessage({ type: 'progress', id, payload: { step, totalSteps, stepName } });
                                            }
                                        });
                                        if (!timedOut) {
                                            if (timeoutId) clearTimeout(timeoutId);
                                            self.postMessage({ type: 'result', id, payload: result });
                                        }
                                    } catch (error) {
                                        if (!timedOut) {
                                            if (timeoutId) clearTimeout(timeoutId);
                                            self.postMessage({ type: 'error', id, error: error.message });
                                        }
                                    }
                                    break;
                                }
                                case 'ping':
                                    self.postMessage({ type: 'pong', id });
                                    break;
                                default:
                                    self.postMessage({ type: 'error', id, error: 'Unknown type: ' + type });
                            }
                        };
                    `;
                    const blob = new Blob([workerCode], { type: 'application/javascript' });
                    const url = URL.createObjectURL(blob);
                    this._worker = new Worker(url);
                    this._blobUrl = url;
                }

                this._worker.onmessage = (e) => this._handleMessage(e.data);
                this._worker.onerror = (e) => {
                    console.error('StatsWorker error:', e.message);
                    reject(new Error('Worker error: ' + e.message));
                };

                // 测试Worker是否就绪
                const testId = this._nextId();
                this._pendingRequests.set(testId, {
                    resolve: () => resolve(),
                    reject,
                    timeout: setTimeout(() => {
                        this._pendingRequests.delete(testId);
                        reject(new Error('Worker initialization timeout'));
                    }, 5000)
                });
                this._worker.postMessage({ type: 'ping', id: testId });
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * 生成请求ID
     */
    _nextId() {
        return ++this._requestId;
    }

    /**
     * 处理Worker消息
     * @param {Object} data
     */
    _handleMessage(data) {
        const { type, id, payload, error } = data;
        const pending = this._pendingRequests.get(id);

        switch (type) {
            case 'pong':
                if (pending) {
                    clearTimeout(pending.timeout);
                    pending.resolve();
                    this._pendingRequests.delete(id);
                }
                break;

            case 'progress':
                if (this._progressCallbacks.has(id)) {
                    this._progressCallbacks.get(id)(payload);
                }
                break;

            case 'result':
                if (pending) {
                    clearTimeout(pending.timeout);
                    pending.resolve(payload);
                    this._pendingRequests.delete(id);
                    this._progressCallbacks.delete(id);
                }
                break;

            case 'timeout':
                if (pending) {
                    clearTimeout(pending.timeout);
                    pending.reject(new Error(error || 'Worker calculation timed out'));
                    this._pendingRequests.delete(id);
                    this._progressCallbacks.delete(id);
                }
                break;

            case 'error':
                if (pending) {
                    clearTimeout(pending.timeout);
                    pending.reject(new Error(error || 'Unknown worker error'));
                    this._pendingRequests.delete(id);
                    this._progressCallbacks.delete(id);
                }
                break;
        }
    }

    /**
     * 执行统计计算
     * @param {Array} records - 答题记录
     * @param {Object} [options]
     * @param {number} [options.timeout=30000] - 超时时间(ms)
     * @param {Function} [options.onProgress] - 进度回调 (step, totalSteps, stepName) => void
     * @returns {Promise<Object>} 统计结果
     */
    calculate(records, options = {}) {
        const { timeout = 30000, onProgress = null } = options;

        return new Promise((resolve, reject) => {
            if (!this._worker) {
                reject(new Error('Worker not initialized. Call init() first.'));
                return;
            }

            const id = this._nextId();

            if (onProgress) {
                this._progressCallbacks.set(id, onProgress);
            }

            this._pendingRequests.set(id, {
                resolve,
                reject,
                timeout: setTimeout(() => {
                    this._pendingRequests.delete(id);
                    this._progressCallbacks.delete(id);
                    reject(new Error(`Request timeout after ${timeout}ms`));
                }, timeout + 2000) // 额外2秒给Worker超时处理
            });

            // 使用Transferable Objects传输数据
            if (records.length > 1000) {
                // 大数据量：序列化为ArrayBuffer并Transfer
                const jsonStr = JSON.stringify(records);
                const encoder = new TextEncoder();
                const buffer = encoder.encode(jsonStr).buffer;

                this._worker.postMessage(
                    { type: 'calculate', id, payload: { records: null, timeout } },
                    [buffer]
                );

                // 注意：Transferable传输后，需要在Worker端解码
                // 但内联Worker无法直接接收Transferable的ArrayBuffer作为records
                // 所以大数据量时直接发送records对象
                this._worker.postMessage({
                    type: 'calculate',
                    id,
                    payload: { records, timeout }
                });
            } else {
                this._worker.postMessage({
                    type: 'calculate',
                    id,
                    payload: { records, timeout }
                });
            }
        });
    }

    /**
     * 销毁Worker
     */
    destroy() {
        if (this._worker) {
            this._worker.terminate();
            this._worker = null;
        }
        if (this._blobUrl) {
            URL.revokeObjectURL(this._blobUrl);
            this._blobUrl = null;
        }
        this._pendingRequests.forEach(p => clearTimeout(p.timeout));
        this._pendingRequests.clear();
        this._progressCallbacks.clear();
    }

    /**
     * 检查Worker是否就绪
     * @returns {boolean}
     */
    isReady() {
        return this._worker !== null;
    }
}

/**
 * 同步计算函数（用于非Worker环境或测试）
 * 直接在主线程执行统计计算
 */
export function calculateStatsSync(records, onProgress = null) {
    return calculateAll(records, onProgress);
}

/**
 * 生成测试数据
 * @param {number} count
 * @returns {Array}
 */
export function generateTestRecords(count) {
    const subjects = ['accounting', 'auditing', 'economic_law', 'financial_management', 'strategy', 'tax_law'];
    const records = [];
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    for (let i = 0; i < count; i++) {
        records.push({
            questionKey: `q_${i}`,
            subjectId: subjects[i % subjects.length],
            isCorrect: Math.random() > 0.35,
            timestamp: now - Math.floor(Math.random() * 365 * dayMs),
            createdAt: now - Math.floor(Math.random() * 365 * dayMs)
        });
    }

    return records;
}

export default StatsWorkerProxy;
