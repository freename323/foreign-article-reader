---
name: english-reader
description: |
  Use this skill when the user wants to turn a foreign-language article (PDF or
  pre-split EN/CN markdown) plus a Chinese translation into a 3-column EN |
  Summary | CN bilingual HTML reader for browser-based learning. Triggers:
  "外刊阅读器", "EN-CN 阅读器", "双语阅读器", "bilingual reader", "reading
  html", "3 列阅读", "英文阅读", "中英对照 html", "英语阅读器".
---

# Foreign Article Reader

把外刊原文 + 中文翻译转成 3 列 EN | Summary | CN 布局的交互式 HTML 阅读器。

## 适用场景

- 经济学人 / WSJ / FT / NYT 等外刊单篇文章
- 已有中文翻译（手写或 AI 翻译）
- 用户想用浏览器做英中对照阅读、做笔记、记摘要
- 输出是单个 HTML 文件，离线可用，数据存 `localStorage`

## 核心特征

- **3 列布局**：左 EN | 中 Summary（每段双语摘要）| 右 CN
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
- 共享资源：`articles/reader.css`、`articles/reader.js`
- 题库：`questions/`（9 篇文章 × 考研英语一 6 大题型）
- 考试/完形/翻译练习页：`articles/exam_*.html`、`articles/cloze_*.html`、`articles/translation_*.html`
- 参考文档：`references/`

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
