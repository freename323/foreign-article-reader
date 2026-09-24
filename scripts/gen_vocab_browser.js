// v19: 把 wordfreq.js 解析为 HTML 词汇浏览器 + MD 复习清单
// 不修改 wordfreq.js，仅作为静态导出工具
'use strict';
const fs = require('fs');
const path = require('path');

// 1. 解析 wordfreq.js —— 直接 require 数据（注释是 GBK 不影响 JS 解析）
// wordfreq.js 内容: window.__WORD_FREQ__ = {"b": [...], "h": [...], "m": [...], "l": [...], "o": [...]};
const wfPath = path.join(__dirname, 'wordfreq.js');
const wfSrc = fs.readFileSync(wfPath, 'utf8');
// 用 vm 隔离执行避免污染全局
const vm = require('vm');
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(wfSrc, ctx);
const WF = ctx.window.__WORD_FREQ__;
console.log('=== wordfreq.js 解析 ===');
console.log(`总 bucket 数: ${Object.keys(WF).length}`);
let totalWords = 0;
['b','h','m','l','o'].forEach(k => {
  const c = (WF[k] || []).length;
  totalWords += c;
  console.log(`  ${k}: ${c} 个词`);
});
console.log(`总单词数: ${totalWords}`);

// 2. 频率级别元信息
const TIER_INFO = {
  b: { label: '基础词', desc: '初中 / 高中基础词汇（不着色，不需专门背诵）', color: '#6b6b66' },
  h: { label: '高频词', desc: '真题出现 ≥8 年（必须熟练）', color: '#1a3a6c' },
  m: { label: '中频词', desc: '真题出现 3-7 年（建议掌握）', color: '#2e7d32' },
  l: { label: '低频词', desc: '真题出现 1-2 年（知道即可）', color: '#ef6c00' },
  o: { label: '大纲外词', desc: '大纲词汇但未在真题出现（了解）', color: '#7a8599' }
};

