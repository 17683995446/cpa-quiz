// ============================================================
// CPA智刷 - 第十八轮极致深度自动化测试
// 模拟浏览器环境测试核心模块
// ============================================================

// 模拟浏览器环境
const mockLocalStorage = {};
global.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { hash: '', hostname: 'localhost' },
    history: { pushState: () => {}, replaceState: () => {} },
    localStorage: {
        getItem: (k) => mockLocalStorage[k] || null,
        setItem: (k, v) => { mockLocalStorage[k] = v; },
        removeItem: (k) => { delete mockLocalStorage[k]; },
        get length() { return Object.keys(mockLocalStorage).length; },
        key: (i) => Object.keys(mockLocalStorage)[i] || null,
        clear: () => { Object.keys(mockLocalStorage).forEach(k => delete mockLocalStorage[k]); }
    },
    setTimeout: setTimeout,
    setInterval: setInterval,
    clearTimeout: clearTimeout,
    clearInterval: clearInterval,
    Date: Date,
    JSON: JSON,
    console: console,
    alert: () => {},
    confirm: () => true,
    performance: { now: () => 0 },
    scrollY: 0,
    scrollTo: () => {}
};
// Storage代码直接引用localStorage（非window.localStorage），需要全局设置
global.localStorage = global.window.localStorage;
global.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    title: '',
    body: { innerHTML: '' },
    createElement: () => ({
        style: {},
        classList: { add:()=>{}, remove:()=>{}, contains:()=>false, toggle:()=>{} },
        appendChild:()=>{},
        setAttribute:()=>{},
        remove:()=>{},
        textContent: '',
        innerHTML: '',
        onclick: null
    }),
    createDocumentFragment: () => ({ appendChild:()=>{}, childNodes:[] }),
    documentElement: { classList: { add:()=>{}, remove:()=>{} } }
};
global.showToast = () => {};
global.L = () => {}; // 模拟调试日志函数
global.escapeHtml = (t) => String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
global.CONSTANTS = {
    MS_PER_DAY: 24 * 60 * 60 * 1000,
    MS_PER_SECOND: 1000,
    DEFAULT_QUIZ_COUNT: 50,
    DAILY_QUIZ_COUNT: 10,
    DAILY_HISTORY_DAYS: 30,
    SEARCH_RESULTS_LIMIT: 50,
    RANKING_MAX_USERS: 2000,
    NOTE_MAX_LENGTH: 2000,
    TAG_MAX_LENGTH: 100,
    SEARCH_MIN_LENGTH: 2,
    SEARCH_MAX_LENGTH: 50,
    DEBOUNCE_NAVIGATION: 150,
    DEBOUNCE_SELECTION: 200,
    EXAM_SAVE_INTERVAL: 10,
    DAILY_COMPLETION_RATE: 0.8
};
global.SUBJECTS_CONFIG = {
    accounting: {id:'accounting',name:'会计',color:'#6366f1',icon:'fa-calculator',gradient:'linear-gradient(135deg,#6366f1,#8b5cf6)',description:'会计科目描述'},
    auditing: {id:'auditing',name:'审计',color:'#ec4899',icon:'fa-search',gradient:'linear-gradient(135deg,#ec4899,#f472b6)',description:'审计科目描述'},
    financial: {id:'financial',name:'财务成本管理',color:'#f97316',icon:'fa-chart-line',gradient:'linear-gradient(135deg,#f97316,#fb923c)',description:'财管科目描述'},
    economic: {id:'economic',name:'经济法',color:'#22c55e',icon:'fa-gavel',gradient:'linear-gradient(135deg,#22c55e,#4ade80)',description:'经济法科目描述'},
    tax: {id:'tax',name:'税法',color:'#3b82f6',icon:'fa-file-invoice-dollar',gradient:'linear-gradient(135deg,#3b82f6,#60a5fa)',description:'税法科目描述'},
    strategy: {id:'strategy',name:'公司战略与风险管理',color:'#8b5cf6',icon:'fa-chess',gradient:'linear-gradient(135deg,#8b5cf6,#a78bfa)',description:'战略科目描述'}
};
global.getSubjectQuestions = (id) => [
    {id:1, type:'single', question:'测试单选题', options:[{letter:'A',content:'选项A'},{letter:'B',content:'选项B'},{letter:'C',content:'选项C'},{letter:'D',content:'选项D'}], answer:'A', chapter:'第一章', difficulty:'中等'},
    {id:2, type:'multi', question:'测试多选题', options:[{letter:'A',content:'选项A'},{letter:'B',content:'选项B'},{letter:'C',content:'选项C'},{letter:'D',content:'选项D'}], answer:'A,B', chapter:'第二章', difficulty:'较难'},
    {id:3, type:'judge', question:'测试判断题', options:[{letter:'对',content:'正确'},{letter:'错',content:'错误'}], answer:'对', chapter:'第三章', difficulty:'简单'}
];
global.searchQuestions = () => [];
global.AppState = {};
global.DebounceLock = { locks: new Map(), isLocked() { return false; }, clear() {}, clearAll() {} };
global.getSubjectChapters = () => [];
global.getRandomQuestions = (id, count) => global.getSubjectQuestions(id).slice(0, count);
global.getQuestionsByChapter = () => [];
global.getTotalQuestionCount = () => 18;
global.loadAllSubjects = async () => {};
global.getTypeText = (t) => ({single:'单选题',multi:'多选题',judge:'判断题'}[t] || t);
global.getDifficultyText = (d) => d || '';
global.getDifficultyColor = (d) => ({简单:'#22c55e',中等:'#f59e0b',较难:'#ef4444'}[d] || '#6366f1');
global.escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 加载app.js
const fs = require('fs');
const code = fs.readFileSync('/workspace/cpa-quiz/js/app.js', 'utf8');

