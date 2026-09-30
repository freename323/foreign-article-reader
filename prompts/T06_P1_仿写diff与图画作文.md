# T06 · P1 · 仿写 diff + 图画作文图片

> 一句话：仿写完成后与范文逐段对照、差距显性化（notice the gap 闭环）；图画作文配真实图片输入——英语一大作文考的是图，训练里得有图。

## 背景（为什么）

独立写作页（`articles/writing.html`，生成器 `scripts/sync_writing_page.js`）的左范文右仿写并排，理论上制造"输出与输入的对照"（Swain 输出假说：pushed output 触发 noticing the gap），但**差距没有被显性捕捉**——写完没有 diff，范文退化成好看的输入暴露。自评 1-5 分无外部基准（自评研究：系统性虚高 0.5-1 档），77 篇范文明明可以做锚。且范文库多是无图议论文（仅 20260409 是图表）——英语一大作文是**图画作文**，三段式第一段"图画描述"却没有图可描述。

理论依据：输出假说的三功能（noticing the gap / hypothesis testing / 元语言反思）——diff 视图是第一功能的显性化；元话语（Hyland）——衔接词与学术词差异是语言档次的直接指标。

## 现状（实码与数据）

- 仿写草稿：`wsj_writing:essays`，kind='big'，slots `{p1,p2,p3}`（独立页与文章内工坊同 schema）。
- 范文库：`wsj_writing:readings`，条目 `{id, date, title, topic, note, paragraphs:[{label, role, words, text}]}`。
- 独立页结构：左栏 renderReads()（段落卡）、右栏 renderImitate()（三槽 textarea + 字数），生成器在 `scripts/sync_writing_page.js`（页面源内联在脚本里，**改页面 = 改脚本重跑**，不要直接改 articles/writing.html）。
- 文章内工坊的范文页签：`src/js/06-exam.js` 的 `renderReadsTab()`。

## 任务（做什么）

1. **对照 diff 视图**（独立页右栏「✍ 仿写草稿」加「🔍 对照范文」按钮，需已选中一篇草稿且左侧选了范文）：
   - 逐段并排：你的 p1/p2/p3 vs 范文对应段（三段式 vs 多段落时按比例映射，首段对首段、尾段对尾段、中间合并）；
   - 三类差异高亮：
     ① **衔接词**：内置清单（however, therefore, moreover, in addition, consequently, nevertheless, thus, hence, first(ly), finally, in conclusion, to sum up...）——你有而范文没有的位置、范文有而你没有的位置分别标出；
     ② **句长分布**：每段你的平均句长 vs 范文平均句长（数字对比条，不逐句比对——范文长句多说明句式复杂度高）；
     ③ **学术词**：用 `wordfreq.js` 的词级数据（window.__WORD_FREQ__，已按 b/h/m/l/o 分级加载）——范文用了 m/l 级（中低频）词而你用同义高频词替换的位置，列出"范文用词 → 你的用词"建议对（有数据就做，无词频数据时此项降级隐藏）；
   - diff 结果可一键存为该草稿的 `diffNote` 字段（下次打开草稿可见上次对照结论）。
2. **图画作文图片库**：
   - 目录 `articles/essay_pictures/`（在 articles/ 下自动不进 git），索引 `index.json`：`[{id, topic, file, note}]`；
   - 工坊大作文页签与独立页仿写页签加「🖼 看图写」：随机或按话题出一图，左侧图右侧三段框；**范文默认收起**，写完点开对照（先输出后输入，保住 retrieval）；
   - 无图时（index.json 空）按钮隐藏，不报错；
   - 图片资产由用户自备（真题图注意版权，只放本地）。
3. **自评锚定**：自评清单每项旁加一行淡字：「范文该维度参照：已收录对照按钮」——把"对照范文"变成自评的前置动作提示（v1 从简，不做自动评分）。

## 约束与红线

- 改独立页必须改 `scripts/sync_writing_page.js` 重跑生成，并在脚本头部注释里同步描述新功能；
- diff 的映射/判词逻辑在页面内联 JS 里写，不依赖服务器；学术词判别用已加载的 __WORD_FREQ__，禁止内嵌大词表。
- 图片库索引解析失败时功能整体降级隐藏（容错优先）。

## 验收（回归断言清单）

- 生成器含 diff 三类高亮逻辑（衔接词清单/句长计算/词级判别调用 __WORD_FREQ__）；
- `diffNote` 字段读写存在；
- essay_pictures 的 index.json 读取 + 空库降级逻辑存在；
- 「看图写」模式范文默认收起、写完展开的交互存在；
- 手测：仿写一段 → 对照 → 衔接词差异正确标出 → 存 diffNote → 重开草稿可见。