// 3. 生成 HTML 词汇浏览器
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function generateHtml() {
  let html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>外刊阅读器 · 词汇浏览器</title>
<style>
  :root {
    --bg: #faf9f6; --fg: #1c1c1c; --muted: #6b6b66; --rule: #d8d4c8;
    --panel: #f3f0e7; --panel-2: #ebe7d9;
    --card: #ffffff;
    --accent: #1a3a6c;
    --tier-b: #6b6b66; --tier-h: #1a3a6c; --tier-m: #2e7d32; --tier-l: #ef6c00; --tier-o: #7a8599;
  }
  [data-theme="dark"] {
    --bg: #16181c; --fg: #e8e6e1; --muted: #9a978f; --rule: #3a3d44;
    --panel: #1d2026; --panel-2: #252830;
    --card: #1d2026;
    --accent: #8fb0e0;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0; padding: 0;
    font-family: -apple-system, "Segoe UI", "PingFang SC", sans-serif;
    background: var(--bg); color: var(--fg);
    line-height: 1.65;
  }
  .topbar {
    position: sticky; top: 0; z-index: 50;
    background: var(--panel); border-bottom: 1px solid var(--rule);
    padding: 8px 24px; display: flex; align-items: center; justify-content: space-between;
  }
  .topbar input {
    width: 320px; padding: 6px 10px; border: 1px solid var(--rule);
    border-radius: 6px; background: var(--bg); color: var(--fg);
    font: inherit; font-size: 13px;
  }
  .topbar .stats { color: var(--muted); font-size: 12.5px; }
  .topbar .right button {
    background: transparent; border: 1px solid var(--rule); color: var(--fg);
    padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 12px;
    font-family: inherit; margin-left: 6px;
  }
  .topbar .right button:hover { background: var(--panel-2); }
  main { max-width: 980px; margin: 0 auto; padding: 20px 32px 80px; }
  h1 { margin: 0 0 4px; font-size: 22px; color: var(--accent); }
  .intro { color: var(--muted); font-size: 13px; margin-bottom: 20px; }
  .toc {
    display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px;
    padding: 12px 14px; background: var(--panel); border-radius: 8px;
  }
  .toc a {
    padding: 4px 12px; border-radius: 16px; background: var(--card);
    border: 1px solid var(--rule); text-decoration: none; color: var(--fg);
    font-size: 12.5px;
  }
  .toc a:hover { background: var(--panel-2); color: var(--accent); }
  .toc a .count { color: var(--muted); margin-left: 4px; font-size: 11px; }
  section.tier { margin-bottom: 28px; padding-bottom: 16px; border-bottom: 2px solid var(--rule); }
  section.tier h2 {
    margin: 0 0 4px; font-size: 17px;
  }
  section.tier h2 .badge {
    display: inline-block; padding: 1px 8px; border-radius: 10px;
    font-size: 12px; font-weight: 600; color: #fff; vertical-align: middle;
    margin-left: 6px;
  }
  section.tier h2 .badge.b { background: var(--tier-b); }
  section.tier h2 .badge.h { background: var(--tier-h); }
  section.tier h2 .badge.m { background: var(--tier-m); }
  section.tier h2 .badge.l { background: var(--tier-l); }
  section.tier h2 .badge.o { background: var(--tier-o); }
  section.tier .desc { color: var(--muted); font-size: 12.5px; margin-bottom: 12px; }
  .words {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 4px 8px; font-size: 13.5px;
  }
  .words span {
    padding: 2px 4px; border-radius: 3px; cursor: default;
    word-break: break-word;
  }
  .words span.b { color: var(--tier-b); }
  .words span.h { color: var(--tier-h); font-weight: 500; }
  .words span.m { color: var(--tier-m); }
  .words span.l { color: var(--tier-l); }
  .words span.o { color: var(--tier-o); font-style: italic; }
  .words span:hover { background: var(--panel-2); }
  .words span mark { background: var(--hl, #fff8c5); padding: 0 2px; border-radius: 2px; }
  .empty { color: var(--muted); padding: 10px 14px; text-align: center; }
  footer { color: var(--muted); font-size: 12px; margin-top: 20px; padding-top: 12px; border-top: 1px solid var(--rule); }
</style>
</head>
<body>

<div class="topbar">
  <div class="stats">共 <strong>${totalWords}</strong> 词 · ${Object.keys(WF).length} 个频率级别</div>
  <input id="search" placeholder="🔍 搜索（中文无效，仅英文）" autocomplete="off">
  <div class="right">
    <button data-theme="">浅色</button>
    <button data-theme="dark">暗色</button>
  </div>
</div>

<main>
  <h1>📖 词汇浏览器</h1>
  <p class="intro">考研英语词频分级数据（来源: YSMull/words-statistics 真题逐年词表 + 5495 大纲词汇 + 基础词）</p>

  <div class="toc">
    ${['b','h','m','l','o'].map(k => `<a href="#tier-${k}">${TIER_INFO[k].label} <span class="count">${(WF[k]||[]).length}</span></a>`).join('\n    ')}
  </div>

`;

  ['b','h','m','l','o'].forEach(k => {
    const words = WF[k] || [];
    html += `
  <section class="tier" id="tier-${k}">
    <h2>${TIER_INFO[k].label}<span class="badge ${k}">${k} · ${words.length}</span></h2>
    <p class="desc">${TIER_INFO[k].desc}</p>
    <div class="words">
      ${words.map(w => `<span class="${k}" data-word="${escapeHtml(w)}">${escapeHtml(w)}</span>`).join('\n      ')}
    </div>
  </section>
`;
  });

  html += `
  <footer>
    导出工具：articles/_wordfreq_export.js · 数据：articles/wordfreq.js<br>
    频率级别: b=基础词(不参与着色) · h=高频(≥8年) · m=中频(3-7年) · l=低频(1-2年) · o=大纲外词
  </footer>
</main>

<script>
  // 主题切换
  document.querySelectorAll('.topbar .right button').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.theme;
      if (t === '') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', t);
    });
  });
  // 搜索
  const searchInput = document.getElementById('search');
  searchInput.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.words span').forEach(el => {
      const w = el.dataset.word;
      if (!q || w.includes(q)) {
        el.style.display = '';
        if (q && w.includes(q)) {
          // 高亮匹配的子串
          const idx = w.indexOf(q);
          if (idx >= 0) {
            el.innerHTML = w.slice(0, idx) + '<mark>' + w.slice(idx, idx + q.length) + '</mark>' + w.slice(idx + q.length);
          }
        } else {
          el.textContent = w;
        }
      } else {
        el.style.display = 'none';
      }
    });
  });
</script>

</body>
</html>
`;
  return html;
}

// 4. 生成 MD 复习清单（按 bucket 分文件）
function generateMd(bucket) {
  const info = TIER_INFO[bucket];
  const words = WF[bucket] || [];
  let md = `# ${info.label}（${bucket.toUpperCase()}）\n\n`;
  md += `> ${info.desc}\n\n`;
  md += `- **总词数**: ${words.length}\n`;
  md += `- **数据源**: YSMull/words-statistics 真题词表 + 5495 大纲词汇\n`;
  md += `- **使用方式**: 作为复习 checklist，每掌握一个打 ✓\n\n`;
  md += `---\n\n`;
  // 每行 10 个词
  for (let i = 0; i < words.length; i += 10) {
    md += words.slice(i, i + 10).map(w => `- [ ] \`${w}\``).join(' ') + '\n';
  }
  return md;
}

// 5. 写入文件
const html = generateHtml();
const htmlPath = path.join(__dirname, '_vocab_browser.html');
fs.writeFileSync(htmlPath, html, 'utf8');
console.log(`\n生成 HTML: ${htmlPath} (${(html.length/1024).toFixed(1)} KB)`);

['b','h','m','l','o'].forEach(k => {
  const md = generateMd(k);
  const mdPath = path.join(__dirname, `vocab_${k}.md`);
  fs.writeFileSync(mdPath, md, 'utf8');
  console.log(`生成 MD:   ${mdPath} (${(md.length/1024).toFixed(1)} KB)`);
});

console.log('\n=== 全部生成完成 ===');