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

// 索引页沿用调色版范文的同一套电子书设计语言（色值/字体/卡片语言取自 HTML调色版 页面本身）：
// --bg:#EEF1FA --card:#F8F9FD --accent:#3D52CC，Georgia 衬线，渐变刊头 135deg #3D52CC→#2A3BA8。
const idx = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>作文文库 · Essay Library</title>
<style>
  :root { --bg:#EEF1FA; --card:#F8F9FD; --text:#1E2940; --subtext:#6B7494;
          --accent:#3D52CC; --accent-light:#D4DAF5; --border:#D0D5E8; --shadow:rgba(30,41,64,.06); }
  * { box-sizing:border-box; margin:0; padding:0; }
  html { font-size:16px; scroll-behavior:smooth; }
  body { font-family:Georgia,"Noto Serif SC","Source Han Serif SC","SimSun",serif;
         background:var(--bg); color:var(--text); line-height:1.85; min-height:100vh; }
  .page-header { background:linear-gradient(135deg,#3D52CC 0%,#2A3BA8 100%); color:#fff;
                 padding:2.6rem 2rem 2rem; position:relative; overflow:hidden; }
  .page-header::before { content:""; position:absolute; top:-30%; right:-10%; width:220px; height:220px;
                         border-radius:50%; background:rgba(255,255,255,.08); }
  .page-header .inner { max-width:960px; margin:0 auto; position:relative; z-index:1; }
  .page-header h1 { font-size:2rem; font-weight:700; letter-spacing:.02em; margin-bottom:.3rem; }
  .page-header .subtitle { font-size:.95rem; font-weight:400; opacity:.85; }
  .page-header .back { position:absolute; top:1.4rem; right:0; z-index:2;
    color:#fff; text-decoration:none; font-size:.8rem; letter-spacing:.05em;
    border:1px solid rgba(255,255,255,.55); border-radius:6px; padding:.3rem .8rem; }
  .page-header .back:hover { background:rgba(255,255,255,.14); }
  .content-wrap { max-width:960px; margin:0 auto; padding:1.8rem 1.5rem 3rem; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:1.1rem; }
  a.card { display:block; background:var(--card); border:1px solid var(--border); border-radius:10px;
           padding:1.3rem 1.4rem 1.1rem; text-decoration:none; color:var(--text); position:relative; overflow:hidden;
           box-shadow:0 2px 12px var(--shadow); transition:box-shadow .15s ease, transform .15s ease; }
  a.card::before { content:attr(data-emoji); position:absolute; top:-.2rem; right:.8rem;
                   font-size:3rem; opacity:.08; line-height:1; pointer-events:none; }
  a.card:hover { box-shadow:0 6px 20px rgba(30,41,64,.12); transform:translateY(-2px); }
  .card .label { font-size:.72rem; font-weight:700; letter-spacing:.1em; color:var(--accent);
                 display:flex; align-items:center; gap:.4rem; }
  .card .label::before { content:""; display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--accent); }
  .card .t { font-size:1.05rem; font-weight:700; margin-top:.45rem; line-height:1.55; }
  .card .open { font-size:.8rem; color:var(--subtext); margin-top:.7rem; }
  a.card:hover .open { color:var(--accent); }
  .empty { color:var(--subtext); padding:2rem 0; }
</style>
</head>
<body>
<div class="page-header">
  <a class="back" href="../WSJ_Hub.html">← 返回文库</a>
  <div class="inner">
    <h1>✍ 作文文库</h1>
    <div class="subtitle">英语作文包 · HTML 调色版范文 · 共 ${cards.length} 篇 —— 点卡片阅读，页面自带排版与配色</div>
  </div>
</div>
<div class="content-wrap">
  <div class="grid">
${cards.map(c => `    <a class="card" data-emoji="📝" href="${c.file}">
      <div class="label">${c.date}</div>
      <div class="t">${c.theme || c.title}</div>
      <div class="open">阅读范文 →</div>
    </a>`).join('\n')}
  </div>
${cards.length ? '' : '  <p class="empty">还没有文章 —— 先运行 scripts/sync_essay_html.js 同步作文包。</p>'}
</div>
</body>
</html>
`;
fs.writeFileSync(path.join(OUT, 'index.html'), idx);
console.log('✓ essays/index.html (' + cards.length + ' 张卡片) -> ' + OUT);
