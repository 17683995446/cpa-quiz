/**
 * CPA智刷 - 数据加载模块
 * 负责加载和管理所有科目题目数据
 */

const SUBJECTS_CONFIG = {
    accounting: {
        id: 'accounting',
        name: '会计',
        fullName: '会计',
        icon: 'fas fa-calculator',
        color: '#6366f1',
        gradient: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
        description: '会计是CPA考试的核心科目，涵盖财务会计的基本理论和实务操作。',
        examTime: 180,
        passScore: 60,
        totalScore: 100
    },
    auditing: {
        id: 'auditing',
        name: '审计',
        fullName: '审计',
        icon: 'fas fa-search-dollar',
        color: '#ec4899',
        gradient: 'linear-gradient(135deg, #ec4899, #f43f5e)',
        description: '审计科目考查审计理论和实务，是CPA考试的重要科目。',
        examTime: 150,
        passScore: 60,
        totalScore: 100
    },
    financial_management: {
        id: 'financial_management',
        name: '财务成本管理',
        fullName: '财务成本管理',
        icon: 'fas fa-chart-line',
        color: '#f59e0b',
        gradient: 'linear-gradient(135deg, #f59e0b, #f97316)',
        description: '财管科目涉及财务管理、成本计算、投资决策等内容。',
        examTime: 150,
        passScore: 60,
        totalScore: 100
    },
    economic_law: {
        id: 'economic_law',
        name: '经济法',
        fullName: '经济法',
        icon: 'fas fa-balance-scale',
        color: '#10b981',
        gradient: 'linear-gradient(135deg, #10b981, #14b8a6)',
        description: '经济法涵盖民法、商法、经济法等法律制度。',
        examTime: 120,
        passScore: 60,
        totalScore: 100
    },
    tax_law: {
        id: 'tax_law',
        name: '税法',
        fullName: '税法',
        icon: 'fas fa-file-invoice-dollar',
        color: '#3b82f6',
        gradient: 'linear-gradient(135deg, #3b82f6, #2563eb)',
        description: '税法科目考查各税种的计算和税收政策法规。',
        examTime: 120,
        passScore: 60,
        totalScore: 100
    },
    strategy: {
        id: 'strategy',
        name: '公司战略与风险管理',
        fullName: '战略',
        icon: 'fas fa-chess',
        color: '#8b5cf6',
        gradient: 'linear-gradient(135deg, #8b5cf6, #a855f7)',
        description: '战略科目涵盖公司战略分析、选择、实施和风险管理。',
        examTime: 120,
        passScore: 60,
        totalScore: 100
    }
};

// 题目数据缓存
const questionCache = {};
let allQuestionsLoaded = false;

/**
 * 加载单个科目的题目数据
 */
async function loadSubjectData(subjectId) {
    if (questionCache[subjectId]) {
        return questionCache[subjectId];
    }
    
    try {
        const response = await fetch(`data/${subjectId}.json`);
        if (!response.ok) throw new Error(`加载${subjectId}数据失败`);
        const data = await response.json();
        questionCache[subjectId] = data;
        return data;
    } catch (error) {
        console.error(`加载${subjectId}题目数据出错:`, error);
        return [];
    }
}

/**
 * 加载所有科目数据
 */
async function loadAllSubjects() {
    if (allQuestionsLoaded) return;
    
    const promises = Object.keys(SUBJECTS_CONFIG).map(id => loadSubjectData(id));
    await Promise.all(promises);
    allQuestionsLoaded = true;
}

/**
 * 获取科目题目
 */
function getSubjectQuestions(subjectId) {
    return questionCache[subjectId] || [];
}

/**
 * 获取科目章节列表
 */
function getSubjectChapters(subjectId) {
    const questions = getSubjectQuestions(subjectId);
    const chapters = {};
    questions.forEach(q => {
        if (!chapters[q.chapter]) {
            chapters[q.chapter] = {
                name: q.chapter,
                questions: [],
                sections: new Set()
            };
        }
        chapters[q.chapter].questions.push(q);
        if (q.section) chapters[q.chapter].sections.add(q.section);
    });
    return Object.values(chapters).map(ch => ({
        name: ch.name,
        count: ch.questions.length,
        sections: [...ch.sections]
    }));
}

/**
 * 按章节筛选题目
 */
function getQuestionsByChapter(subjectId, chapterName) {
    const questions = getSubjectQuestions(subjectId);
    return questions.filter(q => q.chapter === chapterName);
}

/**
 * 按难度筛选题目
 */
function getQuestionsByDifficulty(subjectId, difficulty) {
    const questions = getSubjectQuestions(subjectId);
    return questions.filter(q => q.difficulty === difficulty);
}

/**
 * 按题型筛选题目
 */
function getQuestionsByType(subjectId, type) {
    const questions = getSubjectQuestions(subjectId);
    return questions.filter(q => q.type === type);
}

/**
 * 获取随机题目
 */
function getRandomQuestions(subjectId, count, filters = {}) {
    let questions = getSubjectQuestions(subjectId);
    
    if (filters.chapter) {
        questions = questions.filter(q => q.chapter === filters.chapter);
    }
    if (filters.difficulty) {
        questions = questions.filter(q => q.difficulty === filters.difficulty);
    }
    if (filters.type) {
        questions = questions.filter(q => q.type === filters.type);
    }
    
    // Fisher-Yates shuffle
    const shuffled = [...questions];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    return shuffled.slice(0, count);
}

/**
 * 搜索题目
 */
function searchQuestions(keyword) {
    const results = [];
    const lowerKeyword = keyword.toLowerCase();
    
    Object.keys(SUBJECTS_CONFIG).forEach(subjectId => {
        const questions = getSubjectQuestions(subjectId);
        questions.forEach(q => {
            if (
                q.question.toLowerCase().includes(lowerKeyword) ||
                q.key_point.toLowerCase().includes(lowerKeyword) ||
                q.explanation.toLowerCase().includes(lowerKeyword) ||
                q.chapter.toLowerCase().includes(lowerKeyword)
            ) {
                results.push({ ...q, subjectId, subjectName: SUBJECTS_CONFIG[subjectId].name });
            }
        });
    });
    
    return results;
}

/**
 * 获取题目总数
 */
function getTotalQuestionCount() {
    let total = 0;
    Object.keys(questionCache).forEach(id => {
        total += (questionCache[id] || []).length;
    });
    return total;
}

/**
 * 获取难度文本
 */
function getDifficultyText(difficulty) {
    const map = { 1: '简单', 2: '较易', 3: '中等', 4: '较难', 5: '困难' };
    return map[difficulty] || '未知';
}

/**
 * 获取难度颜色
 */
function getDifficultyColor(difficulty) {
    const map = {
        1: '#10b981',
        2: '#3b82f6',
        3: '#f59e0b',
        4: '#f97316',
        5: '#ef4444'
    };
    return map[difficulty] || '#94a3b8';
}

/**
 * 获取题型文本
 */
function getTypeText(type) {
    const map = { single: '单选题', multi: '多选题', judge: '判断题' };
    return map[type] || '未知';
}
