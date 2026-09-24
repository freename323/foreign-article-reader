# HTML Template Design

`scripts/build_html.py` 渲染最终 HTML。这份文档记录模板的关键设计决策——为什么这样做、不这样做会出什么问题。

## 整体布局

3 列 grid：
```css
.main-wrap {
  display: grid;
  grid-template-columns: 1fr var(--summary-width) 1fr;
  --summary-width: 340px;
}
```

- 左列 EN：原始英文段落
- 中列 Summary：每段双语摘要
- 右列 CN：中文翻译

切换按钮（工具栏）控制显示：
- 📰 概要 → 切中间列
- 🀄 中文 → 切右列
- 📋 标题 → 切顶部 title/thesis
- 📝 笔记 → 切底部 notes panel

实现：`main-wrap` 加 `.no-summary` / `.no-cn` / `.no-header` / `.no-notes` class。

## 段落标记系统

每个 EN 段带两个属性：
```html
<p id="para-1" data-para-num="One" data-para-idx="1">...</p>
```

- `id="para-N"` — DOM 标识
- `data-para-num="One/Two/..."` — 显示编号（CSS `::after`）
- `data-para-idx="N"` — 程序索引（用于 summary 数组、scroll sync、jump）

**为什么两个属性？** 因为 `id` 是 DOM 用的，CSS `::after { content: attr(data-para-num) }` 用 `data-para-num` 显示英文单词编号，`data-para-idx` 是程序用的 1-based 数字。

**bio 段不显示编号**：CSS `.col-body.en p[data-para-idx]:last-of-type::after { content: "" }`。

## Pilcrow ¶ 标记

每段段首一个 `¶` 标记，便于视觉定位：
```css
.col-body p::before {
  content: "¶";
  position: absolute;
  left: 0;
  opacity: 0.4;
  font-size: 11px;
}
```

**为什么？** 用户阅读时一眼能看到段开头，避免在长段中迷失位置。

## 段落级 Scroll Sync

EN 和 CN 列**不是** 1:1 pixel mirror（不同语言段长不同），而是：

1. 找到 EN 列 viewport 顶部第一个**完全或部分可见**的段
2. 取该段的 `offsetTop`（在 col-body 内的位置）
3. 设 `cn.scrollTop = enP.offsetTop - cn.clientHeight/2 + cnP.height/2`

实现：
```javascript
function syncTo(source, target) {
  // Find topmost visible paragraph in source
  const sourceRect = source.getBoundingClientRect();
  const sourceTop = sourceRect.top;
  const paras = source.querySelectorAll('p[data-para-idx]');
  let topP = null;
  for (const p of paras) {
    const r = p.getBoundingClientRect();
    if (r.bottom > sourceRect.top + 10) {
      topP = p;
      break;
    }
  }
  if (!topP) return;
  const idx = topP.dataset.paraIdx;
  const targetP = target.querySelector('p[data-para-idx="' + idx + '"]');
  if (!targetP) return;
  // Center target paragraph in target viewport
  const targetOffset = targetP.offsetTop - target.clientHeight/2 + targetP.offsetHeight/2;
  target.scrollTop = Math.max(0, targetOffset);
}
```

**关键**：`topP.getBoundingClientRect().top` 跟 sourceRect.top 比较，找到第一个没被完全滚出去的段。

**陷阱**：用 `topP.offsetTop - sourceRect.top` 是错的（sourceRect 已经是 viewport 相对坐标，不能再减一次）。

## syncParaHeights 段等高

EN 和 CN 段内容长度不同，自然高度不同。要让两列**行对齐**（不只是段对齐），需要强制每对段同高。

```javascript
function syncParaHeights() {
  // Reset
  enParas.forEach(p => p.style.minHeight = '');
  cnParas.forEach(p => p.style.minHeight = '');
  void document.body.offsetHeight;  // Force layout
  // Match by idx
  enParas.forEach((enP) => {
    const idx = enP.dataset.paraIdx;
    const cnP = document.querySelector('.col-body.cn p[data-para-idx="' + idx + '"]');
    if (!cnP) return;
    const maxH = Math.max(enP.offsetHeight, cnP.offsetHeight);
    enP.style.minHeight = maxH + 'px';
    cnP.style.minHeight = maxH + 'px';
  });
}
```

**关键**：必须先 reset 再 measure，否则会累加。

## Summary 双语布局

每段一个 summary item，EN/中 上下排列：
```html
<div class="para-summary-item" data-idx="1">
  <div class="item-head">
    <span class="num">P1</span>
    <button class="jump-btn" data-jump="1">→</button>
  </div>
  <div class="en-sum"><span class="editable" contenteditable="true" data-lang="en" data-default="...">...</span></div>
  <div class="cn-sum"><span class="editable" contenteditable="true" data-lang="cn" data-default="...">...</span></div>
</div>
```

