# Troubleshooting

生成外刊 HTML 时的常见问题 + 修复方法。

## 1. 翻译对不上某段 / summary 错位

**症状**：
- 中文 P5 翻译"X 是 Y"，但英文 P5 是关于 Z 的
- summary[idx-1] 的内容跟 idx 段不匹配
- 段数看着对，但错位 1-N 个

**根因**：
`data-para-idx` 跟 `id` 不一致。最常见的是 `split_p11.py` 改了 `id="para-N"` 但忘了改 `data-para-idx`。

**验证**：
```python
# 跑这段检查所有 idx 是否连续 1..N
import re
body = open('article.html', encoding='utf-8').read()
idxs = [int(m.group(1)) for m in re.finditer(r'data-para-idx="(\d+)"', body)]
print(sorted(set(idxs)))  # 应该是 [1, 2, 3, ..., N]
```

**修复**：
```python
def fix_idx(m):
    pid = int(m.group(1))
    return f'<p id="para-{pid}" data-para-idx="{pid}"'
re.sub(r'<p id="para-(\d+)"\s+data-para-idx="(\d+)"', fix_idx, body)
```

**永远**：id 和 data-para-idx 一起改。

## 2. EN/CN 段数不等

**症状**：
- EN 14 段，CN 15 段
- 或者反过来

**根因**：
- EN 漏了 quote 块，CN 漏了 bio
- 或者切段时多按了一次回车

**修复**：
- 重新核对原文，看 EN/CN 段数
- **必须**补齐缺失段——不能靠"忽略差异"绕过
- 提取时同时 EN/CN 一起读，强制 1:1

## 3. bio 段没标 / summary 提取到 bio

**症状**：
- summary 最后一项是"Mr. X is a professor..."（英文 bio）
- 或者"X 是 Y 大学 Z 系教授"（中文 bio）

**根因**：
- 没识别 bio 段
- 提取 summary 时把 bio 当正文

**修复**：
- 用 `scripts/verify_alignment.py` 自动检测 bio 段
- bio 段也加 `data-para-idx`，但 `gen_summaries.py` 跳过最后一段
- bio 段 CSS `::after { content: "" }` 不显示编号

## 4. 中文乱码 / 写入文件是 GBK

**症状**：
- HTML 文件里中文是 `澶т織` 这种乱码
- 写 .py 文件用 `print` 中文时 `UnicodeEncodeError: 'gbk' codec`

**根因**：
- PowerShell `Set-Content -Encoding utf8` 加 BOM
- `Get-Content` 误把 UTF-8 当 GBK 读
- Python `print` 在 GBK console 输出中文失败

**修复**：
- 永远用 `write` 工具创建 .py 文件（UTF-8 无 BOM）
- 不要在命令行写中文（用 `python -c "..."`）
- 调试输出中文时写到 .txt 文件，不要 print

## 5. jump 按钮点击不跳到对应段

**症状**：
- 点 jump 12，页面跳到 P14 或 P10
- 在 Playwright 截图里 P12 不可见
- 但 `data-para-idx` 是对的

**根因**：
**chromium screenshot bug**——`overflow:auto` 容器内 jump 后，截图工具渲染的 layout 跟实际 layout 不一致。

**这是 chromium 截图工具的 bug，不是 HTML 问题**。

**修复**：
- **不要纠结截图**——用 `page.locator('p[data-para-num="Twelve"]').screenshot()` 直接截元素，可以正确显示
- 在 Edge 浏览器里手动验证，渲染正常
- 看 `getBoundingClientRect()` 数据是否正确——如果 JS 读对了，HTML 就是对的

## 6. scroll sync 漂移（EN scroll 1500 → CN scroll 1866）

**症状**：
- EN 滚到 P6 顶部时，CN 滚到 P10 顶部
- 漂移越来越大

**根因**：
`jumpInProgress` 锁没生效，syncTo 跟 jumpTo 互相干扰。

**修复**：
```javascript
let jumpInProgress = false;
function jumpToParagraph(idx) {
  jumpInProgress = true;
  // ... set scrollTop ...
  setTimeout(() => { jumpInProgress = false; }, 100);
}
// syncTo 里检查
if (jumpInProgress) return;
```

**另外**：`topP.top - srcRect.top` 是错的（srcRect.top 已经是 viewport 坐标），要用 `topP.getBoundingClientRect().top` 跟 `srcRect.top` 直接比较。

## 7. 段编号显示错乱

**症状**：
- 段编号从 1 跳到 11，又跳到 12
- 编号重复或缺号

**根因**：
- `data-para-num` 跟 `id` 不对应
- 或者 split 时改了 `id` 但忘了改 `data-para-num`

**修复**：
- 跟 #1 一样，永远 id / data-para-idx / data-para-num 三个一起改
- 验证：`para-num` 序列应该是 `["One", "Two", "Three", ..., "Fifteen"]`（N 个连续）

## 8. 注释菜单弹出但没法选类型

**症状**：
- 选中文本 → 菜单弹出
- 但点"记生词"按钮没反应

**根因**：
- `e.target.closest` 当 target 是 Document 时崩
- 没 guard：`e.target && e.target.closest && e.target.closest(...)`

