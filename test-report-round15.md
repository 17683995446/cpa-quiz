# CPA智刷 - 第十五轮深度代码审计报告

**审计文件**: `/workspace/cpa-quiz/js/app.js`
**审计日期**: 2026-05-20
**审计范围**: 考试全流程数据一致性、跨功能状态污染、收藏夹/笔记跨页面一致性、排行榜功能、首页学习进度、数据损坏恢复

---

## 一、考试全流程数据一致性

### 缺陷 R15-001 [高危] - startExam() 难度筛选使用严格等于比较，无法匹配非整数难度

**位置**: `app.js` 第1431-1434行 + `data.js` 第233-234行

**问题描述**:
`startExam()` 中将 `difficulty` 参数通过 `parseInt()` 转为整数后传入 `getRandomQuestions()`，而 `getRandomQuestions()` 内部使用严格等于 (`===`) 进行过滤：

```javascript
// app.js:1432
if (difficulty !== 'all') filters.difficulty = parseInt(difficulty);

// data.js:234
questions = questions.filter(q => q.difficulty === filters.difficulty);
```

虽然 JSON 数据中 difficulty 确实为整数（1-5），`parseInt("3")` 也返回 `3`，逻辑上可以正确匹配。但这里存在一个**隐含的类型假设风险**：如果未来题目数据中 difficulty 字段为字符串 `"3"`（例如从外部 API 导入），则 `3 === "3"` 为 `false`，筛选将返回空数组，导致 `showToast('没有符合条件的题目')` 而用户无法理解原因。

**建议**: 在 `getRandomQuestions` 中使用宽松比较或统一类型转换：
```javascript
questions = questions.filter(q => Number(q.difficulty) === Number(filters.difficulty));
```

**严重程度**: 中危（当前数据格式一致，但缺乏防御性编程）

---

### 缺陷 R15-002 [高危] - 考试模式多选题答案存储格式与练习模式不一致

**位置**: `app.js` 第1649行 vs 第1107行

**问题描述**:
在考试模式 `examSelectOption()` 中，多选题答案存储时**缺少 `isCorrect` 字段**：

```javascript
// app.js:1649 - 考试模式
AppState.quizAnswers[questionKey] = { userAnswer: selected.sort().join(',') };
// 注意：没有 isCorrect 字段！

// app.js:1107 - 练习模式
AppState.quizAnswers[questionKey] = { isCorrect, userAnswer };
// 包含 isCorrect 字段
```

这导致两个严重后果：

1. **`renderQuizQuestion()` 在 exam_review 模式下判断答案状态时出错**：第845-848行的题目导航面板依赖 `ans.isCorrect` 来标记颜色：
   ```javascript
   if (ans !== undefined) {
       cls += ans.isCorrect ? ' answered' : ' wrong-item';
   }
   ```
   当 `ans.isCorrect` 为 `undefined` 时，`undefined ? ... : ...` 走 falsy 分支，所有考试题目在导航面板中都被标记为"错误"（`wrong-item`），即使答对了也是如此。

2. **`finishExam()` 重新计算 isCorrect，但 exam_review 模式使用的是原始 quizAnswers**：`reviewExamAnswers()`（第1797-1803行）保留原始 `quizAnswers` 进入 review 模式，此时 quizAnswers 中仍缺少 `isCorrect` 字段。

**建议**: 在 `examSelectOption()` 中暂不设置 `isCorrect`（因为考试中不应暴露对错），但在 `finishExam()` 批量计算后回填 `isCorrect` 到 `AppState.quizAnswers`：
```javascript
// finishExam() 中，计算完 isCorrect 后回填
AppState.quizQuestions.forEach(q => {
    const key = `${q._subjectId || AppState.currentSubject}_${q.id}`;
    const ans = AppState.quizAnswers[key];
    if (ans && ans.userAnswer && q.answer) {
        ans.isCorrect = String(ans.userAnswer).trim() === String(q.answer).trim();
    }
});
```

