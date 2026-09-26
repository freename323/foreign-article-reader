# 外刊阅读器 · Foreign Article Reader

> **框架版本**：本仓库仅包含阅读器的代码框架、构建工具和模板，不包含任何受版权保护的文章内容。请自行准备文章原文和翻译，并确保拥有合法使用权。

把外刊原文 + 中文翻译转成 3 列 EN | Summary | CN 布局的交互式 HTML 阅读器，附带考研英语一考试系统、完形填空、翻译练习、词频分析等学习功能。纯前端、零依赖、离线可用，所有数据存浏览器 localStorage。

## 功能特性

### 阅读核心
- **3 列布局**：左 EN 原文 | 中双语摘要 | 右 CN 翻译，段落级滚动同步
- **段落编号 + ¶ 标记**：P1/P2/… 视觉定位，段内行高对齐
- **可编辑翻译**：CN 列每段 contenteditable，直接改翻译，自动存 localStorage
- **可编辑摘要**：每段 EN/中 摘要均可编辑
- **浮动注释菜单**：选中任意文本 → 记生词 / 标不懂 / 加备注，3 色高亮
- **笔记面板**：生词本 / 笔记 / 全部 三个 Tab，支持搜索
- **全文搜索**：高亮匹配项，支持大小写/全词匹配
- **文章关联**：自动识别跨文章引用，点击跳转

### 个性化
- **4 套主题**：绿金 / 亮色 / 暗色 / 蓝金 + 跟随系统
- **字号调节**：12–22px，记忆设置
- **阅读进度条** + **上次阅读位置书签**
- **阅读计时** + **限时目标**
- **移动端适配**：860px 断点 + 底部列切换条

### 考试与练习

**考试模式 = 5 个相互独立的模块**，各有各的界面与记录，可单独进入：

| 模块 | 英文 | 形态 | 内容 |
|---|---|---|---|
| 📝 阅读理解 | Reading Comprehension | 独立页面 `exam_<slug>.html` | 5 道选择题，计时作答，交卷才揭晓对错 |
| 🧩 完形填空 | Use of English | 独立页面 `cloze_<slug>.html` | 20 空，选项自动联动生词本 |
| 🔗 新题型 | New Question Types | 独立页面 `newtype_<slug>.html` | 七选五 / 排序 / 小标题 |
| ✍ 翻译练习 | Translation | 独立页面 `translation_<slug>.html` | 5 句长难句英译中 + 分点自评 |
| ✍️ 写作 | Writing | 面板（不跳页） | 写作工坊：素材 / 建议文 / 长难句 / 词根 |

- 入口：报眉「🎓 考试」按钮，或菜单「考试 ▾」→「考试模式总览」（只在有题目的文章上出现）
- **「有哪些模块」的唯一事实来源是 `<body data-exam-types>`**（`scripts/sync_article_meta.py` 维护）；
  菜单与总览都由它动态生成 → 加一类 = 改 `EXAM_TYPES` + 在 `10-toolbar.js` 的 `EXAM_MODULES` 补一行
- 模块内部细节：6 大题型 / 7 种出题模式、考试态与练习态双模式、答题卡三态标记、
  成绩趋势折线图、解析定位原文

### 数据管理
- **备份 / 恢复**：File System Access API 选目录 + 浏览器下载降级
- **MD / JSON 导出**：标注 + 翻译 + 笔记导出
- **撤销编辑**：翻译/摘要修改可撤销
- **词频着色**：5 级词频标注 + 图例，词汇浏览器

## 目录结构

