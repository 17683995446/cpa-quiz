/**
 * CPA智刷 - 主应用逻辑
 * 管理页面导航、刷题、考试、错题本、收藏、笔记、统计等全部功能
 * 
 * R26重构：使用IndexedDB模块化存储系统
 * R27新增：PWA离线支持功能
 */

// ============================================
// 导入存储模块
// ============================================
import { storageSystem, storageCompat } from './modules/index.js';
import { offlineManager } from './modules/offline-manager.js';

// 等待存储系统初始化
await storageSystem.init({
    onProgress: (progress, message) => {
        console.log(`[初始化] ${Math.round(progress * 100)}%: ${message}`);
    }
});

// 使用兼容层Storage API
const Storage = storageCompat;

// ============================================
// R27: 注册Service Worker
// ============================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            console.log('[App] Service Worker registered:', registration.scope);
            
            // 监听Service Worker更新
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        // 新版本可用
                        showToast('新版本可用，刷新页面后生效', 'info', 5000);
                    }
                });
            });
        } catch (error) {
            console.error('[App] Service Worker registration failed:', error);
        }
    });
}

// ============================================
// R27: 初始化离线管理器
// ============================================
await offlineManager.init();
console.log('[App] OfflineManager initialized');

// 监听离线管理器事件
offlineManager.on('online', () => {
    console.log('[App] Network is online');
});

offlineManager.on('offline', () => {
    console.log('[App] Network is offline');
});

offlineManager.on('syncCompleted', (result) => {
    console.log('[App] Sync completed:', result);
    // 刷新统计数据
    if (AppState.currentPage === 'home') {
        renderProgressOverview();
    } else if (AppState.currentPage === 'stats') {
        renderStats();
    }
});

offlineManager.on('pendingCountChanged', ({ count }) => {
    console.log('[App] Pending answers:', count);
});

// ============================================
// 工具函数 - 修复R22-016：提取重复代码
// ============================================

/**
 * 解析题目key，返回{subjectId, questionId}或null
 * @param {string} key - 题目key，格式为"subjectId_questionId"
 * @returns {object|null} - {subjectId, questionId}或null
 */
function parseQuestionKey(key) {
    const keyParts = String(key || '').split('_');
    if (keyParts.length < 2) {
        console.warn('无效的题目key格式:', key);
        return null;
    }
    const qId = parseInt(keyParts[1]);
    if (isNaN(qId)) {
        console.warn('无效的题目ID:', keyParts[1]);
        return null;
    }
    return { subjectId: keyParts[0], questionId: qId };
}

/**
 * 解析答案字符串为字母数组
 * 修复R22-015：提取重复的答案解析逻辑为工具函数
 * @param {string} answer - 逗号分隔的答案字母，如 "A,B,C"
 * @returns {string[]} 字母数组
 */
function _parseAnswerLetters(answer) {
    return String(answer || '').split(',').map(a => a.trim()).filter(Boolean);
}

/**
 * 清理考试定时器
 * 修复R22-017：提取重复的定时器清理逻辑
 */
function cleanupExamTimer() {
    if (AppState.examTimer) {
        clearInterval(AppState.examTimer);
        AppState.examTimer = null;
    }
}

// ============================================
// 常量定义 - 慢工出细活修复#R9-001/R9-033：提取魔法数字为命名常量
// ============================================
const CONSTANTS = {
    MS_PER_DAY: 24 * 60 * 60 * 1000,        // 一天的毫秒数
    MS_PER_SECOND: 1000,                     // 一秒的毫秒数
    DEFAULT_QUIZ_COUNT: 50,                  // 默认刷题数量
    DAILY_QUIZ_COUNT: 10,                    // 每日一练题目数
    DAILY_HISTORY_DAYS: 30,                  // 每日历史保留天数
    SEARCH_RESULTS_LIMIT: 50,                // 搜索结果限制
    RANKING_MAX_USERS: 2000,                 // 排行榜最大用户数
    NOTE_MAX_LENGTH: 2000,                   // 笔记最大长度
    TAG_MAX_LENGTH: 100,                     // 标签最大长度
    SEARCH_MIN_LENGTH: 2,                    // 搜索最小长度
    SEARCH_MAX_LENGTH: 50,                   // 搜索最大长度
    DEBOUNCE_NAVIGATION: 150,                // 导航防抖时间(ms)
    DEBOUNCE_SELECTION: 200,                 // 选项选择防抖时间(ms)
    EXAM_SAVE_INTERVAL: 10,                  // 考试状态保存间隔(秒)
    DAILY_COMPLETION_RATE: 0.8,              // 每日一练完成率要求(80%)
    ANSWER_FLUSH_INTERVAL: 500,              // 答题缓存刷写间隔(ms)
    ANSWER_FLUSH_MAX_SIZE: 20                // 答题缓存最大条目数（超过立即刷写）
};

// ============================================
// 全局状态
// ============================================
const AppState = {
    currentPage: 'home',
    currentSubject: null,
    currentChapter: null,
    quizQuestions: [],
    quizIndex: 0,
    quizAnswers: {},
    quizMode: 'practice', // practice, exam, wrong, favorites, daily
    examTimer: null,
    examTimeLeft: 0,
    dailyCompleted: false,
    noteEditingQuestion: null,
    // 修复BUG-015：多选题临时选择状态
    quizTempSelections: {},
    // 修复BUG-011：保存搜索关键词用于后退恢复
    lastSearchKeyword: null
};

// ============================================
// 答题缓存队列 - 修复R23-003：减少频繁localStorage写入
// 将多次答题记录合并为单次批量写入，显著提升性能
// ============================================
const AnswerBuffer = {
    _buffer: new Map(),       // 缓存的答题记录 {questionKey: {isCorrect, userAnswer, timestamp}}
    _timer: null,             // 延迟刷写定时器
    _flushing: false,         // 是否正在刷写（防止重入）
    
    /**
     * 添加答题记录到缓存
     * @param {string} questionKey - 题目key
     * @param {boolean} isCorrect - 是否正确
     * @param {string} userAnswer - 用户答案
     */
    add(questionKey, isCorrect, userAnswer) {
        this._buffer.set(questionKey, {
            isCorrect,
            userAnswer,
            timestamp: Date.now()
        });
        
        // 超过最大缓存条目数时立即刷写
        if (this._buffer.size >= CONSTANTS.ANSWER_FLUSH_MAX_SIZE) {
            this.flush();
            return;
        }
        
        // 延迟刷写
        if (!this._timer) {
            this._timer = setTimeout(() => {
                this.flush();
            }, CONSTANTS.ANSWER_FLUSH_INTERVAL);
        }
    },
    
    /**
     * 立即刷写缓存到localStorage
     * @returns {boolean} 是否成功刷写
     */
    flush() {
        if (this._flushing || this._buffer.size === 0) return false;
        
        // 清除定时器
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        
        this._flushing = true;
        try {
            const batch = new Map(this._buffer);
            this._buffer.clear();
            
            Storage.update('answers', (answers) => {
                batch.forEach((value, key) => {
                    answers[key] = value;
                });
                return answers;
            }, {});
            
            return true;
        } catch (e) {
            console.error('AnswerBuffer flush error:', e);
            return false;
        } finally {
            this._flushing = false;
        }
    },
    
    /**
     * 获取缓存大小
     */
    get size() {
        return this._buffer.size;
    },
    
    /**
     * 检查缓存中是否有指定key
     */
    has(questionKey) {
        return this._buffer.has(questionKey);
    },
    
    /**
     * 获取缓存中的记录
     */
    get(questionKey) {
        return this._buffer.get(questionKey) || null;
    },
    
    /**
     * 清空缓存（不写入localStorage）
     */
    clear() {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        this._buffer.clear();
    }
};

// ============================================
// 页面导航 - 修复浏览器后退按钮支持
// ============================================
function navigate(page, params = {}, addToHistory = true) {
    const prevPage = AppState.currentPage;
    // 修复高危缺陷：参数类型检查
    if (typeof page !== 'string' || !page) {
        console.error('navigate: page must be a non-empty string');
        page = 'home';
    }
    if (typeof params !== 'object' || params === null) {
        console.warn('navigate: params should be an object, using empty object');
        params = {};
    }
    if (typeof addToHistory !== 'boolean') {
        addToHistory = Boolean(addToHistory);
    }
    
    // 验证page是否在有效列表中
    const validPages = ['home','subjects','quiz','exam','exam-taking','wrong','favorites','notes','stats','daily','search','ranking'];
    if (!validPages.includes(page)) {
        console.error(`navigate: invalid page "${page}"`);
        page = 'home';
    }
    
    
    // 修复BUG-012：页面切换时关闭模态框
    const noteModal = document.getElementById('noteModal');
    if (noteModal) noteModal.classList.remove('show');
    // 修复BUG-R10-013：页面切换时关闭移动端侧边栏
    closeMobileMenu();
    
    // 考试模式下切换到非考试页面时，先确认
    if (AppState.examTimer && page !== 'exam-taking') {
        if (!confirm('考试正在进行中，确定要离开吗？离开后考试将结束。')) {
            // 清理DebounceLock中的相关锁
            DebounceLock.clearAll();
            return;
        }
        cleanupExamTimer(); // 修复R22-017：使用工具函数清理定时器
        Storage.set('exam_state', null); // 清除考试状态
    }
    
    // 隐藏所有页面
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    
    // 更新导航高亮
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const activeLink = document.querySelector(`.nav-link[data-page="${page}"]`);
    if (activeLink) activeLink.classList.add('active');
    // 子页面保持父级导航高亮
    if (page === 'quiz' || page === 'subjects') {
        document.querySelector('[data-page="subjects"]')?.classList.add('active');
    }
    if (page === 'exam-taking' || page === 'exam') {
        document.querySelector('[data-page="exam"]')?.classList.add('active');
    }
    
    AppState.currentPage = page;
    
    // 修复BUG-R10-009：页面切换时更新document.title
    const pageTitles = {
        home: 'CPA智刷 - 首页',
        subjects: 'CPA智刷 - 科目列表',
        quiz: 'CPA智刷 - 刷题练习',
        exam: 'CPA智刷 - 模拟考试',
        'exam-taking': 'CPA智刷 - 考试中',
        wrong: 'CPA智刷 - 错题本',
        favorites: 'CPA智刷 - 收藏夹',
        notes: 'CPA智刷 - 学习笔记',
        stats: 'CPA智刷 - 学习统计',
        daily: 'CPA智刷 - 每日一练',
        search: 'CPA智刷 - 搜索结果',
        ranking: 'CPA智刷 - 排行榜'
    };
    document.title = pageTitles[page] || 'CPA智刷';
    
    // 修复高危缺陷R18-002：使用prevPage（旧页面）而非currentPage（已被覆盖为新页面）
    const quizPages = ['quiz', 'exam-taking'];
    if (!quizPages.includes(page)) {
        if (prevPage && quizPages.includes(prevPage)) {
            AppState.quizTempSelections = {};
            AppState.noteEditingQuestion = null;
        }
    }
    
    // 显示目标页面
    const targetPage = document.getElementById(`page-${page}`);
    if (targetPage) {
        targetPage.classList.add('active');
    }
    
    // 滚动到顶部
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    // 添加到浏览器历史记录（修复后退按钮）
    if (addToHistory && page !== 'exam-taking') {
        const state = { page, params, timestamp: Date.now() };
        history.pushState(state, '', `#${page}`);
    }
    
    // 根据页面类型渲染内容
    switch (page) {
        case 'home':
            renderHome();
            break;
        case 'subjects':
            if (params.subjectId) {
                AppState.currentSubject = params.subjectId;
                renderSubjectDetail(params.subjectId);
            } else {
                renderSubjects();
            }
            break;
        case 'quiz':
            startQuiz(params);
            break;
        case 'exam':
            renderExamSetup();
            break;
        case 'exam-taking':
            startExam(params);
            break;
        case 'wrong':
            renderWrongBook();
            break;
        case 'favorites':
            renderFavorites();
            break;
        case 'notes':
            renderNotes();
            break;
        case 'stats':
            renderStats();
            break;
        case 'daily':
            renderDaily();
            break;
        case 'ranking':
            renderRanking();
            break;
        case 'search':
            renderSearchResults(params.keyword);
            break;
    }
}