---

### 缺陷 R15-003 [中危] - finishExam() 批量写入后立即刷新页面，数据可能不完整

**位置**: `app.js` 第1721-1750行

**问题描述**:
`finishExam()` 中分四次独立的 `Storage.update()` 调用写入数据（答题记录、统计、错题添加、错题移除）。这四次操作不是原子性的：

```javascript
Storage.update('answers', ...);       // 第1次写入
Storage.updateStats(...);             // 第2次写入（内部调用 Storage.update('stats', ...)）
Storage.update('wrong_questions', ...); // 第3次写入
Storage.update('wrong_questions', ...); // 第4次写入
```

如果用户在第1次和第3次写入之间刷新页面（虽然 `beforeunload` 事件已处理考试场景，但考试已结束、定时器已清除后不再触发 `beforeunload` 保存），会导致：
- 答题记录已写入，但错题本未更新
- 统计数据已更新，但答题记录未写入

此外，`Storage.updateStats()` 使用了批量模式（传入两个数字），但内部打卡逻辑（第313-323行）仍然只处理当天日期。如果用户在跨日时刻（23:59:59 -> 00:00:00）完成考试，统计和打卡可能不一致。

**建议**: 考虑将所有考试结果打包为一个事务对象一次性写入，或至少在 `finishExam()` 完成后设置一个标志位，在 `init()` 中检测到不完整数据时进行修复。

---

### 缺陷 R15-004 [中危] - exam_review 模式下 renderQuizQuestion 无法正确显示考试答案

**位置**: `app.js` 第776-982行（renderQuizQuestion）+ 第1797-1803行（reviewExamAnswers）

**问题描述**:
`reviewExamAnswers()` 设置 `AppState.quizMode = 'exam_review'` 后调用 `navigate('quiz')`，而 `navigate('quiz')` 调用 `startQuiz(params)` -> `renderQuizQuestion()`。

在 `renderQuizQuestion()` 中：
- 第804行：`const answerRecord = (AppState.quizMode === 'wrong') ? null : Storage.getAnswerRecord(questionKey);`
- 当 `quizMode === 'exam_review'` 时，`answerRecord` 会从 `Storage.getAnswerRecord()` 读取，这会获取到 `finishExam()` 中批量写入的记录。
- 第806行：`const answered = AppState.quizAnswers[questionKey];` 也会获取到内存中的答案。

由于 R15-002 中指出考试模式答案缺少 `isCorrect` 字段，而 `finishExam()` 批量写入的 `Storage` 记录包含 `isCorrect`，所以 `answerRecord` 和 `answered` 的数据结构不一致。第935行 `const isCorrect = answered ? answered.isCorrect : answerRecord.isCorrect;` 中，`answered` 为 truthy 对象但 `answered.isCorrect` 为 `undefined`，最终 `isCorrect` 为 `undefined`（falsy），解析区始终显示"回答错误"。

**建议**: 与 R15-002 一起修复，确保 `AppState.quizAnswers` 在 `finishExam()` 后包含完整的 `isCorrect` 字段。

---

## 二、跨功能状态污染

### 缺陷 R15-005 [高危] - navigate() 函数不清理页面特定的 AppState 残留

**位置**: `app.js` 第404-535行

**问题描述**:
`navigate()` 函数在切换页面时**不清理** `AppState` 中的页面特定状态。以下状态在切换页面后会残留：