```
外刊阅读器/
├── index.html                  # 文章索引首页（9 篇卡片）
├── README.md                   # 本文件
├── SKILL.md                    # Skill 完整文档（6 步流程 + Failure modes）
├── PLAN-toolbar-exam.md        # 工具栏重构 + 考试模式设计方案
├── index_template.html         # 文章索引页模板（复制为 index.html 并修改文章列表）
├── examples/                   # 示例文章（原创内容，可直接用于测试）
│   ├── sample_en_body.html     # 示例英文段落
│   ├── sample_cn_body.html     # 示例中文翻译
│   └── _articles.sample.json   # 示例数据文件结构
├── articles/                   # 渲染好的最终 HTML（产物，需自行构建，不入库）
├── src/                        # CSS/JS 源文件（权威源，构建时读取）
│   ├── reader.css              # 阅读器样式（70KB）
│   ├── reader.js               # 阅读器脚本（由 js/ 模块合并生成）
│   └── js/                     # reader.js 模块拆分（11 个功能模块）
│       ├── 00-head.js          # IIFE + 常量 + util + 存储 + 容量预警
│       ├── 01-settings.js      # 主题/字号/布局切换
│       ├── 02-content.js       # 摘要/翻译编辑 + 标注 + 高亮
│       ├── 03-notes.js         # 笔记面板渲染 + 搜索
│       ├── 04-scroll.js        # 段高同步 + 滚动同步 + 跳转 + 浮动菜单
│       ├── 05-export.js        # MD 导出 + 生词 CSV 导出
│       ├── 06-exam.js          # 考试集成 + 题型标注 + 句法分析 + 写作素材
│       ├── 07-wordfreq.js      # 词频着色 + 阅读统计 + 复习计数 + 词根联想
│       ├── 08-search.js        # 全文搜索 + 文章注册 + 交叉引用 + 诊断
│       ├── 09-reading.js       # 时钟 + 计时 + 阅读位置 + 备份恢复
│       ├── 10-newspaper.js     # 报纸阅读页（对开双页 + 多栏 + 翻版，默认版式）
│       └── 10-toolbar.js       # 工具栏菜单 + 下拉 + AI 侧窗 + 初始化 + 全局导出
│                               # ⚠ 必须排在最后：它闭合 IIFE 并定义 window.__reader 桥
├── scripts/                    # 构建与校验脚本
│   ├── build_html.py           # 核心构建（从 src/ 读取 CSS/JS，23KB）
│   ├── build_exam.py           # 考试页构建
│   ├── extract_paragraphs.py   # 从 MD 提取段落
│   ├── verify_alignment.py     # EN/CN 段对齐校验
│   ├── gen_summaries.py        # 段摘要 + thesis 生成
│   ├── test_html.py            # Playwright UI 测试（25 项，未装 Playwright 时跑不了）
│   ├── shots.py                # 无头 Edge 截图 / dump 诊断（不需要 Playwright）
│   ├── test_modules.py         # 模块单元测试
│   ├── check_alignment_html.py # HTML 对齐检查
│   ├── sync_assets.py          # reader.css/js 回写 build_html.py
│   ├── stamp_assets.py         # 资源版本戳
│   ├── gen_article_vocab.js    # 每篇生词统计生成（Node）
│   ├── gen_vocab_browser.js    # 词汇浏览器生成（Node）
│   └── concat_reader.py        # 合并 src/js/*.js -> src/reader.js
├── questions/                  # 考研英语题库
│   ├── _source/*.json          # 9 篇结构化题库 JSON
│   ├── _PROMPT_TEMPLATE.md     # 出题规范（6 大题型 + 7 模式）
│   ├── _ROOT_INDEX.md          # 题库总索引
│   └── <article>/mode*.md      # 各篇题目 markdown
├── references/                 # 参考文档
│   ├── 新增文章纳入流程.md      # ★ 纳入新文章的唯一权威手册（先读这个）
│   ├── data-schema.md          # _articles.json 数据结构
│   ├── html-template.md        # HTML 模板设计
│   ├── test-checklist.md       # 测试清单
│   └── troubleshooting.md      # 故障排查
├── articles_source/            # 原始 EN/CN 段落 HTML（中间产物）
├── backups/                    # 用户数据备份
└── .gitignore
```

### 精读分析台（错题本 / 能力雷达 / 段落功能 / 生词网络）

入口：**数据 ▾ → 考试分析**、**工具 ▾ → 精读工具**。四项都建立在已有数据上，不新建并行数据源。

- **📕 错题本（间隔重复）** —— 把 4 个练习模块的错题库（阅读理解 / 完形填空 / 新题型 / 翻译）
  合成一张清单，按 **1 → 2 → 4 → 8 → 16 天** 排期复习，**连续答对 3 次**标记「已掌握」并移出队列。
  带题干与选项的错题可**就地重做**（答案遮罩，提交后自动排下次复习）；其余给「原题」跳转。
  筛选：待复习 / 全部 / 已掌握 + 按题型 + 按错因。到期的错题会计入工具栏「今日待复习」。
