  // ===== FEATURE: Word-frequency tiered coloring (词频分级着色) =====
  const FREQ_MODE_KEY = 'wsj_reader:freqmode';
  let freqSets = null;
  // v44: 三态 —— all 全部着色 / mine 只看生词（词频五级退场，只留 freq-v 金）/ off 关闭。
  // 旧值兼容：'1'→all，'0'/未设置→off（词频着色本来就是主动开启的功能）。
  function freqMode() {
    const v = localStorage.getItem(FREQ_MODE_KEY);
    if (v === 'mine' || v === 'off') return v;
    return v === '1' ? 'all' : 'off';
  }
  function freqModeOn() { return freqMode() === 'all'; }
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
    // v40 渐退提示的查询缓存：整表读一次，逐词查掌握强度（避免逐词 JSON.parse）
    const vrevMap = vrevAll();
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
        let vrevFade = 0;
        if (vocabSet.has(lw)) {
          // v40 渐退提示：连续答对轮次越多金色越浅，≥3 轮不再着色（该词已进长间隔）
          vrevFade = vrevStrengthOf(vrevMap, articleId, lw);
          if (vrevFade < 3) tier = 'v';
        }
        // v44 mine 态：只看生词 —— 词频五级退场，只留 freq-v 金（和 T04 衔接模式同思路的颜色分层）
        else if (freqMode() !== 'mine') {
          if (sets.h.has(lw)) tier = 'h';
          else if (sets.m.has(lw)) tier = 'm';
          else if (sets.l.has(lw)) tier = 'l';
          else if (!sets.b.has(lw) && !sets.o.has(lw)) tier = 'x';
        }
        if (tier) {
          const sp = document.createElement('span');
          sp.className = 'freq-' + tier;
          if (tier === 'v' && vrevFade > 0) sp.style.opacity = String(1 - vrevFade * 0.3);
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
  // v44: 三态循环 off → all → mine → off
  function toggleFreqColoring() {
    const mode = freqMode();
    const next = mode === 'off' ? 'all' : (mode === 'all' ? 'mine' : 'off');
    localStorage.setItem(FREQ_MODE_KEY, next);
    updateFreqBtn();
    if (next === 'off') {
      removeFreqColoring();
      showTopToast('词频着色已关闭');
      return;
    }
    ensureWordFreq(() => {
      removeFreqColoring();
      const counts = applyFreqColoring();
      if (counts) showTopToast(next === 'mine'
        ? '只看生词：已标注词着金，词频五级退场'
        : '词频着色已开启 · 高频 ' + counts.h + ' · 中频 ' + counts.m + ' · 低频 ' + counts.l + ' · 超纲 ' + counts.x +
          (counts.v > 0 ? ' · 已录生词 ' + counts.v + '（金色）' : ''));
    });
  }
  function updateFreqBtn() {
    const btn = document.getElementById('freq-toggle-btn');
    if (btn) {
      const label = freqMode() === 'all' ? '✓ 全部' : (freqMode() === 'mine' ? '✓ 只看生词' : '关');
      btn.innerHTML = '<span>🎨</span><span>词频着色 ' + label + '</span>';
    }
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
    // v35: 面板折叠时不再自动展开 —— 定位/闪烁只发生在面板当前状态里
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

  // ===== FEATURE: 语境内生词复习（v40：遮盖重读 / 段落填空）=====
  // 生词标注过去只有"存"没有"取"——dueReviewCount 只数题型卡与错题，vocab 零检索零调度。
  // 编码特异性（Tulving）：提取语境=编码语境时迁移率最高，所以复习放回原段落；
  // 闪卡红线：复习单位是段落与词，不做翻卡 UI。点击黑块=想起来了，右键=没想起来。

  // ===== v42: 公共间隔调度器（T07）—— 错题 / 生词 / 衔接配对共用 =====
  // 阶梯对齐考研 6-12 月尺度（Cepeda 元分析：间隔应到周/月级）；出列 ≠ 终点：
  // done 后 30 天延迟复看，复看答对进 90 天深睡（deep），复看答错复活归 1 天。
  const WS_STEPS = [1, 3, 7, 16, 35, 90];
  function wsAddDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return localDateStr(d); }
  // quality: 0=答错 1=答对但犹豫 2=答对。纯函数：只改 entry，不摸存储。
  function wsSchedule(entry, quality) {
    const q = (quality === 0 || quality === 1) ? quality : 2;
    const e = entry || { n: 0 };
    if (q === 0) {
      e.n = 0; e.done = false; e.deep = false;
      e.lapses = (e.lapses || 0) + 1;
      e.nextDue = wsAddDays(1);
    } else if (e.deep) {
      // 深睡期被再次复习且答对：续 90 天，保持深睡
      e.nextDue = wsAddDays(WS_STEPS[WS_STEPS.length - 1]);
    } else if (e.done) {
      // 出列后的延迟复看：答对 → 进 90 天深睡；答错走上面 q===0 分支
      e.done = false; e.deep = true;
      e.nextDue = wsAddDays(WS_STEPS[WS_STEPS.length - 1]);
    } else {
      e.n = (e.n || 0) + 1;
      const idx = Math.min(e.n - 1, WS_STEPS.length - 1);
      let days = WS_STEPS[idx];
      if (q === 1) days = Math.max(1, Math.round(days * 0.7));   // 犹豫档：间隔打七折
      if (e.n >= WS_STEPS.length) { e.done = true; days = 30; e.n = WS_STEPS.length; }
      e.nextDue = wsAddDays(days);
    }
    e.last = new Date().toISOString();
    return e;
  }

  const VREV_KEY = 'wsj_vocabrev';
  const VREV_ACTIVE_KEY = 'wsj_vocabrev:active';   // 值 = articleId；复习完成或退出时清除
  const VREV_MODE_KEY = 'wsj_vocabrev:mode';       // 'mask' | 'cloze'
  function vrevAll() { try { return JSON.parse(localStorage.getItem(VREV_KEY)) || {}; } catch (e) { return {}; } }
  function vrevSave(all) { try { localStorage.setItem(VREV_KEY, JSON.stringify(all)); } catch (e) { showTopToast('⚠ 生词复习记录写入失败（存储已满？）'); } }
  function vrevAddDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return localDateStr(d); }
  function vrevKey(aid, word) { return aid + '|' + String(word || '').toLowerCase(); }
  // v42: 走公共调度器 wsSchedule（布尔兼容包装）
  function vocabSchedule(entry, wasCorrect) { return wsSchedule(entry, wasCorrect ? 2 : 0); }
  // 本篇到期生词：标注 vocab 条目 ∩（无调度记录=新词即到期 / nextDue<=今天）
  function vocabDueList(aid) {
    let annos = [];
    try { annos = JSON.parse(localStorage.getItem('annotations:' + aid) || '[]') || []; } catch (e) {}
    const all = vrevAll();
    const today = localDateStr(new Date());
    const seen = {};
    const out = [];
    annos.forEach(a => {
      if (!a || a.bucket !== 'vocab' || !a.text) return;
      const w = String(a.text).trim();
      const lw = w.toLowerCase();
      if (!lw || seen[lw]) return;
      const e = all[vrevKey(aid, lw)];
      // v49 修正：hub 的生词复习（自评三键）把排期写在标注条目的 a.nextDue 上——
      // 语境内复习必须尊重这份排期，否则两套调度互相打架（hub 推远的词这里又弹出来）
      const annDue = !a.nextDue || a.nextDue <= today;
      const due = e ? (e.nextDue && e.nextDue <= today) : annDue;
      if (!due) return;
      seen[lw] = 1;
      out.push({ word: w, lw: lw, paraIdx: String(a.paraIdx || ''), gloss: (e && e.gloss) || a.note || '', entryKey: vrevKey(aid, lw) });
    });
    return out;
  }
  function vocabDueCount(aid) { return vocabDueList(aid).length; }
  // 渐退提示：连续答对 n 轮后金色高亮逐级变浅，3 轮后不再着色（词已进入长间隔）
  function vrevStrengthOf(map, aid, lw) {
    const tries = [lw];
    if (lw.endsWith('s')) tries.push(lw.slice(0, -1), lw.slice(0, -2));
    if (lw.endsWith('ed')) tries.push(lw.slice(0, -2), lw.slice(0, -1));
    if (lw.endsWith('ing')) tries.push(lw.slice(0, -3), lw.slice(0, -3) + 'e');
    for (let i = 0; i < tries.length; i++) {
      const e = map[aid + '|' + tries[i]];
      if (e) return e.n || 0;
    }
    return 0;
  }
  function vocabMaskActive() { try { return localStorage.getItem(VREV_ACTIVE_KEY) === articleId; } catch (e) { return false; } }
  function vocabMaskClearFlag() { try { localStorage.removeItem(VREV_ACTIVE_KEY); localStorage.removeItem(VREV_MODE_KEY); } catch (e) {} }
  let vrevWired = false;
  let vrevScheduledKeys = {};
  function vrevReveal(el, wasCorrect) {
    const key = el.dataset.vrevKey;
    if (el.tagName === 'MARK') el.classList.remove('vrev-mask');   // 恢复标注原色
    else el.classList.replace('vrev-mask', 'vrev-open');
    el.dataset.vrevDone = '1';
    if (!vrevScheduledKeys[key]) {
      vrevScheduledKeys[key] = 1;
      const all = vrevAll();
      all[key] = vocabSchedule(all[key], wasCorrect);
      vrevSave(all);
    }
    vrevMaybeFinish();
  }
  function vrevMaybeFinish() {
    if (!document.querySelector('.vrev-mask, .vrev-cloze')) {
      vocabMaskClearFlag();
      showTopToast('✅ 本轮生词复习完成，明天见');
    }
  }
  function vocabMaskStop() {
    document.querySelectorAll('.vrev-cloze').forEach(inp => {
      const t = document.createTextNode(inp.dataset.vrevWord || '');
      inp.parentNode.replaceChild(t, inp);
    });
    document.querySelectorAll('.vrev-mask').forEach(el => {
      if (el.tagName === 'MARK') el.classList.remove('vrev-mask');
      else { const t = document.createTextNode(el.textContent); el.parentNode.replaceChild(t, el); }
    });
    document.querySelectorAll('.col-body').forEach(b => b.normalize());
    vocabMaskClearFlag();
  }
  function vocabMaskApply() {
    const due = vocabDueList(articleId);
    if (!due.length) { showTopToast('本篇没有到期的生词'); vocabMaskClearFlag(); return; }
    const dueMap = {};
    due.forEach(d => { dueMap[d.lw] = d; });
    const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 先处理标注 mark（正文里的 <mark> 整块涂黑，显形后恢复标注原色）
    document.querySelectorAll('.col-body.en mark').forEach(mk => {
      const txt = mk.textContent.toLowerCase().replace(/[^a-z'\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (dueMap[txt] && !mk.classList.contains('vrev-mask')) {
        mk.classList.add('vrev-mask');
        mk.dataset.vrevKey = dueMap[txt].entryKey;
        mk.dataset.vrevWord = dueMap[txt].word;
      }
    });
    // 再处理未标注的普通文本节点（跳过 mark / 脚本 / 词频 span / 已涂黑块）
    const bodies = document.querySelectorAll('.col-body.en');
    const found = {};
    bodies.forEach(body => {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          let p = node.parentNode;
          while (p && p !== body) {
            if (p.nodeType === 1) {
              const t = p.tagName;
              if (t === 'MARK' || t === 'SCRIPT' || t === 'STYLE' || t === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
              if (p.classList && (p.classList.contains('vrev-mask') || p.classList.contains('vrev-cloze') || String(p.className).indexOf('freq-') === 0)) return NodeFilter.FILTER_REJECT;
              if (p.getAttribute && p.getAttribute('contenteditable') === 'true') return NodeFilter.FILTER_REJECT;
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
        let hit = null;
        for (const lw in dueMap) {
          const re = new RegExp('\\b' + escapeRe(lw) + '\\b', 'i');
          if (re.test(text)) { hit = lw; break; }
        }
        if (!hit) return;
        const d = dueMap[hit];
        const re2 = new RegExp('\\b(' + escapeRe(hit) + ')\\b', 'i');
        const m2 = re2.exec(text);
        const frag = document.createDocumentFragment();
        if (m2.index > 0) frag.appendChild(document.createTextNode(text.slice(0, m2.index)));
        const sp = document.createElement('span');
        sp.className = 'vrev-mask';
        sp.dataset.vrevKey = d.entryKey;
        sp.dataset.vrevWord = d.word;
        sp.textContent = d.word;
        frag.appendChild(sp);
        if (m2.index + m2[0].length < text.length) frag.appendChild(document.createTextNode(text.slice(m2.index + m2[0].length)));
        tn.parentNode.replaceChild(frag, tn);
        found[hit] = 1;
      });
    });
    let masked = document.querySelectorAll('.vrev-mask').length;
    if (!masked) {
      showTopToast('到期词在正文里没有找到原位（' + due.length + ' 词），已留待下轮');
      vocabMaskClearFlag();
      return;
    }
    if (!vrevWired) {
      vrevWired = true;
      document.addEventListener('click', e => {
        const m = e.target.closest ? e.target.closest('.vrev-mask') : null;
        if (m) vrevReveal(m, true);
      });
      document.addEventListener('contextmenu', e => {
        const m = e.target.closest ? e.target.closest('.vrev-mask') : null;
        if (m) { e.preventDefault(); vrevReveal(m, false); }
      });
    }
    const missing = Math.max(0, due.length - Object.keys(found).length);
    showTopToast('👁 遮盖复习开始：点击黑块=想起来了，右键=没想起来' + (missing > 0 ? '（' + missing + ' 词不在正文，留待下轮）' : ''));
  }
  // 段落填空：同段 ≥3 个到期词时，把词挖成输入框逐词键入（两错后显形）
  function vocabClozeApply() {
    const due = vocabDueList(articleId);
    const byP = {};
    due.forEach(d => { if (d.paraIdx !== '') (byP[d.paraIdx] = byP[d.paraIdx] || []).push(d); });
    let done = 0;
    Object.keys(byP).forEach(pi => {
      const list = byP[pi];
      if (list.length < 3) return;
      const paras = document.querySelectorAll('.col-body.en p[data-para-idx="' + pi + '"]');
      paras.forEach(p => {
        list.forEach(d => {
          const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
              let q = node.parentNode;
              while (q && q !== p) {
                if (q.nodeType === 1 && (q.tagName === 'MARK' || q.tagName === 'SCRIPT' || (q.classList && (q.classList.contains('vrev-cloze') || q.classList.contains('vrev-mask') || String(q.className).indexOf('freq-') === 0)))) return NodeFilter.FILTER_REJECT;
                q = q.parentNode;
              }
              return new RegExp('\\b' + d.lw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
          });
          const tn = walker.nextNode();
          if (!tn) return;
          const re = new RegExp('\\b(' + d.lw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')\\b', 'i');
          const m = re.exec(tn.nodeValue);
          const frag = document.createDocumentFragment();
          if (m.index > 0) frag.appendChild(document.createTextNode(tn.nodeValue.slice(0, m.index)));
          const inp = document.createElement('input');
          inp.className = 'vrev-cloze';
          inp.dataset.vrevKey = d.entryKey;
          inp.dataset.vrevWord = d.word;
          inp.setAttribute('size', String(d.word.length + 3));
          inp.setAttribute('autocomplete', 'off');
          frag.appendChild(inp);
          if (m.index + m[0].length < tn.nodeValue.length) frag.appendChild(document.createTextNode(tn.nodeValue.slice(m.index + m[0].length)));
          tn.parentNode.replaceChild(frag, tn);
          done++;
        });
      });
    });
    if (!done && !document.querySelectorAll('.vrev-cloze').length) {
      showTopToast('没有可填空的段落（需要同段 ≥3 个到期词），改用遮盖模式');
      try { localStorage.setItem(VREV_MODE_KEY, 'mask'); } catch (e) {}
      vocabMaskApply();
      return;
    }
    if (!vrevWired) {
      vrevWired = true;
      document.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('vrev-cloze')) { e.preventDefault(); vrevClozeCheck(e.target); }
      });
      document.addEventListener('focusout', e => {
        if (e.target.classList && e.target.classList.contains('vrev-cloze') && e.target.value) vrevClozeCheck(e.target);
      });
    }
    showTopToast('✍ 段落填空：键入被挖掉的词，回车判定');
  }
  function vrevClozeCheck(inp) {
    if (inp.dataset.vrevDone) return;
    const word = inp.dataset.vrevWord, key = inp.dataset.vrevKey;
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z'\-]/g, '');
    if (norm(inp.value) === norm(word)) {
      const sp = document.createElement('span');
      sp.className = 'vrev-open';
      sp.textContent = word;
      inp.parentNode.replaceChild(sp, inp);
      if (!vrevScheduledKeys[key]) {
        vrevScheduledKeys[key] = 1;
        const all = vrevAll();
        all[key] = vocabSchedule(all[key], true);
        vrevSave(all);
      }
    } else {
      const miss = (+inp.dataset.miss || 0) + 1;
      inp.dataset.miss = miss;
      if (miss === 1) {
        inp.classList.add('vrev-miss');
        inp.value = '';
        inp.placeholder = word.charAt(0) + '·'.repeat(Math.max(1, word.length - 1));
      } else {
        const sp = document.createElement('span');
        sp.className = 'vrev-open';
        sp.textContent = word;
        inp.parentNode.replaceChild(sp, inp);
        if (!vrevScheduledKeys[key]) {
          vrevScheduledKeys[key] = 1;
          const all = vrevAll();
          all[key] = vocabSchedule(all[key], false);
          vrevSave(all);
        }
      }
    }
    vrevMaybeFinish();
  }

  // ===== FEATURE: 衔接线索模式（v45 T04）=====
  // 新题型（7选5/排序）考的是 Halliday & Hasan 衔接链重建：代词找先行词、逻辑连接词、词汇复现。
  // 本模式把三类线索显性着色；点代词 → 再点同段靠前的名词 = 配对练习（记 wsj_linkrev，不做正误强判——
  // 先行词判定没有可靠启发式，错误的判定会教错，宁可只做视觉配对）。
  const LINK_MODE_KEY = 'wsj_reader:linkmode';
  const LINK_REV_KEY = 'wsj_linkrev';
  function linkModeOn() { return localStorage.getItem(LINK_MODE_KEY) === '1'; }
  function linkRevBump(aid) {
    try {
      const r = JSON.parse(localStorage.getItem(LINK_REV_KEY) || '{}') || {};
      const e = r[aid] || { n: 0 };
      e.n = (e.n || 0) + 1;
      e.last = new Date().toISOString();
      r[aid] = e;
      localStorage.setItem(LINK_REV_KEY, JSON.stringify(r));
    } catch (err) {}
  }
  const LINK_PRON = /\b(it|they|them|this|these|those|such|one|ones|both|neither|either|he|she|him|her|his|its|their|theirs|who|whose|which)\b/ig;
  const LINK_LOGIC = [
    ['t', /\b(however|nevertheless|nonetheless|yet|but|still|instead|rather|in contrast|by contrast|on the contrary|conversely)\b/ig],
    ['c', /\b(therefore|thus|hence|consequently|accordingly|as a result|because of|due to|so that)\b/ig],
    ['a', /\b(moreover|furthermore|in addition|additionally|besides|indeed|in fact|for instance|for example|similarly|likewise)\b/ig],
    ['s', /\b(meanwhile|subsequently|eventually|finally|afterwards|later on|since then|in the end)\b/ig]
  ];
  // 复现链停用词：功能词与逻辑词不计链（否则 that/make 满屏都是「链」）
  const LINK_STOP = new Set(('that with from this have been were their would could should about which there these those other more most only also some when where while after before between because through without itself himself themselves being doing very much many then them thus those such whose under over into upon among across already almost although always another around based given least less level made make makes might must never often once ones order others perhaps rather really said same seen several shall since still sure take taken takes thing think though times today told true turn under until upon well went whether while within world year years').split(' '));
  let linkWired = false;
  let linkPick = null;   // 待配对的代词 span
  function linkEscapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function applyLinkMode() {
    if (document.querySelector('.link-pron, .link-logic-t, .link-chain-1')) return;   // 幂等
    const bodies = document.querySelectorAll('.col-body.en');
    if (!bodies.length) return;
    // 1) 代词 + 逻辑连接词：单遍扫描，逻辑短语优先、代词避开重叠区
    bodies.forEach(body => {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          let q = node.parentNode;
          while (q && q !== body) {
            if (q.nodeType === 1) {
              const t = q.tagName;
              if (t === 'MARK' || t === 'SCRIPT' || t === 'STYLE' || t === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
              if (q.classList && (String(q.className).indexOf('link-') === 0 || String(q.className).indexOf('freq-') === 0)) return NodeFilter.FILTER_REJECT;
              if (q.getAttribute && q.getAttribute('contenteditable') === 'true') return NodeFilter.FILTER_REJECT;
            }
            q = q.parentNode;
          }
          return /[A-Za-z]/.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(tn => {
        const text = tn.nodeValue;
        const marks = [];
        LINK_LOGIC.forEach(pair => {
          pair[1].lastIndex = 0;
          let m;
          while ((m = pair[1].exec(text)) !== null) marks.push({ s: m.index, e: m.index + m[0].length, cls: 'link-logic-' + pair[0], w: m[0] });
        });
        LINK_PRON.lastIndex = 0;
        let m;
        while ((m = LINK_PRON.exec(text)) !== null) marks.push({ s: m.index, e: m.index + m[0].length, cls: 'link-pron', w: m[0] });
        if (!marks.length) return;
        marks.sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s));
        const merged = [];
        let lastEnd = -1;
        marks.forEach(mk => { if (mk.s < lastEnd) return; merged.push(mk); lastEnd = mk.e; });
        const frag = document.createDocumentFragment();
        let pos = 0;
        merged.forEach(mk => {
          if (mk.s > pos) frag.appendChild(document.createTextNode(text.slice(pos, mk.s)));
          const sp = document.createElement('span');
          sp.className = mk.cls;
          sp.textContent = mk.w;
          frag.appendChild(sp);
          pos = mk.e;
        });
        if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
        tn.parentNode.replaceChild(frag, tn);
      });
    });
    // 2) 词汇复现链：正文实词按 token 计数，≥3 次成链（限 12 条），同链同色虚线
    const counts = {};
    bodies.forEach(body => {
      (body.textContent.toLowerCase().match(/[a-z][a-z'\-]{3,}/g) || []).forEach(w => {
        const t = w.replace(/^['\-]+|['\-]+$/g, '');
        if (LINK_STOP.has(t)) return;
        counts[t] = (counts[t] || 0) + 1;
      });
    });
    const chains = Object.keys(counts).filter(t => counts[t] >= 3).sort((a, b) => counts[b] - counts[a]).slice(0, 12);
    if (chains.length) {
      const chainOf = {};
      chains.forEach((t, i) => { chainOf[t] = 'link-chain-' + (i % 5 + 1); });
      const chainRe = new RegExp('\\b(' + chains.map(linkEscapeRe).join('|') + ')\\b', 'ig');
      bodies.forEach(body => {
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            let q = node.parentNode;
            while (q && q !== body) {
              if (q.nodeType === 1) {
                const t = q.tagName;
                if (t === 'MARK' || t === 'SCRIPT' || t === 'STYLE') return NodeFilter.FILTER_REJECT;
                if (q.classList && String(q.className).indexOf('link-') === 0) return NodeFilter.FILTER_REJECT;
              }
              q = q.parentNode;
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
          chainRe.lastIndex = 0;
          while ((m = chainRe.exec(text)) !== null) {
            if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
            const sp = document.createElement('span');
            sp.className = chainOf[m[0].toLowerCase()];
            sp.textContent = m[0];
            frag.appendChild(sp);
            last = m.index + m[0].length;
          }
          if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
          tn.parentNode.replaceChild(frag, tn);
        });
      });
    }
    // 3) 配对交互：点代词 → 再点同段靠前的词（caret 定位取词），视觉配对 + 计数
    if (!linkWired) {
      linkWired = true;
      document.addEventListener('click', e => {
        if (!linkModeOn()) return;
        const pron = e.target.closest ? e.target.closest('.link-pron') : null;
        if (pron) {
          if (linkPick) linkPick.classList.remove('link-pick');
          linkPick = pron;
          pron.classList.add('link-pick');
          showTopToast('选中代词 —— 再点击它指代的名词（同段靠前位置）；按 Esc 取消');
          return;
        }
        if (!linkPick) return;
        const bodyEl = e.target.closest ? e.target.closest('.col-body.en') : null;
        if (!bodyEl || !bodyEl.contains(linkPick)) { linkPick.classList.remove('link-pick'); linkPick = null; return; }
        let word = '';
        try {
          const gCP = document.caretRangeFromPoint || document.caretPositionFromPoint;
          if (gCP) {
            const range = gCP.call(document, e.clientX, e.clientY);
            if (range && range.startContainer.nodeType === 3) {
              const text = range.startContainer.textContent || '';
              let off = range.startOffset;
              while (off > 0 && /[A-Za-z'\-]/.test(text.charAt(off - 1))) off--;
              let end = off;
              while (end < text.length && /[A-Za-z'\-]/.test(text.charAt(end))) end++;
              word = text.slice(off, end);
            }
          }
        } catch (err) {}
        const pronEl = linkPick;
        pronEl.classList.remove('link-pick');
        pronEl.classList.add('link-paired');
        linkPick = null;
        if (word) {
          pronEl.title = '配对：' + word + '（练习已记录）';
          showTopToast('已配对：' + pronEl.textContent + ' ← ' + word);
        }
        linkRevBump(articleId);
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && linkPick) { linkPick.classList.remove('link-pick'); linkPick = null; }
      });
    }
    showTopToast('🔗 衔接模式：黄标=代词（点击配对先行词）、四色下划线=转折/因果/加合/时间、彩色虚线=词汇复现链');
  }
  function removeLinkMode() {
    document.querySelectorAll('.col-body.en span[class^="link-"]').forEach(sp => {
      const p = sp.parentNode;
      if (!p) return;
      while (sp.firstChild) p.insertBefore(sp.firstChild, sp);
      p.removeChild(sp);
    });
    document.querySelectorAll('.col-body').forEach(b => b.normalize());
  }
  function toggleLinkMode() {
    if (linkModeOn()) {
      localStorage.setItem(LINK_MODE_KEY, '0');
      removeLinkMode();
      const b = document.getElementById('linkmode-btn');
      if (b) b.innerHTML = '<span>🔗</span><span>衔接模式</span>';
      showTopToast('衔接模式已关闭');
      return;
    }
    localStorage.setItem(LINK_MODE_KEY, '1');
    const b = document.getElementById('linkmode-btn');
    if (b) b.innerHTML = '<span>🔗</span><span>衔接模式 ✓ 开</span>';
    applyLinkMode();
  }
