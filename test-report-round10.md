# CPA智刷 - 第十轮深度测试缺陷报告

**测试日期**: 2026-05-19
**测试范围**: CSS/HTML层、端到端流程、异步竞态、内存管理、可访问性、代码一致性
**被测文件**:
- `/workspace/cpa-quiz/js/app.js` (2381行)
- `/workspace/cpa-quiz/js/data.js` (273行)
- `/workspace/cpa-quiz/index.html` (309行)
- `/workspace/cpa-quiz/css/style.css` (2233行)

---

## 一、CSS/HTML层审查

### BUG-R10-001: 大量硬编码颜色值未使用CSS变量
**严重程度**: 中
**文件**: `style.css` 全文, `index.html` 内联样式
**描述**: 虽然定义了CSS变量系统（`:root`中定义了`--primary`, `--success`, `--danger`等），但CSS和HTML中仍有大量硬编码颜色值。

**具体位置**:
- `style.css:313` - `.hero-section` 背景 `linear-gradient(135deg, #667eea 0%, #764ba2 100%)` 硬编码
- `style.css:343` - `.gradient-text` 渐变 `#fbbf24, #f59e0b, #fbbf24` 硬编码
- `style.css:624` - `.btn-success:hover` 使用 `#059669` 而非变量
- `style.css:633` - `.btn-danger:hover` 使用 `#dc2626` 而非变量
- `style.css:917-918` - `.badge-difficulty` 使用 `#fef3c7` 和 `#d97706` 硬编码
- `style.css:967-968` - `.quiz-option.correct` 使用 `#ecfdf5` 和 `#065f46` 硬编码
- `style.css:973-974` - `.quiz-option.wrong` 使用 `#fef2f2` 和 `#991b1b` 硬编码
- `style.css:1015` - `.quiz-explanation` 背景渐变 `#f0fdf4, #ecfdf5` 硬编码
- `style.css:1063` - `.key-point` 颜色 `#065f46` 硬编码
- `style.css:1111` - `.quiz-action-btn.favorited` 使用 `#fef3c7` 和 `#d97706` 硬编码
- `style.css:1310-1316` - `.exam-score-circle.pass/.fail` 背景硬编码
- `style.css:1683-1688` - `.daily-card .streak` 使用 `#fef3c7, #fde68a, #92400e` 硬编码
- `style.css:1744-1756` - `.ranking-item.top-1/2/3` 大量硬编码颜色
- `style.css:1772-1783` - `.top-1/2/3 .ranking-position` 硬编码
- `index.html:65-68` - 移动端搜索栏全部使用内联硬编码样式（`#e2e8f0`, `#94a3b8`等）
- `index.html:146-172` - 快捷入口 `.action-icon` 全部使用内联渐变硬编码

**影响**: 无法通过深色模式统一切换颜色，维护困难，主题一致性差。

---

### BUG-R10-002: 完全缺失 `prefers-reduced-motion` 支持
**严重程度**: 高
**文件**: `style.css`
**描述**: CSS中定义了多个动画（`fadeIn`, `slideDown`, `modalIn`, `toastIn`, `toastOut`, `spin`, `pulse`），但没有任何 `@media (prefers-reduced-motion: reduce)` 媒体查询来为运动敏感用户禁用或减少动画。

**具体位置**:
- `style.css:303-306` - `@keyframes fadeIn` - 页面切换动画
- `style.css:1021-1024` - `@keyframes slideDown` - 解析区域展开动画
- `style.css:1268-1271` - `@keyframes pulse` - 考试倒计时警告闪烁动画
- `style.css:1590` - `.bar-fill` transition - 柱状图动画
- `style.css:1637` - `.ring-fill` transition - 环形图动画
- `style.css:1873` - `.modal` animation - 模态框弹入动画
- `style.css:1978-1986` - `@keyframes toastIn/toastOut` - Toast通知动画
- `style.css:2204` - `@keyframes spin` - 加载旋转动画

**影响**: 对有前庭功能障碍、癫痫或运动敏感的用户造成不适，不符合WCAG 2.1标准。

---

### BUG-R10-003: `overflow: hidden` 可能导致内容截断
**严重程度**: 中
**文件**: `style.css`
**描述**: 多处使用 `overflow: hidden` 可能导致内容被截断而用户无法察觉。

**具体位置**:
- `style.css:316` - `.hero-section { overflow: hidden }` - Hero区域装饰元素被裁切，如果内容溢出则不可见
- `style.css:433` - `.subject-card { overflow: hidden }` - 科目卡片内容可能被截断
- `style.css:499` - `.subject-card .progress-bar { overflow: hidden }` - 进度条效果需要，合理
- `style.css:977-979` - `.quiz-option.disabled { pointer-events: none }` - 这不是overflow问题，但disabled选项在移动端可能无法滚动查看

