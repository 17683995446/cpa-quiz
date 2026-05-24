# CPA智刷 第七轮深度测试缺陷报告

> 测试日期：2026-05-18
> 测试范围：`/workspace/cpa-quiz/js/app.js` (2213行)、`/workspace/cpa-quiz/js/data.js` (267行)、`/workspace/cpa-quiz/index.html` (310行)
> 测试方法：完整代码人工审查，聚焦业务逻辑、导航流程、UI渲染、数据完整性、安全加固、逻辑缺陷

---

## 一、业务逻辑准确性

### BUG-001：每日一练题目可能重复出题
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：1931-1953
- **问题代码**：
```javascript
function startDailyPractice() {
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
    // ...
}
```
- **缺陷分析**：每次调用 `startDailyPractice()` 都会从全部题库中随机抽取10题。虽然 Fisher-Yates 洗牌本身不会产生重复，但**同一用户在一天内多次点击"再练一组"会得到完全不同的题目集合**，这与"每日一练"的概念存在语义矛盾。更关键的是，`renderDaily()` 页面中已完成状态下有"再练一组"按钮（第1899行），点击后调用 `startDailyPractice()`，但**不会重置 `dailyCompleted` 状态**，用户可以无限次练习，且每次题目都不同。
- **风险等级**：中
- **建议修复**：考虑为每日一练生成固定的题目种子（基于日期），确保同一天内每次进入看到的题目一致；或明确"再练一组"的语义是额外练习而非重复当日任务。

### BUG-002：排行榜每次调用 generateRanking() 产生不一致数据
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：268-301
- **问题代码**：
```javascript
generateRanking() {
    // ...
    const rankings = names.map((name, i) => ({
        name,
        avatar: name[0],
        color: colors[i % colors.length],
        score: Math.floor(Math.random() * 40) + 60,
        answered: Math.floor(Math.random() * 2000) + 500,
        correct: Math.floor(Math.random() * 1500) + 300
    }));
    // ...
    rankings.sort((a, b) => b.score - a.score);
    this.set('ranking', rankings);
    return rankings;
}
```
- **缺陷分析**：每次调用 `generateRanking()` 时，所有虚拟玩家的 `score`、`answered`、`correct` 都是随机生成的。虽然第一次生成后会缓存到 `localStorage`，但**如果用户清除存储或首次进入，每次刷新排行榜页面都会看到完全不同的排名**。此外，虚拟玩家的 `correct` 可能大于 `answered`（例如 answered=500, correct=1700），这在逻辑上不可能。
- **风险等级**：中
- **建议修复**：使用基于日期的伪随机种子生成虚拟玩家数据，确保同一天内排名一致；添加约束 `correct <= answered`。

### BUG-003：排行榜虚拟玩家 correct > answered 逻辑错误
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：283-285
- **问题代码**：
```javascript
score: Math.floor(Math.random() * 40) + 60,      // 60-99
answered: Math.floor(Math.random() * 2000) + 500,  // 500-2499
correct: Math.floor(Math.random() * 1500) + 300    // 300-1799
```
- **缺陷分析**：`answered` 的最小值为500，`correct` 的最大值为1799。当 `answered` 取到500-1799范围内的值时，`correct` 完全可能大于 `answered`，导致正确率超过100%的荒谬数据。
- **风险等级**：中
- **建议修复**：先确定 `answered`，再基于 `answered` 生成 `correct`，确保 `correct <= answered`。例如：`correct: Math.floor(Math.random() * answered * 0.8) + Math.floor(answered * 0.1)`。

### BUG-004：错题本中答对后移除，再答错时 addedAt 时间戳不更新
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：122-129
- **问题代码**：
```javascript
addWrongQuestion(questionKey, subjectId) {
    this.update('wrong_questions', (wrong) => {
        const data = wrong.data || wrong || [];
        if (!data.find(w => w.key === questionKey)) {
            data.push({ key: questionKey, subjectId, addedAt: Date.now() });
        }
        return data;
    }, []);
},
```
- **缺陷分析**：`addWrongQuestion` 使用 `find` 检查是否已存在，如果存在则不更新。这意味着：如果一道题曾经被加入错题本，答对后被移除，**再次答错时会被重新添加**（因为此时已不存在），`addedAt` 会更新为当前时间。这个行为本身是正确的。但问题在于：如果一道题**一直在错题本中**（从未被移除），反复答错时 `addedAt` 永远不会更新，用户无法知道最后一次做错的时间。错题本列表中显示的时间（第1584行 `new Date(item.addedAt).toLocaleDateString()`）始终是第一次加入的时间。
- **风险等级**：低
- **建议修复**：改为每次答错都更新 `addedAt` 时间戳，或增加 `lastWrongAt` 字段。

### BUG-005：收藏功能取消后再收藏，addedAt 时间正确更新
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：142-157
- **问题代码**：
```javascript
toggleFavorite(questionKey, subjectId) {
    let result = false;
    this.update('favorites', (favs) => {
        const data = favs.data || favs || [];
        const idx = data.findIndex(f => f.key === questionKey);
        if (idx >= 0) {
            data.splice(idx, 1);
            result = false;
        } else {
            data.push({ key: questionKey, subjectId, addedAt: Date.now() });
            result = true;
        }
        return data;
    }, []);
    return result;
},
```
- **缺陷分析**：此逻辑正确。取消收藏后 `splice` 移除，再次收藏时 `findIndex` 返回 -1，会重新 `push` 并设置新的 `addedAt`。**无缺陷**。
- **风险等级**：无
- **建议修复**：无需修复。

