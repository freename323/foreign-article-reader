#!/usr/bin/env node
/**
 * sync_writing_page.js — 生成独立写作页 articles/writing.html（写作工坊的「单独页面」形态）。
 *
 *   左栏：范文库（wsj_writing:readings）对照阅读
 *   右栏：仿写草稿（wsj_writing:essays，与文章内工坊同 schema 同键）+ 笔记（wsj_writing:notes）+ 素材（wsj_writing:materials 只读）
 *
 * 数据全部走 localStorage 同一批键 —— 独立页写的草稿/笔记，文章内工坊直接可见，反之亦然。
 * 文章内嵌工坊（读文章记素材）保持不变，这是第二种形态。
 *
 * 用法: node scripts/sync_writing_page.js
 * 幂等：页面源内联在本脚本里，重跑即更新。articles/ 不进 git。
 */
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..', 'articles', 'writing.html');

// 页面 JS 全部用字符串拼接（不用反引号/模板串），因此这里可以安全地用反引号包整页源码。
const PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>写作工坊 · 独立写作页</title>
<style>
  :root { --ink:#0f151c; --paper:#fbfcfd; --bg:#f2f0e9; --card:#fff; --fg:#1e2940;
          --muted:#6b7494; --accent:#3d52cc; --accent-bg:rgba(61,82,204,.10);
          --border:#d0d5e8; --shadow:rgba(30,41,64,.08);
          --serif:Georgia,"Noto Serif SC","Source Han Serif SC","SimSun",serif;
          --sans:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--fg); font-family:var(--sans); min-height:100vh; display:flex; flex-direction:column; }
  .mastbar { background:var(--ink); color:var(--paper); display:flex; align-items:center; gap:14px; padding:9px 18px; }
  .mastbar .brand { font-size:17px; font-weight:700; letter-spacing:.14em; white-space:nowrap; }
  .mastbar .hint { font-size:11px; letter-spacing:.1em; opacity:.65; text-transform:uppercase; }
  .mastbar .links { margin-left:auto; display:flex; gap:8px; }
  .mastbar a { color:var(--paper); text-decoration:none; font-size:12px; border:1px solid rgba(255,255,255,.4);
               border-radius:6px; padding:3px 10px; white-space:nowrap; }
  .mastbar a:hover { background:rgba(255,255,255,.14); }
  .main { flex:1; display:flex; min-height:0; }
  .pane { overflow-y:auto; padding:18px; }
  .pane.reads { flex:0 0 46%; border-right:1px solid var(--border); background:var(--paper); }
  .pane.write { flex:1; background:var(--bg); }
  @media (max-width: 900px) { .main { flex-direction:column; } .pane.reads { flex:0 0 auto; border-right:none; border-bottom:1px solid var(--border); max-height:46vh; } }
  .bar { display:flex; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap; }
  .bar select { flex:1; min-width:0; font-family:var(--sans); font-size:13px; padding:5px 6px;
                border:1px solid var(--border); border-radius:6px; background:var(--card); color:var(--fg); }
  .bar .nav { border:1px solid var(--border); background:var(--card); color:var(--fg); border-radius:6px;
              padding:5px 10px; cursor:pointer; font-size:13px; }
  .bar .nav:hover { background:var(--accent-bg); }
  .meta { font-size:12px; color:var(--muted); margin-bottom:10px; }
  .para { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:12px 14px; margin-bottom:10px; }
  .para .head { display:flex; align-items:center; gap:6px; margin-bottom:6px; }
  .para .label { font-weight:700; font-size:13px; }
  .tag { font-size:11px; border:1px solid var(--border); border-radius:999px; padding:1px 8px; color:var(--muted); }
  .tag.type { color:var(--accent); border-color:var(--accent-light, var(--accent)); background:var(--accent-bg); }
  .para .text { font-family:var(--serif); font-size:14px; line-height:1.9; }
  .tabs { display:flex; gap:4px; margin-bottom:12px; flex-wrap:wrap; }
  .tabs button { border:1px solid var(--border); background:var(--card); color:var(--fg); border-radius:6px;
                 padding:6px 14px; cursor:pointer; font-size:13px; }
  .tabs button.active { background:var(--ink); color:var(--paper); border-color:var(--ink); }
  .primary { background:var(--accent); color:#fff; border:none; border-radius:6px; padding:6px 14px;
             cursor:pointer; font-size:13px; }
  .primary:hover { filter:brightness(1.08); }
  .ghost { background:var(--card); color:var(--fg); border:1px solid var(--border); border-radius:6px;
           padding:5px 12px; cursor:pointer; font-size:12.5px; }
  .ghost:hover { background:var(--accent-bg); }
  .ghost.danger { color:#b22222; }
  .list { display:flex; flex-direction:column; gap:6px; margin-bottom:12px; }
  .item { display:flex; align-items:center; gap:8px; background:var(--card); border:1px solid var(--border);
          border-radius:8px; padding:8px 10px; cursor:pointer; }
  .item:hover { border-color:var(--accent); }
  .item.active { border-color:var(--accent); background:var(--accent-bg); }
  .item .t { flex:1; min-width:0; font-size:13px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .item .m { font-size:11px; color:var(--muted); white-space:nowrap; }
  .item .del { border:none; background:none; color:var(--muted); cursor:pointer; font-size:12px; padding:2px; }
  .item .del:hover { color:#b22222; }
  textarea, input[type=text] { width:100%; border:1px solid var(--border); border-radius:8px; padding:8px 10px;
    background:var(--card); color:var(--fg); font-size:14px; line-height:1.7; }
  textarea { resize:vertical; font-family:var(--serif); }
  input[type=text] { font-family:var(--sans); }
  .slot { margin-bottom:12px; }
  .slot .head { display:flex; align-items:center; gap:6px; margin-bottom:4px; }
  .slot .head b { font-size:13px; }
  .slot .head .wc { margin-left:auto; font-size:11px; color:var(--muted); }
  .status { font-size:11.5px; color:var(--muted); }
  .empty { color:var(--muted); font-size:13px; padding:18px 0; line-height:1.8; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:10px 12px; margin-bottom:8px; }
  .card .head { display:flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700; margin-bottom:4px; }
  .card .body { font-size:13px; line-height:1.75; color:var(--fg); }
  .card .src { font-size:11px; color:var(--muted); margin-top:4px; }
  .group-h { font-size:12px; font-weight:700; color:var(--accent); letter-spacing:.08em; margin:14px 0 8px; }
  a { color:var(--accent); }
</style>
</head>
<body>
<div class="mastbar">
  <span class="brand">🖋 写作工坊</span>
  <span class="hint">Standalone Writing Studio</span>
  <span class="links">
    <a href="WSJ_Hub.html">← 返回文库</a>
    <a href="essays/index.html">✍ 作文库</a>
  </span>
</div>
<div class="main">
  <div class="pane reads" id="reads-pane"></div>
  <div class="pane write" id="write-pane"></div>
</div>
<script>
'use strict';
// ===== 存储（与文章内写作工坊同一批键，双向互通）=====
function loadJSON(key, fb) { try { return JSON.parse(localStorage.getItem(key)) || fb; } catch (e) { return fb; } }
function getReadings() { return loadJSON('wsj_writing:readings', []); }
function getDrafts() { return loadJSON('wsj_writing:essays', []); }
function saveDrafts(a) { try { localStorage.setItem('wsj_writing:essays', JSON.stringify(a)); } catch (e) { alert('草稿写入失败（存储已满？）'); } }
function getNotes() { return loadJSON('wsj_writing:notes', []); }
function saveNotes(a) { try { localStorage.setItem('wsj_writing:notes', JSON.stringify(a)); } catch (e) { alert('笔记写入失败（存储已满？）'); } }
function getMaterials() { return loadJSON('wsj_writing:materials', []); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function genId() { return Date.now() + '-' + Math.random().toString(36).slice(2, 8); }
function wordNum(t) { return String(t || '').trim().split(/\\s+/).filter(Boolean).length; }
function fmtDate(iso) { try { return new Date(iso).toLocaleDateString(); } catch (e) { return ''; } }

var SLOTS = [
  { key: 'p1', label: '第一段·图画描述', role: '描述', words: '60-80' },
  { key: 'p2', label: '第二段·寓意阐释与论证', role: '论证', words: '120-150' },
  { key: 'p3', label: '第三段·总结与建议', role: '结论', words: '40-60' }
];
var state = { readId: '', tab: 'imitate', draftId: '', noteId: '', saveTimer: null };

// ===== 左栏：范文对照阅读 =====
function renderReads() {
  var pane = document.getElementById('reads-pane');
  var all = getReadings();
  if (!all.length) {
    pane.innerHTML = '<div class="empty">范文库还是空的。<br>到任意文章页 → 考试 → 写作 → 写作工坊 → 「⬇ 模板导入」，' +
      '导入英语作文包的 JSON（readings 数组），这里就会按日期列出全部范文。</div>';
    return;
  }
  var i = 0;
  for (var k = 0; k < all.length; k++) if (all[k].id === state.readId) i = k;
  var r = all[i];
  state.readId = r.id;
  var html = '<div class="bar">' +
    '<button type="button" class="nav" id="reads-prev">←</button>' +
    '<select id="reads-pick">' + all.map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (x.id === r.id ? ' selected' : '') + '>' + esc(x.title) + '</option>';
    }).join('') + '</select>' +
    '<button type="button" class="nav" id="reads-next">→</button>' +
    '<button type="button" class="primary" id="reads-imitate">✍ 仿写这篇</button>' +
    '</div>' +
    '<div class="meta">' + esc([r.date, r.topic, r.note].filter(Boolean).join(' · ')) + '</div>';
  html += (r.paragraphs || []).map(function (p) {
    return '<div class="para"><div class="head"><span class="label">' + esc(p.label || '段落') + '</span>' +
      (p.role ? '<span class="tag">' + esc(p.role) + '</span>' : '') +
      (p.words ? '<span class="tag type">' + esc(p.words) + ' 词</span>' : '') +
      '</div><div class="text">' + esc(p.text || '') + '</div></div>';
  }).join('');
  pane.innerHTML = html;
  document.getElementById('reads-pick').addEventListener('change', function (e) { state.readId = e.target.value; renderReads(); });
  document.getElementById('reads-prev').addEventListener('click', function () { state.readId = all[(i - 1 + all.length) % all.length].id; renderReads(); });
  document.getElementById('reads-next').addEventListener('click', function () { state.readId = all[(i + 1) % all.length].id; renderReads(); });
  document.getElementById('reads-imitate').addEventListener('click', function () {
    var d = { id: genId(), kind: 'big', templateId: 'big_three', title: (r.title || '范文仿写') + '（仿写）',
      topic: r.topic || '', slots: { p1: '', p2: '', p3: '' }, scores: {},
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    var drafts = getDrafts(); drafts.push(d); saveDrafts(drafts);
    state.draftId = d.id; state.tab = 'imitate';
    renderWrite();
  });
}

// ===== 右栏 =====
function renderWrite() {
  var pane = document.getElementById('write-pane');
  var tabs = '<div class="tabs">' +
    '<button type="button" data-tab="imitate" class="' + (state.tab === 'imitate' ? 'active' : '') + '">✍ 仿写草稿</button>' +
    '<button type="button" data-tab="notes" class="' + (state.tab === 'notes' ? 'active' : '') + '">✏️ 笔记</button>' +
    '<button type="button" data-tab="materials" class="' + (state.tab === 'materials' ? 'active' : '') + '">📝 素材（文章里记的）</button>' +
    '</div>';
  pane.innerHTML = tabs + '<div id="tab-body"></div>';
  pane.querySelectorAll('[data-tab]').forEach(function (b) {
    b.addEventListener('click', function () { state.tab = b.dataset.tab; renderWrite(); });
  });
  var body = document.getElementById('tab-body');
  if (state.tab === 'imitate') renderImitate(body);
  else if (state.tab === 'notes') renderNotes(body);
  else renderMaterials(body);
}

// ---- 仿写草稿（wsj_writing:essays，schema 与文章内工坊一致）----
function renderImitate(body) {
  var drafts = getDrafts().filter(function (d) { return d.kind === 'big'; });
  drafts.sort(function (a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
  var html = '<div class="bar"><button type="button" class="primary" id="draft-new">＋ 新建仿写</button>' +
    '<span class="status">' + drafts.length + ' 篇 · 自动保存，与文章内工坊互通</span></div>';
  if (drafts.length) {
    html += '<div class="list">' + drafts.map(function (d) {
      return '<div class="item' + (d.id === state.draftId ? ' active' : '') + '" data-draft="' + d.id + '">' +
        '<span class="t">' + esc(d.title || '未命名') + '</span>' +
        '<span class="m">' + fmtDate(d.updatedAt) + '</span>' +
        '<button type="button" class="del" data-del="' + d.id + '" title="删除">✕</button></div>';
    }).join('') + '</div>';
  }
  var cur = drafts.filter(function (d) { return d.id === state.draftId; })[0] || null;
  html += '<div id="draft-editor">';
  if (cur) {
    html += '<input type="text" id="draft-title" value="' + esc(cur.title || '') + '" placeholder="标题" style="margin-bottom:10px;">';
    html += SLOTS.map(function (s) {
      var v = (cur.slots || {})[s.key] || '';
      return '<div class="slot"><div class="head"><b>' + s.label + '</b><span class="tag">' + s.role + '</span>' +
        '<span class="wc"><span id="wc-' + s.key + '">' + wordNum(v) + '</span> / ' + s.words + ' 词</span></div>' +
        '<textarea id="slot-' + s.key + '" rows="6" data-slot="' + s.key + '" placeholder="对照左侧范文，在这一段写你的版本…">' + esc(v) + '</textarea></div>';
    }).join('');
    html += '<div class="bar"><span class="status" id="save-status">已保存</span>' +
      '<button type="button" class="ghost danger" id="draft-del" style="margin-left:auto">删除这篇草稿</button></div>';
  } else {
    html += '<div class="empty">左侧选一篇范文，点「✍ 仿写这篇」；或新建空白仿写。</div>';
  }
  html += '</div>';
  body.innerHTML = html;

  document.getElementById('draft-new').addEventListener('click', function () {
    var d = { id: genId(), kind: 'big', templateId: 'big_three', title: '未命名仿写',
      topic: '', slots: { p1: '', p2: '', p3: '' }, scores: {},
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    var all = getDrafts(); all.push(d); saveDrafts(all);
    state.draftId = d.id; renderWrite();
  });
  body.querySelectorAll('[data-draft]').forEach(function (it) {
    it.addEventListener('click', function (e) {
      if (e.target.closest('[data-del]')) return;
      state.draftId = it.dataset.draft; renderWrite();
    });
  });
  body.querySelectorAll('[data-del]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!confirm('删除这篇草稿？')) return;
      saveDrafts(getDrafts().filter(function (d) { return d.id !== b.dataset.del; }));
      if (state.draftId === b.dataset.del) state.draftId = '';
      renderWrite();
    });
  });
  if (!cur) return;
  var delBtn = document.getElementById('draft-del');
  if (delBtn) delBtn.addEventListener('click', function () {
    if (!confirm('删除这篇草稿？')) return;
    saveDrafts(getDrafts().filter(function (d) { return d.id !== cur.id; }));
    state.draftId = ''; renderWrite();
  });
  var flush = function () {
    var all = getDrafts();
    var d = all.filter(function (x) { return x.id === cur.id; })[0];
    if (!d) return;
    d.title = document.getElementById('draft-title').value;
    SLOTS.forEach(function (s) { d.slots[s.key] = document.getElementById('slot-' + s.key).value; });
    d.updatedAt = new Date().toISOString();
    saveDrafts(all);
    var st = document.getElementById('save-status');
    if (st) st.textContent = '已保存 ' + new Date().toLocaleTimeString();
  };
  var schedule = function () {
    SLOTS.forEach(function (s) {
      var el = document.getElementById('slot-' + s.key);
      var wc = document.getElementById('wc-' + s.key);
      if (wc) wc.textContent = String(wordNum(el.value));
    });
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(flush, 600);
  };
  document.getElementById('draft-title').addEventListener('input', schedule);
  SLOTS.forEach(function (s) { document.getElementById('slot-' + s.key).addEventListener('input', schedule); });
  window.addEventListener('beforeunload', flush);
}

// ---- 笔记（wsj_writing:notes；历史版本仍由文章内工坊管理，这里只改正文）----
function renderNotes(body) {
  var notes = getNotes();
  var html = '<div class="bar"><button type="button" class="primary" id="note-new">＋ 新建笔记</button>' +
    '<span class="status">' + notes.length + ' 条 · 与文章内工坊互通</span></div>';
  if (notes.length) {
    html += '<div class="list">' + notes.slice().reverse().map(function (n) {
      return '<div class="item' + (n.id === state.noteId ? ' active' : '') + '" data-note="' + n.id + '">' +
        '<span class="t">' + esc(n.title || '未命名') + '</span>' +
        '<span class="m">' + fmtDate(n.updatedAt) + '</span>' +
        '<button type="button" class="del" data-ndel="' + n.id + '" title="删除">✕</button></div>';
    }).join('') + '</div>';
  }
  var cur = notes.filter(function (n) { return n.id === state.noteId; })[0] || null;
  html += '<div id="note-editor">';
  if (cur) {
    html += '<input type="text" id="note-title" value="' + esc(cur.title || '') + '" placeholder="笔记标题" style="margin-bottom:10px;">' +
      '<textarea id="note-content" rows="14" placeholder="对照左侧范文记笔记…自动保存">' + esc(cur.content || '') + '</textarea>' +
      '<div class="bar"><span class="status" id="note-status">已保存</span></div>';
  } else {
    html += '<div class="empty">选一条笔记，或新建。</div>';
  }
  html += '</div>';
  body.innerHTML = html;
  document.getElementById('note-new').addEventListener('click', function () {
    var n = { id: genId(), title: '未命名笔记', content: '', versions: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    var all = getNotes(); all.push(n); saveNotes(all);
    state.noteId = n.id; renderWrite();
  });
  body.querySelectorAll('[data-note]').forEach(function (it) {
    it.addEventListener('click', function (e) {
      if (e.target.closest('[data-ndel]')) return;
      state.noteId = it.dataset.note; renderWrite();
    });
  });
  body.querySelectorAll('[data-ndel]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!confirm('删除这条笔记？（历史版本一并删除）')) return;
      saveNotes(getNotes().filter(function (n) { return n.id !== b.dataset.ndel; }));
      if (state.noteId === b.dataset.ndel) state.noteId = '';
      renderWrite();
    });
  });
  if (!cur) return;
  var nflush = function () {
    var all = getNotes();
    var n = all.filter(function (x) { return x.id === cur.id; })[0];
    if (!n) return;
    n.title = document.getElementById('note-title').value;
    n.content = document.getElementById('note-content').value;
    n.updatedAt = new Date().toISOString();
    saveNotes(all);
    var st = document.getElementById('note-status');
    if (st) st.textContent = '已保存 ' + new Date().toLocaleTimeString();
  };
  var nschedule = function () {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(nflush, 600);
  };
  document.getElementById('note-title').addEventListener('input', nschedule);
  document.getElementById('note-content').addEventListener('input', nschedule);
}

// ---- 素材（wsj_writing:materials，只读 —— 记录在文章内工坊做）----
function renderMaterials(body) {
  var mats = getMaterials();
  if (!mats.length) {
    body.innerHTML = '<div class="empty">还没有素材。<br>打开任意文章 → 选中文本 → 浮动菜单/写作工坊「📝 素材」页签记录' +
      '（起因 / 经过 / 论证 / 金句），记好的会出现在这里供写作时引用。</div>';
    return;
  }
  var groups = {};
  mats.forEach(function (m) {
    var t = String(m.topic || '').split(',')[0].trim() || '未归类';
    (groups[t] = groups[t] || []).push(m);
  });
  var html = '<div class="bar"><span class="status">' + mats.length + ' 条素材 · 在文章内记录，这里只读引用</span></div>';
  Object.keys(groups).sort().forEach(function (t) {
    html += '<div class="group-h">' + esc(t) + '（' + groups[t].length + '）</div>';
    html += groups[t].map(function (m) {
      var text = String(m.text || m.content || '').trim();
      return '<div class="card"><div class="head">📝 ' + esc(m.title || t) +
        (m.usedCount ? '<span class="tag">用过 ' + m.usedCount + ' 次</span>' : '') + '</div>' +
        (text ? '<div class="body">' + esc(text) + '</div>' : '') +
        (m.note ? '<div class="body"><b>笔记：</b>' + esc(m.note) + '</div>' : '') +
        (m.articleId && m.articleId !== 'manual' ? '<div class="src">📎 ' + esc(String(m.articleId).replace(/_EN-CN_final\\.html$/, '').replace(/_/g, ' ')) + (m.paraIdx ? ' · 第' + m.paraIdx + '段' : '') + '</div>' : '') +
        '</div>';
    }).join('');
  });
  body.innerHTML = html;
}

// ===== init =====
(function init() {
  var reads = getReadings();
  if (reads.length) state.readId = reads[0].id;
  var drafts = getDrafts().filter(function (d) { return d.kind === 'big'; });
  if (drafts.length) {
    drafts.sort(function (a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
    state.draftId = drafts[0].id;
  }
  renderReads();
  renderWrite();
})();
</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, PAGE, 'utf8');
console.log('✓ 写作工坊独立页 -> ' + OUT + ' (' + (PAGE.length / 1024).toFixed(1) + ' KB)');