CSS：`.en-sum::before { content: "EN"; }`、`.cn-sum::before { content: "中"; }`，用蓝色和红色 badge 区分。

## 浮动注释菜单

选中任意文本 → 弹出菜单"记生词 / 标不懂 / 加备注"。

```javascript
document.addEventListener('mouseup', (e) => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;
  const text = sel.toString().trim();
  if (!text) return;
  // Show menu at mouse position
  showFloatMenu(e.clientX, e.clientY, text, sel);
});
```

菜单位置：viewport 边界 clamp（不能超出屏幕）。

## 笔记数据模型

```javascript
annotation = {
  id: "timestamp-random",
  type: "word" | "unclear" | "note",  // 生词 / 不懂 / 备注
  paraIdx: 5,                          // 第几段
  line: 3,                             // 第几行（基于 rect 计算）
  text: "selected text",               // 选中内容
  context: "...surrounding sentence...", // 上下文（前后 30 字）
  note: "free-form comment",           // 用户备注
  ts: 1234567890,
}
```

存储：`localStorage[ANNO_KEY] = JSON.stringify(annotations)`。

**为什么 paraIdx + line？** 这样笔记"绑定"到段+行，文章滚动时笔记列表能正确高亮位置。

## Toggle 按钮

工具栏：
- 概要 (📑) → 切 Summary 列
- 中文 (🀄) → 切 CN 列
- 标题 (📰) → 切顶部 header
- 笔记 (📝) → 切底部 notes
- 🔍 搜索 → 打开全文搜索面板 (Ctrl+F)
- 📊 词频 → 切换词频标注
- 📚 文库 → 打开 Hub 页面
- 🔀 对比 → 选择文章进入对比阅读
- MD → 导出 markdown
- JSON → 导出 json

每个按钮点击后切对应 class，然后 `setTimeout` 触发 `__resyncScroll` 重同步高度和滚动。

## Settings 持久化

```javascript
settings = {
  showSummary: true,
  showCN: true,
  showHeader: true,
  showNotes: true,
  theme: 'light' | 'dark',
  fontSize: 16,  // px
}
```

存 `localStorage[SETTINGS_KEY]`。

**关键**：切换 theme/fontSize 后要 `__resyncScroll()` 重新同步高度和滚动位置。

## init 流程顺序

```javascript
DOMContentLoaded → 
  loadAll()             // 读 localStorage
  applyLayout()          // 应用 settings
  initSummary()          // 渲染默认 summaries
  initTranslation()      // 渲染默认 translations
  renderNotes()          // 渲染笔记列表
  syncBlockquoteHeights()
  syncParaHeights()      // ← 必须在 setupScrollSync 之前
  syncSummaryHeights()
  setupScrollSync()      // 装滚轮事件
  setupFloatMenu()
  setupProgressBar()     // 进度条 + 滚动监听
  setupSearchInput()     // 搜索面板输入监听
  overrideCtrlF()        // Ctrl+F 拦截 → 打开搜索面板
  setupWordFrequency()   // 词频标注
  setupDiagnostics()     // Ctrl+Shift+D 诊断面板
  syncToRegistry()       // 注册文章到 localStorage registry
  window.addEventListener('resize', () => setTimeout(__resyncScroll, 100))
```

**为什么这个顺序？** 段高必须先确定再装滚轮——否则滚轮同步算出的位置在第一次重排后会跳变。`syncToRegistry()` 放在 UI 初始化之后，确保文章数据已就绪再写入注册表。

## Dark Mode

`html[data-theme="dark"]` 控制所有颜色变量。Toggle 改 `data-theme` 属性。

## 字号

CSS 变量 `--font-base: 16px` 控制全局字号。`changeSize(delta)` 加减 1px 并存 settings。

## 导出

`exportMarkdown()` 把整篇 + 笔记 + 用户改过的 summary/translation 输出 .md：
```markdown
# 标题

By author

## 主旨
1. thesis 1
2. thesis 2
3. thesis 3

## 段落摘要
### P1
**EN**: ...
**CN**: ...

### 笔记
- [P3 L5] **生词** "wontonly" - 备注内容
```

## 进度条

顶部固定一条细进度条，随阅读滚动实时更新：

```javascript
function setupProgressBar() {
  const bar = document.querySelector('.progress-bar');
  const enCol = document.querySelector('.col-body.en');
  enCol.addEventListener('scroll', () => {
    const pct = enCol.scrollTop / (enCol.scrollHeight - enCol.clientHeight);
    bar.style.width = (pct * 100).toFixed(1) + '%';
  });
}
```