### BUG-006：getRandomQuestions 使用 Fisher-Yates 洗牌，真正随机且不重复
- **文件**：`/workspace/cpa-quiz/js/data.js`
- **行号**：181-202
- **缺陷分析**：使用标准 Fisher-Yates 洗牌算法，然后 `slice(0, count)` 取前N个。洗牌是原地修改副本数组，不会修改原始数据。**算法正确，不会产生重复题目**。但注意：如果 `count > questions.length`，会返回所有题目而不报错，这可能不是预期行为。
- **风险等级**：低
- **建议修复**：当请求题目数超过可用题目数时，可以给出提示或返回全部可用题目。

### BUG-007：每日一练完成判断逻辑 -- finishQuiz 中每日一练标记时机问题
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：950-953
- **问题代码**：
```javascript
function finishQuiz() {
    if (AppState.quizMode === 'daily') {
        Storage.setDailyCompleted();
    }
    // ...
}
```
- **缺陷分析**：`finishQuiz()` 在用户点击"完成"按钮时调用。但此时用户可能**并未答完所有10道题**。`finishQuiz` 直接标记每日一练为已完成，即使只答了1题也算完成。这意味着用户可以只答1题就完成每日打卡，违背了"每日一练"的初衷。
- **风险等级**：中
- **建议修复**：添加完成条件判断，例如要求至少答完80%的题目（8/10）才能标记为已完成。

---

## 二、复杂导航流程

### BUG-008：从考试中退出后，exam-taking 页面可能残留定时器
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：308-314
- **问题代码**：
```javascript
if (AppState.examTimer && page !== 'exam-taking') {
    if (!confirm('考试正在进行中，确定要离开吗？离开后考试将结束。')) return;
    clearInterval(AppState.examTimer);
    AppState.examTimer = null;
    Storage.set('exam_state', null);
}
```
- **缺陷分析**：当用户在考试中点击浏览器的后退按钮触发 `popstate` 事件时（第2178-2186行），会调用 `navigate(e.state.page, e.state.params || {}, false)`。此时如果 `e.state.page` 不是 `exam-taking`，会触发 confirm 对话框。但 `popstate` 事件处理中无法阻止默认行为（已经后退了），如果用户点击"取消"，`return` 语句只是阻止了 `navigate` 的后续执行，但浏览器URL已经改变。下次用户点击任何导航链接时，会再次触发 confirm，造成混乱。
- **风险等级**：高
- **建议修复**：在 `popstate` 事件处理中，如果当前有考试进行中，应该特殊处理（例如强制回到考试页面或直接结束考试），而不是让用户选择。

### BUG-009：从刷题模式切换到错题模式，题目数据可能混淆
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：1613-1624, 610-612
- **问题代码**：
```javascript
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

function startQuiz(params) {
    renderQuizQuestion();
}
```
- **缺陷分析**：`reviewWrongQuestion` 正确地重置了 `quizQuestions`、`quizIndex`、`quizAnswers` 和 `quizMode`。但 `navigate('quiz')` 调用 `startQuiz(params)` 时，`params` 为空对象 `{}`，`startQuiz` 只是调用 `renderQuizQuestion()`。这里没有问题。然而，如果用户在刷题模式（practice）中，通过错题本入口进入单道错题复习，`AppState.quizAnswers` 被清空为 `{}`，这意味着**之前刷题模式下的答题进度会丢失**。用户返回后无法恢复之前的刷题进度。
- **风险等级**：中
- **建议修复**：在切换模式前保存当前刷题进度，或在返回时恢复。

### BUG-010：每日一练完成后再次进入，"再练一组"按钮不会重置完成状态
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：1885-1903
- **问题代码**：
```javascript
if (isCompleted) {
    container.innerHTML = `
        // ...
        <button class="btn btn-primary" onclick="startDailyPractice()">
            <i class="fas fa-redo"></i> 再练一组
        </button>
        // ...
    `;
}
```
- **缺陷分析**：当每日一练已完成时，页面显示"已完成打卡"和"再练一组"按钮。点击"再练一组"调用 `startDailyPractice()`，进入新的答题。答题完成后 `finishQuiz()` 中会再次调用 `Storage.setDailyCompleted()`（幂等操作，无副作用）。但问题在于：**用户在"再练一组"的答题过程中，如果退出（点击返回），`dailyCompleted` 仍然保持已完成状态**，这是合理的。但如果用户在"再练一组"中一道题都没答就退出，然后再次进入每日一练页面，仍然显示"已完成"，无法区分是正式完成还是中途退出。
- **风险等级**：低
- **建议修复**：可以为"再练一组"设置一个独立的标志位，区分正式完成和额外练习。