| 状态字段 | 设置位置 | 清理位置 | 是否在 navigate 中清理 |
|---------|---------|---------|---------------------|
| `quizQuestions` | startRandomQuiz/startExam 等 | 无（除了 startRandomQuiz） | 否 |
| `quizAnswers` | startRandomQuiz/startExam 等 | 无 | 否 |
| `quizMode` | startRandomQuiz/startExam 等 | 无 | 否 |
| `quizIndex` | startRandomQuiz/startExam 等 | 无 | 否 |
| `quizTempSelections` | startRandomQuiz 等 | 仅 startRandomQuiz/startChapterQuiz | 否 |
| `dailyCompleted` | 无（始终为 false） | 无 | 否 |
| `noteEditingQuestion` | openNoteModal | 无 | 否 |
| `lastSearchKeyword` | renderSearchResults | 无 | 否 |
| `examTimeLeft` | startExam | 仅 finishQuiz | 否 |
| `examTotalTime` | startExam | 仅 finishQuiz | 否 |

**具体影响场景**:

1. **从考试模式退出后残留**: 用户在考试中点"返回首页"（`navigate('home')`），`navigate()` 检测到 `AppState.examTimer` 存在会弹 confirm，但如果用户在 `finishExam()` 后（此时 timer 已清除）再导航到其他页面，`quizMode` 仍为 `'exam'`，`quizQuestions` 仍保留完整题目列表在内存中。

2. **从每日一练退出后残留**: `exitQuiz()` 导航到 `daily` 页面，但 `AppState.quizMode` 仍为 `'daily'`，`quizQuestions` 仍保留10道题。如果用户之后通过浏览器后退回到 quiz 页面，`startQuiz()` 会被调用，`renderQuizQuestion()` 会渲染残留的每日一练题目。

3. **从错题重做退出后残留**: `reviewWrongAnswers()` 设置 `quizMode = 'wrong'`，退出后 `quizMode` 不被清理。

4. **`noteEditingQuestion` 永不清理**: 一旦打开过笔记模态框，`AppState.noteEditingQuestion` 就永远保留最后一个编辑的题目 key。虽然当前代码中 `saveNote()` 会检查它是否存在，但如果用户在非刷题页面通过某种方式触发 `saveNote()`，可能会将笔记关联到错误的题目。

**建议**: 在 `navigate()` 函数中添加状态清理逻辑：
```javascript
// 在 navigate() 的页面切换逻辑前添加
if (page !== 'quiz' && page !== 'exam-taking') {
    AppState.quizQuestions = [];
    AppState.quizAnswers = {};
    AppState.quizIndex = 0;
    AppState.quizTempSelections = {};
    AppState.quizMode = 'practice';
    AppState.examTimeLeft = 0;
    AppState.examTotalTime = 0;
}
AppState.noteEditingQuestion = null;
```

---

### 缺陷 R15-006 [低危] - dailyCompleted 状态字段从未被有效使用

**位置**: `app.js` 第40行

**问题描述**:
`AppState.dailyCompleted = false` 在初始化时设置，但整个代码中没有任何地方将其设置为 `true`。每日一练的完成状态完全依赖 `Storage.getDailyStatus()` 从 localStorage 读取。这个字段是一个"死状态"，容易误导开发者以为存在内存级别的完成标志。

**建议**: 移除该字段，或在 `finishQuiz()` 的 daily 模式分支中同步设置它。

---

## 三、收藏夹和笔记的跨页面一致性

### 缺陷 R15-007 [中危] - renderFavorites() 中删除收藏后，刷题页面的收藏按钮状态不会更新

**位置**: `app.js` 第2020行 + 第1265-1272行

**问题描述**:
在收藏夹页面删除收藏的代码为：
```javascript
// app.js:2020（内联在 HTML 中）
onclick="event.stopPropagation();Storage.toggleFavorite('${...}','${...}');renderFavorites();"
```

这段代码直接调用 `Storage.toggleFavorite()` 并刷新收藏夹列表 `renderFavorites()`。但如果用户之前在另一个浏览器标签页中打开了刷题页面，刷题页面的收藏按钮状态不会更新。

即使在同一标签页中，由于收藏夹页面和刷题页面不会同时显示（SPA 单页面），这个问题在实际使用中影响有限。但 `Storage` 模块已经实现了 `onChange` 监听器和 `storage` 事件监听（第57-79行），却没有被收藏夹/笔记功能利用。

