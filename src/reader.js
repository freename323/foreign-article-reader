(function() {
  const articleId = location.pathname.split('/').pop() || 'article';
  const ANNO_KEY = 'annotations:' + articleId;
  const SUM_KEY = 'summary:' + articleId;
  const TRANS_KEY = 'translation:' + articleId;
  const SETTINGS_KEY = 'settings:' + articleId;
  let annotations = [];
  let summaryData = {};
  let translationData = {};
  let settings = { theme: 'green', fontSize: 16, showSummary: true, showCN: true, showNotes: true, showHeader: true, mobileMode: 'both' };
  let initializing = true; // UX-5: suppress operation toasts during first load
  const mobileQuery = window.matchMedia ? window.matchMedia('(max-width: 860px)') : { matches: false }; // UX-3/UX-6

  // ===== Util =====
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function unesc(s) { return String(s == null ? '' : s).replace(/&(amp|lt|gt|quot|#39);/g, c => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[c])); }
  function genId() { return Date.now() + '-' + Math.random().toString(36).slice(2, 8); }

  // ===== Load/save =====
  function loadAll() {
    try { const a = localStorage.getItem(ANNO_KEY); if (a) annotations = JSON.parse(a); } catch(e) { annotations = []; }
    // Migrate: ensure every annotation has a bucket field (older versions may lack it)
    let migrated = false;
    annotations.forEach(a => {
      if (!a.bucket) { a.bucket = (a.type === 'note') ? 'note' : 'vocab'; migrated = true; }
    });
    if (migrated) saveAnnotations();
    try { const s = localStorage.getItem(SUM_KEY); if (s) summaryData = JSON.parse(s); } catch(e) { summaryData = {}; }
    try { const t = localStorage.getItem(TRANS_KEY); if (t) translationData = JSON.parse(t); } catch(e) { translationData = {}; }
    try { const st = localStorage.getItem(SETTINGS_KEY); if (st) Object.assign(settings, JSON.parse(st)); } catch(e) {}
    // 一次性迁移：旧默认「跟随系统」→「绿金」（新默认主题）。显式选过暗色/亮色的不受影响
    if (!localStorage.getItem('wsj_reader:themeMigrated')) {
      try { localStorage.setItem('wsj_reader:themeMigrated', '1'); } catch (e) {}
      if (settings.theme === 'system') settings.theme = 'green';
    }
    // 「考研阅读」阅读模式已移除（与模拟考试页重复），清理遗留开关
    try { localStorage.removeItem('wsj_reader:mode'); } catch (e) {}
  }
  function saveAnnotations() { try { localStorage.setItem(ANNO_KEY, JSON.stringify(annotations)); } catch(e) { handleQuotaError(e); } checkStorageQuota(); }
  function saveSummary() { try { localStorage.setItem(SUM_KEY, JSON.stringify(summaryData)); } catch(e) { handleQuotaError(e); } checkStorageQuota(); }
  function saveTranslation() { try { localStorage.setItem(TRANS_KEY, JSON.stringify(translationData)); } catch(e) { handleQuotaError(e); } checkStorageQuota(); }
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch(e) { handleQuotaError(e); } checkStorageQuota(); }

  // ===== Storage quota warning =====
  let quotaWarned = false;
  function getStorageUsage() {
    try {
      let total = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        total += (k.length + localStorage.getItem(k).length) * 2; // UTF-16
      }
      return total;
    } catch (e) { return 0; }
  }
  function checkStorageQuota() {
    if (quotaWarned) return;
    const used = getStorageUsage();
    // localStorage limit is typically 5MB (5 * 1024 * 1024 bytes)
    const limit = 5 * 1024 * 1024;
    const pct = used / limit;
    if (pct > 0.8) {
      quotaWarned = true;
      const mb = (used / 1024 / 1024).toFixed(1);
      showTopToast('⚠ 本地存储已用 ' + mb + 'MB（' + Math.round(pct * 100) + '%），建议尽快导出备份：💾 数据 → 备份全部数据', 8000);
    }
  }
  function handleQuotaError(e) {
    if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
      showTopToast('❌ 本地存储已满！请先导出备份再清理：💾 数据 → 备份全部数据 → 清理数据', 10000);
    }
  }

  // ===== Settings: theme / size / layout =====
  function setTheme(t) {
    settings.theme = t; saveSettings();
    if (t === 'system') { document.documentElement.removeAttribute('data-theme'); }
    else { document.documentElement.setAttribute('data-theme', t); }
    const themeNames = { green: '🌿 绿金主题', light: '亮色主题', dark: '暗色主题', 'blue-gold': '💎 蓝金主题', system: '跟随系统' };
    if (!initializing) showTopToast(themeNames[t] || t);
  }
  function toggleTheme() {
    // 绿金 → 暗色 → 亮色 → 绿金
    const order = ['green', 'dark', 'light'];
    const cur = settings.theme === 'system' ? 'green' : settings.theme;
    setTheme(order[(order.indexOf(cur) + 1) % order.length]);
  }
  function changeSize(delta) {
    settings.fontSize = Math.max(12, Math.min(22, settings.fontSize + delta));
    saveSettings();
    document.documentElement.style.setProperty('--font-base', settings.fontSize + 'px');
    const sizeEl = document.getElementById('size-display');
    if (sizeEl) sizeEl.textContent = settings.fontSize + 'px';
    scheduleHeightSync(true); // UX-6: font-size change requires re-measure
  }
  function applyLayout() {
    const w = document.querySelector('.main-wrap');
    w.classList.toggle('no-summary', !settings.showSummary);
    w.classList.toggle('no-cn', !settings.showCN);
    document.getElementById('toggle-summary-btn').classList.toggle('active', settings.showSummary);
    document.getElementById('toggle-cn-btn').classList.toggle('active', settings.showCN);
    const notesBtn = document.getElementById('toggle-notes-btn');
    if (notesBtn) notesBtn.classList.toggle('active', settings.showNotes);
    const hdr = document.querySelector('.header');
    if (hdr) hdr.classList.toggle('collapsed', !settings.showHeader);
    const hdrBtn = document.getElementById('toggle-header-btn');
    if (hdrBtn) hdrBtn.classList.toggle('active', settings.showHeader);
  }
  function toggleSummary() { settings.showSummary = !settings.showSummary; saveSettings(); applyLayout(); showTopToast(settings.showSummary ? '概要列已显示' : '概要列已隐藏'); setTimeout(() => window.__resyncScroll && window.__resyncScroll(), 50); }
  function toggleCN() { settings.showCN = !settings.showCN; saveSettings(); applyLayout(); showTopToast(settings.showCN ? '中文列已显示' : '中文列已隐藏'); setTimeout(() => window.__resyncScroll && window.__resyncScroll(), 50); }
  function toggleHeader() { settings.showHeader = !settings.showHeader; saveSettings(); applyLayout(); showTopToast(settings.showHeader ? '标题区已显示' : '标题区已隐藏'); setTimeout(() => window.__resyncScroll && window.__resyncScroll(), 50); }
  function toggleNotes() {
    settings.showNotes = !settings.showNotes; saveSettings();
    const sec = document.querySelector('.notes-section');
    sec.classList.toggle('collapsed', !settings.showNotes);
    const nb = document.getElementById('toggle-notes-btn');
    if (nb) nb.classList.toggle('active', settings.showNotes);
    showTopToast(settings.showNotes ? '笔记面板已展开' : '笔记面板已折叠');
    updateNotesButtons();
  }
  // Direct open or toggle: if already showing this bucket, close; otherwise open & switch
  function openNotes(bucket) {
    if (settings.showNotes && notesBucket === bucket) {
      settings.showNotes = false; saveSettings();
      document.querySelector('.notes-section').classList.add('collapsed');
    } else {
      const wasCollapsed = !settings.showNotes;
      if (wasCollapsed) {
        settings.showNotes = true; saveSettings();
        document.querySelector('.notes-section').classList.remove('collapsed');
      }
      if (bucket) setNotesBucket(bucket);
      if (wasCollapsed) {
        const sec = document.querySelector('.notes-section');
        if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }
    updateNotesButtons();
  }
  function updateNotesButtons() {
    const vb = document.getElementById('open-vocab-btn');
    const nb = document.getElementById('open-note-btn');
    if (vb) {
      const on = settings.showNotes && notesBucket === 'vocab';
      vb.classList.toggle('active', on);
      vb.style.background = on ? '#cfe2ff' : '';
      vb.style.color = on ? '#1a365d' : '';
      vb.style.fontWeight = on ? '600' : '';
    }
    if (nb) {
      const on = settings.showNotes && notesBucket === 'note';
      nb.classList.toggle('active', on);
      nb.style.background = on ? '#d4f4dd' : '';
      nb.style.color = on ? '#1c4532' : '';
      nb.style.fontWeight = on ? '600' : '';
    }
  }

  // ===== Summary: editable thesis + para summaries (bilingual) =====
  // 概要/主旨可编辑字段的 storage key（thesis-N-lang / para-N-lang）。
  // initSummary / resetSummary / undoEdit 三处共用，杜绝 key 计算漂移
  function summaryKeyFor(el) {
    if (!el || !el.closest) return null;
    const lis = document.querySelectorAll('.thesis-block ol > li');
    const liIdx = Array.prototype.indexOf.call(lis, el.closest('li'));
    if (liIdx >= 0) return 'thesis-' + (liIdx + 1) + '-' + el.dataset.lang;
    const pItem = el.closest('.para-summary-item');
    if (pItem && pItem.dataset.idx) return 'para-' + pItem.dataset.idx + '-' + el.dataset.lang;
    return null;
  }
  function initSummary() {
    // Thesis (bilingual: EN + CN per item)
    document.querySelectorAll('.thesis-block [data-default]').forEach((el) => {
      const key = summaryKeyFor(el);
      const def = unesc(el.dataset.default || '');
      const stored = summaryData[key];
      if (typeof stored === 'string' && stored !== '') el.textContent = stored;
      else { el.textContent = def; summaryData[key] = def; }
      el.addEventListener('blur', () => { summaryData[key] = el.textContent.trim(); saveSummary(); });
      el.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\s+/g, ' ').trim();
        document.execCommand('insertText', false, text);
      });
    });
    // Para summaries (bilingual: 2 editables per item)
    document.querySelectorAll('.para-summary-item').forEach((item) => {
      item.querySelectorAll('[data-default]').forEach((el) => {
        const key = summaryKeyFor(el);
        const def = unesc(el.dataset.default || '');
        const stored = summaryData[key];
        if (typeof stored === 'string' && stored !== '') el.textContent = stored;
        else { el.textContent = def; summaryData[key] = def; }
        el.addEventListener('blur', () => { summaryData[key] = el.textContent.trim(); saveSummary(); });
        el.addEventListener('paste', (e) => {
          e.preventDefault();
          const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\s+/g, ' ').trim();
          document.execCommand('insertText', false, text);
        });
      });
      // Jump button
      const btn = item.querySelector('.jump-btn');
      if (btn) btn.addEventListener('click', () => jumpToParagraph(item.dataset.idx));
    });
    saveSummary();
  }
  function resetSummary() {
    if (!confirm('重置所有主旨/概要为默认？')) return;
    summaryData = {};
    document.querySelectorAll('.thesis-block [data-default]').forEach((el) => {
      const def = unesc(el.dataset.default || '');
      el.textContent = def;
      summaryData[summaryKeyFor(el)] = def;
    });
    document.querySelectorAll('.para-summary-item [data-default]').forEach((el) => {
      const def = unesc(el.dataset.default || '');
      el.textContent = def;
      summaryData[summaryKeyFor(el)] = def;
    });
    saveSummary();
  }

  // ===== Translation: editable Chinese =====
  function initTranslation() {
    document.querySelectorAll('.cn-translatable').forEach((p) => {
      const idx = p.dataset.paraIdx;
      const key = 'para-' + idx;
      const def = p.textContent;
      p.dataset.default = def;
      const stored = translationData[key];
      if (typeof stored !== 'string') { translationData[key] = def; }
      else if (stored !== def) { p.textContent = stored; p.classList.add('cn-edited'); }
      p.setAttribute('contenteditable', 'true');
      p.setAttribute('spellcheck', 'false');
      p.addEventListener('blur', () => {
        const txt = p.textContent.trim();
        translationData[key] = txt;
        saveTranslation();
        if (txt !== p.dataset.default) p.classList.add('cn-edited');
        else p.classList.remove('cn-edited');
        updateTransCount();
        scheduleHeightSync(true); // 编辑改动了段落高度，重新对齐两列
      });
      p.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\s+/g, ' ').trim();
        document.execCommand('insertText', false, text);
      });
    });
    saveTranslation();
    updateTransCount();
  }
  function resetTranslation() {
    if (!confirm('重置所有中文翻译为默认？')) return;
    document.querySelectorAll('.cn-translatable').forEach((p) => {
      p.textContent = p.dataset.default || '';
      p.classList.remove('cn-edited');
      const key = 'para-' + p.dataset.paraIdx;
      translationData[key] = p.dataset.default || '';
    });
    saveTranslation();
    updateTransCount();
    // textContent 重置会连带清掉中文段里的标注 <mark>，重新应用
    reapplyAllHighlights();
    scheduleHeightSync(true);
  }
  function updateTransCount() {
    const n = document.querySelectorAll('.cn-translatable.cn-edited').length;
    const el = document.getElementById('trans-count');
    if (el) el.textContent = n > 0 ? n : '';
  }

  // ===== Annotations =====
  // Bucket: 'vocab' (生词本, includes vocab+unclear) | 'note' (笔记, includes note)
  // Vocab is the most-used feature so it gets its own panel; notes is separate.
  function addAnnotation(type, text, context, note, source, paraIdx, line) {
    if (!text || !text.trim()) return;
    const dup = annotations.find(a => a.text === text && a.source === source);
    if (dup) { flashNote(dup.id); return; }
    const bucket = (type === 'note') ? 'note' : 'vocab';
    const ann = {
      id: genId(), type, bucket, text: text.trim(), context: context || '',
      note: note || '', source: source || 'en', paraIdx: paraIdx || '',
      line: line || 1, createdAt: new Date().toISOString()
    };
    annotations.push(ann); saveAnnotations();
    showTopToast('已标注');
    applyHighlight(ann);
    refreshFreqColoring();
    renderNotes(); updateNoteCount();
  }
  function updateNote(id, note) {
    const a = annotations.find(x => x.id === id);
    if (a) { a.note = note; a.updatedAt = new Date().toISOString(); saveAnnotations(); }
  }
  function deleteAnnotation(id) {
    annotations = annotations.filter(x => x.id !== id); saveAnnotations();
    removeHighlight(id); renderNotes(); updateNoteCount();
    showTopToast('已删除标注');
  }
  function clearAllAnnotations() {
    if (annotations.length === 0) return;
    if (!confirm('清空本篇所有标注？')) return;
    annotations = []; saveAnnotations();
    document.querySelectorAll('mark[data-id]').forEach(m => {
      const txt = document.createTextNode(m.textContent);
      m.parentNode.replaceChild(txt, m);
    });
    document.querySelectorAll('.col-body').forEach(el => el.normalize());
    renderNotes(); updateNoteCount();
    showTopToast('已清空本篇所有标注');
  }

  // ===== Highlight =====
  function applyHighlight(ann) {
    const col = ann.source === 'cn' ? '.col-body.cn' : '.col-body.en';
    document.querySelectorAll(col).forEach(body => {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
          if (!n.parentNode) return NodeFilter.FILTER_REJECT;
          const tag = n.parentNode.tagName;
          if (tag === 'MARK' || tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
          // 注意：CN 段落是 contenteditable，标注必须能进入其中生成 <mark>，
          // 这里不能按 contenteditable 过滤，否则中文标注永远没有高亮
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const nodes = []; let n;
      while ((n = walker.nextNode())) nodes.push(n);
      for (const node of nodes) {
        if (!node.parentNode) continue;
        wrapAllOccurrences(node, ann.text, ann);
      }
    });
  }
  // 拉丁词标注必须落在词边界上：标注 'act' 不能劈开 'exact'、'algorithm'
  // 不能劈开 'algorithms'。首尾都不是拉丁字母/数字的（如中文）不做边界检查
  function isWordBoundaryMatch(val, idx, text) {
    const alnum = /[A-Za-z0-9]/;
    if (!alnum.test(text[0]) && !alnum.test(text[text.length - 1])) return true;
    if (idx > 0 && alnum.test(val[idx - 1])) return false;
    if (idx + text.length < val.length && alnum.test(val[idx + text.length])) return false;
    return true;
  }
  function wrapAllOccurrences(node, text, ann) {
    const val = node.nodeValue;
    const found = [];
    let i = 0;
    while (true) {
      const idx = val.indexOf(text, i);
      if (idx < 0) break;
      if (isWordBoundaryMatch(val, idx, text)) found.push({ start: idx, end: idx + text.length });
      i = idx + Math.max(1, text.length);
    }
    if (found.length === 0) return;
    const parent = node.parentNode;
    const frag = document.createDocumentFragment();
    let last = 0;
    found.forEach(f => {
      if (f.start > last) frag.appendChild(document.createTextNode(val.slice(last, f.start)));
      const mark = document.createElement('mark');
      mark.className = 'hl hl-' + ann.type; mark.dataset.id = ann.id; mark.textContent = text;
      mark.addEventListener('click', (e) => {
        if (e.shiftKey && confirm('删除这条标注？')) deleteAnnotation(ann.id);
        else flashNote(ann.id);
      });
      frag.appendChild(mark);
      last = f.end;
    });
    if (last < val.length) frag.appendChild(document.createTextNode(val.slice(last)));
    parent.replaceChild(frag, node);
  }
  function removeHighlight(id) {
    document.querySelectorAll('mark[data-id="' + id + '"]').forEach(m => {
      const txt = document.createTextNode(m.textContent);
      m.parentNode.replaceChild(txt, m);
    });
    document.querySelectorAll('.col-body').forEach(el => el.normalize());
  }
  function reapplyAllHighlights() { annotations.forEach(a => applyHighlight(a)); }

  // ===== Notes rendering =====
  // 'notesBucket' controls which bucket is shown in the notes panel:
  // 'vocab' (生词本, default) | 'note' (笔记) | 'all'
  let notesBucket = 'vocab';
  let jumpNavIdx = 0;
  // Qtype (题型) tab filter state — two combined dimensions
  let qMasteryFilter = 'all'; // 'all' | 'wrong' | 'review' (wrong+review) | 'mastered'
  let qTypeFilter = 'all';    // 'all' | one of QTYPE_ORDER
  // Annotation tag filter (multi-select AND) — applies across all buckets
  let activeTagFilters = [];
  // Notes-panel text search (生词本/笔记/题型/全部 tab 通用，匹配词句/笔记/上下文/标签)
  let noteSearchQuery = '';
  // Qtype cards whose 💡 解题思路 section is expanded (survives re-renders)
  const openSolvingSet = new Set();
  function setNotesBucket(b) {
    notesBucket = b;
    // Toggle tab buttons
    document.querySelectorAll('[data-notes-bucket]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.notesBucket === b);
    });
    jumpNavIdx = 0;
    renderNotes();
    updateNotesButtons();
  }
  function getFilteredSorted() {
    const bucketAnns = notesBucket === 'all' ? annotations : annotations.filter(a => a.bucket === notesBucket);
    const filtered = bucketAnns.filter(matchesAllFilters);
    return filtered.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }
  function jumpToIdx(idx) {
    const sorted = getFilteredSorted();
    if (sorted.length === 0) return;
    jumpNavIdx = Math.max(0, Math.min(idx, sorted.length - 1));
    const ann = sorted[jumpNavIdx];
    jumpToMark(ann.id);
    // Highlight current card in panel
    document.querySelectorAll('.note-card.current-jump').forEach(c => c.classList.remove('current-jump'));
    const card = document.querySelector('.note-card[data-id="' + ann.id + '"]');
    if (card) {
      card.classList.add('current-jump');
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    updateJumpNav();
  }
  function jumpNext() { jumpToIdx(jumpNavIdx + 1); }
  function jumpPrev() { jumpToIdx(jumpNavIdx - 1); }
  function updateJumpNav() {
    const sorted = getFilteredSorted();
    const counter = document.getElementById('jump-counter');
    const prevBtn = document.getElementById('jump-prev-btn');
    const nextBtn = document.getElementById('jump-next-btn');
    if (counter) counter.textContent = sorted.length > 0 ? (jumpNavIdx + 1) + ' / ' + sorted.length : '0 / 0';
    if (prevBtn) prevBtn.disabled = jumpNavIdx <= 0;
    if (nextBtn) nextBtn.disabled = jumpNavIdx >= sorted.length - 1;
  }
  // Date formatting helpers
  function fmtDate(iso) {
    const d = new Date(iso);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function fmtTimeHM(iso) {
    const d = new Date(iso);
    return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }
  function fmtDateLabel(iso) {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    const ds = fmtDate(iso);
    if (ds === fmtDate(today.toISOString())) return '今天';
    if (ds === fmtDate(yesterday.toISOString())) return '昨天';
    const weekdays = ['日','一','二','三','四','五','六'];
    return d.getMonth()+1 + '月' + d.getDate() + '日 周' + weekdays[d.getDay()];
  }
  function groupByDate(items) {
    const groups = {};
    items.forEach(a => {
      const key = fmtDate(a.createdAt);
      if (!groups[key]) groups[key] = [];
      groups[key].push(a);
    });
    return Object.keys(groups).sort((a,b) => b.localeCompare(a)).map(k => ({ date: k, label: fmtDateLabel(k + 'T12:00'), items: groups[k] }));
  }
  // Timeline rendering
  function renderTimeline() {
    if (!readingData.sessions || readingData.sessions.length === 0) {
      return '<div class="empty-hint">还没有阅读记录。<br>开始阅读后，时间表会自动记录。</div>';
    }
    const sessions = readingData.sessions.slice().sort((a,b) => (b.start || '').localeCompare(a.start || ''));
    const byDate = {};
    sessions.forEach(s => {
      const key = fmtDate(s.start);
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(s);
    });
    const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a));
    let html = '<table class="timeline-table"><thead><tr><th>日期</th><th>时段</th><th>时长</th><th>段落</th></tr></thead><tbody>';
    dates.forEach(d => {
      const daySessions = byDate[d];
      const dayTotal = daySessions.reduce((sum, s) => sum + ((s.end ? new Date(s.end).getTime() : new Date(s.start).getTime()) - new Date(s.start).getTime()), 0);
      html += `<tr class="timeline-date-row"><td colspan="3">${fmtDateLabel(d + 'T12:00')}</td><td>共 ${fmtTime(Math.floor(dayTotal/1000))}</td></tr>`;
      daySessions.forEach(s => {
        const startT = fmtTimeHM(s.start);
        const endT = s.end ? fmtTimeHM(s.end) : '进行中';
        const dur = s.end ? Math.floor((new Date(s.end).getTime() - new Date(s.start).getTime()) / 1000) : Math.floor((Date.now() - new Date(s.start).getTime()) / 1000);
        const paras = s.paras ? 'P' + (s.paras[0]+1) + '–P' + (s.paras[1]+1) : '-';
        html += `<tr><td></td><td>${startT}–${endT}</td><td>${fmtTime(dur)}</td><td>${paras}</td></tr>`;
      });
    });
    html += '</tbody></table>';
    return html;
  }
  function renderNotes() {
    const list = document.getElementById('notes-list');
    if (!list) return;
    // Tabs
    const vocabCount = annotations.filter(a => a.bucket === 'vocab').length;
    const noteCount = annotations.filter(a => a.bucket === 'note').length;
    const qtypeCount = annotations.filter(a => a.bucket === 'qtype').length;
    const sessionCount = (readingData.sessions || []).length;
    let tabsHtml = `<div class="notes-tabs">
      <button data-notes-bucket="vocab" class="${notesBucket === 'vocab' ? 'active' : ''}">📖 生词本 ${vocabCount > 0 ? '(' + vocabCount + ')' : ''}</button>
      <button data-notes-bucket="note" class="${notesBucket === 'note' ? 'active' : ''}">📝 笔记 ${noteCount > 0 ? '(' + noteCount + ')' : ''}</button>
      <button data-notes-bucket="qtype" class="${notesBucket === 'qtype' ? 'active' : ''}">🎓 题型 ${qtypeCount > 0 ? '(' + qtypeCount + ')' : ''}</button>
      <button data-notes-bucket="all" class="${notesBucket === 'all' ? 'active' : ''}">全部 ${annotations.length > 0 ? '(' + annotations.length + ')' : ''}</button>
      <button data-notes-bucket="timeline" class="${notesBucket === 'timeline' ? 'active' : ''}">⏰ 时间表 ${sessionCount > 0 ? '(' + sessionCount + ')' : ''}</button>
    </div>
    <div class="notes-jump-nav">
      <button id="jump-prev-btn" onclick="jumpPrev()" title="上一个 (↑)">◀ 上一个</button>
      <span class="jump-counter" id="jump-counter">0 / 0</span>
      <button id="jump-next-btn" onclick="jumpNext()" title="下一个 (↓)">下一个 ▶</button>
    </div>`;
    // Timeline tab
    if (notesBucket === 'timeline') {
      list.innerHTML = tabsHtml + '<div style="padding:8px 0;">' + renderTimeline() + '</div>';
      list.querySelectorAll('[data-notes-bucket]').forEach(btn => {
        btn.addEventListener('click', () => setNotesBucket(btn.dataset.notesBucket));
      });
      updateJumpNav();
      return;
    }
    // Qtype (题型) tab
    if (notesBucket === 'qtype') {
      list.innerHTML = tabsHtml + renderQtypeList();
      // Tab buttons
      list.querySelectorAll('[data-notes-bucket]').forEach(btn => {
        btn.addEventListener('click', () => setNotesBucket(btn.dataset.notesBucket));
      });
      // Delete buttons
      list.querySelectorAll('[data-del]').forEach(el => {
        el.addEventListener('click', () => deleteAnnotation(el.dataset.del));
      });
      wireQtypeInteractions(list);
      updateJumpNav();
      return;
    }
    if (annotations.length === 0) {
      list.innerHTML = tabsHtml + '<div class="empty-hint">还没标注。<br><br>用鼠标在正文中<strong>选中词句</strong>，<br>弹出工具栏后选类型即可。<br><br>📖 记生词 · ❓ 标不懂 · 💡 加备注<br><br><em>数据存本浏览器，不会上传。</em></div>';
      list.querySelectorAll('[data-notes-bucket]').forEach(btn => {
        btn.addEventListener('click', () => setNotesBucket(btn.dataset.notesBucket));
      });
      return;
    }
    // Filter by bucket
    const bucketAnns = notesBucket === 'all' ? annotations : annotations.filter(a => a.bucket === notesBucket);
    if (bucketAnns.length === 0) {
      list.innerHTML = tabsHtml + `<div class="empty-hint">${notesBucket === 'vocab' ? '生词本' : '笔记'}还是空的。<br>选中文本 → 选类型 → 标注会出现在这里。</div>`;
      list.querySelectorAll('[data-notes-bucket]').forEach(btn => {
        btn.addEventListener('click', () => setNotesBucket(btn.dataset.notesBucket));
      });
      return;
    }
    // Tag filter row (only rendered when tags exist) + combined filters
    const tagFilterHtml = renderTagFilterRow(bucketAnns);
    const filtered = bucketAnns.filter(matchesAllFilters);
    if (filtered.length === 0) {
      list.innerHTML = tabsHtml + tagFilterHtml + '<div class="empty-hint">没有符合当前筛选条件的标注。<br>点击上方标签可调整筛选。</div>';
      list.querySelectorAll('[data-notes-bucket]').forEach(btn => {
        btn.addEventListener('click', () => setNotesBucket(btn.dataset.notesBucket));
      });
      wireTagInteractions(list);
      updateJumpNav();
      return;
    }
    const typeName = { vocab: '📖 生词', unclear: '❓ 不懂', note: '💡 备注' };
    const sorted = filtered.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const groups = groupByDate(sorted);
    let cardsHtml = '';
    groups.forEach(g => {
      cardsHtml += `<div class="notes-date-header date-count">${g.label}<span>${g.items.length} 条</span></div>`;
      cardsHtml += g.items.map(a => {
        if (a.bucket === 'qtype') return renderQtypeCard(a, QTYPE_META[a.qtype] || QTYPE_META.detail);
        if (a.source === 'cn') return renderCNNote(a, typeName);
        return renderENNote(a, typeName);
      }).join('');
    });
    list.innerHTML = tabsHtml + tagFilterHtml + cardsHtml;
    // Wire up edits
    list.querySelectorAll('[data-note-edit]').forEach(el => {
      el.addEventListener('input', () => updateNote(el.dataset.noteEdit, el.textContent.trim()));
      el.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\s+/g, ' ').trim();
        document.execCommand('insertText', false, text);
      });
    });
    list.querySelectorAll('[data-jump]').forEach(el => {
      el.addEventListener('click', () => {
        if (el.dataset.jump) jumpToMark(el.dataset.jump);
      });
    });
    list.querySelectorAll('[data-del]').forEach(el => {
      el.addEventListener('click', () => deleteAnnotation(el.dataset.del));
    });
    // Wire up bucket tab buttons
    list.querySelectorAll('[data-notes-bucket]').forEach(btn => {
      btn.addEventListener('click', () => setNotesBucket(btn.dataset.notesBucket));
    });
    // Wire qtype cards if any are present (e.g. in the 全部 tab)
    wireQtypeInteractions(list);
    updateJumpNav();
  }
  function renderENNote(a, typeName) {
    const timeStr = fmtTimeHM(a.createdAt);
    const editedStr = a.updatedAt ? `<span class="note-time-stamp edited" title="修改于 ${fmtTimeHM(a.updatedAt)}">${fmtTimeHM(a.updatedAt)}</span>` : '';
    return `
      <div class="note-card" data-id="${a.id}">
        <button class="del-btn" data-del="${a.id}" title="删除">×</button>
        <span class="badge badge-${a.type}">${typeName[a.type] || a.type}</span>
        <span class="source-line note-time-stamp"><code data-jump="${a.id}">EN p${a.paraIdx || '?'} L${a.line || 1}</code> · <span>${timeStr}</span>${editedStr}</span>
        <table class="note-table">
          <tr>
            <td class="label">EN</td>
            <td class="en-text" data-jump="${a.id}">${esc(a.text)}</td>
          </tr>
          <tr>
            <td class="label">中</td>
            <td class="cn-text" contenteditable="true" data-note-edit="${a.id}"
                data-placeholder="（从词典软件复制释义/翻译，粘在这里）">${esc(a.note || '')}</td>
          </tr>
          ${a.context ? `<tr>
            <td class="label">上下文</td>
            <td class="context" data-jump="${a.id}">${esc(a.context)}</td>
          </tr>` : ''}
        </table>
        ${renderTagRow(a)}
      </div>`;
  }
  function renderCNNote(a, typeName) {
    const timeStr = fmtTimeHM(a.createdAt);
    const editedStr = a.updatedAt ? `<span class="note-time-stamp edited" title="修改于 ${fmtTimeHM(a.updatedAt)}">${fmtTimeHM(a.updatedAt)}</span>` : '';
    return `
      <div class="note-card" data-id="${a.id}">
        <button class="del-btn" data-del="${a.id}" title="删除">×</button>
        <span class="badge badge-${a.type}">${typeName[a.type] || a.type}</span>
        <span class="source-line note-time-stamp"><code data-jump="${a.id}">中 p${a.paraIdx || '?'} L${a.line || 1}</code> · <span>${timeStr}</span>${editedStr}</span>
        <div class="note-cn-format">
          <span class="loc" data-jump="${a.id}">第${a.paraIdx}段第${a.line}行:</span>
          <span class="quote" data-jump="${a.id}">"${esc(a.text)}"</span>
          <span class="note-text-cn" contenteditable="true" data-note-edit="${a.id}"
                data-placeholder="（笔记）">${esc(a.note || '')}</span>
        </div>
        ${renderTagRow(a)}
      </div>`;
  }
  function flashNote(id) {
    const el = document.querySelector('.note-card[data-id="' + id + '"]');
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1200);
    }
  }
  function jumpToMark(id) {
    const m = document.querySelector('mark[data-id="' + id + '"]');
    if (m) {
      m.scrollIntoView({ block: 'center', behavior: 'smooth' });
      m.classList.add('highlight-flash');
      setTimeout(() => m.classList.remove('highlight-flash'), 1600);
    }
  }
  function updateNoteCount() {
    const el = document.getElementById('note-count');
    if (el) el.textContent = annotations.length > 0 ? annotations.length : '';
  }

  // ===== FEATURE: Notes-panel search (标注内容过滤，跨所有 tab) =====
  function setupNotesSearch() {
    const actions = document.querySelector('.notes-section header .actions');
    if (!actions || document.getElementById('notes-search-input')) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'notes-search-input';
    input.className = 'notes-search';
    input.placeholder = '🔍 搜标注…';
    input.title = '在生词 / 笔记 / 题型卡里搜词句、释义、上下文、标签（Esc 清空）';
    input.addEventListener('input', () => {
      noteSearchQuery = input.value.trim().toLowerCase();
      renderNotes();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!noteSearchQuery) return;
        noteSearchQuery = '';
        input.value = '';
        renderNotes();
      }
    });
    actions.insertBefore(input, actions.firstChild);
  }

  // ===== Sync EN/CN blockquote heights (sidebar before paragraph 1) =====
  function syncBlockquoteHeights() {
    const enBq = document.querySelectorAll('.col-body.en blockquote');
    const cnBq = document.querySelectorAll('.col-body.cn blockquote');
    // Reset
    enBq.forEach(b => b.style.minHeight = '');
    cnBq.forEach(b => b.style.minHeight = '');
    void document.body.offsetHeight;
    const n = Math.max(enBq.length, cnBq.length);
    for (let i = 0; i < n; i++) {
      const e = enBq[i], c = cnBq[i];
      if (!e && !c) continue;
      const eH = e ? e.offsetHeight : 0;
      const cH = c ? c.offsetHeight : 0;
      const maxH = Math.max(eH, cH);
      if (maxH > 0) {
        if (e) e.style.minHeight = maxH + 'px';
        if (c) c.style.minHeight = maxH + 'px';
      }
    }
  }

  // ===== Sync EN/CN paragraph heights (forces line-level alignment) =====
  // Because EN and CN paragraphs have different word counts, they would naturally
  // have different heights even with same content. To make lines align across
  // both columns, we measure each pair and force both to the larger height.
  function syncParaHeights() {
    const enParas = document.querySelectorAll('.col-body.en p[data-para-idx]');
    const cnParas = document.querySelectorAll('.col-body.cn p[data-para-idx]');
    // Reset
    enParas.forEach(p => p.style.minHeight = '');
    cnParas.forEach(p => p.style.minHeight = '');
    // Force layout
    void document.body.offsetHeight;
    // Match by para-idx
    enParas.forEach((enP) => {
      const idx = enP.dataset.paraIdx;
      const cnP = document.querySelector('.col-body.cn p[data-para-idx="' + idx + '"]');
      if (!cnP) return;
      const enH = enP.offsetHeight;
      const cnH = cnP.offsetHeight;
      const maxH = Math.max(enH, cnH);
      if (maxH > 0) {
        enP.style.minHeight = maxH + 'px';
        cnP.style.minHeight = maxH + 'px';
      }
    });
  }

  // ===== Sync EN/CN summary heights within each para-summary-item =====
  // Each item has an en-sum and a cn-sum. To make their lines visually align,
  // we measure both and force both to the larger height.
  function syncSummaryHeights() {
    document.querySelectorAll('.para-summary-item').forEach((item) => {
      const en = item.querySelector('.en-sum');
      const cn = item.querySelector('.cn-sum');
      if (!en || !cn) return;
      en.style.minHeight = '';
      cn.style.minHeight = '';
    });
    void document.body.offsetHeight;
    document.querySelectorAll('.para-summary-item').forEach((item) => {
      const en = item.querySelector('.en-sum');
      const cn = item.querySelector('.cn-sum');
      if (!en || !cn) return;
      const enH = en.offsetHeight;
      const cnH = cn.offsetHeight;
      const maxH = Math.max(enH, cnH);
      if (maxH > 0) {
        en.style.minHeight = maxH + 'px';
        cn.style.minHeight = maxH + 'px';
      }
    });
  }

  // ===== UX-6: Height-sync scheduling (mobile skip / debounce / rAF / width cache) =====
  let heightSyncTimer = null;
  let resizeScrollTimer = null;
  let lastSyncedWidth = -1;
  function clearForcedHeights() {
    document.querySelectorAll('.col-body p[data-para-idx], .col-body blockquote, .para-summary-item .en-sum, .para-summary-item .cn-sum').forEach(el => { el.style.minHeight = ''; });
  }
  function doHeightSync(force) {
    // Mobile single-column layout needs no cross-column alignment
    if (mobileQuery.matches) {
      clearForcedHeights();
      lastSyncedWidth = -1;
      return;
    }
    requestAnimationFrame(() => {
      const wrap = document.querySelector('.main-wrap');
      const w = wrap ? wrap.clientWidth : document.documentElement.clientWidth;
      if (!force && w === lastSyncedWidth) return; // width unchanged -> skip
      lastSyncedWidth = w;
      syncBlockquoteHeights();
      syncParaHeights();
      syncSummaryHeights();
    });
  }
  function scheduleHeightSync(force) {
    clearTimeout(heightSyncTimer);
    heightSyncTimer = setTimeout(() => doHeightSync(force), 150);
  }
  // UX-6: first load — defer the initial sync to idle time (fallback: 250ms)
  function deferInitialHeightSync() {
    const run = () => doHeightSync(true);
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 1200 });
    } else {
      setTimeout(run, 250);
    }
  }

  // ===== Scroll sync EN <-> CN (paragraph-level alignment using offsetTop) =====
  // Since we forced all paragraphs to be equal height, finding the matching
  // paragraph by para-idx and aligning via offsetTop gives both paragraph
  // AND line alignment across the two columns.
  function setupScrollSync() {
    const en = document.querySelector('.col-body.en');
    const cn = document.querySelector('.col-body.cn');
    if (!en || !cn) return;
    let syncing = false;
    function syncTo(src, dst) {
      if (syncing || jumpInProgress) return;
      // Find topmost visible paragraph in src (in viewport coords)
      const paragraphs = src.querySelectorAll('p[data-para-idx]');
      let topP = null;
      for (const p of paragraphs) {
        const r = p.getBoundingClientRect();
        if (r.bottom > 10) {  // 10 = small margin from viewport top
          topP = p;
          break;
        }
      }
      if (!topP) return;
      const idx = topP.dataset.paraIdx;
      const dstP = dst.querySelector('p[data-para-idx="' + idx + '"]');
      if (!dstP) return;
      // We want dstP to appear at the same viewport Y as topP
      // topP is at getBoundingClientRect().top in src viewport
      // Set dst.scrollTop so dstP.offsetTop - dst.scrollTop = topP.top
      // => dst.scrollTop = dstP.offsetTop - topP.top
      const topPViewportTop = topP.getBoundingClientRect().top;
      const targetScroll = dstP.offsetTop - topPViewportTop;
      syncing = true;
      dst.scrollTop = Math.max(0, targetScroll);
      requestAnimationFrame(() => { syncing = false; });
    }
    en.addEventListener('scroll', () => syncTo(en, cn), { passive: true });
    cn.addEventListener('scroll', () => syncTo(cn, en), { passive: true });
    // Expose for re-sync after layout changes
    window.__resyncScroll = () => {
      doHeightSync(true);
      en.dispatchEvent(new Event('scroll'));
    };
  }

  // ===== Exam-prep UI injection (article HTML stays untouched) =====
  function ensureExamUI() {
    // 1) Float menu: wrap base buttons, add qtype/syntax/material/root actions
    const menu = document.getElementById('float-menu');
    if (menu && !menu.dataset.examReady) {
      menu.dataset.examReady = '1';
      let main = menu.querySelector('.float-main');
      if (!main) {
        main = document.createElement('div');
        main.className = 'float-main';
        while (menu.firstChild) main.appendChild(menu.firstChild);
        menu.appendChild(main);
      }
      [
        { act: 'qtype-toggle', icon: '🎯', title: '题型标注' },
        { act: 'syntax', icon: '🧩', title: '长难句拆解' },
        { act: 'material', icon: '✍️', title: '写作素材' },
        { act: 'root', icon: '🌱', title: '记入词根库' }
      ].forEach(x => {
        const b = document.createElement('button');
        b.dataset.act = x.act;
        b.title = x.title;
        b.textContent = x.icon;
        main.appendChild(b);
      });
      const qrow = document.createElement('div');
      qrow.className = 'float-qrow';
      qrow.id = 'float-qrow';
      QTYPE_ORDER.forEach(q => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.qact = q;
        b.textContent = QTYPE_META[q].label;
        qrow.appendChild(b);
      });
      menu.appendChild(qrow);
    }
    // 2) Syntax analysis panel
    if (!document.getElementById('syntax-panel')) {
      const stagLabels = [
        ['verb', '谓语'], ['core', '主干'], ['noun', '名词短语'], ['attr', '修饰语'], ['adv', '状语'],
        ['conj', '连词'], ['inv', '倒装'], ['ell', '省略'], ['split', '分隔']
      ];
      const sp = document.createElement('div');
      sp.className = 'syntax-panel';
      sp.id = 'syntax-panel';
      sp.innerHTML =
        '<div class="syntax-header"><h3>🧩 长难句拆解</h3><button type="button" data-close="1" title="关闭">✕</button></div>' +
        '<div class="syntax-steps">选中句中成分后点上方标签上色：先找谓语动词 → 再理主干 → 最后标修饰 / 倒装 / 省略 / 分隔</div>' +
        '<div class="syntax-tags">' + stagLabels.map(s => '<button type="button" data-stag="' + s[0] + '">' + s[1] + '</button>').join('') + '</div>' +
        '<div class="syntax-text" id="syntax-text"></div>' +
        '<div class="syntax-note-row"><input type="text" id="syntax-note" placeholder="结构笔记：主干是什么？哪部分可以省略？"></div>' +
        '<div class="syntax-actions"><button type="button" data-cancel="1">取消</button><button type="button" class="primary" data-save="1">存入句库</button></div>';
      document.body.appendChild(sp);
      sp.querySelector('[data-close]').addEventListener('click', closeSyntaxPanel);
      sp.querySelector('[data-cancel]').addEventListener('click', closeSyntaxPanel);
      sp.querySelector('[data-save]').addEventListener('click', saveSyntax);
    }
    // 3) Writing material panel (legacy fields reused by upgradeMaterialPanel)
    if (!document.getElementById('material-panel')) {
      const mp = document.createElement('div');
      mp.className = 'syntax-panel material-panel';
      mp.id = 'material-panel';
      mp.innerHTML =
        '<div class="syntax-header"><h3>✍️ 写作素材</h3><button type="button" data-close="1" title="关闭">✕</button></div>' +
        '<div class="material-source" id="material-source"></div>' +
        '<div class="material-field"><label for="material-topic">主题标签</label><input type="text" id="material-topic" placeholder="主题标签…"></div>' +
        '<div class="material-field"><label for="material-cause">起因</label><input type="text" id="material-cause" placeholder="起因…"></div>' +
        '<div class="material-field"><label for="material-process">经过</label><input type="text" id="material-process" placeholder="经过…"></div>' +
        '<div class="material-field"><label for="material-develop">发展/结果</label><input type="text" id="material-develop" placeholder="发展/结果…"></div>' +
        '<div class="material-field"><label for="material-logic">写作逻辑</label><input type="text" id="material-logic" placeholder="写作逻辑…"></div>' +
        '<div class="syntax-actions"><button type="button" data-cancel="1">取消</button><button type="button" class="primary" data-save="1">保存素材</button></div>';
      document.body.appendChild(mp);
      mp.querySelector('[data-close]').addEventListener('click', closeMaterialPanel);
      mp.querySelector('[data-cancel]').addEventListener('click', closeMaterialPanel);
      mp.querySelector('[data-save]').addEventListener('click', saveMaterial);
    }
    // 4) Word root / affix panel — fill in meanings while reading
    if (!document.getElementById('root-panel')) {
      const rp = document.createElement('div');
      rp.className = 'syntax-panel root-panel';
      rp.id = 'root-panel';
      rp.innerHTML =
        '<div class="syntax-header"><h3>🌱 词根词缀</h3><button type="button" data-close="1" title="关闭">✕</button></div>' +
        '<div class="root-hint" id="root-hint"></div>' +
        '<div class="material-field"><label for="root-word">词根 / 词缀</label><input type="text" id="root-word" placeholder="如 -ced- / un- / -tion"></div>' +
        '<div class="material-field"><label for="root-kind">类型</label>' +
        '<select id="root-kind"><option value="root">词根</option><option value="prefix">前缀</option><option value="suffix">后缀</option><option value="word">整词</option></select></div>' +
        '<div class="material-field"><label for="root-meaning">含义 / 翻译</label><textarea id="root-meaning" rows="2" placeholder="词缀含义、对应翻译…"></textarea></div>' +
        '<div class="material-field"><label for="root-examples">例词</label><input type="text" id="root-examples" placeholder="proceed, recede（逗号分隔）"></div>' +
        '<div class="root-suggest" id="root-suggest"></div>' +
        '<div class="syntax-actions"><button type="button" data-cancel="1">取消</button><button type="button" data-again="1">保存并继续</button><button type="button" class="primary" data-save="1">保存</button></div>';
      document.body.appendChild(rp);
      rp.querySelector('[data-close]').addEventListener('click', closeRootPanel);
      rp.querySelector('[data-cancel]').addEventListener('click', closeRootPanel);
      rp.querySelector('[data-save]').addEventListener('click', () => saveRootCard(false));
      rp.querySelector('[data-again]').addEventListener('click', () => saveRootCard(true));
    }
    // 5) Advice-composition panel — whole-article writing accumulation
    if (!document.getElementById('compose-panel')) {
      const cp = document.createElement('div');
      cp.className = 'syntax-panel compose-panel';
      cp.id = 'compose-panel';
      cp.innerHTML =
        '<div class="syntax-header"><h3>🖊 建议文积累</h3><button type="button" data-close="1" title="关闭">✕</button></div>' +
        '<div class="compose-hint">全文级积累：论点、建议与相关论述。修改会自动保存到本文。</div>' +
        '<div class="compose-list" id="compose-list"></div>' +
        '<div class="syntax-actions"><button type="button" data-cancel="1">关闭</button><button type="button" class="primary" data-add="1">＋ 新增条目</button></div>';
      document.body.appendChild(cp);
      cp.querySelector('[data-close]').addEventListener('click', closeComposePanel);
      cp.querySelector('[data-cancel]').addEventListener('click', closeComposePanel);
      cp.querySelector('[data-add]').addEventListener('click', () => addComposeEntry());
    }
    // 6) Reading statistics panel
    if (!document.getElementById('stats-panel')) {
      const stp = document.createElement('div');
      stp.className = 'syntax-panel stats-panel';
      stp.id = 'stats-panel';
      stp.innerHTML =
        '<div class="syntax-header"><h3>📊 阅读统计</h3><button type="button" data-close="1" title="关闭">✕</button></div>' +
        '<div class="stats-body" id="stats-body"></div>' +
        '<div class="syntax-actions"><button type="button" data-cancel="1">关闭</button></div>';
      document.body.appendChild(stp);
      stp.querySelector('[data-close]').addEventListener('click', closeStatsPanel);
      stp.querySelector('[data-cancel]').addEventListener('click', closeStatsPanel);
    }
  }

  // ===== Floating selection menu =====
  function setupFloatMenu() {
    const menu = document.getElementById('float-menu');
    let hideTimer = null;
    function showMenu(x, y) {
      // Reset qtype sub-row each time the menu opens
      const qrow = document.getElementById('float-qrow');
      if (qrow) qrow.classList.remove('open');
      // Clamp to viewport
      const w = window.innerWidth, h = window.innerHeight;
      const mw = menu.offsetWidth || 200;
      const mh = menu.offsetHeight || 36;
      let lx = x - mw / 2;
      let ly = y - mh - 8;
      if (lx < 4) lx = 4;
      if (lx + mw > w - 4) lx = w - mw - 4;
      if (ly < 4) ly = y + 8;  // show below if no room above
      if (ly + mh > h - 4) ly = h - mh - 4;
      menu.style.left = lx + 'px';
      menu.style.top = ly + 'px';
      menu.classList.add('visible');
    }
    function hideMenu() { menu.classList.remove('visible'); }
    // 从当前选区收集弹菜单所需信息；无效（空/过长/不在正文列）返回 null
    function selectionInfo(sel) {
      if (!sel || sel.isCollapsed) return null;
      const text = sel.toString().trim();
      if (!text || text.length > 500) return null;
      const node = sel.anchorNode;
      if (!node) return null;
      const col = node.parentElement ? node.parentElement.closest('.col-body') : null;
      if (!col) return null;
      const source = col.classList.contains('cn') ? 'cn' : 'en';
      const p = node.parentElement.closest('p[data-para-idx]');
      let paraIdx = '';
      let line = 1;
      if (p) {
        paraIdx = p.dataset.paraIdx;
        try {
          const range = sel.getRangeAt(0);
          const paraRect = p.getBoundingClientRect();
          const rangeRect = range.getBoundingClientRect();
          const offsetTop = rangeRect.top - paraRect.top;
          const lineHeight = parseFloat(getComputedStyle(p).lineHeight) || 24;
          line = Math.max(1, Math.floor(offsetTop / lineHeight) + 1);
        } catch (e) {}
      }
      const context = getContext(sel);
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      return { text, source, paraIdx, line, context, x: rect.left + rect.width / 2, y: rect.top };
    }
    function wireMenu(info) {
      menu.querySelectorAll('button[data-act]').forEach(btn => {
        btn.onclick = () => {
          const act = btn.dataset.act;
          if (act === 'copy') {
            navigator.clipboard.writeText(info.text).catch(() => {});
            window.getSelection().removeAllRanges(); hideMenu();
          } else if (act === 'qtype-toggle') {
            const qrow = document.getElementById('float-qrow');
            if (qrow) qrow.classList.toggle('open');
          } else if (act === 'syntax') {
            openSyntaxPanel(info.text);
            window.getSelection().removeAllRanges(); hideMenu();
          } else if (act === 'material') {
            openMaterialPanel(info.text);
            window.getSelection().removeAllRanges(); hideMenu();
          } else if (act === 'root') {
            openRootPanel(info.text);
            window.getSelection().removeAllRanges(); hideMenu();
          } else {
            addAnnotation(act, info.text, info.context, '', info.source, info.paraIdx, info.line);
            window.getSelection().removeAllRanges(); hideMenu();
          }
        };
      });
      menu.querySelectorAll('button[data-qact]').forEach(btn => {
        btn.onclick = () => {
          addQtypeAnnotation(btn.dataset.qact, info.text, info.context, info.paraIdx);
          const qrow = document.getElementById('float-qrow');
          if (qrow) qrow.classList.remove('open');
          window.getSelection().removeAllRanges(); hideMenu();
        };
      });
    }
    document.addEventListener('mouseup', (e) => {
      // ignore if click is on menu itself
      if (e.target && e.target.closest && e.target.closest('#float-menu')) return;
      const info = selectionInfo(window.getSelection());
      if (!info) { hideMenu(); return; }
      wireMenu(info);
      showMenu(info.x, info.y);
    });
    // 词频着色模式下，点一下低频/超纲词 = 自动选中该词并弹出菜单，
    // 省去手动拖选；已录生词的词会显示为 freq-v（金色），不在其列
    document.addEventListener('click', (e) => {
      if (!freqModeOn()) return;
      const sp = e.target && e.target.closest ? e.target.closest('span.freq-l, span.freq-x') : null;
      if (!sp) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return; // 正在拖选时不抢
      const r = document.createRange();
      r.selectNodeContents(sp);
      sel.removeAllRanges();
      sel.addRange(r);
      const info = selectionInfo(sel);
      if (!info) return;
      wireMenu(info);
      showMenu(info.x, info.y);
    });
    document.addEventListener('mousedown', (e) => {
      if (!(e.target && e.target.closest && e.target.closest('#float-menu'))) hideMenu();
    });
  }
  function getContext(sel) {
    if (!sel.anchorNode) return '';
    const p = sel.anchorNode.parentElement.closest('p, blockquote, h1, h2, h3, h4');
    if (!p) return '';
    const full = p.textContent.trim();
    if (full.length <= 200) return full;
    const idx = full.indexOf(sel.toString());
    if (idx < 0) return full.slice(0, 200) + '...';
    const start = Math.max(0, idx - 80);
    const end = Math.min(full.length, idx + sel.toString().length + 80);
    return (start > 0 ? '...' : '') + full.slice(start, end) + (end < full.length ? '...' : '');
  }

  // ===== Jump to paragraph (scroll BOTH EN and CN to same viewport position) =====
  let jumpInProgress = false;
  function jumpToParagraph(idx) {
    const en = document.querySelector('.col-body.en');
    const cn = document.querySelector('.col-body.cn');
    const enP = en ? en.querySelector('p[data-para-idx="' + idx + '"]') : null;
    const cnP = cn ? cn.querySelector('p[data-para-idx="' + idx + '"]') : null;
    if (!enP && !cnP) return;
    // Mobile (UX-3): the page itself scrolls; use the visible paragraph directly
    if (mobileQuery.matches) {
      const target = [enP, cnP].find(p => p && p.offsetParent !== null);
      if (!target) return;
      jumpInProgress = true;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('highlight-flash');
      setTimeout(() => target.classList.remove('highlight-flash'), 1600);
      setTimeout(() => { jumpInProgress = false; }, 100);
      return;
    }
    // Block syncTo from interfering
    jumpInProgress = true;
    if (enP) {
      // Center P in EN viewport
      const enOffset = enP.offsetTop - en.clientHeight / 2 + enP.offsetHeight / 2;
      en.scrollTop = Math.max(0, enOffset);
      enP.classList.add('highlight-flash');
      setTimeout(() => enP.classList.remove('highlight-flash'), 1600);
    }
    if (cnP) {
      // Center matching P in CN viewport
      const cnOffset = cnP.offsetTop - cn.clientHeight / 2 + cnP.offsetHeight / 2;
      cn.scrollTop = Math.max(0, cnOffset);
    }
    // Release the lock after scroll events settle
    setTimeout(() => { jumpInProgress = false; }, 100);
  }

  // ===== Export =====
  function collectThesis() {
    return Array.from(document.querySelectorAll('.thesis-block ol > li')).map(li => {
      // thesis li 是单条中文 span（无 data-lang），兼容将来出现 en/cn 双语的结构
      let en = '', cn = '';
      li.querySelectorAll('.editable').forEach(sp => {
        if ((sp.dataset.lang || 'cn') === 'en') en = sp.textContent.trim();
        else cn = sp.textContent.trim();
      });
      return { en, cn };
    }).filter(t => t.en || t.cn);
  }
  function collectParaSums() {
    return Array.from(document.querySelectorAll('.para-summary-item')).map(it => ({
      en: it.querySelector('.en-sum')?.textContent.trim() || '',
      cn: it.querySelector('.cn-sum')?.textContent.trim() || '',
    }));
  }
  function exportMarkdown() {
    const title = document.querySelector('.title-block h1:not(.cn)')?.textContent || 'article';
    const cnTitle = document.querySelector('.title-block h1.cn')?.textContent || '';
    const enAuthor = document.querySelector('.title-block .author:not(.cn)')?.textContent || '';
    const cnAuthor = document.querySelector('.title-block .author.cn')?.textContent || '';
    const thesis = collectThesis();
    const paraSums = collectParaSums();
    const enParas = Array.from(document.querySelectorAll('.col-body.en p[data-para-idx]'));
    const cnParas = Array.from(document.querySelectorAll('.col-body.cn p[data-para-idx]'));
    const lines = [];
    lines.push(`# ${title}`, ``, `**${enAuthor}** / **${cnAuthor}**`, ``);
    if (thesis.length) {
      lines.push(`## 主旨 / Thesis`, ``);
      thesis.forEach(t => {
        if (t.en) lines.push(`- ${t.en}`);
        if (t.cn) lines.push(`  - ${t.cn}`);
      });
      lines.push(``);
    }
    if (paraSums.length) {
      lines.push(`## 各段概要 / Paragraph Summaries`, ``);
      paraSums.forEach((s, i) => {
        lines.push(`### P${i+1}`);
        if (s.en) lines.push(`- **EN:** ${s.en}`);
        if (s.cn) lines.push(`- **CN:** ${s.cn}`);
        lines.push(``);
      });
    }
    lines.push(`## 正文 / Body`, ``);
    enParas.forEach((p, i) => {
      lines.push(`### P${i+1} (EN)`);
      lines.push(p.textContent.trim());
      lines.push(``);
    });
    cnParas.forEach((p, i) => {
      lines.push(`### P${i+1} (CN)`);
      lines.push(p.textContent.trim());
      lines.push(``);
    });
    if (annotations.length) {
      lines.push(`## 笔记 / Annotations`, ``);
      annotations.forEach(a => {
        const where = a.source === 'cn'
          ? `第${a.paraIdx}段第${a.line}行`
          : `EN p${a.paraIdx} L${a.line}`;
        const typeLabel = a.type || (a.bucket === 'qtype' ? ((QTYPE_META[a.qtype] || {}).label || '题型') : 'note');
        lines.push(`- **${where}** [${typeLabel}] ${a.text}`);
        if (a.note) lines.push(`  - Note: ${a.note}`);
        if (a.context) lines.push(`  - Context: ${a.context}`);
      });
    }
    const md = lines.join('\n');
    downloadFile(`${title} - notes.md`, md, 'text/markdown;charset=utf-8');
    showTopToast('已导出');
  }
  function exportJson() {
    const data = {
      title: document.querySelector('.title-block h1:not(.cn)')?.textContent || '',
      cnTitle: document.querySelector('.title-block h1.cn')?.textContent || '',
      thesis: collectThesis(),
      paraSummaries: collectParaSums(),
      translation: translationData,
      annotations: annotations,
      exportedAt: new Date().toISOString(),
    };
    downloadFile(
      (data.title || 'article') + ' - notes.json',
      JSON.stringify(data, null, 2), 'application/json;charset=utf-8'
    );
    showTopToast('已导出');
  }
  // ===== FEATURE: 生词 CSV 导出（Anki / Excel 可直接导入）=====
  function csvField(s) {
    return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  }
  function exportVocabCsv() {
    const vocabs = annotations.filter(a => a.bucket === 'vocab');
    if (vocabs.length === 0) { showTopToast('本篇生词本为空，无可导出。'); return; }
    const sorted = vocabs.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const rows = [['word', 'meaning', 'context', 'article', 'date'].map(csvField).join(',')];
    sorted.forEach(a => {
      rows.push([
        a.text || '',
        a.note || '',
        a.context || '',
        getShortTitle(),
        fmtDate(a.createdAt)
      ].map(csvField).join(','));
    });
    // \ufeff BOM：让 Excel 正确识别 UTF-8 中文；\r\n：Anki/Excel 的通用行尾
    const csv = '\ufeff' + rows.join('\r\n');
    const name = 'vocab-' + backupStamp() + '.csv';
    downloadFile(name, csv, 'text/csv;charset=utf-8');
    showTopToast('已导出 ' + sorted.length + ' 个生词 → ' + name + '（Anki/Excel 可导入）');
  }
  function extractVocab() {
    const todayStr = fmtDate(new Date().toISOString());
    const vocabs = annotations.filter(a => a.bucket === 'vocab' && fmtDate(a.createdAt) === todayStr);
    if (vocabs.length === 0) {
      showToast('今天还没有记录新生词。');
      return;
    }
    const sorted = vocabs.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const lines = sorted.map(a => {
      const note = a.note ? a.note.trim() : '(待补充解释)';
      return `${a.text} → ${note}`;
    });
    const header = `📖 生词提取 — ${fmtDateLabel(todayStr + 'T12:00')} (${todayStr})\n共 ${vocabs.length} 个\n─────────────\n`;
    const text = header + lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(`已提取今天 ${vocabs.length} 个生词到剪贴板 ✓`);
      }).catch(() => fallbackCopy(text, vocabs.length));
    } else {
      fallbackCopy(text, vocabs.length);
    }
  }
  function fallbackCopy(text, count) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast(`已提取 ${count} 个生词到剪贴板 ✓`);
    } catch (e) {
      showToast('复制失败，请手动复制。');
    }
    document.body.removeChild(ta);
  }
  function showToast(msg) {
    let toast = document.getElementById('extract-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'extract-toast';
      toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;z-index:99999;opacity:0;transition:opacity .3s;pointer-events:none;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
  }
  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function resetAll() {
    if (!confirm('清空本篇所有数据（标注/概要/翻译/设置/阅读记录/句库/考试记录）？其他文章不受影响。')) return;
    const keys = [ANNO_KEY, SUM_KEY, TRANS_KEY, SETTINGS_KEY, READING_KEY,
      'syntax:' + articleId, 'wsj_reader:crossref:' + articleId];
    const slug = EXAM_SLUGS[articleId];
    if (slug) ['examhl:', 'examq:', 'examtimer:', 'examlimit:'].forEach(p => keys.push(p + slug));
    keys.forEach(k => localStorage.removeItem(k));
    showTopToast('已清空本篇数据');
    setTimeout(() => location.reload(), 600);
  }

  // ===== Exam prep: shared helpers =====
  function showTopToast(msg, ms) {
    let t = document.getElementById('exam-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'exam-toast';
      t.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 18px;border-radius:6px;font-size:13px;z-index:99999;opacity:0;transition:opacity .3s;pointer-events:none;font-family:-apple-system,sans-serif;max-width:80vw;text-align:center;white-space:pre-line;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, ms || 2000);
  }
  function getShortTitle() {
    const h1 = document.querySelector('.title-block h1:not(.cn)');
    let t = h1 ? h1.textContent.trim() : 'article';
    if (t.length > 40) t = t.slice(0, 40) + '…';
    return t;
  }

  // ===== Exam prep FEATURE 1: Question-type annotations =====
  const QTYPE_META = {
    detail:   { label: '🔍 细节', fields: [ { key: 'synonym', label: '同义替换：原文词 → 选项词' } ] },
    infer:    { label: '🔮 推理', fields: [ { key: 'inference', label: '推论' } ], hint: '⚠ 只推一步，超过一步 = 错误选项' },
    main:     { label: '🎯 主旨', fields: [ { key: 'scope', label: '范围检查' } ], hint: '检查：过大/过小/恰好覆盖' },
    attitude: { label: '💭 态度', fields: [ { key: 'emotion', label: '情感词依据' } ], hint: '永陪选项：indifferent / ambiguous / biased 通常不选', tones: ['positive', 'negative', 'neutral', 'objective'] },
    lexis:    { label: '📖 词义', fields: [ { key: 'clue', label: '上下文线索' }, { key: 'morph', label: '词根词缀' }, { key: 'verify', label: '代入验证' } ] },
    example:  { label: '📎 例证', fields: [ { key: 'thesis', label: '例子前后的论点' } ], hint: '答案不在例子里，在例子前后' },
  };
  const QTYPE_ORDER = ['detail', 'infer', 'main', 'attitude', 'lexis', 'example'];

  // Mastery levels (annotation-level field `mastery` on qtype annotations)
  const MASTERY_ORDER = ['unseen', 'wrong', 'review', 'mastered'];
  const MASTERY_LABELS = { unseen: '未做', wrong: '做错', review: '复习中', mastered: '已掌握' };
  // 复习排期（与 WSJ_Hub 的复习模式共用一套语义）：做错→1天、复习中→3天、
  // 已掌握→7天（已掌握再巩固→15天）。存 nextDue = 'YYYY-MM-DD'（本地日期）
  function localDateStr(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dueDateStr(days) { const d = new Date(); d.setDate(d.getDate() + days); return localDateStr(d); }
  function scheduleNextReview(a, next, prev) {
    if (next === 'unseen') { delete a.nextDue; return; }
    const days = next === 'wrong' ? 1 : (next === 'review' ? 3 : (prev === 'mastered' ? 15 : 7));
    a.nextDue = dueDateStr(days);
  }
  // Quick error-cause tags (qdata.errorTags)
  const ERROR_TAG_OPTIONS = ['定位错误', '同义替换没识别', '推理过度', '范围判断失误', '态度词不认识', '词义推断错误'];

  function annTags(a) { return Array.isArray(a.tags) ? a.tags : []; }
  // 标注文本搜索：命中词句 / 笔记 / 上下文 / 标签 任一处即通过
  function matchesNoteSearch(a) {
    if (!noteSearchQuery) return true;
    const hay = ((a.text || '') + '\n' + (a.note || '') + '\n' + (a.context || '') + '\n' + annTags(a).join(' ')).toLowerCase();
    return hay.indexOf(noteSearchQuery) >= 0;
  }
  // 三重过滤的共享谓词（标签 AND + 题型/掌握度 + 文本搜索），所有列出路径统一走这里
  function matchesAllFilters(a) {
    return matchesTagFilter(a) && matchesQFilter(a) && matchesNoteSearch(a);
  }
  // Tag filter: multi-select AND — annotation must carry every active tag
  function matchesTagFilter(a) {
    if (activeTagFilters.length === 0) return true;
    const tags = annTags(a);
    return activeTagFilters.every(t => tags.indexOf(t) >= 0);
  }
  // Qtype filters (type + mastery); non-qtype annotations always pass
  function matchesQFilter(a) {
    if (a.bucket !== 'qtype') return true;
    if (qTypeFilter !== 'all' && a.qtype !== qTypeFilter) return false;
    const m = a.mastery || 'unseen';
    if (qMasteryFilter === 'wrong') return m === 'wrong';
    if (qMasteryFilter === 'review') return m === 'wrong' || m === 'review';
    if (qMasteryFilter === 'mastered') return m === 'mastered';
    return true;
  }
  // Auto-compute qdata.isCorrect when both answers are present, else null
  function recomputeCorrect(qd) {
    qd.isCorrect = (qd.answer && qd.myAnswer) ? (qd.answer === qd.myAnswer) : null;
  }

  // ===== Annotation tag system (all buckets) =====
  function renderTagRow(a) {
    let html = '<div class="tag-row">';
    annTags(a).forEach(t => {
      html += `<span class="tag-chip tag-del">${esc(t)}<button type="button" data-id="${a.id}" data-tag-del="${esc(t)}" title="移除标签">✕</button></span>`;
    });
    html += `<button type="button" class="tag-chip tag-add" data-id="${a.id}" data-tag-add title="添加标签">+ 标签</button>`;
    html += '</div>';
    return html;
  }
  // Tag filter row above the notes list; shown only when tags exist.
  // scopeAnns = annotations of the current bucket view.
  function renderTagFilterRow(scopeAnns) {
    const present = {};
    scopeAnns.forEach(a => annTags(a).forEach(t => { present[t] = true; }));
    // Drop active filters whose tag no longer exists
    activeTagFilters = activeTagFilters.filter(t => present[t]);
    const tags = Object.keys(present).sort((x, y) => x.localeCompare(y, 'zh'));
    if (tags.length === 0) return '';
    let html = '<div class="tag-filter-row tag-filter-label"><span>🏷 标签</span>';
    tags.forEach(t => {
      html += `<button type="button" class="tag-filter-chip${activeTagFilters.indexOf(t) >= 0 ? ' active' : ''}" data-tag-filter="${esc(t)}">${esc(t)}</button>`;
    });
    if (activeTagFilters.length > 0) html += '<button type="button" class="tag-filter-clear" data-tag-filter-clear>清除</button>';
    html += '</div>';
    return html;
  }
  function addAnnotationTag(id, tag) {
    const a = annotations.find(x => x.id === id);
    if (!a) { renderNotes(); return; }
    if (!Array.isArray(a.tags)) a.tags = [];
    const clean = String(tag || '').trim();
    if (clean && a.tags.indexOf(clean) < 0) {
      a.tags.push(clean);
      saveAnnotations();
    }
    renderNotes();
  }
  function removeAnnotationTag(id, tag) {
    const a = annotations.find(x => x.id === id);
    if (!a || !Array.isArray(a.tags)) return;
    a.tags = a.tags.filter(t => t !== tag);
    saveAnnotations();
    renderNotes();
  }
  function wireTagInteractions(scope) {
    // "+ 标签" chip -> inline input (Enter/blur to add, Esc to cancel)
    scope.querySelectorAll('[data-tag-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tag-add-input';
        input.placeholder = '回车添加';
        btn.replaceWith(input);
        input.focus();
        let done = false;
        const commit = (cancel) => {
          if (done) return;
          done = true;
          const v = (input.value || '').trim();
          if (!cancel && v) addAnnotationTag(id, v);
          else renderNotes();
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(false); }
          else if (e.key === 'Escape') { e.preventDefault(); commit(true); }
        });
        input.addEventListener('blur', () => commit(false));
      });
    });
    // ✕ on a tag chip -> remove tag
    scope.querySelectorAll('[data-tag-del]').forEach(btn => {
      btn.addEventListener('click', () => removeAnnotationTag(btn.dataset.id, btn.dataset.tagDel));
    });
    // Filter chips: toggle multi-select AND
    scope.querySelectorAll('[data-tag-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tagFilter;
        const i = activeTagFilters.indexOf(t);
        if (i >= 0) activeTagFilters.splice(i, 1);
        else activeTagFilters.push(t);
        renderNotes();
      });
    });
    scope.querySelectorAll('[data-tag-filter-clear]').forEach(btn => {
      btn.addEventListener('click', () => { activeTagFilters = []; renderNotes(); });
    });
  }

  function addQtypeAnnotation(qtype, text, context, paraIdx) {
    if (!text || !text.trim()) return;
    const clean = text.trim();
    const dup = annotations.find(a => a.bucket === 'qtype' && a.qtype === qtype && a.text === clean);
    if (dup) {
      settings.showNotes = true; saveSettings();
      const sec = document.querySelector('.notes-section');
      if (sec) sec.classList.remove('collapsed');
      setNotesBucket('qtype');
      flashNote(dup.id);
      return;
    }
    const ann = {
      id: genId(),
      text: clean,
      bucket: 'qtype',
      qtype: qtype,
      note: '',
      qdata: {},
      mastery: 'unseen',
      tags: [],
      articleId: articleId,
      paraIdx: paraIdx || '',
      context: context || '',
      createdAt: new Date().toISOString()
    };
    annotations.push(ann);
    saveAnnotations();
    updateNoteCount();
    showTopToast('已标注');
    // Reveal it in the 题型 tab
    settings.showNotes = true; saveSettings();
    const sec = document.querySelector('.notes-section');
    if (sec) sec.classList.remove('collapsed');
    setNotesBucket('qtype');
  }

  function renderQtypeCard(a, meta) {
    const qd = a.qdata || {};
    const mastery = a.mastery || 'unseen';
    const LETTERS = ['A', 'B', 'C', 'D'];
    // Derived correctness (display); stored copy is refreshed on chip clicks
    const correct = (qd.answer && qd.myAnswer) ? (qd.answer === qd.myAnswer) : null;
    // --- Extended question fields (above type-specific fields) ---
    let topHtml = `
        <div class="qfield-row">
          <span class="qfield-label">题目</span>
          <div class="editable qfield" contenteditable="true" data-qid="${a.id}" data-qkey="question" data-placeholder="（题目文本）">${esc(qd.question || '')}</div>
        </div>
        <div class="qopts">` + LETTERS.map(L => `
          <div class="qopt-row">
            <span class="qopt-label">${L}.</span>
            <div class="editable qfield qopt-field" contenteditable="true" data-qid="${a.id}" data-qkey="opt${L}" data-placeholder="（选项 ${L}）">${esc(qd['opt' + L] || '')}</div>
          </div>`).join('') + `
        </div>
        <div class="qanswer-row">
          <span class="qfield-label">正确答案</span>
          <span class="qchip-group">` + LETTERS.map(L =>
            `<button type="button" class="qletter-chip${qd.answer === L ? ' active' : ''}" data-qid="${a.id}" data-qanswer="${L}" title="正确答案 ${L}">${L}</button>`).join('') + `</span>
          <span class="qfield-label">我的答案</span>
          <span class="qchip-group">` + LETTERS.map(L => {
            const sel = qd.myAnswer === L;
            const cls = sel ? ' active' + (correct !== null ? (correct ? ' correct' : ' wrong') : '') : '';
            return `<button type="button" class="qletter-chip${cls}" data-qid="${a.id}" data-qmyanswer="${L}" title="我的答案 ${L}">${L}</button>`;
          }).join('') + `</span>
          ${correct === true ? '<span class="qresult-badge ok" title="答对了">✓</span>' : (correct === false ? '<span class="qresult-badge bad" title="答错了">✗</span>' : '')}
        </div>
        <div class="qmastery-row">
          <span class="qfield-label">掌握状态</span>
          <button type="button" class="mastery-badge mastery-${mastery}" data-qmastery="${a.id}" title="点击切换：未做 → 做错 → 复习中 → 已掌握">${MASTERY_LABELS[mastery] || '未做'}</button>
        </div>
        <div class="qerrtags-row">` + ERROR_TAG_OPTIONS.map(t => {
          const on = Array.isArray(qd.errorTags) && qd.errorTags.indexOf(t) >= 0;
          return `<button type="button" class="qetag-chip${on ? ' active' : ''}" data-qid="${a.id}" data-etag="${esc(t)}">${esc(t)}</button>`;
        }).join('') + `</div>
        <div class="qfield-row">
          <span class="qfield-label">错因分析</span>
          <div class="editable qfield" contenteditable="true" data-qid="${a.id}" data-qkey="errorReason" data-placeholder="（错因分析）">${esc(qd.errorReason || '')}</div>
        </div>
        <div class="qfield-row">
          <span class="qfield-label">原文依据句</span>
          <div class="editable qfield" contenteditable="true" data-qid="${a.id}" data-qkey="answerSentence" data-placeholder="（原文依据句）">${esc(qd.answerSentence || '')}</div>
        </div>
        <div class="qsolving${openSolvingSet.has(a.id) ? ' open' : ''}">
          <button type="button" class="qsolving-toggle" data-qsolving-toggle="${a.id}">💡 解题思路 ${openSolvingSet.has(a.id) ? '▴' : '▾'}</button>
          <div class="qsolving-body">
            <div class="editable qfield" contenteditable="true" data-qid="${a.id}" data-qkey="solving" data-placeholder="（解题思路）">${esc(qd.solving || '')}</div>
          </div>
        </div>`;
    // --- Existing type-specific fields ---
    let fieldsHtml = '';
    if (meta.tones) {
      fieldsHtml += '<div class="qtone-row">' + meta.tones.map(t =>
        `<button type="button" class="qtone-chip ${qd.tone === t ? 'active' : ''}" data-qid="${a.id}" data-qtone="${t}">${t}</button>`
      ).join('') + '</div>';
    }
    meta.fields.forEach(f => {
      fieldsHtml += `
        <div class="qfield-row">
          <span class="qfield-label">${f.label}</span>
          <div class="editable qfield" contenteditable="true" data-qid="${a.id}" data-qkey="${f.key}" data-placeholder="（填写）">${esc(qd[f.key] || '')}</div>
        </div>`;
    });
    if (meta.hint) fieldsHtml += `<div class="qhint">${esc(meta.hint)}</div>`;
    return `
      <div class="note-card qtype-card" data-id="${a.id}">
        <button class="del-btn" data-del="${a.id}" title="删除">×</button>
        <button class="qjump-btn" data-qjump="${esc(a.paraIdx || '')}" title="跳转到原文段落">↩ 定位</button>
        <span class="badge badge-qtype">${meta.label}</span>
        <span class="note-time-stamp">${fmtTimeHM(a.createdAt)}</span>
        <div class="qtype-text" data-qjump="${esc(a.paraIdx || '')}" title="点击定位原文">${esc(a.text)}</div>
        ${a.context ? `<div class="qtype-context">${esc(a.context)}</div>` : ''}
        <div class="qtype-fields">${topHtml}${fieldsHtml}</div>
        ${renderTagRow(a)}
      </div>`;
  }

  function renderQtypeFilterRow(qanns) {
    // Prune a stale type filter (that type no longer has any items)
    if (qTypeFilter !== 'all' && !qanns.some(a => a.qtype === qTypeFilter)) qTypeFilter = 'all';
    const mChips = [
      { key: 'all', label: '全部' },
      { key: 'wrong', label: '✗ 做错' },
      { key: 'review', label: '待复习' },
      { key: 'mastered', label: '已掌握' },
    ];
    let html = '<div class="qfilter-row">';
    mChips.forEach(c => {
      html += `<button type="button" class="qfilter-chip${qMasteryFilter === c.key ? ' active' : ''}" data-qmfilter="${c.key}">${c.label}</button>`;
    });
    html += '<span class="qfilter-sep"></span>';
    html += `<button type="button" class="qfilter-chip${qTypeFilter === 'all' ? ' active' : ''}" data-qtfilter="all">全部类型</button>`;
    QTYPE_ORDER.forEach(t => {
      if (!qanns.some(a => a.qtype === t)) return;
      html += `<button type="button" class="qfilter-chip${qTypeFilter === t ? ' active' : ''}" data-qtfilter="${t}">${QTYPE_META[t].label}</button>`;
    });
    html += '</div>';
    return html;
  }

  function renderQtypeList() {
    const qanns = annotations.filter(a => a.bucket === 'qtype');
    if (qanns.length === 0) {
      return '<div class="empty-hint">题型本还是空的。<br><br>选中文本 → 🎓 题型 → 选一个类型，<br>标注会出现在这里。</div>';
    }
    let html = '<div class="qtype-toolbar qtype-export"><button data-export-qtype>⬇ 导出错题本</button></div>';
    html += renderQtypeFilterRow(qanns);
    html += renderTagFilterRow(qanns);
    // Combine both filter dimensions (mastery/type + tags + text search)
    const visible = qanns.filter(matchesAllFilters);
    if (visible.length === 0) {
      html += '<div class="empty-hint">没有符合当前筛选条件的题目。<br>调整上方筛选即可恢复。</div>';
      return html;
    }
    QTYPE_ORDER.forEach(type => {
      const items = visible.filter(a => a.qtype === type).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      if (items.length === 0) return;
      const meta = QTYPE_META[type];
      html += `<div class="qtype-group qtype-group-title qtype-group-count"><div>${meta.label}<span>${items.length} 题</span></div>`;
      html += items.map(a => renderQtypeCard(a, meta)).join('');
      html += '</div>';
    });
    return html;
  }

  function wireQtypeInteractions(scope) {
    // Editable qfields -> annotation.qdata[key]
    scope.querySelectorAll('.qfield').forEach(el => {
      el.addEventListener('input', () => {
        const ann = annotations.find(x => x.id === el.dataset.qid);
        if (ann) {
          if (!ann.qdata) ann.qdata = {};
          ann.qdata[el.dataset.qkey] = el.textContent.trim();
          saveAnnotations();
        }
      });
      el.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\s+/g, ' ').trim();
        document.execCommand('insertText', false, text);
      });
    });
    // Attitude tone chips -> annotation.qdata.tone (toggle)
    scope.querySelectorAll('[data-qtone]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ann = annotations.find(x => x.id === btn.dataset.qid);
        if (!ann) return;
        if (!ann.qdata) ann.qdata = {};
        const t = btn.dataset.qtone;
        ann.qdata.tone = (ann.qdata.tone === t) ? '' : t;
        saveAnnotations();
        const card = btn.closest('.note-card');
        if (card) card.querySelectorAll('[data-qtone]').forEach(b => b.classList.toggle('active', b.dataset.qtone === ann.qdata.tone));
      });
    });
    // Jump-to-paragraph buttons
    scope.querySelectorAll('[data-qjump]').forEach(el => {
      el.addEventListener('click', () => { if (el.dataset.qjump) jumpToParagraph(el.dataset.qjump); });
    });
    // 正确答案 chips -> qdata.answer (click active chip again to clear)
    scope.querySelectorAll('[data-qanswer]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ann = annotations.find(x => x.id === btn.dataset.qid);
        if (!ann) return;
        if (!ann.qdata) ann.qdata = {};
        const L = btn.dataset.qanswer;
        ann.qdata.answer = (ann.qdata.answer === L) ? '' : L;
        recomputeCorrect(ann.qdata);
        saveAnnotations();
        renderNotes();
      });
    });
    // 我的答案 chips -> qdata.myAnswer + auto isCorrect + auto mastery
    scope.querySelectorAll('[data-qmyanswer]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ann = annotations.find(x => x.id === btn.dataset.qid);
        if (!ann) return;
        if (!ann.qdata) ann.qdata = {};
        const L = btn.dataset.qmyanswer;
        ann.qdata.myAnswer = (ann.qdata.myAnswer === L) ? '' : L;
        recomputeCorrect(ann.qdata);
        // Wrong answer auto-marks mastery as 'wrong' while still 'unseen'
        if (ann.qdata.isCorrect === false && (ann.mastery || 'unseen') === 'unseen') {
          ann.mastery = 'wrong';
          scheduleNextReview(ann, 'wrong', 'unseen');
        }
        saveAnnotations();
        renderNotes();
      });
    });
    // Mastery badge: cycle unseen → wrong → review → mastered → unseen
    scope.querySelectorAll('[data-qmastery]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ann = annotations.find(x => x.id === btn.dataset.qmastery);
        if (!ann) return;
        const prev = ann.mastery || 'unseen';
        const next = MASTERY_ORDER[(MASTERY_ORDER.indexOf(prev) + 1) % MASTERY_ORDER.length];
        if (next === 'unseen') delete ann.mastery; else ann.mastery = next;
        scheduleNextReview(ann, next, prev);
        saveAnnotations();
        renderNotes();
      });
    });
    // 错因快标 chips -> qdata.errorTags (toggle in place, no re-render)
    scope.querySelectorAll('[data-etag]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ann = annotations.find(x => x.id === btn.dataset.qid);
        if (!ann) return;
        if (!ann.qdata) ann.qdata = {};
        if (!Array.isArray(ann.qdata.errorTags)) ann.qdata.errorTags = [];
        const t = btn.dataset.etag;
        const i = ann.qdata.errorTags.indexOf(t);
        if (i >= 0) ann.qdata.errorTags.splice(i, 1);
        else ann.qdata.errorTags.push(t);
        btn.classList.toggle('active', i < 0);
        saveAnnotations();
      });
    });
    // 💡 解题思路 collapsible (in-place toggle; state survives re-renders)
    scope.querySelectorAll('[data-qsolving-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.qsolvingToggle;
        const sec = btn.closest('.qsolving');
        if (!sec) return;
        const open = sec.classList.toggle('open');
        if (open) openSolvingSet.add(id); else openSolvingSet.delete(id);
        btn.textContent = open ? '💡 解题思路 ▴' : '💡 解题思路 ▾';
      });
    });
    // Filter chips: mastery + type (combined dimensions)
    scope.querySelectorAll('[data-qmfilter]').forEach(btn => {
      btn.addEventListener('click', () => { qMasteryFilter = btn.dataset.qmfilter; renderNotes(); });
    });
    scope.querySelectorAll('[data-qtfilter]').forEach(btn => {
      btn.addEventListener('click', () => { qTypeFilter = btn.dataset.qtfilter; renderNotes(); });
    });
    // Export 错题本
    scope.querySelectorAll('[data-export-qtype]').forEach(btn => {
      btn.addEventListener('click', exportQtype);
    });
    // Annotation tags on qtype cards
    wireTagInteractions(scope);
  }

  function alertFallback(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) { showTopToast('已复制到剪贴板 ✓'); return; }
    } catch (e) {}
    alert(text);
  }
  function copyTextWithFallback(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => showTopToast('已复制到剪贴板 ✓'))
        .catch(() => alertFallback(text));
    } else {
      alertFallback(text);
    }
  }

  function exportQtype() {
    const qanns = annotations.filter(a => a.bucket === 'qtype');
    if (qanns.length === 0) { showTopToast('题型本为空，无可导出。'); return; }
    const lines = [];
    lines.push(`🎓 错题本 — ${getShortTitle()}`);
    lines.push(`导出时间：${new Date().toLocaleString()}`);
    lines.push(`共 ${qanns.length} 题`);
    lines.push('─────────────');
    QTYPE_ORDER.forEach(type => {
      const items = qanns.filter(a => a.qtype === type).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      if (items.length === 0) return;
      lines.push('');
      lines.push(`【${QTYPE_META[type].label}】`);
      items.forEach((a, i) => {
        const qd = a.qdata || {};
        lines.push(`  ${i + 1}. 原文：${a.text}`);
        if (qd.question) lines.push(`     题目：${qd.question}`);
        ['A', 'B', 'C', 'D'].forEach(L => {
          if (qd['opt' + L]) lines.push(`       ${L}. ${qd['opt' + L]}`);
        });
        if (qd.answer) lines.push(`     正确答案：${qd.answer}`);
        if (qd.myAnswer) {
          const ok = (qd.answer && qd.myAnswer) ? (qd.answer === qd.myAnswer) : null;
          const mark = ok === true ? ' ✓' : (ok === false ? ' ✗' : '');
          lines.push(`     我的答案：${qd.myAnswer}${mark}`);
        }
        if (a.mastery && a.mastery !== 'unseen') lines.push(`     掌握状态：${MASTERY_LABELS[a.mastery] || a.mastery}`);
        if (Array.isArray(qd.errorTags) && qd.errorTags.length > 0) lines.push(`     错因快标：${qd.errorTags.join('、')}`);
        if (qd.errorReason) lines.push(`     错因分析：${qd.errorReason}`);
        if (qd.answerSentence) lines.push(`     原文依据句：${qd.answerSentence}`);
        if (qd.solving) lines.push(`     解题思路：${qd.solving}`);
        if (a.context) lines.push(`     上下文：${a.context}`);
        if (a.qtype === 'attitude' && qd.tone) lines.push(`     态度：${qd.tone}`);
        QTYPE_META[type].fields.forEach(f => {
          if (qd[f.key]) lines.push(`     ${f.label}：${qd[f.key]}`);
        });
        if (Array.isArray(a.tags) && a.tags.length > 0) lines.push(`     标签：${a.tags.join('、')}`);
      });
    });
    copyTextWithFallback(lines.join('\n'));
  }

  // ===== Exam prep FEATURE 2: Sentence syntax analysis =====
  function openSyntaxPanel(text) {
    const panel = document.getElementById('syntax-panel');
    if (!panel) return;
    document.getElementById('syntax-text').textContent = text || '';
    document.getElementById('syntax-note').value = '';
    resetStructRows();
    panel.classList.add('visible');
  }
  function closeSyntaxPanel() {
    const panel = document.getElementById('syntax-panel');
    if (panel) panel.classList.remove('visible');
  }
  function findAncestorStag(node, tag, container) {
    let n = node;
    while (n && n !== container) {
      if (n.nodeType === 1 && n.tagName === 'SPAN' && n.dataset && n.dataset.stag === tag) return n;
      n = n.parentNode;
    }
    return null;
  }
  function unwrapStagSpan(span) {
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    if (parent.normalize) parent.normalize();
  }
  function applyStag(tag) {
    const container = document.getElementById('syntax-text');
    if (!container) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;
    // Toggle off if the selection already sits inside a same-tag span
    const existing = findAncestorStag(range.startContainer, tag, container) || findAncestorStag(range.endContainer, tag, container);
    if (existing) {
      unwrapStagSpan(existing);
      sel.removeAllRanges();
      return;
    }
    const span = document.createElement('span');
    span.className = 's-' + tag;
    span.dataset.stag = tag;
    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
    } catch (e) {
      try { range.surroundContents(span); } catch (e2) {}
    }
    sel.removeAllRanges();
  }
  function saveSyntax() {
    const textEl = document.getElementById('syntax-text');
    const noteEl = document.getElementById('syntax-note');
    if (!textEl) return;
    const plain = (textEl.textContent || '').trim();
    if (!plain) { showTopToast('没有可保存的句子。'); return; }
    const key = 'syntax:' + articleId;
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(key)) || []; } catch (e) { arr = []; }
    arr.push({ id: genId(), text: plain, html: textEl.innerHTML, note: noteEl.value.trim(), structure: collectStructRows(), createdAt: new Date().toISOString() });
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
    closeSyntaxPanel();
    showTopToast('已存入句库');
  }
  function setupSyntaxPanel() {
    document.querySelectorAll('.syntax-tags button[data-stag]').forEach(btn => {
      // Keep the selection inside #syntax-text from collapsing when the button gains focus
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => applyStag(btn.dataset.stag));
    });
  }

  // ===== Clause / S-V-O structure rows inside the syntax panel =====
  const CLAUSE_TYPES = [
    ['main', '主句'], ['subject', '主语从句'], ['object', '宾语从句'], ['predicative', '表语从句'],
    ['attributive', '定语从句'], ['adverbial', '状语从句'], ['appositive', '同位语从句'],
    ['nonfinite', '非谓语结构'], ['parenthetical', '插入语/其他']
  ];
  const SUBJ_FORMS = ['名词/名词短语', '从句', '动名词/不定式', '形式主语 it', '省略'];
  const OBJ_FORMS = ['无', '名词/名词短语', '从句', '动名词/不定式'];
  const TENSES = ['一般现在时', '一般过去时', '一般将来时', '现在完成时', '过去完成时', '现在进行时', '过去进行时', '情态动词+原形', '被动语态', '虚拟语气', '其他'];
  function structOptions(arr, sel) {
    return arr.map(o => '<option' + (o === sel ? ' selected' : '') + '>' + o + '</option>').join('');
  }
  function upgradeSyntaxPanel() {
    const panel = document.getElementById('syntax-panel');
    if (!panel || panel.dataset.structReady) return;
    panel.dataset.structReady = '1';
    const noteRow = panel.querySelector('.syntax-note-row');
    const sec = document.createElement('div');
    sec.className = 'syntax-struct';
    sec.innerHTML =
      '<div class="syntax-struct-head"><span>🏗 成分结构（从句拆分 + 主谓宾）</span>' +
      '<button type="button" id="syntax-add-row">＋ 添加从句/分句</button></div>' +
      '<div id="syntax-rows"></div>';
    if (noteRow) noteRow.insertAdjacentElement('afterend', sec);
    else panel.appendChild(sec);
    const addBtn = document.getElementById('syntax-add-row');
    addBtn.addEventListener('mousedown', (e) => e.preventDefault());
    addBtn.addEventListener('click', () => addStructRow());
    document.getElementById('syntax-rows').addEventListener('click', (e) => {
      const del = e.target && e.target.closest ? e.target.closest('[data-del-row]') : null;
      if (del) del.closest('.syntax-row').remove();
    });
  }
  function addStructRow(preset) {
    const rows = document.getElementById('syntax-rows');
    if (!rows) return;
    preset = preset || {};
    const row = document.createElement('div');
    row.className = 'syntax-row';
    row.innerHTML =
      '<div class="syntax-row-line">' +
      '<select data-sfield="ctype" title="分句/从句类型">' +
      CLAUSE_TYPES.map(c => '<option value="' + c[0] + '"' + (preset.ctype === c[0] ? ' selected' : '') + '>' + c[1] + '</option>').join('') +
      '</select>' +
      '<button type="button" class="syntax-row-del" data-del-row="1" title="删除这一分句">✕</button>' +
      '</div>' +
      '<div class="syntax-row-grid">' +
      '<label>主语<input type="text" data-sfield="subject" placeholder="主语内容…">' +
      '<select data-sfield="subjectForm">' + structOptions(SUBJ_FORMS, preset.subjectForm) + '</select></label>' +
      '<label>谓语<input type="text" data-sfield="predicate" placeholder="谓语动词…">' +
      '<select data-sfield="tense">' + structOptions(TENSES, preset.tense) + '</select></label>' +
      '<label>宾语<input type="text" data-sfield="object" placeholder="宾语内容…">' +
      '<select data-sfield="objectForm">' + structOptions(OBJ_FORMS, preset.objectForm) + '</select></label>' +
      '<label>补语/状语/备注<input type="text" data-sfield="extra" placeholder="其余成分或备注…"></label>' +
      '</div>';
    ['subject', 'predicate', 'object', 'extra'].forEach(f => {
      if (preset[f]) { const el = row.querySelector('[data-sfield="' + f + '"]'); if (el) el.value = preset[f]; }
    });
    rows.appendChild(row);
  }
  function collectStructRows() {
    const out = [];
    document.querySelectorAll('#syntax-rows .syntax-row').forEach(row => {
      const get = f => { const el = row.querySelector('[data-sfield="' + f + '"]'); return el ? el.value.trim() : ''; };
      const r = {
        ctype: get('ctype'), subject: get('subject'), subjectForm: get('subjectForm'),
        predicate: get('predicate'), tense: get('tense'),
        object: get('object'), objectForm: get('objectForm'), extra: get('extra')
      };
      if (r.subject || r.predicate || r.object || r.extra) out.push(r);
    });
    return out;
  }
  function resetStructRows() {
    const rows = document.getElementById('syntax-rows');
    if (rows) rows.innerHTML = '';
    addStructRow();
  }

  // ===== Exam prep FEATURE 3: Writing material collection (M-A type system) =====
  const MATERIAL_TYPES = [
    { type: 'fact',     label: '📋事实' },
    { type: 'quote',    label: '💬道理' },
    { type: 'data',     label: '📊数据' },
    { type: 'contrast', label: '⚖对比' },
    { type: 'golden',   label: '✨金句' },
  ];
  const MATERIAL_TYPE_FIELDS = {
    fact:     [ { key: 'person', label: '人物/事件' }, { key: 'cause', label: '起因' }, { key: 'process', label: '经过' }, { key: 'develop', label: '发展/结果' } ],
    quote:    [ { key: 'quote', label: '原文引用' }, { key: 'source', label: '出处' }, { key: 'viewpoint', label: '核心观点' } ],
    data:     [ { key: 'dsource', label: '数据来源' }, { key: 'number', label: '关键数字' }, { key: 'trend', label: '趋势描述' } ],
    contrast: [ { key: 'pro', label: '正方' }, { key: 'con', label: '反方' }, { key: 'dimension', label: '对比维度' } ],
    golden:   [ { key: 'original', label: '原文' }, { key: 'translation', label: '翻译' }, { key: 'author', label: '作者' } ],
  };
  let materialType = 'fact';

  // Build the extended form inside the existing #material-panel without touching
  // the article HTML: inject the type selector + type-specific groups, reuse the
  // legacy inputs (topic/cause/process/develop), and repurpose 写作逻辑 as 论证模板.
  function upgradeMaterialPanel() {
    const panel = document.getElementById('material-panel');
    if (!panel || panel.dataset.upgraded) return;
    panel.dataset.upgraded = '1';
    const actions = panel.querySelector('.syntax-actions');
    const insertPt = (el) => { if (actions) panel.insertBefore(el, actions); else panel.appendChild(el); };
    // 1. Type selector row (below the source text)
    const row = document.createElement('div');
    row.className = 'material-type-row';
    MATERIAL_TYPES.forEach(mt => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'material-type-btn' + (mt.type === materialType ? ' active' : '');
      b.dataset.mtype = mt.type;
      b.textContent = mt.label;
      b.addEventListener('click', () => setMaterialType(mt.type));
      row.appendChild(b);
    });
    const sourceEl = panel.querySelector('.material-source');
    if (sourceEl) sourceEl.insertAdjacentElement('afterend', row);
    else panel.insertBefore(row, panel.firstChild);
    // 2. Type-specific groups — all inputs exist in the DOM; visibility toggles
    const reusedIds = { cause: 'material-cause', process: 'material-process', develop: 'material-develop' };
    MATERIAL_TYPES.forEach(mt => {
      const group = document.createElement('div');
      group.className = 'material-type-group';
      group.dataset.mtypeGroup = mt.type;
      MATERIAL_TYPE_FIELDS[mt.type].forEach(f => {
        let wrap = null;
        if (reusedIds[f.key]) {
          const legacy = document.getElementById(reusedIds[f.key]);
          wrap = legacy ? legacy.closest('.material-field') : null;
          if (legacy) { legacy.dataset.mfield = f.key; legacy.placeholder = f.label + '…'; }
        }
        if (!wrap) {
          wrap = document.createElement('div');
          wrap.className = 'material-field';
          const label = document.createElement('label');
          label.textContent = f.label;
          const input = document.createElement('input');
          input.type = 'text';
          input.id = 'mf-' + f.key;
          input.dataset.mfield = f.key;
          input.placeholder = f.label + '…';
          wrap.appendChild(label);
          wrap.appendChild(input);
        }
        group.appendChild(wrap);
      });
      insertPt(group);
    });
    // 3. Common fields: 主题标签 (existing datalist input, multi-tag), 用法, 论证模板
    const topicInput = document.getElementById('material-topic');
    const topicWrap = topicInput ? topicInput.closest('.material-field') : null;
    if (topicWrap) {
      topicInput.placeholder = '主题标签（逗号分隔多个）';
      insertPt(topicWrap);
    }
    const usageWrap = document.createElement('div');
    usageWrap.className = 'material-field';
    const usageLabel = document.createElement('label');
    usageLabel.textContent = '用法';
    const usageInput = document.createElement('input');
    usageInput.type = 'text';
    usageInput.id = 'material-usage';
    usageInput.placeholder = '用法：可以论证什么观点…';
    usageWrap.appendChild(usageLabel);
    usageWrap.appendChild(usageInput);
    insertPt(usageWrap);
    // Repurpose legacy 写作逻辑 input as 论证模板 textarea
    const logicInput = document.getElementById('material-logic');
    if (logicInput) {
      const logicWrap = logicInput.closest('.material-field');
      const label = logicWrap ? logicWrap.querySelector('label') : null;
      if (label) { label.textContent = '论证模板'; label.setAttribute('for', 'material-template'); }
      const ta = document.createElement('textarea');
      ta.id = 'material-template';
      ta.dataset.mfield = 'template';
      ta.rows = 2;
      ta.placeholder = '论证模板…';
      logicInput.replaceWith(ta);
      if (logicWrap) insertPt(logicWrap);
    }
    setMaterialType(materialType);
  }
  function setMaterialType(t) {
    materialType = t;
    const panel = document.getElementById('material-panel');
    if (!panel) return;
    panel.querySelectorAll('.material-type-btn').forEach(b => b.classList.toggle('active', b.dataset.mtype === t));
    panel.querySelectorAll('.material-type-group').forEach(g => { g.style.display = (g.dataset.mtypeGroup === t) ? '' : 'none'; });
  }
  function openMaterialPanel(text) {
    const panel = document.getElementById('material-panel');
    if (!panel) return;
    document.getElementById('material-source').textContent = text || '';
    panel.querySelectorAll('input, textarea').forEach(el => { el.value = ''; });
    setMaterialType('fact'); // default type
    panel.classList.add('visible');
  }
  function closeMaterialPanel() {
    const panel = document.getElementById('material-panel');
    if (panel) panel.classList.remove('visible');
  }
  // "科技伦理, 社会问题" / "科技伦理，社会问题" / single tag → canonical comma list
  function normalizeTopicTags(s) {
    return String(s || '').split(/[,，]/).map(t => t.trim()).filter(Boolean).join(',');
  }
  function saveMaterial() {
    const sourceText = (document.getElementById('material-source').textContent || '').trim();
    const key = 'wsj_writing:materials';
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(key)) || []; } catch (e) { arr = []; }
    const topicEl = document.getElementById('material-topic');
    const item = {
      id: genId(),
      sourceText: sourceText,
      articleId: articleId,
      materialType: materialType,
      topic: normalizeTopicTags(topicEl ? topicEl.value : ''),
      usedCount: 0,
      lastUsedAt: null,
      createdAt: new Date().toISOString()
    };
    // Only store the filled fields of the selected type
    (MATERIAL_TYPE_FIELDS[materialType] || []).forEach(f => {
      const el = document.querySelector('#material-panel [data-mfield="' + f.key + '"]');
      const v = el ? el.value.trim() : '';
      if (v) item[f.key] = v;
    });
    const usageEl = document.getElementById('material-usage');
    if (usageEl && usageEl.value.trim()) item.usage = usageEl.value.trim();
    const tplEl = document.getElementById('material-template');
    if (tplEl && tplEl.value.trim()) item.template = tplEl.value.trim();
    arr.push(item);
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
    closeMaterialPanel();
    showTopToast('素材已保存');
  }

  // ===== Exam prep FEATURE 4: Word root recording =====
  function recordRoot(text) {
    if (!text || !text.trim()) return;
    const key = 'wsj_roots:cards';
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(key)) || []; } catch (e) { arr = []; }
    arr.push({
      id: genId(),
      root: text.trim(),
      meaning: '',
      examples: '',
      source: getShortTitle(),
      createdAt: new Date().toISOString()
    });
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
    showTopToast('已记入词根库');
  }

  // ===== Word root / affix panel (fill meanings while reading) =====
  const ROOT_KIND_LABELS = { root: '词根', prefix: '前缀', suffix: '后缀', word: '整词' };
  function openRootPanel(text) {
    const panel = document.getElementById('root-panel');
    if (!panel) return;
    const hint = document.getElementById('root-hint');
    if (hint) hint.textContent = text && text.trim() ? '选中内容：' + text.trim() : '';
    document.getElementById('root-word').value = (text || '').trim();
    document.getElementById('root-kind').value = 'root';
    document.getElementById('root-meaning').value = '';
    document.getElementById('root-examples').value = '';
    panel.dataset.editId = '';
    panel.classList.add('visible');
    setTimeout(() => document.getElementById('root-meaning').focus(), 60);
  }
  function closeRootPanel() {
    const panel = document.getElementById('root-panel');
    if (panel) panel.classList.remove('visible');
  }
  function saveRootCard(keepOpen) {
    const panel = document.getElementById('root-panel');
    if (!panel) return;
    const rootEl = document.getElementById('root-word');
    const root = (rootEl.value || '').trim();
    if (!root) { showTopToast('请先填写词根 / 词缀。'); rootEl.focus(); return; }
    const kind = document.getElementById('root-kind').value || 'root';
    const meaning = document.getElementById('root-meaning').value.trim();
    const examples = document.getElementById('root-examples').value.trim();
    const key = 'wsj_roots:cards';
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(key)) || []; } catch (e) { arr = []; }
    const norm = root.toLowerCase();
    let card = arr.find(c => String(c.root || '').trim().toLowerCase() === norm);
    if (card) {
      if (meaning) card.meaning = meaning;
      if (examples) card.examples = card.examples ? card.examples + ', ' + examples : examples;
      if (kind && kind !== 'word') card.kind = kind;
      if (!card.source) card.source = getShortTitle();
      showTopToast('已更新已有词卡：' + root);
    } else {
      arr.push({
        id: genId(), root: root, kind: kind, meaning: meaning, examples: examples,
        source: getShortTitle(), createdAt: new Date().toISOString()
      });
      showTopToast('已记入词根库：' + root);
    }
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
    if (keepOpen) {
      document.getElementById('root-word').value = '';
      document.getElementById('root-meaning').value = '';
      document.getElementById('root-examples').value = '';
      rootEl.focus();
    } else {
      closeRootPanel();
    }
  }

  // ===== Advice-composition accumulation (whole-article level) =====
  const COMPOSE_KEY = 'wsj_writing:advice';
  function getCompositions() {
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(COMPOSE_KEY)) || []; } catch (e) { arr = []; }
    return arr;
  }
  function saveCompositions(arr) {
    try { localStorage.setItem(COMPOSE_KEY, JSON.stringify(arr)); } catch (e) {}
  }
  function openComposePanel() {
    const panel = document.getElementById('compose-panel');
    if (!panel) return;
    renderComposeList();
    panel.classList.add('visible');
  }
  function closeComposePanel() {
    flushComposeEdits();
    const panel = document.getElementById('compose-panel');
    if (panel) panel.classList.remove('visible');
  }
  function addComposeEntry() {
    flushComposeEdits();
    const arr = getCompositions();
    arr.push({
      id: genId(), articleId: articleId, articleTitle: getShortTitle(),
      theme: '', point: '', advice: '', argue: '',
      createdAt: new Date().toISOString()
    });
    saveCompositions(arr);
    renderComposeList();
    const list = document.getElementById('compose-list');
    if (list && list.lastElementChild) list.lastElementChild.scrollIntoView({ block: 'nearest' });
  }
  function flushComposeEdits() {
    const list = document.getElementById('compose-list');
    if (!list || !list.dataset.dirty) return;
    const arr = getCompositions();
    list.querySelectorAll('.compose-card').forEach(card => {
      const item = arr.find(x => x.id === card.dataset.cid);
      if (!item) return;
      item.theme = card.querySelector('[data-cfield="theme"]').value.trim();
      item.point = card.querySelector('[data-cfield="point"]').value.trim();
      item.advice = card.querySelector('[data-cfield="advice"]').value.trim();
      item.argue = card.querySelector('[data-cfield="argue"]').value.trim();
      item.updatedAt = new Date().toISOString();
    });
    saveCompositions(arr);
    list.dataset.dirty = '';
  }
  function deleteComposeEntry(id) {
    const arr = getCompositions().filter(x => x.id !== id);
    saveCompositions(arr);
    renderComposeList();
    showTopToast('已删除建议文条目');
  }
  function renderComposeList() {
    const list = document.getElementById('compose-list');
    if (!list) return;
    flushComposeEdits();
    const mine = getCompositions().filter(x => x.articleId === articleId);
    if (mine.length === 0) {
      list.innerHTML = '<div class="compose-empty">本文还没有建议文条目。点下方"＋ 新增条目"开始积累论点、建议与论述。</div>';
      return;
    }
    list.innerHTML = mine.map((item, i) =>
      '<div class="compose-card" data-cid="' + item.id + '">' +
      '<div class="compose-card-head"><span class="compose-idx">条目 ' + (i + 1) + '</span>' +
      '<button type="button" class="compose-del" data-del="' + item.id + '" title="删除条目">✕</button></div>' +
      '<div class="material-field"><label>主题</label><textarea rows="1" data-cfield="theme" placeholder="建议文主题，如：个人环保行动">' + esc(item.theme) + '</textarea></div>' +
      '<div class="material-field"><label>论点</label><textarea rows="2" data-cfield="point" placeholder="核心论点…">' + esc(item.point) + '</textarea></div>' +
      '<div class="material-field"><label>建议</label><textarea rows="2" data-cfield="advice" placeholder="具体建议…">' + esc(item.advice) + '</textarea></div>' +
      '<div class="material-field"><label>相关论述</label><textarea rows="3" data-cfield="argue" placeholder="支撑论述、可套用的表达…">' + esc(item.argue) + '</textarea></div>' +
      '</div>'
    ).join('');
    list.querySelectorAll('.compose-del').forEach(btn => {
      btn.addEventListener('click', () => { flushComposeEdits(); deleteComposeEntry(btn.dataset.del); });
    });
    list.querySelectorAll('.compose-card textarea').forEach(ta => {
      ta.addEventListener('input', () => { list.dataset.dirty = '1'; });
      ta.addEventListener('blur', () => flushComposeEdits());
    });
  }

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
  function ensureWordFreq(cb) {
    if (window.__WORD_FREQ__) { cb(); return; }
    const s = document.createElement('script');
    s.src = 'wordfreq.js';
    s.onload = cb;
    s.onerror = () => showTopToast('词频数据加载失败（缺少 wordfreq.js）');
    document.head.appendChild(s);
  }
  function freqModeOn() { return localStorage.getItem(FREQ_MODE_KEY) === '1'; }
  function applyFreqColoring() {
    const sets = buildFreqSets();
    const body = document.querySelector('.col-body.en');
    if (!sets || !body) return null;
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
    let scroller = document.querySelector('.col-body.en');
    if (mobileQuery.matches) scroller = document.querySelector('.main-wrap') || scroller;
    if (!scroller) return;
    const pct = scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight) * 100;
    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
  }

  // ===== Full-text search =====
  let searchMatches = [];
  let searchNavStarted = false;
  let searchIdx = -1;
  // UX-8: search option state
  let searchOpts = { caseSensitive: false, wholeWord: false, regex: false };
  function injectSearchOptions() {
    const panel = document.getElementById('search-panel');
    const input = document.getElementById('search-input');
    if (!panel || !input || panel.querySelector('.search-opt')) return;
    const defs = [
      ['caseSensitive', 'Aa', '区分大小写'],
      ['wholeWord', '词', '全词匹配'],
      ['regex', '.*', '正则表达式']
    ];
    const ref = input.nextSibling; // keep order: Aa, 词, .*
    defs.forEach((d) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'search-opt';
      b.dataset.opt = d[0];
      b.textContent = d[1];
      b.title = d[2];
      b.addEventListener('click', () => {
        searchOpts[d[0]] = !searchOpts[d[0]];
        b.classList.toggle('active', searchOpts[d[0]]);
        const si = document.getElementById('search-input');
        if (si && panel.classList.contains('visible')) doSearch(si.value.trim());
      });
      panel.insertBefore(b, ref);
    });
  }
  function buildSearchPattern(query) {
    // UX-8: returns { re: RegExp } or { error: true } for invalid user regex
    const flags = searchOpts.caseSensitive ? 'g' : 'gi';
    if (searchOpts.regex) {
      try { return { re: new RegExp(query, flags) }; }
      catch (e) { return { error: true }; }
    }
    let pat = escapeRegex(query);
    if (searchOpts.wholeWord) pat = '\\b' + pat + '\\b';
    return { re: new RegExp(pat, flags) };
  }
  function toggleSearch() {
    const panel = document.getElementById('search-panel');
    const btn = document.getElementById('toggle-search-btn');
    const visible = panel.classList.toggle('visible');
    btn.classList.toggle('active', visible);
    if (visible) {
      document.getElementById('search-input').focus();
    } else {
      clearSearch();
    }
  }
  function clearHighlights() {
    searchMatches = []; searchIdx = -1; searchNavStarted = false;
    document.getElementById('search-info').textContent = '';
    document.querySelectorAll('mark.search-hl').forEach(m => {
      const txt = document.createTextNode(m.textContent);
      m.parentNode.replaceChild(txt, m);
    });
    document.querySelectorAll('.col-body').forEach(el => el.normalize());
  }
  function clearSearch() {
    clearHighlights();
    document.getElementById('search-input').value = '';
  }
  function doSearch(query) {
    clearHighlights();
    if (!query || query.length < 1) return;
    // UX-8: build pattern from options (Aa / 词 / .*)
    const pat = buildSearchPattern(query);
    if (pat.error) {
      document.getElementById('search-info').textContent = '无效正则';
      return;
    }
    const re = pat.re;
    const bodies = document.querySelectorAll('.col-body.en, .col-body.cn');
    bodies.forEach(body => {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
          if (!n.parentNode) return NodeFilter.FILTER_REJECT;
          const tag = n.parentNode.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
          // 只跳过搜索高亮自身；标注 mark 与 contenteditable 中文段内的文本也要可搜索
          if (tag === 'MARK' && n.parentNode.classList.contains('search-hl')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const nodes = []; let n;
      while ((n = walker.nextNode())) nodes.push(n);
      for (const node of nodes) {
        if (!node.parentNode) continue;
        wrapSearchOccurrences(node, re);
      }
    });
    searchMatches = Array.from(document.querySelectorAll('mark.search-hl'));
    if (searchMatches.length > 0) {
      searchIdx = 0;
      searchMatches.forEach((m, i) => m.classList.toggle('current', i === 0));
    }
    document.getElementById('search-info').textContent = searchMatches.length > 0
      ? (searchIdx + 1) + ' / ' + searchMatches.length
      : '无结果';
  }
  function wrapSearchOccurrences(node, re) {
    // UX-8: find ALL matches in this text node via exec loop, then wrap in one pass
    const val = node.nodeValue;
    re.lastIndex = 0;
    const found = [];
    let m;
    while ((m = re.exec(val)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; } // avoid zero-length loops
      found.push({ start: m.index, end: m.index + m[0].length });
      if (found.length >= 2000) break; // safety cap per node
    }
    if (found.length === 0) return;
    const parent = node.parentNode;
    const frag = document.createDocumentFragment();
    let last = 0;
    found.forEach(f => {
      if (f.start > last) frag.appendChild(document.createTextNode(val.slice(last, f.start)));
      const mark = document.createElement('mark');
      mark.className = 'search-hl';
      mark.textContent = val.slice(f.start, f.end);
      frag.appendChild(mark);
      last = f.end;
    });
    if (last < val.length) frag.appendChild(document.createTextNode(val.slice(last)));
    parent.replaceChild(frag, node);
  }
  function searchNav(dir) {
    if (searchMatches.length === 0) return;
    if (!searchNavStarted && dir === 1) {
      searchNavStarted = true;
      highlightSearchMatch();
      return;
    }
    searchNavStarted = true;
    searchIdx = (searchIdx + dir + searchMatches.length) % searchMatches.length;
    highlightSearchMatch();
  }
  function highlightSearchMatch() {
    searchMatches.forEach((m, i) => m.classList.toggle('current', i === searchIdx));
    const m = searchMatches[searchIdx];
    if (m) {
      m.scrollIntoView({ block: 'center', behavior: 'smooth' });
      document.getElementById('search-info').textContent = (searchIdx + 1) + ' / ' + searchMatches.length;
    }
  }

  // ===== Article registry sync (for hub & comparison reader) =====
  function syncToRegistry() {
    try {
      const title = document.querySelector('.title-block h1:not(.cn)')?.textContent?.trim() || '';
      const cnTitle = document.querySelector('.title-block h1.cn')?.textContent?.trim() || '';
      const author = document.querySelector('.title-block .author:not(.cn)')?.textContent?.trim() || '';
      const cnAuthor = document.querySelector('.title-block .author.cn')?.textContent?.trim() || '';
      const meta = document.querySelector('.title-block .meta')?.textContent?.trim() || '';
      const enParas = [];
      document.querySelectorAll('.col-body.en p[data-para-idx]').forEach(p => {
        enParas.push({ idx: parseInt(p.dataset.paraIdx), text: p.textContent.trim() });
      });
      const cnParas = [];
      document.querySelectorAll('.col-body.cn p[data-para-idx]').forEach(p => {
        cnParas.push({ idx: parseInt(p.dataset.paraIdx), text: p.textContent.trim() });
      });
      const articleData = {
        id: articleId, title, cnTitle, author, cnAuthor, meta,
        enParas, cnParas,
        annotationCount: annotations.length,
        updatedAt: new Date().toISOString()
      };
      localStorage.setItem('wsj_reader:article:' + articleId, JSON.stringify(articleData));
      // Update registry index
      let registry = [];
      try { registry = JSON.parse(localStorage.getItem('wsj_reader:registry') || '[]'); } catch(e) {}
      const existing = registry.findIndex(r => r.id === articleId);
      const entry = { id: articleId, title, cnTitle, author, annotationCount: annotations.length, updatedAt: articleData.updatedAt };
      if (existing >= 0) registry[existing] = entry;
      else registry.push(entry);
      localStorage.setItem('wsj_reader:registry', JSON.stringify(registry));
    } catch(e) {}
  }
  function openHub() {
    syncToRegistry();
    const hubPath = location.pathname.replace(/[^/]+$/, '') + 'WSJ_Hub.html';
    location.href = hubPath;
  }
  function openCompare() {
    syncToRegistry();
    let registry = [];
    try { registry = JSON.parse(localStorage.getItem('wsj_reader:registry') || '[]'); } catch(e) {}
    const others = registry.filter(r => r.id !== articleId);
    if (others.length === 0) { alert('没有其他文章。请先打开其他文章页面进行注册。'); return; }
    let msg = '选择要对比的文章（输入序号）：\n\n';
    others.forEach((r, i) => { msg += (i + 1) + '. ' + r.title + ' — ' + r.author + '\n'; });
    const choice = prompt(msg);
    if (!choice) return;
    const idx = parseInt(choice) - 1;
    if (idx < 0 || idx >= others.length) return;
    const comparePath = location.pathname.replace(/[^/]+$/, '') + 'WSJ_Compare.html';
    location.href = comparePath + '?a=' + encodeURIComponent(articleId) + '&b=' + encodeURIComponent(others[idx].id);
  }

  // ===== Cross-Reference System =====
  const STOP_WORDS = new Set(['The','But','And','For','Yet','Nor','Its','His','Her','Our','Your','Any','All','Each','Every','This','That','These','Those','What','Which','Who','Whom','Where','When','While','How','Why','With','From','Into','Over','After','Before','Between','Under','About','Against','Through','During','Above','Below','They','Their','Them','There','Then','Than','Would','Could','Should','Will','Can','May','Might','Must','Shall','Does','Done','Having','Being','Both','Either','Neither','Such','Same','Other','Some','Most','Much','Many','More','Less','Also','Just','Only','Very','Still','Already','Even','Here','Just','Once','Upon','Used','Use','Make','Made','Like','Well','Back','Also','New','Now','Way','Get','Got','Say','Said','Come','Come','Take','Give','Find','Know','Think','See','Look','Want','Tell','Ask','Keep','Let','Begin','Show','Try','Call','Need','Feel','Become','Leave','Put','Mean','Help','Start','Seem','Turn','Right','Left','First','Last','Long','Great','Little','Own','Old','Good','Big','High','Different','Small','Large','Next','Early','Young','Important','Few','Public','Bad','Sure','Real','Big']);
  function getKeywords(article) {
    const keywords = new Set();
    const titleWords = article.title.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [];
    titleWords.forEach(w => { if (w.length > 2 && !STOP_WORDS.has(w)) keywords.add(w); });
    const authorMatch = article.author.match(/By\s+(?:.+?\s+)?(\w+)$/);
    if (authorMatch) keywords.add(authorMatch[1]);
    const fullText = article.enParas.map(p => p.text).join(' ');
    const properNouns = fullText.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [];
    const freq = {};
    properNouns.forEach(n => { if (n.length > 2 && !STOP_WORDS.has(n)) freq[n] = (freq[n] || 0) + 1; });
    Object.entries(freq).forEach(([word, count]) => { if (count >= 2) keywords.add(word); });
    const phrases = ['Pentagon', 'FCC', 'Federal Communications', 'supply chain', 'Iran', 'missile', 'artificial intelligence', 'AI regulation'];
    phrases.forEach(p => { if (fullText.toLowerCase().includes(p.toLowerCase())) keywords.add(p); });
    return [...keywords];
  }

  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function parseLS(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }

  // \b 对中文无意义：拉丁词用词边界正则，中文词直接 includes
  function textHas(text, word) {
    if (!text || !word) return false;
    if (/[\u4e00-\u9fa5]/.test(word)) return text.indexOf(word) >= 0;
    return new RegExp('\\b' + escapeRegex(word) + '\\b', 'i').test(text);
  }
  function firstParaWith(art, word) {
    const paras = (art && art.enParas) || [];
    for (const tp of paras) {
      if (textHas(tp.text, word)) return tp.idx;
    }
    return null;
  }
  function vocabMapOf(artId) {
    const map = {};
    const arr = parseLS('annotations:' + artId, []);
    if (Array.isArray(arr)) {
      arr.forEach(a => {
        if (!a || a.bucket !== 'vocab' || !a.text) return;
        const k = String(a.text).trim().toLowerCase();
        if (k && !map[k]) map[k] = a;
      });
    }
    return map;
  }
  // 缓存戳 = 文章集合 + 各篇标注数：新增文章或新增生词都会触发重算
  function crossrefStamp(registry) {
    return registry.map(r => {
      const arr = parseLS('annotations:' + r.id, []);
      return r.id + ':' + (Array.isArray(arr) ? arr.length : 0);
    }).sort().join('|');
  }

  function computeCrossRefs() {
    // 缓存以「注册表的文章 id 集合 + 各篇标注数」为戳：新文章注册、新增生词
    // 之后 stamp 变化即重算，否则打开过的老文章永远看不到与新增内容的关联
    const registry = parseLS('wsj_reader:registry', []);
    const stamp = Array.isArray(registry) ? crossrefStamp(registry) : '';
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem('wsj_reader:crossref:' + articleId)); } catch (e) {}
    if (cached && cached.stamp === stamp && Array.isArray(cached.refs)) return cached.refs;

    if (!Array.isArray(registry) || registry.length < 2) return [];

    const currentArt = parseLS('wsj_reader:article:' + articleId, null);
    if (!currentArt) return [];

    const refs = [];
    const seen = new Set();
    registry.forEach(reg => {
      if (reg.id === articleId) return;
      const targetArt = parseLS('wsj_reader:article:' + reg.id, null);
      if (!targetArt) return;

      const targetKeywords = getKeywords(targetArt);
      const shortTitle = targetArt.title.length > 30 ? targetArt.title.slice(0, 27) + '\u2026' : targetArt.title;

      currentArt.enParas.forEach(para => {
        targetKeywords.forEach(kw => {
          const regex = new RegExp('\\b' + escapeRegex(kw) + '\\b', 'gi');
          if (regex.test(para.text)) {
            let bestTargetPara = 1;
            for (const tp of targetArt.enParas) {
              if (new RegExp('\\b' + escapeRegex(kw) + '\\b', 'i').test(tp.text)) {
                bestTargetPara = tp.idx;
                break;
              }
            }
            const dedupeKey = reg.id + '|' + String(kw).toLowerCase() + '|' + para.idx;
            if (seen.has(dedupeKey)) return;
            seen.add(dedupeKey);
            refs.push({
              sourceParaIdx: para.idx,
              targetArticleId: reg.id,
              targetTitle: shortTitle,
              targetFullTitle: targetArt.title,
              keyword: kw,
              targetParaIdx: bestTargetPara
            });
          }
        });
      });

      // 共现生词信号：同一个词在两篇的生词本里都标过 → 也是文章关联点。
      // 这类词未必出现在正文关键词里（尤其低频词），是关键词匹配之外的补充信号
      const myVocab = vocabMapOf(articleId);
      const otherVocab = vocabMapOf(reg.id);
      Object.keys(otherVocab).forEach(k => {
        const mine = myVocab[k];
        if (!mine) return;
        const theirs = otherVocab[k];
        const word = mine.text || theirs.text;
        const sp = parseInt(mine.paraIdx, 10);
        const dp = parseInt(theirs.paraIdx, 10);
        const srcPara = (!isNaN(sp) && sp > 0) ? sp : (firstParaWith(currentArt, word) || 1);
        const dstPara = (!isNaN(dp) && dp > 0) ? dp : (firstParaWith(targetArt, word) || 1);
        const dedupeKey = reg.id + '|' + k + '|' + srcPara;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        refs.push({
          sourceParaIdx: srcPara,
          targetArticleId: reg.id,
          targetTitle: shortTitle,
          targetFullTitle: targetArt.title,
          keyword: word,
          targetParaIdx: dstPara,
          via: 'vocab'
        });
      });
    });

    localStorage.setItem('wsj_reader:crossref:' + articleId, JSON.stringify({ stamp: stamp, refs: refs }));
    return refs;
  }

  function toggleCrossRef() {
    const panel = document.getElementById('crossref-panel');
    const isVisible = panel.classList.contains('visible');
    if (isVisible) {
      panel.classList.remove('visible');
      return;
    }

    const refs = computeCrossRefs();
    renderCrossRefPanel(refs);
    panel.classList.add('visible');
  }

  function renderCrossRefPanel(refs) {
    const body = document.getElementById('crossref-body');
    if (refs.length === 0) {
      body.innerHTML = '<div class="crossref-empty">本文暂未检测到与其他文章的关联</div>';
      return;
    }

    const byTarget = {};
    refs.forEach(r => {
      if (!byTarget[r.targetArticleId]) byTarget[r.targetArticleId] = { title: r.targetFullTitle, items: [] };
      byTarget[r.targetArticleId].items.push(r);
    });

    let html = '';
    Object.entries(byTarget).forEach(([targetId, data]) => {
      html += '<div class="crossref-group">';
      html += '<div class="crossref-group-title">\ud83d\udcc4 ' + esc(data.title) + ' <span style="color:var(--muted);font-weight:normal;font-size:12px">(' + data.items.length + ' 处关联)</span></div>';

      const byPara = {};
      data.items.forEach(item => {
        if (!byPara[item.sourceParaIdx]) byPara[item.sourceParaIdx] = [];
        byPara[item.sourceParaIdx].push(item);
      });

      Object.entries(byPara).forEach(([paraIdx, items]) => {
        const keywords = [...new Set(items.map(i => i.keyword))];
        const targetParas = [...new Set(items.map(i => i.targetParaIdx))];
        html += '<div class="crossref-item" onclick="navigateToRef(\'' + esc(items[0].targetArticleId) + '\', ' + items[0].targetParaIdx + ', \'' + esc(items[0].keyword) + '\')">';
        html += '<span>P' + (parseInt(paraIdx)+1) + '</span>';
        html += '<span class="crossref-keyword">"' + esc(keywords.join('", "')) + '"</span>';
        html += '<span class="crossref-arrow">\u2192</span>';
        html += '<span class="crossref-target">' + esc(data.title) + ' P' + targetParas.map(p => p+1).join(', ') + '</span>';
        html += '</div>';
      });

      html += '</div>';
    });

    body.innerHTML = html;

    const countEl = document.getElementById('crossref-count');
    const uniqueTargets = new Set(refs.map(r => r.targetArticleId));
    countEl.textContent = uniqueTargets.size > 0 ? uniqueTargets.size : '';
  }

  function navigateToRef(targetId, targetParaIdx, keyword) {
    location.href = targetId + '?from=' + encodeURIComponent(articleId) + '&keyword=' + encodeURIComponent(keyword) + '#p' + targetParaIdx;
  }

  // Hash navigation for cross-references
  (function checkHashNav() {
    const hash = location.hash;
    const match = hash.match(/^#p(\d+)/);
    if (match) {
      const paraIdx = parseInt(match[1]);
      setTimeout(() => {
        const para = document.querySelector('[data-para-idx="' + paraIdx + '"]');
        if (para) {
          para.scrollIntoView({ behavior: 'smooth', block: 'center' });
          para.style.transition = 'background 0.3s';
          para.style.background = 'rgba(124, 77, 255, 0.15)';
          setTimeout(() => { para.style.background = ''; }, 3000);
        }
      }, 500);

      const params = new URLSearchParams(location.search);
      const from = params.get('from');
      const keyword = params.get('keyword');
      if (from) {
        const fromTitle = from.replace(/_/g, ' ').replace(/\.html$/, '');
        showBackRefBanner(fromTitle, keyword);
      }
    }
  })();

  function showBackRefBanner(fromTitle, keyword) {
    const banner = document.createElement('div');
    banner.className = 'backref-banner';
    banner.innerHTML = '<span>\u2190 返回 <a onclick="history.back()">' + esc(fromTitle) + '</a>' + (keyword ? ' (从 "' + esc(keyword) + '" 处跳转而来)' : '') + '</span><button class="close-banner" onclick="this.parentElement.remove()">\u2715</button>';
    document.body.prepend(banner);
    setTimeout(() => { if (banner.parentElement) banner.remove(); }, 5000);
  }

  // ===== Diagnostic overlay (Ctrl+Shift+D) =====
  function showDiagnostic() {
    // Gather all annotation keys in localStorage
    const allKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('annotations:')) {
        try {
          const arr = JSON.parse(localStorage.getItem(k) || '[]');
          allKeys.push({ key: k, count: Array.isArray(arr) ? arr.length : 0 });
        } catch(e) { allKeys.push({ key: k, count: -1 }); }
      }
    }
    const orphanKeys = allKeys.filter(k => k.key !== ANNO_KEY && k.count > 0);
    let html = '<div class="diag-overlay diag-box" id="diag-overlay"><div>';
    html += '<h3>🔍 诊断 / Diagnostic</h3>';
    html += '<div class="diag-row diag-label diag-val"><span>articleId: </span><span>' + esc(articleId) + '</span></div>';
    html += '<div class="diag-row diag-label diag-val"><span>ANNO_KEY: </span><span>' + esc(ANNO_KEY) + '</span></div>';
    html += '<div class="diag-row diag-label diag-val"><span>当前标注数: </span><span>' + annotations.length + '</span></div>';
    html += '<div class="diag-row diag-label diag-val"><span>URL: </span><span>' + esc(location.href) + '</span></div>';
    html += '<hr style="margin:10px 0;border:none;border-top:1px solid var(--rule);">';
    html += '<div class="diag-row diag-label"><span>localStorage 中所有标注键:</span></div>';
    html += '<ul class="diag-key-list">';
    allKeys.forEach(k => {
      const cls = k.key === ANNO_KEY ? 'current' : (k.count > 0 ? 'orphan' : '');
      html += '<li class="' + cls + '">' + esc(k.key) + ' — ' + k.count + ' 条' + (k.key === ANNO_KEY ? ' ← 当前' : '') + '</li>';
    });
    if (allKeys.length === 0) html += '<li style="color:var(--muted)">（无标注数据）</li>';
    html += '</ul>';
    if (orphanKeys.length > 0) {
      html += '<div style="margin-top:8px;color:var(--cn-tag);font-size:12px;">⚠ 发现 ' + orphanKeys.length + ' 个孤立键（可能是文件改名前的旧数据）</div>';
      orphanKeys.forEach(ok => {
        html += '<button onclick="importOrphanAnno(\'' + esc(ok.key).replace(/'/g, "\\'") + '\')">导入 ' + ok.count + ' 条 from ' + esc(ok.key.replace('annotations:', '').substring(0, 30)) + '…</button>';
      });
    }
    html += '<br><button onclick="this.closest(\'.diag-overlay\').remove()">关闭</button>';
    html += '</div></div>';
    const existing = document.getElementById('diag-overlay');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', html);
  }
  window.importOrphanAnno = function(sourceKey) {
    try {
      const raw = localStorage.getItem(sourceKey);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length === 0) return;
      let imported = 0;
      arr.forEach(a => {
        if (!a.bucket) a.bucket = (a.type === 'note') ? 'note' : 'vocab';
        const dup = annotations.find(x => x.text === a.text && x.source === a.source);
        if (!dup) { annotations.push(a); imported++; }
      });
      saveAnnotations();
      document.getElementById('diag-overlay')?.remove();
      reapplyAllHighlights();
      renderNotes();
      updateNoteCount();
      alert('已导入 ' + imported + ' 条标注！');
    } catch(e) { alert('导入失败: ' + e.message); }
  };
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') { e.preventDefault(); showDiagnostic(); }
  });

  // ===== Clock, Reading Timer & Position =====
  const READING_KEY = 'reading:' + articleId;
  let readingData = { totalSeconds: 0, lastPosition: null, sessions: [] };
  let sessionSeconds = 0;
  let timerInterval = null;
  let posSaveTimer = null;
  let currentSession = null;

  function loadReading() {
    try {
      readingData = JSON.parse(localStorage.getItem(READING_KEY)) || { totalSeconds: 0, lastPosition: null, sessions: [] };
      if (!readingData.sessions) readingData.sessions = [];
    } catch(e) { readingData = { totalSeconds: 0, lastPosition: null, sessions: [] }; }
  }
  function saveReading() {
    localStorage.setItem(READING_KEY, JSON.stringify(readingData));
  }

  // --- Clock ---
  function tickClock() {
    const el = document.getElementById('toolbar-clock');
    if (!el) return;
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    el.textContent = h + ':' + m + ':' + s;
  }

  // --- Timer ---
  function fmtTime(sec) {
    sec = Math.floor(sec);
    if (sec < 3600) {
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      return mm + ':' + ss;
    }
    const hh = String(Math.floor(sec / 3600)).padStart(2, '0');
    const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    return hh + ':' + mm + ':' + ss;
  }
  function updateTimerDisplay() {
    const se = document.getElementById('session-timer');
    const te = document.getElementById('total-timer');
    if (se) se.textContent = '⏱ ' + fmtTime(sessionSeconds);
    if (te) te.textContent = '📊 ' + fmtTime(readingData.totalSeconds);
    if (se) se.title = '本次阅读时长 ' + fmtTime(sessionSeconds);
    if (te) te.title = '累计阅读时长 ' + fmtTime(readingData.totalSeconds);
  }
  function startTimer() {
    if (timerInterval) return;
    const startPara = getCurrentPosition() || 0;
    currentSession = { start: new Date().toISOString(), end: null, paras: [startPara, startPara] };
    timerInterval = setInterval(() => {
      sessionSeconds++;
      readingData.totalSeconds++;
      if (currentSession) currentSession.paras[1] = getCurrentPosition() || currentSession.paras[1];
      if (sessionSeconds % 10 === 0) saveReading();
      updateTimerDisplay();
    }, 1000);
  }
  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (currentSession) {
      currentSession.end = new Date().toISOString();
      currentSession.paras[1] = getCurrentPosition() || currentSession.paras[1];
      readingData.sessions.push(currentSession);
      currentSession = null;
    }
    saveReading();
  }
  function initTimer() {
    loadReading();
    updateTimerDisplay();
    startTimer();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopTimer(); else startTimer();
    });
    window.addEventListener('beforeunload', stopTimer);
  }

  // --- Reading position ---
  function getCurrentPosition() {
    const enCol = document.querySelector('.col-body.en');
    if (!enCol) return null;
    const paras = enCol.querySelectorAll('p');
    if (paras.length === 0) return null;
    const colTop = enCol.getBoundingClientRect().top;
    let best = 0;
    paras.forEach((p, i) => {
      const rect = p.getBoundingClientRect();
      if (rect.top <= colTop + 80) best = i;
    });
    return best;
  }
  function savePosition() {
    const pos = getCurrentPosition();
    if (pos !== null) {
      readingData.lastPosition = pos;
      saveReading();
    }
  }
  function initPositionTracking() {
    loadReading();
    if (readingData.lastPosition !== null) {
      let btn = document.getElementById('bookmark-btn');
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'bookmark-btn';
        btn.className = 'bookmark-pill';
        btn.textContent = '📍 回到上次阅读';
        btn.addEventListener('click', jumpToLastPosition);
        document.body.appendChild(btn);
      }
      btn.style.display = '';
    }
    const enCol = document.querySelector('.col-body.en');
    if (enCol) {
      enCol.addEventListener('scroll', () => {
        clearTimeout(posSaveTimer);
        posSaveTimer = setTimeout(savePosition, 2000);
      }, { passive: true });
    }
  }
  function jumpToLastPosition() {
    loadReading();
    if (readingData.lastPosition === null) return;
    const enCol = document.querySelector('.col-body.en');
    if (!enCol) return;
    const paras = enCol.querySelectorAll('p');
    const idx = Math.min(readingData.lastPosition, paras.length - 1);
    if (paras[idx]) {
      paras[idx].scrollIntoView({ behavior: 'smooth', block: 'start' });
      paras[idx].style.outline = '2px solid var(--cn-tag)';
      paras[idx].style.outlineOffset = '2px';
      paras[idx].style.transition = 'outline 0.3s';
      setTimeout(() => {
        paras[idx].style.outline = 'none';
      }, 2500);
    }
    const btn = document.getElementById('bookmark-btn');
    if (btn) btn.style.display = 'none';
  }

  // ===== UX-2: Backup & restore all app data =====
  // 考试练习页（exam_/cloze_/newtype_/translation_）的数据也在同一浏览器里，必须一起备份
  const BACKUP_PREFIXES = ['annotations:', 'reading:', 'settings:', 'summary:', 'translation:', 'syntax:',
    'wsj_review:', 'wsj_reader:',
    'examq:', 'examtimer:', 'examlimit:', 'exammode:', 'exammark:', 'examansheet:', 'examhist:', 'examhl:', 'examsess:',
    'cz:', 'transq:', 'transtimer:', 'nt:'];
  const BACKUP_EXACT_KEYS = ['wsj_writing:materials', 'wsj_writing:advice', 'wsj_roots:cards',
    'wsj_exam:wrongs', 'wsj_exam:overtime', 'wsj_exam:history', 'wsj_exam:theme'];
  function collectAppKeys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (BACKUP_EXACT_KEYS.indexOf(k) >= 0 || BACKUP_PREFIXES.some(p => k.startsWith(p))) keys.push(k);
    }
    return keys;
  }
  // ---- 备份落盘：记住一个本机文件夹 → 之后一键写进去；不支持时降级为下载并讲清去向 ----
  const IDB_NAME = 'english-reader-files';
  const IDB_STORE = 'handles';
  const BACKUP_LOG_KEY = '***';
  const BACKUP_DIR_NAME_KEY = '***';
  function idbOpen() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(IDB_NAME, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => { try { req.result.createObjectStore(IDB_STORE); } catch (e) {} };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function idbPut(value, key) {
    return idbOpen().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    }));
  }
  function idbGet(key) {
    return idbOpen().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const rq = tx.objectStore(IDB_STORE).get(key);
      rq.onsuccess = () => resolve(rq.result || null);
      rq.onerror = () => reject(rq.error);
    }));
  }
  function dirPickerSupported() {
    return typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined';
  }
  async function getBackupDir() {
    if (!dirPickerSupported()) return null;
    try { return await idbGet('backupDir'); } catch (e) { return null; }
  }
  async function pickBackupDir() {
    const h = await window.showDirectoryPicker({ id: 'reader-backup-dir', mode: 'readwrite' });
    await idbPut(h, 'backupDir');
    try { localStorage.setItem(BACKUP_DIR_NAME_KEY, h.name || ''); } catch (e) {}
    return h;
  }
  async function ensureDirPermission(h) {
    if (!h || !h.queryPermission) return true;
    const d = { mode: 'readwrite' };
    try {
      if (await h.queryPermission(d) === 'granted') return true;
      return (await h.requestPermission(d)) === 'granted';
    } catch (e) { return false; }
  }
  function backupStamp() {
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  }
  function buildBackupPayload() {
    const data = {};
    collectAppKeys().forEach(k => { data[k] = localStorage.getItem(k); });
    return { app: 'english-reader-backup', version: 2, createdAt: new Date().toISOString(), data };
  }
  function backupSizeText(payload) {
    const bytes = JSON.stringify(payload).length;
    return bytes > 1048576 ? (bytes / 1048576).toFixed(2) + ' MB' : (bytes / 1024).toFixed(0) + ' KB';
  }
  function backupLogList() { return parseLS(BACKUP_LOG_KEY, []); }
  function logBackup(entry) {
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(BACKUP_LOG_KEY) || '[]'); } catch (e) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    arr.push(entry);
    try { localStorage.setItem(BACKUP_LOG_KEY, JSON.stringify(arr.slice(-12))); } catch (e) {}
  }
  async function writeToDir(dirHandle, name, text) {
    const fh = await dirHandle.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
    return fh;
  }
  // 主入口：有已记目录就直接写；没有就先让用户挑一次目录；不支持则走浏览器下载
  async function backupAllData() {
    let payload, name, text;
    try {
      payload = buildBackupPayload();
      name = 'reader-backup-' + backupStamp() + '.json';
      text = JSON.stringify(payload, null, 2);
    } catch (e) {
      showTopToast('备份失败：' + (e && e.message ? e.message : '未知错误'));
      return;
    }
    if (dirPickerSupported()) {
      let dir = null;
      try {
        dir = await getBackupDir();
        if (!dir || !(await ensureDirPermission(dir))) dir = await pickBackupDir();
      } catch (e) {
        if (e && e.name === 'AbortError') { showTopToast('已取消备份'); return; }
        dir = null;
      }
      if (dir) {
        try {
          await writeToDir(dir, name, text);
          const dirName = dir.name || '所选文件夹';
          try { localStorage.setItem('wsj_reader:lastBackupAt', JSON.stringify(new Date().toISOString())); } catch (e) {}
          logBackup({ at: new Date().toISOString(), file: name, where: 'folder', dir: dirName,
            size: backupSizeText(payload), keys: Object.keys(payload.data).length });
          showTopToast('✅ 已备份到文件夹「' + dirName + '」／' + name + '（下次一键备份到同一处）', 5200);
          return;
        } catch (e) {
          showTopToast('写入文件夹失败，改为下载：' + (e && e.message ? e.message : e), 4000);
        }
      }
    }
    try {
      downloadFile(name, text, 'application/json;charset=utf-8');
      try { localStorage.setItem('wsj_reader:lastBackupAt', JSON.stringify(new Date().toISOString())); } catch (e) {}
      logBackup({ at: new Date().toISOString(), file: name, where: 'download', dir: '浏览器下载文件夹',
        size: backupSizeText(payload), keys: Object.keys(payload.data).length });
      showTopToast('⬇ 已下载 ' + name + '\n→ 请在浏览器下载记录里找这个文件（通常在「下载」文件夹）。\n要固定存放位置：💾 数据 ▾ → 选择备份文件夹', 7000);
    } catch (e) {
      showTopToast('备份失败：' + (e && e.message ? e.message : '未知错误'));
    }
  }
  // 备份提醒：有积累数据且超过设定天数没备份时，打开文章页温和提示一次
  function maybeRemindBackup() {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf('annotations:') !== 0) continue;
      try {
        const arr = JSON.parse(localStorage.getItem(k) || '[]');
        if (Array.isArray(arr)) total += arr.length;
      } catch (e) {}
    }
    if (total === 0) return;
    const last = parseLS('wsj_reader:lastBackupAt', null);
    const ageDays = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : Infinity;
    if (ageDays < 7) return;
    const when = last ? '上次备份 ' + fmtDate(last) : '还没有备份过';
    showTopToast('💾 已积累 ' + total + ' 条标注（' + when + '）。建议备份：💾 数据 ▾ → 备份全部数据', 4500);
  }
  async function listDirBackups(dirHandle) {
    const out = [];
    if (!dirHandle || !dirHandle.values) return out;
    try {
      for await (const entry of dirHandle.values()) {
        if (entry.kind !== 'file') continue;
        const n = entry.name || '';
        if (!/\.json$/i.test(n)) continue;
        if (!/reader-backup|reader-export|^backup/i.test(n) && !/backup/i.test(n)) continue;
        let meta = { name: n };
        try { const fh = await entry.getFile(); meta.size = fh.size; meta.lastModified = fh.lastModified; } catch (e) {}
        out.push(meta);
      }
    } catch (e) {}
    out.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
    return out.slice(0, 20);
  }
  function applyBackupPayload(payload) {
    Object.keys(payload.data).forEach(k => {
      try { localStorage.setItem(k, payload.data[k]); } catch (e) {}
    });
  }
  function validateBackupPayload(obj) {
    return !!(obj && obj.app === 'english-reader-backup' && typeof obj.data === 'object' && obj.data !== null);
  }
  async function restoreFromText(text, label) {
    let payload;
    try { payload = JSON.parse(text); } catch (e) { showTopToast('恢复失败：文件解析错误'); return; }
    if (!validateBackupPayload(payload)) { showTopToast('恢复失败：不是本阅读器的备份文件'); return; }
    const n = Object.keys(payload.data).length;
    if (!confirm('将用「' + label + '」恢复 ' + n + ' 项数据，并覆盖当前浏览器中的同名数据（标注/概要/翻译/设置/考试记录等）。\n确定继续？')) return;
    applyBackupPayload(payload);
    showTopToast('恢复成功，即将刷新');
    setTimeout(() => location.reload(), 800);
  }
  async function restoreFromDirHandle(fh, name) {
    try {
      const file = await fh.getFile();
      restoreFromText(await file.text(), name);
    } catch (e) {
      showTopToast('读取备份文件失败：' + (e && e.message ? e.message : e));
    }
  }
  // 「从文件恢复」兜底：原生文件选择器（任何浏览器都能用）
  let restoreFileInput = null;
  function setupRestoreInput() {
    if (restoreFileInput) return;
    restoreFileInput = document.createElement('input');
    restoreFileInput.type = 'file';
    restoreFileInput.accept = '.json,application/json';
    restoreFileInput.style.display = 'none';
    document.body.appendChild(restoreFileInput);
    restoreFileInput.addEventListener('change', () => {
      const file = restoreFileInput.files && restoreFileInput.files[0];
      restoreFileInput.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => restoreFromText(String(reader.result), file.name);
      reader.onerror = () => showTopToast('恢复失败：无法读取文件');
      reader.readAsText(file, 'utf-8');
    });
  }
  function restoreData() {
    setupRestoreInput();
    restoreFileInput.click();
  }
  // 备份记录面板：现在备份去哪了 + 历史 + 从文件夹里挑一份恢复
  async function openBackupPanel() {
    closeAllMenus();
    const old = document.getElementById('backup-overlay');
    if (old) old.remove();
    const dir = await getBackupDir();
    const dirName = dir ? (dir.name || '已选文件夹') :
      (parseLS(BACKUP_DIR_NAME_KEY, '') || (dirPickerSupported() ? '未设置（备份时会让你选一次）' : '当前浏览器不支持选文件夹'));
    const files = dir && await ensureDirPermission(dir) ? await listDirBackups(dir) : [];
    const last = parseLS('wsj_reader:lastBackupAt', null);
    const logs = backupLogList().slice().reverse();
    let keys = 0, annoTotal = 0;
    try {
      collectAppKeys().forEach(k => {
        keys++;
        if (k.indexOf('annotations:') === 0) {
          try { const a = JSON.parse(localStorage.getItem(k) || '[]'); if (Array.isArray(a)) annoTotal += a.length; } catch (e) {}
        }
      });
    } catch (e) {}
    const overlay = document.createElement('div');
    overlay.className = 'backup-overlay';
    overlay.id = 'backup-overlay';
    overlay.innerHTML =
      '<div class="backup-box">' +
      '<div class="bk-head"><h3>💾 备份与恢复</h3><button type="button" class="bk-close" title="关闭">✕</button></div>' +
      '<div class="bk-facts">' +
      '<div><span class="bk-k">本机数据</span><span class="bk-v">' + keys + ' 项 key · ' + annoTotal + ' 条标注</span></div>' +
      '<div><span class="bk-k">上次备份</span><span class="bk-v">' + (last ? esc(fmtDate(last)) + ' ' + esc(fmtTimeHM(last)) : '从未备份') + '</span></div>' +
      '<div><span class="bk-k">备份文件夹</span><span class="bk-v">' + esc(dirName) + (dir ? '' : '（尚未选择）') + '</span></div>' +
      '</div>' +
      '<div class="bk-actions">' +
      '<button type="button" class="bk-btn primary" data-act="backup">备份全部数据</button>' +
      '<button type="button" class="bk-btn" data-act="pickdir">' + (dir ? '更换备份文件夹' : '选择备份文件夹') + '</button>' +
      '<button type="button" class="bk-btn" data-act="file">从文件恢复…</button>' +
      '</div>' +
      (files.length ? '<div class="bk-label">文件夹内的备份（点「恢复」写回本机）</div><div class="bk-files">' +
        files.map((f, i) => '<div class="bk-file"><span class="bk-fname">' + esc(f.name) + '</span>' +
          '<span class="bk-fmeta">' + (f.size ? (f.size / 1024).toFixed(0) + ' KB · ' : '') +
          (f.lastModified ? esc(fmtDate(new Date(f.lastModified).toISOString())) : '') + '</span>' +
          '<button type="button" class="bk-mini" data-restore="' + i + '">恢复</button></div>').join('') + '</div>'
        : (dir ? '<div class="bk-label">文件夹内暂无备份文件</div>' : '')) +
      '<div class="bk-label">本机备份记录（最近 ' + logs.length + ' 次）</div>' +
      (logs.length ? '<div class="bk-log">' + logs.map(l =>
        '<div class="bk-logrow"><span>' + esc((l.at || '').replace('T', ' ').slice(0, 16)) + '</span>' +
        '<span class="bk-file2">' + esc(l.file || '') + '</span>' +
        '<span class="bk-fmeta">' + esc(l.where === 'folder' ? '📁 ' + (l.dir || '') : '⬇ ' + (l.dir || '下载')) +
        (l.size ? ' · ' + esc(l.size) : '') + '</span></div>').join('') + '</div>'
        : '<div class="bk-fmeta">还没有备份记录</div>') +
      '<div class="bk-note">恢复会覆盖当前浏览器里的同名数据，只影响这台电脑这个浏览器；换电脑请先备份再恢复。</div>' +
      '</div>';
    document.body.appendChild(overlay);
    if (dir) {
      overlay.querySelectorAll('[data-restore]').forEach(btn => {
        const target = files[btn.dataset.restore];
        btn.addEventListener('click', async () => {
          let fh = null;
          try { fh = await dir.getFileHandle(target.name); } catch (e) {}
          if (fh) restoreFromDirHandle(fh, target.name);
          else showTopToast('找不到该备份文件');
        });
      });
    }
    overlay.querySelector('.bk-close').addEventListener('click', closeBackupPanel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeBackupPanel(); });
    overlay.querySelector('[data-act="backup"]').addEventListener('click', () => { backupAllData().then(closeBackupPanel); });
    overlay.querySelector('[data-act="pickdir"]').addEventListener('click', async () => {
      if (!dirPickerSupported()) { showTopToast('当前浏览器不支持选择文件夹，备份会走下载'); return; }
      try { await pickBackupDir(); showTopToast('已记住备份文件夹，下次直接写进去'); closeBackupPanel(); openBackupPanel(); }
      catch (e) { if (e && e.name !== 'AbortError') showTopToast('选择文件夹失败：' + (e && e.message ? e.message : e)); }
    });
    overlay.querySelector('[data-act="file"]').addEventListener('click', () => { closeBackupPanel(); restoreData(); });
  }
  function closeBackupPanel() {
    const o = document.getElementById('backup-overlay');
    if (o) o.remove();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('backup-overlay')) closeBackupPanel();
  });

  // ===== UX-7: Undo for contenteditable edits =====
  const EDIT_UNDO_CAP = 50;
  let editUndoStack = [];      // [{ el, html }] checkpoints, capped at EDIT_UNDO_CAP
  let editBaseline = null;     // { el, html } state at focus / last checkpoint
  let editCheckpointTimer = null;
  function pushUndoSnapshot(el, html) {
    const top = editUndoStack[editUndoStack.length - 1];
    if (top && top.el === el && top.html === html) return; // no duplicate states
    editUndoStack.push({ el: el, html: html });
    if (editUndoStack.length > EDIT_UNDO_CAP) editUndoStack.shift();
  }
  function flushEditBaseline() {
    clearTimeout(editCheckpointTimer);
    if (!editBaseline) return;
    const el = editBaseline.el;
    const html = editBaseline.html;
    editBaseline = null;
    if (el && el.isConnected && el.innerHTML !== html) pushUndoSnapshot(el, html);
  }
  function setupEditUndo() {
    document.addEventListener('focusin', (e) => {
      const el = e.target;
      if (!el || !el.getAttribute || el.getAttribute('contenteditable') !== 'true') return;
      flushEditBaseline();
      editBaseline = { el: el, html: el.innerHTML };
    });
    document.addEventListener('focusout', (e) => {
      if (editBaseline && editBaseline.el === e.target) flushEditBaseline();
    });
    document.addEventListener('input', (e) => {
      if (!editBaseline || e.target !== editBaseline.el) return;
      clearTimeout(editCheckpointTimer);
      editCheckpointTimer = setTimeout(() => {
        if (!editBaseline) return;
        const el = editBaseline.el;
        if (el.isConnected && el.innerHTML !== editBaseline.html) {
          pushUndoSnapshot(el, editBaseline.html);
          editBaseline.html = el.innerHTML; // new baseline for the next checkpoint
        }
      }, 1000);
    });
  }
  function undoEdit() {
    flushEditBaseline(); // capture the in-progress edit before popping
    let snap = null;
    while (editUndoStack.length > 0) {
      const s = editUndoStack.pop();
      if (s && s.el && s.el.isConnected) { snap = s; break; }
    }
    if (!snap) { showTopToast('没有可撤销的编辑'); return; }
    snap.el.innerHTML = snap.html;
    // Notify persistence handlers bound to 'input' (qfields, note edits)
    snap.el.dispatchEvent(new Event('input', { bubbles: true }));
    // 概要/主旨字段只在 blur 时持久化——撤销后必须手动同步 summaryData，
    // 否则刷新页面会复活刚被撤销的文本（key 计算与 initSummary 共用 summaryKeyFor）
    if (snap.el.hasAttribute && snap.el.hasAttribute('data-default')) {
      const sKey = summaryKeyFor(snap.el);
      if (sKey) { summaryData[sKey] = snap.el.textContent.trim(); saveSummary(); }
    }
    // CN translation paragraphs persist on blur, not input — sync manually
    if (snap.el.classList && snap.el.classList.contains('cn-translatable')) {
      const key = 'para-' + snap.el.dataset.paraIdx;
      const txt = snap.el.textContent.trim();
      translationData[key] = txt;
      saveTranslation();
      snap.el.classList.toggle('cn-edited', txt !== snap.el.dataset.default);
      updateTransCount();
    }
    showTopToast('已撤销');
  }
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'Z' || e.key === 'z')) {
      e.preventDefault();
      undoEdit();
    }
  });

  // ===== UX-4: Shortcuts help modal =====
  function openShortcutsHelp() {
    if (document.getElementById('shortcuts-overlay')) return;
    // Compiled from the actual keydown handlers in this file
    const rows = [
      ['<kbd>Ctrl</kbd> + <kbd>F</kbd>', '打开全文搜索 / 聚焦搜索框'],
      ['<kbd>Enter</kbd>', '搜索：跳到下一个结果'],
      ['<kbd>Shift</kbd> + <kbd>Enter</kbd>', '搜索：跳到上一个结果'],
      ['<kbd>Esc</kbd>', '关闭搜索面板 / 关闭本弹窗'],
      ['<kbd>↑</kbd> / <kbd>↓</kbd>', '标注跳转：上一个 / 下一个（笔记面板展开且不在输入框中）'],
      ['<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd>', '撤销编辑（可连续撤销）'],
      ['<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd>', '打开诊断面板'],
      ['<kbd>Shift</kbd> + 点击高亮', '删除该条标注']
    ];
    const overlay = document.createElement('div');
    overlay.className = 'shortcuts-overlay';
    overlay.id = 'shortcuts-overlay';
    overlay.innerHTML = '<div class="shortcuts-box"><h3>⌨ 快捷键</h3><table><tbody>' +
      rows.map(r => '<tr><td class="k">' + r[0] + '</td><td>' + esc(r[1]) + '</td></tr>').join('') +
      '</tbody></table><button class="sc-close" type="button">关闭</button></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.sc-close').addEventListener('click', closeShortcutsHelp);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeShortcutsHelp(); });
  }
  function closeShortcutsHelp() {
    const o = document.getElementById('shortcuts-overlay');
    if (o) o.remove();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('shortcuts-overlay')) closeShortcutsHelp();
  });

  // ===== UX-3: Mobile column switch bar (CSS hides it above 860px) =====
  function setupMobileColBar() {
    if (document.querySelector('.mobile-col-bar')) return;
    const bar = document.createElement('div');
    bar.className = 'mobile-col-bar';
    const modes = [['en', '英文'], ['cn', '中文'], ['both', '双语'], ['sum', '概要']];
    modes.forEach((mo) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.mode = mo[0];
      b.textContent = mo[1];
      b.addEventListener('click', () => setMobileMode(mo[0]));
      bar.appendChild(b);
    });
    document.body.appendChild(bar);
    setMobileMode(settings.mobileMode || 'both');
  }
  function setMobileMode(mode) {
    if (['en', 'cn', 'both', 'sum'].indexOf(mode) < 0) mode = 'both';
    const wrap = document.querySelector('.main-wrap');
    if (wrap) {
      ['m-en', 'm-cn', 'm-both', 'm-sum'].forEach(c => wrap.classList.remove(c));
      wrap.classList.add('m-' + mode);
    }
    document.querySelectorAll('.mobile-col-bar button[data-mode]').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    settings.mobileMode = mode;
    saveSettings();
  }

  // ===== Injected menu extras (UX-2 / UX-4 / UX-7) — article HTML stays untouched =====
  const EXAM_SLUGS = {
    'SundayTimes_2026-06-14_Hidden_Cost_AI_Fortson_EN-CN_final.html': 'ai_cost',
    'WSJ_2026-03-21_AI_Regulation_Fryer_EN-CN_final.html': 'ai_regulation',
    'WSJ_2026-03-21_Ammo_Shortage_Jones_EN-CN_final.html': 'ammo_shortage',
    'WSJ_2026-03-21_FCC_Sports_Jenkins_EN-CN_final.html': 'fcc_sports',
    'SundayTimes_2026-06-14_Haldane_Chainsaw_Regulation_Treanor_EN-CN_final.html': 'haldane',
    'Science_2026-06-04_Narrowing_Window_AI_Horvitz-West_EN-CN_final.html': 'horvitz',
    'Science_2026-03-26_Moral_Economics_Perry_EN-CN_final.html': 'moral_econ',
    'SundayTimes_2026-06-14_Junior_Pensions_Filby_EN-CN_final.html': 'pensions',
    'SundayTimes_2026-06-14_Pothole_Compensation_Harwood-Baynes_EN-CN_final.html': 'pothole'
  };
  // ---- 工具栏菜单：视图 / 考试 / 数据 / 工具 四个分组下拉 ----
  // 旧版是 2 个下拉（左 8 项 / 右 19 项，考试模式沉底且菜单超出屏幕），整体在运行时重建。
  function menuTriggerHTML(side, icon, label, title) {
    return '<button class="toolbar-btn arrow menu-trigger" id="menu-' + side + '-btn" type="button" ' +
      'onclick="toggleMenu(\'' + side + '\')" title="' + esc(title) + '">' + icon + ' ' + esc(label) +
      ' <span>▾</span></button>';
  }
  function menuItemHTML(id, icon, label, title, hint, cls, extra) {
    return '<button class="btn-icon btn-label' + (cls ? ' ' + cls : '') + '" id="' + id + '" type="button"' +
      (title ? ' title="' + esc(title) + '"' : '') + '><span>' + icon + '</span><span>' + esc(label) + '</span>' +
      (hint ? '<span class="menu-kbd">' + esc(hint) + '</span>' : '') + (extra || '') + '</button>';
  }
  function buildMenus() {
    const toolbar = document.querySelector('.toolbar');
    if (!toolbar || toolbar.dataset.menusBuilt) return;
    toolbar.dataset.menusBuilt = '1';
    // 1) 移除模板里的两个旧下拉（按钮 + 容器）
    ['menu-left', 'menu-right', 'menu-left-btn', 'menu-right-btn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    const examSlug = EXAM_SLUGS[decodeURIComponent(location.pathname.split('/').pop() || '')];
    const crossId = 'crossref-count';

    // 2) 视图 —— 怎么看这篇（6 组）
    const viewMenu =
      '<div class="menu-section-label">字号</div>' +
      '<div class="menu-size-row"><button type="button" onclick="changeSize(-1)">A−</button>' +
      '<span class="size-display" id="size-display">' + settings.fontSize + 'px</span>' +
      '<button type="button" onclick="changeSize(1)">A+</button></div>' +
      '<div class="menu-sep"></div><div class="menu-section-label">主题</div>' +
      '<div class="menu-theme-row">' +
      '<button type="button" class="btn-icon btn-label" onclick="setTheme(\'green\')"><span>🌿</span><span>绿金</span></button>' +
      '<button type="button" class="btn-icon btn-label" onclick="setTheme(\'light\')"><span>☀</span><span>亮色</span></button>' +
      '<button type="button" class="btn-icon btn-label" onclick="setTheme(\'dark\')"><span>🌙</span><span>暗色</span></button>' +
      '<button type="button" class="btn-icon btn-label" onclick="setTheme(\'blue-gold\')"><span>💎</span><span>蓝金</span></button>' +
      '<button type="button" class="btn-icon btn-label" onclick="setTheme(\'system\')"><span>⚙</span><span>系统</span></button></div>' +
      '<div class="menu-sep"></div>' +
      menuItemHTML('toggle-header-btn', '📰', '标题区显隐') +
      menuItemHTML('freq-toggle-btn', '🎨', '词频着色') +
      '<div class="freq-legend"><span class="fl-h">高频</span><span class="fl-m">中频</span>' +
      '<span class="fl-l">低频</span><span class="fl-x">超纲</span><span class="fl-v">已录生词</span></div>' +
      menuItemHTML('undo-edit-btn', '↩', '撤销编辑', '撤销上一次对概要 / 中文 / 笔记的修改', 'Ctrl+Shift+Z') +
      menuItemHTML('shortcuts-help-btn', '⌨', '快捷键一览');

    // 3) 考试 —— 题库入口（只在有题目的 9 篇出现）
    const examMenu =
      '<div class="menu-section-label">题库练习</div>' +
      menuItemHTML('open-exam-btn', '📝', '模拟考试', '计时作答，交卷才揭晓对错') +
      menuItemHTML('open-translation-btn', '✍', '翻译练习', '5 句长难句英译中 + 分点自评') +
      menuItemHTML('open-cloze-btn', '🧩', '完形填空', '20 空，生词自动联动生词本') +
      menuItemHTML('open-newtype-btn', '🔗', '新题型', '七选五 / 排序 / 小标题');

    // 4) 数据 —— 存下来 / 拿回来 / 导出去
    const dataMenu =
      '<div class="menu-section-label">备份与恢复</div>' +
      menuItemHTML('backup-data-btn', '💾', '备份全部数据', '所有文章的标注 / 概要 / 翻译 / 考试记录打包成一个 JSON 文件') +
      menuItemHTML('backup-panel-btn', '📁', '备份记录与恢复…', '查看上次备份去了哪个文件夹，并从文件夹里挑一份恢复') +
      menuItemHTML('restore-data-btn', '⬆', '从文件恢复…', '选择任意一份 reader-backup-*.json') +
      '<div class="menu-sep"></div><div class="menu-section-label">导出本篇</div>' +
      menuItemHTML('export-md-btn', '⬇', 'Markdown 笔记') +
      menuItemHTML('export-json-btn', '⬇', 'JSON（仅本篇标注）') +
      menuItemHTML('export-vocab-csv-btn', '📄', '生词 CSV（Anki）', '本篇生词本导出 CSV：词 / 释义 / 上下文，可导入 Anki 或 Excel') +
      menuItemHTML('print-btn', '🖨', '打印 / 存 PDF');

    // 5) 工具 —— 读的时候用得上
    const dueN = dueReviewCount();
    const toolMenu =
      '<div class="menu-section-label">查找</div>' +
      menuItemHTML('toggle-search-btn', '🔍', '全文搜索', '', 'Ctrl+F') +
      menuItemHTML('crossref-btn', '🔗', '文章关联', '其他文章里出现的同一批生词', '', '',
        '<span class="crossref-count" id="crossref-count"></span>') +
      menuItemHTML('stats-panel-btn', '📊', '阅读统计') +
      '<div class="menu-sep"></div><div class="menu-section-label">复习</div>' +
      menuItemHTML('review-due-btn', '🎯', dueN > 0 ? '今日待复习 ' + dueN + ' 条' : '复习生词（文库）', '到期生词与题型卡，跳转文库开始复习', '', dueN > 0 ? 'due-hot' : '') +
      '<div class="menu-sep"></div><div class="menu-section-label">写作积累</div>' +
      menuItemHTML('compose-panel-btn', '🖊', '建议文积累（全文）') +
      '<div class="menu-sep"></div><div class="menu-section-label">AI 助手（右侧分屏）</div>' +
      menuItemHTML('ai-zhipu-btn', '🤖', '智谱清言') +
      menuItemHTML('ai-qwen-btn', '🤖', '通义千问') +
      '<div class="menu-sep"></div><div class="menu-section-label">导航</div>' +
      menuItemHTML('hub-btn', '📚', '文库') +
      menuItemHTML('compare-btn', '🔀', '对比阅读');

    // 6) 组装：左边 视图 (+考试)，右边 数据 + 工具，各下拉都不超过 8 项
    const leftBtn = document.createElement('div');
    leftBtn.className = 'menu-trigger-wrap left';
    leftBtn.innerHTML = menuTriggerHTML('view', '⚙', '视图', '字号 / 主题 / 词频 / 撤销') +
      '<div class="menu-dropdown" id="menu-view">' + viewMenu + '</div>';
    const titleEl = toolbar.querySelector('.title');
    if (titleEl) toolbar.insertBefore(leftBtn, titleEl);
    else toolbar.appendChild(leftBtn);
    if (examSlug) {
      const examBtn = document.createElement('div');
      examBtn.className = 'menu-trigger-wrap left';
      examBtn.innerHTML = menuTriggerHTML('exam', '🎓', '考试', '模拟考试 / 翻译 / 完形 / 新题型') +
        '<div class="menu-dropdown" id="menu-exam">' + examMenu + '</div>';
      leftBtn.after(examBtn);
    }
    const rightWrap = toolbar.querySelector('.toolbar-right');
    const dataBtn = document.createElement('div');
    dataBtn.className = 'menu-trigger-wrap right';
    dataBtn.innerHTML = menuTriggerHTML('data', '💾', '数据', '备份 / 恢复 / 导出') +
      '<div class="menu-dropdown" id="menu-data">' + dataMenu + '</div>';
    const toolBtn = document.createElement('div');
    toolBtn.className = 'menu-trigger-wrap right';
    toolBtn.innerHTML = menuTriggerHTML('tool', '🧰', '工具', '搜索 / 统计 / AI / 导航') +
      '<div class="menu-dropdown" id="menu-tool">' + toolMenu + '</div>';
    if (rightWrap) { rightWrap.insertBefore(dataBtn, rightWrap.firstChild); rightWrap.appendChild(toolBtn); }
    else { toolbar.append(dataBtn, toolBtn); }

    // 7) 绑定行为
    const on = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => { closeAllMenus(); fn(); });
    };
    on('undo-edit-btn', undoEdit);
    on('shortcuts-help-btn', openShortcutsHelp);
    on('toggle-header-btn', toggleHeader); // 新菜单里的按钮没有 inline onclick，必须在这里绑
    on('backup-data-btn', () => { backupAllData(); });
    on('backup-panel-btn', openBackupPanel);
    on('restore-data-btn', restoreData);
    on('export-md-btn', exportMarkdown);
    on('export-json-btn', exportJson);
    on('export-vocab-csv-btn', exportVocabCsv);
    on('print-btn', () => window.print());
    on('toggle-search-btn', () => toggleSearch());
    on('crossref-btn', () => toggleCrossRef());
    on('stats-panel-btn', openStatsPanel);
    on('compose-panel-btn', openComposePanel);
    on('review-due-btn', openHub);
    on('ai-zhipu-btn', () => openAISide('zhipu'));
    on('ai-qwen-btn', () => openAISide('qwen'));
    on('hub-btn', openHub);
    on('compare-btn', openCompare);
    const freqBtn = document.getElementById('freq-toggle-btn');
    if (freqBtn) freqBtn.addEventListener('click', () => { toggleFreqColoring(); });
    if (examSlug) {
      on('open-exam-btn', () => { location.href = 'exam_' + examSlug + '.html'; });
      on('open-translation-btn', () => { location.href = 'translation_' + examSlug + '.html'; });
      on('open-cloze-btn', () => { location.href = 'cloze_' + examSlug + '.html'; });
      on('open-newtype-btn', () => { location.href = 'newtype_' + examSlug + '.html'; });
    }
    updateFreqBtn();
    injectExamModeToggle(examSlug);
  }
  // 考试页状态提示：在考试下拉里显示当前是考试态还是练习态（由 exam.js 写入 localStorage）
  function injectExamModeToggle(examSlug) {
    if (!examSlug) return;
    const btn = document.getElementById('open-exam-btn');
    if (!btn) return;
    let mode = 'exam';
    try { mode = JSON.parse(localStorage.getItem('exammode:' + examSlug) || '"exam"'); } catch (e) {}
    const label = btn.querySelector('span:nth-child(2)');
    if (label) label.textContent = '模拟考试（' + (mode === 'practice' ? '练习态' : '考试态') + '）';
  }

  // ===== Toolbar title cleanup: replace redundant title with source info =====
  function cleanupToolbarTitle() {
    const titleEl = document.querySelector('.toolbar .title');
    if (!titleEl || titleEl.dataset.cleaned) return;
    titleEl.dataset.cleaned = '1';
    Array.from(titleEl.childNodes).forEach(n => {
      if (n.nodeType === 3 && n.textContent.trim()) titleEl.removeChild(n);
    });
    const metaEl = document.querySelector('.title-block .meta');
    const source = metaEl ? metaEl.textContent.split('\u00a0')[0].trim() : '';
    const paraCount = document.querySelectorAll('.col-body.en p[data-para-idx]').length;
    const info = document.createElement('span');
    info.className = 'toolbar-info';
    info.textContent = [source, paraCount ? 'P' + paraCount : ''].filter(Boolean).join(' · ');
    titleEl.insertBefore(info, titleEl.firstChild);
  }

  // ===== AI assistants: open chat sites in a side window (split-screen style) =====
  function openAISide(which) {
    const targets = {
      zhipu:  { url: 'https://chatglm.cn/', name: 'ai_zhipu' },
      qwen:   { url: 'https://www.qianwen.com/', name: 'ai_qwen' }
    };
    const t = targets[which];
    if (!t) return;
    const availW = screen.availWidth || 1280, availH = screen.availHeight || 800;
    const w = Math.min(720, Math.floor(availW * 0.45));
    const win = window.open(t.url, t.name, 'width=' + w + ',height=' + availH + ',left=' + (availW - w) + ',top=0');
    if (!win) {
      showTopToast('⚠ 弹窗被浏览器拦截，请在地址栏右侧允许弹出窗口后重试');
      return;
    }
    try { win.moveTo(availW - w, 0); win.resizeTo(w, availH); } catch (e) {}
    showTopToast(which === 'zhipu' ? '🤖 已在右侧窗口打开智谱清言' : '🤖 已在右侧窗口打开通义千问');
  }

  // ===== Init =====
  document.addEventListener('DOMContentLoaded', () => {
    loadAll();
    // Check storage quota after load (deferred to avoid blocking first paint)
    setTimeout(checkStorageQuota, 2000);
    // 菜单先建好：#size-display / 主题行 / 词频按钮这些节点都活在菜单里，
    // 必须在应用设置之前存在
    buildMenus();
    // Apply settings
    document.documentElement.style.setProperty('--font-base', settings.fontSize + 'px');
    const sizeEl = document.getElementById('size-display');
    if (sizeEl) sizeEl.textContent = settings.fontSize + 'px';
    setTheme(settings.theme);
    document.querySelector('.notes-section').classList.toggle('collapsed', !settings.showNotes);
    applyLayout();
    cleanupToolbarTitle();
    // Init features
    initSummary();
    initTranslation();
    reapplyAllHighlights();
    renderNotes();
    updateNotesButtons();
    syncToRegistry();
    setupScrollSync();
    ensureExamUI();
    setupFloatMenu();
    setupSyntaxPanel();
    upgradeSyntaxPanel();
    upgradeMaterialPanel();
    // UX-6: defer first height sync to idle time (fallback: 250ms)
    deferInitialHeightSync();
    // 其余运行时注入（UX-3 移动端列切换条、UX-8 搜索选项等）——文章 HTML 本体不动
    injectSearchOptions();
    wireMarkClickLocate();
    setupNotesSearch();
    wireRootSuggest();
    if (freqModeOn()) ensureWordFreq(() => applyFreqColoring());
    setupEditUndo();
    setupMobileColBar();
    // Progress bar
    const enColBody = document.querySelector('.col-body.en');
    if (enColBody) enColBody.addEventListener('scroll', updateProgressBar, { passive: true });
    updateProgressBar();
    // Clock & reading timer
    tickClock();
    setInterval(tickClock, 1000);
    initTimer();
    initPositionTracking();
    // Initialize cross-ref count
    (function initCrossRef() {
      const refs = computeCrossRefs();
      const countEl = document.getElementById('crossref-count');
      if (countEl && refs.length > 0) {
        const uniqueTargets = new Set(refs.map(r => r.targetArticleId));
        countEl.textContent = uniqueTargets.size;
      }
    })();
    // Search input
    const searchInput = document.getElementById('search-input');
    let searchTimer = null;
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => doSearch(searchInput.value.trim()), 250);
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); searchNav(e.shiftKey ? -1 : 1); }
        if (e.key === 'Escape') { toggleSearch(); }
      });
    }
    // Ctrl+F override
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        const panel = document.getElementById('search-panel');
        if (!panel.classList.contains('visible')) toggleSearch();
        else document.getElementById('search-input').focus();
      }
    });
    // Arrow key navigation for vocab jump (↑/↓ when notes panel visible, not in input)
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (!settings.showNotes) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
      e.preventDefault();
      if (e.key === 'ArrowDown') jumpNext(); else jumpPrev();
    });
    // UX-6: debounce resize-triggered height re-sync (150ms) via scheduleHeightSync
    window.addEventListener('resize', () => {
      scheduleHeightSync(true);
      clearTimeout(resizeScrollTimer);
      resizeScrollTimer = setTimeout(() => { window.__resyncScroll && window.__resyncScroll(); }, 250);
    });
    initializing = false; // UX-5: operation toasts enabled after first load
    setTimeout(maybeRemindBackup, 4000); // 数据安全提醒（有积累且超 7 天未备份时）
  });

  // Expose handlers used by inline onclick
  window.changeSize = changeSize;
  window.setTheme = setTheme;
  window.toggleTheme = toggleTheme;
  window.toggleSummary = toggleSummary;
  window.toggleCN = toggleCN;
  window.toggleHeader = toggleHeader;
  window.toggleNotes = toggleNotes;
  window.openNotes = openNotes;
  window.resetSummary = resetSummary;
  window.resetTranslation = resetTranslation;
  window.clearAllAnnotations = clearAllAnnotations;
  window.exportMarkdown = exportMarkdown;
  window.exportJson = exportJson;
  window.extractVocab = extractVocab;
  window.resetAll = resetAll;
  window.toggleSearch = toggleSearch;
  window.searchNav = searchNav;
  // Exam-prep panel handlers (inline onclick)
  window.openSyntaxPanel = openSyntaxPanel;
  window.closeSyntaxPanel = closeSyntaxPanel;
  window.saveSyntax = saveSyntax;
  window.openMaterialPanel = openMaterialPanel;
  window.closeMaterialPanel = closeMaterialPanel;
  window.saveMaterial = saveMaterial;
  window.exportQtype = exportQtype;
  window.recordRoot = recordRoot;
  // ===== Dropdown Menu System =====
  function toggleMenu(side) {
    if (side === 'left') side = 'view';   // 兼容旧模板里的 inline onclick
    if (side === 'right') side = 'tool';
    const menu = document.getElementById('menu-' + side);
    const btn = document.getElementById('menu-' + side + '-btn');
    if (!menu || !btn) return;
    const wasOpen = menu.classList.contains('visible');
    closeAllMenus();
    if (wasOpen) return;
    updateMenuActive();
    positionMenu(menu, btn);
    menu.classList.add('visible');
    btn.classList.add('open');
  }
  // 下拉贴在触发按钮下方；贴边时向内收，绝不超出工具栏宽度
  function positionMenu(menu, btn) {
    const bar = btn.closest('.toolbar');
    if (!bar) { menu.style.left = '0'; return; }
    const bb = bar.getBoundingClientRect();
    const xb = btn.getBoundingClientRect();
    const mw = menu.offsetWidth || 240;
    let left = xb.left - bb.left;
    if (left + mw > bb.width - 8) left = bb.width - mw - 8;
    if (left < 8) left = 8;
    menu.style.left = Math.round(left) + 'px';
    menu.style.right = 'auto';
  }

  function closeAllMenus() {
    document.querySelectorAll('.menu-dropdown').forEach(m => m.classList.remove('visible'));
    document.querySelectorAll('.toolbar-btn').forEach(b => b.classList.remove('open'));
  }

  function updateMenuActive() {
    const pairs = [
      ['toggle-summary-btn', 'summaryVisible'],
      ['toggle-cn-btn', 'cnVisible'],
      ['toggle-header-btn', 'headerVisible'],
      ['toggle-notes-btn', 'notesVisible']
    ];
    pairs.forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (!el) return;
      let visible = false;
      if (key === 'summaryVisible') visible = !document.querySelector('.summary-col')?.classList.contains('hidden');
      else if (key === 'cnVisible') visible = !document.querySelector('.col-body.cn')?.closest('.col')?.classList.contains('hidden');
      else if (key === 'headerVisible') visible = !document.querySelector('.header')?.classList.contains('collapsed');
      else if (key === 'notesVisible') visible = !document.querySelector('.notes-section')?.classList.contains('collapsed');
      el.classList.toggle('active', visible);
    });
    // 当前主题在「视图」菜单里高亮出来
    const theme = document.documentElement.getAttribute('data-theme') || settings.theme;
    document.querySelectorAll('#menu-view .menu-theme-row button').forEach(b => {
      b.classList.toggle('active', /setTheme\('([a-z]+)'\)/.test(b.getAttribute('onclick') || '') &&
        RegExp.$1 === theme);
    });
  }

  // Close menus on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-dropdown') && !e.target.closest('.toolbar-btn')) {
      closeAllMenus();
    }
  });

  window.toggleMenu = toggleMenu;
  window.updateMenuActive = updateMenuActive;

  window.openHub = openHub;
  window.openCompare = openCompare;
  window.toggleCrossRef = toggleCrossRef;
  window.navigateToRef = navigateToRef;
  window.jumpToLastPosition = jumpToLastPosition;
  window.jumpNext = jumpNext;
  window.jumpPrev = jumpPrev;
})();