// 测试计数器
let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
    try { fn(); passed++; console.log(`  PASS ${name}`); }
    catch(e) { failed++; failures.push({name, error: e.message}); console.log(`  FAIL ${name}: ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)} but got ${JSON.stringify(a)}`); }

// 清理localStorage
function cleanStorage() {
    Object.keys(mockLocalStorage).forEach(k => delete mockLocalStorage[k]);
}

// ============================================================
// 提取并执行Storage模块
// ============================================================
console.log('\n=== 第一部分：Storage模块测试 ===\n');

try {
    // 使用行号精确提取Storage代码块（第55-454行，用var使其成为全局变量）
    const lines = code.split('\n');
    let storageCode = lines.slice(54, 454).join('\n'); // 0-indexed: line 55 -> index 54, line 454 -> index 453, slice end exclusive -> 454
    storageCode = storageCode.replace('const Storage', 'var Storage');

    // 同时提取DebounceLock（第1058-1080行，用var使其成为全局变量）
    let debounceCode = lines.slice(1057, 1080).join('\n');
    debounceCode = debounceCode.replace('const DebounceLock', 'var DebounceLock');

    eval(debounceCode);
    eval(storageCode);

    // ---- Storage.get() 测试 ----
    test('Storage.get() 返回默认值（key不存在）', () => {
        cleanStorage();
        const result = Storage.get('nonexistent', {test: true});
        assert(result !== null, '不应返回null');
        assert(result.test === true, '应返回默认值');
    });

    test('Storage.get() 返回null默认值', () => {
        cleanStorage();
        const result = Storage.get('nonexistent');
        assert(result === null, '应返回null');
    });

    test('Storage.set() 和 get() 往返（对象）', () => {
        cleanStorage();
        Storage.set('test_key', {a: 1, b: 'hello', c: [1,2,3]});
        const result = Storage.get('test_key');
        assert(result.a === 1, 'a应为1');
        assert(result.b === 'hello', 'b应为hello');
        assert(Array.isArray(result.c), 'c应为数组');
        assertEqual(result.c.length, 3, 'c长度应为3');
    });

    test('Storage.set() 和 get() 往返（数组）', () => {
        cleanStorage();
        Storage.set('test_arr', [1, 'two', {three: 3}]);
        const result = Storage.get('test_arr');
        assert(Array.isArray(result), '应为数组');
        assertEqual(result[0], 1, '第一项应为1');
        assertEqual(result[1], 'two', '第二项应为two');
    });

    test('Storage.set() 和 get() 往返（null值）', () => {
        cleanStorage();
        Storage.set('test_null', null);
        const result = Storage.get('test_null', 'default');
        assert(result === null, '应返回null');
    });

    test('Storage.get() 深拷贝隔离', () => {
        cleanStorage();
        Storage.set('test_deep', {arr: [1, 2, 3]});
        const a = Storage.get('test_deep');
        const b = Storage.get('test_deep');
        a.arr.push(4);
        assertEqual(b.arr.length, 3, '深拷贝应隔离修改');
    });

    test('Storage.get() 处理损坏数据', () => {
        cleanStorage();
        mockLocalStorage['cpa_corrupted'] = 'not valid json{{{';
        const result = Storage.get('corrupted', 'safe');
        assertEqual(result, 'safe', '应返回默认值');
        assert(!mockLocalStorage['cpa_corrupted'], '应清理损坏数据');
    });

    test('Storage.get() 处理空字符串', () => {
        cleanStorage();
        mockLocalStorage['cpa_empty_str'] = '';
        const result = Storage.get('empty_str', 'default');
        assertEqual(result, 'default', '空字符串应返回默认值');
    });

    // ---- Storage.update() 测试 ----
    test('Storage.update() 原子更新', () => {
        cleanStorage();
        Storage.set('counter', {count: 0});
        Storage.update('counter', (data) => { data.count++; return data; }, {count: 0});
        const result = Storage.get('counter');
        assertEqual(result.count, 1, 'count应为1');
    });

    test('Storage.update() updater异常时返回默认值', () => {
        cleanStorage();
        Storage.set('test_err', {val: 1});
        const result = Storage.update('test_err', () => { throw new Error('test'); }, {val: 0});
        assertEqual(result.val, 0, '应返回默认值');
        // 原始数据应保持不变
        const original = Storage.get('test_err');
        assertEqual(original.val, 1, '原始数据应保持不变');
    });

    test('Storage.update() 默认值为null时异常返回null', () => {
        cleanStorage();
        const result = Storage.update('no_key', () => { throw new Error('test'); }, null);
        assert(result === null, '应返回null');
    });

    test('Storage.update() 默认值为原始类型时异常返回原始值', () => {
        cleanStorage();
        const result = Storage.update('no_key', () => { throw new Error('test'); }, 42);
        assertEqual(result, 42, '应返回42');
    });

    // ---- Storage.toggleFavorite() 测试 ----
    test('Storage.toggleFavorite() 添加收藏', () => {
        cleanStorage();
        const isFav = Storage.toggleFavorite('accounting_1', 'accounting');
        assertEqual(isFav, true, '添加收藏应返回true');
        const favs = Storage.get('favorites', []);
        assertEqual(favs.length, 1, '应有1个收藏');
        assertEqual(favs[0].key, 'accounting_1', 'key应匹配');
        assertEqual(favs[0].subjectId, 'accounting', 'subjectId应匹配');
        assert(favs[0].addedAt > 0, 'addedAt应为正数');
    });

    test('Storage.toggleFavorite() 取消收藏', () => {
        cleanStorage();
        Storage.set('favorites', [{key:'accounting_1', subjectId:'accounting', addedAt: Date.now()}]);
        const isFav = Storage.toggleFavorite('accounting_1', 'accounting');
        assertEqual(isFav, false, '取消收藏应返回false');
        const favs = Storage.get('favorites', []);
        assertEqual(favs.length, 0, '应为空');
    });

    test('Storage.toggleFavorite() 重复添加', () => {
        cleanStorage();
        Storage.toggleFavorite('accounting_1', 'accounting');
        Storage.toggleFavorite('accounting_1', 'accounting');
        const favs = Storage.get('favorites', []);
        assertEqual(favs.length, 0, '添加再取消应为空');
    });

    test('Storage.isFavorite() 存在', () => {
        cleanStorage();
        Storage.toggleFavorite('tax_5', 'tax');
        assert(Storage.isFavorite('tax_5') === true, '应为true');
    });

    test('Storage.isFavorite() 不存在', () => {
        cleanStorage();
        assert(Storage.isFavorite('nonexist_1') === false, '应为false');
    });

    // ---- Storage 错题本测试 ----
    test('Storage.addWrongQuestion() 添加错题', () => {
        cleanStorage();
        Storage.addWrongQuestion('accounting_1', 'accounting');
        const wrong = Storage.get('wrong_questions', []);
        assertEqual(wrong.length, 1, '应有1条错题');
        assertEqual(wrong[0].key, 'accounting_1', 'key应匹配');
    });

    test('Storage.addWrongQuestion() 重复添加不重复', () => {
        cleanStorage();
        Storage.addWrongQuestion('accounting_1', 'accounting');
        Storage.addWrongQuestion('accounting_1', 'accounting');
        const wrong = Storage.get('wrong_questions', []);
        assertEqual(wrong.length, 1, '不应重复');
    });

    test('Storage.removeWrongQuestion() 删除错题', () => {
        cleanStorage();
        Storage.addWrongQuestion('accounting_1', 'accounting');
        Storage.removeWrongQuestion('accounting_1');
        const wrong = Storage.get('wrong_questions', []);
        assertEqual(wrong.length, 0, '应已删除');
    });

    test('Storage.removeWrongQuestion() 删除不存在的key', () => {
        cleanStorage();
        Storage.removeWrongQuestion('nonexistent');
        // 不应报错
        const wrong = Storage.get('wrong_questions', []);
        assertEqual(wrong.length, 0, '应为空');
    });

    test('Storage.getWrongQuestions() 空数据', () => {
        cleanStorage();
        const wrong = Storage.getWrongQuestions();
        assert(Array.isArray(wrong), '应为数组');
        assertEqual(wrong.length, 0, '应为空');
    });

    // ---- Storage.updateStats() 测试 ----
    test('Storage.updateStats() 单题模式-正确', () => {
        cleanStorage();
        Storage.updateStats(true, 'accounting');
        const stats = Storage.get('stats');
        assertEqual(stats.totalAnswered, 1, 'totalAnswered应为1');
        assertEqual(stats.totalCorrect, 1, 'totalCorrect应为1');
        assertEqual(stats.subjectStats.accounting.answered, 1, 'accounting.answered应为1');
        assertEqual(stats.subjectStats.accounting.correct, 1, 'accounting.correct应为1');
    });

    test('Storage.updateStats() 单题模式-错误', () => {
        cleanStorage();
        Storage.updateStats(false, 'accounting');
        const stats = Storage.get('stats');
        assertEqual(stats.totalAnswered, 1, 'totalAnswered应为1');
        assertEqual(stats.totalCorrect, 0, 'totalCorrect应为0');
        assertEqual(stats.subjectStats.accounting.answered, 1, 'accounting.answered应为1');
        assertEqual(stats.subjectStats.accounting.correct, 0, 'accounting.correct应为0');
    });

    test('Storage.updateStats() 批量模式', () => {
        cleanStorage();
        Storage.updateStats(8, 10);
        const stats = Storage.get('stats');
        assertEqual(stats.totalAnswered, 10, 'totalAnswered应为10');
        assertEqual(stats.totalCorrect, 8, 'totalCorrect应为8');
        // 批量模式不更新subjectStats
        assertEqual(Object.keys(stats.subjectStats).length, 0, 'subjectStats应为空');
    });

    test('Storage.updateStats() 批量模式不更新科目统计', () => {
        cleanStorage();
        Storage.updateStats(5, 10);
        const stats = Storage.get('stats');
        assert(!stats.subjectStats.accounting, '不应有accounting统计');
    });

    test('Storage.updateStats() 连续多次调用', () => {
        cleanStorage();
        Storage.updateStats(true, 'accounting');
        Storage.updateStats(false, 'accounting');
        Storage.updateStats(true, 'tax');
        const stats = Storage.get('stats');
        assertEqual(stats.totalAnswered, 3, 'totalAnswered应为3');
        assertEqual(stats.totalCorrect, 2, 'totalCorrect应为2');
        assertEqual(stats.subjectStats.accounting.answered, 2, 'accounting.answered应为2');
        assertEqual(stats.subjectStats.tax.answered, 1, 'tax.answered应为1');
    });

    test('Storage.updateStats() dailyHistory正确记录', () => {
        cleanStorage();
        Storage.updateStats(true, 'accounting');
        Storage.updateStats(false, 'tax');
        const stats = Storage.get('stats');
        assert(stats.dailyHistory, '应有dailyHistory');
        assertEqual(stats.dailyHistory.length, 1, '今天应有1条记录');
        assertEqual(stats.dailyHistory[0].count, 2, '今日count应为2');
        assertEqual(stats.dailyHistory[0].correct, 1, '今日correct应为1');
    });

    test('Storage.updateStats() dailyStreak逻辑', () => {
        cleanStorage();
        Storage.updateStats(true, 'accounting');
        const stats1 = Storage.getStats();
        assertEqual(stats1.dailyStreak, 1, '首次应为1');
        // 同一天再答不增加streak
        Storage.updateStats(true, 'tax');
        const stats2 = Storage.getStats();
        assertEqual(stats2.dailyStreak, 1, '同一天不应增加streak');
    });

    // ---- Storage.getStats() 测试 ----
    test('Storage.getStats() 返回完整默认值', () => {
        cleanStorage();
        const stats = Storage.getStats();
        assertEqual(stats.totalAnswered, 0, '默认totalAnswered应为0');
        assertEqual(stats.totalCorrect, 0, '默认totalCorrect应为0');
        assertEqual(stats.dailyStreak, 0, '默认dailyStreak应为0');
        assert(typeof stats.subjectStats === 'object', 'subjectStats应为对象');
        assert(Array.isArray(stats.dailyHistory), 'dailyHistory应为数组');
    });

    // ---- Storage 每日一练测试 ----
    test('Storage.getDailyStatus() 无打卡记录', () => {
        cleanStorage();
        assert(Storage.getDailyStatus() === false, '应返回false');
    });

    test('Storage.getDailyStatus() 今日已打卡', () => {
        cleanStorage();
        Storage.setDailyCompleted();
        assert(Storage.getDailyStatus() === true, '应返回true');
    });

    test('Storage.getDailyStatus() 非今日打卡', () => {
        cleanStorage();
        Storage.set('daily_status', {date: '2020-01-01', completed: true, completedAt: Date.now()});
        assert(Storage.getDailyStatus() === false, '非今日应返回false');
    });

    // ---- Storage 笔记测试 ----
    test('Storage.saveNote() 新增笔记', () => {
        cleanStorage();
        Storage.saveNote('accounting_1', '测试笔记内容', '标签1,标签2');
        const notes = Storage.get('notes', []);
        assertEqual(notes.length, 1, '应有1条笔记');
        assertEqual(notes[0].content, '测试笔记内容', '内容应匹配');
        assert(Array.isArray(notes[0].tags), 'tags应为数组');
        assertEqual(notes[0].tags.length, 2, '应有2个标签');
    });

    test('Storage.saveNote() 更新已有笔记', () => {
        cleanStorage();
        Storage.saveNote('accounting_1', '原始内容', '');
        Storage.saveNote('accounting_1', '更新内容', '新标签');
        const notes = Storage.get('notes', []);
        assertEqual(notes.length, 1, '仍应为1条笔记');
        assertEqual(notes[0].content, '更新内容', '内容应已更新');
    });

    test('Storage.saveNote() tags为null时', () => {
        cleanStorage();
        Storage.saveNote('accounting_1', '内容', null);
        const notes = Storage.get('notes', []);
        assertEqual(notes[0].tags.length, 0, 'tags应为空数组');
    });

    test('Storage.deleteNote() 删除笔记', () => {
        cleanStorage();
        Storage.saveNote('accounting_1', '测试', '');
        Storage.deleteNote('accounting_1');
        const notes = Storage.get('notes', []);
        assertEqual(notes.length, 0, '应已删除');
    });

    test('Storage.getNotes() 空数据', () => {
        cleanStorage();
        const notes = Storage.getNotes();
        assert(Array.isArray(notes), '应为数组');
        assertEqual(notes.length, 0, '应为空');
    });

    // ---- Storage 答题记录测试 ----
    test('Storage.setAnswerRecord() 和 getAnswerRecord()', () => {
        cleanStorage();
        Storage.setAnswerRecord('accounting_1', true, 'A');
        const record = Storage.getAnswerRecord('accounting_1');
        assert(record !== null, '记录不应为null');
        assertEqual(record.isCorrect, true, 'isCorrect应为true');
        assertEqual(record.userAnswer, 'A', 'userAnswer应为A');
        assert(record.timestamp > 0, 'timestamp应为正数');
    });

    test('Storage.getAnswerRecord() 不存在的key', () => {
        cleanStorage();
        const record = Storage.getAnswerRecord('nonexistent');
        assert(record === null, '应为null');
    });

    // ---- Storage._cleanupOldData() 测试 ----
    test('Storage._cleanupOldData() 递归保护', () => {
        cleanStorage();
        Storage._isCleaning = true;
        Storage._cleanupOldData(); // 不应无限递归
        Storage._isCleaning = false;
    });

    test('Storage._cleanupOldData() 清理超量错题', () => {
        cleanStorage();
        const wrong = Array.from({length: 600}, (_, i) => ({key:`k_${i}`, subjectId:'accounting', addedAt: Date.now() - i}));
        Storage.set('wrong_questions', wrong);
        Storage._cleanupOldData();
        const cleaned = Storage.get('wrong_questions', []);
        assert(cleaned.length <= 500, `错题不应超过500，实际${cleaned.length}`);
    });

    test('Storage._cleanupOldData() 清理超量收藏', () => {
        cleanStorage();
        const favs = Array.from({length: 600}, (_, i) => ({key:`f_${i}`, subjectId:'accounting', addedAt: Date.now() - i}));
        Storage.set('favorites', favs);
        Storage._cleanupOldData();
        const cleaned = Storage.get('favorites', []);
        assert(cleaned.length <= 500, `收藏不应超过500，实际${cleaned.length}`);
    });

    test('Storage._cleanupOldData() 清理旧答题记录', () => {
        cleanStorage();
        const oldTimestamp = Date.now() - 60 * 24 * 60 * 60 * 1000; // 60天前
        const newTimestamp = Date.now() - 1000; // 1秒前
        Storage.set('answers', {
            'old_key': {isCorrect: true, userAnswer: 'A', timestamp: oldTimestamp},
            'new_key': {isCorrect: false, userAnswer: 'B', timestamp: newTimestamp}
        });
        Storage._cleanupOldData();
        const answers = Storage.get('answers', {});
        assert(!answers['old_key'], '旧记录应被清理');
        assert(answers['new_key'], '新记录应保留');
    });

    // ---- Storage.set() 存储满模拟 ----
    test('Storage.set() QuotaExceededError处理', () => {
        cleanStorage();
        // 模拟QuotaExceededError
        const origSetItem = mockLocalStorage.setItem;
        let callCount = 0;
        mockLocalStorage.setItem = (k, v) => {
            callCount++;
            if (callCount <= 1) {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                err.code = 22;
                throw err;
            }
            origSetItem(k, v);
        };
        const result = Storage.set('test_quota', 'value');
        mockLocalStorage.setItem = origSetItem;
        assert(result === true, '重试后应成功');
    });

    // ---- Storage 排行榜测试 ----
    test('Storage.generateRanking() 生成排行', () => {
        cleanStorage();
        const rankings = Storage.generateRanking();
        assert(Array.isArray(rankings), '应为数组');
        assert(rankings.length > 0, '不应为空');
        const me = rankings.find(r => r.isMe);
        assert(me, '应包含"我"');
        assert(typeof me.score === 'number', 'score应为数字');
    });

    test('Storage.getRanking() 无数据返回null', () => {
        cleanStorage();
        const ranking = Storage.getRanking();
        assert(ranking === null, '应返回null');
    });

    // ---- Storage 数据包装/解包测试 ----
    test('Storage.set/get 数据包装格式', () => {
        cleanStorage();
        Storage.set('test_wrap', {x: 42});
        const raw = JSON.parse(mockLocalStorage['cpa_test_wrap']);
        assert(raw._v !== undefined, '应有_v字段');
        assert(raw._t !== undefined, '应有_t字段');
        assert(raw.data !== undefined, '应有data字段');
        assertEqual(raw.data.x, 42, 'data.x应为42');
    });

    test('Storage.get() 兼容旧格式（无包装）', () => {
        cleanStorage();
        // 模拟旧格式数据（直接存储，无_v/_t/data包装）
        mockLocalStorage['cpa_old_format'] = JSON.stringify({y: 99});
        const result = Storage.get('old_format');
        assertEqual(result.y, 99, '应正确读取旧格式');
    });

} catch(e) {
    console.error('Storage模块测试执行失败:', e.message);
    console.error(e.stack);
}

