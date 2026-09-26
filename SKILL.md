---
name: english-reader
description: |
  Use this skill when the user wants to turn a foreign-language article (PDF or
  pre-split EN/CN markdown) plus a Chinese translation into a 3-column EN |
  Summary | CN bilingual HTML reader for browser-based learning. Also use it
  when the user wants to ADD / INCLUDE a new article into the existing reader
  site (adding an article, 新增文章, 添加文章, 纳入新文章, 加一篇外刊, include
  article, add article). Triggers: "外刊阅读器", "EN-CN 阅读器", "双语阅读器",
  "bilingual reader", "reading html", "3 列阅读", "英文阅读", "中英对照 html",
  "英语阅读器", "新增文章", "纳入文章", "添加一篇文章".
---

# Foreign Article Reader

把外刊原文 + 中文翻译转成 3 列 EN | Summary | CN 布局的交互式 HTML 阅读器。

## ⚠️ 新增 / 纳入一篇文章之前，必读

**在做任何「新增文章」相关操作之前，先完整读一遍 `references/新增文章纳入流程.md`。**

本文档其余部分（6 步流程 / Failure modes）是针对**首次搭建**写的早期版本，
**缺少 `<body>` 元数据步骤，且示例数据文件已过期**。纳入新文章请以
`references/新增文章纳入流程.md` 为准——那里有完整命令、元数据契约、验收清单和已知缺口。

三条最容易踩的铁律（详见该文档 §0）：

1. **`articleId` = 文章 HTML 文件名，发布后永不改名**——改名 = 该篇笔记/生词/翻译修改全部失联
2. **`slug` 唯一来源是 `<body data-edition="...">`**——不要新建任何「文件名→slug」映射表
3. **源在 `src/`，产物在 `articles/`**——改完必须 `concat` + `sync`，否则「改了不生效」

## 适用场景

- 经济学人 / WSJ / FT / NYT 等外刊单篇文章
- 已有中文翻译（手写或 AI 翻译）
- 用户想用浏览器做英中对照阅读、做笔记、记摘要
- 输出是单个 HTML 文件，离线可用，数据存 `localStorage`

## 核心特征

- **报纸阅读页（默认版式）= 两份相互独立的报纸：英文版 + 中文版**（线报排版皮肤）
  - 两本各有一张完整头版（自己的报头 / 主标题 / 速览 / 页码），互不混排；
    报眉上的 `EN │ 中文` 是唯一语言入口，当前语言反色高亮，切换只做交叉淡入（不重排、不刷新），键盘 `L` 亦可
  - 翻版限制在当前那一本里（Page 1..N / 第 1..M 版各自起算），不会翻进另一份报纸
  - 每版一张纸、页内多栏（`栏` 按钮切 1/2/3 栏），段号行内上标 + 段间细线，段落可跨栏断开；
    分版按真实溢出回退（不估算），末版自动平衡分栏，翻版有纸面翻掀动画
  - 报眉两行：刊号条（反白深底：刊名 + 来源 + 出版日期/时刻/计时）+ 栏目索引栏
    （视图/考试/数据/工具 四个下拉 + 语言切换 + 翻版 + 工具按钮）；**底栏整条取消**，其菜单与时钟由 JS 搬进报眉，退出时原样搬回
  - 搬真实段落元素进版面，故标注/词频/译文编辑全部照常工作；中文列独立成流，段落**不必与英文一一对应**
- **三栏对照（备用版式）**：左 EN | 中 Summary（每段双语摘要）| 右 CN，滚动同步；适合逐段精读与编辑
- **精读分析台**（数据 ▾ → 考试分析 / 工具 ▾ → 精读工具）：错题本 + 间隔重复、六题型能力雷达、
  段落功能标签、生词网络（跨文章出现位置 + 跳转）、素材/长难句来源回跳；实现见 `src/js/11-insights.js`