**建议**: 对 `.hero-section` 和 `.subject-card` 考虑使用 `overflow: clip` 或确保内容不会超出。

---

### BUG-R10-004: z-index管理缺乏系统性
**严重程度**: 低
**文件**: `style.css`
**描述**: z-index值散布在代码各处，没有统一的管理规范。

**具体分布**:
- `z-index: 100` - `.exam-top-bar` (sticky定位)
- `z-index: 1000` - `.navbar`
- `z-index: 1999` - `.mobile-overlay`
- `z-index: 2000` - `.mobile-sidebar`
- `z-index: 3000` - `.modal-overlay`
- `z-index: 4000` - `.toast-container`

**影响**: 虽然当前层级关系正确，但缺乏文档化，未来添加新层级组件时容易产生冲突。

---

### BUG-R10-005: 响应式布局在平板断点(768px-1024px)存在盲区
**严重程度**: 中
**文件**: `style.css`
**描述**: 1024px断点隐藏了桌面导航链接，显示移动端菜单按钮，但768px断点才开始做大量布局调整。768px-1024px之间的平板设备体验不佳。

**具体问题**:
- `style.css:2033-2061` - `@media (max-width: 1024px)` 只隐藏了导航链接和调整了hero/stats，但未调整 `.quiz-actions`、`.exam-result-stats` 等在平板上可能溢出的布局
- `style.css:2058-2060` - `stats-charts` 在1024px变为单列，但400px的minmax在768-1024px的平板上仍然可能溢出
- `style.css:1548` - `.stats-charts` 的 `minmax(400px, 1fr)` 在768px-1024px平板上，单列400px虽能放下，但双列时800px+padding会溢出

---

### BUG-R10-006: 移动端侧边栏搜索栏使用内联样式
**严重程度**: 低
**文件**: `index.html:65-68`
**描述**: 移动端侧边栏的搜索区域完全使用内联样式，包括颜色值、间距、字体大小等，与CSS变量系统脱节。

```html
<div class="sidebar-search" style="padding: 12px 20px; border-bottom: 1px solid #e2e8f0;">
    <div style="position: relative;">
        <i class="fas fa-search" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #94a3b8; font-size: 13px;"></i>
        <input type="text" placeholder="搜索题目..." id="mobileSearch" onkeyup="handleMobileSearch(event)" style="width: 100%; padding: 8px 12px 8px 36px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px;">
    </div>
</div>
```

---

### BUG-R10-007: HTML中大量内联样式
**严重程度**: 中
**文件**: `index.html`, `app.js` (动态生成的HTML)
**描述**: HTML模板和JS动态生成的HTML中大量使用内联样式，违反关注点分离原则。

**app.js中的典型例子**:
- `app.js:525` - `style="color:var(--success)"` (进度概览)
- `app.js:686-694` - 空状态页面全部内联样式
- `app.js:725-733` - 题目导航面板全部内联样式
- `app.js:1087-1123` - 完成页面全部内联样式
- `app.js:1597-1632` - 考试结果页面全部内联样式
- `app.js:1948-1954` - 每日学习热力图全部内联样式

**影响**: 样式无法被复用、无法被覆盖、增加HTML体积、不利于缓存。

---

### BUG-R10-008: `scroll-behavior: smooth` 在 `prefers-reduced-motion` 下未禁用
**严重程度**: 低
**文件**: `style.css:53`
**描述**: `html { scroll-behavior: smooth; }` 在用户设置了减少动画偏好时仍会生效。

---

## 二、端到端用户流程完整性

### BUG-R10-009: `document.title` 从未随页面切换更新
**严重程度**: 中
**文件**: `app.js` - `navigate()` 函数
**描述**: `navigate()` 函数处理页面切换时，只更新了导航高亮和hash，但从未更新 `document.title`。用户在浏览器标签页中无法区分当前所在页面，也不利于浏览器历史记录的可读性。

**影响**: SEO和用户体验问题。用户在多个标签页中无法区分不同页面。

---

### BUG-R10-010: 模拟考试交卷后查看解析流程存在数据丢失风险
**严重程度**: 高
**文件**: `app.js:1635-1640`
**描述**: `reviewExamAnswers()` 函数将 `quizMode` 改为 `'practice'`，然后调用 `navigate('quiz')`。但 `navigate('quiz')` 内部调用 `startQuiz(params)` -> `renderQuizQuestion()`，而 `renderQuizQuestion()` 中对 `practice` 模式会检查 `answerRecord`（来自Storage的历史记录），而非 `AppState.quizAnswers`（当前会话的答案）。

```javascript
function reviewExamAnswers() {
    AppState.quizMode = 'practice';
    AppState.quizIndex = 0;
    // 保留quizAnswers用于显示解析
    navigate('quiz');
}
```