### BUG-011：搜索结果中点击题目后返回，搜索结果不保留
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：2061, 343-346
- **问题代码**：
```javascript
// 搜索结果中点击题目
onclick="reviewWrongQuestion('${item.subjectId}', ${item.id})"

// navigate函数中的历史记录
if (addToHistory && page !== 'exam-taking') {
    const state = { page, params, timestamp: Date.now() };
    history.pushState(state, '', `#${page}`);
}
```
- **缺陷分析**：当用户在搜索结果页点击一道题目时，调用 `reviewWrongQuestion` -> `navigate('quiz')`，这会将新的状态推入浏览器历史。用户点击浏览器后退按钮时，会触发 `popstate` 事件，`e.state.page` 为 `'search'`，但 `e.state.params` 中没有 `keyword`（因为 `reviewWrongQuestion` 调用 `navigate('quiz')` 时没有传递搜索关键词参数）。`navigate('search', {}, false)` 会调用 `renderSearchResults(undefined)`，导致搜索结果页面显示为空或异常。
- **风险等级**：高
- **建议修复**：在 `navigate` 到 quiz 页面之前，保存当前搜索关键词到 `AppState`，或在 `popstate` 处理中恢复搜索关键词。

### BUG-012：笔记编辑中切换页面，笔记内容是否丢失
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：1033-1056, 1058-1060
- **问题代码**：
```javascript
function openNoteModal(questionKey, questionId) {
    AppState.noteEditingQuestion = questionKey;
    const modal = document.getElementById('noteModal');
    // ...
    modal.classList.add('show');
}

function closeNoteModal() {
    document.getElementById('noteModal').classList.remove('show');
}
```
- **缺陷分析**：笔记模态框是全局覆盖层（`modal-overlay`），不属于任何页面。当用户打开笔记编辑模态框后，如果通过浏览器导航（如点击底部导航栏）切换到其他页面，模态框不会被关闭（因为 `navigate` 函数中没有关闭模态框的逻辑）。模态框会一直显示在屏幕上，遮挡新页面的内容。此外，用户在模态框中输入的笔记内容**不会丢失**（因为输入框仍然存在），但用户体验很差。
- **风险等级**：中
- **建议修复**：在 `navigate` 函数开头添加关闭模态框的逻辑：`document.getElementById('noteModal')?.classList.remove('show')`。

---

## 三、UI渲染问题

### BUG-013：考试模式下判断题已选状态重复添加 'selected' 类
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：1307-1311
- **问题代码**：
```javascript
if (answered) {
    cls += ' selected';
    if (answered.userAnswer === opt) cls += ' selected';
}
```
- **缺陷分析**：当 `answered` 存在时，无条件添加 `' selected'`，然后又判断 `answered.userAnswer === opt` 再次添加 `' selected'`。这导致：
  1. 对于**已选中的选项**，`cls` 中会有两个 `' selected'`，虽然HTML类名重复不会导致渲染错误，但这是冗余代码。
  2. 更严重的是，对于**未选中的选项**，也会被添加 `' selected'` 类，导致考试模式下所有判断题选项都显示为已选中状态，无论用户实际选了什么。
- **风险等级**：高
- **建议修复**：删除第1308行的 `cls += ' selected';`，只保留条件判断。正确代码应为：
```javascript
if (answered && answered.userAnswer === opt) {
    cls += ' selected';
}
```

### BUG-014：renderQuizQuestion 中已答状态判断 -- answerRecord 优先级问题
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：629, 694-701, 717-729
- **问题代码**：
```javascript
const answerRecord = Storage.getAnswerRecord(questionKey);
const answered = AppState.quizAnswers[questionKey];
// ...
if (answered !== undefined) {
    // 显示当前会话的答题结果
} else if (answerRecord) {
    // 显示历史答题记录
}
```
- **缺陷分析**：当 `AppState.quizAnswers[questionKey]` 的值为 `{ isCorrect: false, userAnswer: 'A' }` 时，`answered !== undefined` 为 `true`，会优先显示当前会话的结果。这是正确的。但当用户在**错题本模式**下复习错题时（`reviewWrongAnswers` 函数，第1016行），`AppState.quizAnswers` 被清空为 `{}`，此时会回退到 `answerRecord`（历史记录），显示之前的答题结果。这意味着用户在错题复习时看到的始终是"上次答错"的记录，**无法重新作答**，因为 `answerRecord` 存在时会添加 `disabled` 类，禁用选项点击。
- **风险等级**：高
- **建议修复**：在错题复习模式下，应该忽略历史答题记录，允许用户重新作答。可以在 `renderQuizQuestion` 中增加模式判断，当 `AppState.quizMode === 'wrong'` 时不检查 `answerRecord`。

### BUG-015：多选题已选状态在切换题目后丢失
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：829-872
- **问题代码**：
```javascript
if (question.type === 'multi') {
    const currentAnswer = AppState.quizAnswers[questionKey]?.userAnswer || '';
    let selectedLetters = currentAnswer ? currentAnswer.split(',') : [];
    // ...
}
```
- **缺陷分析**：多选题的选择状态存储在 `AppState.quizAnswers[questionKey]` 中。但注意：多选题的选择状态只有在**点击"确认提交"**后才会保存到 `AppState.quizAnswers`（通过 `submitAnswer` 函数）。在用户选择多个选项但未确认时，选择状态仅通过DOM的 `selected` 类来维护。当用户切换到其他题目再切回来时，`renderQuizQuestion()` 会重新渲染DOM，此时 `AppState.quizAnswers[questionKey]` 为 `undefined`（因为未提交），所以多选题的已选状态会丢失。
- **风险等级**：高
- **建议修复**：在多选题选择时，将临时选择状态保存到 `AppState` 中（例如 `AppState.quizTempSelections[questionKey]`），在 `renderQuizQuestion` 中恢复临时选择状态。

### BUG-016：考试答题卡中已答/未答状态判断逻辑
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：1268-1360
- **缺陷分析**：考试模式（`renderExamQuestion`）中**没有题目导航面板**（答题卡）。刷题模式（`renderQuizQuestion`）中有题目导航面板（第644-672行），但考试模式中没有类似功能。用户在考试中无法快速跳转到特定题目或查看哪些题目已答/未答。这是一个功能缺失而非bug。
- **风险等级**：中（功能缺失）
- **建议修复**：在考试模式中也添加题目导航面板。

### BUG-017：长题目文本截断问题
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：1576, 1679
- **问题代码**：
```javascript
// 错题本中
<div class="question-text">${escapeHtml(question.question.substring(0, 80))}...</div>