- **考试页考研试卷版式**：试卷头 + `Section Ⅱ` 分节 + `21.` 连续题号 + `[A]` 选项
- **段落级对齐**：EN 和 CN 段一一对应，滚动手动同步
- **段落编号 + Pilcrow ¶ 标记**：视觉上一眼看到 P1 / P2 / P3
- **可编辑摘要**：每段 EN/中 摘要都是 contenteditable
- **可编辑中文**：CN 列每段 contenteditable，可直接改翻译
- **浮动注释菜单**：选中任意文本，弹出菜单"记生词/标不懂/加备注"
- **笔记面板**：所有注释统一管理，按段/行索引。生词本 / 笔记 / 全部 三个 tab
- **暗色模式 / 字号调节**：可记忆到 localStorage
- **Markdown 导出**：把当前文章 + 笔记导出成 .md 文件
- **数据持久化**：所有数据存 `localStorage` 不会上传

## 6 步流程

### Step 1: 提取英文段落

输入：英文 PDF 或 MD。输出：`en_body` HTML 字符串（一段段 `<p id="para-N">`）。

工具：`scripts/extract_paragraphs.py`

规则：
- 按段落切分（双换行或缩进）
- 第一段是 **lede 段**（如果有 quote 块，引言）
- 最后一段常常是 **bio 段**（"Mr./Ms. ... is a professor..."），必须保留但标记为 bio
- 段落 ID 必须 `id="para-1"`, `id="para-2"`, ... 连续
- 段落必须 `<p data-para-idx="N">`（**N 跟 id 一致**——这是关键，见 failure mode #1）

### Step 2: 提取中文段落

输入：中文 PDF 或 MD。输出：`cn_body` HTML 字符串。

工具：`scripts/extract_paragraphs.py`

规则：
- 跟 EN 段一一对应（段数必须相同）
- bio 段也要翻译（"X 是《XX》的撰稿人"）
- `id="para-N" data-para-idx="N"` 跟 EN 同步
- 加 `class="cn-translatable"`（让前端 contenteditable）

### Step 3: 验证 EN/CN 段对齐

输入：`en_body` + `cn_body`。输出：错位报告。

工具：`scripts/verify_alignment.py`

强制规则：
- 段数必须相同
- `data-para-idx` 序列必须 `1..N` 连续
- bio 段必须包含模式 `^(Mr\.|Ms\.|Mrs\.|Dr\.|Prof\.)` / `^[\u4e00-\u9fa5]*(先生|女士|教授|博士)是`
- 第一句 EN/CN 应该语义对应

如果不对齐：**停下来找 user 确认**——是合并段、删段、还是补段。

### Step 4: 生成 thesis + 段摘要

输入：完整文章。输出：`thesis`（3 句中文主旨）+ `para_summaries`（每段 [EN, CN]）。

工具：`scripts/gen_summaries.py`

- `thesis`：手写 3 句话中文主旨（**必须手写**，AI 提取常常失真）
- `para_summaries[i] = [en_first_sentence, cn_first_sentence]`
- **跳过 bio 段**（P_last 不进 summaries，因为 bio 不是正文）
- 段数 = `para_summaries` 项数

### Step 5: 渲染 HTML

输入：完整 `_articles.json`（含 title/author/thesis/para_summaries/en_body/cn_body）。

工具：`scripts/build_html.py`

调用：
```powershell
python scripts/build_html.py --data _articles.json --out article.html
```

输出单个 HTML 文件，CSS/JS 全内嵌，离线可用。

### Step 6: 验证 HTML

工具：`scripts/test_html.py`（用 Playwright）

强制测试 25 项（详见 `references/test-checklist.md`）：
- 3 列布局、header、summary、scroll sync、toggle buttons
- float menu（EN+CN）、note 格式、暗色、持久化
- MD 导出、header collapse、line 对齐、summary 等高、blockquote 等高
- CN editable、notes 3 tabs (生词本/笔记/全部)

## 数据 schema

详见 `references/data-schema.md`。

核心：
```json
[
  {
    "html": "article.html",
    "en_title": "...", "cn_title": "...",
    "en_author": "By ...", "cn_author": "作者：...",
    "en_sub": "...", "cn_sub": "...",
    "thesis": ["主旨句 1", "主旨句 2", "主旨句 3"],
    "para_summaries": [["EN sum", "CN sum"], ...],
    "en_body": "<blockquote>...</blockquote><p id='para-1'>...</p>...",
    "cn_body": "<p id='para-1' class='cn-translatable'>...</p>..."
  }
]
```