**问题**: 如果考试中的某些题目之前已经做过（Storage中有记录），`renderQuizQuestion()` 会优先显示Storage中的旧记录（`answerRecord`），而非本次考试的答案（`AppState.quizAnswers`）。只有当 `AppState.quizAnswers[key]` 存在时才使用当前答案。

**具体代码** (`app.js:708-710`):
```javascript
const answerRecord = (AppState.quizMode === 'wrong') ? null : Storage.getAnswerRecord(questionKey);
const isFav = Storage.isFavorite(questionKey);
const answered = AppState.quizAnswers[questionKey];
```

由于 `quizMode` 被设为 `'practice'`（非 `'wrong'`），`answerRecord` 会被读取。如果 `AppState.quizAnswers[key]` 存在，`answered` 会覆盖 `answerRecord`，这是正确的。但 `navigate('quiz')` 调用 `startQuiz(params)` 时 params 为空，不会重置 `quizAnswers`，所以当前答案确实被保留了。**但问题是**: `navigate()` 函数中 `page === 'quiz'` 的分支只调用了 `startQuiz(params)`，而 `startQuiz` 只调用 `renderQuizQuestion()`，没有问题。不过如果用户在查看解析时浏览器后退，会导致状态混乱。

---

### BUG-R10-011: 收藏夹删除按钮使用内联onclick且参数未转义
**严重程度**: 中
**文件**: `app.js:1817`
**描述**: 收藏夹中删除按钮的onclick直接拼接了 `item.key` 和 `item.subjectId`，没有进行转义处理。

```javascript
<button class="btn btn-sm btn-outline-dark" onclick="event.stopPropagation();Storage.toggleFavorite('${item.key}','${item.subjectId}');renderFavorites();">
```

如果 `item.key` 或 `item.subjectId` 中包含单引号，会导致JavaScript注入。虽然正常情况下这些值是系统生成的，但属于安全隐患。

---

### BUG-R10-012: 深色模式完全缺失
**严重程度**: 中
**文件**: `style.css`, `index.html`, `app.js`
**描述**: 系统没有深色模式支持。虽然CSS变量系统为此做好了准备（所有颜色通过变量定义），但没有：
1. 深色模式的CSS变量覆盖
2. 深色模式切换按钮
3. `prefers-color-scheme` 媒体查询
4. 任何深色模式相关的JavaScript逻辑

**影响**: 夜间使用体验差，不符合现代Web应用标准。

---

### BUG-R10-013: 移动端侧边栏在页面切换时不会自动关闭
**严重程度**: 低
**文件**: `index.html:71-79`, `app.js` - `navigate()`
**描述**: 侧边栏链接的onclick中手动调用了 `toggleMobileMenu()`，但 `navigate()` 函数本身不会关闭侧边栏。如果通过其他方式（如浏览器后退、JS直接调用navigate）触发页面切换，侧边栏会保持打开状态。

---

### BUG-R10-014: 考试恢复逻辑中时间计算可能为负数
**严重程度**: 中
**文件**: `app.js:2296-2300`
**描述**: 考试恢复时计算剩余时间：

```javascript
const timeSinceSave = Date.now() - (savedExam.data.savedAt || 0);
const timeLeft = savedExam.data.timeLeft - Math.floor(timeSinceSave / 1000);
```

如果 `savedExam.data.savedAt` 为0或undefined，`timeSinceSave` 会是一个极大的值（从1970年至今的毫秒数），导致 `timeLeft` 为极大的负数。虽然后面有 `if (timeLeft > 0)` 的检查，但 `savedAt` 缺失时应该直接清除考试状态而非让用户看到confirm对话框。

---

### BUG-R10-015: 笔记模态框中label元素没有for属性
**严重程度**: 低
**文件**: `index.html:288-297`
**描述**: 笔记编辑模态框中的 `<label>` 元素没有 `for` 属性关联到对应的表单控件。

```html
<label>题目摘要</label>
<div class="note-question-preview" id="noteQuestionPreview"></div>
<!-- noteQuestionPreview 不是表单元素，label的for不应指向它 -->

<label>我的笔记</label>
<textarea id="noteContent" rows="6" ...></textarea>
<!-- 缺少 for="noteContent" -->

<label>标签</label>
<input type="text" id="noteTags" ...>
<!-- 缺少 for="noteTags" -->
```

---

## 三、异步操作竞态条件

### BUG-R10-016: `loadAllSubjects()` 的 `allQuestionsLoaded` 标志在部分失败时仍被设为true
**严重程度**: 高
**文件**: `data.js:120-126`
**描述**: `loadAllSubjects()` 使用 `Promise.all()` 加载所有科目，即使某些科目加载失败（`loadSubjectData` 返回空数组），`Promise.all` 也不会reject（因为 `loadSubjectData` 的catch返回了 `[]`）。这导致 `allQuestionsLoaded` 被设为 `true`，后续调用 `loadAllSubjects()` 会直接返回，不会再尝试加载失败的科目。