**实现要点**：监听 EN 列的 `scroll` 事件（不是 window），因为实际滚动容器是 `.col-body.en`。`scrollHeight - clientHeight` 是可滚动总距离。

## 搜索面板

点击 🔍 或按 Ctrl+F 打开全文搜索面板：

```javascript
function overrideCtrlF() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      toggleSearchPanel(true);
    }
  });
}
```

搜索面板覆盖在文章上方，输入关键词后实时高亮所有匹配：
1. 遍历所有 `p[data-para-idx]` 的 `textContent`
2. 用 `TreeWalker` 找到文本节点，包裹 `<mark>` 标签
3. 面板显示匹配数量 + 上/下跳转按钮
4. 清除搜索时还原所有 `<mark>` 为原始文本节点

**为什么不直接用 `window.find()`？** 浏览器原生搜索无法控制高亮样式，也无法跨 overflow 容器正确跳转。

## 词频标注

点击 📊 按钮切换词频标注模式：

```javascript
function toggleWordFrequency() {
  document.body.classList.toggle('show-word-freq');
}
```

开启后，EN 列中每个单词根据其在语料库中的频率被加上颜色标注（高频无色 → 低频高亮）。实现方式：
- 构建阶段由 `build_html.py` 预计算每个词的频率等级，写入 `data-freq` 属性
- CSS 通过 `[data-freq]` 选择器着色
- 切换时只改 class，不需要重新渲染 DOM

## 文章注册表同步

每篇文章打开时自动注册到 `localStorage`，供 Hub 页面和对比页面发现文章：

```javascript
function syncToRegistry() {
  const articleId = document.body.dataset.articleId;
  const title = document.querySelector('.article-title')?.textContent || '';
  const meta = {
    id: articleId,
    title: title,
    url: location.href,
    savedAt: Date.now(),
  };

  // 写入单篇文章数据
  localStorage.setItem('wsj_reader:article:' + articleId, JSON.stringify({
    annotations: annotations,
    settings: settings,
    summaries: summaries,
  }));

  // 更新注册表索引
  const registry = JSON.parse(localStorage.getItem('wsj_reader:registry') || '[]');
  const existing = registry.findIndex(r => r.id === articleId);
  if (existing >= 0) {
    registry[existing] = meta;
  } else {
    registry.push(meta);
  }
  localStorage.setItem('wsj_reader:registry', JSON.stringify(registry));
}
```

**localStorage key 约定**：
- `wsj_reader:registry` — 文章索引数组 `[{id, title, url, savedAt}, ...]`
- `wsj_reader:article:<id>` — 单篇文章的笔记、设置、摘要数据

**为什么分开存？** localStorage 单 key 有 5~10MB 限制。分开存避免一篇文章的数据撑爆其他文章的存储。

## Hub 页面 (WSJ_Hub.html)

文库页面，展示所有已保存文章的列表。

**文件夹扫描**：使用 File System Access API (`showDirectoryPicker()`) 让用户选择文章存放目录，递归扫描 `.html` 文件：

```javascript
async function scanFolder() {
  const dirHandle = await window.showDirectoryPicker();
  const articles = [];
  for await (const entry of walkDir(dirHandle)) {
    if (entry.name.endsWith('.html')) {
      const file = await entry.getFile();
      const text = await file.text();
      // 从 HTML 中提取 title / id / savedAt
      articles.push(parseArticleMeta(text));
    }
  }
  renderArticleList(articles);
}
```

**为什么用 File System Access API？** 文章是本地 HTML 文件，不经过服务器。File System Access API 让浏览器直接读取用户选择的文件夹，无需后端。

**降级方案**：不支持 File System Access API 的浏览器（Firefox）回退到 `<input type="file" webkitdirectory>`。

## 对比页面 (WSJ_Compare.html)

侧并排对比阅读两篇文章：

- 从 registry 中选择两篇文章，用 iframe 并排加载
- 两个 iframe 的滚动位置独立，但段落高亮同步
- 顶部控制栏可切换左/右文章、交换位置

```html
<div class="compare-wrap">
  <iframe id="compare-left" src="..."></iframe>
  <div class="compare-divider"></div>
  <iframe id="compare-right" src="..."></iframe>
</div>
```

**分割线可拖拽**：mousedown 后监听 mousemove 调整两列宽度比例。

## 已知问题

1. **Chromium screenshot 在 overflow:auto 容器内有渲染 bug**——jump 后 P 实际位置跟 JS getBoundingClientRect 不一致。**这是 chromium 截图工具的 bug，不是 HTML 的问题**。在 Edge 浏览器里渲染正常。
2. **`data-para-num` 跟 `id` 不必一致**——前者是显示用，后者是 DOM 用。`data-para-idx` 必须跟 `id` 一致。