## HTML 模板设计

详见 `references/html-template.md`。

核心决策：
- 3 列 grid: `1fr var(--summary-width) 1fr`
- 段落级 scroll sync（不是 pixel mirror）——找顶部可见段，align 到 viewport
- 段落编号 CSS: `data-para-num` 属性 + `::after { content: attr(data-para-num) }`
- bio 段不显示编号（CSS `.bio { display: none }` 或 `::after { content: "" }`）
- 摘要双语：`.en-sum` + `.cn-sum`，各带 EN/中 标签
- 中文段 `class="cn-translatable"` + `contenteditable="true"`

## Failure modes（必读）

### 1. 段 id 改了但 `data-para-idx` 没改

**症状**：翻译对不上某段 / summary 错位 1-N 个

**根因**：用 `re.sub` 改 `id="para-N"` 但忘了同步改 `data-para-idx`。`para_summaries` 数组索引按 idx 走，idx 错位 → summary 全错位。

**修复**：
```python
# 永远两个属性一起改
def fix_idx(m):
    pid = int(m.group(1))
    return f'<p id="para-{pid}" data-para-idx="{pid}"'
re.sub(r'<p id="para-(\d+)"\s+data-para-idx="(\d+)"', fix_idx, body)
```

**验证**：split / renumber 后必跑 `verify_alignment.py`，确认 `sorted(set(idx)) == list(range(1, N+1))`。

### 2. EN/CN 段数不等

**症状**：右边 CN 比 EN 多一段（通常是 EN 漏了某个 quote 块）或少一段（CN 漏了 bio）。

**修复**：把缺失段补齐——不能靠"忽略差异"绕过。

### 3. bio 段没标

**症状**：bio 段（"Mr. X is a professor..."）被当成正文段，summary 提取首句变成 "Mr. X is a professor..."。

**修复**：在 verify_alignment.py 阶段就标出 bio，加到 `bio_indices` 列表里。`gen_summaries.py` 跳过这些 idx。

### 4. 中文 GBK 编码污染

**症状**：PowerShell 写中文文件 `Set-Content -Encoding utf8` 加 BOM，`Get-Content` 误读 GBK。

**修复**：
- 永远用 `write` 工具创建 .py 文件（UTF-8 无 BOM）
- Python 脚本中文输出用 `2>&1 | Out-File -Encoding utf8 file.txt`
- 不用 `python -c "..."` 写中文（命令行转义出问题）

## 输出物

1. `_articles.json` — 数据 store
2. `article.html` × N — 最终 HTML（每个 article 一个）
3. 验证截图（`v4_shots/01_initial.png` 等）

## 关键教训

1. **id 和 data-para-idx 必须同步改**——这是最常见 bug
2. **bio 段必须从段列表里单独标出**，不能跟正文混
3. **EN/CN 段数必须严格相等**——任何缺段要补
4. **summary 首句提取常常把 bio 当正文**——必须按 idx 过滤
5. **PowerShell 写中文**用 `write` 工具，不用 `Set-Content`
6. **Chromium screenshot 在 overflow:auto 容器内有渲染 bug**——数据对就行，不必纠结截图

## 输出格式提醒

skill 渲染完 HTML 后，**必须用 `<deliver-assets>` 把生成的 HTML 文件包起来发给 user**——user 不能直接读你的文件系统。

## 文件位置

项目根目录包含完整源码、工具脚本、文档和渲染好的文章。

- 构建脚本：`scripts/build_html.py`（CSS/JS 内嵌）
- 渲染好的 9 篇文章 + 索引页：`articles/*.html`、`index.html`
- 共享资源：`articles/reader.css`、`articles/reader.js`、`articles/exam-panel.js`（懒加载，源 `src/js/06-exam.js`）
- 题库：`questions/`（9 篇文章 × 考研英语一 6 大题型）
- 考试/完形/翻译练习页：`articles/exam_*.html`、`articles/cloze_*.html`、`articles/translation_*.html`
- 参考文档：`references/`
  - **`references/新增文章纳入流程.md`** ★ 纳入新文章的唯一权威手册
  - `data-schema.md` / `html-template.md` / `test-checklist.md` / `troubleshooting.md`