- **📡 六题型能力雷达** —— 按**细节 / 推理 / 主旨 / 态度 / 词义 / 例证**统计正确率，
  纯 SVG 六边形（不引图表库）。数据来自本地成绩记录的**逐题题型**；未作答不计入，
  正确率 < 60% 的题型在表里标「需要加练」。
- **🏷 段落功能标签** —— 给每段标 **论点 / 论据 / 转折 / 结论 / 背景 / 例证**（六色左边条 + 角标），
  用来读文章结构、写作文、做新题型。标签是**段落级元数据**：不写进正文、不进标注列表、
  不影响导出与词频统计；报纸版与三栏视图都能看到。
- **🕸 生词网络** —— 同一个词在多篇文章里出现的位置一处列出，点一下**直接跳到那篇文章那一段**
  （`#para-N` 锚点，报纸版会自动翻到含该段的版并高亮）。按「跨篇复现 / 本篇生词」分组，可搜索。
- **📎 素材 / 长难句来源** —— 写作工坊的每张卡片上带「📎 篇名 · 第N段」，点击回原文那一段；
  手动创建的素材不显示来源。

> 实现要点：这一组功能**不建新索引**。生词网络从 `wsj_reader:registry` + 各篇 `annotations:<篇>`
> 现场推导；雷达图直接聚合 `wsj_exam:history` 的 `perQ[].type`；错题本只加一个**调度侧车**
> `wsj_wrongrev`（间隔重复状态），不动 4 个既有错题库的记录结构。
> ⚠ 新增的浮层面板必须在 `body.paper-open` 下抬 z-index —— `.paper-root` 是 z-index:9000 的
> 不透明整屏元素，挂在 body 下、层级低于它的浮层在默认的报纸阅读模式下会被整个盖住。

### 阅读版式与试卷版式

**阅读模式 = 两份相互独立的报纸：英文版 + 中文版**（「线报排版」皮肤，默认）。
英文版是一份完整的英文报纸，中文版是它的**对应翻译版**，两本各有自己的报头、主标题、
速览栏与页码，互不混排。视觉调性参照通讯社电头报 / 校样台：冷调纸面 + 单色信号蓝、
标题窄体大写、数字一律等宽、边界全是 1px 发线、无圆角。

- **语言切换（报眉上的 `EN │ 中文`）**：两本之间跳转的唯一入口。
  当前语言**反色高亮**（同时写 `aria-pressed`），切换只做一次交叉淡入 —— 版面一次全部建好，
  **不重排、不刷新**。键盘 `L` 也可切换。偏好全局记住（`wsj_reader:paperLang`）
- **翻版被限制在当前这一本里**：英文版 Page 1..N、中文版第 1..M 版，各自从「第 1 版」重新起算；
  翻到边界就停，**永远不会翻进另一份报纸**
- **报眉（两行，顶在最上方）**
  - 刊号条（反白深底）：刊名 + 来源标签 + **出版信息**（`2026 年 6 月 14 日  星期日` · 时刻 · READ · TOTAL）
  - 栏目索引栏：`视图 ▾` `考试 ▾` `数据 ▾` `工具 ▾` 四个下拉 + `EN │ 中文` + `‹ 上一版 · N/M · 下一版 ›` + `考试 / 导读 / 笔记 / 栏 / A− / A+ / 打印 / 三栏对照`