// ============================================
// 首页渲染
// ============================================
function renderHome() {
    renderSubjectGrid();
    renderProgressOverview();
}

function renderSubjectGrid() {
    const grid = document.getElementById('subjectGrid');
    if (!grid) return;
    
    // 修复高危缺陷R19-003：将Storage.getStats()提到循环外，避免重复localStorage读取
    const stats = Storage.getStats();
    
    let html = '';
    Object.values(SUBJECTS_CONFIG).forEach(subject => {
        const questions = getSubjectQuestions(subject.id);
        const total = questions.length;
        const subjectStat = stats.subjectStats[subject.id] || { answered: 0, correct: 0 };
        const progress = total > 0 ? Math.round((subjectStat.answered / total) * 100) : 0;
        // 修复中危缺陷：限制correctRate上限100%，防止数据损坏时显示异常
        const correctRate = subjectStat.answered > 0 
            ? Math.min(100, Math.round((subjectStat.correct / subjectStat.answered) * 100)) 
            : 0;
        
        html += `
            <div class="subject-card" role="button" tabindex="0" onclick="navigate('subjects', {subjectId: '${subject.id}'})" onkeydown="if(event.key==='Enter')navigate('subjects',{subjectId:'${subject.id}'})">
                <div style="position:absolute;top:0;left:0;right:0;height:4px;background:${subject.gradient};pointer-events:none"></div>
                <div class="subject-card-header">
                    <div class="subject-icon" style="background:${subject.gradient}">
                        <i class="${subject.icon}"></i>
                    </div>
                    <div>
                        <h3>${subject.name}</h3>
                        <div class="question-count">${total} 题 · 正确率 ${correctRate}%</div>
                    </div>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-info">
                        <span>学习进度</span>
                        <span>${subjectStat.answered}/${total}</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width:${progress}%;background:${subject.gradient}"></div>
                    </div>
                </div>
                <div class="subject-tags">
                    ${(() => {
                        // 修复性能缺陷R22-001：单次遍历统计题型数量，避免3次filter
                        const typeCount = questions.reduce((acc, q) => {
                            acc[q.type] = (acc[q.type] || 0) + 1;
                            return acc;
                        }, {});
                        return `
                            <span class="subject-tag">单选 ${typeCount.single || 0}</span>
                            <span class="subject-tag">多选 ${typeCount.multi || 0}</span>
                            <span class="subject-tag">判断 ${typeCount.judge || 0}</span>
                        `;
                    })()}
                </div>
            </div>
        `;
    });
    
    grid.innerHTML = html;
}

function renderProgressOverview() {
    const container = document.getElementById('progressOverview');
    if (!container) return;
    
    const stats = Storage.getStats();
    const correctRate = stats.totalAnswered > 0 ? Math.round((stats.totalCorrect / stats.totalAnswered) * 100) : 0;
    const wrongCount = Storage.getWrongQuestions().length;
    const favCount = Storage.getFavorites().length;
    
    container.innerHTML = `
        <div class="progress-card">
            <div class="number">${stats.totalAnswered}</div>
            <div class="label">已答题数</div>
        </div>
        <div class="progress-card">
            <div class="number" style="color:var(--success)">${correctRate}%</div>
            <div class="label">正确率</div>
        </div>
        <div class="progress-card">
            <div class="number" style="color:var(--danger)">${wrongCount}</div>
            <div class="label">错题数</div>
        </div>
        <div class="progress-card">
            <div class="number" style="color:var(--warning)">${favCount}</div>
            <div class="label">收藏数</div>
        </div>
        <div class="progress-card">
            <div class="number" style="color:#8b5cf6">${stats.dailyStreak}</div>
            <div class="label">连续打卡天数</div>
        </div>
    `;
}