- 归档（**不要引用**）：`articles/_legacy/`（12 个早期调试残留）

## 无浏览器回归（Playwright 未装时用这个）

改完 `reader.js` / `exam.js` 后跑这三套，全部用 Node + jsdom 直接加载**发版产物**实跑：

```bash
export NODE_PATH="C:/Users/s1371/.workbuddy/binaries/node/workspace/node_modules"   # 需先 npm i jsdom
node .workbuddy/verify_functional.js           # 26 项：产物结构 / ASSET_V / 备份 key 迁移 / 双向桥接契约 / CSS 变量完整性
node .workbuddy/verify_cloze.js                # 107 项：完形自动生成质量（9 篇逐篇 8 项不变量 + 渲染交卷 + 换一段）
node .workbuddy/verify_essay_tpl.js            # 61 项：写作工坊大作文/小作文/模板导入/作文自评
node .workbuddy/verify_dictation.js            # 49 项：中译英默写（LCS 逐词比对 / 题库构建 / 错词本）
node .workbuddy/verify_gaps.js                 # 90 项：派生标注 / 同义替换 / 素材聚类 / 笔记 Delta / 理解偏差 / 学习总览
node .workbuddy/verify_savefile.js             # 77 项：文件保存位置（直写文件夹 / 降级下载 / 文件名净化 / 重名编号 / IDB 故障）
node .workbuddy/verify_newspaper.js            # 271 项：分版/双栏/语言切换/两份独立报纸/线报皮肤/栏数切换/翻版动画/等高残留/浮层层级
node .workbuddy/verify_insights.js             # 76 项：错题本与间隔重复/能力雷达/段落功能标签/生词网络/锚点定位/来源标签
node .workbuddy/verify_exam_paper.js           # 41 项：试卷头注入、题号改写、逻辑层未被改动
node .workbuddy/verify_exam_modules.js         # 41 项：考试模式 5 模块（菜单 / 总览 / 降级 / 页面映射）
node .workbuddy/verify_article_integration.js  # 180 项：9 篇真实文章页逐篇跑（内容完整 / 中英两本 / 语言切换 / 报头日期 / 退出还原）
```

**需要「看」的时候**（jsdom 没有排版引擎，分栏/留白/透明度它测不出来）：

```bash
python scripts/shots.py                      # 无头 Edge 截图（默认第一篇，输出到 .workbuddy/shots/）
python scripts/shots.py --page 3             # 翻到第 4 版
python scripts/shots.py --panel notes        # 点开剪报本抽屉
python scripts/shots.py --lang cn            # 看中文版（另一份报纸）
python scripts/shots.py --cols 3             # 强制三栏
python scripts/shots.py --dump --js "window.__diag='x='+1"   # 跑一段 JS 并把 window.__diag 打印出来
```

## 部署网站

如果要把渲染好的 HTML 发布到公网：

```powershell
# 把所有 HTML + 资源放到一个 dist 目录
$project = "E:\project\外刊阅读器"
New-Item "$project\dist" -ItemType Directory -Force
Copy-Item "$project\index.html" "$project\dist\"
Copy-Item "$project\articles\*.html" "$project\dist\"
Copy-Item "$project\articles\reader.css" "$project\articles\reader.js" "$project\dist\"

# 调用 website_deploy（发布到公网 URL）
# path: dist 目录
# source_path: 源项目根目录
```

**注意**：公网部署 = 任何有链接的人都能看。要"只能自己看"用本地 file:// 访问更稳。

## 改产品代码（reader / exam 模块）时必须知道的三件事

### 1. 构建与同步

```bash
python scripts/concat_reader.py      # src/js/*.js → src/reader.js（MODULES 顺序敏感，10-toolbar.js 必须最后）
node -c src/reader.js                # 语法检查（模块文件是片段，单独 -c 必然报 IIFE 未闭合，属预期）
cp src/reader.js  articles/reader.js
cp src/reader.css articles/reader.css
cp src/js/06-exam.js articles/exam-panel.js    # ⚠ 06-exam.js 不在 MODULES 白名单：它是懒加载的独立产物，漏拷 = 改了不生效
python scripts/sync_article_meta.py --check
python scripts/stamp_assets.py       # 刷新 ?v= 缓存戳
```