// 收藏夹中
<div class="question-text">${escapeHtml(question.question.substring(0, 80))}...</div>
```
- **缺陷分析**：使用 `substring(0, 80)` 硬截断，如果题目文本恰好80个字符以内，仍然会显示 `...` 后缀，造成误导。例如，一个50个字符的题目会显示为 "50个字符的题目内容..."，用户可能以为题目被截断了。
- **风险等级**：低
- **建议修复**：改为条件截断：`${question.question.length > 80 ? escapeHtml(question.question.substring(0, 80)) + '...' : escapeHtml(question.question)}`。

### BUG-018：选项字母渲染与实际答案匹配问题
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：714-738
- **问题代码**：
```javascript
options.forEach((opt, i) => {
    const letter = String.fromCharCode(65 + i);
    // ...
    html += `
        <div class="${cls}">
            <span class="option-letter">${letter}</span>
            <span>${escapeHtml(opt.replace(/^[A-D][.、．]\s*/, ''))}</span>
        </div>
    `;
});
```
- **缺陷分析**：选项字母 `A/B/C/D` 是根据数组索引动态生成的（`String.fromCharCode(65 + i)`），而正确答案 `question.answer` 存储的也是字母（如 `"A"` 或 `"A,C"`）。如果题目数据中选项的顺序与答案字母不匹配（例如选项数组第一个元素实际对应答案B），则渲染会出错。这取决于数据质量。另外，`opt.replace(/^[A-D][.、．]\s*/, '')` 会移除选项文本开头的字母前缀，但如果选项文本不以字母开头（如 `"正确"` 或 `"错误"`），则不会移除任何内容，这是正确的。
- **风险等级**：低（取决于数据质量）
- **建议修复**：确保题目数据中选项顺序与答案字母一致。可以在加载数据时进行校验。

---

## 四、数据完整性

### BUG-019：Storage.get 方法的数据解包逻辑不一致
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：56-67, 102-105
- **问题代码**：
```javascript
// 基础 get 方法 - 返回原始解析结果（包含 _v, _t, data 包装）
get(key, defaultValue = null) {
    const data = localStorage.getItem(`cpa_${key}`);
    if (!data) return defaultValue;
    const parsed = JSON.parse(data);
    return parsed;  // 返回的是 { _v, _t, data: ... } 包装对象
},