**建议**: 注册 `Storage.onChange('favorites', callback)` 监听器，在收藏变化时更新当前页面的收藏按钮状态。或者由于是 SPA，在从收藏夹页面返回刷题页面时，`renderQuizQuestion()` 会重新渲染，此时会重新调用 `Storage.isFavorite()` 获取最新状态，所以**当前实现在单标签页场景下是正确的**。降级为低危。

**修正严重程度**: 低危

---

### 缺陷 R15-008 [低危] - renderNotes() 中删除笔记后，刷题页面的笔记图标不会更新

**位置**: `app.js` 第2083行

**问题描述**:
与 R15-007 类似，笔记删除后仅刷新笔记列表页面：
```javascript
onclick="Storage.deleteNote('${note.key}');renderNotes();showToast('笔记已删除','success')"
```

在单标签页 SPA 中，由于笔记页面和刷题页面互斥显示，返回刷题时会重新渲染，影响有限。但 `renderQuizQuestion()` 中并没有"显示该题是否有笔记"的图标指示器，所以实际上不存在"笔记图标状态不一致"的问题。

**修正严重程度**: 信息（非缺陷）

---

### 缺陷 R15-009 [中危] - 笔记保存后，笔记列表页面不自动刷新

**位置**: `app.js` 第1311-1340行（saveNote）

**问题描述**:
`saveNote()` 保存笔记后调用 `closeNoteModal()` 关闭模态框，但不刷新笔记列表页面。由于笔记模态框是在刷题页面（quiz 页面）中打开的，保存后用户仍在刷题页面，笔记列表页面不可见，所以不存在"不刷新"的问题。

但如果用户从笔记列表页面进入某道题（当前代码中笔记列表没有"进入题目"的功能），则可能存在不一致。当前代码中 `renderNotes()` 的笔记卡片没有提供跳转到对应题目的功能，所以这个场景不存在。

**修正严重程度**: 信息（当前代码路径下不存在此问题）

---

## 四、排行榜功能

### 缺陷 R15-010 [中危] - generateRanking() 排行榜数据每次刷新都重新随机生成

**位置**: `app.js` 第360-398行

**问题描述**:
`generateRanking()` 每次调用都使用 `Math.random()` 生成全新的模拟数据。虽然生成后会存入 localStorage（`this.set('ranking', rankings)`），但 `renderRanking()` 的逻辑是：

```javascript
let rankings = Storage.getRanking();  // 从 localStorage 读取
if (!rankings) {
    rankings = Storage.generateRanking();  // 仅在无缓存时生成
}
```

问题在于：`Storage.getRanking()` 调用 `this.get('ranking', null)`，而 `Storage.get()` 内部会检查 `parsed.data !== undefined`（第89行），如果存储的数据格式为 `{_v, _t, data: [...]}`，则正确返回 `data`。但如果因为某种原因（如 `_cleanupOldData()` 或存储满清理）导致 `ranking` 键被删除，每次访问排行榜都会重新生成完全不同的排名数据，用户体验不连贯。

**建议**: 在 `generateRanking()` 中使用基于日期的种子随机数，确保同一天内生成的排行榜数据一致。

---

### 缺陷 R15-011 [低危] - 排行榜数据可能包含 NaN 值

**位置**: `app.js` 第369行

**问题描述**:
```javascript
const myScore = Math.round((myStats.totalCorrect / Math.max(myStats.totalAnswered, 1)) * 100);
```

这里使用了 `Math.max(myStats.totalAnswered, 1)` 防止除零，所以 `myScore` 不会是 NaN。模拟用户数据中：
```javascript
r.correct = Math.floor(Math.random() * Math.floor(r.answered * 0.8)) + Math.floor(r.answered * 0.1);
r.score = Math.round((r.correct / r.answered) * 100);
```