### 2. 给「生成器」做质量审查：跑真实代码取样，不要读代码猜

完形的质量审查（`references/完形自动生成质量审查.md`）用的是这个套路，可复用：

1. 把被测脚本**内联**进它自己的页面（`<script src>` → `<script>内容</script>`），
   并在 IIFE 收尾 `})();` 之前注入一行调试导出，把内部函数暴露成 `window.__X__`；
2. jsdom 里 `dispatchEvent(new Event('DOMContentLoaded'))` 触发初始化，然后直接读内部数据结构；
3. 把 9 篇 × N 个样本导出成 JSON，逐项算指标（数量 / 唯一性 / 词形一致 / 位置分布 / 间距）；
4. 修完再跑一遍同样的脚本对比 —— `.workbuddy/review_cloze.js --src backups/xxx.bak` 可以对旧版本取样。

**为什么要这么麻烦**：读代码只能看出「逻辑上可能有问题」，而实测一次就能拿到
「180 个空里 69 个干扰项词形不匹配、30 个挖在段首句」这种可验收的数字。

### 3. 两个会静默失效的坑

* **CSS 变量没声明 ≠ 回退到默认值**。`var(--x)` 取不到值时整条声明在计算值阶段失效
  （属性退回 `unset`）。历史上 `--accent / --border / --panel-bg / --text-muted / --card-bg / --hover-bg`
  七个名字被引用 40 多处却从未声明过 → 所有主按钮变成「白字透明底」、卡片没有边框，
  肉眼像样式没写。`verify_functional.js` 第 5 节会守住这条。
  例外：`--np-font` 是报纸版**字号**，由 JS 写到 `<html>` 的内联样式，CSS 里**不许**声明它
  （包括 `body.paper-open` 这种祖先级选择器），否则 A+/A− 失效。
* **localStorage 新键必须进备份白名单**（`src/js/09-reading.js` 的 `BACKUP_EXACT_KEYS` / `BACKUP_PREFIXES`），
  否则备份**不报错地**漏掉它。完形 / 新题型 / 翻译三个错题库就漏了很久（错题本 4 个库只有 1 个进得了备份）。

### 4. 用 DOM 操作给正文加标注时，先想清楚「嵌套」与「复制」

给正文做标注 / 高亮（`renderDerivedMarks`、`applyHighlight` 一类）有三个必须守住的东西：

* **不许嵌套**：TreeWalker 里直接 `FILTER_REJECT` 掉 `MARK` 内的文本节点，
  否则「已标生词的词」会被再包一层，删除时顺序错乱；
* **幂等**：每次先 unwrap 自己加的 mark 再重建，别指望增量更新；
* **⚠⚠ 绝不能给新 mark 赋 `textContent`**：
  ```js
  // ✗ 同一句话会在正文里出现两遍
  mark.textContent = text;
  const rest = node.splitText(i); rest.splitText(text.length);
  parent.insertBefore(mark, rest);
  // ✓ 把切出来的原文本节点搬进 mark
  const mid = node.splitText(i); const tail = mid.splitText(text.length);
  mark.appendChild(mid); tail.parentNode.insertBefore(mark, tail);
  ```
  这个 bug 视觉上极难发现（重音落点一样），本轮是靠一个**默写测试**抓到的
  —— 默写句库用「句子前 60 字」当 key 去匹配句库，正文被复制后 key 就对不上了。

### 5. 新增「挂在 body 下的浮层」要补层级

`.paper-root` 是 `z-index:9000` 的不透明整屏元素，报纸模式（默认视图）下会盖住所有兄弟浮层。
`reader.css` 末尾统一抬层级：交互菜单 9250、面板 9300。用 `.syntax-panel` 基类的新面板自动覆盖。
\n
## 文件保存位置：所有导出的落盘都必须走 saveFile()

### 事实前提

* **笔记本身不落文件**。标注 / 概要 / 译文 / 考试记录全在 `localStorage`（`annotations:<文件名>` 等），
  改一下就自动写回，没有「保存到哪儿」这回事。