// getAnswerRecord - 手动解包
getAnswerRecord(questionKey) {
    const answers = this.get('answers', {});
    return answers.data ? answers.data[questionKey] : answers[questionKey] || null;
},
```
- **缺陷分析**：`Storage.get()` 返回的是包含 `_v`、`_t`、`data` 的包装对象，但各处使用时需要手动解包（`answers.data || answers`）。这种模式非常脆弱：
  1. 如果 `set()` 方法被调用时 value 本身就有 `data` 属性（如 `{ data: { ... } }`），解包逻辑会出错。
  2. `getAnswerRecord` 中的 `answers.data ? answers.data[questionKey] : answers[questionKey]` 假设如果 `answers` 有 `data` 属性，则 `data` 是答案对象；否则 `answers` 本身是答案对象。但如果旧格式数据恰好某个答案的key是 `"data"`，会导致误判。
- **风险等级**：中
- **建议修复**：在 `get()` 方法中统一解包，直接返回 `data` 字段，而不是让每个调用者手动解包。

### BUG-020：数据迁移兼容性 -- 旧格式数据（无 data 包装）的兼容处理
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：102-105, 118-121, 138-141, 164-167, 193-203
- **问题代码**：
```javascript
getAnswerRecord(questionKey) {
    const answers = this.get('answers', {});
    return answers.data ? answers.data[questionKey] : answers[questionKey] || null;
},
getWrongQuestions() {
    const wrong = this.get('wrong_questions', []);
    return wrong.data || wrong || [];
},
```
- **缺陷分析**：所有 `getXxx` 方法都使用 `xxx.data || xxx` 模式来兼容新旧格式。但这种兼容有一个潜在问题：如果旧格式数据是一个数组（如 `[{key: ..., subjectId: ...}]`），而新格式是 `{ _v: 1, _t: ..., data: [...] }`，那么 `wrong.data` 会正确返回数组。但如果旧格式数据被 `get()` 方法返回后，它本身就是一个数组，`wrong.data` 为 `undefined`，会回退到 `wrong`（即数组本身），这是正确的。**然而**，如果旧格式数据是一个对象（如 `{ totalAnswered: 0, ... }`，即 stats），而该对象恰好没有 `data` 属性，`stats.data` 为 `undefined`，回退到 `stats` 本身，这也是正确的。所以当前兼容逻辑**基本正确**，但非常脆弱。
- **风险等级**：低
- **建议修复**：统一在 `get()` 方法中处理解包逻辑。

### BUG-021：多次快速切换科目，数据可能错乱
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：580-608
- **问题代码**：
```javascript
function startRandomQuiz(subjectId) {
    const questions = getRandomQuestions(subjectId, 50);
    // ...
    AppState.quizQuestions = questions;
    AppState.quizIndex = 0;
    AppState.quizAnswers = {};
    AppState.quizMode = 'practice';
    AppState.currentSubject = subjectId;
    navigate('quiz');
}
```
- **缺陷分析**：如果用户快速连续点击不同科目的"随机刷题"按钮，每次调用都会重置 `AppState` 并调用 `navigate('quiz')`。由于 `navigate` 是同步的（除了 `renderQuizQuestion`），快速点击不会导致竞态条件。但 `navigate` 中的 `history.pushState` 会在浏览器历史中留下多个条目，用户后退时可能遇到混乱。
- **风险等级**：低
- **建议修复**：添加防抖机制，防止快速连续点击。

### BUG-022：错题/收藏中的题目被删除后，列表处理
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：1548-1588, 1651-1691
- **问题代码**：
```javascript
filtered.forEach(item => {
    const questions = getSubjectQuestions(item.subjectId);
    // ...
    const question = questions.find(q => q.id === qId);
    if (!question) return;  // 静默跳过
    // ...
});
```
- **缺陷分析**：当题目数据被更新（如重新生成题库）导致某些题目ID不存在时，代码会静默跳过这些条目。但**这些无效的条目仍然保留在 `wrong_questions` 和 `favorites` 的 localStorage 中**，永远不会被清理。随着时间推移，无效条目可能积累。
- **风险等级**：低
- **建议修复**：在渲染错题本/收藏夹时，检测并清理无效条目；或提供"清理无效条目"的功能。

---

## 五、安全加固

### BUG-023：章节名中的单引号注入风险
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：557
- **问题代码**：
```javascript
html += `
    <div class="chapter-item" onclick="startChapterQuiz('${subjectId}', '${chapter.name.replace(/'/g, "\\'")}')">
```
- **缺陷分析**：虽然对单引号做了转义（`'` -> `\'`），但这种手动转义方式不够健壮。如果章节名中包含反斜杠 `\`，例如章节名为 `test\`，替换后会变成 `test\\'`，导致字符串提前终止。此外，如果章节名包含换行符、Unicode字符等，也可能导致问题。
- **风险等级**：中
- **建议修复**：使用 `encodeURIComponent` 对参数进行编码，在 `startChapterQuiz` 中使用 `decodeURIComponent` 解码。或使用事件委托而非内联 `onclick`。

### BUG-024：innerHTML 中的 XSS 风险 -- 搜索高亮
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：2055-2058
- **问题代码**：
```javascript
const highlightedQuestion = escapeHtml(item.question).replace(
    new RegExp(escapedKeyword, 'gi'),
    match => `<span class="search-highlight">${match}</span>`
);
```
- **缺陷分析**：这里先对 `item.question` 进行了 `escapeHtml` 处理，然后用搜索关键词进行替换。由于 `escapeHtml` 会将 `<` 转为 `&lt;`、`>` 转为 `&gt;`，替换后的 `<span>` 标签不会被转义（因为它是后插入的）。但 `match` 变量来自已经被 `escapeHtml` 处理过的文本，所以 `match` 中不会包含 HTML 标签。**然而**，如果搜索关键词本身包含 HTML 实体（如 `&lt;`），`escapedKeyword` 是对原始关键词进行正则转义，而 `match` 来自被 `escapeHtml` 处理过的文本，两者可能不匹配。例如，用户搜索 `<script>`，`escapeHtml` 后变成 `&lt;script&gt;`，但 `escapedKeyword` 是 `<script>` 的正则转义版本，无法匹配 `&lt;script&gt;`。
- **风险等级**：低
- **建议修复**：先进行搜索匹配，再对匹配结果进行高亮处理。或对搜索关键词也进行 `escapeHtml` 处理后再构建正则。

### BUG-025：用户输入（笔记内容）通过 innerHTML 渲染
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：1749
- **问题代码**：
```javascript
<div class="note-card-content">${escapeHtml(note.content)}</div>
```
- **缺陷分析**：笔记内容通过 `escapeHtml` 处理后再插入 innerHTML，这是正确的做法。`escapeHtml` 函数（第2082-2086行）使用 `div.textContent = text; return div.innerHTML;` 的方式，能有效防止 XSS。**此处无缺陷**。
- **风险等级**：无
- **建议修复**：无需修复。

