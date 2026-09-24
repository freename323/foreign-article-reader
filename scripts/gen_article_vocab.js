// v20: 每篇文章生词统计
// 策略：从 9 篇外刊 HTML 的 contenteditable data-default 属性提取 EN 正文
//       对每篇文本做词频分析（与 wordfreq.js 5 bucket 比对）
//       输出：1 个 HTML 单页（每篇一章节）+ 9 个 MD 文件（每篇生词清单）
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 1. 加载 wordfreq.js
const wfSrc = fs.readFileSync(path.join(__dirname, 'wordfreq.js'), 'utf8');
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(wfSrc, ctx);
const WF = ctx.window.__WORD_FREQ__;
const WF_SET = new Set();
Object.values(WF).forEach(arr => arr.forEach(w => WF_SET.add(w)));
console.log(`wordfreq.js 总词数: ${WF_SET.size}`);

// 2. 函数词 / 停用词（与项目内一致，参考 newtype.js 的 FUNCTION_WORDS）
const FUNCTION_WORDS = new Set('the a an and or but if of in to for with on at by from as that this these those it its their there here when where why how what while because although though since until unless whereas whether nor is are was were be been being have has had do does did not no so than then very more most much many some any only just about into over under between among through during before after above below out up down off again once all both each few other another own same too also can could may might shall should will would must need'.split(' '));

// 3. 简易词形还原（启发式）
function lemma(w) {
  let s = w.toLowerCase();
  if (s.length <= 3) return s;
  // 复数
  if (s.endsWith('ies') && s.length > 4) s = s.slice(0, -3) + 'y';
  else if (s.endsWith('es') && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith('s') && !s.endsWith('ss') && !s.endsWith('us') && s.length > 3) s = s.slice(0, -1);
  // 过去式 / 过去分词
  if (s.endsWith('ed') && s.length > 4) {
    if (s.endsWith('ied')) s = s.slice(0, -3) + 'y';
    else if (s.endsWith('tted')) s = s.slice(0,-2);
    else if (s.endsWith('ked') || s.endsWith('sed') || s.endsWith('ced') || s.endsWith('red') || s.endsWith('led') || s.endsWith('ned') || s.endsWith('med') || s.endsWith('ped') || s.endsWith('red') || s.endsWith('ted') || s.endsWith('ved') || s.endsWith('ged') || s.endsWith('fed') || s.endsWith('hed') || s.endsWith('wed')) s = s.slice(0, -2);
    else s = s.slice(0, -1);  // walked → walk
  }
  // ing
  if (s.endsWith('ing') && s.length > 5) {
    if (s.endsWith('tting') || s.endsWith('pping') || s.endsWith('gging') || s.endsWith('ssing') || s.endsWith('lling') || s.endsWith('nning') || s.endsWith('mming') || s.endsWith('rring')) s = s.slice(0, -3);
    else if (s.endsWith('ting') || s.endsWith('ping') || s.endsWith('king') || s.endsWith('sing') || s.endsWith('cing') || s.endsWith('ring') || s.endsWith('ling') || s.endsWith('ning') || s.endsWith('ming') || s.endsWith('ding') || s.endsWith('ging') || s.endsWith('ving') || s.endsWith('zing') || s.endsWith('hing') || s.endsWith('wing') || s.endsWith('ying')) s = s.slice(0, -3);
    else if (s.endsWith('ing')) s = s.slice(0, -3);  // going → go (近似)
  }
  return s;
}

// 4. 从单篇文章 HTML 提取 EN 文本（data-default 属性）
function extractText(htmlFile) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const matches = [...html.matchAll(/data-default="([^"]+)"/g)];
  const paragraphs = matches.map(m => decodeEntities(m[1]));
  return paragraphs.join(' ');
}

function decodeEntities(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&#39;/g, "'");
}