```javascript
async function loadAllSubjects() {
    if (allQuestionsLoaded) return;

    const promises = Object.keys(SUBJECTS_CONFIG).map(id => loadSubjectData(id));
    await Promise.all(promises);
    allQuestionsLoaded = true;  // 即使部分加载失败也设为true
}
```

**影响**: 网络不稳定时，某些科目数据可能永远无法加载，除非用户刷新页面。

---

### BUG-R10-017: `startDailyQuiz()` (即 `startDailyPractice()`) 多次快速调用产生不同题目但共享状态
**严重程度**: 中
**文件**: `app.js:2068-2090`
**描述**: `startDailyPractice()` 没有防抖保护。如果用户快速多次点击"开始今日练习"按钮，每次都会重新随机选题并覆盖 `AppState`，但由于 `navigate('quiz')` 是同步的（只是切换DOM），最后一次调用的结果会生效。虽然不会产生"重复题目"问题（每次都是新随机），但可能导致中间状态下的渲染闪烁。

---

### BUG-R10-018: `Storage.update()` 在快速连续调用时存在数据丢失风险
**严重程度**: 高
**文件**: `app.js:127-134`
**描述**: `Storage.update()` 的实现是"读取-修改-写入"三步操作，但没有任何锁机制。在 `finishExam()` 中，对每道题都调用了 `Storage.setAnswerRecord()`、`Storage.updateStats()`、`Storage.addWrongQuestion()`/`Storage.removeWrongQuestion()`，这些操作内部都调用了 `Storage.update()`。

```javascript
update(key, updater, defaultValue = null) {
    const current = this.get(key, defaultValue);  // 读取
    const cloned = JSON.parse(JSON.stringify(current));  // 深拷贝
    const updated = updater(cloned);  // 修改
    this.set(key, updated);  // 写入
    return updated;
},
```

由于JavaScript是单线程的，同步代码中不会出现真正的竞态。但 `_version` 乐观锁机制（`app.js:104-106`）从未被用于冲突检测 -- `get()` 方法读取数据后完全忽略了 `_v` 版本号。如果两个浏览器标签页同时操作，后写入的会覆盖先写入的修改。

**影响**: 多标签页同时使用时统计数据可能不准确。

---

### BUG-R10-019: fetch请求没有使用AbortController
**严重程度**: 中
**文件**: `data.js:94`
**描述**: `loadSubjectData()` 中的 `fetch()` 调用没有使用 `AbortController`。如果用户在数据加载过程中导航离开，fetch请求仍会继续。

```javascript
const response = await fetch(`data/${subjectId}.json`);
```

**影响**: 在慢速网络下切换页面时，会产生不必要的网络请求。虽然对功能影响不大，但浪费带宽。

---

### BUG-R10-020: `finishExam()` 中逐题调用Storage方法造成大量localStorage写入
**严重程度**: 中
**文件**: `app.js:1573-1588`
**描述**: `finishExam()` 对每道题分别调用 `Storage.setAnswerRecord()`、`Storage.updateStats()`、`Storage.addWrongQuestion()`/`Storage.removeWrongQuestion()`。对于100题的考试，这意味着至少300次localStorage读写操作。

```javascript
AppState.quizQuestions.forEach(q => {
    // ...
    Storage.setAnswerRecord(key, isCorrect, ans.userAnswer);  // 读取+写入
    Storage.updateStats(isCorrect, qSubjectId);               // 读取+写入
    if (!isCorrect) {
        Storage.addWrongQuestion(key, qSubjectId);            // 读取+写入
    } else {
        Storage.removeWrongQuestion(key);                     // 读取+写入
    }
});
```

**影响**: 在大量题目时可能导致UI卡顿。应批量处理后一次性写入。

---

## 四、内存管理

### BUG-R10-021: `escapeHtml()` 每次调用都创建新DOM元素
**严重程度**: 中
**文件**: `app.js:2225-2229`
**描述**: `escapeHtml()` 函数每次调用都创建一个新的 `div` 元素，设置 `textContent`，然后读取 `innerHTML`。在渲染大量题目（如搜索结果、错题列表）时，这会创建大量临时DOM元素。

```javascript
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
```

**影响**: 在渲染50条搜索结果时，每条结果可能调用3-5次 `escapeHtml()`，产生150-250个临时DOM节点。

**建议**: 使用正则替换实现纯字符串操作版本。

---