**修复**：
```javascript
document.addEventListener('mousedown', (e) => {
  if (e.target && e.target.closest && e.target.closest('.float-menu')) return;
  hideFloatMenu();
});
```

## 9. 中文段不可编辑

**症状**：
- 点 CN 段不能进入编辑模式
- 翻译改不了

**根因**：
- CN 段没加 `class="cn-translatable"`
- 或者 `initTranslation` 没跑

**修复**：
- build_html.py 输出 CN 段时自动加 `class="cn-translatable"`：
  ```python
  cn_body = re.sub(
      r'<p id="para-(\d+)"([^>]*)>',
      r'<p id="para-\1"\2 class="cn-translatable">',
      cn_body,
  )
  ```
- 检查 `initTranslation()` 是否在 init 流程里

## 10. 侧栏 (blockquote) 高度不对齐

**症状**：
- EN 侧边引言 50px 高，CN 侧栏 80px 高
- 视觉不平衡

**根因**：
- `syncBlockquoteHeights` 没跑
- 或者选择器不对

**修复**：
```javascript
function syncBlockquoteHeights() {
  const en = document.querySelector('.col-blockquote.en blockquote, .col-blockquote.en .bq');
  const cn = document.querySelector('.col-blockquote.cn');
  if (!en || !cn) return;
  en.style.minHeight = '';
  cn.style.minHeight = '';
  void document.body.offsetHeight;
  const maxH = Math.max(en.offsetHeight, cn.offsetHeight);
  en.style.minHeight = maxH + 'px';
  cn.style.minHeight = maxH + 'px';
}
```

## 11. 笔记丢失

**症状**：
- 关闭浏览器再打开，笔记不见了
- 或者切不同文章时笔记混了

**根因**：
- localStorage key 没按文章区分
- 或者存到错的位置

**修复**：
- localStorage key 加文章名：`annotations:{article_id}`
- 加载时按 article_id 取

## 12. 摘要显示空白

**症状**：
- summary 区域是空的
- 但数据 `para_summaries` 有内容

**根因**：
- `initSummary()` 没跑
- 或者 data-default 属性没填

**修复**：
- 检查 build_html.py 输出的 `<span data-default="...">` 是否有内容
- 检查 init 流程顺序（initSummary 必须在 renderNotes 之前）

## 13. 中文段之间行不对齐

**症状**：
- EN 段第 1 行在 y=100，CN 段第 1 行在 y=110
- 段头对齐但行不对齐

**根因**：
- `syncParaHeights` 没生效
- 或者两段文字行数不同（英文长词 vs 中文短词）

**修复**：
- `syncParaHeights` 用 minHeight 不是 height（让内容自由 wrap）
- 如果行数实在差太多，把长段拆成两段

## 14. 导出 MD 笔记格式混乱

**症状**：
- 导出的 .md 里笔记格式不统一
- EN 笔记和 CN 笔记混在一起

**根因**：
- `exportMarkdown` 没区分 type
- 笔记的 text 字段含 markdown 特殊字符没转义

**修复**：
- 按 type 分段：生词 / 不懂 / 备注
- text 字段用 `markdown.escape()` 转义

## 15. jump 12 之后 P12 段空白

**症状**：
- jump 12 跳到正确位置
- 但 P12 段内容不显示

**根因**：
- 大概率是 chromium 截图工具 bug（见 #5）
- 真要看用 Edge 浏览器

**数据验证**：
```python
# 用 playwright locator 截 P12 元素
p12 = page.locator('p[data-para-num="Twelve"]')
await p12.screenshot(path='p12_only.png')
# 这会正确显示 P12 内容
```

## 16. 标注在笔记面板中不显示

**症状**：
- 标注已经创建（高亮在文本中可见），但笔记面板显示"还没标注"
- 或者笔记面板有标注数量但列表为空

**根因**：
- 标注缺少 `bucket` 字段（旧版代码创建的标注）
- `renderNotes()` 按 `a.bucket === notesBucket` 过滤，没有 bucket 的标注不匹配任何标签页

**修复**：
- `loadAll()` 中自动迁移：为缺少 bucket 的标注根据 type 字段赋值
```javascript
annotations.forEach(a => {
  if (!a.bucket) { a.bucket = (a.type === 'note') ? 'note' : 'vocab'; migrated = true; }
});
if (migrated) saveAnnotations();
```

## 17. 文件改名后标注丢失

**症状**：
- 文章文件名变了（如 build_final.py 重新生成），之前的标注全部消失
- 但实际上数据还在 localStorage 中

**根因**：
- `articleId = location.pathname.split('/').pop()` 基于文件名
- 文件名变了 → articleId 变了 → localStorage key 变了 → 旧数据读不到

**修复**：
- Ctrl+Shift+D 打开诊断工具，查看所有 localStorage 中的标注键
- 如果发现孤立键（旧文件名下的数据），点击"导入"按钮合并到新键下

## 18. setupNotesPanelPosition 导致布局异常

**症状**：
- 笔记面板位置跳动
- 或者笔记面板消失/跑到错误位置

**根因**：
- IntersectionObserver 动态移动 notes panel 的 order/border 属性
- 在某些浏览器或布局下与 flex 布局冲突

**修复**：
- 已删除 `setupNotesPanelPosition()` 函数及其调用
- 笔记面板固定在底部，不再动态移动