// 5. 词频分析
function analyzeText(text) {
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  const counts = {};
  const lemmas = {};
  words.forEach(w => {
    const lower = w.toLowerCase().replace(/^['-]+|['-]+$/g, '');
    if (lower.length <= 2 || /^\d/.test(lower)) return;
    if (FUNCTION_WORDS.has(lower)) return;
    counts[lower] = (counts[lower] || 0) + 1;
    const lem = lemma(lower);
    lemmas[lem] = (lemmas[lem] || 0) + 1;
  });
  // 分类每个 lemma
  const distribution = { b: 0, h: 0, m: 0, l: 0, o: 0, x: 0 };
  const tierWords = { b: [], h: [], m: [], l: [], o: [], x: [] };
  Object.keys(lemmas).forEach(lem => {
    let tier = 'x';  // 超纲
    if ((WF.b || []).includes(lem)) tier = 'b';
    else if ((WF.h || []).includes(lem)) tier = 'h';
    else if ((WF.m || []).includes(lem)) tier = 'm';
    else if ((WF.l || []).includes(lem)) tier = 'l';
    else if ((WF.o || []).includes(lem)) tier = 'o';
    distribution[tier] += 1;
    tierWords[tier].push({ word: lem, count: lemmas[lem] });
  });
  // 按 count 降序
  Object.keys(tierWords).forEach(t => tierWords[t].sort((a, b) => b.count - a.count));
  return { totalWords: words.length, uniqueLemmas: Object.keys(lemmas).length, distribution, tierWords };
}

// 6. 文章列表
const ARTICLES = [
  { id: 'ai_reg', file: 'WSJ_2026-03-21_AI_Regulation_Fryer_EN-CN_final.html', title: 'AI Regulation', source: 'WSJ', date: '2026-03-21' },
  { id: 'ammo', file: 'WSJ_2026-03-21_Ammo_Shortage_Jones_EN-CN_final.html', title: 'Ammo Shortage', source: 'WSJ', date: '2026-03-21' },
  { id: 'fcc_sports', file: 'WSJ_2026-03-21_FCC_Sports_Jenkins_EN-CN_final.html', title: 'FCC Sports', source: 'WSJ', date: '2026-03-21' },
  { id: 'haldane', file: 'SundayTimes_2026-06-14_Haldane_Chainsaw_Regulation_Treanor_EN-CN_final.html', title: 'Haldane Chainsaw Regulation', source: 'Sunday Times', date: '2026-06-14' },
  { id: 'hidden_ai', file: 'SundayTimes_2026-06-14_Hidden_Cost_AI_Fortson_EN-CN_final.html', title: 'Hidden Cost AI', source: 'Sunday Times', date: '2026-06-14' },
  { id: 'pensions', file: 'SundayTimes_2026-06-14_Junior_Pensions_Filby_EN-CN_final.html', title: 'Junior Pensions', source: 'Sunday Times', date: '2026-06-14' },
  { id: 'pothole', file: 'SundayTimes_2026-06-14_Pothole_Compensation_Harwood-Baynes_EN-CN_final.html', title: 'Pothole Compensation', source: 'Sunday Times', date: '2026-06-14' },
  { id: 'moral_econ', file: 'Science_2026-03-26_Moral_Economics_Perry_EN-CN_final.html', title: 'Moral Economics', source: 'Science', date: '2026-03-26' },
  { id: 'horvitz', file: 'Science_2026-06-04_Narrowing_Window_AI_Horvitz-West_EN-CN_final.html', title: 'Narrowing Window AI', source: 'Science', date: '2026-06-04' }
];

// 7. 处理每篇文章
const TIER_LABELS = { b: '基础词', h: '高频', m: '中频', l: '低频', o: '大纲外', x: '超纲' };
const TIER_COLORS = { b: '#6b6b66', h: '#1a3a6c', m: '#2e7d32', l: '#ef6c00', o: '#7a8599', x: '#c62828' };

console.log('\n=== 处理 9 篇文章 ===');
const articleStats = [];
ARTICLES.forEach(a => {
  const fullPath = path.join(__dirname, a.file);
  if (!fs.existsSync(fullPath)) {
    console.log(`  ❌ ${a.id}: 文件不存在`);
    return;
  }
  const text = extractText(fullPath);
  const stats = analyzeText(text);
  articleStats.push({ ...a, ...stats });
  console.log(`  ✅ ${a.id.padEnd(12)} 总词数=${stats.totalWords}  唯一lemma=${stats.uniqueLemmas}  b/h/m/l/o/x=${stats.distribution.b}/${stats.distribution.h}/${stats.distribution.m}/${stats.distribution.l}/${stats.distribution.o}/${stats.distribution.x}`);
});

// 8. 生成 HTML 单页（每篇一章节）
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