`r.answered` 最小值为 500（`Math.floor(Math.random() * 2000) + 500`），所以不会为零，`r.score` 也不会是 NaN。

但存在一个边界问题：`r.correct` 的计算方式为 `random * floor(r.answered * 0.8) + floor(r.answered * 0.1)`，最大值可能超过 `r.answered`。例如当 `r.answered = 500` 时：
- `floor(500 * 0.8) = 400`
- `floor(500 * 0.1) = 50`
- `r.correct` 最大为 `399 + 50 = 449`，不超过 500

当 `r.answered = 501` 时：
- `floor(501 * 0.8) = 400`
- `floor(501 * 0.1) = 50`
- `r.correct` 最大为 `399 + 50 = 449`，不超过 501

看起来 `correct <= answered` 的约束在第380-383行的注释中声称已修复（BUG-003），但实际上 `correct` 的最大值为 `floor(answered * 0.8) - 1 + floor(answered * 0.1)`，约为 `answered * 0.9 - 1`，始终小于 `answered`。所以正确率不会超过 100%。

**修正严重程度**: 无缺陷（数据正确）

---

### 缺陷 R15-012 [中危] - 排行榜渲染存在 XSS 风险

**位置**: `app.js` 第2322-2332行

**问题描述**:
排行榜渲染中，`item.name`、`item.avatar`、`item.color` 直接插入 HTML 而未转义：

```javascript
html += `
    <div class="ranking-item ${topClass}" style="${item.isMe ? '...' : ''}">
        <div class="ranking-position">${index + 1}</div>
        <div class="ranking-avatar" style="background:${item.color}">${item.avatar}</div>
        <div class="ranking-info">
            <div class="ranking-name">${item.name} ${item.isMe ? '(我)' : ''}</div>
            <div class="ranking-detail">答题 ${item.answered} · 正确 ${item.correct}</div>
        </div>
        <div class="ranking-score">${item.score}分</div>
    </div>
`;
```

**攻击向量分析**:
- `item.name` 和 `item.avatar` 来自硬编码的 `names` 数组（第361-364行），是可信数据源，不存在注入风险。
- `item.color` 来自硬编码的 `colors` 数组（第365-366行），也是可信的。
- `item.answered`、`item.correct`、`item.score` 是数字类型，不存在 XSS 风险。
- 但 `item.isMe` 是布尔值，用于条件渲染，安全。

**然而**，排行榜数据会存入 localStorage。如果攻击者通过浏览器开发者工具修改 localStorage 中的 `cpa_ranking` 数据，注入恶意 name 或 color 值，则下次加载时会执行 XSS。虽然这是"自攻击"场景（攻击者只能攻击自己），但在 CSP（Content Security Policy）较弱的场景下仍可能被利用。

**建议**: 对所有动态数据使用 `escapeHtml()` 处理，特别是 `item.name` 和 `item.avatar`：
```javascript
<div class="ranking-name">${escapeHtml(item.name)} ${item.isMe ? '(我)' : ''}</div>
<div class="ranking-avatar" style="background:${escapeHtml(item.color)}">${escapeHtml(item.avatar)}</div>
```

---

## 五、首页学习进度展示

### 缺陷 R15-013 [低危] - 学习进度环的计算依赖 subjectStats，可能遗漏部分答题记录

**位置**: `app.js` 第554-555行

**问题描述**:
```javascript
const subjectStat = stats.subjectStats[subject.id] || { answered: 0, correct: 0 };
const progress = total > 0 ? Math.round((subjectStat.answered / total) * 100) : 0;
```

`subjectStats` 仅在**单题模式**下更新（`updateStats` 第304行 `if (singleSubjectId)`），而考试模式的批量更新（`finishExam` 第1731行 `Storage.updateStats(batchStats.totalCorrect, batchStats.totalAnswered)`）使用的是批量模式，`singleSubjectId` 为 `null`，不会更新 `subjectStats`。

