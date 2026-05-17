/**
 * CPA智刷 - 主应用逻辑
 * 管理页面导航、刷题、考试、错题本、收藏、笔记、统计等全部功能
 */

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
    noteEditingQuestion: null
};

// ============================================
// 本地存储管理
// ============================================
const Storage = {
    get(key, defaultValue = null) {
        try {
            const data = localStorage.getItem(`cpa_${key}`);
            return data ? JSON.parse(data) : defaultValue;
        } catch { return defaultValue; }
    },
    set(key, value) {
        try {
            localStorage.setItem(`cpa_${key}`, JSON.stringify(value));
        } catch (e) { console.warn('存储失败:', e); }
    },
    // 答题记录
    getAnswerRecord(questionKey) {
        return this.get('answers', {})[questionKey] || null;
    },
    setAnswerRecord(questionKey, isCorrect, userAnswer) {
        const answers = this.get('answers', {});
        answers[questionKey] = {
            isCorrect,
            userAnswer,
            timestamp: Date.now()
        };
        this.set('answers', answers);
    },
    // 错题本
    getWrongQuestions() {
        return this.get('wrong_questions', []);
    },
    addWrongQuestion(questionKey, subjectId) {
        const wrong = this.get('wrong_questions', []);
        if (!wrong.find(w => w.key === questionKey)) {
            wrong.push({ key: questionKey, subjectId, addedAt: Date.now() });
            this.set('wrong_questions', wrong);
        }
    },
    removeWrongQuestion(questionKey) {
        let wrong = this.get('wrong_questions', []);
        wrong = wrong.filter(w => w.key !== questionKey);
        this.set('wrong_questions', wrong);
    },
    // 收藏
    getFavorites() {
        return this.get('favorites', []);
    },
    toggleFavorite(questionKey, subjectId) {
        let favs = this.get('favorites', []);
        const idx = favs.findIndex(f => f.key === questionKey);
        if (idx >= 0) {
            favs.splice(idx, 1);
        } else {
            favs.push({ key: questionKey, subjectId, addedAt: Date.now() });
        }
        this.set('favorites', favs);
        return idx < 0;
    },
    isFavorite(questionKey) {
        return this.get('favorites', []).some(f => f.key === questionKey);
    },
    // 笔记
    getNotes() {
        return this.get('notes', []);
    },
    saveNote(questionKey, content, tags) {
        const notes = this.get('notes', []);
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
        this.set('notes', notes);
    },
    deleteNote(questionKey) {
        let notes = this.get('notes', []);
        notes = notes.filter(n => n.key !== questionKey);
        this.set('notes', notes);
    },
    // 学习统计
    getStats() {
        return this.get('stats', {
            totalAnswered: 0,
            totalCorrect: 0,
            dailyStreak: 0,
            lastStudyDate: null,
            subjectStats: {},
            dailyHistory: []
        });
    },
    updateStats(isCorrect, subjectId) {
        const stats = this.getStats();
        stats.totalAnswered++;
        if (isCorrect) stats.totalCorrect++;
        
        if (!stats.subjectStats[subjectId]) {
            stats.subjectStats[subjectId] = { answered: 0, correct: 0 };
        }
        stats.subjectStats[subjectId].answered++;
        if (isCorrect) stats.subjectStats[subjectId].correct++;
        
        // 每日打卡
        const today = new Date().toDateString();
        if (stats.lastStudyDate !== today) {
            const yesterday = new Date(Date.now() - 86400000).toDateString();
            if (stats.lastStudyDate === yesterday) {
                stats.dailyStreak++;
            } else if (stats.lastStudyDate !== today) {
                stats.dailyStreak = 1;
            }
            stats.lastStudyDate = today;
            
            // 每日历史
            if (!stats.dailyHistory) stats.dailyHistory = [];
            const todayEntry = stats.dailyHistory.find(h => h.date === today);
            if (todayEntry) {
                todayEntry.count++;
                if (isCorrect) todayEntry.correct++;
            } else {
                stats.dailyHistory.push({ date: today, count: 1, correct: isCorrect ? 1 : 0 });
            }
            // 只保留最近30天
            if (stats.dailyHistory.length > 30) {
                stats.dailyHistory = stats.dailyHistory.slice(-30);
            }
        }
        
        this.set('stats', stats);
    },
    // 每日一练
    getDailyStatus() {
        const today = new Date().toDateString();
        return this.get('daily_status', {}).date === today;
    },
    setDailyCompleted() {
        this.set('daily_status', { date: new Date().toDateString(), completed: true });
    },
    // 排行榜（模拟数据）
    getRanking() {
        return this.get('ranking', null);
    },
    generateRanking() {
        const names = ['学霸小王', 'CPA追梦人', '会计小达人', '审计老司机', '财管高手',
            '税法通', '战略家', '努力的小李', '考证达人', '未来CPA',
            '加油少年', '不放弃的鱼', '学习使我快乐', '天天向上', '梦想家',
            '奋斗的青春', '阳光考生', '坚持到底', '破茧成蝶', '金榜题名'];
        const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
            '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#06b6d4'];
        
        const myStats = this.getStats();
        const myScore = Math.round((myStats.totalCorrect / Math.max(myStats.totalAnswered, 1)) * 100);
        
        const rankings = names.map((name, i) => ({
            name,
            avatar: name[0],
            color: colors[i % colors.length],
            score: Math.floor(Math.random() * 40) + 60,
            answered: Math.floor(Math.random() * 2000) + 500,
            correct: Math.floor(Math.random() * 1500) + 300
        }));
        
        rankings.push({
            name: '我',
            avatar: '我',
            color: '#6366f1',
            score: myScore,
            answered: myStats.totalAnswered,
            correct: myStats.totalCorrect,
            isMe: true
        });
        
        rankings.sort((a, b) => b.score - a.score);
        this.set('ranking', rankings);
        return rankings;
    }
};