let html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>外刊阅读器 · 每篇文章生词统计</title>
<style>
  :root {
    --bg: #faf9f6; --fg: #1c1c1c; --muted: #6b6b66; --rule: #d8d4c8;
    --panel: #f3f0e7; --panel-2: #ebe7d9;
    --card: #ffffff;
    --accent: #1a3a6c;
    --b: #6b6b66; --h: #1a3a6c; --m: #2e7d32; --l: #ef6c00; --o: #7a8599; --x: #c62828;
  }
  [data-theme="dark"] {
    --bg: #16181c; --fg: #e8e6e1; --muted: #9a978f; --rule: #3a3d44;
    --panel: #1d2026; --panel-2: #252830;
    --card: #1d2026;
    --accent: #8fb0e0;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin: 0; padding: 0; font-family: -apple-system, "Segoe UI", "PingFang SC", sans-serif; background: var(--bg); color: var(--fg); line-height: 1.65; }
  .topbar { position: sticky; top: 0; z-index: 50; background: var(--panel); border-bottom: 1px solid var(--rule); padding: 8px 24px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .topbar input { flex: 1; max-width: 360px; padding: 6px 10px; border: 1px solid var(--rule); border-radius: 6px; background: var(--bg); color: var(--fg); font: inherit; font-size: 13px; }
  .topbar .stats { color: var(--muted); font-size: 12.5px; }
  .topbar .right button { background: transparent; border: 1px solid var(--rule); color: var(--fg); padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; font-family: inherit; margin-left: 6px; }
  .topbar .right button:hover { background: var(--panel-2); }
  main { max-width: 1080px; margin: 0 auto; padding: 20px 32px 80px; }
  h1 { margin: 0 0 4px; font-size: 22px; color: var(--accent); }
  .intro { color: var(--muted); font-size: 13px; margin-bottom: 16px; }
  .toc { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 20px; padding: 10px 14px; background: var(--panel); border-radius: 8px; }
  .toc a { padding: 3px 10px; border-radius: 14px; background: var(--card); border: 1px solid var(--rule); text-decoration: none; color: var(--fg); font-size: 12px; }
  .toc a:hover { background: var(--panel-2); color: var(--accent); }
  section.article { margin-bottom: 28px; padding: 16px; border: 1px solid var(--rule); border-radius: 10px; background: var(--card); }
  section.article h2 { margin: 0 0 6px; font-size: 17px; color: var(--accent); }
  section.article .meta { color: var(--muted); font-size: 12px; margin-bottom: 10px; }
  .dist { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0 12px; font-size: 12px; }
  .dist .chip { padding: 3px 10px; border-radius: 12px; background: var(--panel-2); border: 1px solid var(--rule); }
  .dist .chip b { color: var(--accent); }
  .dist .chip .b { color: var(--b); } .dist .chip .h { color: var(--h); } .dist .chip .m { color: var(--m); } .dist .chip .l { color: var(--l); } .dist .chip .o { color: var(--o); } .dist .chip .x { color: var(--x); font-weight: 600; }
  .tier-block { margin-top: 10px; padding: 8px 12px; background: var(--panel); border-radius: 6px; }
  .tier-block h3 { margin: 0 0 4px; font-size: 13px; font-weight: 600; }
  .tier-block .words { display: flex; flex-wrap: wrap; gap: 6px 10px; font-size: 13px; }
  .tier-block .words span { padding: 1px 6px; border-radius: 3px; }
  .tier-block .words span.b { color: var(--b); } .tier-block .words span.h { color: var(--h); font-weight: 500; } .tier-block .words span.m { color: var(--m); } .tier-block .words span.l { color: var(--l); } .tier-block .words span.o { color: var(--o); font-style: italic; } .tier-block .words span.x { color: var(--x); font-weight: 600; background: rgba(198,40,40,0.08); }
  .tier-block .words span .cnt { font-size: 10px; color: var(--muted); margin-left: 2px; }
  .hidden { display: none !important; }
  footer { color: var(--muted); font-size: 12px; margin-top: 20px; padding-top: 12px; border-top: 1px solid var(--rule); }
</style>
</head>
<body>

<div class="topbar">
  <div class="stats">共 <strong>${articleStats.length}</strong> 篇 · 总唯一 lemma <strong>${new Set(articleStats.flatMap(a => Object.keys(a.tierWords).flatMap(t => a.tierWords[t].map(w => w.word)))).size}</strong></div>
  <input id="search" placeholder="🔍 搜索词（英文小写）" autocomplete="off">
  <div class="right">
    <button data-theme="">浅色</button>
    <button data-theme="dark">暗色</button>
  </div>
</div>

<main>
  <h1>📊 每篇文章生词统计</h1>
  <p class="intro">扫 9 篇外刊正文，与词频字典 5 级别（b/h/m/l/o）+ 超纲（x）对比，定位每篇文章需要重点记忆的生词</p>

  <div class="toc">
    ${articleStats.map(a => `<a href="#art-${a.id}">${escapeHtml(a.title)} <span style="color:var(--muted)">${a.source}</span></a>`).join('\n    ')}
  </div>
`;

articleStats.forEach(a => {
  html += `
  <section class="article" id="art-${a.id}">
    <h2>${escapeHtml(a.title)}</h2>
    <div class="meta">${escapeHtml(a.source)} · ${escapeHtml(a.date)} · 总词数 ${a.totalWords} · 唯一 lemma ${a.uniqueLemmas}</div>
    <div class="dist">
      ${['b','h','m','l','o','x'].map(t => `<span class="chip"><span class="${t}"><b>${TIER_LABELS[t]}</b></span> <b>${a.distribution[t]}</b></span>`).join('\n      ')}
    </div>
    ${['l','o','x','m','h','b'].filter(t => a.tierWords[t].length > 0).map(t => `
    <div class="tier-block">
      <h3><span class="${t}">${TIER_LABELS[t]}</span> (${a.tierWords[t].length} 词)</h3>
      <div class="words">
        ${a.tierWords[t].slice(0, 50).map(w => `<span class="${t}" data-word="${escapeHtml(w.word)}">${escapeHtml(w.word)}<span class="cnt">×${w.count}</span></span>`).join('\n        ')}
        ${a.tierWords[t].length > 50 ? `<span style="color:var(--muted);font-size:11px;">… 还有 ${a.tierWords[t].length - 50} 个</span>` : ''}
      </div>
    </div>`).join('\n    ')}
  </section>
`;
});

html += `
  <footer>
    导出工具：articles/_article_vocab.js · 9 篇文章扫描结果<br>
    词频数据：articles/wordfreq.js · 频率: b=基础 / h=高频 / m=中频 / l=低频 / o=大纲外 / x=超纲
  </footer>
</main>

<script>
  document.querySelectorAll('.topbar .right button').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.theme;
      if (t === '') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', t);
    });
  });
  document.getElementById('search').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.tier-block .words span[data-word]').forEach(el => {
      el.classList.toggle('hidden', q && !el.dataset.word.includes(q));
    });
  });