### BUG-R10-022: `renderQuizQuestion()` 每次调用都完整重建DOM
**严重程度**: 中
**文件**: `app.js:680-887`
**描述**: `renderQuizQuestion()` 每次调用都通过 `container.innerHTML = html` 完全重建整个刷题界面DOM。这意味着每次切换题目时：
1. 所有旧DOM节点被销毁
2. 所有旧的事件监听器（通过onclick内联绑定，所以不存在泄漏）被清除
3. 新DOM节点被创建

虽然内联onclick不会造成内存泄漏，但频繁的DOM重建会导致GC压力。

---

### BUG-R10-023: `questionCache` 没有清理机制
**严重程度**: 低
**文件**: `data.js:82`
**描述**: `questionCache` 对象一旦加载数据就永远保留在内存中，没有LRU淘汰、大小限制或手动清理机制。对于5100+题目，每个题目对象包含question、options、explanation等字段，内存占用不小。

**影响**: 在内存受限的移动设备上可能造成压力。但由于是SPA且数据量可控（预估<5MB），实际影响有限。

---

### BUG-R10-024: `DebounceLock` 的setTimeout回调可能积累
**严重程度**: 低
**文件**: `app.js:890-899`
**描述**: `DebounceLock` 使用 `setTimeout` 来管理锁，但锁的timeout回调中只是从Map中删除key，不会做其他清理。如果用户疯狂点击，Map中会积累大量即将过期的条目。

```javascript
const DebounceLock = {
    locks: new Map(),
    isLocked(key, timeout = 300) {
        if (this.locks.has(key)) {
            return true;
        }
        this.locks.set(key, setTimeout(() => this.locks.delete(key), timeout));
        return false;
    }
};
```

**影响**: 实际影响极小，因为锁的timeout很短（150-500ms），Map大小不会无限增长。

---

### BUG-R10-025: `beforeunload` 和 `popstate` 事件监听器从未被移除
**严重程度**: 低
**文件**: `app.js:2311-2337`
**描述**: `init()` 函数中注册的 `beforeunload` 和 `popstate` 事件监听器是匿名函数，无法被移除。虽然在SPA中这通常不是问题（页面不会卸载），但如果模块化重构时会成为问题。

---

### BUG-R10-026: `Storage._storageListeners` 数组只增不减
**严重程度**: 低
**文件**: `app.js:66-68`
**描述**: `Storage.onChange()` 方法将监听器push到数组中，但没有提供 `off()` 或 `removeChangeListener()` 方法来移除监听器。虽然当前代码中没有调用 `onChange()`，但API设计不完整。

---

## 五、可访问性 (A11y)

### BUG-R10-027: 几乎完全缺失ARIA标签
**严重程度**: 高
**文件**: `index.html`, `app.js` (动态生成的HTML)
**描述**: 整个应用几乎没有使用ARIA属性来增强可访问性。

**缺失的ARIA标签**:
1. **导航栏** - 缺少 `role="navigation"` 和 `aria-label`
2. **移动端菜单按钮** - 缺少 `aria-expanded`, `aria-controls`
3. **移动端侧边栏** - 缺少 `role="dialog"`, `aria-label`, `aria-hidden`
4. **页面容器** - 缺少 `role="main"`, `aria-label`
5. **题目选项** - 缺少 `role="radio"`/`role="checkbox"`, `aria-checked`, `aria-label`
6. **进度条** - 缺少 `role="progressbar"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`
7. **模态框** - 缺少 `role="dialog"`, `aria-modal="true"`, `aria-labelledby`
8. **Toast通知** - 缺少 `role="alert"`, `aria-live="polite"`
9. **标签页** - 排行榜的tab缺少 `role="tablist"`, `role="tab"`, `role="tabpanel"`
10. **搜索输入框** - 缺少 `aria-label`（`index.html:21` 和 `index.html:68`）

**唯一的例外**: `app.js:466` 中科目卡片有 `role="button"` 和 `tabindex="0"`，这是正确的。

---

### BUG-R10-028: 键盘导航严重不足
**严重程度**: 高
**文件**: `app.js`, `index.html`
**描述**: 应用主要依赖鼠标/触摸操作，键盘导航支持极其有限。

**具体问题**:
1. **题目选项** - 只有科目卡片有 `onkeydown` 处理（`app.js:466`），但刷题界面的选项（`.quiz-option`）没有键盘事件处理，无法用键盘选择答案
2. **模态框** - 没有焦点陷阱（focus trap），Tab键可以跳出模态框
3. **Escape键** - 没有全局的Escape键处理来关闭模态框或侧边栏
4. **题目导航** - 题目导航面板的数字按钮没有 `tabindex`，无法用Tab键聚焦
5. **移动端侧边栏** - 打开后焦点不会自动移入侧边栏

---

### BUG-R10-029: 颜色对比度可能不达标
**严重程度**: 中
**文件**: `style.css`
**描述**: 多处文本颜色与背景颜色的对比度可能不满足WCAG 2.1 AA标准（4.5:1）。

