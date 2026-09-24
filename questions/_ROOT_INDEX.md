# 考研英语一阅读理解题目集 · 总索引

> **来源**：9 篇英文时文（WSJ × 3 / Science × 2 / Sunday Times × 4）— 来自 `articles/ 目录`
> **出题规范**：考研英语一阅读理解六大题型 + 7 种出题模式
> **生成时间**：2026-08-24
> **生成方式**：3 sub-agent 并行出题（WSJ 桶 / Science 桶 / Sunday Times 桶）

## 9 篇文章 × 7 模式 出题覆盖

每个模式都至少出 1 遍；模式 5（FCC Sports + Moral Economics）和模式 7（Pensions + Pothole）各出 2 遍。

| 模式 | 组合 | 第1题 | 第2题 | 第3题 | 第4题 | 出题文章 |
|---|---|---|---|---|---|---|
| 模式 1 | 标准 A | 细节理解 | 推理判断 | 主旨大意 | 态度观点 | [Ammo Shortage](./ammo_shortage/mode1.md) |
| 模式 2 | 标准 B | 细节理解 | 推理判断 | 词义猜测 | 例证 | [Haldane Chainsaw](./haldane/mode2.md) |
| 模式 3 | 标准 C | 细节理解 | 推理判断 | 主旨大意 | 词义猜测 | [AI Regulation](./ai_regulation/mode3.md) |
| 模式 4 | 标准 D | 细节理解 | 推理判断 | 态度观点 | 例证 | [Hidden Cost AI](./ai_cost/mode4.md) |
| 模式 5 | 标准 E | 细节理解 | 推理判断 | 主旨大意 | 例证 | [FCC Sports](./fcc_sports/mode5.md) · [Moral Economics](./moral_econ/mode5.md) |
| 模式 6 | 标准 F | 细节理解 | 推理判断 | 态度观点 | 词义猜测 | [Narrowing Window AI](./horvitz/mode6.md) |
| 模式 7 | 专项 | — | — | — | — | [Junior Pensions](./pensions/mode7.md)（词义专项）· [Pothole Compensation](./pothole/mode7.md)（例证专项）|

## 文章分类索引

### WSJ（华尔街日报）
- [AI Regulation Fryer](./ai_regulation/INDEX.md) — 模式 3 — 2026-03-21
- [Ammo Shortage Jones](./ammo_shortage/INDEX.md) — 模式 1 — 2026-03-21
- [FCC Sports Jenkins](./fcc_sports/INDEX.md) — 模式 5 — 2026-03-21

### Science（科学）
- [Moral Economics Perry](./moral_econ/INDEX.md) — 模式 5 — 2026-03-26
- [Narrowing Window AI Horvitz-West](./horvitz/INDEX.md) — 模式 6 — 2026-06-04

### Sunday Times（星期日泰晤士报）
- [Haldane Chainsaw Regulation Treanor](./haldane/INDEX.md) — 模式 2 — 2026-06-14
- [Hidden Cost AI Fortson](./ai_cost/INDEX.md) — 模式 4 — 2026-06-14
- [Junior Pensions Filby](./pensions/INDEX.md) — 模式 7（词义专项）— 2026-06-14
- [Pothole Compensation Harwood-Baynes](./pothole/INDEX.md) — 模式 7（例证专项）— 2026-06-14

## 统计
- 文章数：9 篇
- 模式覆盖：7 种（模式 5/7 各 2 次）
- 题目数：9 × 4 = 36 道
- 题型分布：细节理解 9 道 / 推理判断 9 道 / 主旨大意 5 道 / 态度观点 4 道 / 词义猜测 6 道（标准 3 + 专项 3）/ 例证 6 道（标准 3 + 专项 3）

## 出题规范
- **难度**：考研英语一标准
- **题干句式**：严格按 6 大题型规范
- **答案解析**：含原文定位 + 同义替换/推理 + 干扰项分析
- **质量标准**：答案唯一 / 干扰项有效 / 难度匹配 / 定位准确

## 源文件
- 文章 JSON：`questions/_source/*.json`（从 articles HTML 提取的英文段+段摘要+主旨）
- 出题 prompt：`questions/_PROMPT_TEMPLATE.md`
- 文章原文：`articles/*_final.html`