// ============================================
// 科目列表/详情
// ============================================
function renderSubjects() {
    const detail = document.getElementById('subjectDetail');
    if (!detail) return;
    
    let html = `
        <div class="subject-detail-header">
            <button class="back-btn" onclick="navigate('home')"><i class="fas fa-arrow-left"></i></button>
            <div class="subject-detail-info">
                <h2>选择科目</h2>
                <p>共6个科目，点击进入章节列表</p>
            </div>
        </div>
        <div class="chapter-list">
    `;
    
    Object.values(SUBJECTS_CONFIG).forEach(subject => {
        const count = getSubjectQuestions(subject.id).length;
        html += `
            <div class="chapter-item" onclick="navigate('subjects', {subjectId: '${subject.id}'})">
                <div class="chapter-item-left">
                    <div class="chapter-num" style="background:${subject.gradient};color:white">
                        <i class="${subject.icon}"></i>
                    </div>
                    <div>
                        <div class="chapter-name">${subject.name}</div>
                        <div style="font-size:13px;color:var(--gray-500);margin-top:4px">${subject.description}</div>
                    </div>
                </div>
                <div class="chapter-meta">
                    <span><i class="fas fa-question-circle"></i> ${count}题</span>
                    <i class="fas fa-chevron-right" style="color:var(--gray-400)"></i>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    detail.innerHTML = html;
}

function renderSubjectDetail(subjectId) {
    const detail = document.getElementById('subjectDetail');
    if (!detail) return;
    
    // 修复：检查科目是否存在
    const subject = SUBJECTS_CONFIG[subjectId];
    if (!subject) {
        showToast('科目不存在', 'error');
        navigate('subjects');
        return;
    }
    
    const chapters = getSubjectChapters(subjectId);
    const questions = getSubjectQuestions(subjectId);
    const stats = Storage.getStats(); // 修复R19-004：提到循环外
    
    let html = `
        <div class="subject-detail-header">
            <button class="back-btn" onclick="navigate('subjects')"><i class="fas fa-arrow-left"></i></button>
            <div class="subject-detail-info">
                <h2><i class="${subject.icon}" style="color:${subject.color};margin-right:8px"></i>${subject.name}</h2>
                <p>${subject.description} · 共${questions.length}题 · ${chapters.length}个章节</p>
            </div>
            <button class="btn btn-primary" onclick="startRandomQuiz('${subjectId}')">
                <i class="fas fa-random"></i> 随机刷题
            </button>
        </div>
        <div class="chapter-list">
    `;
    
    chapters.forEach((chapter, index) => {
        // 修复高危缺陷R19-004：将Storage.getStats()提到循环外
        const subjectStat = stats.subjectStats[subjectId] || { answered: 0 };
        // 慢工出细活修复#R9-011：使用escapeHtml处理章节名，再转义单引号
        const safeChapterName = escapeHtml(chapter.name).replace(/'/g, "\\'");
        html += `
            <div class="chapter-item" onclick="startChapterQuiz('${subjectId}', '${safeChapterName}')">
                <div class="chapter-item-left">
                    <div class="chapter-num">${index + 1}</div>
                    <div>
                        <div class="chapter-name">${escapeHtml(chapter.name)}</div>
                        <div style="font-size:12px;color:var(--gray-400);margin-top:2px">${chapter.sections.slice(0, 3).map(s => escapeHtml(s)).join('、')}</div>
                    </div>
                </div>
                <div class="chapter-meta">
                    <span><i class="fas fa-question-circle"></i> ${chapter.count}题</span>
                    <i class="fas fa-chevron-right" style="color:var(--gray-400)"></i>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    detail.innerHTML = html;
}

// ============================================
// 刷题核心
// ============================================
function startRandomQuiz(subjectId) {
    const questions = getRandomQuestions(subjectId, CONSTANTS.DEFAULT_QUIZ_COUNT);
    if (questions.length === 0) {
        showToast('该科目暂无题目', 'warning');
        return;
    }
    // 第一性原理修复BUG-003：彻底清理残留状态
    cleanupExamTimer(); // 修复R22-017：使用工具函数清理定时器
    AppState.quizQuestions = questions;
    AppState.quizIndex = 0;
    AppState.quizAnswers = {};
    AppState.quizTempSelections = {}; // 清理多选题临时状态
    AppState.quizMode = 'practice';
    AppState.currentSubject = subjectId;
    AppState.examTimeLeft = 0; // 清理残留考试时间
    navigate('quiz');
}

function startChapterQuiz(subjectId, chapterName) {
    const questions = getQuestionsByChapter(subjectId, chapterName);
    if (questions.length === 0) {
        showToast('该章节暂无题目', 'warning');
        return;
    }
    // 按id排序，保证刷新后题目顺序稳定
    questions.sort((a, b) => a.id - b.id);
    // 第一性原理修复BUG-003：彻底清理残留状态
    cleanupExamTimer(); // 修复R22-017：使用工具函数清理定时器
    AppState.quizQuestions = questions;
    AppState.quizIndex = 0;
    AppState.quizAnswers = {};
    AppState.quizTempSelections = {}; // 清理多选题临时状态
    AppState.quizMode = 'practice';
    AppState.currentSubject = subjectId;
    AppState.examTimeLeft = 0; // 清理残留考试时间
    navigate('quiz');
}

function startQuiz(params) {
    renderQuizQuestion();
}

function renderQuizQuestion() {
    const container = document.getElementById('quizContainer');
    // 第一性原理修复BUG-021：题目数量为0时显示友好提示
    if (!container) return;
    if (AppState.quizQuestions.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:60px 24px">
                <i class="fas fa-inbox" style="font-size:64px;color:var(--gray-400);margin-bottom:16px"></i>
                <h3>暂无题目</h3>
                <p style="color:var(--gray-500);margin-top:8px">当前条件下没有可练习的题目</p>
                <button class="btn btn-primary" style="margin-top:24px" onclick="navigate('subjects')">
                    <i class="fas fa-arrow-left"></i> 返回科目列表
                </button>
            </div>
        `;
        return;
    }

    // 移除可能残留的多选题确认按钮
    const existingBtn = document.getElementById('confirmMultiBtn');
    if (existingBtn) existingBtn.remove();

    // 修复高危缺陷R20-013：检查题目索引是否越界
    const question = AppState.quizQuestions[AppState.quizIndex];
    if (!question) {
        console.error('题目索引越界:', AppState.quizIndex, '总数:', AppState.quizQuestions.length);
        showToast('题目数据异常', 'error');
        return;
    }
    const total = AppState.quizQuestions.length;
    const current = AppState.quizIndex + 1;
    const subjectId = question._subjectId || AppState.currentSubject;
    const questionKey = `${subjectId}_${question.id}`;
    // 修复BUG-014：错题复习模式下忽略历史记录，允许重新作答
    const answerRecord = (AppState.quizMode === 'wrong') ? null : Storage.getAnswerRecord(questionKey);
    const isFav = Storage.isFavorite(questionKey);
    const answered = AppState.quizAnswers[questionKey];
    
    let html = `
        <div class="quiz-header">
            <div class="quiz-header-left">
                <button class="back-btn" onclick="exitQuiz()"><i class="fas fa-arrow-left"></i></button>
                <span class="quiz-progress-text">${current} / ${total}</span>
            </div>
            <div class="quiz-header-right">
                <button class="btn btn-sm btn-outline-dark" onclick="toggleQuizNav()">
                    <i class="fas fa-th"></i> 题目导航
                </button>
            </div>
        </div>
        
        <div id="quizNavPanel" style="display:none" class="quiz-nav-panel">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <span style="font-weight:600;color:var(--gray-700)">题目导航</span>
                <span style="font-size:13px;color:var(--gray-500)">
                    <span style="display:inline-block;width:12px;height:12px;background:var(--success);border-radius:3px;margin-right:4px"></span>正确
                    <span style="display:inline-block;width:12px;height:12px;background:var(--danger);border-radius:3px;margin-left:8px;margin-right:4px"></span>错误
                    <span style="display:inline-block;width:12px;height:12px;background:var(--primary);border-radius:3px;margin-left:8px;margin-right:4px"></span>当前
                </span>
            </div>
            <div class="quiz-nav-grid">
    `;
    
    // 慢工出细活修复#R9-015：批量读取答题记录，避免循环中重复访问localStorage
    const answersData = Storage.get('answers', {});
    
    for (let i = 0; i < total; i++) {
        const q = AppState.quizQuestions[i];
        const qSubjectId = q._subjectId || AppState.currentSubject;
        const key = `${qSubjectId}_${q.id}`;
        // 直接从内存对象读取，而非调用Storage.getAnswerRecord
        const record = answersData[key];
        const ans = AppState.quizAnswers[key];
        let cls = 'quiz-nav-item';
        if (i === AppState.quizIndex) cls += ' current';
        else if (ans !== undefined) {
            cls += ans.isCorrect ? ' answered' : ' wrong-item';
        } else if (record) {
            cls += record.isCorrect ? ' answered' : ' wrong-item';
        }
        html += `<div class="${cls}" onclick="jumpToQuestion(${i})">${i + 1}</div>`;
    }
    
    html += `</div></div>`;
    
    // 题目卡片
    html += `
        <div class="quiz-question-card">
            <div class="quiz-question-meta">
                <span class="quiz-badge badge-type">${getTypeText(question.type)}</span>
                <span class="quiz-badge badge-difficulty" style="background:${getDifficultyColor(question.difficulty)}20;color:${getDifficultyColor(question.difficulty)}">
                    ${getDifficultyText(question.difficulty)}
                </span>
                <span class="quiz-badge badge-chapter">${escapeHtml(question.chapter)}</span>
                ${question.year ? `<span class="quiz-badge badge-chapter">${escapeHtml(String(question.year))}年</span>` : ''}
            </div>
            <div class="quiz-question-text">${current}. ${escapeHtml(question.question)}</div>
            <div class="quiz-options">
    `;
    
    if (question.type === 'judge') {
        const opts = ['对', '错'];
        opts.forEach((opt, i) => {
            const letter = opt === '对' ? 'A' : 'B';
            let cls = 'quiz-option';
            if (answered !== undefined) {
                cls += ' disabled';
                if (opt === question.answer) cls += ' correct';
                if (opt === answered.userAnswer && opt !== question.answer) cls += ' wrong';
            } else if (answerRecord) {
                cls += ' disabled';
                if (opt === question.answer) cls += ' correct';
                if (opt === answerRecord.userAnswer && opt !== question.answer) cls += ' wrong';
            } else {
                cls += `" onclick="selectOption('${opt}', this)`;
            }
            html += `
                <div class="${cls}">
                    <span class="option-letter">${letter}</span>
                    <span>${opt === '对' ? '正确' : '错误'}</span>
                </div>
            `;
        });
    } else {
        const options = question.options || [];
        options.forEach((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            let cls = 'quiz-option';
            if (answered !== undefined) {
                cls += ' disabled';
                // 修复R22-015：提取重复的答案解析逻辑
                const correctAnswers = _parseAnswerLetters(question.answer);
                const userAnswers = _parseAnswerLetters(answered.userAnswer);
                if (correctAnswers.includes(letter)) cls += ' correct';
                if (userAnswers.includes(letter) && !correctAnswers.includes(letter)) cls += ' wrong';
            } else if (answerRecord) {
                cls += ' disabled';
                // 修复R22-015：提取重复的答案解析逻辑
                const correctAnswers = _parseAnswerLetters(question.answer);
                const userAnswers = _parseAnswerLetters(answerRecord.userAnswer);
                if (correctAnswers.includes(letter)) cls += ' correct';
                if (userAnswers.includes(letter) && !correctAnswers.includes(letter)) cls += ' wrong';
            } else {
                // 修复BUG-015：恢复多选题临时选择状态
                const tempSel = AppState.quizTempSelections[questionKey];
                if (question.type === 'multi' && tempSel) {
                    const tempLetters = tempSel.split(',').map(a => a.trim());
                    if (tempLetters.includes(letter)) cls += ' selected';
                }
                cls += `" onclick="selectOption('${letter}', this)`;
            }
            html += `
                <div class="${cls}">
                    <span class="option-letter">${letter}</span>
                    <span>${escapeHtml(opt.replace(/^[A-D][.、．]\s*/, ''))}</span>
                </div>
            `;
        });
    }

    html += '</div>';

    // 解析
    const showExplanation = answered !== undefined || answerRecord;
    if (showExplanation) {
        // 修复高危缺陷R20-001：answerRecord可能为null，添加空值检查
        const isCorrect = answered ? answered.isCorrect : (answerRecord ? answerRecord.isCorrect : false);
        html += `
            <div class="quiz-explanation ${isCorrect ? '' : 'wrong-answer'}">
                <h4 class="${isCorrect ? 'correct' : 'wrong'}">
                    <i class="fas fa-${isCorrect ? 'check-circle' : 'times-circle'}"></i>
                    ${isCorrect ? '回答正确！' : '回答错误'}
                </h4>
                <div class="answer-text">
                    <strong>正确答案：${escapeHtml(question.answer)}</strong><br><br>
                    ${escapeHtml(question.explanation)}
                </div>
                ${question.key_point ? `<div class="key-point"><i class="fas fa-key"></i> 核心考点：${escapeHtml(question.key_point)}</div>` : ''}
            </div>
        `;
    }
    
    html += '</div>';
    
    // 操作栏
    html += `
        <div class="quiz-actions">
            <div class="quiz-actions-left">
                <button class="quiz-action-btn ${isFav ? 'favorited' : ''}" onclick="toggleFavorite('${questionKey}')">
                    <i class="fas fa-star"></i> ${isFav ? '已收藏' : '收藏'}
                </button>
                <button class="quiz-action-btn" onclick="openNoteModal('${questionKey}', ${question.id})">
                    <i class="fas fa-sticky-note"></i> 笔记
                </button>
            </div>
            <div class="quiz-actions-right">
                <button class="btn btn-sm btn-outline-dark" onclick="prevQuestion()" ${current <= 1 ? 'disabled style="opacity:0.5"' : ''}>
                    <i class="fas fa-arrow-left"></i> 上一题
                </button>
                ${current < total ? `
                    <button class="btn btn-sm btn-primary" onclick="nextQuestion()">
                        下一题 <i class="fas fa-arrow-right"></i>
                    </button>
                ` : `
                    <button class="btn btn-sm btn-success" onclick="finishQuiz()">
                        <i class="fas fa-check"></i> 完成
                    </button>
                `}
            </div>
        </div>
    `;
    
    container.innerHTML = html;
}

// 防抖锁：防止快速重复点击导致的竞态条件
// 修复高危缺陷：DebounceLock添加刷新机制和清理方法，防止定时器泄漏
const DebounceLock = {
    locks: new Map(),
    MAX_LOCKS: 100, // 修复R23-004：最大锁容量限制，防止内存泄漏
    isLocked(key, timeout = 300) {
        // 修复R23-004：超过容量限制时清理最旧的锁
        if (this.locks.size >= this.MAX_LOCKS && !this.locks.has(key)) {
            const oldestKey = this.locks.keys().next().value;
            clearTimeout(this.locks.get(oldestKey));
            this.locks.delete(oldestKey);
        }
        if (this.locks.has(key)) {
            // 刷新现有定时器，防止重复创建
            clearTimeout(this.locks.get(key));
            this.locks.set(key, setTimeout(() => this.locks.delete(key), timeout));
            return true;
        }
        this.locks.set(key, setTimeout(() => this.locks.delete(key), timeout));
        return false;
    },
    clear(key) {
        if (this.locks.has(key)) {
            clearTimeout(this.locks.get(key));
            this.locks.delete(key);
        }
    },
    clearAll() {
        this.locks.forEach(timer => clearTimeout(timer));
        this.locks.clear();
    }
};

function selectOption(letter, element) {
    // 防抖：防止快速点击导致的竞态条件
    const lockKey = `select_${AppState.quizIndex}`;
    if (DebounceLock.isLocked(lockKey, 200)) {
        console.log('点击过快，请稍候');
        return;
    }
    
    const question = AppState.quizQuestions[AppState.quizIndex];
    if (!question) return;
    
    const subjectId = question._subjectId || AppState.currentSubject;
    const questionKey = `${subjectId}_${question.id}`;
    
    // 检查是否已经答过题（防止重复提交）
    if (AppState.quizAnswers[questionKey]) {
        return;
    }
    
    let userAnswer = letter;
    
    // 多选题：切换选择
    if (question.type === 'multi') {
        // 修复BUG-015：使用临时状态跟踪选择，切换题目后不丢失
        const tempSelection = AppState.quizTempSelections[questionKey] || '';
        let selectedLetters = tempSelection ? tempSelection.split(',') : [];
        
        if (element.classList.contains('selected')) {
            element.classList.remove('selected');
            const idx = selectedLetters.indexOf(letter);
            if (idx >= 0) selectedLetters.splice(idx, 1);
        } else {
            element.classList.add('selected');
            selectedLetters.push(letter);
        }
        
        if (selectedLetters.length === 0) {
            // 移除确认按钮
            const confirmBtn = document.getElementById('confirmMultiBtn');
            if (confirmBtn) confirmBtn.remove();
            delete AppState.quizTempSelections[questionKey];
            return;
        }
        
        userAnswer = selectedLetters.sort().join(',');
        
        // 保存临时选择状态
        AppState.quizTempSelections[questionKey] = userAnswer;
        
        // 更新或创建确认按钮
        let confirmBtn = document.getElementById('confirmMultiBtn');
        if (!confirmBtn) {
            const actionsRight = document.querySelector('.quiz-actions-right');
            if (actionsRight) {
                confirmBtn = document.createElement('button');
                confirmBtn.id = 'confirmMultiBtn';
                confirmBtn.className = 'btn btn-sm btn-success';
                confirmBtn.innerHTML = '<i class="fas fa-check"></i> 确认提交';
                actionsRight.insertBefore(confirmBtn, actionsRight.firstChild);
            }
        }
        // 更新按钮点击事件（使用闭包捕获当前userAnswer）
        if (confirmBtn) {
            confirmBtn.onclick = () => {
                if (!DebounceLock.isLocked(`submit_${questionKey}`, 500)) {
                    // 提交后清除临时选择
                    delete AppState.quizTempSelections[questionKey];
                    submitAnswer(questionKey, userAnswer);
                }
            };
        }
        return;
    }
    
    // 单选题和判断题直接提交
    submitAnswer(questionKey, userAnswer);
}

function submitAnswer(questionKey, userAnswer) {
    // 修复R23-005：添加防抖保护，防止快速点击导致竞态条件
    if (DebounceLock.isLocked(`submit_${questionKey}`, 500)) return;

    const question = AppState.quizQuestions[AppState.quizIndex];
    
    // 修复：检查题目是否存在
    if (!question) {
        showToast('题目数据异常', 'error');
        console.error('题目不存在:', AppState.quizIndex);
        return;
    }
    
    // 修复：安全类型转换
    const correctAnswer = String(question.answer || '').trim();
    const isCorrect = String(userAnswer || '').trim() === correctAnswer;
    const subjectId = question._subjectId || AppState.currentSubject;
    
    // 第一性原理修复BUG-015：检查是否已答过此题，避免重复统计
    const previousAnswer = AppState.quizAnswers[questionKey];
    const isReanswer = previousAnswer !== undefined;
    
    
    AppState.quizAnswers[questionKey] = { isCorrect, userAnswer };
    Storage.setAnswerRecord(questionKey, isCorrect, userAnswer);
    
    // R27: 添加到离线同步队列
    const answerData = {
        questionKey: questionKey,
        subjectId: subjectId,
        questionId: question.id,
        userAnswer: userAnswer,
        isCorrect: isCorrect,
        timestamp: Date.now(),
        timeSpent: 0
    };
    
    // 异步添加到离线队列（不阻塞UI）
    offlineManager.queueAnswer(answerData).catch(error => {
        console.error('[App] Failed to queue answer:', error);
    });
    
    // 只有首次答题或答案改变时才更新统计
    // 修复中危缺陷R19-013：错题复习模式下不重复统计，防止数据虚高
    if (!isReanswer || previousAnswer.isCorrect !== isCorrect) {
        if (!isReanswer && AppState.quizMode !== 'wrong') {
            Storage.updateStats(isCorrect, subjectId);
        }
    }
    
    if (!isCorrect) {
        Storage.addWrongQuestion(questionKey, subjectId);
    } else {
        Storage.removeWrongQuestion(questionKey);
    }
    
    renderQuizQuestion();
}

function nextQuestion() {
    // 慢工出细活修复#R9-029：添加防抖锁防止快速点击
    if (DebounceLock.isLocked('nav', 150)) return;
    if (AppState.quizIndex < AppState.quizQuestions.length - 1) {
        AppState.quizIndex++;
        renderQuizQuestion();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function prevQuestion() {
    // 慢工出细活修复#R9-029：添加防抖锁防止快速点击
    if (DebounceLock.isLocked('nav', 150)) return;
    if (AppState.quizIndex > 0) {
        AppState.quizIndex--;
        renderQuizQuestion();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function jumpToQuestion(index) {
    // 修复中危缺陷R19-032：添加防抖保护，与nextQuestion/prevQuestion保持一致
    if (DebounceLock.isLocked('nav', 150)) return;
    // 修复：验证索引有效性
    const maxIndex = AppState.quizQuestions.length - 1;
    if (typeof index !== 'number' || index < 0 || index > maxIndex) {
        console.warn(`无效的题目索引: ${index}, 有效范围: 0-${maxIndex}`);
        return;
    }
    AppState.quizIndex = index;
    renderQuizQuestion();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleQuizNav() {
    const panel = document.getElementById('quizNavPanel');
    if (!panel) return;
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function exitQuiz() {
    if (confirm('确定要退出刷题吗？当前进度已保存。')) {
        if (AppState.quizMode === 'wrong') navigate('wrong');
        else if (AppState.quizMode === 'favorites') navigate('favorites');
        else if (AppState.quizMode === 'daily') navigate('daily');
        else if (AppState.currentSubject) navigate('subjects', { subjectId: AppState.currentSubject });
        else navigate('home');
    }
}

function finishQuiz() {
    // 修复R24：结束前先刷写答题缓存
    Storage.flushAnswerBuffer();
    // 修复BUG-FQ-003：清理考试状态残留
    cleanupExamTimer(); // 修复R22-017：使用工具函数清理定时器
    AppState.examTimeLeft = 0;
    AppState.examTotalTime = 0;
    
    // 修复BUG-007：每日一练至少答完80%才算完成打卡
    if (AppState.quizMode === 'daily') {
        const total = AppState.quizQuestions.length;
        const answered = Object.keys(AppState.quizAnswers).length;
        const completionRate = total > 0 ? answered / total : 0;
        if (completionRate >= 0.8) {
            Storage.setDailyCompleted();
        } else {
            showToast(`还需答完${Math.ceil(total * 0.8) - answered}题才能完成今日打卡`, 'warning');
        }
    }
    
    const answers = Object.values(AppState.quizAnswers);
    const total = AppState.quizQuestions.length;
    const answered = answers.length;
    const correct = answers.filter(a => a.isCorrect).length;
    const rate = answered > 0 ? Math.round((correct / answered) * 100) : 0;
    
    
    const container = document.getElementById('quizContainer');
    container.innerHTML = `
        <div class="exam-result">
            <div class="exam-result-card">
                <div class="exam-score-circle ${rate >= 60 ? 'pass' : 'fail'}">
                    ${rate}%
                    <div class="score-label">正确率</div>
                </div>
                <h2 style="margin-bottom:8px">${rate >= 60 ? '🎉 表现不错！' : '💪 继续加油！'}</h2>
                <p style="color:var(--gray-500);margin-bottom:24px">本次共答${answered}题，正确${correct}题</p>
                <div class="exam-result-stats">
                    <div class="exam-result-stat">
                        <div class="number" style="color:var(--primary)">${total}</div>
                        <div class="label">总题数</div>
                    </div>
                    <div class="exam-result-stat">
                        <div class="number" style="color:var(--success)">${correct}</div>
                        <div class="label">正确</div>
                    </div>
                    <div class="exam-result-stat">
                        <div class="number" style="color:var(--danger)">${answered - correct}</div>
                        <div class="label">错误</div>
                    </div>
                </div>
                <div class="exam-result-actions">
                    <button class="btn btn-outline-dark" onclick="navigate('home')">
                        <i class="fas fa-home"></i> 返回首页
                    </button>
                    <button class="btn btn-primary" onclick="reviewWrongAnswers()">
                        <i class="fas fa-redo"></i> 查看错题
                    </button>
                    <button class="btn btn-success" onclick="navigate('subjects', {subjectId: '${AppState.currentSubject}'})">
                        <i class="fas fa-book"></i> 继续刷题
                    </button>
                </div>
            </div>
        </div>
    `;
}

function reviewWrongAnswers() {
    const wrongQuestions = AppState.quizQuestions.filter(q => {
        const qSubjectId = q._subjectId || AppState.currentSubject;
        const key = `${qSubjectId}_${q.id}`;
        const ans = AppState.quizAnswers[key];
        return ans && !ans.isCorrect;
    });
    
    if (wrongQuestions.length === 0) {
        showToast('没有错题，太棒了！', 'success');
        return;
    }
    
    AppState.quizQuestions = wrongQuestions;
    AppState.quizIndex = 0;
    AppState.quizAnswers = {};
    AppState.quizMode = 'wrong';
    renderQuizQuestion();
}

// ============================================
// 收藏
// ============================================
function toggleFavorite(questionKey) {
    // 修复BUG-026：从当前题目获取正确的subjectId，而非依赖AppState.currentSubject
    const question = AppState.quizQuestions[AppState.quizIndex];
    const subjectId = question?._subjectId || AppState.currentSubject;
    const isFav = Storage.toggleFavorite(questionKey, subjectId);
    showToast(isFav ? '已添加到收藏夹' : '已取消收藏', isFav ? 'success' : 'warning');
    renderQuizQuestion();
}

// ============================================
// 笔记
// ============================================
function openNoteModal(questionKey, questionId) {
    AppState.noteEditingQuestion = questionKey;
    const modal = document.getElementById('noteModal');
    const preview = document.getElementById('noteQuestionPreview');
    const content = document.getElementById('noteContent');
    const tags = document.getElementById('noteTags');
    
    // 修复BUG-038：使用_subjectId属性查找题目，支持跨科目场景
    const question = AppState.quizQuestions.find(q => {
        const qSubjectId = q._subjectId || AppState.currentSubject;
        return `${qSubjectId}_${q.id}` === questionKey;
    });
    if (question) {
        // 修复中危缺陷：使用safeSubstring防止非字符串错误
        const qText = String(question.question || '');
        preview.textContent = qText.substring(0, 100) + (qText.length > 100 ? '...' : '');
    }
    
    const existingNote = Storage.getNotes().find(n => n.key === questionKey);
    if (existingNote) {
        content.value = existingNote.content;
        tags.value = existingNote.tags.join(', ');
    } else {
        content.value = '';
        tags.value = '';
    }
    
    modal.classList.add('show');
}

function closeNoteModal() {
    const modal = document.getElementById('noteModal');
    if (modal) modal.classList.remove('show');
}

function saveNote() {
    const content = document.getElementById('noteContent').value.trim();
    const tags = document.getElementById('noteTags').value.trim();
    
    if (!content) {
        showToast('请输入笔记内容', 'warning');
        return;
    }
    
    // 修复：验证笔记长度
    if (content.length > 2000) {
        showToast('笔记内容不能超过2000字', 'warning');
        return;
    }
    
    // 修复：验证标签长度
    if (tags.length > 100) {
        showToast('标签不能超过100字', 'warning');
        return;
    }
    
    if (!AppState.noteEditingQuestion) {
        showToast('无法保存笔记：题目信息缺失', 'error');
        return;
    }
    
    Storage.saveNote(AppState.noteEditingQuestion, content, tags);
    showToast('笔记保存成功', 'success');
    closeNoteModal();
}

// ============================================
// 模拟考试
// ============================================
function renderExamSetup() {
    const container = document.getElementById('examSetup');
    let subjectOptions = '';
    Object.values(SUBJECTS_CONFIG).forEach(s => {
        subjectOptions += `<option value="${s.id}">${s.name} (${getSubjectQuestions(s.id).length}题)</option>`;
    });
    
    container.innerHTML = `
        <div class="exam-config-card">
            <h3><i class="fas fa-cog" style="color:var(--primary);margin-right:8px"></i>考试设置</h3>
            <div class="form-group">
                <label>选择科目</label>
                <select id="examSubject">${subjectOptions}</select>
            </div>
            <div class="form-group">
                <label>题目数量</label>
                <select id="examCount">
                    <option value="20">20题（快速）</option>
                    <option value="50" selected>50题（标准）</option>
                    <option value="100">100题（完整）</option>
                </select>
            </div>
            <div class="form-group">
                <label>考试时间（分钟）</label>
                <select id="examTime">
                    <option value="30">30分钟</option>
                    <option value="60" selected>60分钟</option>
                    <option value="90">90分钟</option>
                    <option value="120">120分钟</option>
                </select>
            </div>
            <div class="form-group">
                <label>难度筛选</label>
                <select id="examDifficulty">
                    <option value="all">全部难度</option>
                    <option value="1">简单</option>
                    <option value="2">较易</option>
                    <option value="3" selected>中等</option>
                    <option value="4">较难</option>
                    <option value="5">困难</option>
                </select>
            </div>
            <button class="btn btn-primary btn-lg" style="width:100%;justify-content:center;margin-top:16px" onclick="startExamFromSetup()">
                <i class="fas fa-play"></i> 开始考试
            </button>
        </div>
    `;
}

function startExamFromSetup() {
    // 修复高危缺陷H-001：添加null检查，防止DOM元素不存在时崩溃
    const subjectEl = document.getElementById('examSubject');
    const countEl = document.getElementById('examCount');
    const timeEl = document.getElementById('examTime');
    const diffEl = document.getElementById('examDifficulty');
    
    if (!subjectEl || !countEl || !timeEl || !diffEl) {
        showToast('考试设置加载失败，请刷新页面', 'error');
        return;
    }
    
    const subjectId = subjectEl.value;
    const count = parseInt(countEl.value);
    const time = parseInt(timeEl.value);
    const difficulty = diffEl.value;
    
    startExam({ subjectId, count, time, difficulty });
}

function startExam(params) {
    const { subjectId, count = 50, time = 60, difficulty = 'all', resume = false } = params;
    
    
    // 恢复模式：从localStorage恢复考试状态
    if (resume) {
        const savedState = Storage.get('exam_state');
        // 修复严重缺陷C-001：Storage.get()已自动解包data字段，直接使用savedState
        if (savedState && savedState.questions) {
            AppState.quizQuestions = savedState.questions || [];
            AppState.quizIndex = savedState.index || 0;
            AppState.quizAnswers = savedState.answers || {};
            AppState.quizMode = 'exam';
            AppState.currentSubject = savedState.subjectId;
            AppState.examTimeLeft = savedState.timeLeft || 0;
            AppState.examTotalTime = savedState.totalTime || 3600;
            
    // 修复高危缺陷R19-007/008：移除直接DOM操作，依赖navigate()处理页面切换
    // navigate('exam-taking', params)已在switch中调用，此处只负责设置状态和启动计时器
            
            // 启动计时器
            startExamTimer();
            renderExamQuestion();
            showToast('已恢复上次考试进度', 'info');
            return;
        }
    }
    
    const filters = {};
    if (difficulty !== 'all') filters.difficulty = parseInt(difficulty);
    
    const questions = getRandomQuestions(subjectId, count, filters);
    if (questions.length === 0) {
        showToast('没有符合条件的题目', 'warning');
        return;
    }
    
    AppState.quizQuestions = questions;
    AppState.quizIndex = 0;
    AppState.quizAnswers = {};
    AppState.quizMode = 'exam';
    AppState.currentSubject = subjectId;
    AppState.examTimeLeft = time * 60;
    AppState.examTotalTime = time * 60;
    
    // 保存初始考试状态（用于恢复）
    saveExamState();
    
    // 修复高危缺陷R19-007/008：移除直接DOM操作，依赖navigate()处理页面切换
    
    // 启动计时器
    startExamTimer();
    renderExamQuestion();
}

// 保存考试状态到localStorage
function saveExamState() {
    if (AppState.quizMode !== 'exam') return;
    
    // 修复R24：保存考试状态前先刷写答题缓存
    Storage.flushAnswerBuffer();
    
    const state = {
        questions: AppState.quizQuestions,
        index: AppState.quizIndex,
        answers: AppState.quizAnswers,
        subjectId: AppState.currentSubject,
        timeLeft: AppState.examTimeLeft,
        totalTime: AppState.examTotalTime,
        savedAt: Date.now()
    };
    Storage.set('exam_state', state);
}

function startExamTimer() {
    // 修复高危缺陷R19-009：移除DebounceLock，依赖内部clearInterval保护即可
    // DebounceLock可能阻止快速操作场景下的计时器启动
    
    
    if (AppState.examTimer) {
        clearInterval(AppState.examTimer);
        AppState.examTimer = null;
    }
    
    
    // 修复高危缺陷：使用独立timerState避免闭包持有整个AppState
    const timerState = {
        startTime: Date.now(),
        initialTimeLeft: AppState.examTimeLeft,
        saveCounter: 0
    };
    
    AppState.examTimer = setInterval(() => {
        // 计算实际经过的秒数
        const elapsedSeconds = Math.floor((Date.now() - timerState.startTime) / 1000);
        AppState.examTimeLeft = Math.max(0, timerState.initialTimeLeft - elapsedSeconds);
        
        updateExamTimerDisplay();
        
        // 定期保存考试状态
        timerState.saveCounter++;
        if (timerState.saveCounter >= 10) {
            saveExamState();
            timerState.saveCounter = 0;
        }
        
        // 修复：确保时间不为负数，处理NaN情况
        if (AppState.examTimeLeft <= 0 || isNaN(AppState.examTimeLeft)) {
            AppState.examTimeLeft = 0;
            clearInterval(AppState.examTimer);
            AppState.examTimer = null;
            Storage.set('exam_state', null);
            finishExam(true); // 修复R19-010：时间耗尽自动交卷
        }
    }, 1000);
}

function updateExamTimerDisplay() {
    const timerEl = document.getElementById('examTimer');
    if (!timerEl) return;
    
    const minutes = Math.floor(AppState.examTimeLeft / 60);
    const seconds = AppState.examTimeLeft % 60;
    timerEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    
    if (AppState.examTimeLeft <= 300) {
        timerEl.parentElement?.classList.add('warning'); // 修复中危缺陷R20-016：添加可选链，防止parentElement不存在
    }
}

function renderExamQuestion() {
    const container = document.getElementById('examTakingContainer');
    // 修复中危缺陷R19-044：添加空题目检查，与renderQuizQuestion保持一致
    if (!container) return;
    if (AppState.quizQuestions.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:60px 24px">
                <i class="fas fa-inbox" style="font-size:64px;color:var(--gray-400);margin-bottom:16px"></i>
                <h3>暂无题目</h3>
                <p style="color:var(--gray-500);margin-top:8px">考试数据异常</p>
                <button class="btn btn-primary" style="margin-top:24px" onclick="navigate('exam')">
                    <i class="fas fa-arrow-left"></i> 返回考试设置
                </button>
            </div>
        `;
        return;
    }
    const question = AppState.quizQuestions[AppState.quizIndex];
    const total = AppState.quizQuestions.length;
    const current = AppState.quizIndex + 1;
    const subjectId = question._subjectId || AppState.currentSubject;
    const questionKey = `${subjectId}_${question.id}`;
    const answered = AppState.quizAnswers[questionKey];
    
    let html = `
        <div class="exam-top-bar">
            <div class="exam-timer">
                <i class="fas fa-clock"></i>
                <span id="examTimer">${String(Math.floor(AppState.examTimeLeft / 60)).padStart(2, '0')}:${String(AppState.examTimeLeft % 60).padStart(2, '0')}</span>
            </div>
            <div class="exam-progress-info">
                ${current} / ${total} · 已答 ${Object.keys(AppState.quizAnswers).length} 题
            </div>
            <button class="btn btn-sm btn-danger" onclick="finishExam()">
                <i class="fas fa-flag-checkered"></i> 交卷
            </button>
        </div>
        
        <div class="quiz-question-card">
            <div class="quiz-question-meta">
                <span class="quiz-badge badge-type">${getTypeText(question.type)}</span>
                <span class="quiz-badge badge-difficulty" style="background:${getDifficultyColor(question.difficulty)}20;color:${getDifficultyColor(question.difficulty)}">
                    ${getDifficultyText(question.difficulty)}
                </span>
                <span class="quiz-badge badge-chapter">${escapeHtml(question.chapter)}</span>
            </div>
            <div class="quiz-question-text">${current}. ${escapeHtml(question.question)}</div>
            <div class="quiz-options">
    `;
    
    if (question.type === 'judge') {
        const opts = ['对', '错'];
        opts.forEach((opt, i) => {
            const letter = opt === '对' ? 'A' : 'B';
            let cls = 'quiz-option';
            // 修复BUG-013：只对实际选中的选项添加selected类
            if (answered && answered.userAnswer === opt) cls += ' selected';
            html += `
                <div class="${cls}" onclick="examSelectOption('${opt}', this)">
                    <span class="option-letter">${letter}</span>
                    <span>${opt === '对' ? '正确' : '错误'}</span>
                </div>
            `;
        });
    } else {
        const options = question.options || [];
        options.forEach((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            let cls = 'quiz-option';
            // 修复高危缺陷H-003：确保userAnswer是字符串再调用includes
            if (answered && typeof answered.userAnswer === 'string' && answered.userAnswer.includes(letter)) cls += ' selected';
            html += `
                <div class="${cls}" onclick="examSelectOption('${letter}', this)">
                    <span class="option-letter">${letter}</span>
                    <span>${escapeHtml(opt.replace(/^[A-D][.、．]\s*/, ''))}</span>
                </div>
            `;
        });
    }

    html += '</div></div>';

    // 考试模式底部操作栏
    html += `
        <div class="quiz-actions">
            <div class="quiz-actions-left">
                <button class="btn btn-sm btn-outline-dark" onclick="prevExamQuestion()" ${current <= 1 ? 'disabled style="opacity:0.5"' : ''}>
                    <i class="fas fa-arrow-left"></i> 上一题
                </button>
            </div>
            <div class="quiz-actions-right">
                ${current < total ? `
                    <button class="btn btn-sm btn-primary" onclick="nextExamQuestion()">
                        下一题 <i class="fas fa-arrow-right"></i>
                    </button>
                ` : `
                    <button class="btn btn-sm btn-success" onclick="finishExam()">
                        <i class="fas fa-check"></i> 交卷
                    </button>
                `}
            </div>
        </div>
    `;
    
    container.innerHTML = html;
    updateExamTimerDisplay();
}

function examSelectOption(letter, element) {
    const question = AppState.quizQuestions[AppState.quizIndex];
    
    // 修复：检查题目是否存在
    if (!question) {
        showToast('题目数据异常', 'error');
        return;
    }
    
    const subjectId = question._subjectId || AppState.currentSubject;
    const questionKey = `${subjectId}_${question.id}`;
    
    if (question.type === 'multi') {
        // 多选切换
        if (element.classList.contains('selected')) {
            element.classList.remove('selected');
        } else {
            element.classList.add('selected');
        }
        
        // 修复BUG-030：限定选择器范围到考试容器内
        const selected = [];
        document.querySelectorAll('#examTakingContainer .quiz-option.selected').forEach(opt => {
            const letterEl = opt.querySelector('.option-letter');
            if (letterEl) selected.push(letterEl.textContent);
        });
        
        const userAnswer = selected.sort().join(',');
        // 修复高危缺陷R15-002：添加isCorrect字段，与练习模式保持一致
        const isCorrect = String(userAnswer).trim() === String(question.answer || '').trim();
        AppState.quizAnswers[questionKey] = { userAnswer, isCorrect };
    } else {
        // 修复BUG-R10-042：限定选择器范围到考试容器内
        document.querySelectorAll('#examTakingContainer .quiz-option').forEach(opt => opt.classList.remove('selected'));
        element.classList.add('selected');
        // 修复高危缺陷R15-002：添加isCorrect字段
        const isCorrect = String(letter).trim() === String(question.answer || '').trim();
        AppState.quizAnswers[questionKey] = { userAnswer: letter, isCorrect };
    }
    
    
    // 修复：考试模式下即时保存答案，防止崩溃丢失
    saveExamState();
}

function nextExamQuestion() {
    // 修复中危缺陷R19-033：添加防抖保护，与练习模式保持一致
    if (DebounceLock.isLocked('nav', 150)) return;
    if (AppState.quizIndex < AppState.quizQuestions.length - 1) {
        AppState.quizIndex++;
        renderExamQuestion();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function prevExamQuestion() {
    // 修复中危缺陷R19-033：添加防抖保护，与练习模式保持一致
    if (DebounceLock.isLocked('nav', 150)) return;
    if (AppState.quizIndex > 0) {
        AppState.quizIndex--;
        renderExamQuestion();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function finishExam(autoSubmit = false) {
    // 修复高危缺陷R19-010：自动交卷时跳过确认，防止用户取消后考试卡死
    if (!autoSubmit && !confirm('确定要交卷吗？交卷后不可修改答案。')) return;
    
    // 修复R24：交卷前先刷写答题缓存，确保数据完整
    Storage.flushAnswerBuffer();
    
    // 修复：先清除定时器再处理
    if (AppState.examTimer) {
        clearInterval(AppState.examTimer);
        AppState.examTimer = null;
    }
    
    // 计算分数
    let correct = 0;
    let total = AppState.quizQuestions.length;
    
    // 修复：确保total不为0
    if (total === 0) {
        showToast('考试数据异常', 'error');
        navigate('exam');
        return;
    }
    
    // 修复BUG-R10-020：批量计算后在内存中一次性写入，避免逐题多次localStorage操作
    // 修复R22-004：合并重复遍历，单次遍历完成所有计算
    const batchAnswers = {};
    const batchStats = { totalAnswered: 0, totalCorrect: 0 };
    const batchWrongAdd = [];
    const batchWrongRemove = [];
    const batchSubjectStats = {};
    
    AppState.quizQuestions.forEach(q => {
        const qSubjectId = q._subjectId || AppState.currentSubject;
        const key = `${qSubjectId}_${q.id}`;
        const ans = AppState.quizAnswers[key];
        if (ans && ans.userAnswer && q.answer) {
            const isCorrect = String(ans.userAnswer).trim() === String(q.answer).trim();
            if (isCorrect) correct++;
            batchAnswers[key] = { isCorrect, userAnswer: ans.userAnswer, timestamp: Date.now() };
            batchStats.totalAnswered++;
            if (isCorrect) batchStats.totalCorrect++;
            if (!isCorrect) {
                batchWrongAdd.push({ key, subjectId: qSubjectId });
            } else {
                batchWrongRemove.push(key);
            }
            // 修复R15-013：在单次遍历中同时计算科目级统计
            if (!batchSubjectStats[qSubjectId]) {
                batchSubjectStats[qSubjectId] = { answered: 0, correct: 0 };
            }
            batchSubjectStats[qSubjectId].answered++;
            if (isCorrect) batchSubjectStats[qSubjectId].correct++;
        }
    });
    
    // 批量写入答题记录
    if (Object.keys(batchAnswers).length > 0) {
        Storage.update('answers', (answers) => {
            Object.assign(answers, batchAnswers);
            return answers;
        }, {});
    }
    
    // 批量更新统计
    if (batchStats.totalAnswered > 0) {
        Storage.updateStats(batchStats.totalCorrect, batchStats.totalAnswered);
    }
    
    // 修复R15-013：考试答题也要更新科目级统计
    // 修复R22-004：使用已计算的batchSubjectStats，避免重复遍历
    if (Object.keys(batchSubjectStats).length > 0) {
        Storage.update('stats', (stats) => {
            if (!stats || typeof stats !== 'object') return stats;
            if (!stats.subjectStats) stats.subjectStats = {};
            for (const [subjectId, subjectStat] of Object.entries(batchSubjectStats)) {
                if (!stats.subjectStats[subjectId]) {
                    stats.subjectStats[subjectId] = { answered: 0, correct: 0 };
                }
                stats.subjectStats[subjectId].answered += subjectStat.answered;
                stats.subjectStats[subjectId].correct += subjectStat.correct;
            }
            return stats;
        }, {});
    }
    
    // 批量更新错题本
    if (batchWrongAdd.length > 0) {
        Storage.update('wrong_questions', (wrong) => {
            batchWrongAdd.forEach(item => {
                if (!wrong.find(w => w.key === item.key)) {
                    wrong.push({ key: item.key, subjectId: item.subjectId, addedAt: Date.now() });
                }
            });
            return wrong;
        }, []);
    }
    if (batchWrongRemove.length > 0) {
        Storage.update('wrong_questions', (wrong) => {
            const removeKeys = new Set(batchWrongRemove);
            return wrong.filter(w => !removeKeys.has(w.key));
        }, []);
    }
    
    
    const score = Math.round((correct / total) * 100);
    const answered = Object.keys(AppState.quizAnswers).length;
    const timeUsed = Math.max(0, (AppState.examTotalTime ?? 3600) - (AppState.examTimeLeft ?? 0));
    const minutes = Math.floor(timeUsed / 60);
    const seconds = timeUsed % 60;
    
    
    const container = document.getElementById('examTakingContainer');
    container.innerHTML = `
        <div class="exam-result">
            <div class="exam-result-card">
                <div class="exam-score-circle ${score >= 60 ? 'pass' : 'fail'}">
                    ${score}
                    <div class="score-label">得分</div>
                </div>
                <h2 style="margin-bottom:8px">${score >= 60 ? '🎉 恭喜通过！' : '💪 再接再厉！'}</h2>
                <p style="color:var(--gray-500);margin-bottom:24px">
                    用时 ${minutes}分${seconds}秒 · 答对 ${correct}/${total} 题
                </p>
                <div class="exam-result-stats">
                    <div class="exam-result-stat">
                        <div class="number" style="color:var(--primary)">${answered}</div>
                        <div class="label">已答题数</div>
                    </div>
                    <div class="exam-result-stat">
                        <div class="number" style="color:var(--success)">${correct}</div>
                        <div class="label">正确题数</div>
                    </div>
                    <div class="exam-result-stat">
                        <div class="number" style="color:var(--danger)">${answered - correct}</div>
                        <div class="label">错误题数</div>
                    </div>
                </div>
                <div class="exam-result-actions">
                    <button class="btn btn-outline-dark" onclick="navigate('home')">
                        <i class="fas fa-home"></i> 返回首页
                    </button>
                    <button class="btn btn-primary" onclick="reviewExamAnswers()">
                        <i class="fas fa-eye"></i> 查看解析
                    </button>
                </div>
            </div>
        </div>
    `;
}

function reviewExamAnswers() {
    // 修复高危缺陷R19-011：使用'wrong'模式复用已有逻辑，移除无用的'exam_review'
    // quizMode='wrong'会让renderQuizQuestion忽略历史记录，只显示本次考试答案
    AppState.quizMode = 'wrong';
    AppState.quizIndex = 0;
    // 保留quizAnswers用于显示解析
    navigate('quiz');
}

// ============================================
// 错题本
// ============================================
// 修复高危缺陷R14-023：添加分页支持，优化大数据量渲染性能
// 全局状态管理错题本分页
const WrongBookState = {
    currentPage: 1,
    pageSize: 50
};

function renderWrongBook(filterSubject = 'all', page = 1) {
    const container = document.getElementById('wrongBook');
    const wrongList = Storage.getWrongQuestions();
    
    // 更新分页状态
    WrongBookState.currentPage = page;
    
    let html = `
        <div class="filter-bar">
            <select id="wrongFilter" onchange="filterWrongQuestions()">
                <option value="all">全部科目</option>
    `;
    
    Object.values(SUBJECTS_CONFIG).forEach(s => {
        html += `<option value="${s.id}" ${filterSubject === s.id ? 'selected' : ''}>${s.name}</option>`;
    });
    
    html += `
            </select>
            <span class="count-badge">共 ${wrongList.length} 道错题</span>
            <button class="btn btn-sm btn-danger" onclick="clearWrongQuestions()" style="margin-left:auto">
                <i class="fas fa-trash"></i> 清空错题本
            </button>
        </div>
    `;
    
    let filtered = wrongList;
    if (filterSubject !== 'all') {
        filtered = wrongList.filter(w => w.subjectId === filterSubject);
    }
    
    if (filtered.length === 0) {
        html += `
            <div class="empty-state">
                <i class="fas fa-check-circle" style="color:var(--success)"></i>
                <h3>太棒了，没有错题！</h3>
                <p>继续保持，你很棒！</p>
                <button class="btn btn-primary" onclick="navigate('subjects')">
                    <i class="fas fa-book"></i> 去刷题
                </button>
            </div>
        `;
    } else {
        // 分页计算
        const totalPages = Math.ceil(filtered.length / WrongBookState.pageSize);
        const startIndex = (page - 1) * WrongBookState.pageSize;
        const endIndex = Math.min(startIndex + WrongBookState.pageSize, filtered.length);
        const paginated = filtered.slice(startIndex, endIndex);
        
        html += `<div class="wrong-list">`;
        
        paginated.forEach(item => {
            const questions = getSubjectQuestions(item.subjectId);
            
            // 修复R22-016：使用工具函数解析题目key
            const parsed = parseQuestionKey(item.key);
            if (!parsed) return;
            const { questionId: qId } = parsed;
            
            const question = questions.find(q => q.id === qId);
            if (!question) return;
            
            // 修复：检查科目是否存在
            const subject = SUBJECTS_CONFIG[item.subjectId];
            if (!subject) {
                console.warn('科目不存在:', item.subjectId);
                return;
            }
            
            html += `
                <div class="wrong-item" onclick="reviewWrongQuestion('${item.subjectId}', ${qId})">
                    <div class="wrong-item-header">
                        <div class="question-text">${question.question.length > 80 ? escapeHtml(question.question.substring(0, 80)) + '...' : escapeHtml(question.question)}</div>
                        <button class="btn btn-sm btn-outline-dark" onclick="event.stopPropagation();removeWrongQuestion('${item.key}')">
                            <i class="fas fa-check"></i> 已掌握
                        </button>
                    </div>
                    <div class="wrong-item-meta">
                        <span><i class="fas fa-book" style="color:${subject.color}"></i> ${subject.name}</span>
                        <span><i class="fas fa-tag"></i> ${escapeHtml(question.chapter)}</span>
                        <span><i class="fas fa-clock"></i> ${item.addedAt ? new Date(item.addedAt).toLocaleDateString() : '未知时间'}</span>
                    </div>
                </div>
            `;
        });
        
        html += `</div>`;
        
        // 添加分页控件
        if (totalPages > 1) {
            html += `<div class="pagination" style="display:flex;justify-content:center;gap:8px;margin-top:20px;">`;
            
            // 上一页
            if (page > 1) {
                html += `<button class="btn btn-sm btn-outline" onclick="renderWrongBook('${filterSubject}', ${page - 1})">上一页</button>`;
            }
            
            // 页码信息
            html += `<span style="display:flex;align-items:center;padding:0 12px;">第 ${page} / ${totalPages} 页 (共${filtered.length}道)</span>`;
            
            // 下一页
            if (page < totalPages) {
                html += `<button class="btn btn-sm btn-outline" onclick="renderWrongBook('${filterSubject}', ${page + 1})">下一页</button>`;
            }
            
            html += `</div>`;
        }
    }
    
    container.innerHTML = html;
}

function filterWrongQuestions() {
    // 修复中危缺陷R19-023：添加空值检查
    const filterEl = document.getElementById('wrongFilter');
    if (!filterEl) return;
    renderWrongBook(filterEl.value);
}

function removeWrongQuestion(key) {
    Storage.removeWrongQuestion(key);
    showToast('已从错题本移除', 'success');
    // 修复中危缺陷R19-014：保留当前筛选条件和页码
    const filter = document.getElementById('wrongFilter')?.value || 'all';
    renderWrongBook(filter, WrongBookState.currentPage);
}

function clearWrongQuestions() {
    if (confirm('确定要清空所有错题吗？此操作不可恢复。')) {
        Storage.set('wrong_questions', []);
        // 修复中危缺陷R19-015：清空后重置分页状态
        WrongBookState.currentPage = 1;
        showToast('错题本已清空', 'success');
        renderWrongBook();
    }
}

function reviewWrongQuestion(subjectId, questionId) {
    const questions = getSubjectQuestions(subjectId);
    const question = questions.find(q => q.id === questionId);
    if (!question) return;
    
    AppState.quizQuestions = [question];
    AppState.quizIndex = 0;
    AppState.quizAnswers = {};
    AppState.quizMode = 'wrong';
    AppState.currentSubject = subjectId;
    navigate('quiz');
}

// ============================================
// 收藏夹
// ============================================
function renderFavorites() {
    const container = document.getElementById('favoritesList');
    const favList = Storage.getFavorites();
    
    let html = `
        <div class="filter-bar">
            <span class="count-badge">共收藏 ${favList.length} 道题目</span>
        </div>
    `;
    
    if (favList.length === 0) {
        html += `
            <div class="empty-state">
                <i class="fas fa-star"></i>
                <h3>还没有收藏题目</h3>
                <p>刷题时点击收藏按钮，收藏重要题目</p>
                <button class="btn btn-primary" onclick="navigate('subjects')">
                    <i class="fas fa-book"></i> 去刷题
                </button>
            </div>
        `;
    } else {
        favList.forEach(item => {
            const questions = getSubjectQuestions(item.subjectId);
            
            // 修复R22-016：使用工具函数解析题目key
            const parsed = parseQuestionKey(item.key);
            if (!parsed) return;
            const { questionId: qId } = parsed;
            
            const question = questions.find(q => q.id === qId);
            if (!question) return;
            
            // 修复：检查科目是否存在
            const subject = SUBJECTS_CONFIG[item.subjectId];
            if (!subject) {
                console.warn('科目不存在:', item.subjectId);
                return;
            }
            
            html += `
                <div class="favorite-item" onclick="reviewWrongQuestion('${item.subjectId}', ${qId})">
                    <div class="favorite-item-header">
                        <div class="question-text">${question.question.length > 80 ? escapeHtml(question.question.substring(0, 80)) + '...' : escapeHtml(question.question)}</div>
                        <button class="btn btn-sm btn-outline-dark" onclick="event.stopPropagation();Storage.toggleFavorite('${(item.key||'').replace(/'/g,"\\'")}','${(item.subjectId||'').replace(/'/g,"\\'")}');renderFavorites();">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="favorite-item-meta">
                        <span><i class="fas fa-book" style="color:${subject.color}"></i> ${subject.name}</span>
                        <span><i class="fas fa-tag"></i> ${escapeHtml(question.chapter)}</span>
                        <span><i class="fas fa-clock"></i> ${item.addedAt ? new Date(item.addedAt).toLocaleDateString() : '未知时间'}</span>
                    </div>
                </div>
            `;
        });
    }
    
    // 修复高危缺陷R18-003：container.innerHTML移到if/else外部，确保空状态也能渲染
    container.innerHTML = html;
}

// ============================================
// 笔记
// ============================================
function renderNotes() {
    const container = document.getElementById('notesContainer');
    const notes = Storage.getNotes();
    
    let html = `
        <div class="notes-toolbar">
            <span class="count-badge">共 ${notes.length} 条笔记</span>
        </div>
    `;
    
    if (notes.length === 0) {
        html += `
            <div class="empty-state">
                <i class="fas fa-sticky-note"></i>
                <h3>还没有笔记</h3>
                <p>刷题时点击笔记按钮，记录学习心得</p>
                <button class="btn btn-primary" onclick="navigate('subjects')">
                    <i class="fas fa-book"></i> 去刷题
                </button>
            </div>
        `;
    } else {
        notes.forEach(note => {
            // 修复R20-002：使用parseQuestionKey安全解析key，处理无下划线的情况
            const parsed = parseQuestionKey(note.key);
            if (!parsed) return;
            const { subjectId, questionId } = parsed;
            const questions = getSubjectQuestions(subjectId);
            const question = questions.find(q => q.id === questionId);
            const subject = SUBJECTS_CONFIG[subjectId];
            if (!subject) return;
            
            html += `
                <div class="note-card">
                    <div class="note-card-header">
                        <div style="flex:1">
                            <span style="font-size:12px;color:${subject.color};font-weight:600">
                                <i class="${subject.icon}"></i> ${subject.name}
                            </span>
                            <span style="font-size:12px;color:var(--gray-400);margin-left:8px">
                                ${new Date(note.updatedAt).toLocaleString()}
                            </span>
                        </div>
                        <div class="note-card-actions">
                            <button class="btn btn-sm btn-outline-dark" onclick="Storage.deleteNote('${note.key}');renderNotes();showToast('笔记已删除','success')">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                    ${question ? `<div class="note-card-question">${escapeHtml(String(question.question || '').substring(0, 100))}...</div>` : ''}
                    <div class="note-card-content">${escapeHtml(note.content)}</div>
                    ${(note.tags && note.tags.length > 0) ? `
                        <div class="note-card-tags">
                            ${note.tags.map(t => `<span class="note-tag">${escapeHtml(t)}</span>`).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        });
    }
    
    container.innerHTML = html;
}

// ============================================
// 学习统计
// ============================================
function renderStats() {
    const container = document.getElementById('statsContainer');
    const stats = Storage.getStats();
    const correctRate = stats.totalAnswered > 0 ? Math.round((stats.totalCorrect / stats.totalAnswered) * 100) : 0;
    const wrongCount = Storage.getWrongQuestions().length;
    
    // 各科目数据
    let subjectBarsHtml = '';
    let subjectRingsHtml = '';
    
    Object.values(SUBJECTS_CONFIG).forEach(subject => {
        const s = stats.subjectStats[subject.id] || { answered: 0, correct: 0 };
        const total = getSubjectQuestions(subject.id).length;
        const rate = s.answered > 0 ? Math.round((s.correct / s.answered) * 100) : 0;
        const progress = total > 0 ? Math.round((s.answered / total) * 100) : 0;
        
        subjectBarsHtml += `
            <div class="bar-item">
                <div class="bar-value">${s.answered}</div>
                <div class="bar-fill" style="height:${Math.max(progress, 4)}%;background:${subject.gradient}"></div>
                <div class="bar-label">${subject.name}</div>
            </div>
        `;
        
        const circumference = 2 * Math.PI * 40;
        const offset = circumference - (rate / 100) * circumference;
        
        subjectRingsHtml += `
            <div class="ring-item">
                <svg class="ring-svg" viewBox="0 0 100 100">
                    <circle class="ring-bg" cx="50" cy="50" r="40"/>
                    <circle class="ring-fill" cx="50" cy="50" r="40"
                        stroke="${subject.color}"
                        stroke-dasharray="${circumference}"
                        stroke-dashoffset="${offset}"/>
                </svg>
                <div class="ring-label">${subject.name} ${rate}%</div>
            </div>
        `;
    });
    
    // 每日学习热力图
    let dailyHtml = '';
    const dailyHistory = stats.dailyHistory || [];
    if (dailyHistory.length > 0) {
        dailyHtml = '<div class="chart-card"><h3><i class="fas fa-fire" style="color:var(--danger);margin-right:8px"></i>近30天学习记录</h3><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:12px">';
        dailyHistory.forEach(h => {
            // 修复中危缺陷R20-020：防御性处理count，防止负数或NaN
            const count = Math.max(0, Number(h.count) || 0);
            const intensity = Math.min(count / 20, 1);
            const bg = `rgba(99, 102, 241, ${0.2 + intensity * 0.8})`;
            dailyHtml += `<div style="width:32px;height:32px;border-radius:6px;background:${bg};display:flex;align-items:center;justify-content:center;font-size:11px;color:white;font-weight:600" title="${h.date}: ${count}题">${count}</div>`;
        });
        dailyHtml += '</div></div>';
    }
    
    container.innerHTML = `
        <div class="stats-summary">
            <div class="stat-summary-card">
                <div class="icon" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)">
                    <i class="fas fa-pen"></i>
                </div>
                <div class="value">${stats.totalAnswered}</div>
                <div class="title">总答题数</div>
            </div>
            <div class="stat-summary-card">
                <div class="icon" style="background:linear-gradient(135deg,#10b981,#14b8a6)">
                    <i class="fas fa-check"></i>
                </div>
                <div class="value">${stats.totalCorrect}</div>
                <div class="title">正确题数</div>
            </div>
            <div class="stat-summary-card">
                <div class="icon" style="background:linear-gradient(135deg,#f59e0b,#f97316)">
                    <i class="fas fa-percentage"></i>
                </div>
                <div class="value">${correctRate}%</div>
                <div class="title">总正确率</div>
            </div>
            <div class="stat-summary-card">
                <div class="icon" style="background:linear-gradient(135deg,#ef4444,#f43f5e)">
                    <i class="fas fa-times"></i>
                </div>
                <div class="value">${wrongCount}</div>
                <div class="title">错题数</div>
            </div>
            <div class="stat-summary-card">
                <div class="icon" style="background:linear-gradient(135deg,#ec4899,#f472b6)">
                    <i class="fas fa-fire"></i>
                </div>
                <div class="value">${stats.dailyStreak}</div>
                <div class="title">连续打卡</div>
            </div>
        </div>
        
        <div class="stats-charts">
            <div class="chart-card">
                <h3><i class="fas fa-chart-bar" style="color:var(--primary);margin-right:8px"></i>各科目答题量</h3>
                <div class="bar-chart">${subjectBarsHtml}</div>
            </div>
            <div class="chart-card">
                <h3><i class="fas fa-bullseye" style="color:var(--success);margin-right:8px"></i>各科目正确率</h3>
                <div class="ring-chart">${subjectRingsHtml}</div>
            </div>
        </div>
        
        ${dailyHtml}
    `;
}

// ============================================
// 每日一练
// ============================================
function renderDaily() {
    const container = document.getElementById('dailyContainer');
    const isCompleted = Storage.getDailyStatus();
    const stats = Storage.getStats();
    const today = new Date();
    const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    
    if (isCompleted) {
        container.innerHTML = `
            <div class="daily-card">
                <div class="date">${dateStr} 星期${weekDays[today.getDay()]}</div>
                <div style="font-size:64px;margin:20px 0">🎉</div>
                <h3>今日已完成打卡！</h3>
                <p style="color:var(--gray-500);margin-bottom:16px">连续打卡 ${stats.dailyStreak} 天</p>
                <div class="streak">
                    <i class="fas fa-fire"></i> 连续 ${stats.dailyStreak} 天
                </div>
                <div style="margin-top:24px;display:flex;justify-content:center;gap:12px">
                    <button class="btn btn-outline-dark" onclick="navigate('subjects')">
                        <i class="fas fa-book"></i> 继续刷题
                    </button>
                    <button class="btn btn-primary" onclick="startDailyPractice()">
                        <i class="fas fa-redo"></i> 再练一组
                    </button>
                </div>
            </div>
        `;
    } else {
        // 随机选择一个科目
        const subjectIds = Object.keys(SUBJECTS_CONFIG);
        const randomSubjectId = subjectIds[Math.floor(Math.random() * subjectIds.length)];
        const subject = SUBJECTS_CONFIG[randomSubjectId];
        
        container.innerHTML = `
            <div class="daily-card">
                <div class="date">${dateStr} 星期${weekDays[today.getDay()]}</div>
                <h3>今日一练</h3>
                <p style="color:var(--gray-500);margin-bottom:16px">
                    今日推荐科目：<strong style="color:${subject.color}">${subject.name}</strong>
                </p>
                <div class="streak">
                    <i class="fas fa-fire"></i> 已连续打卡 ${stats.dailyStreak} 天
                </div>
                <div style="margin-top:24px">
                    <button class="btn btn-primary btn-lg" onclick="startDailyPractice()">
                        <i class="fas fa-play"></i> 开始今日练习（10题）
                    </button>
                </div>
            </div>
        `;
    }
}

function startDailyPractice() {
    // 修复BUG-R10-017：添加防抖保护，防止快速双击重复抽题
    if (DebounceLock.isLocked('daily', 500)) return;
    
    // 从所有科目随机抽10题
    const allQuestions = [];
    Object.keys(SUBJECTS_CONFIG).forEach(id => {
        const qs = getSubjectQuestions(id);
        qs.forEach(q => allQuestions.push({ ...q, _subjectId: id }));
    });
    
    // 修复中危缺陷R19-034：空题目检查
    if (allQuestions.length === 0) {
        showToast('题目数据未加载，请刷新页面重试', 'warning');
        return;
    }
    
    // Shuffle and pick daily quiz count
    for (let i = allQuestions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allQuestions[i], allQuestions[j]] = [allQuestions[j], allQuestions[i]];
    }
    
    const selected = allQuestions.slice(0, CONSTANTS.DAILY_QUIZ_COUNT);
    AppState.quizQuestions = selected;
    AppState.quizIndex = 0;
    AppState.quizAnswers = {};
    AppState.quizMode = 'daily';
    // 修复R20-012：使用nullish coalescing，仅在值为null/undefined时使用默认值
    AppState.currentSubject = selected[0]?._subjectId ?? 'accounting';
    
    navigate('quiz');
}

// ============================================
// 排行榜
// ============================================
function renderRanking() {
    const container = document.getElementById('rankingContainer');
    let rankings = Storage.getRanking();
    
    if (!rankings) {
        rankings = Storage.generateRanking();
    }
    
    let html = `
        <div class="ranking-tabs">
            <div class="ranking-tab active">正确率排行</div>
        </div>
        <div class="ranking-list">
    `;
    
    rankings.forEach((item, index) => {
        let topClass = '';
        if (index === 0) topClass = 'top-1';
        else if (index === 1) topClass = 'top-2';
        else if (index === 2) topClass = 'top-3';
        
        html += `
            <div class="ranking-item ${topClass}" style="${item.isMe ? 'border:2px solid var(--primary);background:var(--primary-bg)' : ''}">
                <div class="ranking-position">${index + 1}</div>
                <div class="ranking-avatar" style="background:${item.color}">${item.avatar}</div>
                <div class="ranking-info">
                    <div class="ranking-name">${item.name} ${item.isMe ? '(我)' : ''}</div>
                    <div class="ranking-detail">答题 ${item.answered} · 正确 ${item.correct}</div>
                </div>
                <div class="ranking-score">${item.score}分</div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

// ============================================
// 搜索
// ============================================
function handleGlobalSearch(event) {
    if (event.key === 'Enter') {
        // 修复中危缺陷R19-024：添加空值检查
        const searchEl = document.getElementById('globalSearch');
        if (!searchEl) return;
        const keyword = searchEl.value.trim();
        // 修复：验证搜索关键词
        if (!keyword) {
            showToast('请输入搜索关键词', 'warning');
            return;
        }
        if (keyword.length < 2) {
            showToast('搜索关键词至少2个字符', 'warning');
            return;
        }
        if (keyword.length > 50) {
            showToast('搜索关键词不能超过50字', 'warning');
            return;
        }
        navigate('search', { keyword });
    }
}

function handleMobileSearch(event) {
    if (event.key === 'Enter') {
        const keyword = event.target.value.trim();
        // 修复：验证搜索关键词
        if (!keyword) {
            showToast('请输入搜索关键词', 'warning');
            return;
        }
        if (keyword.length < CONSTANTS.SEARCH_MIN_LENGTH) {
            showToast(`搜索关键词至少${CONSTANTS.SEARCH_MIN_LENGTH}个字符`, 'warning');
            return;
        }
        // 修复BUG-SR-002：添加搜索长度上限，与桌面端保持一致
        if (keyword.length > CONSTANTS.SEARCH_MAX_LENGTH) {
            showToast(`搜索关键词最多${CONSTANTS.SEARCH_MAX_LENGTH}个字符`, 'warning');
            return;
        }
        toggleMobileMenu();
        navigate('search', { keyword });
    }
}

function renderSearchResults(keyword) {
    // 修复BUG-011：保存搜索关键词用于后退恢复
    if (keyword) AppState.lastSearchKeyword = keyword;
    keyword = keyword || AppState.lastSearchKeyword || '';
    if (!keyword) return;
    
    const container = document.getElementById('searchResults');
    if (!container) return;
    const results = searchQuestions(keyword);
    const safeKeyword = escapeHtml(keyword);
    // 修复中危缺陷R19-041/047：对escapeHtml后的keyword进行正则转义，确保高亮匹配正确
    const escapedKeyword = escapeRegex(escapeHtml(keyword));
    
    let html = `<p style="color:var(--gray-500);margin-bottom:20px">搜索 "${safeKeyword}" 找到 ${results.length} 条结果</p>`;
    
    if (results.length === 0) {
        html += `
            <div class="empty-state">
                <i class="fas fa-search"></i>
                <h3>未找到相关题目</h3>
                <p>试试其他关键词</p>
            </div>
        `;
    } else {
        results.slice(0, CONSTANTS.SEARCH_RESULTS_LIMIT).forEach(item => {
            // 修复中危缺陷R19-018：添加subject有效性检查
            const subject = SUBJECTS_CONFIG[item.subjectId];
            if (!subject) return;
            const highlightedQuestion = escapeHtml(item.question).replace(
                new RegExp(escapedKeyword, 'gi'),
                match => `<span class="search-highlight">${match}</span>`
            );
            
            html += `
                <div class="search-result-item" onclick="reviewWrongQuestion('${item.subjectId}', ${item.id})">
                    <div class="wrong-item-meta" style="margin-bottom:8px">
                        <span><i class="fas fa-book" style="color:${subject.color}"></i> ${subject.name}</span>
                        <span><i class="fas fa-tag"></i> ${escapeHtml(item.chapter)}</span>
                    </div>
                    <div class="question-text">${highlightedQuestion}</div>
                </div>
            `;
        });
        
        if (results.length > 50) {
            html += `<p style="text-align:center;color:var(--gray-400);margin-top:16px">只显示前50条结果</p>`;
        }
    }
    
    container.innerHTML = html;
}

// ============================================
// 工具函数
// ============================================
// 修复BUG-R10-021：使用纯字符串操作替代DOM创建，提升性能
const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESCAPE_REGEX = /[&<>"']/g;
function escapeHtml(text) {
    if (typeof text !== 'string') return String(text || '');
    return text.replace(ESCAPE_REGEX, ch => ESCAPE_MAP[ch]);
}

function escapeRegex(string) {
    // 修复中危缺陷R20-007：添加类型检查，防止非字符串参数导致崩溃
    if (typeof string !== 'string') return String(string || '');
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    // 修复：限制最大toast数量，防止内存泄漏
    const existingToasts = container.querySelectorAll('.toast');
    if (existingToasts.length >= 3) {
        existingToasts[0].remove();
    }
    
    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-times-circle',
        warning: 'fas fa-exclamation-triangle',
        info: 'fas fa-info-circle'
    };
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="${icons[type] || icons.info}"></i>
        <span class="toast-message">${escapeHtml(message)}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

function toggleMobileMenu() {
    // 修复中危缺陷R19-022：添加空值检查，与closeMobileMenu保持一致
    const sidebar = document.getElementById('mobileSidebar');
    const overlay = document.getElementById('mobileOverlay');
    if (!sidebar || !overlay) return;
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
}

// 修复BUG-R10-013：关闭移动端侧边栏的辅助函数
function closeMobileMenu() {
    const sidebar = document.getElementById('mobileSidebar');
    const overlay = document.getElementById('mobileOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
}

// 导航栏滚动效果 - 修复内存泄漏：使用passive监听器
window.addEventListener('scroll', () => {
    const navbar = document.getElementById('navbar');
    if (window.scrollY > 10) {
        navbar?.classList.add('scrolled');
    } else {
        navbar?.classList.remove('scrolled');
    }
}, { passive: true });

// ============================================
// 初始化
// ============================================
async function init() {
    try {
        // 初始化存储系统
        Storage.init();
        
        await loadAllSubjects();
        
        // 检查是否有未完成的考试
        const savedExam = Storage.get('exam_state');
        // 修复严重缺陷C-001：Storage.get()已自动解包data字段，直接使用savedExam
        // 修复中危缺陷R20-022：检查questions是否为数组
        if (savedExam && Array.isArray(savedExam.questions) && savedExam.questions.length > 0 && savedExam.timeLeft > 0) {
            const timeSinceSave = Date.now() - (savedExam.savedAt || 0);
            const timeLeft = savedExam.timeLeft - Math.floor(timeSinceSave / 1000);
            
            if (timeLeft > 0 && confirm('检测到未完成的考试，是否恢复？')) {
                // 修复高危缺陷R18-009：恢复前更新存储中的剩余时间，扣除页面关闭期间流逝的时间
                Storage.update('exam_state', (state) => {
                    if (state) state.timeLeft = timeLeft;
                    return state;
                });
                navigate('exam-taking', { resume: true }, false);
            } else {
                Storage.set('exam_state', null);
                renderHome();
            }
        } else {
            renderHome();
        }
        
        // 考试模式下防止浏览器直接离开
        window.addEventListener('beforeunload', function(e) {
            // 修复R24：页面卸载前刷写答题缓存，防止数据丢失
            Storage.flushAnswerBuffer();
            if (AppState.examTimer) {
                // 先保存考试状态
                saveExamState();
                e.preventDefault();
                e.returnValue = '';
            }
            // 修复内存缺陷R22-006：页面卸载时清理所有防抖锁
            DebounceLock.clearAll();
        });
        
        // 修复浏览器后退按钮：监听popstate事件
        window.addEventListener('popstate', (e) => {
            // 修复高危缺陷R19-020：考试中后退时先保存答题记录再结束考试
            if (AppState.examTimer) {
                cleanupExamTimer(); // 修复R22-017：使用工具函数清理定时器
                // 自动交卷保存答题记录和统计数据
                finishExam(true);
                Storage.set('exam_state', null);
                showToast('考试已结束', 'warning');
            }
            
            if (e.state && e.state.page) {
                // 恢复页面状态但不添加新的历史记录
                navigate(e.state.page, e.state.params || {}, false);
            } else {
                // 修复BUG-NA-001：无state时从hash解析页面，保持hash与页面同步
                const hash = window.location.hash.slice(1);
                const validPages = ['home','subjects','quiz','exam','exam-taking','wrong','favorites','notes','stats','daily','search'];
                const targetPage = validPages.includes(hash) ? hash : 'home';
                navigate(targetPage, {}, false);
            }
        });
        
        // 处理初始hash
        const hash = window.location.hash.slice(1);
        if (hash && hash !== 'home') {
            navigate(hash, {}, false);
        }
        
        // 第一性原理修复BUG-014：监听页面可见性变化，处理考试计时
        document.addEventListener('visibilitychange', () => {
            if (AppState.examTimer) {
                if (document.hidden) {
                    // 页面隐藏时记录时间
                    AppState.pageHiddenAt = Date.now();
                    saveExamState(); // 保存当前状态
                } else if (AppState.pageHiddenAt) {
                    // 页面重新可见时，计算实际经过时间
                    const hiddenDuration = Date.now() - AppState.pageHiddenAt;
                    // 即使页面隐藏，考试时间也应该继续流逝
                    // 这里不需要额外处理，因为startExamTimer使用Date.now()计算
                    delete AppState.pageHiddenAt;
                }
            }
        });
        
        // 更新总题数
        const total = getTotalQuestionCount();
        const totalEl = document.getElementById('totalQuestions');
        if (totalEl) totalEl.textContent = total;
        
        console.log(`CPA智刷初始化完成，共加载 ${total} 道题目`);
    } catch (error) {
        console.error('初始化失败:', error);
        // 修复中危缺陷R19-039：添加空值检查
        const mainContent = document.getElementById('mainContent');
        if (mainContent) {
            mainContent.innerHTML = `
            <div style="text-align:center;padding:100px 24px">
                <i class="fas fa-exclamation-triangle" style="font-size:64px;color:var(--warning);margin-bottom:16px"></i>
                <h2>加载失败</h2>
                <p style="color:var(--gray-500);margin-bottom:24px">请确保通过HTTP服务器访问（如使用 Live Server 或 python -m http.server）</p>
            </div>
        `;
        }
    }
}

// 启动应用
document.addEventListener('DOMContentLoaded', init);
