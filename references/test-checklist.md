# Test Checklist

`scripts/test_html.py` 用 Playwright 跑 **25 项**测试。所有测试必须通过。

## 基础布局 (3 项)

1. **3 列布局**：`.main-wrap` 存在，EN / Summary / CN 列可见
2. **Header 显示**：`.header` 可见，含 title / author / thesis
3. **段落摘要**：`.para-summary-item` 数量 > 0

## Scroll Sync (3 项)

4. **段落级同步**：EN 滚到底部，CN 也滚到底部附近（drift < 200px）
5. **行对齐**：EN 和 CN P1 段高度相等（syncParaHeights 强制等高）
6. **Summary 等高**：EN sum 和 CN sum 高度相等

## Toggle 按钮 (3 项)

7. **概要 toggle**：点 📑 → `.no-summary` class 切换
8. **中文 toggle**：点 🀄 → `.no-cn` class 切换
9. **标题 toggle**：点 📰 → `.header.collapsed` class 切换

## 笔记面板 (3 项)

10. **打开生词本**：点 📖 → notes 展开 + vocab tab 激活
11. **切换笔记 tab**：点 📝 → note tab 激活
12. **笔记三 Tab**：`[data-notes-bucket]` 存在（生词本 / 笔记 / 全部）

## 浮动菜单 (2 项)

13. **EN 浮动菜单**：EN 列选中文本 → 弹出菜单
14. **CN 浮动菜单**：CN 列选中文本 → 同样弹出菜单

## 标注功能 (3 项)

15. **生词标注高亮**：选 EN 文本 → 记生词 → 文本带 `.hl-vocab` class
16. **生词出现在笔记面板**：生词本 tab 显示刚添加的词
17. **笔记 tab 初始为空**：未添加备注时 note tab 为空

## 可编辑 (2 项)

18. **CN 段落可编辑**：CN 列 `p` 有 `contenteditable`
19. **摘要可编辑**：summary item 有 `contenteditable`

## 暗色/持久化 (2 项)

20. **暗色模式**：toggle → `data-theme="dark"` → 颜色变量切换
21. **localStorage 持久化**：刷新页面，标注/设置仍在

## 导航 (2 项)

22. **跳转按钮存在**：`[data-jump]` 按钮数量 > 0
23. **跳转按钮滚动**：点 jump → 对应段落滚到可视区（条件性：有 jump 按钮才测）

## 导出 (1 项)

24. **MD 导出按钮**：导出按钮存在

## 高级对齐 (1 项)

25. **侧栏等高**：`.col-blockquote`（侧边引言）和对侧中文侧栏高度相等（无 blockquote 则跳过）

## 跑测试

```powershell
# 单文件测试
python scripts/test_html.py --html article.html

# 批量测试（目录下所有 _final.html）
python scripts/test_html.py --dir .
```

输出：
```
[OK] 3 columns layout
[OK] header visible
...
[FAIL] ... (具体哪项失败)
```

## 已知假阴性

- Chromium screenshot 在 `overflow:auto` 容器内 jump 后可能不显示段——**这是 chromium 渲染 bug，不是数据问题**。在 Edge 浏览器里渲染正常。
- 段高同步可能在初次加载时不稳定（图片/字体未加载完）。测试前**必等 `document.fonts.ready`**。