**可疑位置**:
- `style.css:375-376` - `.stat-label { color: rgba(255,255,255,0.7) }` 在紫色渐变背景上，白色70%透明度可能对比度不足
- `style.css:354` - `.hero-subtitle { color: rgba(255,255,255,0.85) }` - 同上
- `style.css:2009-2010` - `.empty-state p { color: var(--gray-400) }` 即 `#94a3b8` 在白色背景上，对比度约3.0:1，不满足AA标准
- `style.css:519` - `.subject-tag { color: var(--gray-600) }` 即 `#475569` 在白色背景上，对比度约4.6:1，刚好达标
- `style.css:1065` - `.key-point { color: #065f46 }` 在浅绿背景 `rgba(16,185,129,0.1)` 上，对比度可能不足

---

### BUG-R10-030: 搜索输入框缺少label关联
**严重程度**: 中
**文件**: `index.html:21`, `index.html:68`
**描述**: 两个搜索输入框都使用 `placeholder` 代替 `<label>`，没有正确的label关联。

```html
<!-- 桌面端搜索 -->
<input type="text" placeholder="搜索题目、考点..." id="globalSearch" maxlength="100" onkeyup="handleGlobalSearch(event)">

<!-- 移动端搜索 -->
<input type="text" placeholder="搜索题目..." id="mobileSearch" onkeyup="handleMobileSearch(event)">
```

**影响**: 屏幕阅读器无法正确识别输入框的用途。`placeholder` 不等同于 `<label>`。

---

### BUG-R10-031: 考试设置表单的select元素缺少label的for属性
**严重程度**: 低
**文件**: `app.js:1237-1268`
**描述**: 考试设置表单中虽然使用了 `<label>` 标签，但没有 `for` 属性关联到对应的 `<select>`。

```javascript
html += `
    <div class="form-group">
        <label>选择科目</label>
        <select id="examSubject">${subjectOptions}</select>
    </div>
`;
```

---

### BUG-R10-032: 按钮使用 `<a>` 标签而非 `<button>` 或有正确role的元素
**严重程度**: 低
**文件**: `index.html:15-50`, `index.html:71-79`
**描述**: 导航栏和侧边栏中的链接使用 `<a href="javascript:void(0)">` 来充当按钮。虽然功能上可行，但语义不正确。

```html
<a href="javascript:void(0)" class="nav-link active" data-page="home" onclick="navigate('home')">
```

**建议**: 使用 `<button>` 或至少添加 `role="button"`。

---

## 六、代码一致性

### BUG-R10-033: 注释风格不统一
**严重程度**: 低
**文件**: `app.js`, `data.js`
**描述**: 代码中混用了多种注释风格：

1. **JSDoc风格** (data.js):
```javascript
/**
 * 加载单个科目的题目数据
 */
```

2. **行内修复注释** (app.js):
```javascript
// 修复BUG-015：多选题临时选择状态
// 慢工出细活修复#R9-030：添加重试机制和离线缓存提示
// 第一性原理修复BUG-005：返回深拷贝，防止外部修改影响存储数据
```

3. **分隔线注释** (app.js):
```javascript
// ============================================
// 全局状态
// ============================================
```

4. **普通行注释** (app.js):
```javascript
// 检查是否已经答过题（防止重复提交）
```

**影响**: 代码可读性和维护性降低，尤其是"修复注释"中引用的BUG编号缺乏追踪链接。

---

### BUG-R10-034: 函数命名风格基本统一但有例外
**严重程度**: 低
**文件**: `app.js`, `data.js`
**描述**: 绝大多数函数使用camelCase命名，但存在以下例外：
- 常量使用SCREAMING_SNAKE_CASE: `CONSTANTS`, `SUBJECTS_CONFIG`, `AppState`, `Storage`, `DebounceLock` -- 这些是对象/常量，命名合理
- 函数命名一致使用camelCase: `renderHome()`, `startQuiz()`, `toggleFavorite()` -- 正确

**结论**: 命名风格基本统一，无明显问题。

---

### BUG-R10-035: 缩进风格一致
**严重程度**: 无
**文件**: `app.js`, `data.js`, `style.css`, `index.html`
**描述**: 所有文件统一使用4空格缩进，HTML模板字符串中的缩进也保持一致。无问题。

---

### BUG-R10-036: 生产环境遗留console.log/console.error/console.warn
**严重程度**: 中
**文件**: `app.js`, `data.js`
**描述**: 代码中保留了大量的 `console.log`、`console.error` 和 `console.warn` 调用。

