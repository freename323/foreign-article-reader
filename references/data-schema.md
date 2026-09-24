# Data Schema

`_articles.json` 是整个 skill 的数据 store。**HTML 模板读取这个文件渲染出最终 HTML**。

## 顶层结构

```json
[
  {
    "html": "filename.html",     // 输出 HTML 文件名
    "en_title": "...",            // 英文标题
    "cn_title": "...",            // 中文标题
    "en_author": "By ...",        // 英文署名（"By X" 或 "X is..."）
    "cn_author": "作者：...",     // 中文署名
    "en_sub": "...",              // 英文副标题（可选）
    "cn_sub": "...",              // 中文副标题（可选）
    "thesis": ["...", "...", "..."],  // 3 句中文主旨（手写）
    "para_summaries": [["EN", "CN"], ...],  // 每段 [EN 摘要, CN 摘要]
    "en_body": "<blockquote>...</blockquote><p id='para-1' data-para-idx='1'>...</p>...",
    "cn_body": "<p id='para-1' data-para-idx='1' class='cn-translatable'>...</p>..."
  },
  ...
]
```

## 关键字段约束

### `en_body` / `cn_body`

**段 ID 约定**：
- 段 ID 必须 `id="para-1"` 到 `id="para-N"` 连续
- 段必须 `<p id="para-N" data-para-idx="N">` ——**id 和 idx 必须一致**
- bio 段也要 id（不能跳过）
- 引言用 `<blockquote>...</blockquote>` 包，不要用 `<p>`

**EN body 模板**：
```html
<blockquote>Some pull quote or lede quote here</blockquote>
<p id="para-1" data-para-idx="1">First paragraph content...</p>
<p id="para-2" data-para-idx="2">Second paragraph...</p>
...
<p id="para-N" data-para-idx="N">Mr. X is a professor of Y at Z.</p>  <!-- bio -->
```

**CN body 模板**：
```html
<p id="para-1" data-para-idx="1" class="cn-translatable">第一段中文...</p>
<p id="para-2" data-para-idx="2" class="cn-translatable">第二段中文...</p>
...
<p id="para-N" data-para-idx="N" class="cn-translatable">X 是《XX》的撰稿人，是 Y 大学教授。</p>
```

**重要约束**：
- EN 和 CN 段数必须**严格相等**（含 bio 段）
- EN 和 CN 段的 `data-para-idx` 必须**严格相等**
- CN 每段必须 `class="cn-translatable"`（让前端能 contenteditable）

### `para_summaries`

格式：每项是 `[EN 摘要, CN 摘要]` 的二元组。

- 项数 = 段数 - bio 段数
- 项顺序对应 EN P1, P2, ..., P_{N-1}（跳过 bio 段 P_N）
- 每项第一个是英文（取该段首句或人工精简）
- 每项第二个是中文（取该段中文首句或人工精简）

示例（AI 文章 14 项，对应 P1-P14，跳过 P15 bio）：
```json
"para_summaries": [
  ["The most consequential technology of our lifetimes is being regulated by people who can't agree on what it is.", "我们这个时代最重要的技术，却由那些无法就是否定义达成一致的人类加以监管。"],
  ["I'm working with companies that have abandoned hiring algorithms that produced more meritocratic outcomes than human judgment alone.", "我与一些已经放弃使用招聘算法的公司合作，这些算法能产生比人类判断更公平的结果。"],
  ...
]
```

### `thesis`

**3 句中文主旨**，手写。这是文章的"灵魂三连"——必须由你（或 user）读完文章后总结。

示例：
```json
"thesis": [
  "美国和欧盟正用一推宽容、不一致且定义过宽的法规（伊利诺伊州招聘法、纽约 RAISE 法案、欧盟 AI 法案）来监管 AI——一个原本为减少歧视而设计的法律，反而让公司放弃了比人判断更公平的招聘算法，因为合规风险不值。",
  "核心难题是信息不对称：监管者看不见 AI 系统的真实成本与行为，所以\"加强审计、增加检查员\"这种直觉反应反而是错的。",
  "正确的方式来自 Baron-Myerson 框架——设计一组\"菜单式\"监管选项，让低风险公司主动选低合规、高风险公司自动落到严监管和全额赔偿上；监管者要求认自己不可能掌握完美信息，用谦逊和激励对齐去推动 AI 和警务这类复杂领域。"
]
```

### 字段组合

每篇 article 的最小数据集：
```json
{
  "html": "my_article_EN-CN_final.html",
  "en_title": "The Economics of Regulating AI",
  "cn_title": "人工智能监管的经济学问题",
  "en_author": "By Roland Fryer",
  "cn_author": "作者：罗兰·弗赖尔",
  "en_sub": "Opinion — Wall Street Journal, A13",
  "cn_sub": "观点 — 《华尔街日报》A13 版",
  "thesis": [...],
  "para_summaries": [...],
  "en_body": "...",
  "cn_body": "..."
}
```

## 校验工具

`scripts/verify_alignment.py` 检查：
- EN/CN 段数相等
- idx 序列 1..N 连续
- bio 段匹配模式
- summary 项数 = 段数 - bio 数
- summary[idx-1] 的 EN/CN 与 en_body/cn_body 对应段首句匹配

如果校验失败，**必须修复**而不是绕过。