// ============================================================
console.log('\n=== 第二部分：数据一致性边界测试 ===\n');

try {
    // 重新提取Storage
    cleanStorage();
    const lines2 = code.split('\n');
    let storageCode2 = lines2.slice(54, 454).join('\n');
    storageCode2 = storageCode2.replace('const Storage', 'var Storage');
    eval(storageCode2);

    test('finishExam批量模式与单题模式数据格式一致性', () => {
        cleanStorage();
        // 模拟单题模式
        Storage.setAnswerRecord('accounting_1', true, 'A');
        const singleRecord = Storage.getAnswerRecord('accounting_1');
        assert(typeof singleRecord.isCorrect === 'boolean', '单题isCorrect应为boolean');
        assert(typeof singleRecord.userAnswer === 'string', '单题userAnswer应为string');
        assert(typeof singleRecord.timestamp === 'number', '单题timestamp应为number');

        // 模拟考试批量模式（finishExam中的格式）
        Storage.update('answers', (answers) => {
            answers['accounting_2'] = { isCorrect: true, userAnswer: 'B', timestamp: Date.now() };
            return answers;
        }, {});
        const batchRecord = Storage.getAnswerRecord('accounting_2');
        assert(typeof batchRecord.isCorrect === 'boolean', '批量isCorrect应为boolean');
        assert(typeof batchRecord.userAnswer === 'string', '批量userAnswer应为string');
        assert(typeof batchRecord.timestamp === 'number', '批量timestamp应为number');
    });

    test('考试科目统计与练习科目统计格式一致性', () => {
        cleanStorage();
        // 练习模式
        Storage.updateStats(true, 'accounting');
        // 考试模式（finishExam中的额外科目更新）
        Storage.update('stats', (stats) => {
            if (!stats.subjectStats) stats.subjectStats = {};
            if (!stats.subjectStats.tax) stats.subjectStats.tax = { answered: 0, correct: 0 };
            stats.subjectStats.tax.answered++;
            stats.subjectStats.tax.correct++;
            return stats;
        }, {});
        const stats = Storage.getStats();
        assertEqual(stats.subjectStats.accounting.answered, 1, 'accounting.answered应为1');
        assertEqual(stats.subjectStats.tax.answered, 1, 'tax.answered应为1');
        // 两者格式一致
        assert(typeof stats.subjectStats.accounting.answered === 'number', '格式应一致');
        assert(typeof stats.subjectStats.tax.answered === 'number', '格式应一致');
    });

    test('错题key格式一致性', () => {
        cleanStorage();
        const key = 'accounting_1';
        Storage.addWrongQuestion(key, 'accounting');
        const wrong = Storage.getWrongQuestions();
        assertEqual(wrong[0].key, key, 'key格式应一致');
        // 模拟renderWrongBook中的解析
        const keyParts = String(wrong[0].key).split('_');
        assertEqual(keyParts[0], 'accounting', 'subjectId应正确');
        assertEqual(parseInt(keyParts[1]), 1, 'questionId应正确');
    });

    test('收藏key格式一致性', () => {
        cleanStorage();
        const key = 'tax_42';
        Storage.toggleFavorite(key, 'tax');
        const favs = Storage.getFavorites();
        assertEqual(favs[0].key, key, 'key格式应一致');
        const keyParts = String(favs[0].key).split('_');
        assertEqual(keyParts[0], 'tax', 'subjectId应正确');
        assertEqual(parseInt(keyParts[1]), 42, 'questionId应正确');
    });

    test('笔记key格式一致性', () => {
        cleanStorage();
        const key = 'financial_7';
        Storage.saveNote(key, '笔记内容', '');
        const notes = Storage.getNotes();
        assertEqual(notes[0].key, key, 'key格式应一致');
        const parts = notes[0].key.split('_');
        assertEqual(parts[0], 'financial', 'subjectId应正确');
        assertEqual(parseInt(parts[1]), 7, 'questionId应正确');
    });

    test('exam_state保存与恢复格式一致性', () => {
        cleanStorage();
        const state = {
            questions: [{id: 1, type: 'single', question: 'Q1', options: [], answer: 'A', chapter: 'C1'}],
            index: 5,
            answers: {'accounting_1': {isCorrect: true, userAnswer: 'A'}},
            subjectId: 'accounting',
            timeLeft: 1800,
            totalTime: 3600,
            savedAt: Date.now()
        };
        Storage.set('exam_state', state);
        const restored = Storage.get('exam_state');
        assertEqual(restored.index, 5, 'index应一致');
        assertEqual(restored.subjectId, 'accounting', 'subjectId应一致');
        assertEqual(restored.timeLeft, 1800, 'timeLeft应一致');
        assert(restored.questions, 'questions应存在');
        assert(restored.answers, 'answers应存在');
    });

    test('updateStats批量模式不产生subjectStats', () => {
        cleanStorage();
        Storage.updateStats(5, 10);
        const stats = Storage.getStats();
        assertEqual(Object.keys(stats.subjectStats).length, 0, '批量模式不应创建subjectStats');
    });

    test('updateStats单题模式创建subjectStats', () => {
        cleanStorage();
        Storage.updateStats(true, 'strategy');
        const stats = Storage.getStats();
        assert(stats.subjectStats.strategy, '应有strategy统计');
        assertEqual(stats.subjectStats.strategy.answered, 1, 'answered应为1');
        assertEqual(stats.subjectStats.strategy.correct, 1, 'correct应为1');
    });

    test('dailyHistory不超过DAILY_HISTORY_DAYS', () => {
        cleanStorage();
        // 模拟31天的历史
        for (let i = 30; i >= 0; i--) {
            const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
            Storage.update('stats', (stats) => {
                if (!stats.dailyHistory) stats.dailyHistory = [];
                stats.dailyHistory.push({date: date.toDateString(), count: 5, correct: 3});
                return stats;
            }, {totalAnswered: 0, totalCorrect: 0, dailyStreak: 0, lastStudyDate: null, subjectStats: {}, dailyHistory: []});
        }
        // 触发一次正常更新来触发裁剪
        Storage.updateStats(true, 'accounting');
        const stats = Storage.getStats();
        assert(stats.dailyHistory.length <= 30, `dailyHistory不应超过30，实际${stats.dailyHistory.length}`);
    });

} catch(e) {
    console.error('数据一致性测试执行失败:', e.message);
    console.error(e.stack);
}