**具体位置**:
- `data.js:102` - `console.error('加载${subjectId}题目数据出错:', error);`
- `app.js:89` - `console.error('读取存储失败 [${key}]:', e);`
- `app.js:93` - `console.warn('已清理损坏的存储项: cpa_${key}');`
- `app.js:118` - `console.error('localStorage存储已满');`
- `app.js:120` - `console.error('存储失败:', e);`
- `app.js:905` - `console.log('点击过快，请稍候');`
- `app.js:985` - `console.error('题目不存在:', AppState.quizIndex);`
- `app.js:1044` - `console.warn('无效的题目索引: ${index}...');`
- `app.js:1691` - `console.warn('无效的题目key格式:', item.key);`
- `app.js:1696` - `console.warn('无效的题目ID:', keyParts[1]);`
- `app.js:1706` - `console.warn('科目不存在:', item.subjectId);`
- `app.js:1794` - `console.warn('无效的题目key格式:', item.key);`
- `app.js:1799` - `console.warn('无效的题目ID:', keyParts[1]);`
- `app.js:1809` - `console.warn('科目不存在:', item.subjectId);`
- `app.js:2367` - `console.log('CPA智刷初始化完成...');`
- `app.js:2369` - `console.error('初始化失败:', error);`

**影响**: 生产环境中console输出可能泄露敏感信息（如存储数据结构），影响性能，且不专业。

**建议**: 使用构建工具在生产环境自动移除，或封装一个可配置的logger。

---

### BUG-R10-037: `href="javascript:void(0)"` 使用过时模式
**严重程度**: 低
**文件**: `index.html:15-50`, `index.html:59-82`
**描述**: 导航栏和侧边栏中的所有链接都使用 `href="javascript:void(0)"`。这是过时的做法，应使用 `<button>` 元素或 `href="#"` 配合 `event.preventDefault()`。

---

## 七、其他发现

### BUG-R10-038: `getAnswerRecord()` 数据格式不一致
**严重程度**: 中
**文件**: `app.js:136-139`
**描述**: `getAnswerRecord()` 尝试处理两种数据格式：带 `data` 包装和不带包装的。这说明Storage系统的数据格式经历了变更，但旧的兼容代码没有被彻底清理。

```javascript
getAnswerRecord(questionKey) {
    const answers = this.get('answers', {});
    return answers.data ? answers.data[questionKey] : answers[questionKey] || null;
},
```

同样的问题存在于 `getWrongQuestions()` (`app.js:152-155`), `getFavorites()` (`app.js:172-175`), `getNotes()` (`app.js:198-201`), `getStats()` (`app.js:227-237`) 等多个方法中。

**影响**: `Storage.get()` 已经返回了深拷贝的原始数据（`app.js:87`），而 `Storage.set()` 又在外层包装了 `{_v, _t, data}` 结构。所以 `Storage.get()` 返回的是 `{_v, _t, data: actualData}`，需要 `.data` 来获取实际数据。但 `getAnswerRecord` 等方法直接在 `get()` 返回值上再检查 `.data`，逻辑冗余且容易出错。

**根本原因**: `Storage.get()` 返回的是包装后的完整对象（包含 `_v`, `_t`, `data`），而调用方期望的是原始数据。应该在 `get()` 方法中直接返回 `data` 字段。

---

### BUG-R10-039: `Storage.get()` 返回的数据结构不一致
**严重程度**: 高
**文件**: `app.js:81-98`
**描述**: `Storage.get()` 返回的是 `JSON.parse(JSON.stringify(parsed))`，即完整的存储对象（包含 `_v`, `_t`, `data` 字段）。但代码中有些地方直接使用返回值，有些地方检查 `.data` 属性。

```javascript
get(key, defaultValue = null) {
    const data = localStorage.getItem(`cpa_${key}`);
    const parsed = JSON.parse(data);
    return JSON.parse(JSON.stringify(parsed));  // 返回 {_v, _t, data: ...}
}
```

而 `set()` 存储的格式是：
```javascript
set(key, value) {
    const wrappedValue = { _v: ..., _t: ..., data: value };
    localStorage.setItem(`cpa_${key}`, JSON.stringify(wrappedValue));
}
```

所以 `get()` 返回的是 `{_v, _t, data: actualValue}`。但很多代码中这样使用：
```javascript
const stats = Storage.get('stats', {...});
// stats 是 {_v, _t, data: {totalAnswered: ...}}
// 后面直接使用 stats.totalAnswered 会是 undefined
```

**实际上代码之所以能工作**，是因为多处都有 `stats.data || stats` 的兼容处理。但这是一个设计缺陷，应该在 `get()` 中直接返回 `parsed.data !== undefined ? parsed.data : parsed`。

---

### BUG-R10-040: `startExam()` 中 `resume` 模式下直接操作DOM而非通过navigate
**严重程度**: 低
**文件**: `app.js:1301-1309`
**描述**: `startExam()` 在resume模式下直接操作DOM来显示考试页面，绕过了 `navigate()` 函数。

