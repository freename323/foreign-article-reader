  // ===== FEATURE: Word-frequency tiered coloring (词频分级着色) =====
  const FREQ_MODE_KEY = 'wsj_reader:freqmode';
  let freqSets = null;
  function buildFreqSets() {
    if (freqSets) return freqSets;
    const d = window.__WORD_FREQ__;
    if (!d) return null;
    freqSets = {
      b: new Set(d.b || []), h: new Set(d.h || []), m: new Set(d.m || []),
      l: new Set(d.l || []), o: new Set(d.o || [])
    };
    return freqSets;
  }
  let _wfLoading = null;
  function ensureWordFreq(cb) {
    if (window.__WORD_FREQ__) { cb(); return; }
    if (_wfLoading) { _wfLoading.push(cb); return; }   // 并发调用不再重复插 <script>
    _wfLoading = [cb];
    const s = document.createElement('script');
    s.src = 'wordfreq.js' + ASSET_V;                    // 复用 reader.js 的版本戳，避免旧缓存
    s.onload = () => { const cbs = _wfLoading; _wfLoading = null; cbs.forEach(f => f()); };
    s.onerror = () => { _wfLoading = null; showTopToast('词频数据加载失败（缺少 wordfreq.js）'); };
    document.head.appendChild(s);
  }
  function freqModeOn() { return localStorage.getItem(FREQ_MODE_KEY) === '1'; }
  function applyFreqColoring() {
    const sets = buildFreqSets();
    // 报纸阅读页里每一版都有自己的 .col-body.en —— 必须遍历全部，否则只着色第一版
    const bodies = document.querySelectorAll('.col-body.en');
    if (!sets || !bodies.length) return null;
    const counts = { h: 0, m: 0, l: 0, x: 0, v: 0 };
    // 已录入生词本的词：优先于词频分级，标成 freq-v（金色），阅读时一眼可辨。
    // 注意：与标注原文完全一致的词已被 <mark> 高亮（walker 会跳过 mark），
    // freq-v 真正覆盖的是短语里的单词和屈折变体（algorithm ↔ algorithms 等）
    const vocabSet = new Set();
    try {
      (JSON.parse(localStorage.getItem(ANNO_KEY) || '[]')).forEach(a => {
        if (a && a.bucket === 'vocab' && a.text) {
          String(a.text).toLowerCase().replace(/[^a-z'\- ]+/g, ' ').split(/\s+/).forEach(w => {
            if (!w) return;
            // 屈折词族双向匹配：标注 algorithm ↔ 正文 algorithms，标注 tries ↔ 正文 try 等。
            // 生成出的无效形式（如 algorithmed）不会命中正文，无害
            const stem = w.replace(/'(s|)$/, '');
            vocabSet.add(stem);
            if (stem.endsWith('ies')) vocabSet.add(stem.slice(0, -3) + 'y');
            if (stem.endsWith('es')) vocabSet.add(stem.slice(0, -2));
            if (stem.endsWith('s') && !stem.endsWith('ss')) vocabSet.add(stem.slice(0, -1));
            if (stem.endsWith('ing')) { vocabSet.add(stem.slice(0, -3)); vocabSet.add(stem.slice(0, -3) + 'e'); }
            if (stem.endsWith('ed')) { vocabSet.add(stem.slice(0, -2)); vocabSet.add(stem.slice(0, -1)); }
            vocabSet.add(stem + 's');
            vocabSet.add(stem + 'es');
            if (/[a-z]y$/.test(stem)) vocabSet.add(stem.slice(0, -1) + 'ies');
            if (stem.endsWith('e')) { vocabSet.add(stem.slice(0, -1) + 'ing'); vocabSet.add(stem.slice(0, -1) + 'ed'); }
            vocabSet.add(stem + 'ing');
            vocabSet.add(stem + 'ed');
          });
        }
      });
    } catch (e) {}
    bodies.forEach(body => {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        let p = node.parentNode;
        while (p && p !== body) {
          if (p.nodeType === 1) {
            const t = p.tagName;
            if (t === 'MARK' || t === 'SCRIPT' || t === 'STYLE') return NodeFilter.FILTER_REJECT;
            if (p.getAttribute && p.getAttribute('contenteditable') === 'true') return NodeFilter.FILTER_REJECT;
            if (t === 'SPAN' && p.className && (String(p.className).indexOf('freq-') === 0 || String(p.className).indexOf('exam-hl') >= 0)) return NodeFilter.FILTER_REJECT;
          }
          p = p.parentNode;
        }
        return /[A-Za-z]/.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(tn => {
      const text = tn.nodeValue;
      const frag = document.createDocumentFragment();
      let last = 0, m;
      const re = /[A-Za-z][A-Za-z'\-]*/g;
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const w = m[0];
        const lw = w.toLowerCase().replace(/^['\-]+|['\-]+$/g, '');
        let tier = null;
        if (vocabSet.has(lw)) tier = 'v';
        else if (sets.h.has(lw)) tier = 'h';
        else if (sets.m.has(lw)) tier = 'm';
        else if (sets.l.has(lw)) tier = 'l';
        else if (!sets.b.has(lw) && !sets.o.has(lw)) tier = 'x';
        if (tier) {
          const sp = document.createElement('span');
          sp.className = 'freq-' + tier;
          sp.textContent = w;
          frag.appendChild(sp);
          counts[tier]++;
        } else {
          frag.appendChild(document.createTextNode(w));
        }
        last = m.index + w.length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      tn.parentNode.replaceChild(frag, tn);
    });
    });
    return counts;
  }
  function removeFreqColoring() {
    document.querySelectorAll('.col-body.en span.freq-h, .col-body.en span.freq-m, .col-body.en span.freq-l, .col-body.en span.freq-x, .col-body.en span.freq-v').forEach(sp => {
      const p = sp.parentNode;
      if (!p) return;
      while (sp.firstChild) p.insertBefore(sp.firstChild, sp);
      p.removeChild(sp);
      if (p.normalize) p.normalize();
    });
  }
  function refreshFreqColoring() {
    if (!freqModeOn() || !window.__WORD_FREQ__) return;
    removeFreqColoring();
    applyFreqColoring();
  }
  function toggleFreqColoring() {
    const on = !freqModeOn();
    localStorage.setItem(FREQ_MODE_KEY, on ? '1' : '0');
    updateFreqBtn();
    if (!on) {
      removeFreqColoring();
      showTopToast('已关闭词频着色');
      return;
    }
    ensureWordFreq(() => {
      const counts = applyFreqColoring();
      if (counts) showTopToast('词频着色已开启 · 高频 ' + counts.h + ' · 中频 ' + counts.m + ' · 低频 ' + counts.l + ' · 超纲 ' + counts.x +
        (counts.v > 0 ? ' · 已录生词 ' + counts.v + '（金色）' : ''));
    });
  }
  function updateFreqBtn() {
    const btn = document.getElementById('freq-toggle-btn');
    if (btn) btn.innerHTML = '<span>🎨</span><span>词频着色 ' + (freqModeOn() ? '✓ 开' : '关') + '</span>';
  }

  // ===== FEATURE: Reading statistics panel (阅读统计) =====
  function fmtDuration(sec) {
    sec = Math.floor(sec || 0);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    if (h > 0) return h + ' 小时 ' + m + ' 分';
    if (m > 0) return m + ' 分 ' + (sec % 60) + ' 秒';
    return sec + ' 秒';
  }
  function computeCrossStats() {
    let registry = [];
    try { registry = JSON.parse(localStorage.getItem('wsj_reader:registry') || '[]'); } catch (e) {}
    const ids = registry.map(r => r.id).filter(Boolean);
    if (ids.indexOf(articleId) < 0) ids.push(articleId);
    let totalSeconds = 0, sessionCount = 0, readArticles = 0;
    let vocabTotal = 0, noteTotal = 0, qtypeTotal = 0, syntaxTotal = 0;
    const vocabMap = {};
    ids.forEach(id => {
      let rd = null;
      try { rd = JSON.parse(localStorage.getItem('reading:' + id)); } catch (e) {}
      if (rd && rd.totalSeconds > 0) { readArticles++; totalSeconds += rd.totalSeconds; sessionCount += (rd.sessions || []).length; }
      let annos = [];
      try { annos = JSON.parse(localStorage.getItem('annotations:' + id) || '[]'); } catch (e) {}
      annos.forEach(a => {
        if (a.bucket === 'vocab') {
          vocabTotal++;
          const k = String(a.text || '').toLowerCase();
          vocabMap[k] = (vocabMap[k] || new Set());
          vocabMap[k].add(id);
        } else if (a.bucket === 'note') noteTotal++;
        else if (a.bucket === 'qtype') qtypeTotal++;
      });
      let syn = [];
      try { syn = JSON.parse(localStorage.getItem('syntax:' + id) || '[]'); } catch (e) {}
      syntaxTotal += syn.length;
    });
    let roots = 0, materials = 0, advice = 0;
    try { roots = (JSON.parse(localStorage.getItem('wsj_roots:cards') || '[]')).length; } catch (e) {}
    try { materials = (JSON.parse(localStorage.getItem('wsj_writing:materials') || '[]')).length; } catch (e) {}
    try { advice = (JSON.parse(localStorage.getItem('wsj_writing:advice') || '[]')).length; } catch (e) {}
    const crossVocab = Object.keys(vocabMap).filter(k => vocabMap[k].size >= 2).length;
    return { totalArticles: ids.length, readArticles, totalSeconds, sessionCount, vocabTotal, noteTotal, qtypeTotal, syntaxTotal, roots, materials, advice, crossVocab };
  }
  function countArticleWords() {
    let words = 0;
    document.querySelectorAll('.col-body.en p').forEach(p => {
      const m = p.textContent.match(/[A-Za-z][A-Za-z'\-]*/g);
      if (m) words += m.length;
    });
    return words;
  }
  // ===== FEATURE: 今日到期复习计数（与 WSJ_Hub 的 reviewPool/isDue 同一规则） =====
  // isDue：有排期按日期；无排期时「已掌握」视为用户手动定死不再冒出，其余视为到期。
  // 池条件：wrong / review / mastered、答错过的题（qdata.isCorrect===false）、
  // 以及已填题干的未做题（unseen + question）。范围只算 qtype 标注（与 Hub 一致）。
  function dueReviewCount() {
    const today = localDateStr(new Date());
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf('annotations:') !== 0) continue;
      try {
        (JSON.parse(localStorage.getItem(k) || '[]')).forEach(a => {
          if (!a || a.bucket !== 'qtype') return;
          const due = a.nextDue ? (a.nextDue <= today) : ((a.mastery || 'unseen') !== 'mastered');
          if (!due) return;
          const m = a.mastery || 'unseen';
          const qd = a.qdata || {};
          if (m === 'wrong' || m === 'review' || m === 'mastered' || qd.isCorrect === false ||
              (m === 'unseen' && (qd.question || '').trim())) n++;
        });
      } catch (e) {}
    }
    // 错题本也计入「今日待复习」——错题是按间隔重复排期的（调度在 11-insights.js）
    if (typeof dueWrongCount === 'function') n += dueWrongCount();
    return n;
  }
  function attendanceData() {
    // 每天实际阅读秒数：聚合所有 reading:* 键里的 session
    const daySec = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf('reading:') !== 0) continue;
      try {
        const rd = JSON.parse(localStorage.getItem(k));
        ((rd && rd.sessions) || []).forEach(s => {
          if (!s || !s.start) return;
          const endT = s.end ? new Date(s.end).getTime() : Date.now();
          const dur = Math.max(0, Math.floor((endT - new Date(s.start).getTime()) / 1000));
          const day = String(s.start).slice(0, 10);
          daySec[day] = (daySec[day] || 0) + dur;
        });
      } catch (e) {}
    }
    const days = new Set(Object.keys(daySec));
    const iso = x => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let streak = 0;
    const cur = new Date(today);
    if (!days.has(iso(cur))) cur.setDate(cur.getDate() - 1);
    while (days.has(iso(cur))) { streak++; cur.setDate(cur.getDate() - 1); }
    let goalMin = 20;
    try { goalMin = parseInt(localStorage.getItem('wsj_reader:dailyGoal'), 10) || 20; } catch (e) {}
    if (goalMin < 5) goalMin = 5;
    const goalSec = goalMin * 60;
    const dow = (today.getDay() + 6) % 7; // Monday-based grid
    const end = new Date(today); end.setDate(end.getDate() + (6 - dow));
    const start = new Date(end); start.setDate(start.getDate() - 83); // 12 weeks
    let cells = '';
    let metCount = 0;
    const c = new Date(start);
    while (c <= end) {
      const ds = iso(c);
      const sec = daySec[ds] || 0;
      const on = sec > 0;
      const fut = c.getTime() > today.getTime();
      // 色阶：lv1 读过 → lv2 过半目标 → lv3 达标
      let lv = '';
      if (on) {
        if (sec >= goalSec) { lv = ' lv3'; metCount++; }
        else if (sec >= goalSec / 2) lv = ' lv2';
        else lv = ' lv1';
      }
      const title = ds + (on ? ' · 阅读 ' + Math.round(sec / 60) + ' 分钟' + (lv === ' lv3' ? ' ✓ 达标' : '') : '');
      cells += '<div class="att-cell' + (on ? ' on' : '') + lv + (fut ? ' fut' : '') + (ds === iso(today) ? ' today' : '') + '" title="' + title + '"></div>';
      c.setDate(c.getDate() + 1);
    }
    return { streak: streak, cells: cells, totalDays: days.size, goalMin: goalMin, metCount: metCount };
  }
  function openStatsPanel() {
    const panel = document.getElementById('stats-panel');
    const body = document.getElementById('stats-body');
    if (!panel || !body) return;
    const s = computeCrossStats();
    const words = countArticleWords();
    const mine = (readingData && readingData.totalSeconds) || 0;
    const wpm = mine >= 60 ? Math.round(words / (mine / 60)) : null;
    const card = (label, value, sub) =>
      '<div class="stat-card"><div class="stat-value">' + value + '</div><div class="stat-label">' + label + '</div>' +
      (sub ? '<div class="stat-sub">' + sub + '</div>' : '') + '</div>';
    body.innerHTML =
      '<div class="stats-group-label">全部文章（' + s.totalArticles + ' 篇）</div>' +
      '<div class="stats-grid">' +
      card('累计阅读时长', fmtDuration(s.totalSeconds), s.sessionCount + ' 次阅读') +
      card('已读篇数', s.readArticles + ' / ' + s.totalArticles) +
      card('生词总量', s.vocabTotal, '其中 ≥2 篇复现 <strong>' + s.crossVocab + '</strong> 个') +
      card('题型标注', s.qtypeTotal, '笔记 ' + s.noteTotal + ' 条') +
      card('今日待复习', dueReviewCount() + ' 条', '到期题目 · 文库 → 🎯 复习生词') +
      card('句库', s.syntaxTotal + ' 句', '词根卡 ' + s.roots + ' · 素材 ' + s.materials + ' · 建议文 ' + s.advice) +
      '</div>' +
      '<div class="stats-group-label">本文 · ' + esc(getShortTitle()) + '</div>' +
      '<div class="stats-grid">' +
      card('英文词数', words) +
      card('本文用时', fmtDuration(mine)) +
      card('估算阅读速度', wpm ? wpm + ' WPM' : '—', wpm ? '' : '阅读满 1 分钟后开始估算') +
      '</div>' +
      (function () {
        const att = attendanceData();
        return '<div class="stats-group-label">打卡日历 · 近 12 周</div>' +
          '<div class="att-wrap">' +
          '<div class="att-streak">🔥 连续打卡 <strong>' + att.streak + '</strong> 天 · 累计 <strong>' + att.totalDays + '</strong> 天 · 达标 <strong>' + att.metCount + '</strong> 天 ' +
          '<button type="button" class="att-goal-btn" id="att-goal-btn" title="点击修改每日目标">🎯 每日目标 ' + att.goalMin + ' 分钟</button></div>' +
          '<div class="att-grid">' + att.cells + '</div>' +
          '<div class="att-legend"><span class="al-1">读过</span><span class="al-2">过半目标</span><span class="al-3">✓ 达标</span></div></div>';
      })() +
      (function () {
        // 数据安全：占用 + 上次备份
        let bytes = 0, keys = 0;
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            bytes += k.length + (localStorage.getItem(k) || '').length;
            keys++;
          }
        } catch (e) {}
        const kb = bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' KB';
        const last = parseLS('wsj_reader:lastBackupAt', null);
        let lastVal, lastSub;
        if (last) {
          const ageDays = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
          lastVal = fmtDate(last);
          lastSub = ageDays < 7 ? ageDays + ' 天前 · 一切正常' : '<span style="color:var(--cn-tag)">已 ' + ageDays + ' 天，建议备份</span>';
        } else {
          lastVal = '从未备份';
          lastSub = '<span style="color:var(--cn-tag)">数据只存本浏览器，建议立即备份</span>';
        }
        return '<div class="stats-group-label">数据安全</div>' +
          '<div class="stats-grid">' +
          card('本地数据占用', '≈ ' + kb, keys + ' 个键 · 存于本浏览器') +
          card('上次备份', lastVal, lastSub) +
          '</div>';
      })() +
      '<div class="stats-tip">考研阅读目标速度约 100–130 WPM；每篇 4 题建议在 16–20 分钟内完成。备份入口：工具菜单 → 备份全部数据。</div>';
    panel.classList.add('visible');
    const goalBtn = document.getElementById('att-goal-btn');
    if (goalBtn) goalBtn.addEventListener('click', () => {
      const cur = attendanceData().goalMin;
      const v = prompt('每日阅读目标（分钟，5–480）：', String(cur));
      if (v === null) return;
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 5 || n > 480) { showTopToast('目标需在 5–480 分钟之间'); return; }
      try { localStorage.setItem('wsj_reader:dailyGoal', String(n)); } catch (e) {}
      showTopToast('每日目标已设为 ' + n + ' 分钟');
      openStatsPanel();
    });
  }
  function closeStatsPanel() {
    const panel = document.getElementById('stats-panel');
    if (panel) panel.classList.remove('visible');
  }

  // ===== FEATURE: Bidirectional vocab ↔ text locate (生词↔原文双向定位) =====
  function locateNoteFromMark(id) {
    const a = annotations.find(x => x.id === id);
    if (!a) return;
    const sec = document.querySelector('.notes-section');
    if (sec && sec.classList.contains('collapsed') && typeof toggleNotes === 'function') toggleNotes();
    if (!document.querySelector('.note-card[data-id="' + id + '"]')) {
      notesBucket = a.bucket || 'all';
      renderNotes();
    }
    setTimeout(() => flashNote(id), 80);
  }
  function wireMarkClickLocate() {
    const host = document.querySelector('.main-wrap') || document.body;
    host.addEventListener('click', (e) => {
      const m = e.target && e.target.closest ? e.target.closest('mark[data-id]') : null;
      if (m) locateNoteFromMark(m.dataset.id);
    });
  }

  // ===== FEATURE: Cognate suggestion for roots (词根同根词联想) =====
  let suggestTimer = null;
  function allKnownWords() {
    const d = window.__WORD_FREQ__;
    const out = [];
    if (d) [].concat(d.h || [], d.m || [], d.l || [], d.o || []).forEach(w => out.push(w));
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf('annotations:') !== 0) continue;
      try {
        JSON.parse(localStorage.getItem(k) || '[]').forEach(a => {
          if (a.bucket === 'vocab' && a.text) {
            String(a.text).toLowerCase().split(/\s+/).forEach(w => {
              const cw = w.replace(/[^a-z'\-]/g, '');
              if (cw.length >= 3) out.push(cw);
            });
          }
        });
      } catch (e) {}
    }
    return out;
  }
  function suggestCognates(raw) {
    const box = document.getElementById('root-suggest');
    if (!box) return;
    const input = String(raw || '').trim();
    const core = input.replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (core.length < 3) { box.innerHTML = ''; return; }
    const isPrefix = input.indexOf('-') === 0;
    const isSuffix = input.length > 1 && input.lastIndexOf('-') === input.length - 1;
    const seen = new Set();
    const matches = [];
    allKnownWords().forEach(w => {
      if (seen.has(w) || w === core) return;
      const hit = isPrefix ? w.indexOf(core) === 0 : (isSuffix ? w.endsWith(core) : w.indexOf(core) >= 0);
      if (hit && w.length <= core.length + 9) { seen.add(w); matches.push(w); }
    });
    matches.sort();
    if (matches.length === 0) {
      box.innerHTML = '<div class="root-suggest-empty">词库中暂无包含「' + esc(core) + '」的单词</div>';
      return;
    }
    box.innerHTML = '<div class="root-suggest-label">同根词联想（' + matches.length + (matches.length > 24 ? '+' : '') + '）· 点击复制</div>' +
      '<div class="root-suggest-chips">' + matches.slice(0, 24).map(w => '<button type="button" data-cog="' + esc(w) + '">' + esc(w) + '</button>').join('') + '</div>';
    box.querySelectorAll('[data-cog]').forEach(b => {
      b.addEventListener('click', () => {
        navigator.clipboard.writeText(b.dataset.cog).then(
          () => showTopToast('已复制：' + b.dataset.cog),
          () => showTopToast(b.dataset.cog)
        );
      });
    });
  }
  function wireRootSuggest() {
    const input = document.getElementById('root-word');
    if (!input || input.dataset.wired) return;
    input.dataset.wired = '1';
    input.addEventListener('input', () => {
      clearTimeout(suggestTimer);
      suggestTimer = setTimeout(() => ensureWordFreq(() => suggestCognates(input.value)), 300);
    });
  }

  // ===== Reading progress bar =====
  function updateProgressBar() {
    const bar = document.getElementById('progress-bar');
    // 报纸阅读页：进度 = 版次进度（页面本身不纵向滚动）
    if (typeof paperIsOpen === 'function' && paperIsOpen()) {
      const total = (typeof paperPageCount === 'function') ? paperPageCount() : 0;
      const cur = (typeof paperPageIndex === 'function') ? paperPageIndex() : 0;
      if (bar) bar.style.width = total > 0 ? Math.round((cur + 1) / total * 100) + '%' : '0%';
      return;
    }
    let scroller = document.querySelector('.main-wrap .col-body.en') || document.querySelector('.col-body.en');
    if (mobileQuery.matches) scroller = document.querySelector('.main-wrap') || scroller;
    if (!scroller) return;
    const pct = scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight) * 100;
    if (bar) bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
  }