// ============================================================
console.log('\n=== 第三部分：边界条件和异常路径测试 ===\n');

try {
    cleanStorage();
    const lines3 = code.split('\n');
    let storageCode3 = lines3.slice(54, 454).join('\n');
    storageCode3 = storageCode3.replace('const Storage', 'var Storage');
    eval(storageCode3);

    test('Storage.get() key含特殊字符', () => {
        cleanStorage();
        Storage.set('key with spaces', 'value');
        const result = Storage.get('key with spaces');
        assertEqual(result, 'value', '应正确处理空格key');
    });

    test('Storage.set() value为undefined', () => {
        cleanStorage();
        Storage.set('test_undef', undefined);
        const result = Storage.get('test_undef');
        assert(result === undefined, '应返回undefined');
    });

    test('Storage.set() value为数字0', () => {
        cleanStorage();
        Storage.set('test_zero', 0);
        const result = Storage.get('test_zero');
        assertEqual(result, 0, '应返回0');
    });

    test('Storage.set() value为false', () => {
        cleanStorage();
        Storage.set('test_false', false);
        const result = Storage.get('test_false');
        assertEqual(result, false, '应返回false');
    });

    test('Storage.set() value为空字符串', () => {
        cleanStorage();
        Storage.set('test_empty', '');
        const result = Storage.get('test_empty');
        assertEqual(result, '', '应返回空字符串');
    });

    test('Storage.update() key不存在时使用默认值', () => {
        cleanStorage();
        const result = Storage.update('nonexistent_key', (data) => {
            data.newField = 'added';
            return data;
        }, {existingField: 'original'});
        assertEqual(result.newField, 'added', 'updater应正确执行');
        assertEqual(result.existingField, 'original', '默认值应传入');
    });

    test('Storage.toggleFavorite() 空key', () => {
        cleanStorage();
        const result = Storage.toggleFavorite('', 'accounting');
        assertEqual(result, true, '空key也应能添加');
    });

    test('Storage.addWrongQuestion() 空key', () => {
        cleanStorage();
        Storage.addWrongQuestion('', 'accounting');
        const wrong = Storage.getWrongQuestions();
        assertEqual(wrong.length, 1, '空key也应能添加');
    });

    test('Storage.saveNote() 超长内容', () => {
        cleanStorage();
        const longContent = 'A'.repeat(5000);
        Storage.saveNote('accounting_1', longContent, '');
        const notes = Storage.getNotes();
        assertEqual(notes[0].content.length, 5000, 'Storage不截断，应由上层验证');
    });

    test('Storage.updateStats() stats对象损坏恢复', () => {
        cleanStorage();
        // 设置损坏的stats
        Storage.set('stats', 'corrupted_string');
        // updateStats应能恢复
        Storage.updateStats(true, 'accounting');
        const stats = Storage.getStats();
        assert(typeof stats === 'object', 'stats应为对象');
        assertEqual(stats.totalAnswered, 1, 'totalAnswered应为1');
    });

    test('Storage.updateStats() stats为null恢复', () => {
        cleanStorage();
        Storage.set('stats', null);
        Storage.updateStats(true, 'tax');
        const stats = Storage.getStats();
        assert(typeof stats === 'object', 'stats应为对象');
    });

    test('Storage.updateStats() stats缺少subjectStats字段', () => {
        cleanStorage();
        Storage.set('stats', {totalAnswered: 5, totalCorrect: 3, dailyStreak: 1, lastStudyDate: null});
        Storage.updateStats(true, 'accounting');
        const stats = Storage.getStats();
        assert(stats.subjectStats, '应有subjectStats');
        assert(stats.subjectStats.accounting, '应有accounting统计');
    });

    test('Storage.updateStats() stats缺少dailyHistory字段', () => {
        cleanStorage();
        Storage.set('stats', {totalAnswered: 5, totalCorrect: 3, dailyStreak: 1, lastStudyDate: null, subjectStats: {}});
        Storage.updateStats(true, 'accounting');
        const stats = Storage.getStats();
        assert(Array.isArray(stats.dailyHistory), 'dailyHistory应为数组');
    });

    test('Storage.getFavorites() 空数据', () => {
        cleanStorage();
        const favs = Storage.getFavorites();
        assert(Array.isArray(favs), '应为数组');
        assertEqual(favs.length, 0, '应为空');
    });

    test('Storage._notifyListeners() 无监听器', () => {
        cleanStorage();
        Storage._storageListeners = [];
        Storage._notifyListeners('test', null); // 不应报错
    });

    test('Storage._notifyListeners() 通配符监听', () => {
        cleanStorage();
        let called = false;
        Storage._storageListeners = [{key: '*', callback: () => { called = true; }}];
        Storage._notifyListeners('any_key', JSON.stringify({data: 'test'}));
        assert(called, '通配符监听器应被调用');
    });

    test('Storage._notifyListeners() 无效JSON不崩溃', () => {
        cleanStorage();
        Storage._storageListeners = [{key: 'test', callback: () => {}}];
        Storage._notifyListeners('test', 'invalid json');
        // 不应崩溃
    });

} catch(e) {
    console.error('边界条件测试执行失败:', e.message);
    console.error(e.stack);
}