这意味着：**通过考试模式答对的题目不会计入任何科目的学习进度**。用户在考试中答了50道会计题，首页会计科目的"已答题数"不会增加，进度环不会更新。

**影响范围**: 首页科目进度条、科目详情页的进度信息、统计页面的各科目正确率环形图。

**建议**: 在 `finishExam()` 中，按科目分组统计后分别调用 `Storage.updateStats()` 更新各科目的 `subjectStats`，而不是使用批量模式。

---

### 缺陷 R15-014 [中危] - 连续打卡天数计算不跨月/跨年

**位置**: `app.js` 第313-323行

**问题描述**:
```javascript
const today = new Date().toDateString();
const yesterday = new Date(Date.now() - CONSTANTS.MS_PER_DAY).toDateString();

if (stats.lastStudyDate !== today) {
    if (stats.lastStudyDate === yesterday) {
        stats.dailyStreak++;
    } else {
        stats.dailyStreak = 1;
    }
    stats.lastStudyDate = today;
}
```

`toDateString()` 返回格式为 `"Wed May 20 2026"`，包含了星期信息。这里使用 `toDateString()` 比较日期是正确的，因为同一时区下相同的日期会产生相同的字符串。

**但是**，这里存在一个**跨日边界问题**：`CONSTANTS.MS_PER_DAY = 24 * 60 * 60 * 1000`（86400000ms），而 `Date.now() - 86400000` 并不总是等于"昨天同一时刻"。在夏令时切换时（虽然中国标准时间没有夏令时，但代码应考虑国际化），这个计算可能偏差1小时。

更重要的是，`toDateString()` 使用**本地时区**，如果用户在午夜前后（如 23:59 到 00:01）使用应用：
- 23:59 答题，`lastStudyDate` 设为 "Wed May 20 2026"
- 00:01 再次答题，`today` 为 "Thu May 21 2026"，`yesterday` 计算为 `Date.now() - 86400000` 的 `toDateString()`，即 "Wed May 20 2026"
- 匹配成功，`dailyStreak++`

这个逻辑在**非夏令时地区**是正确的。但代码没有处理以下边界情况：

1. **用户长时间未使用后回来**: `lastStudyDate` 为 "Mon May 10 2026"，今天为 "Wed May 20 2026"，`yesterday` 为 "Tue May 19 2026"，不匹配，`dailyStreak` 重置为 1。这是**预期行为**。

2. **时区变化**: 用户从中国飞到美国，`toDateString()` 基于本地时区，可能导致日期跳变。但这是极端场景。

**修正严重程度**: 低危（在目标用户群体（中国CPA考生）的使用场景下基本不会触发）

---

### 缺陷 R15-015 [信息] - 首页快捷入口的点击目标正确

**位置**: `app.js` 第562行

**问题描述**:
首页科目卡片使用 `onclick="navigate('subjects', {subjectId: '${subject.id}'})"` 进行导航，`subject.id` 来自硬编码的 `SUBJECTS_CONFIG`，是可信值。点击目标正确，不存在问题。

---

## 六、数据损坏恢复

### 缺陷 R15-016 [中危] - Storage.get() 在 JSON.parse 失败时静默删除数据，可能导致级联数据丢失

**位置**: `app.js` 第81-99行

**问题描述**:
```javascript
get(key, defaultValue = null) {
    try {
        const data = localStorage.getItem(`cpa_${key}`);
        if (!data) return defaultValue;
        const parsed = JSON.parse(data);
        const raw = parsed.data !== undefined ? parsed.data : parsed;
        return JSON.parse(JSON.stringify(raw));
    } catch (e) {
        try {
            localStorage.removeItem(`cpa_${key}`);
        } catch (cleanupErr) { /* ignore */ }
        return defaultValue;
    }
}
```

当 `JSON.parse` 失败时（例如数据被手动篡改或存储损坏），代码会**静默删除**该键并返回默认值。这可能导致：