- **底栏整条取消**：报纸没有底部工具条。原有四个下拉与时钟/计时由 JS 运行时搬进报眉（DOM 与事件监听原样保留，退出报纸版时原样搬回），因此菜单入口一个不少
- **头版**（两本各有一张）：报头 + 主标题 + 对照语言副标题 + 题图 + 「**AT A GLANCE / 本篇速览**」信息栏（英文数词数、中文数字数）
- **正文**：每版一张纸，页内多栏（默认双栏，`栏` 按钮可在 1 / 2 / 3 栏之间切，全局记住）；栏间细线、两端对齐；纸张铺满可用宽度（上限 1500px）
- **段落**：段首行内上标段号（英文 `I` `II` `III`…，中文 `一` `二` `三`…），段与段之间有细分隔线，段落可在栏底断开续到下一栏（报纸排法）；中文版段首缩进两字、行高放宽
- **生词与标注**做成蓝色荧光划线，末尾附「**精读提示**」框（本篇要点 + 重点表达）——挂在中文版末页背面
- **每一本的末版自动平衡分栏**（`column-fill: balance`），不会出现「左栏满、右栏空」的观感
- **翻版**：`←`/`→`（或 `PageUp`/`PageDown`）、点版面右/左侧、移动端左右滑动；翻版有**纸面翻掀动画**（旧版绕右边折走、新版绕左边铺下来，附折痕阴影），`prefers-reduced-motion` 下自动关闭
- **导读（左抽屉）**：栏名 `GUIDE · 内容提要`，条目按段排列、细发线分隔——没有卡片与圆角
- **剪报本（右抽屉）**：栏名 `CLIPPINGS · 剪报本`，页签做成无边框的栏目切换（当前项蓝色下划线），笔记条目同样去卡片化

> 中文版**不要求与英文逐段一一对应**：两本各自按自己那一列的子节点独立成流，
> 中文列的段落一段都不会因为「找不到对应英文段」而被丢掉。
>
> 报头日期以 `<body>` 所在文件名里的 `YYYY-MM-DD` 为兜底 —— 9 篇里有 1 篇的 `.meta`
> 完全没写日期，只靠 meta 会静默退化成「今天」。

> 实现要点：报纸版**搬真实段落元素**进版面（不是复制内容），所以标注 `<mark>`、词频着色、
> 译文编辑、阅读位置全部随元素一起工作；每版正文容器都带 `col-body en` / `col-body cn` 类，
> 既有选择器跨页仍能取齐所有段落。
>
> 分版不估算：把剩余块全部放进本版，再用 `scrollWidth > clientWidth` 判定真实溢出，
> 从末尾逐个回退到「刚好装满」。⚠ 读 `scrollWidth` 前必须强制一次重排（`void body.offsetWidth`），
> 否则 `removeChild` 之后会拿到上一次布局的缓存值，回退循环会一路删到只剩一个块。
> ⚠ `.np-body` 同时带 `col-body` 类，必须显式 `padding: 0` —— 基础样式的 `padding:…80px`
> 在多栏容器里不是留白，而是把每栏高度砍掉 80px。
> ⚠ 分版前必须清掉三栏「跨列等高」写进段落的 inline `min-height`（最长可见 600px+）。

**考试模式 = 考研英语（一）试卷版式**（考试页默认套用）：试卷头 + `Section Ⅱ` 分节 +
`21.` 连续题号 + `[A]` 选项 + 页脚；工具栏「📄 试卷版式」可切回紧凑界面。

## 快速开始

### 直接使用
用浏览器打开 `index.html`，点击任意文章卡片即可开始阅读。所有功能离线可用，数据存在浏览器 localStorage。

### 快速测试（使用示例文章）

> ⛔ **示例数据暂时不可直接用于构建。** `examples/_articles.sample.json` 用的是早期 schema
> （`id` / `title` / `paras`），而 `build_html.py` 现已要求
> `html` / `en_title` / `para_summaries` / `en_body` / `cn_body` 等字段，
> 直接 `cp examples/_articles.sample.json _articles.json` 会报 `KeyError: 'html'`。

要跑通示例，请按 `references/data-schema.md` 的字段表改写示例数据（正文直接内联，
或用 `examples/sample_en_body.html` / `examples/sample_cn_body.html` 的内容填进 `en_body` / `cn_body`）：

```bash
# 1) 按 references/data-schema.md 手写 _articles.json（可参考 examples/ 里的正文段落）
# 2) 构建
python scripts/concat_reader.py
python scripts/build_html.py --data _articles.json --out-dir examples/out/
# 3) 打开生成的文章
# examples/out/<你写的 html 字段值>
```

### 添加一篇新文章

**必读：`references/新增文章纳入流程.md`** —— 唯一权威手册，含完整命令、`<body>` 元数据契约、验收清单和已知缺口。

> ⚠️ 两条旧说明已作废：
> - `examples/_articles.sample.json` 是**过期 schema**（用 `id`/`title`/`paras`），
>   直接 `cp` 成 `_articles.json` 会报 `KeyError: 'html'`。请按 `references/data-schema.md` 手写。
> - `_articles.json` 被 gitignore，**仓库里没有**，需要本地自建（所以 `.\build.ps1 all` 目前跑不通）。