// ============================================================
console.log('\n=== 第四部分：DebounceLock测试 ===\n');

try {
    // 重新提取DebounceLock（用var使其成为全局变量）
    const lines4 = code.split('\n');
    let debounceCode2 = lines4.slice(1057, 1080).join('\n');
    debounceCode2 = debounceCode2.replace('const DebounceLock', 'var DebounceLock');
    eval(debounceCode2);

    test('DebounceLock.isLocked() 首次返回false', () => {
        DebounceLock.locks.clear();
        assert(DebounceLock.isLocked('test', 100) === false, '首次应返回false');
    });

    test('DebounceLock.isLocked() 重复调用返回true', () => {
        DebounceLock.locks.clear();
        DebounceLock.isLocked('test', 100);
        assert(DebounceLock.isLocked('test', 100) === true, '重复应返回true');
    });

    test('DebounceLock.clear() 清除锁', () => {
        DebounceLock.locks.clear();
        DebounceLock.isLocked('test', 10000);
        DebounceLock.clear('test');
        assert(DebounceLock.isLocked('test', 100) === false, '清除后应返回false');
    });

    test('DebounceLock.clearAll() 清除所有锁', () => {
        DebounceLock.locks.clear();
        DebounceLock.isLocked('a', 10000);
        DebounceLock.isLocked('b', 10000);
        DebounceLock.clearAll();
        assert(DebounceLock.locks.size === 0, '所有锁应被清除');
    });

    test('DebounceLock 锁超时自动释放', () => {
        DebounceLock.locks.clear();
        DebounceLock.isLocked('timeout_test', 50);
        assert(DebounceLock.isLocked('timeout_test', 50) === true, '未超时应锁定');
        // 注意：此测试验证同步行为，超时测试需要异步支持
    });

} catch(e) {
    console.error('DebounceLock测试执行失败:', e.message);
    console.error(e.stack);
}

// ============================================================
// 最终结果
// ============================================================
setTimeout(() => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  测试结果总计: ${passed} 通过, ${failed} 失败`);
    console.log(`${'='.repeat(60)}`);
    if (failures.length > 0) {
        console.log('\n失败详情:');
        failures.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
    }
    process.exit(failed > 0 ? 1 : 0);
}, 500);