</script>

</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, '_article_vocab.html'), html, 'utf8');
console.log(`\n生成 HTML: _article_vocab.html (${(html.length/1024).toFixed(1)} KB)`);

// 9. 生成每篇 MD
articleStats.forEach(a => {
  let md = `# ${a.title}\n\n`;
  md += `> 来源: ${a.source} · 日期: ${a.date} · 总词数 ${a.totalWords} · 唯一 lemma ${a.uniqueLemmas}\n\n`;
  md += `## 词频分布\n\n`;
  md += `| 级别 | 含义 | 数量 |\n|---|---|---|\n`;
  ['b','h','m','l','o','x'].forEach(t => {
    md += `| **${t}** | ${TIER_LABELS[t]} | ${a.distribution[t]} |\n`;
  });
  md += `\n---\n\n`;

  ['l','o','x','m','h'].forEach(t => {
    if (a.tierWords[t].length === 0) return;
    md += `## ${TIER_LABELS[t]} (${t.toUpperCase()}) — ${a.tierWords[t].length} 词\n\n`;
    a.tierWords[t].slice(0, 100).forEach(w => {
      md += `- [ ] \`${w.word}\` ×${w.count}\n`;
    });
    if (a.tierWords[t].length > 100) {
      md += `\n> 还有 ${a.tierWords[t].length - 100} 个未列出，详见 HTML 视图\n`;
    }
    md += `\n`;
  });

  const mdPath = path.join(__dirname, `vocab_${a.id}.md`);
  fs.writeFileSync(mdPath, md, 'utf8');
  console.log(`生成 MD:   vocab_${a.id}.md (${(md.length/1024).toFixed(1)} KB)`);
});

console.log('\n=== 全部生成完成 ===');