// ============================================
// 页面导航
// ============================================
function navigate(page, params = {}) {
    // 考试模式下切换到非考试页面时清理计时器
    if (AppState.examTimer && page !== 'exam-taking') {
        clearInterval(AppState.examTimer);
        AppState.examTimer = null;
    }
    
    // 隐藏所有页面
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    
    // 更新导航高亮
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const activeLink = document.querySelector(`.nav-link[data-page="${page}"]`);
    if (activeLink) activeLink.classList.add('active');
    
    AppState.currentPage = page;
    
    // 显示目标页面
    const targetPage = document.getElementById(`page-${page}`);
    if (targetPage) {
        targetPage.classList.add('active');
    }
    
    // 滚动到顶部
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
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
    
    let html = '';
    Object.values(SUBJECTS_CONFIG).forEach(subject => {
        const questions = getSubjectQuestions(subject.id);
        const total = questions.length;
        const stats = Storage.getStats();
        const subjectStat = stats.subjectStats[subject.id] || { answered: 0, correct: 0 };
        const progress = total > 0 ? Math.round((subjectStat.answered / total) * 100) : 0;
        const correctRate = subjectStat.answered > 0 ? Math.round((subjectStat.correct / subjectStat.answered) * 100) : 0;
        
        html += `
            <div class="subject-card" role="button" tabindex="0" onclick="navigate('subjects', {subjectId: '${subject.id}'})" onkeydown="if(event.key==='Enter')navigate('subjects',{subjectId:'${subject.id}'})">
                <div style="position:absolute;top:0;left:0;right:0;height:4px;background:${subject.gradient}"></div>
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
                    <span class="subject-tag">单选 ${questions.filter(q => q.type === 'single').length}</span>
                    <span class="subject-tag">多选 ${questions.filter(q => q.type === 'multi').length}</span>
                    <span class="subject-tag">判断 ${questions.filter(q => q.type === 'judge').length}</span>
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
    
    const subject = SUBJECTS_CONFIG[subjectId];
    const chapters = getSubjectChapters(subjectId);
    const questions = getSubjectQuestions(subjectId);
    
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
        const stats = Storage.getStats();
        const subjectStat = stats.subjectStats[subjectId] || { answered: 0 };
        html += `
            <div class="chapter-item" onclick="startChapterQuiz('${subjectId}', '${chapter.name.replace(/'/g, "\\'")}')">
                <div class="chapter-item-left">
                    <div class="chapter-num">${index + 1}</div>
                    <div>
                        <div class="chapter-name">${chapter.name}</div>
                        <div style="font-size:12px;color:var(--gray-400);margin-top:2px">${chapter.sections.slice(0, 3).join('、')}</div>
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
    const questions = getRandomQuestions(subjectId, 50);
    if (questions.length === 0) {
        showToast('该科目暂无题目', 'warning');
        return;
    }
    AppState.quizQuestions = questions;
    AppState.quizIndex = 0;
    AppState.quizAnswers = {};
    AppState.quizMode = 'practice';
    AppState.currentSubject = subjectId;
    navigate('quiz');
}

function startChapterQuiz(subjectId, chapterName) {
    const questions = getQuestionsByChapter(subjectId, chapterName);
    if (questions.length === 0) {
        showToast('该章节暂无题目', 'warning');
        return;
    }
    // Shuffle
    for (let i = questions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [questions[i], questions[j]] = [questions[j], questions[i]];
    }
    AppState.quizQuestions = questions;
    AppState.quizIndex = 0;
    AppState.quizAnswers = {};
    AppState.quizMode = 'practice';
    AppState.currentSubject = subjectId;
    navigate('quiz');
}

function startQuiz(params) {
    renderQuizQuestion();
}

function renderQuizQuestion() {
    const container = document.getElementById('quizContainer');
    if (!container || AppState.quizQuestions.length === 0) return;

    // 移除可能残留的多选题确认按钮
    const existingBtn = document.getElementById('confirmMultiBtn');
    if (existingBtn) existingBtn.remove();

    const question = AppState.quizQuestions[AppState.quizIndex];
    const total = AppState.quizQuestions.length;
    const current = AppState.quizIndex + 1;
    const subjectId = question._subjectId || AppState.currentSubject;
    const questionKey = `${subjectId}_${question.id}`;
    const answerRecord = Storage.getAnswerRecord(questionKey);
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
    
    for (let i = 0; i < total; i++) {
        const q = AppState.quizQuestions[i];
        const qSubjectId = q._subjectId || AppState.currentSubject;
        const key = `${qSubjectId}_${q.id}`;
        const record = Storage.getAnswerRecord(key);
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
                const correctAnswers = question.answer.split(',').map(a => a.trim());
                const userAnswers = answered.userAnswer.split(',').map(a => a.trim());
                if (correctAnswers.includes(letter)) cls += ' correct';
                if (userAnswers.includes(letter) && !correctAnswers.includes(letter)) cls += ' wrong';
            } else if (answerRecord) {
                cls += ' disabled';
                const correctAnswers = question.answer.split(',').map(a => a.trim());
                const userAnswers = answerRecord.userAnswer.split(',').map(a => a.trim());
                if (correctAnswers.includes(letter)) cls += ' correct';
                if (userAnswers.includes(letter) && !correctAnswers.includes(letter)) cls += ' wrong';
            } else {
                cls += `" onclick="selectOption('${letter}', this)`;
            }
            html += `
                <div class="${cls}">
                    <span class="option-letter">${letter}</span>
                    <span>${escapeHtml(opt)}</span>
                </div>
            `;
        });
    }

    html += '</div>';

    // 解析
    const showExplanation = answered !== undefined || answerRecord;
    if (showExplanation) {
        const isCorrect = answered ? answered.isCorrect : answerRecord.isCorrect;
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

function selectOption(letter, element) {
    const question = AppState.quizQuestions[AppState.quizIndex];
    const subjectId = question._subjectId || AppState.currentSubject;
    const questionKey = `${subjectId}_${question.id}`;
    
    let userAnswer = letter;
    
    // 多选题：切换选择
    if (question.type === 'multi') {
        const options = document.querySelectorAll('.quiz-option');
        const selectedLetters = [];
        options.forEach(opt => {
            if (opt.classList.contains('selected')) {
                const l = opt.querySelector('.option-letter').textContent;
                selectedLetters.push(l);
            }
        });
        
        if (element.classList.contains('selected')) {
            element.classList.remove('selected');
            const idx = selectedLetters.indexOf(letter);
            if (idx >= 0) selectedLetters.splice(idx, 1);
        } else {
            element.classList.add('selected');
            selectedLetters.push(letter);
        }
        
        if (selectedLetters.length === 0) return;
        userAnswer = selectedLetters.sort().join(',');
        
        // 多选题需要点击确认
        // 检查是否已有确认按钮
        if (!document.getElementById('confirmMultiBtn')) {
            const actionsRight = document.querySelector('.quiz-actions-right');
            const confirmBtn = document.createElement('button');
            confirmBtn.id = 'confirmMultiBtn';
            confirmBtn.className = 'btn btn-sm btn-success';
            confirmBtn.innerHTML = '<i class="fas fa-check"></i> 确认提交';
            confirmBtn.onclick = () => submitAnswer(questionKey, userAnswer);
            actionsRight.insertBefore(confirmBtn, actionsRight.firstChild);
        }
        return;
    }
    
    submitAnswer(questionKey, userAnswer);
}

function submitAnswer(questionKey, userAnswer) {
    const question = AppState.quizQuestions[AppState.quizIndex];
    const correctAnswer = question.answer.trim();
    const isCorrect = userAnswer.trim() === correctAnswer;
    const subjectId = question._subjectId || AppState.currentSubject;
    
    AppState.quizAnswers[questionKey] = { isCorrect, userAnswer };
    Storage.setAnswerRecord(questionKey, isCorrect, userAnswer);
    Storage.updateStats(isCorrect, subjectId);
    
    if (!isCorrect) {
        Storage.addWrongQuestion(questionKey, subjectId);
    } else {
        Storage.removeWrongQuestion(questionKey);
    }
    
    renderQuizQuestion();
}

function nextQuestion() {
    if (AppState.quizIndex < AppState.quizQuestions.length - 1) {
        AppState.quizIndex++;
        renderQuizQuestion();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function prevQuestion() {
    if (AppState.quizIndex > 0) {
        AppState.quizIndex--;
        renderQuizQuestion();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function jumpToQuestion(index) {
    AppState.quizIndex = index;
    renderQuizQuestion();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleQuizNav() {
    const panel = document.getElementById('quizNavPanel');
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
    if (AppState.quizMode === 'daily') {
        Storage.setDailyCompleted();
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
    const isFav = Storage.toggleFavorite(questionKey, AppState.currentSubject);
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
    
    // 找到题目
    const question = AppState.quizQuestions.find(q => `${AppState.currentSubject}_${q.id}` === questionKey);
    if (question) {
        preview.textContent = question.question.substring(0, 100) + (question.question.length > 100 ? '...' : '');
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
    document.getElementById('noteModal').classList.remove('show');
}

function saveNote() {
    const content = document.getElementById('noteContent').value.trim();
    const tags = document.getElementById('noteTags').value.trim();
    
    if (!content) {
        showToast('请输入笔记内容', 'warning');
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
    const subjectId = document.getElementById('examSubject').value;
    const count = parseInt(document.getElementById('examCount').value);
    const time = parseInt(document.getElementById('examTime').value);
    const difficulty = document.getElementById('examDifficulty').value;
    
    startExam({ subjectId, count, time, difficulty });
}

function startExam(params) {
    const { subjectId, count = 50, time = 60, difficulty = 'all' } = params;
    
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
    
    // 显示考试页面
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-exam-taking').classList.add('active');
    
    // 启动计时器
    startExamTimer();
    renderExamQuestion();
}

function startExamTimer() {
    if (AppState.examTimer) clearInterval(AppState.examTimer);
    
    AppState.examTimer = setInterval(() => {
        AppState.examTimeLeft--;
        updateExamTimerDisplay();
        
        if (AppState.examTimeLeft <= 0) {
            clearInterval(AppState.examTimer);
            finishExam();
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
        timerEl.parentElement.classList.add('warning');
    }
}

function renderExamQuestion() {
    const container = document.getElementById('examTakingContainer');
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
            if (answered) {
                cls += ' selected';
                if (answered.userAnswer === opt) cls += ' selected';
            }
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
            if (answered && answered.userAnswer.includes(letter)) cls += ' selected';
            html += `
                <div class="${cls}" onclick="examSelectOption('${letter}', this)">
                    <span class="option-letter">${letter}</span>
                    <span>${escapeHtml(opt)}</span>
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
    const subjectId = question._subjectId || AppState.currentSubject;
    const questionKey = `${subjectId}_${question.id}`;
    
    if (question.type === 'multi') {
        // 多选切换
        if (element.classList.contains('selected')) {
            element.classList.remove('selected');
        } else {
            element.classList.add('selected');
        }
        
        const selected = [];
        document.querySelectorAll('.quiz-option.selected').forEach(opt => {
            selected.push(opt.querySelector('.option-letter').textContent);
        });
        
        AppState.quizAnswers[questionKey] = { userAnswer: selected.sort().join(',') };
    } else {
        // 单选/判断
        document.querySelectorAll('.quiz-option').forEach(opt => opt.classList.remove('selected'));
        element.classList.add('selected');
        AppState.quizAnswers[questionKey] = { userAnswer: letter };
    }
}

function nextExamQuestion() {
    if (AppState.quizIndex < AppState.quizQuestions.length - 1) {
        AppState.quizIndex++;
        renderExamQuestion();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function prevExamQuestion() {
    if (AppState.quizIndex > 0) {
        AppState.quizIndex--;
        renderExamQuestion();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function finishExam() {
    if (!confirm('确定要交卷吗？交卷后不可修改答案。')) return;
    if (AppState.examTimer) clearInterval(AppState.examTimer);
    
    // 计算分数
    let correct = 0;
    let total = AppState.quizQuestions.length;
    
    AppState.quizQuestions.forEach(q => {
        const qSubjectId = q._subjectId || AppState.currentSubject;
        const key = `${qSubjectId}_${q.id}`;
        const ans = AppState.quizAnswers[key];
        if (ans) {
            const isCorrect = ans.userAnswer.trim() === q.answer.trim();
            if (isCorrect) correct++;
            Storage.setAnswerRecord(key, isCorrect, ans.userAnswer);
            Storage.updateStats(isCorrect, qSubjectId);
            if (!isCorrect) {
                Storage.addWrongQuestion(key, qSubjectId);
            } else {
                Storage.removeWrongQuestion(key);
            }
        }
    });
    
    const score = Math.round((correct / total) * 100);
    const answered = Object.keys(AppState.quizAnswers).length;
    const timeUsed = (AppState.examTotalTime || 3600) - AppState.examTimeLeft;
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
    AppState.quizMode = 'practice';
    AppState.quizIndex = 0;
    // 保留quizAnswers用于显示解析
    navigate('quiz');
}

// ============================================
// 错题本
// ============================================
function renderWrongBook(filterSubject = 'all') {
    const container = document.getElementById('wrongBook');
    const wrongList = Storage.getWrongQuestions();
    
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
        filtered.forEach(item => {
            const questions = getSubjectQuestions(item.subjectId);
            const qId = parseInt(item.key.split('_')[1]);
            const question = questions.find(q => q.id === qId);
            if (!question) return;
            
            const subject = SUBJECTS_CONFIG[item.subjectId];
            html += `
                <div class="wrong-item" onclick="reviewWrongQuestion('${item.subjectId}', ${qId})">
                    <div class="wrong-item-header">
                        <div class="question-text">${escapeHtml(question.question.substring(0, 80))}...</div>
                        <button class="btn btn-sm btn-outline-dark" onclick="event.stopPropagation();removeWrongQuestion('${item.key}')">
                            <i class="fas fa-check"></i> 已掌握
                        </button>
                    </div>
                    <div class="wrong-item-meta">
                        <span><i class="fas fa-book" style="color:${subject.color}"></i> ${subject.name}</span>
                        <span><i class="fas fa-tag"></i> ${escapeHtml(question.chapter)}</span>
                        <span><i class="fas fa-clock"></i> ${new Date(item.addedAt).toLocaleDateString()}</span>
                    </div>
                </div>
            `;
        });
    }
    
    container.innerHTML = html;
}

function filterWrongQuestions() {
    const filter = document.getElementById('wrongFilter').value;
    renderWrongBook(filter);
}

function removeWrongQuestion(key) {
    Storage.removeWrongQuestion(key);
    showToast('已从错题本移除', 'success');
    renderWrongBook();
}

function clearWrongQuestions() {
    if (confirm('确定要清空所有错题吗？此操作不可恢复。')) {
        Storage.set('wrong_questions', []);
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
            const qId = parseInt(item.key.split('_')[1]);
            const question = questions.find(q => q.id === qId);
            if (!question) return;
            
            const subject = SUBJECTS_CONFIG[item.subjectId];
            html += `
                <div class="favorite-item" onclick="reviewWrongQuestion('${item.subjectId}', ${qId})">
                    <div class="favorite-item-header">
                        <div class="question-text">${escapeHtml(question.question.substring(0, 80))}...</div>
                        <button class="btn btn-sm btn-outline-dark" onclick="event.stopPropagation();Storage.toggleFavorite('${item.key}','${item.subjectId}');renderFavorites();">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="favorite-item-meta">
                        <span><i class="fas fa-book" style="color:${subject.color}"></i> ${subject.name}</span>
                        <span><i class="fas fa-tag"></i> ${escapeHtml(question.chapter)}</span>
                        <span><i class="fas fa-clock"></i> ${new Date(item.addedAt).toLocaleDateString()}</span>
                    </div>
                </div>
            `;
        });
    }
    
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
            const parts = note.key.split('_');
            const subjectId = parts[0];
            const questionId = parseInt(parts[1]);
            const questions = getSubjectQuestions(subjectId);
            const question = questions.find(q => q.id === questionId);
            const subject = SUBJECTS_CONFIG[subjectId];
            
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
                    ${question ? `<div class="note-card-question">${escapeHtml(question.question.substring(0, 100))}...</div>` : ''}
                    <div class="note-card-content">${escapeHtml(note.content)}</div>
                    ${note.tags.length > 0 ? `
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
            const intensity = Math.min(h.count / 20, 1);
            const bg = `rgba(99, 102, 241, ${0.2 + intensity * 0.8})`;
            dailyHtml += `<div style="width:32px;height:32px;border-radius:6px;background:${bg};display:flex;align-items:center;justify-content:center;font-size:11px;color:white;font-weight:600" title="${h.date}: ${h.count}题">${h.count}</div>`;
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
    // 从所有科目随机抽10题
    const allQuestions = [];
    Object.keys(SUBJECTS_CONFIG).forEach(id => {
        const qs = getSubjectQuestions(id);
        qs.forEach(q => allQuestions.push({ ...q, _subjectId: id }));
    });
    
    // Shuffle and pick 10
    for (let i = allQuestions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allQuestions[i], allQuestions[j]] = [allQuestions[j], allQuestions[i]];
    }
    
    const selected = allQuestions.slice(0, 10);
    AppState.quizQuestions = selected;
    AppState.quizIndex = 0;
    AppState.quizAnswers = {};
    AppState.quizMode = 'daily';
    AppState.currentSubject = selected[0]?._subjectId || 'accounting';
    
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
        const keyword = document.getElementById('globalSearch').value.trim();
        if (keyword && keyword.length > 0) {
            navigate('search', { keyword });
        }
    }
}

function renderSearchResults(keyword) {
    const container = document.getElementById('searchResults');
    const results = searchQuestions(keyword);
    const safeKeyword = escapeHtml(keyword);
    const escapedKeyword = escapeRegex(keyword);
    
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
        results.slice(0, 50).forEach(item => {
            const subject = SUBJECTS_CONFIG[item.subjectId];
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
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-times-circle',
        warning: 'fas fa-exclamation-triangle'
    };
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="${icons[type]}"></i>
        <span class="toast-message">${escapeHtml(message)}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

function toggleMobileMenu() {
    const sidebar = document.getElementById('mobileSidebar');
    const overlay = document.getElementById('mobileOverlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
}

// 导航栏滚动效果
window.addEventListener('scroll', () => {
    const navbar = document.getElementById('navbar');
    if (window.scrollY > 10) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
});

// ============================================
// 初始化
// ============================================
async function init() {
    try {
        await loadAllSubjects();
        renderHome();
        
        // 考试模式下防止浏览器直接离开
        window.addEventListener('beforeunload', function(e) {
            if (AppState.examTimer) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
        
        // 更新总题数
        const total = getTotalQuestionCount();
        const totalEl = document.getElementById('totalQuestions');
        if (totalEl) totalEl.textContent = total;
        
        console.log(`CPA智刷初始化完成，共加载 ${total} 道题目`);
    } catch (error) {
        console.error('初始化失败:', error);
        document.getElementById('mainContent').innerHTML = `
            <div style="text-align:center;padding:100px 24px">
                <i class="fas fa-exclamation-triangle" style="font-size:64px;color:var(--warning);margin-bottom:16px"></i>
                <h2>加载失败</h2>
                <p style="color:var(--gray-500);margin-bottom:24px">请确保通过HTTP服务器访问（如使用 Live Server 或 python -m http.server）</p>
            </div>
        `;
    }
}

// 启动应用
document.addEventListener('DOMContentLoaded', init);