* **只有导出与备份才产生文件**，而网页**无权决定文件保存路径**（否则任何网页都能往你磁盘塞东西）。
  以前所有导出都用 `Blob` + `<a download>` → 只能进浏览器默认的下载文件夹，用户改不了。
* 唯一能直写指定文件夹的途径是 **File System Access API**：`showDirectoryPicker()` 拿一次目录句柄，
  存进 IndexedDB，之后 `dirHandle.getFileHandle(name, {create:true}).createWritable()` 随便写。
* ⚠ 用 `file://` 打开文章页时这个 API **是能用的**（实测）。判断方法见下面「受信任手势探针」。

### 唯一出口：`saveFile(name, text, type)`（`src/js/09-reading.js`）

```js
const r = await saveFile(name, text, 'text/markdown;charset=utf-8');
// r = { where:'folder'|'download', dir, name, renamed, reason? }
showTopToast(saveResultToast(r, '已导出'));   // 去向由这句话交代
```

* **新增任何导出功能，一律调它，不要直接 `downloadFile()`**。`saveFile` 内部才持有句柄。
* `exam-panel.js`（**独立 IIFE**）不能直接调，走 `window.__reader.saveFile` —— 已接好 `downloadText`。
  桥上也给了 `saveResultToast` / `sanitizeFilename`。
* 行为：有句柄且有权 → 直写并返回 `where:'folder'`；否则降级 `<a download>` 并在 `reason` 里带原因。
* 备份（`backupAllData`）与导出的唯一区别：**没设过文件夹时备份会先弹一次选择器**（低频、数据安全动作，
  值得打断一次），导出天天用则不弹，只在提示里告诉你怎么回退。

### 三个必须记住的坑

1. **文件名必须净化**（`sanitizeFilename`）。走下载时浏览器会替你收拾非法字符，走文件夹直写时会
   直接抛 `TypeError` —— 而文章标题里带冒号极其常见（*Potholes: the council fight*），
   所以 `xxx - notes.md` 这种名字必须先把 `\ / : * ? " < > |` 换掉，顺手处理
   「不能以点/空格结尾」「Windows 保留名 con/prn/aux…」「主体裁到 80 字符但保留扩展名」。
2. **重名要编号**，不能静默覆盖（`uniqueFileName`：先 `getFileHandle(name)` 不带 create，
   抛 `NotFoundError` 就说明这个名能用）。同一篇笔记导出两次应该留两份。
3. **IndexedDB 调用必须有超时**（`withTimeout`）。IDB 在部分环境（隐私模式、组策略、
   某些 `file://` 情形）会**既不成功也不失败直接挂住**，一旦挂在 `await` 上，
   用户点「导出」就什么都不会发生 —— 比下载到错地方更糟。
   配套：句柄写不进 IDB 时置 `wsj_reader:backupDirVolatile`，菜单如实显示「（本次有效）」，
   绝不假装已经记住了。

### 受信任手势探针（`.workbuddy/probe_gesture.js`）

要验证「必须用户手势才能触发」的 API（文件选择器 / 剪贴板 / 全屏 / 通知），
`el.click()` 与 `Runtime.evaluate()` 产生的都是**非受信任**事件，一律回
`SecurityError: Must be handling a user gesture` —— 于是你分不清
「这个 API 在当前源被禁了」和「只是缺个手势」。只有 CDP 的 `Input.dispatchMouseEvent`
会带上 user activation：

```bash
node .workbuddy/probe_gesture.js \
  --url "file:///E:/project/外刊阅读器/.workbuddy/probe_gesture_page.html" --sel "#btn"
# → RESULT picker=REJECT AbortError :: The user aborted a request.
#   AbortError = 选择器真的弹了（无头环境没人点）；若被 origin 拒绝会是 SecurityError
```

配套页面 `.workbuddy/probe_gesture_page.html` 复现最小场景；
换成别的 API 时把页面里的调用换掉、结果照旧写进 `#out` 的 `data-diag` 即可。

### 用户侧的两个替代方案（不用改代码）

* 浏览器「设置 → 下载」里改默认下载目录（全局生效，影响所有下载）。
* 或者用应用内的 **数据 ▾ → 📂 保存文件夹**（选一次，之后所有导出与备份都直写那个文件夹）。