### BUG-026：toggleFavorite 的 subjectId 参数缺失风险
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：1024-1028
- **问题代码**：
```javascript
function toggleFavorite(questionKey) {
    const isFav = Storage.toggleFavorite(questionKey, AppState.currentSubject);
    // ...
}
```
- **缺陷分析**：`toggleFavorite` 使用 `AppState.currentSubject` 作为 `subjectId`。但在每日一练模式（daily）中，`AppState.currentSubject` 被设置为第一道题的科目（第1950行 `selected[0]?._subjectId || 'accounting'`）。如果用户在每日一练中收藏了第二道题（属于不同科目），收藏记录中的 `subjectId` 会是错误的（第一道题的科目而非当前题目的科目）。后续在收藏夹中显示时，会显示错误的科目名称。
- **风险等级**：高
- **建议修复**：在 `toggleFavorite` 中，从当前题目获取正确的 `subjectId`，而不是依赖 `AppState.currentSubject`。类似地，`openNoteModal` 也有同样的问题。

### BUG-027：收藏夹中取消收藏的内联 onclick 注入风险
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：1680
- **问题代码**：
```javascript
<button class="btn btn-sm btn-outline-dark" onclick="event.stopPropagation();Storage.toggleFavorite('${item.key}','${item.subjectId}');renderFavorites();">
```
- **缺陷分析**：`item.key` 的格式为 `subjectId_questionId`（如 `accounting_123`），`item.subjectId` 是科目ID（如 `accounting`）。这些值都是系统生成的，不包含用户输入，因此**注入风险较低**。但如果 `item.key` 或 `item.subjectId` 因为数据损坏而包含特殊字符（如单引号），可能导致注入。
- **风险等级**：低
- **建议修复**：使用 `encodeURIComponent` 对参数进行编码。

---

## 六、其他逻辑缺陷

### BUG-028：startQuiz 函数忽略 params 参数
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：610-612
- **问题代码**：
```javascript
function startQuiz(params) {
    renderQuizQuestion();
}
```
- **缺陷分析**：`startQuiz` 接收 `params` 参数但完全忽略它。在 `navigate` 函数中（第362行），`startQuiz(params)` 被调用时传入 `params`，但 `startQuiz` 只调用 `renderQuizQuestion()`。这意味着通过 URL hash 传递的参数（如 `#quiz?index=5`）无法被处理。虽然当前代码中没有通过 URL 传递 quiz 参数的场景，但这是一个设计缺陷。
- **风险等级**：低
- **建议修复**：如果不需要参数，可以移除参数声明以避免混淆。

### BUG-029：考试模式下 prevQuestion/nextQuestion 边界处理
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：1400-1414
- **问题代码**：
```javascript
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
```
- **缺陷分析**：边界检查逻辑正确。但 `renderExamQuestion` 中（第1340行和第1345行）也有 `disabled` 属性来禁用边界按钮。然而，**`disabled` 属性只是视觉上禁用按钮，用户仍然可以通过 JavaScript 控制台调用 `nextExamQuestion()` 或 `prevExamQuestion()` 来越界**。虽然函数内部有边界检查不会导致错误，但这是一个防御性编程的考虑。
- **风险等级**：无
- **建议修复**：无需修复，当前逻辑已足够。

### BUG-030：examSelectOption 中多选题通过 DOM 查询获取已选选项
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：1382-1386
- **问题代码**：
```javascript
const selected = [];
document.querySelectorAll('.quiz-option.selected').forEach(opt => {
    const letterEl = opt.querySelector('.option-letter');
    if (letterEl) selected.push(letterEl.textContent);
});
```
- **缺陷分析**：`document.querySelectorAll('.quiz-option.selected')` 会选择页面上**所有**带有 `selected` 类的 `.quiz-option` 元素，而不仅仅是当前题目的选项。如果页面中存在其他已选中的选项元素（虽然当前代码中不太可能），会导致错误。更安全的做法是限定选择范围到当前题目卡片内。
- **风险等级**：中
- **建议修复**：使用更精确的选择器，例如 `document.querySelectorAll('#examTakingContainer .quiz-option.selected')`。

### BUG-031：navigate 函数中 confirm 取消后的状态不一致
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：308-314
- **问题代码**：
```javascript
if (AppState.examTimer && page !== 'exam-taking') {
    if (!confirm('考试正在进行中，确定要离开吗？离开后考试将结束。')) return;
    clearInterval(AppState.examTimer);
    AppState.examTimer = null;
    Storage.set('exam_state', null);
}
```
- **缺陷分析**：当用户在考试中点击导航链接并选择"取消"时，`return` 语句阻止了后续导航逻辑的执行。但此时导航链接的 `href="#"` 可能导致页面滚动到顶部（因为 `preventDefault` 没有被调用）。在 HTML 中（第24-50行），导航链接使用 `onclick="navigate('home')"` 而没有 `return false` 或 `event.preventDefault()`，所以点击链接后浏览器会执行默认的锚点跳转行为。
- **风险等级**：中
- **建议修复**：在导航链接的 `onclick` 中添加 `return false` 或 `event.preventDefault()`，或在 `navigate` 函数中处理事件对象。

