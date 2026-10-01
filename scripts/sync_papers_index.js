#!/usr/bin/env node
/**
 * sync_papers_index.js — 生成 articles/papers.html（真题详解文库索引页）。
 *
 * 数据源：E:/2010-2026考研英语一详解（PDF）/（外部目录，不拷贝——17 份 PDF 约 1GB）。
 * 链接形态：file:/// 绝对链接，本机浏览器直接打开（阅读器主要本地使用）。
 * 版式标注：文件体量 <60MB ≈ 文字版（可选中/搜索），≥60MB ≈ 扫描图片版（2019-2026）。
 *   —— 依据：实测 2010-2018 均含 /Font 文字层（17-34MB），2019-2026 仅含 /Image（87-166MB）。
 *
 * 用法: node scripts/sync_papers_index.js [PDF目录]
 * 幂等：重跑即按目录现状重建索引。
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = process.argv[2] || 'E:/2010-2026考研英语一详解（PDF）';
const OUT = path.resolve(__dirname, '..', 'articles', 'papers.html');
const TEXT_LIMIT_MB = 60;   // 版式判定阈值（见头注释）

function paperCard(file, stat) {
  const year = (file.match(/^(\d{4})/) || [])[1] || '';
  const mb = (stat.size / 1024 / 1024).toFixed(0);
  const isText = stat.size < TEXT_LIMIT_MB * 1024 * 1024;
  const tag = isText
    ? '<span class="tag type">文字版 · 可选中</span>'
    : '<span class="tag">扫描版 · 图片</span>';
  const url = 'file:///' + encodeURI(path.join(SRC_DIR, file).replace(/\\/g, '/'));
  return '    <a class="card" data-emoji="📕" href="' + url + '" target="_blank">\n' +
    '      <div class="label">' + year + ' 年真题</div>\n' +
    '      <div class="t">' + year + ' 考研英语一 · 全真试题详解</div>\n' +
    '      <div class="open">' + tag + ' <span>' + mb + ' MB</span> · 打开 PDF →</div>\n' +
    '    </a>';
}

let files = [];
try { files = fs.readdirSync(SRC_DIR).filter(f => /真题解析\.pdf$/.test(f)); } catch (e) {
  console.log('⚠ 目录不可读: ' + SRC_DIR + ' — 生成空索引（路径可传参覆盖）');
}
files.sort();
const cards = files.map(f => paperCard(f, fs.statSync(path.join(SRC_DIR, f))));

const PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>真题详解库 · Past Paper Library</title>
<style>
  :root { --bg:#EEF1FA; --card:#F8F9FD; --text:#1E2940; --subtext:#6B7494;
          --accent:#3D52CC; --border:#D0D5E8; --shadow:rgba(30,41,64,.06); }
  * { box-sizing:border-box; margin:0; padding:0; }
  html { font-size:16px; }
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
  .note { background:var(--card); border:1px solid var(--border); border-radius:10px;
          padding:.9rem 1.2rem; font-size:.85rem; color:var(--subtext); margin-bottom:1.4rem; }
  .note b { color:var(--accent); }
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
  .card .open { font-size:.8rem; color:var(--subtext); margin-top:.7rem; display:flex; align-items:center; gap:.5rem; }
  a.card:hover .open { color:var(--accent); }
  .tag { font-size:.68rem; border:1px solid var(--border); border-radius:999px; padding:.05rem .55rem; color:var(--subtext); }
  .tag.type { color:var(--accent); border-color:var(--accent); }
  .empty { color:var(--subtext); padding:2rem 0; }
</style>
</head>
<body>
<div class="page-header">
  <a class="back" href="WSJ_Hub.html">← 返回文库</a>
  <div class="inner">
    <h1>📕 真题详解库</h1>
    <div class="subtitle">2010–2026 考研英语一 · 全真试题与逐题详解 · 共 ${cards.length} 份</div>
  </div>
</div>
<div class="content-wrap">
  <div class="note">
    <b>使用说明</b>：卡片在本机新标签页打开 PDF（含逐句双语解析、考点提炼、真题正确率）。<b>文字版</b>（2010–2018）可选中/复制原文；<b>扫描版</b>（2019–2026）为图片，仅可阅读。
    真题的使用法：第一遍限时做题（配合文库「📋 套卷」的节奏），第二遍对照详解逐句精读，错题按错因归档——真题是唯一有真实区分度数据的题源。
  </div>
  <div class="grid">
${cards.join('\n')}
  </div>
${cards.length ? '' : '  <p class="empty">未找到真题 PDF —— 运行 node scripts/sync_papers_index.js "PDF目录路径"</p>'}
</div>
</body>
</html>
`;

fs.writeFileSync(OUT, PAGE, 'utf8');
console.log('✓ 真题库索引 -> ' + OUT + ' (' + cards.length + ' 份，源: ' + SRC_DIR + ')');
