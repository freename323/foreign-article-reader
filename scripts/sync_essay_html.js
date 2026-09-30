#!/usr/bin/env node
/**
 * sync_essay_html.js — 把「英语作文包_20260930」的 HTML 版范文收进阅读器：
 *   1. 去重后拷贝到 articles/essays/外刊作文_YYYYMMDD.html
 *   2. 生成 articles/essays/index.html（作文文库索引页，卡片按日期排）
 *   3. WSJ_Hub 顶栏的「✍ 作文」按钮指向 essays/index.html（模板里一行，本脚本不改代码）
 *
 * 用法: node scripts/sync_essay_html.js
 * 幂等：作文包更新后重跑即可。articles/ 不进 git（版权目录），拷贝只落在本地。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PKG = path.join(ROOT, '英语作文包_20260930');
const SRC = path.join(PKG, '英语作文包_20260930', '1_作文(md)');
const STYLED = path.join(SRC, 'HTML调色版');
const OUT = path.join(ROOT, 'articles', 'essays');

// 去重映射：输出文件名 ← 来源（同一篇的 v2/调色版 变体只保留一条，优先大文件=内容更全）
const PICKS = [
  { out: '外刊作文_20260409.html', src: path.join(STYLED, '外刊作文_20260409.html') },
  { out: '外刊作文_20260410.html', src: path.join(STYLED, '外刊作文_20260410.html') },
  { out: '外刊作文_20260422.html', src: path.join(STYLED, '外刊作文_20260422.html') },
  { out: '外刊作文_20260423.html', src: path.join(STYLED, '外刊作文_20260423.html') },
  // 2025/05/05 三变体取最大（内容对应单词积累 2026/05/07 的《是大臣》S01E04，文件名按对齐后的日期）
  { out: '外刊作文_20260507.html', src: path.join(STYLED, '外刊作文_20250505.html') },
  { out: '外刊作文_20260904.html', src: path.join(STYLED, '外刊作文_20260904.html') },
  { out: '外刊作文_20260906.html', src: path.join(STYLED, '外刊作文_20260906_调色版.html') },
  { out: '外刊作文_20260911.html', src: path.join(STYLED, '外刊作文_20260911.html') },
  { out: '外刊作文_20260918.html', src: path.join(STYLED, '外刊作文_20260918.html') },
];

fs.mkdirSync(OUT, { recursive: true });
const cards = [];
for (const p of PICKS) {
  if (!fs.existsSync(p.src)) { console.log('⚠ 缺来源，跳过: ' + p.src); continue; }
  const html = fs.readFileSync(p.src, 'utf8');
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || p.out;
  fs.writeFileSync(path.join(OUT, p.out), html);
  // 标题形如「外刊作文 · 2026/09/18 · 独立思考与异常信号」
  const seg = title.split('·').map(s => s.trim());
  cards.push({
    file: p.out,
    date: seg[1] || '',
    theme: seg[2] || '',
    title: title
  });
  console.log('✓ ' + p.out + '  (' + (html.length / 1024).toFixed(1) + ' KB)');
}
cards.sort((a, b) => a.date.localeCompare(b.date));

const idx = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>作文文库 · Essay Library</title>
<style>
  :root { --bg:#f6f3ea; --card:#fff; --fg:#2c3e50; --muted:#7a8794; --accent:#3f5620; --accent-bg:#e8eed7; --border:#d8d2c0; }
  * { box-sizing: border-box; }
  body { margin:0; padding:0; background:var(--bg); color:var(--fg);
         font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
  .wrap { max-width: 1000px; margin: 0 auto; padding: 28px 20px 60px; }
  .top { display:flex; align-items:center; gap:10px; margin-bottom:6px; }
  h1 { font-size:24px; margin:0; color:var(--accent); }
  .top a.back { margin-left:auto; font-size:13px; color:var(--accent); text-decoration:none;
                border:1px solid var(--border); border-radius:6px; padding:4px 10px; background:var(--card); }
  .top a.back:hover { background:var(--accent-bg); }
  .sub { color:var(--muted); font-size:13px; margin:0 0 20px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(290px,1fr)); gap:14px; }
  a.card { display:block; background:var(--card); border:1px solid var(--border); border-radius:10px;
           padding:16px 18px; text-decoration:none; color:var(--fg); transition:box-shadow .15s ease; }
  a.card:hover { box-shadow:0 3px 14px rgba(0,0,0,.10); }
  .card .d { font-size:12px; font-weight:700; color:var(--accent); letter-spacing:.06em; }
  .card .t { font-size:15px; font-weight:600; margin-top:4px; line-height:1.5; }
  .card .open { font-size:12px; color:var(--muted); margin-top:8px; }
  .empty { color:var(--muted); padding:30px 0; }
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <h1>✍ 作文文库</h1>
    <a class="back" href="../WSJ_Hub.html">← 返回文库</a>
  </div>
  <p class="sub">英语作文包 · HTML 调色版范文（${cards.length} 篇）。点卡片阅读，页面自带排版与配色。</p>
  <div class="grid">
${cards.map(c => `    <a class="card" href="${c.file}">
      <div class="d">${c.date}</div>
      <div class="t">${c.theme || c.title}</div>
      <div class="open">📖 阅读范文 →</div>
    </a>`).join('\n')}
  </div>
${cards.length ? '' : '  <p class="empty">还没有文章 —— 先运行 scripts/sync_essay_html.js 同步作文包。</p>'}
</div>
</body>
</html>
`;
fs.writeFileSync(path.join(OUT, 'index.html'), idx);
console.log('✓ essays/index.html (' + cards.length + ' 张卡片) -> ' + OUT);