### BUG-032：renderDaily 中随机推荐科目每次刷新不同
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：1906-1909
- **问题代码**：
```javascript
const subjectIds = Object.keys(SUBJECTS_CONFIG);
const randomSubjectId = subjectIds[Math.floor(Math.random() * subjectIds.length)];
const subject = SUBJECTS_CONFIG[randomSubjectId];
```
- **缺陷分析**：每次渲染每日一练页面时，推荐科目都是随机选择的。用户在每日一练页面和首页之间来回切换，会看到不同的推荐科目，体验不一致。
- **风险等级**：低
- **建议修复**：基于日期生成伪随机数，确保同一天内推荐科目一致。

### BUG-033：finishExam 中未答题的题目不计入统计，但也不计入错题
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：1436-1451
- **问题代码**：
```javascript
AppState.quizQuestions.forEach(q => {
    const qSubjectId = q._subjectId || AppState.currentSubject;
    const key = `${qSubjectId}_${q.id}`;
    const ans = AppState.quizAnswers[key];
    if (ans && ans.userAnswer && q.answer) {
        // 只处理已答题
        const isCorrect = String(ans.userAnswer).trim() === String(q.answer).trim();
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
```
- **缺陷分析**：未答题的题目（`ans` 为 `undefined`）不会被计入任何统计。这是合理的行为。但 `score` 的计算（第1453行 `Math.round((correct / total) * 100)`）使用的是 `total`（总题数）而非 `answered`（已答题数），这意味着**未答题的题目会被视为答错**，拉低分数。例如，50题的考试只答了10题且全对，得分只有20分而非100分。
- **风险等级**：中
- **建议修复**：明确评分规则。如果未答题视为0分，当前逻辑是正确的。但应该在UI上明确告知用户"未答题不计分"或"未答题视为错误"。

### BUG-034：reviewWrongAnswers 清空 quizAnswers 导致无法查看解析
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：1001-1019
- **问题代码**：
```javascript
function reviewWrongAnswers() {
    const wrongQuestions = AppState.quizQuestions.filter(q => {
        // ...
        return ans && !ans.isCorrect;
    });
    // ...
    AppState.quizQuestions = wrongQuestions;
    AppState.quizIndex = 0;
    AppState.quizAnswers = {};  // 清空答题记录
    AppState.quizMode = 'wrong';
    renderQuizQuestion();
}
```
- **缺陷分析**：`reviewWrongAnswers` 将 `quizAnswers` 清空为 `{}`，然后设置 `quizMode = 'wrong'`。由于 `quizAnswers` 为空，`renderQuizQuestion` 中 `answered` 为 `undefined`，会回退到 `answerRecord`（历史记录）。由于这些题目之前答错了，`answerRecord.isCorrect` 为 `false`，所以会显示错误解析。**但用户无法重新作答**（因为 `answerRecord` 存在时会禁用选项）。这与"查看错题"的预期行为一致（只是查看，不是重做）。
- **风险等级**：无（行为符合预期，但可以改进）
- **建议修复**：可以提供"重做错题"和"查看解析"两种模式。

### BUG-035：Storage.update 的原子操作并非真正原子
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：95-100
- **问题代码**：
```javascript
update(key, updater, defaultValue = null) {
    const current = this.get(key, defaultValue);
    const updated = updater(current);
    this.set(key, updated);
    return updated;
},
```
- **缺陷分析**：`update` 方法先 `get` 再 `set`，中间存在时间窗口。如果两个标签页同时调用 `update` 同一个 key，后执行的 `get` 可能获取到旧值，导致其中一个更新被覆盖。虽然代码中有 `Storage.init()` 监听 `storage` 事件，但 `_notifyListeners` 只是通知监听器，并不会自动合并更新。注释中提到"乐观锁机制"，但实际上 `_version` 字段只是递增，并没有在 `set` 时检查版本号是否匹配。
- **风险等级**：中
- **建议修复**：如果需要真正的跨标签页原子操作，可以在 `set` 时检查版本号，或在 `storage` 事件回调中重新加载数据。

### BUG-036：每日打卡连续天数计算 -- 首次学习时 dailyStreak 设为1
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：224-237
- **问题代码**：
```javascript
if (data.lastStudyDate !== today) {
    if (data.lastStudyDate === yesterday) {
        data.dailyStreak++;
    } else {
        data.dailyStreak = 1;
    }
    data.lastStudyDate = today;
}
```
- **缺陷分析**：当用户首次使用时，`lastStudyDate` 为 `null`，不等于 `today` 也不等于 `yesterday`，所以 `dailyStreak` 被设为 `1`。这是合理的。但如果用户在一天内多次答题，`lastStudyDate` 已经等于 `today`，不会进入 if 分支，`dailyStreak` 不会重复增加。这也是正确的。**然而**，如果用户昨天答过题（`lastStudyDate === yesterday`），今天第一次答题时 `dailyStreak++`，假设之前 `dailyStreak` 为 `0`（首次使用的第二天），增加后变为 `1`，这是正确的。**无缺陷**。
- **风险等级**：无
- **建议修复**：无需修复。