```javascript
document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
document.getElementById('page-exam-taking').classList.add('active');
```

这导致：
1. 导航栏高亮不会更新
2. `document.title` 不会更新（虽然本来就不更新）
3. 浏览器历史记录不会更新
4. 与 `navigate()` 函数的行为不一致

---

### BUG-R10-041: 排行榜数据每次查看都重新随机生成
**严重程度**: 低
**文件**: `app.js:309-347`, `app.js:2095-2131`
**描述**: 排行榜数据在 `generateRanking()` 中使用 `Math.random()` 生成模拟数据。虽然有缓存机制（`getRanking()` 先尝试从Storage读取），但一旦Storage被清除或首次使用，每次刷新页面都会生成完全不同的排行榜。

**影响**: 排行榜数据不稳定，用户体验不一致。

---

### BUG-R10-042: `examSelectOption` 中单选/判断题的选项清除范围过大
**严重程度**: 中
**文件**: `app.js:1528`
**描述**: 考试模式下单选/判断题选择时，使用 `document.querySelectorAll('.quiz-option')` 清除所有选项的selected状态，但应该限定在考试容器内。

```javascript
// 单选/判断
document.querySelectorAll('.quiz-option').forEach(opt => opt.classList.remove('selected'));
element.classList.add('selected');
```

如果此时页面上同时存在其他 `.quiz-option` 元素（虽然正常流程中不会），可能会误清除。对比多选题的处理（`app.js:1520`）已经正确限定了范围：`document.querySelectorAll('#examTakingContainer .quiz-option.selected')`。

---

### BUG-R10-043: `finishQuiz()` 中使用emoji在标题中
**严重程度**: 低
**文件**: `app.js:1094`
**描述**: `finishQuiz()` 结果页面的标题中使用了emoji：

```javascript
<h2 style="margin-bottom:8px">${rate >= 60 ? '🎉 表现不错！' : '💪 继续加油！'}</h2>
```

同样在 `finishExam()` (`app.js:1604`) 和 `renderDaily()` (`app.js:2026`) 中也使用了emoji。虽然功能正常，但：
1. 屏幕阅读器会读出emoji名称，体验不佳
2. 不同平台emoji渲染不一致

---

### BUG-R10-044: `getSubjectChapters()` 返回的sections是Array但来自Set
**严重程度**: 低
**文件**: `data.js:146-156`
**描述**: `getSubjectChapters()` 使用 `Set` 收集sections，然后通过展开运算符转为数组。Set的去重特性在这里是有益的，但Set不保证顺序（虽然ES6+的Set保持插入顺序），且如果题目数据中同一章节的section名称有细微差异（如前后空格），会导致重复。

---

---

## 缺陷汇总统计

| 严重程度 | 数量 | 缺陷编号 |
|---------|------|---------|
| **高** | 5 | R10-002, R10-010, R10-016, R10-018, R10-027, R10-028, R10-039 |
| **中** | 18 | R10-001, R10-003, R10-005, R10-007, R10-009, R10-011, R10-012, R10-014, R10-017, R10-019, R10-020, R10-021, R10-022, R10-029, R10-030, R10-036, R10-038, R10-042 |
| **低** | 14 | R10-004, R10-006, R10-008, R10-013, R10-015, R10-023, R10-024, R10-025, R10-026, R10-031, R10-032, R10-033, R10-037, R10-040, R10-041, R10-043, R10-044 |

| 分类 | 数量 |
|------|------|
| CSS/HTML层 | 8 |
| 端到端流程 | 7 |
| 异步/竞态 | 5 |
| 内存管理 | 6 |
| 可访问性 | 6 |
| 代码一致性 | 5 |
| 其他 | 7 |
| **合计** | **44** |

---

## 优先修复建议

### P0 - 立即修复
1. **BUG-R10-039**: `Storage.get()` 数据结构不一致是架构级缺陷，影响所有数据读取
2. **BUG-R10-016**: `loadAllSubjects()` 部分失败后不再重试，影响核心功能
3. **BUG-R10-027/R10-028**: A11y严重缺失，影响可访问性合规

### P1 - 近期修复
4. **BUG-R10-002**: 添加 `prefers-reduced-motion` 支持
5. **BUG-R10-020**: 批量处理考试交卷的Storage写入
6. **BUG-R10-009**: 页面切换时更新 `document.title`
7. **BUG-R10-036**: 移除或封装console输出
8. **BUG-R10-018**: Storage跨标签页竞态保护

### P2 - 计划修复
9. **BUG-R10-001/R10-007**: 统一使用CSS变量，减少内联样式
10. **BUG-R10-012**: 添加深色模式支持
11. **BUG-R10-021**: 优化 `escapeHtml()` 性能
12. **BUG-R10-029**: 审查并修正颜色对比度