1. **级联丢失**: 如果 `answers` 数据损坏，所有答题记录被清空，但 `stats` 中的 `totalAnswered`/`totalCorrect` 仍保留旧值，导致正确率计算与实际不符。
2. **无恢复机制**: 被删除的数据无法恢复，用户甚至不知道数据已丢失。
3. **不区分错误类型**: `JSON.parse` 失败和 `JSON.stringify` 失败（深拷贝时）都被同一个 catch 捕获。如果数据中包含不可序列化的值（如 `undefined`、函数、Symbol），`JSON.parse(JSON.stringify(raw))` 会在 `stringify` 阶段失败，导致有效数据被误删。

**建议**:
1. 区分 parse 错误和 stringify 错误
2. 添加数据损坏日志（即使不输出到 console，也应记录到某个错误追踪中）
3. 考虑在删除前备份损坏数据

```javascript
get(key, defaultValue = null) {
    try {
        const data = localStorage.getItem(`cpa_${key}`);
        if (!data) return defaultValue;
        const parsed = JSON.parse(data);
        const raw = parsed.data !== undefined ? parsed.data : parsed;
        try {
            return JSON.parse(JSON.stringify(raw));
        } catch (cloneErr) {
            // 深拷贝失败，返回浅拷贝而非删除数据
            return raw;
        }
    } catch (e) {
        // 仅在 JSON.parse 失败时删除
        try { localStorage.removeItem(`cpa_${key}`); } catch (cleanupErr) {}
        return defaultValue;
    }
}
```

---

### 缺陷 R15-017 [低危] - 循环引用导致 JSON.stringify 失败的风险

**位置**: `app.js` 第91行 + 第177行

**问题描述**:
`Storage.get()` 第91行使用 `JSON.parse(JSON.stringify(raw))` 进行深拷贝，`Storage.update()` 第177行同样使用此模式。

如果 `raw` 对象中存在循环引用（例如 `a.b = a`），`JSON.stringify` 会抛出 `TypeError: Converting circular structure to JSON`。在 `Storage.get()` 中，这会被外层 catch 捕获，导致数据被误删（R15-016）。在 `Storage.update()` 中，会被 catch 捕获并返回默认值的深拷贝。

**当前风险评估**:
- 题目数据来自 JSON 文件，不存在循环引用
- `AppState` 中的数据由代码逻辑构建，正常流程不会产生循环引用
- 但 `saveExamState()` 将 `AppState.quizQuestions`（包含题目对象）存入 localStorage，如果题目对象被外部修改添加了循环引用，则恢复时会触发此问题

**修正严重程度**: 低危（正常使用下不会触发）

---

### 缺陷 R15-018 [中危] - 数据恢复后 UI 不更新

**位置**: `app.js` 第81-99行 + 全局

**问题描述**:
当 `Storage.get()` 检测到数据损坏并返回默认值后，当前正在渲染的 UI 不会自动更新。例如：

1. 用户在刷题页面，`Storage.get('answers', {})` 返回空对象（因为数据损坏被删除）
2. `renderQuizQuestion()` 中的 `answerRecord` 为 `null`，之前已答过的题目显示为"未答"状态
3. 用户不会收到任何关于数据损坏的通知

**建议**: 在 `Storage.get()` 的 catch 块中触发一个全局事件或回调，通知 UI 层数据已损坏：
```javascript
catch (e) {
    try { localStorage.removeItem(`cpa_${key}`); } catch (cleanupErr) {}
    // 通知数据损坏
    this._notifyListeners('_corruption', { key, error: e.message });
    return defaultValue;
}
```

---

## 七、其他发现

### 缺陷 R15-019 [低危] - finishQuiz() 中 examTotalTime 可能未定义

**位置**: `app.js` 第1182行

**问题描述**:
```javascript
AppState.examTotalTime = 0; // 清理残留考试时间
```

