# 工具栏重构 + 备份落地 + 考试模式升级 · 设计方案

日期：2026-09-05　决定项（用户已确认）：三/四下拉重排、备份"选目录 + 下载降级"两者结合、考试态+练习态双模式、
功能取「答题卡+每题耗时 / 解析定位原文 / 成绩趋势+导出复盘 / 揭晓动画做足」、改 `articles/reader.*` 并同步回 `build_html.py`。

---

## A. 工具栏：2 个失衡下拉 → 4 个语义下拉

现状：左 `⚙` 8 项 vs 右「工具」19 项，且 `.menu-dropdown` 无 `max-height` → 小屏被裁、考试模式沉底。

新布局（每个下拉 ≤8 项，全部加滚动保护）：

```
⚙ 视图 ▾ | 🎓 考试 ▾ | 📌 概要 | 🀄 中文 | 📖 生词 | 📝 笔记 | <标题区> | 时钟 | 💾 数据 ▾ | 🧰 工具 ▾
   左侧                            左侧主按钮                        弹性      右侧          右侧
```

| 下拉 | 内容 | 项数 |
|---|---|---|
| **⚙ 视图** | 字号 A−/16px/A+ · 主题（绿金/亮色/暗色/系统）· 标题区显隐 · 词频着色+图例 · 撤销编辑 · 快捷键 | 6 |
| **🎓 考试** | 模拟考试 · 翻译练习 · 完形填空 · 新题型（仅在有题库的 9 篇出现，其他文章整组隐藏） | 4 |
| **💾 数据** | 备份全部数据（所有文章）· 快速备份到上次文件夹 · 恢复数据 · 备份记录 · 导出 Markdown · 本篇 JSON | 6 |
| **🧰 工具** | 全文搜索 · 文章关联 · 阅读统计 · 建议文积累 · 打印/PDF · 文库 · 对比阅读 · 限时目标 | 8 |

命名去歧义：原「备份全部数据」与「JSON 备份」看起来重复 → 改为 **备份全部数据（所有文章）** vs **本篇 JSON（仅本篇标注）**。

实现：菜单容器与按钮进 `build_html.py` 的 toolbar 模板（`reader.js` 里 `injectMenuExtras()` 改为往 4 个容器分发），
已有的运行时注入模式保持不变，文章正文 HTML 零改动。

## B. 备份：从"下完就不知道去哪"到"有目录、有记录、可回滚"

1. **优先 File System Access API**：`showSaveFilePicker({suggestedName})` → 用户自己挑位置；成功后把所在目录句柄存
   IndexedDB（`english-reader-backup` / `handles` / `backupDir`），记录 `dirName`。之后「快速备份」直接写入同一目录，
   新文件名带时间戳；权限失效时 `queryPermission/requestPermission` 自动补要一次。
2. **降级**：不支持该 API、或用户取消/报错 → 走原 `downloadFile()`，但 toast 明确说
   `已下载 reader-backup-20260905-0813.json（浏览器下载目录，建议移进 E:\…\backups）`。
3. **备份记录面板**：显示上次备份时间/方式/文件名/所在文件夹、本机 `reader-backup-*.json` 历史（最多 12 条）；
   记住目录时列目录内备份文件，点一条即可恢复。
4. **恢复**：目录内选文件恢复（首选项）或 `<input type=file>`；恢复前显示条目数并二次确认。
5. **扩大覆盖**：`BACKUP_PREFIXES` 加 `examq:/examtimer:/examlimit:/nt:/transq:/transtimer:/cz:/exammode:/exammark:/examansheet:/examhist:`，
   `BACKUP_EXACT_KEYS` 加 `wsj_exam:wrongs / wsj_exam:overtime / wsj_exam:history`（原来考试数据根本不在备份里）。
6. 提醒文案改指「💾 数据 ▾」并带上上次备份时间。

## C. 考试页（`exam_*.html`）：考试态 / 练习态双模式

| 态 | 行为 |
|---|---|
| **考试态**（默认） | 作答不判分、不显答案（错因行隐藏、reveal 禁用）；答题卡三态 + 标记待复核；顶部常驻「交卷」；离开页面再回不误弹交卷 |
| **练习态** | 即时判分 + ✓/✗ 动画 + 即时解析（保留现有便利） |

交卷流水：确认 → 计时冻结 → 逐题（间隔 260ms）揭晓：正确卡片绿框 + ✓ 弹入、错误卡片红框 + ✗ + shake 抖动 →
选项标出「正确项」与「我选错的项」→ 错因行淡入 → 最后总分卡（得分、正确率进度条动画、总用时、每题均耗时、
最慢 2 题、题型分布、与上次对比）。

新增组件（全部运行时注入，`exam_*.html` 本体不改）：答题卡、模式切换、交卷按钮、总分卡、趋势 SVG、复盘导出。

**解析定位原文**：题干+解析里抽 `第N段 / 第A-B段 / Paragraph N / Paragraphs A, B and C / P N` → 渲染 `📍 第N段` chips，
点击滚到文章栏对应 `p[data-para-idx]` 并闪烁高亮。

**成绩趋势**：`wsj_exam:history` 存 {slug, mode, at, correct, total, elapsed, perQ} → 近 10 次正确率折线 + 用时折线（内联 SVG）。
**导出复盘**：单题（题干/我的答案/正确/耗时/错因/笔记/解析）与整篇 markdown，落盘复用 B 的目录选择器 + 下载降级。

顺手修：`exam.js:2` 文件名正则 `/_exam\.html$/` 与真实 `exam_<slug>.html` 不匹配（现靠 `data-exam-id` 兜底）。

## D. 同步与验证

- 新建 `scripts/sync_assets.py`：把 `articles/reader.css`、`articles/reader.js` 单写回 `scripts/build_html.py` 的
  `CSS/JS` 内嵌块（替代 `_cleanup/_sync_assets.py` 里带一次性清理断言的版本）。
- 新建 `scripts/patch_article_toolbars.py`：把新 toolbar 块替换进 9 个 `articles/*_EN-CN_final.html`
  （主 `_articles.json` 不在工作区，不能整篇重跑 `build_html.py`）。
- 验证：`scripts/test_html.py` + 新 `scripts/test_exam.py`（Playwright 断言 4 个下拉、交卷动画类、答题卡三态、chips 定位）+ 人工截图。
