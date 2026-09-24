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
- **考研英语一模拟考试**：6 大题型（细节/推理/主旨/态度/词义/例证），7 种出题模式
- **考试态 / 练习态双模式**：考试态不判分不显答案，练习态即时判分+解析
- **答题卡**：三态标记 + 待复核，交卷动画（逐题揭晓、✓/✗ 弹入、错误抖动）
- **成绩趋势**：近 10 次正确率 + 用时折线图，复盘导出 Markdown
- **解析定位原文**：题干抽"第N段"→ 点击 chip 滚动高亮对应段落
- **完形填空** + **翻译练习** + **新题型**

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
│       └── 10-toolbar.js       # 工具栏菜单 + 下拉 + AI 侧窗 + 初始化 + 全局导出
├── scripts/                    # 构建与校验脚本
│   ├── build_html.py           # 核心构建（从 src/ 读取 CSS/JS，23KB）
│   ├── build_exam.py           # 考试页构建
│   ├── extract_paragraphs.py   # 从 MD 提取段落
│   ├── verify_alignment.py     # EN/CN 段对齐校验
│   ├── gen_summaries.py        # 段摘要 + thesis 生成
│   ├── test_html.py            # Playwright UI 测试（25 项）
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
│   ├── data-schema.md          # _articles.json 数据结构
│   ├── html-template.md        # HTML 模板设计
│   ├── test-checklist.md       # 测试清单
│   └── troubleshooting.md      # 故障排查
├── articles_source/            # 原始 EN/CN 段落 HTML（中间产物）
├── backups/                    # 用户数据备份
└── .gitignore
```

## 快速开始

### 直接使用
用浏览器打开 `index.html`，点击任意文章卡片即可开始阅读。所有功能离线可用，数据存在浏览器 localStorage。

### 快速测试（使用示例文章）
```bash
# 复制示例数据
cp examples/_articles.sample.json _articles.json

# 构建（Windows PowerShell）
.\build.ps1 all

# 或手动构建
python scripts/concat_reader.py
python scripts/build_html.py --data _articles.json --out-dir articles/

# 打开生成的文章
# articles/sample_article_EN-CN_final.html
```

### 添加一篇新文章（6 步流程）

```bash
# 1. 提取英文段落（输入 MD，输出带 id 的 HTML）
python scripts/extract_paragraphs.py --input article_en.md --lang en --format html > en_body.html

# 2. 提取中文段落
python scripts/extract_paragraphs.py --input article_cn.md --lang cn --format html > cn_body.html

# 3. 验证 EN/CN 段对齐（段数必须相等、idx 连续、bio 段检测）
python scripts/verify_alignment.py --data _articles.json

# 4. 生成段摘要 + 3 句主旨（thesis 需手写，不要用 AI 自动生成）
python scripts/gen_summaries.py --data _articles.json --thesis-file thesis.txt

# 5. 合并 reader.js 模块 + 渲染 HTML（CSS/JS 全内嵌，单文件离线可用）
python scripts/concat_reader.py
python scripts/build_html.py --data _articles.json --out-dir articles/

# 6. 跑 UI 测试（25 项，需 Playwright）
python scripts/test_html.py --dir articles/
```

详细规范见 `SKILL.md` 和 `references/data-schema.md`。

### 生成考试页
```bash
python scripts/build_exam.py --question questions/_source/<article>.json --out articles/exam_<article>.html
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
- **测试**：Playwright（`test_html.py`，25 项 UI 断言）
- **数据**：localStorage + IndexedDB（备份目录句柄）
- **离线**：单 HTML 文件，CSS/JS 全内嵌

## 已知约束

- `reader.js` 拆分为 `src/js/` 11 个功能模块，构建时用 `concat_reader.py` 合并为单文件（保持 IIFE 作用域，全局函数不受影响）
- localStorage 容量约 5MB，超 80% 自动提示导出备份
- `wordfreq.js` 142KB 按需加载，仅在用户开启词频着色或词根联想时动态注入

## 相关文档

- `SKILL.md` — 完整 Skill 文档（6 步流程、数据 schema、Failure modes）
- `PLAN-toolbar-exam.md` — 工具栏重构 + 考试双模式设计方案
- `references/data-schema.md` — `_articles.json` 数据结构详解
- `references/test-checklist.md` — 25 项测试清单
- `references/troubleshooting.md` — 常见问题排查
- `articles/user_guide.html` — 终端用户使用手册