`AppState` 的初始定义中（第30-46行）没有 `examTotalTime` 字段。它仅在 `startExam()`（第1446行）中被设置。在 `finishQuiz()` 中直接赋值为 0 是安全的（JavaScript 允许给对象添加新属性），但在严格模式下或使用 linting 工具时可能产生警告。

**建议**: 在 `AppState` 初始化中添加 `examTotalTime: 0`。

---

### 缺陷 R15-020 [信息] - _cleanupOldData() 中使用 console.error

**位置**: `app.js` 第168行

**问题描述**:
```javascript
} catch (e) {
    console.error('清理旧数据失败:', e);
}
```

代码注释（第93行）提到"修复BUG-R10-036：生产环境不输出console"，但 `_cleanupOldData()` 中仍使用了 `console.error`。这不一致。

---

## 缺陷汇总

| 编号 | 严重程度 | 类别 | 简述 |
|------|---------|------|------|
| R15-001 | 中危 | 数据一致性 | 难度筛选使用严格等于，缺乏类型防御 |
| R15-002 | **高危** | 数据一致性 | 考试多选题答案缺少 isCorrect，导致 review 模式全标错误 |
| R15-003 | 中危 | 数据一致性 | finishExam 四次非原子写入，中途刷新可能数据不完整 |
| R15-004 | 中危 | 数据一致性 | exam_review 模式解析区始终显示"回答错误" |
| R15-005 | **高危** | 状态污染 | navigate() 不清理页面特定状态，多模式残留 |
| R15-006 | 低危 | 状态污染 | dailyCompleted 字段从未被有效使用 |
| R15-007 | 低危 | 跨页面一致性 | 收藏删除后跨标签页不同步（已有基础设施未使用） |
| R15-008 | 信息 | 跨页面一致性 | 笔记删除后刷题页面影响有限 |
| R15-009 | 信息 | 跨页面一致性 | 笔记保存后列表刷新在当前代码路径下无问题 |
| R15-010 | 中危 | 排行榜 | 排行榜数据每次重新随机，体验不连贯 |
| R15-011 | 无缺陷 | 排行榜 | 排行榜数据不含 NaN（已验证） |
| R15-012 | 中危 | 排行榜 | 排行榜渲染未转义 localStorage 数据，存在存储注入风险 |
| R15-013 | 低危 | 学习进度 | 考试模式答题不计入科目进度 |
| R15-014 | 低危 | 学习进度 | 打卡计算在目标场景下正确 |
| R15-015 | 信息 | 学习进度 | 首页快捷入口正确 |
| R15-016 | 中危 | 数据恢复 | JSON.parse 失败时静默删除数据，深拷贝失败也触发删除 |
| R15-017 | 低危 | 数据恢复 | 循环引用风险在正常使用下不会触发 |
| R15-018 | 中危 | 数据恢复 | 数据损坏恢复后 UI 不更新，用户无感知 |
| R15-019 | 低危 | 其他 | examTotalTime 未在 AppState 初始化中定义 |
| R15-020 | 信息 | 其他 | _cleanupOldData 中残留 console.error |

**统计**: 高危 2 个，中危 7 个，低危 5 个，信息 4 个，无缺陷 1 个

---

## 优先修复建议

1. **[P0] R15-002 + R15-004**: 在 `finishExam()` 中回填 `isCorrect` 到 `AppState.quizAnswers`，修复 exam_review 模式的核心功能缺陷
2. **[P0] R15-005**: 在 `navigate()` 中添加页面特定状态的清理逻辑
3. **[P1] R15-016**: 区分 `JSON.parse` 和 `JSON.stringify` 的错误处理，避免深拷贝失败导致数据误删
4. **[P1] R15-013**: 在 `finishExam()` 中按科目分别更新 `subjectStats`
5. **[P2] R15-012**: 对排行榜渲染数据使用 `escapeHtml()` 处理
6. **[P2] R15-003**: 考虑将考试结果打包为单一事务写入
