#!/usr/bin/env node
/**
 * sync_exam_paper.js — 生成模拟套卷页 articles/exam_paper.html（T02）。
 *
 * 流程：选时长（70/50/35 分钟）→ 抽 5 篇 × 4 题混排 → 硬限时（到点自动交卷，未答按错计）
 *      → 交卷出分 → 错题逐题强制选错因（不入库不止）→ 写 wsj_exam:wrongs（key=slug#no，
 *      与单篇练习同键，错题本就地重做互通）+ wsj_exam:history（mode:'exam' + paper:true，雷达/趋势兼容）。
 * 题库：articles/exambank.js（scripts/gen_exambank.js 从 exam_*.html 生成）。
 * 用法: node scripts/sync_exam_paper.js
 */
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..', 'articles', 'exam_paper.html');

// 页面 JS 用字符串拼接（无反引号/模板串），生成器可安全用反引号包整页
const PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>模拟套卷 · Mock Paper</title>
<style>
  :root { --ink:#0f151c; --paper:#fbfcfd; --bg:#f2f0e9; --card:#fff; --fg:#1e2940; --muted:#6b7494;
          --accent:#3d52cc; --accent-bg:rgba(61,82,204,.10); --border:#d0d5e8;
          --sans:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
          --serif:Georgia,"Noto Serif SC","Source Han Serif SC","SimSun",serif; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--fg); font-family:var(--sans); min-height:100vh; }
  .top { background:var(--ink); color:var(--paper); display:flex; align-items:center; gap:14px; padding:10px 18px;
         position:sticky; top:0; z-index:5; }
  .top .brand { font-weight:700; letter-spacing:.12em; }
  .top .timer { margin-left:auto; font-size:20px; font-weight:700; font-variant-numeric:tabular-nums; }
  .top .timer.low { color:#ffd661; }
  .wrap { max-width:860px; margin:0 auto; padding:22px 16px 60px; }
  .art-block { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:18px 20px; margin-bottom:18px; }
  .art-block h2 { font-size:16px; margin-bottom:2px; font-family:var(--serif); }
  .art-block .meta { font-size:12px; color:var(--muted); margin-bottom:10px; }
  .q { border-top:1px dashed var(--border); padding:14px 0 6px; }
  .q .stem { font-size:14px; line-height:1.7; margin-bottom:10px; }
  .q .stem .no { color:var(--accent); font-weight:700; margin-right:6px; }
  .q .tag { font-size:11px; border:1px solid var(--border); border-radius:999px; padding:1px 8px; color:var(--muted); margin-left:6px; }
  .opt { display:block; width:100%; text-align:left; background:var(--bg); border:1px solid var(--border);
         border-radius:8px; padding:9px 12px; margin:6px 0; cursor:pointer; font-size:13.5px; line-height:1.6; color:var(--fg); }
  .opt:hover { border-color:var(--accent); }
  .opt.sel { border-color:var(--accent); background:var(--accent-bg); font-weight:600; }
  .btn { border:1px solid var(--border); background:var(--card); color:var(--fg); border-radius:8px;
         padding:9px 18px; cursor:pointer; font-size:14px; }
  .btn.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
  .btn.danger { background:#b22222; color:#fff; border-color:#b22222; }
  .btn:hover { filter:brightness(1.05); }
  .start-box { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:26px; margin-top:30px; }
  .start-box h1 { font-size:22px; margin-bottom:8px; }
  .start-box p { color:var(--muted); font-size:13.5px; line-height:1.8; margin-bottom:14px; }
  .dur { display:flex; gap:10px; margin:14px 0 20px; }
  .dur button { border:2px solid var(--border); background:var(--card); color:var(--fg); border-radius:10px;
                padding:14px 26px; font-size:16px; cursor:pointer; font-weight:700; }
  .dur button.sel { border-color:var(--accent); background:var(--accent-bg); color:var(--accent); }
  .result { text-align:center; padding:30px 0 10px; }
  .result .big { font-size:44px; font-weight:800; }
  .result .sub { color:var(--muted); margin:6px 0 18px; }
  .cause-row { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:12px 14px; margin-bottom:10px; }
  .cause-row .cs { font-size:13px; line-height:1.65; margin-bottom:8px; }
  .cause-row select { border:1px solid var(--border); border-radius:6px; padding:5px 8px; background:var(--card); color:var(--fg); font-size:13px; }
  .ana { margin-top:10px; border-top:1px dashed var(--border); padding-top:10px; font-size:13px; line-height:1.8; white-space:pre-wrap; color:var(--fg); }
  .right { color:#2a9d6e; font-weight:700; }
  .wrongc { color:#b22222; font-weight:700; }
</style>
</head>
<body>
<div class="top">
  <span class="brand">📋 模拟套卷</span>
  <span id="paper-progress" style="font-size:12px;opacity:.75"></span>
  <span class="timer" id="paper-timer" style="display:none">--:--</span>
  <span style="margin-left:auto"><a href="WSJ_Hub.html" style="color:var(--paper);font-size:12px;text-decoration:none;border:1px solid rgba(255,255,255,.4);border-radius:6px;padding:3px 10px">← 文库</a></span>
</div>
<div class="wrap" id="paper-body"></div>
<script src="exambank.js"></script>
<script>
'use strict';
// ===== 状态 =====
var bank = (window.__EXAM_BANK__ || []).slice();
var state = { duration: 70, articles: [], endsAt: 0, timerId: null, startedAt: 0, submitted: false, answers: {} };
var CAUSES = ['词汇', '长难句', '逻辑', '题型', '粗心', '误译', '定位错误', '干扰项陷阱'];
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

// ===== 开始页 =====
function renderStart() {
  var n = bank.length;
  document.getElementById('paper-body').innerHTML =
    '<div class="start-box">' +
    '<h1>📋 模拟套卷</h1>' +
    '<p>从 <b>' + n + '</b> 篇文章的题库里随机抽 <b>5 篇 × 4 题 = 20 题</b>，篇序打乱（混合题型训练辨别力）。' +
    '<b>硬限时</b>：倒计时归零自动交卷，未答题按错计 —— 限时是考场节奏训练的本体，不可绕过。' +
    '交卷后每道错题必须选错因，才会进入错题本与间隔复习。</p>' +
    '<div class="dur">' +
    '<button data-dur="35">35 分钟<br><span style="font-size:11px;font-weight:400">强度训练</span></button>' +
    '<button data-dur="50">50 分钟<br><span style="font-size:11px;font-weight:400">进阶</span></button>' +
    '<button data-dur="70" class="sel">70 分钟<br><span style="font-size:11px;font-weight:400">真题节奏</span></button>' +
    '</div>' +
    (n >= 1 ? '<button class="btn primary" id="paper-start">开始答题</button>' : '<p>题库为空 —— 先跑 scripts/gen_exambank.js。</p>') +
    '</div>';
  document.querySelectorAll('.dur button').forEach(function (b) {
    b.addEventListener('click', function () {
      state.duration = +b.dataset.dur;
      document.querySelectorAll('.dur button').forEach(function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
    });
  });
  var st = document.getElementById('paper-start');
  if (st) st.addEventListener('click', startPaper);
}

// ===== 组卷 =====
function startPaper() {
  var picks = shuffle(bank.slice()).slice(0, Math.min(5, bank.length));
  state.articles = picks.map(function (a) {
    return { slug: a.slug, title: a.title, meta: a.meta, qs: a.qs.slice() };
  });
  state.endsAt = Date.now() + state.duration * 60000;
  state.startedAt = Date.now();
  state.submitted = false;
  state.answers = {};
  renderPaper();
  document.getElementById('paper-timer').style.display = '';
  state.timerId = setInterval(tick, 500);
  tick();
}

// ===== 答题视图（一篇一屏）=====
function renderPaper() {
  var idx = state.articles.findIndex(function (a) { return !a.done; });
  if (idx < 0) { submitPaper(); return; }
  var a = state.articles[idx];
  document.getElementById('paper-progress').textContent = '第 ' + (idx + 1) + ' / ' + state.articles.length + ' 篇';
  var html = '<div class="art-block"><h2>' + esc(a.title) + '</h2><div class="meta">' + esc(a.meta || '') + ' · 答完点底部继续（可留空，留空按错计）</div>';
  a.qs.forEach(function (q, qi) {
    var qid = a.slug + '#' + q.no;
    var sel = (state.answers[qid] || {}).pick || '';
    html += '<div class="q"><div class="stem"><span class="no">' + (qi + 1) + '.</span>' + esc(q.stem) +
      '<span class="tag">' + esc(q.type || '') + '</span><span class="tag">' + esc(q.difficulty || '') + '</span></div>' +
      Object.keys(q.options || {}).map(function (k) {
        return '<button type="button" class="opt' + (sel === k ? ' sel' : '') + '" data-qid="' + esc(qid) + '" data-opt="' + k + '">' +
          '<b>' + k + '</b> ' + esc(q.options[k]) + '</button>';
      }).join('') + '</div>';
  });
  html += '<div style="display:flex;gap:10px;margin-top:14px">' +
    (idx > 0 ? '<button type="button" class="btn" id="paper-back">← 上一篇</button>' : '') +
    '<button type="button" class="btn primary" id="paper-next" style="margin-left:auto">' +
    (idx === state.articles.length - 1 ? '交卷' : '下一篇 →') + '</button></div></div>';
  var body = document.getElementById('paper-body');
  body.innerHTML = html;
  body.querySelectorAll('.opt').forEach(function (b) {
    b.addEventListener('click', function () {
      state.answers[b.dataset.qid] = { pick: b.dataset.opt, slug: a.slug, q: null };
      body.querySelectorAll('.opt[data-qid="' + b.dataset.qid + '"]').forEach(function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
    });
  });
  var nx = document.getElementById('paper-next');
  nx.addEventListener('click', function () { a.done = true; renderPaper(); });
  var bk = document.getElementById('paper-back');
  if (bk) bk.addEventListener('click', function () { a.done = false; renderPaper(); });
}

// ===== 计时 =====
function tick() {
  var left = state.endsAt - Date.now();
  var el = document.getElementById('paper-timer');
  if (left <= 0) { if (!state.submitted) { showTop('⏰ 时间到，自动交卷'); submitPaper(); } return; }
  var m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  el.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  el.className = 'timer' + (m < 5 ? ' low' : '');
}
function showTop(msg) {
  var b = document.getElementById('paper-body');
  var d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:52px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;padding:8px 18px;border-radius:8px;font-size:13px;z-index:9';
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(function () { d.remove(); }, 2600);
}

// ===== 交卷与报告 =====
function collect() {
  var out = [];
  state.articles.forEach(function (a) {
    a.qs.forEach(function (q) {
      var qid = a.slug + '#' + q.no;
      var ans = state.answers[qid] || {};
      out.push({ slug: a.slug, title: a.title, q: q, qid: qid, pick: ans.pick || '' });
    });
  });
  return out;
}
function submitPaper() {
  if (state.submitted) return;
  state.submitted = true;
  if (state.timerId) clearInterval(state.timerId);
  var items = collect();
  var correct = items.filter(function (x) { return x.pick === x.q.answer; }).length;
  var elapsed = Math.round((Date.now() - state.startedAt) / 1000);
  // 成绩历史（mode:'exam' 兼容既有雷达/趋势聚合；paper:true 标记套卷）
  var hist = [];
  try { hist = JSON.parse(localStorage.getItem('wsj_exam:history')) || []; } catch (e) {}
  hist.push({
    slug: 'mock-paper', title: '模拟套卷 · ' + items.length + ' 题', mode: 'exam', paper: true,
    at: new Date().toISOString(), correct: correct, total: items.length,
    elapsed: elapsed, duration: state.duration * 60,
    perQ: items.map(function (x) { return { no: x.q.no, mine: x.pick, right: x.q.answer, type: x.q.type || '', slug: x.slug }; })
  });
  try { localStorage.setItem('wsj_exam:history', JSON.stringify(hist.slice(-200))); } catch (e) {}
  renderReport(items, correct, elapsed);
}
function renderReport(items, correct, elapsed) {
  var wrongs = items.filter(function (x) { return x.pick !== x.q.answer; });
  var mm = Math.floor(elapsed / 60), ss = elapsed % 60;
  var html = '<div class="result"><div class="big">' + correct + ' / ' + items.length + '</div>' +
    '<div class="sub">用时 ' + mm + ' 分 ' + ss + ' 秒 · 错题 ' + wrongs.length + ' 道（每道选错因后入错题本）</div></div>';
  html += '<div id="cause-panel">';
  if (wrongs.length) {
    html += wrongs.map(function (x, i) {
      return '<div class="cause-row"><div class="cs"><b>' + x.slug + ' 第 ' + x.q.no + ' 题</b> · 正确答案 <span class="right">' + x.q.answer + '</span>' +
        ' · 你的答案 <span class="wrongc">' + (x.pick || '（未答）') + '</span></div>' +
        '<div class="cs" style="color:var(--muted)">' + esc(String(x.q.stem).slice(0, 110)) + '…</div>' +
        '<select id="cause-' + i + '"><option value="">— 必选：这道题错在 —</option>' +
        CAUSES.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('') + '</select></div>';
    }).join('');
    html += '<div style="text-align:center;margin:14px 0"><button class="btn primary" id="cause-commit">确认错因并入库</button></div>';
  } else {
    html += '<div style="text-align:center;color:#2a9d6e;font-weight:700;padding:12px">全对 🎉</div>';
  }
  html += '</div><div id="analysis-panel"></div>';
  var body = document.getElementById('paper-body');
  body.innerHTML = html;
  document.getElementById('paper-timer').style.display = 'none';
  var cm = document.getElementById('cause-commit');
  if (cm) cm.addEventListener('click', function () {
    var recs = [];
    try { recs = JSON.parse(localStorage.getItem('wsj_exam:wrongs')) || []; } catch (e) {}
    var pending = [];
    wrongs.forEach(function (x, i) {
      var v = document.getElementById('cause-' + i).value;
      if (!v) pending.push(x.slug + '#' + x.q.no);
      else {
        var data = {
          key: x.qid, slug: x.slug, title: x.title, no: x.q.no, type: x.q.type || '',
          myAnswer: x.pick, answer: x.q.answer || '', cause: v,
          stem: x.q.stem || '', options: x.q.options || {}, analysis: x.q.analysis || '',
          at: new Date().toISOString(), paper: true
        };
        var ex = recs.find(function (r) { return r.key === x.qid; });
        if (ex) Object.assign(ex, data); else recs.push(data);
      }
    });
    if (pending.length) { alert('还有 ' + pending.length + ' 道错题没选错因：\\n' + pending.join('\\n')); return; }
    try { localStorage.setItem('wsj_exam:wrongs', JSON.stringify(recs)); } catch (e) { alert('写入失败（存储已满？）'); return; }
    document.getElementById('cause-panel').innerHTML =
      '<div style="text-align:center;color:#2a9d6e;font-weight:700;padding:10px">✓ 错题已入库，间隔复习已排期（错题本可就地重做）</div>';
    renderAnalysis(items);
  });
  if (!wrongs.length) renderAnalysis(items);
}
function renderAnalysis(items) {
  var html = '<div class="group-h" style="font-size:14px;font-weight:700;margin:18px 0 8px">逐题解析</div>';
  html += items.map(function (x) {
    var ok = x.pick === x.q.answer;
    return '<div class="art-block"><div class="cs" style="font-size:13px;line-height:1.7"><b>' + x.slug + ' · 第 ' + x.q.no + ' 题（' + esc(x.q.type || '') + '）</b><br>' +
      esc(x.q.stem) + '</div>' +
      '<div style="margin-top:6px;font-size:13px">你的答案：<span class="' + (ok ? 'right' : 'wrongc') + '">' + (x.pick || '（未答）') + '</span>' +
      ' · 正确答案：<span class="right">' + x.q.answer + '</span></div>' +
      '<details style="margin-top:8px"><summary style="cursor:pointer;font-size:13px;color:var(--accent)">展开解析</summary>' +
      '<div class="ana">' + esc(x.q.analysis || '（无解析）') + '</div></details></div>';
  }).join('');
  html += '<div style="text-align:center;margin-top:16px"><button class="btn" onclick="location.reload()">再来一套</button> ' +
    '<button class="btn" onclick="location.href=\\'WSJ_Hub.html\\'">回文库</button></div>';
  document.getElementById('analysis-panel').innerHTML = html;
}

renderStart();
</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, PAGE, 'utf8');
console.log('✓ 模拟套卷页 -> ' + OUT + ' (' + (PAGE.length / 1024).toFixed(1) + ' KB)');