速览（细节见上述手册）：

```bash
# 0. 先自建 _articles.json（字段见 references/data-schema.md）
# 1-2. 提取 EN / CN 段落（id 与 data-para-idx 必须一致）
python scripts/extract_paragraphs.py --input article_en.md --lang en --format html > en_body.html
python scripts/extract_paragraphs.py --input article_cn.md --lang cn --format html > cn_body.html
# 3. 校验 EN/CN 对齐（段数必须相等、idx 连续、bio 段检测）
python scripts/verify_alignment.py --data _articles.json
# 4. 生成段摘要 + 3 句主旨（thesis 需手写，不要用 AI 自动生成）
python scripts/gen_summaries.py --data _articles.json --thesis-file thesis.txt
# 5. 新栏目？改 build_html.py 与 sync_article_meta.py 的 EDITION_KEYS
# 6. 构建（自动写 reader.css/js、exam-panel.js、Hub/Compare 页、<body data-*>）
python scripts/concat_reader.py
python scripts/build_html.py --data _articles.json --out-dir articles/
# 7. 收尾：元数据回写 + 缓存戳刷新
python scripts/sync_article_meta.py
python scripts/stamp_assets.py
# 8. 手工补 index.html 卡片与 Hub/Compare 模板里的文章列表
```

详细规范见 `references/新增文章纳入流程.md`、`SKILL.md` 和 `references/data-schema.md`。

### 生成考试页
```bash
# 注意：build_exam.py 不接受命令行参数，它按脚本内 SLUG_TO_ARTICLE 映射重建全部考试页。
# 新增文章要先在 scripts/build_exam.py 的 SLUG_TO_ARTICLE 里加一行，并在 questions/<slug>/ 放 mode*.md。
python scripts/build_exam.py
```

## 数据存储

所有用户数据（标注、笔记、翻译修改、设置、考试历史）存在浏览器 `localStorage`，按文章文件名隔离：

| Key 前缀 | 内容 |
|---|---|
| `annotations:<article>` | 生词/标注/备注 |
| `summary:<article>` | 摘要编辑 |
| `translation:<article>` | 翻译编辑 |
| `settings:<article>` | 主题/字号/布局 |
| `wsj_exam:history` | 考试成绩历史 |
| `wsj_exam:wrongs` | 错题记录 |

**备份**：阅读页 → 💾 数据 → 备份全部数据，支持选目录（File System Access API）或浏览器下载降级。

## 技术栈

- **纯前端**：HTML + CSS + 原生 JS，零框架、零构建依赖
- **构建**：Python 脚本（`build_html.py` 从 `src/` 读取 CSS/JS；`reader.js` 由 `src/js/` 11 个模块合并生成）
- **测试**：Playwright（`test_html.py`，25 项 UI 断言；未安装时改用下面的无浏览器回归）
- **无浏览器回归**：`node .workbuddy/verify_*.js`（共 420 项，见 `SKILL.md`）
- **看真实排版**：`python scripts/shots.py`（无头 Edge 截图，参数见 `--help`）
- **数据**：localStorage + IndexedDB（备份目录句柄）
- **离线**：单 HTML 文件，CSS/JS 全内嵌

## 已知约束

- `reader.js` 拆分为 `src/js/` 11 个功能模块，构建时用 `concat_reader.py` 合并为单文件（保持 IIFE 作用域，全局函数不受影响）
- localStorage 容量约 5MB，超 80% 自动提示导出备份
- `wordfreq.js` 142KB 按需加载，仅在用户开启词频着色或词根联想时动态注入

## 相关文档

- `references/新增文章纳入流程.md` — ★ **纳入新文章的唯一权威手册**（命令、元数据契约、验收清单、已知缺口）
- `SKILL.md` — Skill 文档（首次搭建的 6 步流程、数据 schema、Failure modes）
- `PLAN-toolbar-exam.md` — 工具栏重构 + 考试双模式设计方案
- `references/data-schema.md` — `_articles.json` 数据结构详解
- `references/test-checklist.md` — 25 项测试清单
- `references/troubleshooting.md` — 常见问题排查
- `articles/user_guide.html` — 终端用户使用手册