### BUG-037：searchQuestions 中 key_point / explanation 字段可能不存在
- **文件**：`/workspace/cpa-quiz/js/data.js`
- **行号**：213-219
- **问题代码**：
```javascript
if (
    q.question.toLowerCase().includes(lowerKeyword) ||
    q.key_point.toLowerCase().includes(lowerKeyword) ||
    q.explanation.toLowerCase().includes(lowerKeyword) ||
    q.chapter.toLowerCase().includes(lowerKeyword)
)
```
- **缺陷分析**：如果题目数据中某些题目缺少 `key_point` 或 `explanation` 字段（值为 `undefined`），调用 `.toLowerCase()` 会抛出 `TypeError: Cannot read property 'toLowerCase' of undefined`，导致搜索功能完全崩溃。
- **风险等级**：高
- **建议修复**：添加空值检查：`(q.key_point || '').toLowerCase()` 或使用可选链 `q.key_point?.toLowerCase()`。

### BUG-038：openNoteModal 中查找题目的逻辑不适用于跨科目场景
- **文件**：`/workspace/cpa-quiz/js/app.js`
- **行号**：1041
- **问题代码**：
```javascript
const question = AppState.quizQuestions.find(q => `${AppState.currentSubject}_${q.id}` === questionKey);
```
- **缺陷分析**：在每日一练模式中，`AppState.currentSubject` 是第一道题的科目，而 `questionKey` 是 `subjectId_questionId` 格式。如果当前题目不是第一道题的科目，`questionKey` 中的 `subjectId` 与 `AppState.currentSubject` 不匹配，导致找不到题目，笔记预览为空。
- **风险等级**：中
- **建议修复**：直接使用 `questionKey` 中的 `subjectId` 来查找题目，或从 `AppState.quizQuestions` 中使用 `_subjectId` 属性查找。

---

## 七、缺陷汇总

| 编号 | 风险等级 | 类别 | 简述 |
|------|---------|------|------|
| BUG-001 | 中 | 业务逻辑 | 每日一练"再练一组"每次题目不同，语义矛盾 |
| BUG-002 | 中 | 业务逻辑 | 排行榜每次刷新数据不一致 |
| BUG-003 | 中 | 业务逻辑 | 排行榜虚拟玩家 correct > answered |
| BUG-004 | 低 | 业务逻辑 | 错题本反复答错时 addedAt 不更新 |
| BUG-007 | 中 | 业务逻辑 | 每日一练只答1题即可完成打卡 |
| BUG-008 | 高 | 导航流程 | 浏览器后退按钮在考试中行为异常 |
| BUG-009 | 中 | 导航流程 | 切换到错题复习后刷题进度丢失 |
| BUG-011 | 高 | 导航流程 | 搜索结果页后退后搜索关键词丢失 |
| BUG-012 | 中 | 导航流程 | 笔记模态框在页面切换时不关闭 |
| BUG-013 | 高 | UI渲染 | 考试模式判断题所有选项都显示为已选中 |
| BUG-014 | 高 | UI渲染 | 错题复习时无法重新作答（显示历史记录） |
| BUG-015 | 高 | UI渲染 | 多选题未确认时切换题目丢失选择状态 |
| BUG-016 | 中 | UI渲染 | 考试模式缺少题目导航面板 |
| BUG-017 | 低 | UI渲染 | 短题目文本也显示截断省略号 |
| BUG-019 | 中 | 数据完整性 | Storage.get 数据解包逻辑脆弱 |
| BUG-022 | 低 | 数据完整性 | 无效错题/收藏条目不会被清理 |
| BUG-023 | 中 | 安全 | 章节名单引号转义不健壮 |
| BUG-026 | 高 | 安全/业务 | 每日一练中收藏/笔记的 subjectId 错误 |
| BUG-030 | 中 | 逻辑 | 考试多选题 DOM 选择器范围过大 |
| BUG-031 | 中 | 逻辑 | 导航 confirm 取消后页面滚动到顶部 |
| BUG-033 | 中 | 逻辑 | 考试未答题按0分计算但未明确告知 |
| BUG-035 | 中 | 数据完整性 | Storage.update 非真正原子操作 |
| BUG-037 | 高 | 数据完整性 | 搜索时字段缺失导致崩溃 |
| BUG-038 | 中 | 逻辑 | 笔记模态框跨科目查找题目失败 |

**统计**：
- **高风险**：7个（BUG-008, BUG-011, BUG-013, BUG-014, BUG-015, BUG-026, BUG-037）
- **中风险**：14个
- **低风险**：5个
- **无风险/信息**：3个

---

## 八、优先修复建议

### P0（立即修复）
1. **BUG-013**：考试模式判断题所有选项显示为已选中 -- 一行代码修复，影响严重
2. **BUG-037**：搜索时字段缺失导致崩溃 -- 添加可选链操作符
3. **BUG-014**：错题复习时无法重新作答 -- 添加模式判断
4. **BUG-015**：多选题选择状态丢失 -- 添加临时状态存储

### P1（尽快修复）
5. **BUG-026**：每日一练中收藏 subjectId 错误 -- 从题目获取正确的 subjectId
6. **BUG-011**：搜索结果后退关键词丢失 -- 保存搜索状态
7. **BUG-008**：考试中浏览器后退行为异常 -- 改进 popstate 处理
8. **BUG-003**：排行榜 correct > answered -- 添加数据约束

### P2（计划修复）
9. **BUG-007**：每日一练完成条件过于宽松
10. **BUG-012**：笔记模态框页面切换时不关闭
11. **BUG-031**：导航 confirm 取消后页面滚动
12. **BUG-019**：Storage.get 数据解包统一化
