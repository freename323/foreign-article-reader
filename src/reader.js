(function() {
  // ===== 资源版本戳 =====
  // reader.js 由 <script src="reader.js?v=..."> 引入。在解析期把它自己的 ?v= 记下来，
  // 供之后动态插入的懒加载脚本（exam-panel.js / wordfreq.js）复用。
  // 否则这两个文件的改动永远不会失效浏览器缓存 —— 典型「改了代码但页面还是旧的」。
  const ASSET_V = (function() {
    try {
      const s = document.currentScript ||
        document.querySelector('script[src*="reader.js"]');
      const m = s && s.src && s.src.match(/[?&]v=([^&#]+)/);
      return m ? '?v=' + m[1] : '';
    } catch (e) { return ''; }
  })();

  // ===== 文章元数据（唯一 ID 来源，取代旧 EXAM_SLUGS「文件名 → slug」硬编码映射表）=====
  // 文章 <body> 上的 data-edition / data-has-exam / data-exam-types 由构建脚本写入，
  // 与每篇配色（reader.css 的 body[data-edition=...]）共用同一份数据。
  // 这样新增文章只需写对 HTML 属性，无需改任何 JS、无需重新维护映射表。
  const articleMeta = (function() {
    const ds = (document.body && document.body.dataset) || {};
    return {
      slug: (ds.edition || '').trim(),                 // 栏目 ID（如 ai_cost），用于考试/练习页寻址
      hasExam: ds.hasExam === 'true',                  // 是否显示「考试」菜单（缺失即不显示）
      examTypes: (ds.examTypes || '').split(',').map(s => s.trim()).filter(Boolean)
    };
  })();
  // 注意：articleId 是 localStorage key 后缀，语义恒为「页面文件名（含 .html）」。
  // 它决定存量标注 / 概要 / 翻译 / 阅读记录的归属，改动会导致数据失联，故保持不变。
  const articleId = location.pathname.split('/').pop() || 'article';
  const ANNO_KEY = 'annotations:' + articleId;
  const SUM_KEY = 'summary:' + articleId;
  const TRANS_KEY = 'translation:' + articleId;
  const SETTINGS_KEY = 'settings:' + articleId;
  let annotations = [];
  let summaryData = {};
  let translationData = {};
  let settings = { theme: 'green', fontSize: 16, showSummary: true, showCN: true, showNotes: true, showHeader: true, mobileMode: 'both',
    view: 'paper',         // 阅读模式默认就是报纸版（'reader' 可切回三栏对照）
    paperCn: true,         // 报纸版是否显示中文对照页
    paperFont: 16.5 };     // 报纸版正文字号
  let initializing = true; // UX-5: suppress operation toasts during first load
  const mobileQuery = window.matchMedia ? window.matchMedia('(max-width: 860px)') : { matches: false }; // UX-3/UX-6

  // ===== Util =====
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function unesc(s) { return String(s == null ? '' : s).replace(/&(amp|lt|gt|quot|#39);/g, c => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[c])); }
  function genId() { return Date.now() + '-' + Math.random().toString(36).slice(2, 8); }
  function localDateStr(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

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

  // ===== Toast (shared with exam-panel.js) =====
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

  // ===== Lazy-load exam-panel.js (49KB, only when exam/material features are used) =====
  let _examLoading = null;
  function loadExamPanel() {
    if (window.__exam) return Promise.resolve(window.__exam);
    if (_examLoading) return _examLoading;
    _examLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'exam-panel.js' + ASSET_V;
      s.onload = () => resolve(window.__exam);
      s.onerror = () => { _examLoading = null; reject(new Error('exam-panel.js failed to load')); };
      document.head.appendChild(s);
    });
    return _examLoading;
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
    if (!w) return;                       // 页面骨架缺失时不再抛 TypeError（保持与其它分支一致的容错）
    w.classList.toggle('no-summary', !settings.showSummary);
    w.classList.toggle('no-cn', !settings.showCN);
    const sumBtn = document.getElementById('toggle-summary-btn');
    if (sumBtn) sumBtn.classList.toggle('active', settings.showSummary);
    const cnBtn = document.getElementById('toggle-cn-btn');
    if (cnBtn) cnBtn.classList.toggle('active', settings.showCN);
    const notesBtn = document.getElementById('toggle-notes-btn');
    if (notesBtn) notesBtn.classList.toggle('active', settings.showNotes);
    const hdr = document.querySelector('.header');
    if (hdr) hdr.classList.toggle('collapsed', !settings.showHeader);
    const hdrBtn = document.getElementById('toggle-header-btn');
    if (hdrBtn) hdrBtn.classList.toggle('active', settings.showHeader);
    // 报纸阅读页有自己的一套版面容器，显隐要同步过去
    if (typeof paperApplyLayout === 'function') paperApplyLayout();
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
  // Bucket: 'vocab'（生词本）| 'note'（笔记）| 'misread'（理解偏差，F16）| 'qtype'（题型）
  // 'paraFunc'（段落功能，F02）不是文本标注，是段落级元数据，渲染与计数都要排除它。
  // ⚠ type → bucket 的映射只能在这里做：addAnnotation 是浮动菜单所有普通标注的唯一入口，
  //   漏一个 type 就会被默认归到 vocab（曾导致「理解偏差」进了生词本）。
  const ANNOTATION_BUCKETS = { note: 'note', misread: 'misread', vocab: 'vocab' };
  function addAnnotation(type, text, context, note, source, paraIdx, line) {
    if (!text || !text.trim()) return;
    const dup = annotations.find(a => a.text === text && a.source === source);
    if (dup) { flashNote(dup.id); return; }
    const bucket = ANNOTATION_BUCKETS[type] || 'vocab';
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
    const pred = (window.__exam && window.__exam.matchesAllFilters) || (() => true);
    const filtered = bucketAnns.filter(pred);
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
    // Ensure exam-panel.js loaded (provides tag filters, qtype cards, etc.)
    if (!window.__exam && !list.dataset.examLoading) {
      list.dataset.examLoading = '1';
      loadExamPanel().then(() => { list.dataset.examLoading = ''; renderNotes(); }).catch(()=>{});
    }
    // Tabs
    const vocabCount = annotations.filter(a => a.bucket === 'vocab').length;
    const noteCount = annotations.filter(a => a.bucket === 'note').length;
    const qtypeCount = annotations.filter(a => a.bucket === 'qtype').length;
    const misreadCount = annotations.filter(a => a.bucket === 'misread').length;
    const sessionCount = (readingData.sessions || []).length;
    const allCount = annotations.filter(a => a.bucket !== 'paraFunc').length;
    let tabsHtml = `<div class="notes-tabs">
      <button data-notes-bucket="vocab" class="${notesBucket === 'vocab' ? 'active' : ''}">📖 生词本 ${vocabCount > 0 ? '(' + vocabCount + ')' : ''}</button>
      <button data-notes-bucket="note" class="${notesBucket === 'note' ? 'active' : ''}">📝 笔记 ${noteCount > 0 ? '(' + noteCount + ')' : ''}</button>
      <button data-notes-bucket="qtype" class="${notesBucket === 'qtype' ? 'active' : ''}">🎓 题型 ${qtypeCount > 0 ? '(' + qtypeCount + ')' : ''}</button>
      <button data-notes-bucket="misread" class="${notesBucket === 'misread' ? 'active' : ''}" title="阅读时读错、译错、想岔的地方 —— 这些是最高价值的复习点">🌀 理解偏差 ${misreadCount > 0 ? '(' + misreadCount + ')' : ''}</button>
      <button data-notes-bucket="all" class="${notesBucket === 'all' ? 'active' : ''}">全部 ${allCount > 0 ? '(' + allCount + ')' : ''}</button>
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
    // Qtype (题型) tab — lazy-load exam-panel.js on first access
    if (notesBucket === 'qtype') {
      if (!window.__exam) {
        list.innerHTML = tabsHtml + '<div class="empty-hint">⏳ 加载题型引擎…</div>';
        loadExamPanel().then(() => renderNotes()).catch(()=>{});
        return;
      }
      list.innerHTML = tabsHtml + window.__exam.renderQtypeList();
      // Tab buttons
      list.querySelectorAll('[data-notes-bucket]').forEach(btn => {
        btn.addEventListener('click', () => setNotesBucket(btn.dataset.notesBucket));
      });
      // Delete buttons
      list.querySelectorAll('[data-del]').forEach(el => {
        el.addEventListener('click', () => deleteAnnotation(el.dataset.del));
      });
      window.__exam.wireQtypeInteractions(list);
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
    // ⚠ paraFunc（段落功能标签）是**段落级**的元数据，不是文本标注：
    //   它没有选中文本、不该出现在标注列表里，由「工具 → 段落功能标签」面板单独管理。
    const visibleAnns = annotations.filter(a => a.bucket !== 'paraFunc');
    const bucketAnns = notesBucket === 'all' ? visibleAnns : visibleAnns.filter(a => a.bucket === notesBucket);
    if (bucketAnns.length === 0) {
      list.innerHTML = tabsHtml + `<div class="empty-hint">${notesBucket === 'vocab' ? '生词本' : '笔记'}还是空的。<br>选中文本 → 选类型 → 标注会出现在这里。</div>`;
      list.querySelectorAll('[data-notes-bucket]').forEach(btn => {
        btn.addEventListener('click', () => setNotesBucket(btn.dataset.notesBucket));
      });
      return;
    }
    // Tag filter row (only rendered when tags exist) + combined filters
    const tagFilterHtml = window.__exam ? window.__exam.renderTagFilterRow(bucketAnns) : '';
    const filtered = bucketAnns.filter(window.__exam ? window.__exam.matchesAllFilters : () => true);
    if (filtered.length === 0) {
      list.innerHTML = tabsHtml + tagFilterHtml + '<div class="empty-hint">没有符合当前筛选条件的标注。<br>点击上方标签可调整筛选。</div>';
      list.querySelectorAll('[data-notes-bucket]').forEach(btn => {
        btn.addEventListener('click', () => setNotesBucket(btn.dataset.notesBucket));
      });
      wireTagInteractionsSafe(list);
      updateJumpNav();
      return;
    }
    const typeName = { vocab: '📖 生词', unclear: '❓ 不懂', note: '💡 备注', misread: '🌀 理解偏差' };
    const sorted = filtered.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const groups = groupByDate(sorted);
    let cardsHtml = '';
    groups.forEach(g => {
      cardsHtml += `<div class="notes-date-header date-count">${g.label}<span>${g.items.length} 条</span></div>`;
      cardsHtml += g.items.map(a => {
        if (a.bucket === 'qtype' && window.__exam) return window.__exam.renderQtypeCard(a, window.__exam.QTYPE_META[a.qtype] || window.__exam.QTYPE_META.detail);
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
    wireQtypeSafe(list);
    updateJumpNav();
  }
  function wireTagInteractionsSafe(scope) { if (window.__exam) window.__exam.wireTagInteractions(scope); }
  function wireQtypeSafe(scope) { if (window.__exam) window.__exam.wireQtypeInteractions(scope); }
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
        ${window.__exam ? window.__exam.renderTagRow(a) : ''}
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
        ${window.__exam ? window.__exam.renderTagRow(a) : ''}
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
    // 与笔记面板的「全部」页签保持一致：段落功能标签是段落级元数据，不计入标注条数
    if (el) {
      const n = annotations.filter(a => a.bucket !== 'paraFunc').length;
      el.textContent = n > 0 ? n : '';
    }
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

﻿  // ===== Sync EN/CN blockquote heights (sidebar before paragraph 1) =====
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
    // 报纸阅读页：每版由分版算法独立排版，跨列强行等高既不适用、又会污染分版测量
    if (typeof paperIsOpen === 'function' && paperIsOpen()) {
      clearForcedHeights();
      lastSyncedWidth = -1;
      return;
    }
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
      // 报纸阅读页：EN / CN 是同一版的对开两页，不存在独立纵向滚动，同步无意义
      if (typeof paperIsOpen === 'function' && paperIsOpen()) return;
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
      // 报纸阅读页靠重新分版响应布局变化（字号 / 栏宽变了，版次边界也要重算）
      if (typeof paperIsOpen === 'function' && paperIsOpen()) {
        if (typeof window.__paperRepaginate === 'function') window.__paperRepaginate();
        return;
      }
      doHeightSync(true);
      en.dispatchEvent(new Event('scroll'));
    };
  }

  // ===== Exam-prep UI injection (article HTML stays untouched) =====
  function ensureExamUI() {
    if (!window.__exam) return; // exam-panel.js not loaded yet; called again after load
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
        { act: 'root', icon: '🌱', title: '记入词根库' },
        // F16：把「我读错了」也当成一种标注 —— 它和生词一样是复习材料，
        // 但语义是「理解偏差」，bucket 独立，笔记面板有单独页签
        { act: 'misread', icon: '🌀', title: '理解偏差（我读错了）' },
        // F08：选中一个词 → 记它的同义替换（写作时直接用）
        { act: 'synonym', icon: '🔁', title: '同义替换' }
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
      window.__exam.QTYPE_ORDER.forEach(q => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.qact = q;
        b.textContent = window.__exam.QTYPE_META[q].label;
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
      sp.querySelector('[data-close]').addEventListener('click', () => window.__exam.closeSyntaxPanel());
      sp.querySelector('[data-cancel]').addEventListener('click', () => window.__exam.closeSyntaxPanel());
      sp.querySelector('[data-save]').addEventListener('click', () => window.__exam.saveSyntax());
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
      mp.querySelector('[data-close]').addEventListener('click', () => window.__exam.closeMaterialPanel());
      mp.querySelector('[data-cancel]').addEventListener('click', () => window.__exam.closeMaterialPanel());
      mp.querySelector('[data-save]').addEventListener('click', () => window.__exam.saveMaterial());
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
      rp.querySelector('[data-close]').addEventListener('click', () => window.__exam.closeRootPanel());
      rp.querySelector('[data-cancel]').addEventListener('click', () => window.__exam.closeRootPanel());
      rp.querySelector('[data-save]').addEventListener('click', () => window.__exam.saveRootCard(false));
      rp.querySelector('[data-again]').addEventListener('click', () => window.__exam.saveRootCard(true));
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
      cp.querySelector('[data-close]').addEventListener('click', () => window.__exam.closeComposePanel());
      cp.querySelector('[data-cancel]').addEventListener('click', () => window.__exam.closeComposePanel());
      cp.querySelector('[data-add]').addEventListener('click', () => window.__exam.addComposeEntry());
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
            loadExamPanel().then(E => E.openSyntaxPanel(info.text, info.paraIdx));
            window.getSelection().removeAllRanges(); hideMenu();
          } else if (act === 'material') {
            loadExamPanel().then(E => E.openMaterialPanel(info.text, info.paraIdx));
            window.getSelection().removeAllRanges(); hideMenu();
          } else if (act === 'root') {
            loadExamPanel().then(E => E.openRootPanel(info.text, info.paraIdx));
            window.getSelection().removeAllRanges(); hideMenu();
          } else if (act === 'synonym') {
            // F08：写作工坊的「同义替换」页签。走 window.__exam 桥（面板在 exam-panel.js 里）
            loadExamPanel().then(E => E.openSynonymPanel && E.openSynonymPanel(info.text));
            window.getSelection().removeAllRanges(); hideMenu();
          } else {
            addAnnotation(act, info.text, info.context, '', info.source, info.paraIdx, info.line);
            window.getSelection().removeAllRanges(); hideMenu();
          }
        };
      });
      menu.querySelectorAll('button[data-qact]').forEach(btn => {
        btn.onclick = () => {
          // addQtypeAnnotation lives in 06-exam.js (lazy-loaded as exam-panel.js).
          // Bridge: invoke through window.__exam if ready, otherwise load & retry.
          const fire = () => window.__exam && window.__exam.addQtypeAnnotation(btn.dataset.qact, info.text, info.context, info.paraIdx);
          if (!fire()) {
            loadExamPanel().then(() => fire());
          }
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
    const title = document.querySelector('.title-block h1:not(.cn)')?.textContent || 'article';    const cnTitle = document.querySelector('.title-block h1.cn')?.textContent || '';
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
        const typeLabel = a.type || (a.bucket === 'qtype' ? (((window.__exam && window.__exam.QTYPE_META) || {})[a.qtype] || {}).label || '题型' : 'note');
        lines.push(`- **${where}** [${typeLabel}] ${a.text}`);
        if (a.note) lines.push(`  - Note: ${a.note}`);
        if (a.context) lines.push(`  - Context: ${a.context}`);
      });
    }
    const md = lines.join('\n');
    saveFile(`${title} - notes.md`, md, 'text/markdown;charset=utf-8').then(r => {
      showTopToast(saveResultToast(r), r.where === 'folder' ? 3000 : 7000);
    });
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
    saveFile((data.title || 'article') + ' - notes.json',
      JSON.stringify(data, null, 2), 'application/json;charset=utf-8').then(r => {
      showTopToast(saveResultToast(r), r.where === 'folder' ? 3000 : 7000);
    });
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
    saveFile(name, csv, 'text/csv;charset=utf-8').then(r => {
      showTopToast(saveResultToast(r, '已导出 ' + sorted.length + ' 个生词') +
        (r.where === 'folder' ? '' : '（Anki/Excel 可导入）'), r.where === 'folder' ? 3200 : 7000);
    });
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
    const slug = articleMeta.slug;
    if (slug) ['examhl:', 'examq:', 'examtimer:', 'examlimit:'].forEach(p => keys.push(p + slug));
    keys.forEach(k => localStorage.removeItem(k));
    showTopToast('已清空本篇数据');
    setTimeout(() => location.reload(), 600);
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
    // 只写时间本身，标签交给 CSS（报纸版读作「已读 / 累计」，三栏视图读作 ⏱ / 📊）
    if (se) {
      se.textContent = fmtTime(sessionSeconds);
      se.title = '本次阅读时长 ' + fmtTime(sessionSeconds);
    }
    if (te) {
      te.textContent = fmtTime(readingData.totalSeconds);
      te.title = '累计阅读时长 ' + fmtTime(readingData.totalSeconds);
    }
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
  // 记录的是「段号 data-para-idx」而非位置序号 —— 报纸阅读页会把段落分到不同版，
  // 位置序号会随分版结果漂移，段号才稳定。
  function getCurrentPosition() {
    // 报纸阅读页：位置 = 当前版第一段的段号
    if (typeof paperIsOpen === 'function' && paperIsOpen()) {
      return (typeof paperCurrentParaIdx === 'function') ? paperCurrentParaIdx() : null;
    }
    const enCol = document.querySelector('.main-wrap .col-body.en') || document.querySelector('.col-body.en');
    if (!enCol) return null;
    const paras = enCol.querySelectorAll('p[data-para-idx]');
    if (paras.length === 0) return null;
    const colTop = enCol.getBoundingClientRect().top;
    let best = null;
    paras.forEach((p) => {
      const rect = p.getBoundingClientRect();
      if (rect.top <= colTop + 80) best = parseInt(p.dataset.paraIdx, 10);
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
    // 报纸阅读页：先翻到含该段的那一版，再高亮该段
    if (typeof paperIsOpen === 'function' && paperIsOpen()) {
      const idx = readingData.lastPosition;
      if (typeof window.paperGotoParaIdx === 'function') window.paperGotoParaIdx(idx);
      const el = document.querySelector('.np-leaf-en p[data-para-idx="' + idx + '"]');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.outline = '2px solid var(--cn-tag)';
        el.style.outlineOffset = '2px';
        setTimeout(() => { el.style.outline = 'none'; }, 2500);
      }
      const bb = document.getElementById('bookmark-btn');
      if (bb) bb.style.display = 'none';
      return;
    }
    const enCol = document.querySelector('.main-wrap .col-body.en') || document.querySelector('.col-body.en');
    if (!enCol) return;
    const el = enCol.querySelector('p[data-para-idx="' + readingData.lastPosition + '"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.style.outline = '2px solid var(--cn-tag)';
      el.style.outlineOffset = '2px';
      el.style.transition = 'outline 0.3s';
      setTimeout(() => { el.style.outline = 'none'; }, 2500);
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
  // ⚠ 新增独立键时**必须**加进这两个白名单，否则备份会静默漏掉它（不报错、只是丢数据）。
  //   曾经就漏过——完形 / 新题型 / 翻译三个模块的错题库（wsj_cloze / wsj_newtype /
  //   wsj_translation）一直是写了但没备份，错题本的 4 个库里只有 1 个进得了备份文件。
  const BACKUP_EXACT_KEYS = ['wsj_writing:materials', 'wsj_writing:advice', 'wsj_roots:cards',
    // 写作工坊：作文模板库 + 大小作文草稿 + 自由笔记（F05/F06/F17）+ 同义替换表（F08）
    'wsj_writing:templates', 'wsj_writing:essays', 'wsj_writing:notes', 'wsj_writing:synonyms',
    'wsj_exam:wrongs', 'wsj_exam:overtime', 'wsj_exam:history', 'wsj_exam:theme',
    // 三个练习页自己的错题库（错题本会把它们和 wsj_exam:wrongs 合并成一张清单）
    'wsj_cloze:wrongs', 'wsj_newtype:wrongs', 'wsj_translation:wrongs',
    // 错题本的复习调度（间隔重复）—— 11-insights.js
    'wsj_wrongrev',
    // 中译英默写：每题成绩 + 错词本 —— 12-dictation.js
    'wsj_dictation:stats', 'wsj_dictation:wrongs'];
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
  // ⚠ 这两个 key 历史上都被误写成同一个字面量 '***'：
  //   * 「备份记录」与「备份文件夹名」互相覆盖——写一个就冲掉另一个；
  //   * 与读取端 parseLS（走 JSON.parse）的约定不一致，文件夹名永远读不回来。
  // 现改为独立 key，并做一次幂等抢救迁移。
  const BACKUP_LOG_KEY = 'wsj_reader:backupLog';
  const BACKUP_DIR_NAME_KEY = 'wsj_reader:backupDirName';
  // 句柄没能存进 IndexedDB 时置位：这次会话能用，重启后还得重选。要如实告诉用户，
  // 否则会出现「明明设过，下次又下载」这种静默失效。
  const BACKUP_DIR_VOLATILE_KEY = 'wsj_reader:backupDirVolatile';
  const BACKUP_LEGACY_KEY = '***';
  (function migrateLegacyBackupKeys() {
    let legacy = null;
    try { legacy = localStorage.getItem(BACKUP_LEGACY_KEY); } catch (e) { return; }
    if (!legacy) return;
    let parsed = null, isJson = true;
    try { parsed = JSON.parse(legacy); } catch (e) { isJson = false; }
    try {
      if (isJson && Array.isArray(parsed)) {
        if (!localStorage.getItem(BACKUP_LOG_KEY)) localStorage.setItem(BACKUP_LOG_KEY, legacy);
      } else {
        // 旧代码写入文件夹名时没有 JSON.stringify，故非 JSON 的裸串也按文件夹名抢救
        const name = (isJson && typeof parsed === 'string') ? parsed : (isJson ? null : legacy);
        if (name && !localStorage.getItem(BACKUP_DIR_NAME_KEY)) {
          localStorage.setItem(BACKUP_DIR_NAME_KEY, JSON.stringify(name));
        }
      }
    } catch (e) {}
    try { localStorage.removeItem(BACKUP_LEGACY_KEY); } catch (e) {}
  })();
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
  // ⚠ 任何一次 IDB 调用都必须有超时：IndexedDB 在部分环境（file:// 的某些浏览器版本、
  //   隐私模式、被策略禁用）会**既不成功也不失败**，直接挂住。挂住的后果是
  //   saveFile 卡在 await 上 —— 用户点「导出」什么都不会发生，比下载更糟。
  function withTimeout(p, ms, fallback) {
    return Promise.race([
      p.catch(() => fallback),
      new Promise(r => setTimeout(() => r(fallback), ms))
    ]);
  }
  function dirPickerSupported() {
    return typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined';
  }
  // 句柄缓存 + 权限记忆：保证「点导出」到「真的要写盘」之间不夹多余的 await。
  // 原因：requestPermission 依赖「用户激活」（transient activation），中间多一次
  // IndexedDB 往返就可能把它耗掉，于是明明授权过却每次都要重新问。
  let dirHandleCache = null;
  let dirPermOk = false;
  async function getBackupDir() {
    if (!dirPickerSupported()) return null;
    if (dirHandleCache) return dirHandleCache;
    const h = await withTimeout(idbGet('backupDir'), 700, null);
    if (h) dirHandleCache = h;
    return h || null;
  }
  async function pickBackupDir() {
    const h = await window.showDirectoryPicker({ id: 'reader-backup-dir', mode: 'readwrite' });
    // 先把句柄放进内存缓存：即使下面 IDB 写失败，本次会话内的导出也已经能直写了
    dirHandleCache = h; dirPermOk = true;
    // 句柄只能存 IndexedDB（localStorage 存不了对象句柄）
    const persisted = await withTimeout(idbPut(h, 'backupDir').then(() => true), 1500, false);
    try {
      // 必须 JSON.stringify：读取端用 parseLS（JSON.parse），裸串会解析失败而永远显示不出来
      localStorage.setItem(BACKUP_DIR_NAME_KEY, JSON.stringify(h.name || ''));
      if (persisted) localStorage.removeItem(BACKUP_DIR_VOLATILE_KEY);
      else localStorage.setItem(BACKUP_DIR_VOLATILE_KEY, JSON.stringify('1'));
    } catch (e) {}
    return h;
  }
  function backupDirVolatile() { return parseLS(BACKUP_DIR_VOLATILE_KEY, '') === '1'; }
  function forgetBackupDir() {
    dirHandleCache = null; dirPermOk = false;
    try { localStorage.removeItem(BACKUP_DIR_NAME_KEY); } catch (e) {}
    try { localStorage.removeItem(BACKUP_DIR_VOLATILE_KEY); } catch (e) {}
    try { withTimeout(idbPut(null, 'backupDir'), 1500, false); } catch (e) {}
  }
  async function ensureDirPermission(h) {
    if (!h || !h.queryPermission) return true;
    if (dirPermOk && h === dirHandleCache) return true;
    const d = { mode: 'readwrite' };
    try {
      if (await h.queryPermission(d) === 'granted') { dirPermOk = true; return true; }
      const ok = (await h.requestPermission(d)) === 'granted';
      if (ok) dirPermOk = true;
      return ok;
    } catch (e) { return false; }
  }
  // ---- 文件名净化：走文件夹直写时，非法字符不再由浏览器兜底，会直接抛异常 ----
  function sanitizeFilename(name) {
    let n = String(name == null ? '' : name)
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')      // Windows 非法字符（导出标题里最常见的冒号）
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')                              // 不能以点开头
      .replace(/[. ]+$/, '');                           // Windows 不允许以点/空格结尾
    if (!n) n = 'untitled';
    const m = /^(.*?)(\.[A-Za-z0-9]{1,8})$/.exec(n);
    const base = m ? m[1] : n, ext = m ? m[2] : '';
    n = (base.length > 80 ? base.slice(0, 80) : base) + ext;
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) n = '_' + n;
    return n;
  }
  // 已存在就换名（导出同一篇两次不该互相覆盖，也不该静默丢内容）
  async function uniqueFileName(dir, name) {
    const m = /^(.*?)(\.\w{1,8})?$/.exec(name);
    const base = m[1], ext = m[2] || '';
    for (let i = 1; i <= 20; i++) {
      const cand = i === 1 ? name : base + ' (' + i + ')' + ext;
      try { await dir.getFileHandle(cand); }
      catch (e) { return cand; }   // 取不到 = 不存在 = 这个能用
    }
    return base + ' (' + Date.now() + ')' + ext;
  }
  // ---- 统一落盘入口：所有导出 / 备份都走这里 ----
  // Web 平台刻意不允许网页自行决定保存路径（防静默写盘），只有 File System Access
  // 拿到用户亲手授权过的目录句柄才能直写。所以：
  //   有句柄  → 直接写进那个文件夹（不再走浏览器下载）
  //   无句柄  → 退回下载，并明确告诉用户去哪儿找、怎么固定位置
  async function saveFile(name, text, type, opts) {
    const o = opts || {};
    const safe = sanitizeFilename(name);
    if (dirPickerSupported()) {
      let dir = null;
      try {
        dir = await getBackupDir();
        if (dir && !(await withTimeout(ensureDirPermission(dir), 1200, false))) dir = null;
      } catch (e) { dir = null; }
      if (dir) {
        try {
          const target = o.overwrite ? safe : await uniqueFileName(dir, safe);
          await writeToDir(dir, target, text);
          return { where: 'folder', dir: dir.name || '所选文件夹', name: target, renamed: target !== safe };
        } catch (e) {
          // 写失败（权限被撤、文件被占用、句柄过期）→ 降级下载，但把原因说清楚
          o.fallbackReason = (e && e.message) ? e.message : String(e);
        }
      }
    }
    downloadFile(safe, text, type || 'text/plain;charset=utf-8');
    return { where: 'download', dir: '浏览器下载文件夹', name: safe, renamed: safe !== name, reason: o.fallbackReason || '' };
  }
  // 保存结果 → 一句用户看得懂的话
  function saveResultToast(r, verb) {
    const v = verb || '已保存';
    if (r.where === 'folder') {
      return '✅ ' + v + '到文件夹「' + r.dir + '」／' + r.name + (r.renamed ? '（重名已自动编号）' : '');
    }
    return '⬇ ' + v + '，但走的是浏览器下载 → 请到「下载」文件夹找 ' + r.name +
      (r.reason ? '（写入文件夹失败：' + r.reason + '）' : '') +
      '\n要固定存放位置：数据 ▾ → 📂 设置保存文件夹（选一次，以后都写进去）';
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
    // 备份与导出共用一条落盘路径；唯一区别是「没设过文件夹时先弹一次选择器」
    // （备份是低频、明确的数据安全动作，值得打断一次；导出天天用，不适合每次弹）
    if (dirPickerSupported()) {
      let dir = null;
      try { dir = await getBackupDir(); } catch (e) { dir = null; }
      if (dir && !(await ensureDirPermission(dir))) dir = null;
      if (!dir) {
        try { dir = await pickBackupDir(); }
        catch (e) {
          if (e && e.name === 'AbortError') { showTopToast('已取消备份'); return; }
          dir = null;
        }
      }
    }
    const r = await saveFile(name, text, 'application/json;charset=utf-8');
    // 备份固定覆盖同一分钟的重名文件（saveFile 默认改名为 xxx (2).json —— 备份宁可多留一份也不覆盖）
    try { localStorage.setItem('wsj_reader:lastBackupAt', JSON.stringify(new Date().toISOString())); } catch (e) {}
    logBackup({ at: new Date().toISOString(), file: r.name,
      where: r.where === 'folder' ? 'folder' : 'download',
      dir: r.where === 'folder' ? r.dir : '浏览器下载文件夹',
      size: backupSizeText(payload), keys: Object.keys(payload.data).length });
    if (r.where === 'folder') showTopToast('✅ 已备份到文件夹「' + r.dir + '」／' + r.name + '（下次一键备份到同一处）', 5200);
    else showTopToast(saveResultToast(r, '已备份') + (r.reason ? '' : '\n（备份是低频操作，建议先选一次文件夹）'), 7000);
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
  // 「设置保存文件夹」：把所有导出动作的落点从「浏览器下载文件夹」改到用户指定的文件夹
  function openSaveDirDialog() {
    closeAllMenus();
    const old = document.getElementById('save-dir-overlay');
    if (old) old.remove();
    const saved = parseLS(BACKUP_DIR_NAME_KEY, '');
    const sup = dirPickerSupported();
    const overlay = document.createElement('div');
    overlay.className = 'backup-overlay';
    overlay.id = 'save-dir-overlay';
    overlay.innerHTML =
      '<div class="backup-box">' +
      '<div class="bk-head"><h3>📂 文件保存位置</h3><button type="button" class="bk-close" title="关闭">✕</button></div>' +
      '<div class="bk-facts">' +
      '<div><span class="bk-k">当前</span><span class="bk-v">' +
      esc(saved || (sup ? '未设置 —— 导出会进浏览器默认的「下载」文件夹' : '浏览器不支持，只能用「下载」文件夹')) +
      (saved && backupDirVolatile() ? '（本机存不住句柄，重开页面后要重选一次）' : '') + '</span></div>' +
      '<div><span class="bk-k">会跟着变的</span><span class="bk-v">Markdown 笔记 / JSON / 生词 CSV / 作文 / 模板 / 同义表 / 全部数据备份</span></div>' +
      '</div>' +
      '<div class="bk-actions">' +
      (sup ? '<button type="button" class="bk-btn primary" data-act="pick">' + (saved ? '更换文件夹' : '选择文件夹') + '</button>' : '') +
      (saved ? '<button type="button" class="bk-btn" data-act="forget">清除保存位置</button>' : '') +
      '<button type="button" class="bk-btn" data-act="close">关闭</button>' +
      '</div>' +
      '<div class="bk-note">浏览器出于安全不允许网页自己决定保存路径（否则任何网页都能往你的磁盘里塞文件），' +
      '所以只能由你亲手选一次。选过之后本机记住这个文件夹，之后所有导出与备份都直接写进去，不再走下载。' +
      (sup ? '' : '<br>当前浏览器不支持选文件夹：可到浏览器「设置 → 下载」里改默认下载目录作为替代。') +
      '</div></div>';
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    const refreshLabel = () => {
      const btn = document.getElementById('save-dir-btn');
      if (!btn) return;
      const spans = btn.querySelectorAll('span');
      if (spans[1]) spans[1].textContent = saveDirMenuLabel();
    };
    overlay.querySelector('.bk-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const pick = overlay.querySelector('[data-act="pick"]');
    if (pick) pick.addEventListener('click', async () => {
      try {
        const h = await pickBackupDir();   // 必须在点击的手势里调用
        showTopToast('✅ 保存位置已设为「' + (h.name || '所选文件夹') + '」——之后导出与备份都直接写进去', 5200);
        refreshLabel();
        close();
      } catch (e) {
        if (e && e.name !== 'AbortError') showTopToast('选择文件夹失败：' + (e && e.message ? e.message : e));
      }
    });
    const forget = overlay.querySelector('[data-act="forget"]');
    if (forget) forget.addEventListener('click', () => {
      if (!confirm('清除保存位置？之后导出会重新回到浏览器默认下载文件夹（已保存的文件不受影响）。')) return;
      forgetBackupDir();
      showTopToast('已清除保存位置，导出将回到浏览器下载文件夹');
      refreshLabel();
      close();
    });
    overlay.querySelector('[data-act="close"]').addEventListener('click', close);
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

  // ===== 报纸阅读页（两份相互独立的报纸：英文版 / 中文版）=====
  // 设计目标：阅读模式 = 电子报。**英文版与中文版是两份各自完整的报纸**（各有自己的报头、
  // 主标题、速览、页码），互不混排；报眉上的语言切换（EN / 中文）在两份报纸之间跳转。
  //
  // 关键架构决策（改动务必先读）：
  // 1) **搬真实元素，不复制内容**。段落 <p>、blockquote、插画 SVG 都是从原列里「搬」进版面的，
  //    所以标注 <mark>、词频着色 <span>、可编辑译文的 contenteditable、浮动批注菜单**全部照常工作**。
  // 2) **每版正文容器都带 `col-body en` / `col-body cn` 类**，于是
  //    `querySelectorAll('.col-body.en p[data-para-idx]')` 这类既有选择器跨版依然能找齐所有段落，
  //    只有 4 处「用 querySelector 取首个 .col-body」的滚动相关代码需要适配（进度条 / 阅读位置 /
  //    列高同步 / 两列滚动同步），它们已改为「报纸模式下走页码」。
  // 3) **原列在报纸模式下清空并摘掉 col-body 类**，退出时按原顺序还原 —— 保证任一时刻
  //    `.col-body.en` 只对应一套真实段落，不会出现「同一个段落有两个容器」的歧义。
  // 4) 两条流各自分版：英文流 → 英文版第 1..N 版；中文流 → 中文版第 1..M 版，
  //    版序连续放在同一条轨道上。**翻版被限制在当前语言那一本里**（见 paperGoto 的钳制），
  //    所以「下一版」永远不会翻进另一份报纸 —— 语言只由报眉的 EN / 中文 切换。
  const PAPER_VIEW = 'paper';
  // 「我习惯怎么读」是全局偏好，不该按篇记
  const PAPER_VIEW_KEY = 'wsj_reader:view';
  // 当前在看哪一份报纸（'en' | 'cn'）。同样是全局偏好，换文章照样生效。
  const PAPER_LANG_KEY = 'wsj_reader:paperLang';
  const PAPER_LANGS = ['en', 'cn'];
  let paperPages = [];
  let paperIndex = 0;
  let paperRestore = null;      // 退出时还原用的原容器 / 原始子节点顺序
  let paperResizeTimer = null;

  function paperViewPref() {
    try {
      const v = localStorage.getItem(PAPER_VIEW_KEY);
      if (v === PAPER_VIEW || v === 'reader') return v;
    } catch (e) {}
    return settings.view === PAPER_VIEW ? PAPER_VIEW : 'reader';
  }
  function paperSetView(v) {
    try { localStorage.setItem(PAPER_VIEW_KEY, v); } catch (e) {}
    settings.view = v; saveSettings();
  }
  function paperModeOn() { return paperViewPref() === PAPER_VIEW; }
  function paperPageIndex() { return paperIndex; }
  function paperPageCount() { return paperPages.length; }

  // ---------- 语言（两份相互独立的报纸）----------
  function paperLangGet() {
    try {
      const v = localStorage.getItem(PAPER_LANG_KEY);
      if (PAPER_LANGS.indexOf(v) >= 0) return v;
    } catch (e) {}
    return 'en';
  }
  function paperSetLangPref(v) { try { localStorage.setItem(PAPER_LANG_KEY, v); } catch (e) {} }
  // 某个语言对应的版序区间（0 基，含两端）。「中文版」从英文版的末版之后开始。
  // 版面尚未构建 / 该语言没有内容时返回 null。
  function paperLangRange(lang) {
    const cap = paperRestore;
    const enN = (cap && cap.enPages) || 0;
    const cnN = (cap && cap.cnPages) || 0;
    if (lang === 'cn') return cnN ? { from: enN, to: enN + cnN - 1 } : null;
    return enN ? { from: 0, to: enN - 1 } : null;
  }
  function paperLangOf(index) {
    const r = paperLangRange('en');
    return r && index <= r.to ? 'en' : 'cn';
  }

  // ---------- 报头文案 ----------
  // ⚠ 各篇文章的 `.title-block .meta` 写法**并不统一**（有的把日期塞在同一条里、
  //   有的根本没写日期、中文来源有的有有的没有），所以这里做两层取值：
  //     ① 从 meta 的分段里找「带四位年份」的那一段当日期
  //     ② 找不到就回落到**文件名里的 ISO 日期** —— <来源>_YYYY-MM-DD_<slug>_..._EN-CN_final.html
  //   实测 9 篇里有 1 篇 meta 完全没有日期（Science 那篇），只靠 meta 会静默退化成「今天」。
  function paperIsoDate() {
    const m = /((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})/.exec(String(articleId || ''));
    return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
  }
  function paperSource() {
    const el = document.querySelector('.title-block .meta');
    const parts = (el ? el.textContent : '').split('·').map(s => s.trim()).filter(Boolean).map(s => s.replace(/\s+/g, ' '));
    let date = '', cnSource = '';
    parts.forEach(p => {
      if (!date && /(?:19|20)\d{2}/.test(p)) date = p;
      // 中文来源：短、且不是日期/句子（"星期日泰晤士报" 是来源；"谄媚式 AI 扭曲社会……" 是标题）
      if (!cnSource && /[\u4e00-\u9fa5]/.test(p) && !/[年月日]/.test(p) &&
          p.length <= 12 && !/[，。；]/.test(p)) cnSource = p;
    });
    const source = parts[0] || '';
    return { source: source, date: date, iso: paperIsoDate(), cnSource: cnSource || source };
  }
  // 中文刊名（中文版报纸的报头）
  function paperName() {
    const names = {
      ai_cost: 'AI 资本观察', ai_regulation: '监管经济评论', ammo_shortage: '国防供应链',
      fcc_sports: '传媒与体育', haldane: '监管与增长', horvitz: '科学前沿',
      moral_econ: '社会心理研究', pensions: '家庭财经', pothole: '消费者权益'
    };
    return names[articleMeta.slug] || '外刊精读日报';
  }
  // 英文刊名（英文版报纸的报头）—— 英文版与中文版是两份相互独立的报纸，刊名各自成体系
  function paperNameEn() {
    const names = {
      ai_cost: 'AI Capital Watch', ai_regulation: 'Regulation & Markets', ammo_shortage: 'Defense Supply',
      fcc_sports: 'Media & Sports', haldane: 'Growth & Regulation', horvitz: 'Science Frontier',
      moral_econ: 'Mind & Society', pensions: 'Family Finance', pothole: 'Consumer Watch'
    };
    return names[articleMeta.slug] || 'Foreign Press Weekly';
  }
  function paperTitle() {
    const el = document.querySelector('.title-block h1:not(.cn)');
    return el ? el.textContent.trim() : (document.title || '');
  }
  function paperCnTitle() {
    const el = document.querySelector('.title-block h1.cn');
    return el ? el.textContent.trim() : '';
  }
  function paperAuthor() {
    const el = document.querySelector('.title-block .author:not(.cn)');
    return el ? el.textContent.trim() : '';
  }
  function paperCnAuthor() {
    const el = document.querySelector('.title-block .author.cn');
    return el ? el.textContent.trim() : '';
  }
  // 英文日期 / 中文日期各一份，都从同一个 Date 对象派生（保证两份报纸说的是同一天）
  const PAPER_EN_MON = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  function paperDateObj() {
    const { date, iso } = paperSource();
    let d = null;
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(date || ''));
    if (m) d = new Date(+m[1], +m[2] - 1, +m[3]);
    else if (date) { const t = Date.parse(date); if (!isNaN(t)) d = new Date(t); }
    if ((!d || isNaN(d.getTime())) && iso) d = new Date(iso.y, iso.mo - 1, iso.d);
    if (!d || isNaN(d.getTime())) d = new Date();
    return d;
  }
  function paperDateEn() {
    const d = paperDateObj();
    return PAPER_EN_MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  // ---------- 报纸版字号 ----------
  // ⚠ CSS 里**不能**声明 --np-font：一旦给 body 或 .paper-root 声明了，就会在子树里
  //   盖掉 <html> 上的内联值，A+/A− 点了没反应。所以字号只由这里写到 documentElement。
  function paperFontPx() {
    const base = settings.paperFont || 16.5;
    // 小屏收一点，一行能多放几个词；用户仍可用 A+/A− 覆盖
    return window.innerWidth <= 900 ? Math.round(base * 0.92 * 10) / 10 : base;
  }
  function paperApplyFont() {
    document.documentElement.style.setProperty('--np-font', paperFontPx() + 'px');
  }

  // ---------- 分栏数 ----------
  // 每版一张纸、页内多栏。默认：≥760px 双栏（报纸的常规栏宽），窄屏单栏。
  // 报眉的「栏」按钮可以在 1 / 2 / 3 栏之间切，选择全局记住 —— 三类宽度都合规矩，
  // 到底几栏读着舒服是眼睛的事，所以做成可切而不是写死。
  const PAPER_COL_GAP = 40;
  const PAPER_COLS_KEY = 'wsj_reader:paperCols';
  function paperColsPref() {
    let v = 0;
    try { v = parseInt(localStorage.getItem(PAPER_COLS_KEY) || '0', 10) || 0; } catch (e) {}
    if (v === 1 || v === 2 || v === 3) return v;
    return window.innerWidth >= 760 ? 2 : 1;
  }
  function paperLayoutMetrics() {
    return { cols: paperColsPref() };
  }

  // ---------- 版面骨架 ----------
  // 栏头做成和三栏视图一致的「标签 + 名称」样式，一眼看清是哪一页
  function paperRunhead(tag, name, title, pageNo) {
    return '<header class="np-runhead">' +
      '<span class="np-tag np-tag-' + tag.toLowerCase() + '">' + esc(tag) + '</span>' +
      '<span class="np-run-name">' + esc(name) + '</span>' +
      '<span class="np-run-title">' + esc(title) + '</span>' +
      '<span class="np-run-page">第 ' + pageNo + ' 版</span></header>';
  }
  // 页脚也是「一本书一份」：英文版用英文刊名与原文来源，中文版用中文刊名与中文来源
  function paperLeafFoot(kind, pageNo, total) {
    const { source, cnSource } = paperSource();
    const en = kind === 'en';
    const left = en ? (source || paperNameEn()) : (cnSource || paperName());
    const mid = en
      ? '— Page ' + pageNo + (total ? ' of ' + total : '') + ' —'
      : '— 第 ' + pageNo + (total ? ' / ' + total : '') + ' 版 —';
    const right = en ? 'ORIGINAL EDITION' : '中文版 · 译文原载于本刊英文版';
    return '<footer class="np-foot"><span>' + esc(left) + '</span>' +
      '<span class="np-pageno">' + esc(mid) + '</span>' +
      '<span>' + esc(right) + '</span></footer>';
  }

  // 「本篇速览 / AT A GLANCE」——按语言各成一份（英文版数词数，中文版数字数）
  // ⚠ 必须从捕获到的原始子节点里数，不能再去查 `.main-wrap .col-body.en`：
  //   报纸模式已经把原列改名成 np-source 且清空了，查选择器只会得到 0。
  function paperQuickFacts(cap) {
    let words = 0, paras = 0, chars = 0;
    (cap && cap.enKids || []).forEach(k => {
      if (!k.dataset || !k.dataset.paraIdx) return;
      const mm = k.textContent.match(/[A-Za-z][A-Za-z'\-]*/g);
      if (mm) words += mm.length;
    });
    (cap && cap.cnKids || []).forEach(k => {
      if (!k.dataset || !k.dataset.paraIdx) return;
      paras++;
      chars += k.textContent.replace(/\s/g, '').length;
    });
    const vocab = annotations.filter(a => a && a.bucket === 'vocab' && a.text).length;
    return {
      words: words, chars: chars, paras: paras, vocab: vocab,
      minutesEn: Math.max(1, Math.round(words / 180)),
      minutesCn: Math.max(1, Math.round(chars / 300))
    };
  }
  function paperFactsHTML(f, lang) {
    if (lang === 'cn') {
      return '<aside class="np-facts">' +
        '<div class="np-facts-h">本篇速览</div>' +
        '<div class="np-facts-grid">' +
        '<div><b>' + f.chars + '</b><span>字</span></div>' +
        '<div><b>' + f.paras + '</b><span>段</span></div>' +
        '<div><b>' + f.vocab + '</b><span>你的生词</span></div>' +
        '<div><b>' + f.minutesCn + '</b><span>分钟</span></div>' +
        '</div></aside>';
    }
    return '<aside class="np-facts">' +
      '<div class="np-facts-h">AT A GLANCE</div>' +
      '<div class="np-facts-grid">' +
      '<div><b>' + f.words + '</b><span>words</span></div>' +
      '<div><b>' + f.paras + '</b><span>paragraphs</span></div>' +
      '<div><b>' + f.vocab + '</b><span>your vocab</span></div>' +
      '<div><b>' + f.minutesEn + '</b><span>min read</span></div>' +
      '</div></aside>';
  }

  // 「精读提示」框——挂在英文正文末尾，像报纸的「语言点」小栏目
  function paperDigestHTML() {
    const points = [];
    document.querySelectorAll('.thesis-block ol > li').forEach(li => {
      const t = li.textContent.trim();
      if (t) points.push(t);
    });
    const vocab = annotations.filter(a => a && a.bucket === 'vocab' && a.text).slice(0, 14);
    if (!points.length && !vocab.length) return '';
    let h = '<div class="np-digest"><div class="np-digest-h">精读提示</div>';
    if (points.length) {
      h += '<div class="np-digest-sec"><span class="np-digest-t">本篇要点</span><ol>' +
        points.map(p => '<li>' + esc(p) + '</li>').join('') + '</ol></div>';
    }
    if (vocab.length) {
      h += '<div class="np-digest-sec"><span class="np-digest-t">重点表达</span><ul>' +
        vocab.map(v => '<li><b>' + esc(v.text) + '</b><i>' + esc((v.definition || v.note || '').trim() || '—') + '</i></li>').join('') +
        '</ul></div>';
    }
    return h + '</div>';
  }

  // 每种语言的「第 1 版」都是一张完整报纸的头版（独立报头 + 主标题 + 题图 + 速览），
  // 后续版只出内页眉 —— 这正是「英文版 / 中文版两份相互独立的报纸」的落点。
  function paperHeadFor(kind, pageNo, total, artHtml, facts, isFirst) {
    if (isFirst) {
      const { source, cnSource } = paperSource();
      const en = kind === 'en';
      const name = en ? paperNameEn() : paperName();
      const src = en ? (source || 'FOREIGN PRESS') : (cnSource || source || '星期日泰晤士报');
      const date = en ? paperDateEn() : paperDateText();
      const title = en ? paperTitle() : (paperCnTitle() || paperTitle());
      const sub = en ? (paperCnTitle() || '') : (paperCnTitle() ? paperTitle() : '');
      const by = en ? paperAuthor() : (paperCnAuthor() || paperAuthor());
      const tag = en ? 'FOREIGN PRESS · BILINGUAL READER' : '外刊精读 · 双语对照';
      return '<header class="np-masthead">' +
        '<div class="np-m-top"><span>' + esc(src) + '</span>' +
        '<span>' + esc(date) + '</span>' +
        '<span>' + (total ? (en ? total + ' pages' : '共 ' + total + ' 版') : '') + '</span></div>' +
        '<h1 class="np-m-name">' + esc(name) + '</h1>' +
        '<div class="np-m-rule"><span>' + esc(tag) + '</span><span>' + esc(by || (en ? 'READING EDITION' : '精读版')) + '</span></div>' +
        '</header>' +
        '<div class="np-lead' + (artHtml ? ' has-art' : '') + '">' +
        '<div class="np-lead-text">' +
        '<h2 class="np-headline">' + esc(title) + '</h2>' +
        (sub ? '<div class="np-subhead">' + esc(sub) + '</div>' : '') +
        (by ? '<div class="np-byline">' + esc(by) + '</div>' : '') +
        '</div>' +
        (artHtml ? '<figure class="np-fig">' + artHtml + '</figure>' : '') +
        '</div>' +
        (facts ? paperFactsHTML(facts, kind) : '');
    }
    // 内页眉也按「哪一份报纸」着色：EN 徽标配英文刊名，CN 徽标配中文版刊名
    return kind === 'cn'
      ? paperRunhead('CN', '中文版 · ' + paperName(), (paperCnTitle() || paperTitle()).slice(0, 40), pageNo)
      : paperRunhead('EN', paperNameEn(), paperTitle().slice(0, 40), pageNo);
  }
  // 每版就是一张纸。英文版的第 1 版与中文版的第 1 版都出完整头版
  // （各自的报头 / 主标题 / 题图 / 速览），因为它们是**两份独立的报纸**。
  function paperMakePage(pageNo, total, m, kind, artHtml, facts, isFirst) {
    const page = document.createElement('section');
    page.className = 'np-page np-page-' + kind + (isFirst ? ' is-first' : '');
    page.dataset.page = String(pageNo);
    page.dataset.lang = kind;
    const leaf = document.createElement('article');
    leaf.className = 'np-leaf np-leaf-' + kind;
    leaf.innerHTML = paperHeadFor(kind, pageNo, total, artHtml, facts, isFirst) +
      '<div class="np-body col-body ' + (kind === 'cn' ? 'cn' : 'en') + '"></div>' +
      paperLeafFoot(kind, pageNo, total);
    page.appendChild(leaf);
    return page;
  }

  // ---------- 构建 / 分版 ----------
  function paperEn() {
    return document.querySelector('.main-wrap .col-body.en') ||
      document.querySelector('.main-wrap .col-body');
  }
  function paperCn() {
    return document.querySelector('.main-wrap .col-body.cn');
  }

  function paperCapture() {
    const en = paperEn();
    const cn = paperCn();
    if (!en || !cn) return null;
    const artHost = document.querySelector('.art-block');
    return {
      en: en, cn: cn,
      enKids: Array.prototype.slice.call(en.children),
      cnKids: Array.prototype.slice.call(cn.children),
      artHost: artHost,
      artSvg: artHost ? artHost.querySelector('svg') : null,
      // 原列的类名要在退出时精确还原
      enClass: en.className, cnClass: cn.className
    };
  }

  // 把一条正文流分版到多张纸上；返回用掉的最后一个版号。
  //
  // 分版方式：**先塞满、再按真实溢出回退**（实测，不估算）。
  //   ① 把剩余块全部 append 进本版正文容器；
  //   ② 多栏容器一旦装不下，浏览器会排到第 3 栏（版面外的隐式栏），此时 scrollWidth > clientWidth；
  //   ③ 从末尾逐个移除，直到不再溢出 —— 此刻的容量就是「刚好装满」。
  //
  // 为什么不能用「逐块累加高度、超了就 break」的估算法：
  //   那个算法假设「块不可断开」，可 CSS 是允许 <p> 跨栏断开的（报纸正是这么排的）。
  //   两者一矛盾就会严重低估容量 —— 实测每版只装到 86%，还会把「精读提示」单独挤成一版，
  //   上一版底部留下大片空白。
  // ⚠ 必须显式强制一次重排再读 scrollWidth。
  //   removeChild 之后直接读 scrollWidth 会拿到**上一次布局的缓存值**（仍是「溢出」），
  //   结果回退循环会一路删到只剩一个块 —— 表现出来就是每版只装 1~3 段、底部大片空白。
  function paperOverflowed(body) {
    void body.offsetWidth;
    if (body.scrollWidth <= body.clientWidth + 1) return false;
    void body.offsetWidth;                                   // 复核一次，避免缓存
    return body.scrollWidth > body.clientWidth + 1;
  }
  function paperPackFlow(track, flow, kind, m, startPage, artHtml, facts) {
    const MAX_PAGES = 80;
    const firstPage = startPage + 1;
    let i = 0, pageNo = startPage;
    do {
      pageNo++;
      const isFirst = pageNo === firstPage;   // 每种语言的第 1 版都出完整头版
      const localNo = pageNo - startPage;     // 版号是「这一份报纸内部」的编号，从 1 起
      const page = paperMakePage(localNo, 0, m, kind,
        isFirst ? artHtml : '', isFirst ? facts : null, isFirst);
      track.appendChild(page);
      const body = page.querySelector('.np-body');
      // 每版的正文容器显式设为多栏：JS 与 CSS 必须一致，否则溢出判定不成立
      body.style.columnCount = String(m.cols);
      body.style.columnGap = PAPER_COL_GAP + 'px';

      // ① 剩余块全部放进本版（搬真实元素，保留 <mark> 标注 / 词频 <span> / contenteditable）
      const from = i;
      while (i < flow.length) {
        const b = flow[i];
        if (b.el) {
          if (b.quote) b.el.classList.add('np-quote');
          body.appendChild(b.el);
        } else {
          body.insertAdjacentHTML('beforeend', b.html);
        }
        i++;
      }
      // ③ 逐个回退到刚好不溢出；至少留一个块，避免「单块超高」把整版清空导致死循环
      let guard = 0;
      while (body.children.length > 1 && paperOverflowed(body) && guard++ < 400) {
        body.removeChild(body.lastElementChild);
        i--;
      }
      if (i === from) i = from + 1;   // 兜底：本版什么都装不下也至少推进一格
    } while (i < flow.length && pageNo < MAX_PAGES);
    return pageNo;
  }

  function paperBuild() {
    const root = document.getElementById('paper-root');
    if (!root) return;
    if (!paperRestore) paperRestore = paperCapture();
    const cap = paperRestore;
    if (!cap) { showTopToast('未找到正文列，无法生成报纸版'); return; }
    paperBuilding = true;

    // ⚠⚠ 必须先把「跨列等高」留下的 inline min-height 清掉再分版。
    //   三栏视图的 doHeightSync 会让 EN/CN 同一段等高，做法是给每个段落写 inline min-height
    //   （实测最长到 633px）。它在页面载入时先于报纸版跑过一次，那些 min-height 就留在段落上；
    //   报纸分版是按真实高度算的，段落被撑大后 →
    //     ① 每段占一大块、段号之间隔着一大片空白（用户看到的「中间空着大部分」）
    //     ② 每版装不下几段，版数近乎翻倍（实测 6 版 → 9 版）
    //   这里直接按捕获到的原始子节点清，不依赖类名（此刻原列已改名为 .np-source，
    //   按 `.col-body p` 查是查不到的）。
    cap.enKids.concat(cap.cnKids).forEach(k => {
      if (k.style) k.style.minHeight = '';
    });

    const track = root.querySelector('#np-track');
    const m = paperLayoutMetrics();
    const artHtml = cap.artSvg ? cap.artSvg.outerHTML : '';

    // 清场：把上一版的段落原地收回，再重排（避免元素被搬来搬去丢失事件绑定）
    Array.prototype.slice.call(track.querySelectorAll('.np-page')).forEach(p => p.remove());
    cap.enKids.forEach(k => cap.en.appendChild(k));
    cap.cnKids.forEach(k => cap.cn.appendChild(k));

    // 两条流**各自独立成流**：英文版只取英文列的子节点，中文版只取中文列的子节点。
    // ⚠ 这里刻意**不做「逐段配对」**：中文段落不必与英文一一对应（译文可以合并或拆分段落），
    //   一旦按 data-para-idx 配对，中文列里那些「找不到对应英文段」的段落会被静默丢掉 ——
    //   而中文版是一份独立的报纸，它的段落完整性只取决于它自己的内容。
    //   两条流用的都是**真实元素**（不复制），所以标注 / 词频 / 译文编辑照常工作。
    const buildFlow = (kids) => {
      const flow = [];
      kids.forEach(k => {
        if (k.tagName === 'BLOCKQUOTE') flow.push({ el: k, quote: true });
        else if (k.dataset && k.dataset.paraIdx) flow.push({ el: k });
      });
      return flow;
    };
    const flowEn = buildFlow(cap.enKids);
    const flowCn = buildFlow(cap.cnKids);
    // 「精读提示」框是报纸背面的「语言点」小栏目。
    // ⚠ 挂在**译文流末尾**而不是英文流末尾：中文段落比英文短，最后一版通常有余量，
    //   挂这里既填满末版留白，又不会像挂在英文流时那样被挤成「单独占一整版、四周空白」。
    //   本篇不看译文时才退回英文流末尾。
    // ⚠ 中文版**始终构建**（只要本文有译文）：英文版与中文版是两份相互独立的报纸，
    //   语言切换不应该依赖「显示中文」那个三栏视图的开关。
    const hasCnFlow = flowCn.length > 0;
    const digest = paperDigestHTML();
    if (digest) (hasCnFlow ? flowCn : flowEn).push({ html: digest });

    const facts = paperQuickFacts(cap);
    cap.enPages = paperPackFlow(track, flowEn, 'en', m, 0, artHtml, facts);
    cap.cnPages = hasCnFlow
      ? paperPackFlow(track, flowCn, 'cn', m, cap.enPages, artHtml, facts) - cap.enPages
      : 0;

    paperPages = Array.prototype.slice.call(track.querySelectorAll('.np-page'));
    cap.pagesTotal = paperPages.length;
    // 版号是**每份报纸内部**的编号：英文版 Page 1..N、中文版第 1..M 版，
    // 两份各自从「第 1 版」重新起算 —— 它们本来就是两份独立的报纸。
    paperPages.forEach((p, k) => {
      const isCn = k >= cap.enPages;
      const local = isCn ? k - cap.enPages + 1 : k + 1;
      const totalInEd = isCn ? cap.cnPages : cap.enPages;
      // **每一本的最后一版改成平衡分栏**：末版内容常常只占 1 栏多一点，
      // 用 column-fill:auto 会「第一栏满、第二栏几乎空」，看着像漏排。
      // 平衡后两栏等高，读者看到的是「这一版就这么多」，而不是「缺了一块」。
      // 安全性：末版的内容总量必然 ≤ 栏数（否则分版时就溢出了），
      // 所以平衡后每栏都不会超过 100%，不会引入溢出。
      if (local === totalInEd) {
        const body = p.querySelector('.np-body');
        if (body) body.style.columnFill = 'balance';
      }
      const s = p.querySelectorAll('.np-m-top span');
      if (s[2]) s[2].textContent = isCn ? ('共 ' + totalInEd + ' 版') : (totalInEd + ' pages');
      p.querySelectorAll('.np-run-page').forEach(el => { el.textContent = '第 ' + local + ' 版'; });
      p.querySelectorAll('.np-pageno').forEach(el => {
        el.textContent = isCn
          ? ('— 第 ' + local + ' / ' + totalInEd + ' 版 —')
          : ('— Page ' + local + ' of ' + totalInEd + ' —');
      });
    });
    paperBuilding = false;
    // 当前语言那一本可能不存在（本文没有译文 → 中文版没建）→ 回落到英文版
    if (!paperLangRange(paperLangGet())) paperSetLangPref('en');
    paperApplyLayout(false);
    paperApplyLang();
    // 建版 / 重排后的落位不算「翻版」，不要放动画
    paperGoto(Math.min(paperIndex, paperPages.length - 1), { silent: true });
  }

  // ---------- 建立 / 关闭 ----------
  // 报纸的「出版信息」：日期做成报头 dateline 的读法（2026 年 6 月 14 日  星期日）
  function paperDateText() {
    const d = paperDateObj();
    return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日  星期' +
      '日一二三四五六'[d.getDay()];
  }

  /* 报眉分两行，都是报纸上真实存在的东西：
     ① 报名栏 .np-mastbar —— 刊名 + 出版信息（日期 / 时刻 / 阅读计时）
     ② 栏目索引栏 .np-indexbar —— 四个下拉（视图·考试·数据·工具）+ 翻版 + 工具按钮
     底栏 (.toolbar) 在报纸模式下整条不再显示；其中真正有用的部分由
     paperAdoptControls() 在运行时搬进这里（DOM 与事件监听原样保留）。 */
  function paperTopbarHTML() {
    return '<div class="np-topbar">' +
      '<div class="np-mastbar">' +
      // 刊名 / 来源 / 出版日期 / 版次 都按「当前这一份报纸」填，见 paperApplyLang
      '<div class="np-brand"><span class="np-brand-name" id="np-brand-name"></span>' +
      '<span class="np-brand-sub" id="np-brand-sub"></span></div>' +
      '<div class="np-dateline">' +
      '<span class="np-dl-ed" id="np-dl-ed"></span>' +
      '<span class="np-dl-date" id="np-dl-date"></span>' +
      '<span class="np-timehost" id="np-timehost"></span>' +
      '</div>' +
      '</div>' +
      '<div class="np-indexbar">' +
      '<div class="np-menus" id="np-menus"></div>' +
      // 语言切换：英文版 / 中文版 是两份相互独立的报纸，这里是唯一的入口
      '<div class="np-langseg" role="group" aria-label="语言切换 / Language">' +
      '<button type="button" class="np-lang-btn" id="np-lang-en" aria-pressed="true" title="English edition">EN</button>' +
      '<button type="button" class="np-lang-btn" id="np-lang-cn" aria-pressed="false" title="中文版">中文</button>' +
      '</div>' +
      '<div class="np-flip">' +
      '<button type="button" class="np-btn" id="np-prev" title="上一版（←）">‹ 上一版</button>' +
      '<span class="np-pos" id="np-pos">1 / 1</span>' +
      '<button type="button" class="np-btn" id="np-next" title="下一版（→）">下一版 ›</button>' +
      '</div>' +
      '<div class="np-tools">' +
      (articleMeta.hasExam
        ? '<button type="button" class="np-btn np-exam" id="np-exam" title="考试模式：阅读理解 / 完形填空 / 新题型 / 翻译练习 / 写作">🎓 考试</button>'
        : '') +
      '<button type="button" class="np-btn" id="np-sum" title="展开/收起导读摘要">导读</button>' +
      '<button type="button" class="np-btn" id="np-notes" title="展开/收起剪报本（笔记与生词）">笔记</button>' +
      '<button type="button" class="np-btn" id="np-cols" title="切换栏数：1 / 2 / 3 栏">栏 2</button>' +
      '<button type="button" class="np-btn" id="np-sd" title="缩小字号">A−</button>' +
      '<button type="button" class="np-btn" id="np-su" title="放大字号">A+</button>' +
      '<button type="button" class="np-btn" id="np-print" title="打印成纸质报纸">打印</button>' +
      '<button type="button" class="np-btn np-exit" id="np-exit" title="切到三栏对照视图">三栏对照</button>' +
      '</div>' +
      '</div></div>';
  }

  // 把底栏里真正有用的东西搬进报眉：四个下拉菜单 → 栏目索引栏；时钟/计时 → 出版信息条。
  // 只移动节点、不动事件监听，退出时按记录的位置原样放回。
  let paperAdopted = [];
  function paperAdoptControls() {
    const host = document.getElementById('np-menus');
    const timeHost = document.getElementById('np-timehost');
    if (!host) return;
    paperAdopted = [];
    const move = (el, target) => {
      if (!el || !target || el.parentNode === target) return;
      paperAdopted.push({ el: el, parent: el.parentNode, next: el.nextSibling });
      target.appendChild(el);
    };
    document.querySelectorAll('.toolbar .menu-trigger-wrap').forEach(w => move(w, host));
    // 时钟 / 计时 → 出版信息条。
    // ⚠ 模板有两种形态：新版把三个时钟元素包在 .toolbar-clock-area 里，旧版是散着的。
    //   优先搬包装（保住它自带的布局），没有包装就逐个搬，两种都能落到出版信息条。
    const clockArea = document.querySelector('.toolbar .toolbar-clock-area');
    if (timeHost) {
      if (clockArea) move(clockArea, timeHost);
      else ['toolbar-clock', 'session-timer', 'total-timer'].forEach(id =>
        move(document.querySelector('.toolbar #' + id), timeHost));
    }
    if (!host.children.length) host.remove();
    // 底栏整条收起的开关交给 JS 置位 —— 万一搬移失败，底栏仍然可见可用（不会丢入口）
    document.body.classList.add('paper-controls-adopted');
  }
  function paperReleaseControls() {
    // 逆序放回，保证先恢复被当作 nextSibling 参照的那个节点
    for (let i = paperAdopted.length - 1; i >= 0; i--) {
      const it = paperAdopted[i];
      if (!it.parent) continue;
      if (it.next && it.next.parentNode === it.parent) it.parent.insertBefore(it.el, it.next);
      else it.parent.appendChild(it.el);
    }
    paperAdopted = [];
    document.body.classList.remove('paper-controls-adopted');
  }

  function paperEnsureRoot() {
    let root = document.getElementById('paper-root');
    if (root) return root;
    root = document.createElement('div');
    root.className = 'paper-root';
    root.id = 'paper-root';
    root.innerHTML = paperTopbarHTML() +
      '<div class="np-stage"><div class="np-track" id="np-track"></div></div>' +
      '<div class="np-hint">← → 翻版 · 点版面右/左侧翻页 · L 换语言 · Esc 切回三栏</div>';
    document.body.appendChild(root);
    paperAdoptControls();

    const rootEl = root;
    const go = d => paperGoto(paperIndex + d);
    rootEl.querySelector('#np-prev').addEventListener('click', () => go(-1));
    rootEl.querySelector('#np-next').addEventListener('click', () => go(1));
    rootEl.querySelector('#np-exit').addEventListener('click', () => togglePaper(false));
    rootEl.querySelector('#np-print').addEventListener('click', () => window.print());
    const exBtn = rootEl.querySelector('#np-exam');
    if (exBtn) exBtn.addEventListener('click', () => { if (window.openExamHub) window.openExamHub(); });
    // 语言切换：英文版 / 中文版两份独立报纸，各自从头版看起
    rootEl.querySelector('#np-lang-en').addEventListener('click', () => paperSetLang('en'));
    rootEl.querySelector('#np-lang-cn').addEventListener('click', () => paperSetLang('cn'));
    rootEl.querySelector('#np-sum').addEventListener('click', () => { paperSumOpen = !paperSumOpen; paperApplyLayout(); });
    rootEl.querySelector('#np-notes').addEventListener('click', () => {
      paperNotesOpen = !paperNotesOpen;
      // 展开时刷新一次列表（标注可能刚改过）
      if (paperNotesOpen && typeof renderNotes === 'function') renderNotes();
      paperApplyLayout();
    });
    rootEl.querySelector('#np-sd').addEventListener('click', () => paperBumpFont(-1));
    rootEl.querySelector('#np-su').addEventListener('click', () => paperBumpFont(1));
    rootEl.querySelector('#np-cols').addEventListener('click', () => paperCycleCols());
    paperApplyFont();
    // 点版面靠右/靠左处翻版（报纸随手翻页的手感）；点文字或按钮不触发
    rootEl.querySelector('.np-stage').addEventListener('click', (e) => {
      if (e.target.closest('a,button,input,label,.np-drawer,.notes-section,#float-menu,.np-vocab-box')) return;
      if (window.getSelection && String(window.getSelection()).length) return;
      if (e.target.closest('[contenteditable="true"]')) return;
      const r = e.currentTarget.getBoundingClientRect();
      if (e.clientX - r.left > r.width * 0.5) go(1); else go(-1);
    });
    return root;
  }

  function paperBumpFont(d) {
    const v = Math.max(12, Math.min(24, (settings.paperFont || 16.5) + d));
    settings.paperFont = v; saveSettings();
    paperApplyFont();
    scheduleHeightSync(true);
    paperBuild();
  }

  // 栏数：1 → 2 → 3 → 1 循环。字号的颗粒是「行」，栏数的颗粒是「一行多长」，
  // 这两件事最影响读报手感，所以都给一个一键入口而不是写死。
  function paperCycleCols() {
    const cur = paperColsPref();
    const next = cur >= 3 ? 1 : cur + 1;
    try { localStorage.setItem(PAPER_COLS_KEY, String(next)); } catch (e) {}
    updatePaperColsBtn();
    paperBuild();
    showTopToast('版面改成 ' + next + ' 栏');
  }
  function updatePaperColsBtn() {
    const b = document.getElementById('np-cols');
    if (b) b.textContent = '栏 ' + paperColsPref();
  }

  // ---------- 语言切换（英文版 ⇄ 中文版）----------
  // 两份报纸在同一条轨道上（英文版 1..N 版，中文版 1..M 版）。版面**一次全部建好**，
  // 所以切换只是「跳到另一本的第 1 版」——不重排、不刷新，只叠一次交叉淡入。
  function paperApplyLang() {
    const root = document.getElementById('paper-root');
    const lang = paperLangGet();
    const en = lang === 'en';
    if (root) root.dataset.lang = lang;
    // 报眉上的刊名 / 来源 / 日期 / 版次 也跟着换 —— 切换后看到的是一份「另一份报纸」
    const { source, cnSource } = paperSource();
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setText('np-brand-name', en ? paperNameEn() : paperName());
    setText('np-brand-sub', en ? (source || '') : (cnSource || source || ''));
    setText('np-dl-ed', en ? 'ENGLISH EDITION' : '中 文 版');
    setText('np-dl-date', en ? paperDateEn() : paperDateText());
    const set = (id, isCur, missing, title) => {
      const b = document.getElementById(id);
      if (!b) return;
      b.classList.toggle('active', isCur);
      b.setAttribute('aria-pressed', isCur ? 'true' : 'false');
      b.disabled = missing;
      b.title = title;
    };
    const hasEn = !!paperLangRange('en'), hasCn = !!paperLangRange('cn');
    set('np-lang-en', en, !hasEn, hasEn ? 'English edition' : '本篇没有英文版');
    set('np-lang-cn', !en, !hasCn, hasCn ? '中文版（本文的对应翻译版）' : '本篇没有中文版');
    updatePaperColsBtn();
  }
  let paperLangFxTimer = null;
  function paperLangFx() {
    const root = document.getElementById('paper-root');
    if (!root) return;
    root.classList.remove('np-lang-swap');
    void root.offsetWidth;
    root.classList.add('np-lang-swap');
    clearTimeout(paperLangFxTimer);
    paperLangFxTimer = setTimeout(() => root.classList.remove('np-lang-swap'), 460);
  }
  function paperSetLang(lang, opts) {
    if (PAPER_LANGS.indexOf(lang) < 0) return;
    const range = paperLangRange(lang);
    if (!range) { showTopToast(lang === 'cn' ? '本篇没有中文版' : '本篇没有英文版'); return; }
    const changed = paperLangGet() !== lang;
    paperSetLangPref(lang);
    if (changed && !(opts && opts.silent) && !paperMotionOff()) paperLangFx();
    paperGoto(range.from, { silent: true });
    paperApplyLang();
    if (changed && !(opts && opts.silent)) {
      showTopToast(lang === 'cn' ? '已切到中文版（本文的对应翻译版）' : 'Switched to the English edition');
    }
  }

  // 报纸模式下把「标题区 / 概要 / 中文 / 笔记」的显隐同步到报纸版式
  // repaginate=false 用于「正在分版中」的调用，避免互相触发成死循环
  // ⚠ 「导读」与「剪报本」两个抽屉都用独立的运行时状态（paperSumOpen / paperNotesOpen），
  //   **默认都是关闭的**、不跟 settings.showSummary / settings.showNotes 走：
  //   后两者默认 true（三栏视图默认显示概要列与笔记条），若沿用就会一进报纸版
  //   两个抽屉自己拉开、盖住半边纸面 —— 报纸阅读页一打开应该就是干干净净一张报。
  let paperBuilding = false;
  let paperSumOpen = false;
  let paperNotesOpen = false;
  function paperApplyLayout(repaginate) {
    const root = document.getElementById('paper-root');
    if (!root) return;
    // 「标题区显隐」在报纸版里控制报头 + 主标题区（否则这个开关在报纸模式下点了没反应）
    const noHead = !settings.showHeader;
    const headChanged = root.classList.contains('no-head') !== noHead;
    root.classList.toggle('no-head', noHead);
    // ⚠ 「中文」不再是一个显隐开关 —— 中文版是一份独立的报纸，由报眉的 EN / 中文 切换。
    //   过去那套 no-cn / m-en / m-cn / m-sum 的四态类已废弃（它会把另一本整个藏掉）。
    const sm = root.querySelector('#np-sum');
    if (sm) sm.classList.toggle('active', paperSumOpen);
    const col = document.querySelector('.summary-col');
    if (col) col.classList.toggle('np-open', paperSumOpen);
    const nb = root.querySelector('#np-notes');
    if (nb) nb.classList.toggle('active', paperNotesOpen);
    const ns = document.querySelector('.notes-section');
    if (ns) ns.classList.toggle('collapsed', !paperNotesOpen);
    // 标题区一收，正文可用高度就变了，必须重新分版
    if (headChanged && repaginate !== false && !paperBuilding) {
      if (typeof window.__paperRepaginate === 'function') window.__paperRepaginate();
    }
  }

  function paperEnter() {
    if (!paperRestore) paperRestore = paperCapture();
    if (!paperRestore) return;
    paperEnsureRoot();
    document.body.classList.add('paper-open');
    const cap = paperRestore;
    // 原列交给报纸接管：摘掉 col-body 类并清空，避免选择器出现两个同名容器
    cap.en.className = 'np-source';
    cap.cn.className = 'np-source';
    paperBuild();
    // 进入时若正在看某段，落到对应版
    updatePaperButtons();
  }

  function paperExit() {
    const cap = paperRestore;
    const root = document.getElementById('paper-root');
    if (cap) {
      // ① 先清掉「分版时才注入的合成块」（如精读提示框 .np-digest）——
      //    它们不是原文元素，回收时会污染原列。
      const enSet = new Set(cap.enKids), cnSet = new Set(cap.cnKids);
      if (root) {
        root.querySelectorAll('.np-body').forEach(b => {
          Array.prototype.slice.call(b.children).forEach(k => {
            if (!enSet.has(k) && !cnSet.has(k)) k.remove();
          });
        });
      }
      // ② 再按原始子节点顺序把真实元素放回去
      cap.enKids.forEach(k => cap.en.appendChild(k));
      cap.cnKids.forEach(k => cap.cn.appendChild(k));
      // ③ 清理分版时贴上的类
      cap.en.className = cap.enClass;
      cap.cn.className = cap.cnClass;
      cap.enKids.forEach(k => { if (k.classList && k.classList.contains('np-quote')) k.classList.remove('np-quote'); });
      cap.cnKids.forEach(k => { if (k.classList && k.classList.contains('np-quote')) k.classList.remove('np-quote'); });
      paperRestore = null;
    }
    // ⚠ 必须先把报眉里借来的东西（四个下拉菜单 + 时钟）搬回底栏，再删报纸层 ——
    //   否则它们会随 paper-root 一起被移除，底栏就永久丢了入口。
    paperReleaseControls();
    if (root) root.remove();
    paperPages = []; paperIndex = 0;
    document.body.classList.remove('paper-open');
    clearTimeout(paperTurnTimer);
    paperSumOpen = false;
    paperNotesOpen = false;
    document.querySelector('.summary-col')?.classList.remove('np-open');
    // 笔记条在三栏视图里由 settings.showNotes 决定，退出报纸版要还原回去
    const nsBack = document.querySelector('.notes-section');
    if (nsBack) nsBack.classList.toggle('collapsed', !settings.showNotes);
    updatePaperButtons();
    // 三栏视图恢复后需要重新对齐列高
    lastSyncedWidth = -1;
    scheduleHeightSync(true);
  }

  // 「偏好」不等于「已进入」：首屏偏好就是 paper，但版面尚未构建。
  // 用独立状态位判断，否则会把首次进入当成重复调用而直接返回。
  let paperEntered = false;
  function paperIsOpen() { return paperEntered; }

  function togglePaper(force) {
    const want = force === undefined ? !paperEntered : !!force;
    if (want === paperEntered) return;
    if (want) {
      paperEntered = true;
      paperSetView(PAPER_VIEW);
      paperEnter();
      if (!initializing) showTopToast('报纸版：← → 翻版，点版面左右翻页，Esc 切回三栏');
    } else {
      paperEntered = false;
      paperSetView('reader');
      paperExit();
      if (!initializing) showTopToast('已切到三栏对照视图');
    }
  }
  function updatePaperButtons() {
    const on = paperEntered;
    const btn = document.getElementById('paper-mode-btn');
    if (btn) btn.classList.toggle('active', on);
    const btn2 = document.getElementById('reader-mode-btn');
    if (btn2) btn2.classList.toggle('active', !on);
  }

  // ---------- 翻报动画 ----------
  // 光让轨道横向平移（translateX）看着就是「切换」而不是「翻报纸」。
  // 这里在平移之上再叠一层纸面翻掀：旧版绕右边折走、新版绕左边铺下来，
  // 配合 .np-stage 的 perspective 就有翻页的立体感。
  // ⚠ 动画类要在「强制重排」之后再加，否则连续翻版时同名动画不会重播。
  let paperTurnTimer = null;
  function paperMotionOff() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function paperTurnFx(prevIdx, nextIdx) {
    const pages = paperPages;
    pages.forEach(p => p.classList.remove('np-turn-in', 'np-turn-out'));
    if (prevIdx === nextIdx) return;
    const out = pages[prevIdx], inn = pages[nextIdx];
    if (!out && !inn) return;
    // 强制重排：让刚移除的动画类生效，下一次添加才会重新触发动画
    void (inn || out).offsetWidth;
    if (out) out.classList.add('np-turn-out');
    if (inn) inn.classList.add('np-turn-in');
    clearTimeout(paperTurnTimer);
    paperTurnTimer = setTimeout(() => {
      pages.forEach(p => p.classList.remove('np-turn-in', 'np-turn-out'));
    }, 700);
  }

  function paperGoto(n, opts) {
    if (!paperPages.length) return;
    // 翻版被限制在「当前这一份报纸」里：翻到边界就停，永远不会翻进另一份报纸。
    // 语言只能由报眉的 EN / 中文 切换 —— 这是「两份相互独立的报纸」的落点。
    const rng = paperLangRange(paperLangGet()) || { from: 0, to: paperPages.length - 1 };
    const prevIdx = paperIndex;
    paperIndex = Math.max(rng.from, Math.min(rng.to, n));
    const track = document.getElementById('np-track');
    if (track) track.style.transform = 'translateX(' + (-paperIndex * 100) + '%)';
    paperPages.forEach((p, k) => p.classList.toggle('is-current', k === paperIndex));
    const pos = document.getElementById('np-pos');
    // 页码是「这一份报纸内部」的页序，不是整条轨道的序号
    if (pos) pos.textContent = (paperIndex - rng.from + 1) + ' / ' + (rng.to - rng.from + 1);
    const prev = document.getElementById('np-prev'), next = document.getElementById('np-next');
    if (prev) prev.disabled = paperIndex === rng.from;
    if (next) next.disabled = paperIndex === rng.to;
    // 首次建版 / 字号重排 / 显式要求时不要动画（否则一进报纸版就凭空翻一下）
    if (!(opts && opts.silent) && !paperMotionOff()) paperTurnFx(prevIdx, paperIndex);
    updateProgressBar();
  }
  function paperNext() { paperGoto(paperIndex + 1); }
  function paperPrev() { paperGoto(paperIndex - 1); }
  // 当前版第一段的 para-idx（阅读位置记录用）。中文版同理 —— 两本都用 .np-body 里的真实段落。
  function paperCurrentParaIdx() {
    const p = paperPages[paperIndex];
    if (!p) return null;
    const first = p.querySelector('.np-body p[data-para-idx]');
    return first ? parseInt(first.dataset.paraIdx, 10) : null;
  }
  // 跳到含某段的版。先在本语言那一本里找（阅读位置是跟着当前那份报纸记的），
  // 找不到再全局兜底（例如该段只存在于另一本）。
  function paperGotoParaIdx(idx) {
    const sel = '.np-body p[data-para-idx="' + idx + '"]';
    const rng = paperLangRange(paperLangGet()) || { from: 0, to: paperPages.length - 1 };
    for (let i = rng.from; i <= rng.to; i++) {
      if (paperPages[i] && paperPages[i].querySelector(sel)) { paperGoto(i); return true; }
    }
    for (let i = 0; i < paperPages.length; i++) {
      if (paperPages[i].querySelector(sel)) { paperSetLang(paperLangOf(i), { silent: true }); paperGoto(i); return true; }
    }
    return false;
  }

  // ---------- 键盘 / 触屏 / 尺寸 ----------
  document.addEventListener('keydown', (e) => {
    if (!paperModeOn()) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (document.getElementById('search-panel')?.classList.contains('visible')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); paperNext(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); paperPrev(); }
    else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); paperSetLang(paperLangGet() === 'en' ? 'cn' : 'en'); }
    else if (e.key === 'Escape') { e.preventDefault(); togglePaper(false); }
  });
  (function paperSwipe() {
    let x0 = null, y0 = null;
    document.addEventListener('touchstart', (e) => {
      if (!paperModeOn() || e.touches.length !== 1) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (!paperModeOn() || x0 === null) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0, dy = t.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) { if (dx < 0) paperNext(); else paperPrev(); }
    }, { passive: true });
  })();
  window.addEventListener('resize', () => {
    if (!paperModeOn()) return;
    clearTimeout(paperResizeTimer);
    paperResizeTimer = setTimeout(() => { if (paperModeOn()) paperBuild(); }, 320);
  });

  window.togglePaper = togglePaper;
  window.paperNext = paperNext;
  window.paperPrev = paperPrev;
  window.paperModeOn = paperModeOn;
  window.paperIsOpen = paperIsOpen;
  window.paperPageIndex = paperPageIndex;
  window.paperPageCount = paperPageCount;
  window.paperCurrentParaIdx = paperCurrentParaIdx;
  window.paperGotoParaIdx = paperGotoParaIdx;
  window.paperApplyLayout = paperApplyLayout;
  window.paperSetLang = paperSetLang;
  window.paperLangGet = paperLangGet;
  window.paperCycleCols = paperCycleCols;
  window.__paperRepaginate = () => { if (paperModeOn()) paperBuild(); };

  // ===== 精读分析台（错题本 / 能力雷达 / 段落功能 / 生词网络）=====
  //
  // ⚠ 这一组功能全部**复用既有存储**，不新建并行数据源：
  //   · 错题本读既有的 4 个错题库（wsj_exam / wsj_cloze / wsj_newtype / wsj_translation），
  //     只额外加一个「复习调度」侧车键（wsj_wrongrev），不动既有记录的字段；
  //   · 能力雷达直接聚合 wsj_exam:history 里的 perQ[].type —— 每道题的题型早已逐题落库；
  //   · 段落功能走既有 annotations:<articleId>，新增一个 bucket='paraFunc'；
  //   · 生词网络从 registry + annotations:<篇> 现场推导，**不建 vocab:index 索引**（避免第二份真相）。
  //
  // ⚠ 编号 11 只是模块序号；它必须排在 10-toolbar.js **之前**（后者负责收尾并定义 window.__reader）。

  // ---------- 小工具 ----------
  function insToday() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function insAddDays(n) {
    const d = new Date(); d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function insLoad(key, fb) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
  function insSave(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
  function insRegistry() { return insLoad('wsj_reader:registry', []) || []; }
  // registry 的 id 就是**页面文件名**（这一点全项目一致，别换成 slug）
  function insTitleOf(fileId) {
    const r = insRegistry().find(x => x.id === fileId);
    if (r && r.title) return r.title;
    if (fileId === articleId) return getShortTitle();
    return String(fileId || '').replace(/_EN-CN_final\.html$/, '').replace(/_/g, ' ');
  }
  function insSlugOf(fileId) {
    const r = insRegistry().find(x => x.id === fileId);
    return (r && r.slug) || (fileId === articleId ? articleMeta.slug : '');
  }
  function insPageUrl(fileId) {
    return location.pathname.replace(/[^/]+$/, '') + fileId;
  }

  // ---------- 通用浮层面板（沿用 .syntax-panel 基类 + .visible，与既有面板同一套皮肤）----------
  function insPanel(id, title, extraHead) {
    let p = document.getElementById(id);
    if (p) return p;
    p = document.createElement('div');
    p.id = id;
    p.className = 'syntax-panel insight-panel';
    p.innerHTML =
      '<div class="syntax-header"><h3>' + esc(title) + '</h3>' +
      '<button type="button" data-close="1" title="关闭">✕</button></div>' +
      '<div class="insight-body" id="' + id + '-body"></div>' +
      '<div class="syntax-actions">' + (extraHead || '') +
      '<button type="button" data-close="1">关闭</button></div>';
    document.body.appendChild(p);
    p.querySelectorAll('[data-close]').forEach(b =>
      b.addEventListener('click', () => p.classList.remove('visible')));
    return p;
  }
  function insOpen(p) { p.classList.add('visible'); }

  // ==========================================================================
  // F04 错题本 + 间隔重复
  // ==========================================================================
  // 4 个错题库各自独立（历史遗留），这里做一层**只读适配**合并成统一视图。
  // 只有「阅读理解」的库里带题干与选项（exam.js 写入），因此只有它能就地重做；
  // 其余三类给出「回原练习页重做」的跳转 —— 不假装能重做。
  const WRONG_STORES = [
    { key: 'wsj_exam:wrongs', label: '阅读理解', page: s => 'exam_' + s + '.html' },
    { key: 'wsj_cloze:wrongs', label: '完形填空', page: s => 'cloze_' + s + '.html' },
    { key: 'wsj_newtype:wrongs', label: '新题型', page: s => 'newtype_' + s + '.html' },
    { key: 'wsj_translation:wrongs', label: '翻译', page: s => 'translation_' + s + '.html' }
  ];
  const WRONG_CAUSES = {
    vocab: '词汇', syntax: '长难句', logic: '逻辑', qtype: '题型', careless: '粗心', trans: '误译',
    location: '定位错误', trap: '干扰项陷阱', 语境词: '语境词', 误译: '误译', 粗心: '粗心'
  };
  const WRONG_REV_KEY = 'wsj_wrongrev';     // 侧车：{ '<store>|<key>': {n, nextDue, last, done} }
  // 间隔序列（与项目既有复习语义对齐：答错回 1 天，答对逐步拉长）
  const WRONG_STEPS = [1, 2, 4, 8, 16];
  const WRONG_MASTER_N = 3;

  function wrongRevAll() { return insLoad(WRONG_REV_KEY, {}) || {}; }
  function wrongRevKey(store, key) { return store + '|' + String(key || ''); }
  function wrongRevOf(w) { return wrongRevAll()[wrongRevKey(w.store, w.key)] || null; }
  // 复习调度：答对递进、答错归零；连对 WRONG_MASTER_N 次标「已掌握」并移出队列
  // （说明书写的「连对 2 次」太松 —— 错题只隔一天答对两次就出列，等于没复习；
  //   项目既有的题型卡复习在「已掌握」后仍按 15 天复看，这里取折中：3 次出列但记录保留）
  function wrongSchedule(w, wasCorrect) {
    const all = wrongRevAll();
    const k = wrongRevKey(w.store, w.key);
    const r = all[k] || { n: 0, nextDue: insToday(), last: null, done: false };
    if (wasCorrect) {
      r.n = (r.n || 0) + 1;
      if (r.n >= WRONG_MASTER_N) { r.done = true; r.nextDue = ''; }
      else r.nextDue = insAddDays(WRONG_STEPS[Math.min(r.n, WRONG_STEPS.length - 1)]);
    } else {
      r.n = 0; r.done = false; r.nextDue = insAddDays(1);
    }
    r.last = new Date().toISOString();
    all[k] = r; insSave(WRONG_REV_KEY, all);
    return r;
  }
  function collectWrongs() {
    const out = [];
    WRONG_STORES.forEach(st => {
      (insLoad(st.key, []) || []).forEach(r => {
        if (!r || !r.key) return;
        const rev = wrongRevOf({ store: st.key, key: r.key });
        out.push({
          store: st.key, storeLabel: st.label, key: r.key, page: st.page,
          slug: r.slug || '', title: r.title || insTitleOf('') ,
          no: r.no, type: r.type || r.kind || '', mode: r.mode || '',
          myAnswer: r.myAnswer || '', answer: r.answer || '', cause: r.cause || '',
          at: r.at || '', stem: r.stem || '', options: r.options || {},
          analysis: r.analysis || '', refs: r.refs || [],
          rev: rev, due: !rev || (!rev.done && (!rev.nextDue || rev.nextDue <= insToday())),
          redo: !!(r.stem && r.options && Object.keys(r.options).length)
        });
      });
    });
    out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return out;
  }
  // 供 07-wordfreq.js 的 dueReviewCount() 合并统计（工具栏角标同时算生词与错题）
  function dueWrongCount() {
    return collectWrongs().filter(w => !w.rev || (!w.rev.done && w.rev.nextDue && w.rev.nextDue <= insToday())).length;
  }
  function wrongStats(list) {
    let due = 0, done = 0, fresh = 0;
    list.forEach(w => {
      if (w.rev && w.rev.done) { done++; return; }
      if (!w.rev || !w.rev.last) fresh++;
      if (w.due) due++;
    });
    return { total: list.length, due: due, done: done, fresh: fresh };
  }
  let wrongFilter = { scope: 'due', type: '', cause: '' };
  function openWrongBook() {
    const p = insPanel('wrongbook-panel', '📕 错题本');
    insOpen(p);
    renderWrongBook();
    // 首次绑事件（渲染是整块重建，用事件委托一次绑好）
    const body = document.getElementById('wrongbook-panel-body');
    if (!body.dataset.wired) {
      body.dataset.wired = '1';
      body.addEventListener('click', e => {
        const t = e.target;
        const scope = t.closest && t.closest('[data-wscope]');
        if (scope) { wrongFilter.scope = scope.dataset.wscope; renderWrongBook(); return; }
        const redo = t.closest && t.closest('[data-wredo]');
        if (redo) { startWrongRedo(redo.dataset.wredo); return; }
        const pick = t.closest && t.closest('[data-wpick]');
        if (pick) { submitWrongRedo(pick.dataset.wpick, pick.dataset.wopt); return; }
        const back = t.closest && t.closest('[data-wback]');
        if (back) { renderWrongBook(); return; }
      });
      body.addEventListener('change', e => {
        const t = e.target;
        if (t && t.dataset && t.dataset.wfilter === 'type') { wrongFilter.type = t.value; renderWrongBook(); }
        if (t && t.dataset && t.dataset.wfilter === 'cause') { wrongFilter.cause = t.value; renderWrongBook(); }
      });
    }
  }
  let wrongRedoUid = null;
  function renderWrongBook() {
    const body = document.getElementById('wrongbook-panel-body');
    if (!body) return;
    const all = collectWrongs();
    const s = wrongStats(all);
    const types = Array.from(new Set(all.map(w => w.type).filter(Boolean))).sort();
    const causes = Array.from(new Set(all.map(w => w.cause).filter(Boolean)));
    let list = all;
    if (wrongFilter.scope === 'due') list = all.filter(w => w.due);
    else if (wrongFilter.scope === 'done') list = all.filter(w => w.rev && w.rev.done);
    if (wrongFilter.type) list = list.filter(w => w.type === wrongFilter.type);
    if (wrongFilter.cause) list = list.filter(w => w.cause === wrongFilter.cause);

    const chip = (val, cur, attr, label) =>
      '<button type="button" class="ins-chip' + (val === cur ? ' active' : '') + '" ' + attr + '="' + esc(val) + '">' +
      esc(label) + '</button>';

    let html =
      '<div class="ins-kpi">' +
      '<div class="ins-kpi-item"><b>' + s.total + '</b><span>总错题</span></div>' +
      '<div class="ins-kpi-item hot"><b>' + s.due + '</b><span>待复习</span></div>' +
      '<div class="ins-kpi-item"><b>' + s.done + '</b><span>已掌握</span></div>' +
      '<div class="ins-kpi-item"><b>' + s.fresh + '</b><span>未复习过</span></div>' +
      '</div>' +
      '<div class="ins-filters">' +
      chip('due', wrongFilter.scope, 'data-wscope', '待复习') +
      chip('all', wrongFilter.scope, 'data-wscope', '全部') +
      chip('done', wrongFilter.scope, 'data-wscope', '已掌握') +
      (types.length ? '<select data-wfilter="type"><option value="">题型：全部</option>' +
        types.map(t => '<option value="' + esc(t) + '"' + (t === wrongFilter.type ? ' selected' : '') + '>' + esc(t) + '</option>').join('') +
        '</select>' : '') +
      (causes.length ? '<select data-wfilter="cause"><option value="">错因：全部</option>' +
        causes.map(t => '<option value="' + esc(t) + '"' + (t === wrongFilter.cause ? ' selected' : '') + '>' +
          esc(WRONG_CAUSES[t] || t) + '</option>').join('') +
        '</select>' : '') +
      '</div>';

    if (!list.length) {
      html += '<div class="ins-empty">' +
        (all.length ? '当前筛选下没有错题。' :
          '还没有错题记录。<br><span class="ins-dim">做完一篇模拟考试，答错的题会自动进这里，并按间隔重复安排复习。</span>') +
        '</div>';
    } else {
      html += '<div class="ins-list">' + list.map(w => {
        const uid = esc(wrongRevKey(w.store, w.key));
        const rev = w.rev || {};
        const when = rev.last ? String(rev.last).replace('T', ' ').slice(0, 16) : '未复习';
        const state = rev.done ? '<span class="ins-tag ok">已掌握</span>'
          : (rev.nextDue ? '<span class="ins-tag' + (w.due ? ' due' : '') + '">' + (w.due ? '今日到期' : rev.nextDue + ' 复习') + '</span>' : '<span class="ins-tag">未开始</span>');
        return '<div class="ins-row">' +
          '<div class="ins-row-main">' +
          '<div class="ins-row-title">' +
          '<span class="ins-tag type">' + esc(w.storeLabel) + '</span>' +
          (w.type ? '<span class="ins-tag">' + esc(w.type) + '</span>' : '') +
          (w.cause ? '<span class="ins-tag cause">' + esc(WRONG_CAUSES[w.cause] || w.cause) + '</span>' : '') +
          state +
          '</div>' +
          '<div class="ins-row-sub">' + esc(w.title || w.slug) + ' · 第 ' + esc(w.no) + ' 题' +
          (w.myAnswer ? ' · 你选 ' + esc(w.myAnswer) : '') + (w.answer ? ' · 正确 ' + esc(w.answer) : '') +
          ' · ' + esc(when) + (rev.n ? ' · 连对 ' + rev.n + ' 次' : '') + '</div>' +
          (w.stem ? '<div class="ins-row-stem">' + esc(String(w.stem).slice(0, 160)) + '</div>' : '') +
          '</div>' +
          '<div class="ins-row-act">' +
          (w.redo ? '<button type="button" class="ins-btn" data-wredo="' + uid + '">重做</button>' : '') +
          (w.slug ? '<a class="ins-btn ghost" href="' + esc(w.page(w.slug)) + '" title="回到原练习页">原题</a>' : '') +
          '</div>' +
          '</div>';
      }).join('') + '</div>';
    }
    if (wrongRedoUid) html = renderWrongRedoHTML(all.find(w => wrongRevKey(w.store, w.key) === wrongRedoUid));
    body.innerHTML = html;
  }
  function startWrongRedo(uid) {
    wrongRedoUid = uid;
    renderWrongBook();
    const body = document.getElementById('wrongbook-panel-body');
    if (body) body.scrollTop = 0;
  }
  function renderWrongRedoHTML(w) {
    if (!w) { wrongRedoUid = null; return '<div class="ins-empty">找不到这道题。</div>'; }
    const opts = Object.keys(w.options || {});
    return '<div class="ins-redo">' +
      '<div class="ins-redo-head">' +
      '<span class="ins-tag type">' + esc(w.storeLabel) + '</span>' +
      '<b>' + esc(w.title || w.slug) + '</b><span class="ins-dim">第 ' + esc(w.no) + ' 题</span>' +
      '</div>' +
      '<div class="ins-redo-stem">' + esc(w.stem) + '</div>' +
      '<div class="ins-redo-opts">' + opts.map(k =>
        '<button type="button" class="ins-opt" data-wpick="' + esc(wrongRevKey(w.store, w.key)) + '" data-wopt="' + esc(k) + '">' +
        '<b>' + esc(k) + '</b>' + esc(String(w.options[k]).replace(/^\s*[A-D][.、)]\s*/, '')) + '</button>').join('') +
      '</div>' +
      '<div class="ins-dim">答案已遮罩 —— 先自己判断，再点选项。提交后按间隔重复安排下次复习。</div>' +
      '<div class="ins-actions"><button type="button" class="ins-btn ghost" data-wback="1">返回列表</button></div>' +
      '</div>';
  }
  function submitWrongRedo(uid, pick) {
    const w = collectWrongs().find(x => wrongRevKey(x.store, x.key) === uid);
    if (!w) { wrongRedoUid = null; renderWrongBook(); return; }
    const ok = String(pick) === String(w.answer);
    const rev = wrongSchedule(w, ok);
    wrongRedoUid = null;
    renderWrongBook();
    showTopToast(ok
      ? '答对了 · ' + (rev.done ? '已掌握，移出复习队列' : '下次复习 ' + rev.nextDue)
      : '还不对 · 1 天后再来（正确 ' + (w.answer || '—') + '）');
  }

  // ==========================================================================
  // F13 六题型能力雷达图
  // ==========================================================================
  // 数据来自 wsj_exam:history 的 perQ[].type —— 每道题的题型早在交卷时就逐题落库了，
  // **不需要**说明书里的 exam:stats:<articleId> 这种新键。
  const RADAR_TYPES = ['细节', '推理', '主旨', '态度', '词义', '例证'];
  function radarData() {
    const hist = insLoad('wsj_exam:history', []) || [];
    const acc = {};
    RADAR_TYPES.forEach(t => { acc[t] = { total: 0, correct: 0 }; });
    let other = 0, sessions = 0, answered = 0;
    hist.forEach(h => {
      if (!h || !Array.isArray(h.perQ) || !h.perQ.length) return;
      sessions++;
      h.perQ.forEach(q => {
        if (!q || !q.mine) return;                  // 未作答不计入（考试态留空 ≠ 答错）
        answered++;
        const ok = String(q.mine) === String(q.right);
        const t = String(q.type || '').trim();
        if (acc[t]) { acc[t].total++; if (ok) acc[t].correct++; }
        else other++;
      });
    });
    return { acc: acc, other: other, sessions: sessions, answered: answered };
  }
  function radarSvg(acc, size) {
    const N = RADAR_TYPES.length;
    const cx = size / 2, cy = size / 2, R = size * 0.33;
    const pt = (i, r) => {
      const a = -Math.PI / 2 + (Math.PI * 2 * i) / N;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    };
    const ring = k => RADAR_TYPES.map((_, i) => pt(i, R * k).map(v => v.toFixed(1)).join(',')).join(' ');
    const poly = RADAR_TYPES.map((t, i) => {
      const d = acc[t];
      const rate = d.total ? d.correct / d.total : 0;
      return pt(i, Math.max(R * 0.02, R * rate)).map(v => v.toFixed(1)).join(',');
    }).join(' ');
    let s = '<svg class="ins-radar" viewBox="0 0 ' + size + ' ' + size + '" width="100%" role="img" aria-label="六题型正确率雷达图">';
    [0.25, 0.5, 0.75, 1].forEach(k => {
      s += '<polygon points="' + ring(k) + '" fill="none" stroke="currentColor" stroke-opacity="' + (k === 1 ? 0.35 : 0.14) + '" stroke-width="1"/>';
    });
    RADAR_TYPES.forEach((t, i) => {
      const [x, y] = pt(i, R);
      s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) +
        '" stroke="currentColor" stroke-opacity="0.18" stroke-width="1"/>';
      const [lx, ly] = pt(i, R + 26);
      const d = acc[t];
      const pct = d.total ? Math.round(d.correct / d.total * 100) : 0;
      s += '<text x="' + lx.toFixed(1) + '" y="' + (ly - 5).toFixed(1) + '" text-anchor="middle" font-size="12" fill="currentColor">' + esc(t) + '</text>';
      s += '<text x="' + lx.toFixed(1) + '" y="' + (ly + 9).toFixed(1) + '" text-anchor="middle" font-size="11" fill="currentColor" fill-opacity="0.6">' +
        (d.total ? pct + '%' : '—') + '</text>';
    });
    s += '<polygon points="' + poly + '" fill="var(--accent)" fill-opacity="0.22" stroke="var(--accent)" stroke-width="1.5"/>';
    RADAR_TYPES.forEach((t, i) => {
      const d = acc[t];
      if (!d.total) return;
      const [x, y] = pt(i, Math.max(R * 0.02, R * (d.correct / d.total)));
      s += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.6" fill="var(--accent)"/>';
    });
    s += '</svg>';
    return s;
  }
  function openRadar() {
    const p = insPanel('radar-panel', '📡 六题型能力雷达');
    insOpen(p);
    const body = document.getElementById('radar-panel-body');
    if (!body) return;
    const d = radarData();
    let html = '';
    if (!d.answered) {
      html = '<div class="ins-empty">还没有可统计的作答记录。<br>' +
        '<span class="ins-dim">做完任意一篇模拟考试（交卷后）就会按题型统计到这里。</span></div>';
    } else {
      html = '<div class="ins-radar-wrap">' + radarSvg(d.acc, 300) + '</div>' +
        '<div class="ins-kpi">' +
        '<div class="ins-kpi-item"><b>' + d.sessions + '</b><span>考试次数</span></div>' +
        '<div class="ins-kpi-item"><b>' + d.answered + '</b><span>已作答题数</span></div>' +
        (d.other ? '<div class="ins-kpi-item"><b>' + d.other + '</b><span>其他题型</span></div>' : '') +
        '</div>' +
        '<table class="ins-table"><thead><tr><th>题型</th><th>答对 / 作答</th><th>正确率</th><th>薄弱</th></tr></thead><tbody>' +
        RADAR_TYPES.map(t => {
          const x = d.acc[t];
          const rate = x.total ? x.correct / x.total : 0;
          const pct = x.total ? Math.round(rate * 100) : 0;
          return '<tr' + (x.total && pct < 60 ? ' class="weak"' : '') + '><td>' + esc(t) + '</td>' +
            '<td>' + (x.total ? x.correct + ' / ' + x.total : '—') + '</td>' +
            '<td>' + (x.total ? pct + '%' : '—') + '</td>' +
            '<td>' + (x.total && pct < 60 ? '需要加练' : '') + '</td></tr>';
        }).join('') +
        '</tbody></table>' +
        '<div class="ins-dim">数据来源：本地成绩记录（不联网）。未作答的题不计入正确率；只统计六大阅读题型，' +
        '完形 / 新题型 / 翻译的题型另行归类。</div>';
    }
    body.innerHTML = html;
  }

  // ==========================================================================
  // F02 段落功能标签
  // ==========================================================================
  const PARA_FUNCS = [
    ['argument', '论点'], ['evidence', '论据'], ['transition', '转折'],
    ['conclusion', '结论'], ['background', '背景'], ['example', '例证']
  ];
  const PARA_FUNC_MAP = {};
  PARA_FUNCS.forEach(f => { PARA_FUNC_MAP[f[0]] = f[1]; });
  // 一段只保留一个功能标签
  function paraFuncIdxList() {
    const set = new Set();
    document.querySelectorAll('.col-body.en p[data-para-idx]').forEach(p => set.add(String(p.dataset.paraIdx)));
    return Array.from(set).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  }
  function paraFuncOf(idx) {
    const a = annotations.find(x => x.bucket === 'paraFunc' && String(x.paraIdx) === String(idx));
    return a ? a.func : '';
  }
  function setParaFunc(idx, func) {
    annotations = annotations.filter(a => !(a.bucket === 'paraFunc' && String(a.paraIdx) === String(idx)));
    if (func) {
      annotations.push({
        id: genId(), type: 'paraFunc', bucket: 'paraFunc',
        text: '第 ' + idx + ' 段', paraIdx: Number(idx), func: func,
        createdAt: new Date().toISOString()
      });
    }
    saveAnnotations();
    renderParaFuncs();
    showTopToast(func ? '第 ' + idx + ' 段标为「' + (PARA_FUNC_MAP[func] || func) + '」' : '已清除第 ' + idx + ' 段的功能标签');
  }
  // 标签做成「内容为空的 span + CSS content」，这样 textContent 不掺字：
  // 导出 Markdown / 复制正文 / 词频统计都不会把「论点」当成正文。
  function renderParaFuncs() {
    const map = {};
    annotations.forEach(a => { if (a.bucket === 'paraFunc' && a.paraIdx) map[String(a.paraIdx)] = a.func; });
    document.querySelectorAll('.col-body.en p[data-para-idx], .col-body.cn p[data-para-idx]').forEach(p => {
      const idx = String(p.dataset.paraIdx);
      Array.prototype.slice.call(p.querySelectorAll('.pfunc-chip')).forEach(c => c.remove());
      const f = map[idx];
      if (!f) { delete p.dataset.paraFunc; return; }
      p.dataset.paraFunc = f;
      const chip = document.createElement('span');
      chip.className = 'pfunc-chip';
      chip.setAttribute('data-pfunc', PARA_FUNC_MAP[f] || f);
      chip.setAttribute('contenteditable', 'false');
      chip.title = '段落功能：' + (PARA_FUNC_MAP[f] || f) + '（点击修改）';
      chip.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); openParaFuncPanel(idx); });
      p.insertBefore(chip, p.firstChild);
    });
  }
  function openParaFuncPanel(focusIdx) {
    const p = insPanel('pfunc-panel', '🏷 段落功能标签');
    insOpen(p);
    const body = document.getElementById('pfunc-panel-body');
    if (!body) return;
    const idxs = paraFuncIdxList();
    if (!idxs.length) {
      body.innerHTML = '<div class="ins-empty">没有找到正文段落。</div>';
      return;
    }
    const count = {};
    PARA_FUNCS.forEach(f => { count[f[0]] = 0; });
    annotations.forEach(a => { if (a.bucket === 'paraFunc' && count[a.func] !== undefined) count[a.func]++; });
    body.innerHTML =
      '<div class="ins-dim">给每段标一个功能：读结构、写作文、做新题型都用得上。标签存本篇，不写进正文。</div>' +
      '<div class="ins-filters">' + PARA_FUNCS.map(f =>
        '<span class="ins-chip legend f-' + f[0] + '">' + esc(f[1]) + ' ' + count[f[0]] + '</span>').join('') +
      '</div>' +
      '<div class="ins-list">' + idxs.map(i => {
        const f = paraFuncOf(i);
        const p0 = document.querySelector('.col-body.en p[data-para-idx="' + i + '"]');
        const preview = p0 ? String(p0.textContent || '').replace(/\s+/g, ' ').slice(0, 70) : '';
        return '<div class="ins-row' + (String(i) === String(focusIdx) ? ' focus' : '') + '" data-pfrow="' + i + '">' +
          '<div class="ins-row-main"><div class="ins-row-sub"><b>第 ' + i + ' 段</b> ' + esc(preview) + '…</div></div>' +
          '<div class="ins-row-act">' +
          '<select data-pfsel="' + i + '"><option value="">— 未标注 —</option>' +
          PARA_FUNCS.map(x => '<option value="' + x[0] + '"' + (f === x[0] ? ' selected' : '') + '>' + x[1] + '</option>').join('') +
          '</select>' +
          '<button type="button" class="ins-btn ghost" data-pfgoto="' + i + '">定位</button>' +
          '</div></div>';
      }).join('') + '</div>';
    if (!body.dataset.wired) {
      body.dataset.wired = '1';
      body.addEventListener('change', (e) => {
        const t = e.target;
        if (t && t.dataset && t.dataset.pfsel) setParaFunc(t.dataset.pfsel, t.value);
      });
      body.addEventListener('click', (e) => {
        const g = e.target.closest && e.target.closest('[data-pfgoto]');
        if (g) jumpToPara(g.dataset.pfgoto);
      });
    }
    const row = body.querySelector('[data-pfrow="' + focusIdx + '"]');
    if (row) row.scrollIntoView({ block: 'center' });
  }

  // ==========================================================================
  // F07 跨文章生词网络（+ F12 素材来源跳转共用这段跳转逻辑）
  // ==========================================================================
  // ⚠ 不建 vocab:index：词表完全可以由 registry + 各篇 annotations:<篇> 现场推导，
  //   再存一份索引就是第二份真相，还要考虑失效与迁移。
  function vocabOccurrences(word) {
    const w = String(word || '').trim().toLowerCase();
    if (!w) return [];
    const ids = insRegistry().map(r => r.id).filter(Boolean);
    if (ids.indexOf(articleId) < 0) ids.push(articleId);
    const out = [], seen = new Set();
    ids.forEach(id => {
      (insLoad('annotations:' + id, []) || []).forEach(a => {
        if (!a || a.bucket !== 'vocab' || !a.text) return;
        if (String(a.text).trim().toLowerCase() !== w) return;
        const k = id + '|' + (a.paraIdx || '?');
        if (seen.has(k)) return;
        seen.add(k);
        out.push({ id: id, paraIdx: a.paraIdx || '', context: a.context || '' });
      });
    });
    out.sort((a, b) => (a.id === articleId ? -1 : b.id === articleId ? 1 : 0));
    return out;
  }
  function allVocabWords() {
    const ids = insRegistry().map(r => r.id).filter(Boolean);
    if (ids.indexOf(articleId) < 0) ids.push(articleId);
    const map = {};   // lower → { word, articles:Set, mine:bool }
    ids.forEach(id => {
      (insLoad('annotations:' + id, []) || []).forEach(a => {
        if (!a || a.bucket !== 'vocab' || !a.text) return;
        const k = String(a.text).trim().toLowerCase();
        if (!k) return;
        if (!map[k]) map[k] = { word: String(a.text).trim(), articles: new Set(), mine: false };
        map[k].articles.add(id);
        if (id === articleId) map[k].mine = true;
      });
    });
    return Object.keys(map).map(k => ({ word: map[k].word, n: map[k].articles.size, mine: map[k].mine }))
      .sort((a, b) => b.n - a.n || a.word.localeCompare(b.word));
  }
  let vocabNetQuery = '';
  function openVocabNet(focusWord) {
    const p = insPanel('vocabnet-panel', '🕸 生词网络');
    insOpen(p);
    if (focusWord) vocabNetQuery = String(focusWord);
    renderVocabNet();
    const body = document.getElementById('vocabnet-panel-body');
    if (!body.dataset.wired) {
      body.dataset.wired = '1';
      body.addEventListener('input', (e) => {
        if (e.target && e.target.id === 'vocabnet-q') { vocabNetQuery = e.target.value; renderVocabNet(true); }
      });
      body.addEventListener('click', (e) => {
        const j = e.target.closest && e.target.closest('[data-vjump]');
        if (j) { jumpToRef(j.dataset.vjump, j.dataset.vpara); return; }
        const expand = e.target.closest && e.target.closest('[data-vexp]');
        if (expand) {
          // ⚠ 不要用 CSS.escape + 属性选择器查行：jsdom 里 CSS.escape 未必存在，
          //   直接从未被点的按钮往上找最近的 .ins-row 更稳。
          const row = expand.closest('.ins-row');
          const occ = row ? row.querySelector('.ins-occ') : null;
          if (occ) occ.hidden = !occ.hidden;
        }
      });
    }
  }
  function renderVocabNet(keepFocus) {
    const body = document.getElementById('vocabnet-panel-body');
    if (!body) return;
    const q = vocabNetQuery.trim().toLowerCase();
    const words = allVocabWords().filter(w => !q || w.word.toLowerCase().indexOf(q) >= 0);
    const cross = words.filter(w => w.n >= 2);
    const mineOnly = words.filter(w => w.mine && w.n < 2);
    const head =
      '<div class="ins-search"><input id="vocabnet-q" type="search" placeholder="搜一个词…" value="' + esc(vocabNetQuery) + '"></div>' +
      '<div class="ins-dim">同一篇里存过的生词会自动跨文章关联 —— 点位置直接跳到那篇文章那一段。</div>';
    if (!words.length) {
      body.innerHTML = head + '<div class="ins-empty">还没有生词记录。<br>' +
        '<span class="ins-dim">阅读时选中单词 → 「生词」，就会进这张网。</span></div>';
      return;
    }
    const rowHTML = w => {
      const occ = vocabOccurrences(w.word);
      const chips = occ.map(o =>
        '<button type="button" class="ins-chip jump" data-vjump="' + esc(o.id) + '" data-vpara="' + esc(o.paraIdx) + '" title="' +
        esc((o.context || '').slice(0, 90)) + '">' +
        esc(insTitleOf(o.id).slice(0, 16)) + (o.paraIdx ? ' · 第' + esc(o.paraIdx) + '段' : '') + '</button>').join('');
      return '<div class="ins-row" data-vrow="' + esc(w.word) + '">' +
        '<div class="ins-row-main">' +
        '<div class="ins-row-title"><b class="ins-word">' + esc(w.word) + '</b>' +
        (w.n >= 2 ? '<span class="ins-tag ok">' + w.n + ' 篇复现</span>' : '<span class="ins-tag">仅 1 篇</span>') +
        (w.mine ? '<span class="ins-tag type">本篇</span>' : '') +
        '<button type="button" class="ins-btn ghost" data-vexp="' + esc(w.word) + '">位置</button>' +
        '</div>' +
        '<div class="ins-occ" hidden>' + chips + '</div>' +
        '</div></div>';
    };
    body.innerHTML = head +
      (cross.length ? '<div class="ins-section">跨篇复现（' + cross.length + '）</div><div class="ins-list">' +
        cross.map(rowHTML).join('') + '</div>' : '') +
      (mineOnly.length ? '<div class="ins-section">本篇生词（' + mineOnly.length + '）</div><div class="ins-list">' +
        mineOnly.map(rowHTML).join('') + '</div>' : '');
    if (keepFocus) { const i = body.querySelector('#vocabnet-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }
  // 跳转到「另一篇文章的第 N 段」：带上 #para-N，目标页加载后由 initHashJump 定位
  function jumpToRef(fileId, paraIdx) {
    const h = paraIdx ? '#para-' + paraIdx : '';
    if (fileId === articleId) { if (paraIdx) jumpToPara(paraIdx); return; }
    location.href = insPageUrl(fileId) + h;
  }
  // 本页内跳到某段：报纸版走版次，三栏视图走滚动
  function jumpToPara(idx) {
    if (typeof paperIsOpen === 'function' && paperIsOpen() &&
        typeof paperGotoParaIdx === 'function' && paperGotoParaIdx(String(idx))) {
      flashPara(idx);
      return true;
    }
    const p = document.querySelector('.col-body.en p[data-para-idx="' + idx + '"]') ||
      document.querySelector('.col-body.cn p[data-para-idx="' + idx + '"]');
    if (!p) return false;
    p.scrollIntoView({ block: 'center', behavior: 'smooth' });
    flashPara(idx);
    return true;
  }
  function flashPara(idx) {
    document.querySelectorAll('.para-flash').forEach(el => el.classList.remove('para-flash'));
    document.querySelectorAll('.col-body.en p[data-para-idx="' + idx + '"], .col-body.cn p[data-para-idx="' + idx + '"]')
      .forEach(el => {
        el.classList.add('para-flash');
        setTimeout(() => el.classList.remove('para-flash'), 2600);
      });
  }
  // 从别的页面跳进来时带 #para-N：等报纸版建好再定位（建版是异步的，太早找不到版）
  function initHashJump() {
    const m = /^#para-(\d+)$/.exec(String(location.hash || ''));
    if (!m) return;
    const idx = m[1];
    let tries = 0;
    const attempt = () => {
      tries++;
      const ok = jumpToPara(idx);
      if (!ok && tries < 6) setTimeout(attempt, 400);
    };
    setTimeout(attempt, 800);
  }

  // ==========================================================================
  // F01 原文可视化标注（派生层）
  // ==========================================================================
  // 既有机制只覆盖 annotations（生词/笔记/题型）—— 它们有 `<mark data-id>`。
  // 真正的缺口是**长难句与写作素材**：它们存在 `syntax:<篇>` 和 `wsj_writing:materials` 里，
  // 从来没有出现在正文上，所以「我在正文里标过的东西」和「我攒下来的句子」是两张皮。
  //
  // 派生层（不新增存储，纯渲染）：
  //   · 从句库里取本篇的长难句、从素材库里取 articleId===本篇 的句子，回到正文里找**原句**；
  //   · 用 `<mark class="hl hl-derived hl-syntax|hl-material">` 包起来，点击弹出内容卡片；
  //   · ⚠ 不与既有标注**嵌套**：TreeWalker 直接拒绝 MARK 内的文本节点，
  //     所以「已经标过生词的词」不会被再包一层 —— 这是这一层唯一必须守住的约束；
  //   · ⚠ 幂等：每次重渲染先 unwrap 掉所有 `.hl-derived` 再重建；
  //   · 开关：`wsj_reader:derivedAnns`（默认开），层太花时可关掉。
  const DERIVED_PREF_KEY = 'wsj_reader:derivedAnns';
  function derivedOn() {
    let v = null;
    try { v = localStorage.getItem(DERIVED_PREF_KEY); } catch (e) {}
    return v === null || v === undefined ? true : v === '1' || v === true;
  }
  function setDerivedOn(on) {
    try { localStorage.setItem(DERIVED_PREF_KEY, on ? '1' : '0'); } catch (e) {}
    renderDerivedMarks();
    showTopToast(on ? '已开启正文派生标注（长难句 / 素材）' : '已隐藏正文派生标注');
  }
  function insMaterials() { return insLoad('wsj_writing:materials', []) || []; }
  function derivedEntries() {
    const out = [];
    (insLoad('syntax:' + articleId, []) || []).forEach((s, i) => {
      const t = String((s && (s.text || s.html)) || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (t.length >= 8) out.push({ kind: 'syntax', i: i, text: t });
    });
    insMaterials().forEach((m, i) => {
      if (m && m.articleId && m.articleId !== articleId) return;   // 只标本篇的素材
      const t = String((m && (m.sourceText || m.source)) || '').replace(/\s+/g, ' ').trim();
      if (t.length >= 8) out.push({ kind: 'material', i: i, text: t });
    });
    return out;
  }
  function unwrapDerived() {
    document.querySelectorAll('mark.hl-derived').forEach(m => {
      if (!m.parentNode) return;
      m.parentNode.replaceChild(document.createTextNode(m.textContent), m);
    });
    document.querySelectorAll('.col-body').forEach(el => { if (el.normalize) el.normalize(); });
  }
  function renderDerivedMarks() {
    unwrapDerived();
    if (!derivedOn()) return 0;
    const entries = derivedEntries();
    if (!entries.length) return 0;
    // 长句先占位：短句/短语不会把长句切碎
    entries.sort((a, b) => b.text.length - a.text.length);
    const bodies = document.querySelectorAll('.col-body.en');
    let n = 0;
    bodies.forEach(body => {
      entries.forEach(en => {
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
          acceptNode: (nd) => {
            if (!nd.parentNode) return NodeFilter.FILTER_REJECT;
            let p = nd.parentNode;
            while (p && p !== body) {
              if (p.nodeType === 1) {
                if (p.tagName === 'MARK') return NodeFilter.FILTER_REJECT;          // 不许嵌套
                if (p.classList && p.classList.contains('pfunc-chip')) return NodeFilter.FILTER_REJECT;
                if (p.tagName === 'SCRIPT' || p.tagName === 'STYLE') return NodeFilter.FILTER_REJECT;
              }
              p = p.parentNode;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        const nodes = [];
        let nd;
        while ((nd = walker.nextNode())) nodes.push(nd);
        for (let k = 0; k < nodes.length; k++) {
          const node = nodes[k];
          if (!node.parentNode) continue;
          const val = node.nodeValue;
          let from = 0;
          let placed = false;
          while (from <= val.length - en.text.length) {
            const i = val.indexOf(en.text, from);
            if (i < 0) break;
            if (isWordBoundaryMatch(val, i, en.text)) {
              const mark = document.createElement('mark');
              mark.className = 'hl hl-derived hl-' + en.kind;
              mark.dataset.derived = en.kind + ':' + en.i;
              mark.title = (en.kind === 'syntax' ? '长难句' : '写作素材') + '：点开看内容';
              mark.addEventListener('click', (e) => {
                e.preventDefault();
                openDerivedCard(mark.dataset.derived);
              });
              // ⚠ 必须**把原来那个文本节点搬进 mark**，不能给 mark 赋 textContent：
              //   赋 textContent 会在原地生成一份副本，而 splitText 切出来的那段还在文档里
              //   → 正文里同一句话出现两遍（实测被 verify_dictation 的「★ 长难句」用例抓到）。
              const mid = node.splitText(i);        // node=[0,i)  mid=[i,end)
              const tail = mid.splitText(en.text.length);   // mid=[i,i+len)  tail=余下
              mark.appendChild(mid);                // 把 mid 从文档里摘进 mark（不复制文本）
              tail.parentNode.insertBefore(mark, tail);
              n++;
              placed = true;
              break;
            }
            from = i + 1;
          }
          if (placed) break;   // 一个句子在本篇通常只出现一次，标到就停
        }
      });
    });
    return n;
  }
  // 点派生标注 → 内容卡片（长难句给结构，素材给起因/经过/逻辑）
  function openDerivedCard(key) {
    const m = /^(syntax|material):(\d+)$/.exec(String(key || ''));
    if (!m) return;
    const kind = m[1], i = Number(m[2]);
    const p = insPanel('derived-card', kind === 'syntax' ? '🧩 长难句' : '✍️ 写作素材');
    insOpen(p);
    const body = document.getElementById('derived-card-body');
    if (!body) return;
    if (kind === 'syntax') {
      const rec = (insLoad('syntax:' + articleId, []) || [])[i];
      if (!rec) { body.innerHTML = '<div class="ins-empty">这条长难句已经不在了。</div>'; return; }
      const plain = String(rec.html ? rec.html.replace(/<[^>]+>/g, '') : rec.text || '');
      body.innerHTML =
        '<div class="dt-cn" style="border-left-color:#3182ce;font-size:14px">' + esc(plain) + '</div>' +
        (rec.structure ? '<div class="ins-section">结构</div><div class="ins-dim">' + esc(String(rec.structure).replace(/\n/g, '　')) + '</div>' : '') +
        (rec.note ? '<div class="ins-section">笔记</div><div>' + esc(rec.note) + '</div>' : '') +
        '<div class="ins-dim">来源：' + esc(insTitleOf(articleId)) + (rec.paraIdx ? ' · 第 ' + esc(rec.paraIdx) + ' 段' : '') + '</div>' +
        '<div class="ins-actions">' +
        (rec.paraIdx ? '<button type="button" class="ins-btn ghost" data-dgoto="' + esc(rec.paraIdx) + '">看原文</button>' : '') +
        '<button type="button" class="ins-btn" data-ddict="' + esc(plain.slice(0, 200)) + '">🖊 默写这句</button>' +
        '</div>';
    } else {
      const rec = insMaterials()[i];
      if (!rec) { body.innerHTML = '<div class="ins-empty">这条素材已经不在了。</div>'; return; }
      body.innerHTML =
        '<div class="ins-row-title"><span class="ins-tag type">' + esc(rec.topic || '未归类') + '</span>' +
        (rec.usedCount ? '<span class="ins-tag ok">用过 ' + rec.usedCount + ' 次</span>' : '') + '</div>' +
        '<div class="dt-cn" style="border-left-color:#38a169;font-size:14px">「' + esc(rec.sourceText || rec.source || '') + '」</div>' +
        (rec.cause ? '<div><b>起因：</b>' + esc(rec.cause) + '</div>' : '') +
        (rec.process ? '<div><b>经过：</b>' + esc(rec.process) + '</div>' : '') +
        (rec.develop ? '<div><b>发展：</b>' + esc(rec.develop) + '</div>' : '') +
        (rec.logic ? '<div><b>逻辑：</b>' + esc(rec.logic) + '</div>' : '') +
        (rec.usage ? '<div><b>用法：</b>' + esc(rec.usage) + '</div>' : '') +
        '<div class="ins-actions">' +
        (rec.paraIdx ? '<button type="button" class="ins-btn ghost" data-dgoto="' + esc(rec.paraIdx) + '">看原文</button>' : '') +
        '<button type="button" class="ins-btn ghost" data-dopen-mat="1">去写作工坊</button>' +
        '</div>';
    }
    if (!body.dataset.wired) {
      body.dataset.wired = '1';
      body.addEventListener('click', (e) => {
        const t = e.target;
        const g = t.closest && t.closest('[data-dgoto]');
        if (g) { jumpToPara(g.dataset.dgoto); return; }
        const d = t.closest && t.closest('[data-ddict]');
        if (d && typeof window.openDictation === 'function') { window.openDictation(d.dataset.ddict); return; }
        if (t.closest && t.closest('[data-dopen-mat]')) { openWorkshopFromCard('materials'); return; }
      });
    }
  }
  // 卡片上的「去写作工坊」：走 window.__exam（面板在 exam-panel.js 里，reader 作用域拿不到）
  function openWorkshopFromCard(tab) {
    if (window.__exam && typeof window.__exam.openWritingWorkshop === 'function') {
      window.__exam.openWritingWorkshop(tab);
    } else {
      showTopToast('写作工坊还没准备好，请从「考试」菜单进入');
    }
  }

  // ==========================================================================
  // F18 学习总览（10 篇一屏看完）
  // ==========================================================================
  // 数据全部来自既有键：`reading:<id>`（时长/位置）+ `wsj_reader:article:<id>`（段数）+
  // `annotations:<id>` + `syntax:<id>` + `wsj_writing:materials` + `wsj_exam:history` + 4 个错题库
  // + `wsj_dictation:stats`。**不新建任何聚合键**（那会成为第二份真相）。
  function studyRowFor(id) {
    const reg = insRegistry().filter(r => r.id === id)[0] || {};
    const anns = insLoad('annotations:' + id, []) || [];
    const rd = insLoad('reading:' + id, {}) || {};
    const art = insLoad('wsj_reader:article:' + id, null) || {};
    const paras = (art.enParas || []).map(p => Number(p && p.idx) || 0);
    const paraMax = paras.length ? Math.max.apply(null, paras) : 0;
    const lastPos = Number(rd.lastPosition || 0);
    const title = reg.title || (id === articleId ? getShortTitle() : '') ||
      String(id).replace(/_EN-CN_final\.html$/, '').replace(/_/g, ' ');
    // 栏目 ID：本篇直接用 <body data-edition>；别的篇没有全局映射，靠考试记录里的 title 反查
    const hist = insLoad('wsj_exam:history', []) || [];
    let slug = (id === articleId && articleMeta.slug) ? articleMeta.slug : '';
    if (!slug && title) {
      const hit = hist.filter(h => h && h.slug && h.title === title)[0];
      if (hit) slug = hit.slug;
    }
    let correct = 0, total = 0;
    hist.forEach(h => {
      if (!slug || !h || h.slug !== slug) return;
      if (h.mode && h.mode !== 'exam' && h.mode !== 'reading') return;   // 阅读理解的成绩才算这一项
      correct += Number(h.correct || 0);
      total += Number(h.total || 0);
    });
    const wrongs = WRONG_STORES.reduce((n, st) =>
      n + (insLoad(st.key, []) || []).filter(w => w && slug && w.slug === slug).length, 0);
    const dictKeys = Object.keys(insLoad(DICT_STATS_KEY, {}) || {}).filter(k => k.indexOf(id + '#') === 0);
    return {
      id: id, title: title, slug: slug,
      seconds: Number(rd.totalSeconds || 0),
      progress: paraMax ? Math.min(100, Math.round(lastPos / paraMax * 100)) : 0,
      started: !!rd.lastPosition,
      vocab: anns.filter(a => a.bucket === 'vocab').length,
      note: anns.filter(a => a.bucket === 'note').length,
      misread: anns.filter(a => a.bucket === 'misread').length,
      syntax: (insLoad('syntax:' + id, []) || []).length,
      material: insMaterials().filter(m => m && m.articleId === id).length,
      rate: total ? Math.round(correct / total * 100) : null,
      trials: total, wrongs: wrongs, dict: dictKeys.length
    };
  }
  function studyRows() {
    const ids = insRegistry().map(r => r.id).filter(Boolean);
    if (articleId && ids.indexOf(articleId) < 0) ids.push(articleId);
    const rows = ids.map(studyRowFor);
    rows.sort((a, b) => b.seconds - a.seconds || a.title.localeCompare(b.title));
    return rows;
  }
  function fmtMinutes(sec) {
    const m = Math.round((sec || 0) / 60);
    return m >= 60 ? (m / 60).toFixed(1) + ' 小时' : m + ' 分钟';
  }
  function openStudyOverview() {
    const p = insPanel('study-panel', '📚 学习总览', '<button type="button" class="ins-btn ghost" data-srefresh="1">刷新</button>');
    insOpen(p);
    renderStudyOverview();
    const body = document.getElementById('study-panel-body');
    if (body && !body.dataset.wired) {
      body.dataset.wired = '1';
      body.addEventListener('click', (e) => {
        const t = e.target;
        if (t.closest && t.closest('[data-srefresh]')) { renderStudyOverview(); return; }
        const j = t.closest && t.closest('[data-sjump]');
        if (j) { jumpToRef(j.dataset.sjump, j.dataset.spara || ''); return; }
      });
    }
  }
  function renderStudyOverview() {
    const body = document.getElementById('study-panel-body');
    if (!body) return;
    const rows = studyRows();
    const sum = rows.reduce((a, r) => {
      a.seconds += r.seconds; a.vocab += r.vocab; a.syntax += r.syntax; a.material += r.material;
      a.wrongs += r.wrongs; a.dict += r.dict; a.misread += r.misread;
      if (r.started) a.started++;
      if (r.trials) { a.correct += 0; }
      return a;
    }, { seconds: 0, vocab: 0, syntax: 0, material: 0, wrongs: 0, dict: 0, misread: 0, started: 0, correct: 0 });
    const cross = allVocabWords().filter(w => w.n >= 2).length;
    let correct = 0, total = 0;
    (insLoad('wsj_exam:history', []) || []).forEach(h => {
      if (!h || (h.mode && h.mode !== 'exam' && h.mode !== 'reading')) return;
      correct += Number(h.correct || 0); total += Number(h.total || 0);
    });
    const dueWords = (typeof dueReviewCount === 'function') ? dueReviewCount() : 0;
    const dueWrongs = (typeof dueWrongCount === 'function') ? dueWrongCount() : 0;
    const readPct = rows.length ? Math.round(rows.reduce((n, r) => n + r.progress, 0) / rows.length) : 0;
    let html =
      '<div class="ins-kpi">' +
      '<div class="ins-kpi-item"><b>' + sum.started + '/' + rows.length + '</b><span>已开始阅读</span></div>' +
      '<div class="ins-kpi-item"><b>' + fmtMinutes(sum.seconds) + '</b><span>累计阅读</span></div>' +
      '<div class="ins-kpi-item"><b>' + sum.vocab + '</b><span>生词</span></div>' +
      '<div class="ins-kpi-item"><b>' + cross + '</b><span>≥2 篇复现</span></div>' +
      '<div class="ins-kpi-item"><b>' + sum.syntax + '</b><span>长难句</span></div>' +
      '<div class="ins-kpi-item"><b>' + sum.material + '</b><span>素材</span></div>' +
      '</div>' +
      '<div class="ins-kpi">' +
      '<div class="ins-kpi-item"><b>' + (total ? Math.round(correct / total * 100) + '%' : '—') + '</b><span>阅读题正确率</span></div>' +
      '<div class="ins-kpi-item"><b>' + sum.wrongs + '</b><span>错题</span></div>' +
      '<div class="ins-kpi-item"><b>' + sum.misread + '</b><span>理解偏差</span></div>' +
      '<div class="ins-kpi-item"><b>' + sum.dict + '</b><span>默写句数</span></div>' +
      '<div class="ins-kpi-item hot"><b>' + dueWords + '</b><span>今日待复习生词</span></div>' +
      '<div class="ins-kpi-item hot"><b>' + dueWrongs + '</b><span>今日待复习错题</span></div>' +
      '</div>' +
      '<div class="so-bar"><span>整体阅读进度</span><span class="so-track"><span class="so-fill" style="width:' + readPct + '%"></span></span><b>' + readPct + '%</b></div>';
    if (!rows.length) {
      html += '<div class="ins-empty">还没有任何文章记录。<br><span class="ins-dim">打开过一篇再回来，这里就会汇总。</span></div>';
    } else {
      html += '<table class="ins-table so-table"><thead><tr>' +
        '<th>文章</th><th>进度</th><th>生词</th><th>长难句</th><th>素材</th><th>正确率</th><th>错题</th><th>默写</th>' +
        '</tr></thead><tbody>' +
        rows.map(r =>
          '<tr' + (r.id === articleId ? ' class="cur"' : '') + '>' +
          '<td class="so-title">' +
          (((r.id === articleId) || !r.started) ? esc(r.title) :
            '<button type="button" class="so-link" data-sjump="' + esc(r.id) + '" title="打开这篇">' + esc(r.title) + '</button>') +
          (r.id === articleId ? ' <span class="ins-tag type">本篇</span>' : '') + '</td>' +
          '<td><span class="so-track"><span class="so-fill" style="width:' + r.progress + '%"></span></span> ' + r.progress + '%</td>' +
          '<td>' + (r.vocab || '—') + '</td><td>' + (r.syntax || '—') + '</td><td>' + (r.material || '—') + '</td>' +
          '<td>' + (r.rate === null ? '—' : r.rate + '%') + '</td><td>' + (r.wrongs || '—') + '</td><td>' + (r.dict || '—') + '</td>' +
          '</tr>').join('') +
        '</tbody></table>' +
        '<div class="ins-dim">正确率只统计阅读理解（完形 / 新题型 / 翻译的题型不同，混在一起没有意义）；' +
        '带下划线的标题可以点开那篇文章。所有数字都来自本机已有记录，不联网。' +
        (rows.filter(r => !r.slug).length ? '<br>注：有 ' + rows.filter(r => !r.slug).length +
          ' 篇暂时认不出栏目 ID（栏目 ID 只写在文章 HTML 里），这几篇的正确率与错题数会显示为 —。' : '') +
        '</div>';
    }
    body.innerHTML = html;
  }

  window.openWrongBook = openWrongBook;
  window.openRadar = openRadar;
  window.openParaFuncPanel = openParaFuncPanel;
  window.openVocabNet = openVocabNet;
  window.renderParaFuncs = renderParaFuncs;
  window.setParaFunc = setParaFunc;
  window.dueWrongCount = dueWrongCount;
  window.jumpToRef = jumpToRef;
  // F01 派生标注层 / F18 学习总览
  window.renderDerivedMarks = renderDerivedMarks;
  window.derivedOn = derivedOn;
  window.setDerivedOn = setDerivedOn;
  window.openDerivedCard = openDerivedCard;
  window.openStudyOverview = openStudyOverview;
  window.studyRows = studyRows;

  // ===== F11 中译英默写（看着中文译文，默写英文原句，逐词比对）=====
  //
  // 题库从**文章本身**现取，不新建索引：
  //   · 主来源 = 本篇 `.col-body.en p[data-para-idx]` ↔ `.col-body.cn p[data-para-idx]` 逐段配对，
  //     段内按句切分；英中句数一致就逐句配对，不一致则整段作为一格（标「整段」）；
  //   · 加成来源 = 本篇已标注的长难句（`syntax:<articleId>`），标 ★ 并排在前面；
  //   · 没有中文对照的句子（跨篇素材等）**不进题库** —— 默写必须有中文提示，硬凑会变成抄写。
  //
  // 存储：
  //   `wsj_dictation:stats`  每题的练习次数与最近正确率（用于「未默写 / 错过」筛选）
  //   `wsj_dictation:wrongs` 拼错的词侧车（spec 的「错词本」）—— 可一键并进生词本
  // 两个键都要在 09-reading.js 的备份白名单里。
  //
  // ⚠ 本模块必须排在 10-toolbar.js 之前（后者负责收尾 IIFE）。

  const DICT_STATS_KEY = 'wsj_dictation:stats';
  const DICT_WRONG_KEY = 'wsj_dictation:wrongs';

  // ---------- 句子切分 ----------
  // 英文：句末标点 + 空白/结尾。⚠ 必须用 lookahead —— 用 /[^.!?]+[.!?]+(\s+|$)/ 取第一个 match
  // 遇到 "the U.S. Senate" 这类缩写会从 "S. " 开始匹配（完形生成器踩过同一个坑）。
  function dictSplitEn(text) {
    const out = [];
    const re = /[.!?]["')\]]?(?=\s|$)/g;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      out.push(text.slice(last, m.index + m[0].length));
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out.map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }
  // 中文：句末标点后切。不用 lookbehind，避免老浏览器不支持。
  function dictSplitCn(text) {
    const out = [];
    let cur = '';
    String(text || '').split('').forEach(ch => {
      cur += ch;
      if ('。！？；'.indexOf(ch) >= 0) { if (cur.replace(/\s+/g, '').trim()) out.push(cur.trim()); cur = ''; }
    });
    if (cur.replace(/\s+/g, '').trim()) out.push(cur.trim());
    return out;
  }
  function dictWords(s) {
    return (String(s || '').match(/[A-Za-z0-9][A-Za-z0-9'’\-]*/g) || [])
      .map(w => w.replace(/^['’\-]+|['’\-]+$/g, ''))
      .filter(Boolean);
  }
  function dictKey(w) { return String(w).toLowerCase().replace(/[’']/g, ''); }

  // ---------- 题库 ----------
  function dictParaMap(cls) {
    const map = {};
    document.querySelectorAll('.col-body.' + cls + ' p[data-para-idx]').forEach(p => {
      map[String(p.dataset.paraIdx)] = String(p.textContent || '').replace(/\s+/g, ' ').trim();
    });
    return map;
  }
  function dictItems() {
    const en = dictParaMap('en'), cn = dictParaMap('cn');
    const idxs = Object.keys(en).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    // 长难句来源（标 ★）
    const star = {};
    let syn = [];
    try { syn = JSON.parse(localStorage.getItem('syntax:' + articleId)) || []; } catch (e) { syn = []; }
    syn.forEach(s => {
      const t = String((s && (s.text || s.html || '')) || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (t) star[dictKey(t.slice(0, 60))] = true;
    });
    const items = [], skipped = [];
    idxs.forEach(idx => {
      const enText = en[idx], cnText = cn[idx] || '';
      if (!cnText) { skipped.push(idx); return; }
      const enS = dictSplitEn(enText), cnS = dictSplitCn(cnText);
      if (enS.length > 1 && enS.length === cnS.length) {
        enS.forEach((s, k) => {
          const n = dictWords(s).length;
          if (n < 6 || n > 45) { skipped.push(idx); return; }
          items.push({
            id: 'p' + idx + 's' + (k + 1), paraIdx: idx, en: s, cn: cnS[k],
            star: !!star[dictKey(s.slice(0, 60))]
          });
        });
      } else {
        // 英中句数不一致：整段作为一格（太长就不出题，避免默写 200 词）
        const n = dictWords(enText).length;
        if (n < 6 || n > 45) { skipped.push(idx); return; }
        items.push({
          id: 'p' + idx + 'all', paraIdx: idx, en: enText, cn: cnText, whole: true,
          star: !!star[dictKey(enText.slice(0, 60))]
        });
      }
    });
    items.sort((a, b) => (b.star ? 1 : 0) - (a.star ? 1 : 0) || parseInt(a.paraIdx, 10) - parseInt(b.paraIdx, 10));
    // skipped 按「段」去重：面板提示说的是「有几段没出题」，不是有几个失败分支
    const skippedParas = [];
    skipped.forEach(s => { if (skippedParas.indexOf(s) < 0) skippedParas.push(s); });
    return { items: items, skipped: skippedParas };
  }

  // ---------- 逐词比对（LCS）----------
  // 不是简单的「公共子序列长度」——还要能告诉用户哪个词拼错了、哪个词漏了、多了什么，
  // 所以先求出对齐对，再把两侧的「空隙」配成 替换(missing) / 多写(extra)。
  //
  // 分词器是可换的：默写用「英文词」，笔记历史对比（F15）用「英文词 + 单个汉字 + 其它单字符」。
  // 两者共用同一套 LCS 与状态判定，避免出现两份会各自跑偏的 diff。
  function dictTokenizeEn(s) { return dictWords(s); }
  function dictTokenizeAny(s) {
    return (String(s || '').match(/[A-Za-z0-9'’\-]+|[\u4e00-\u9fff]|[^\s]/g) || []);
  }
  function diffTokens(original, input, tokenize) {
    const A = tokenize(original), B = tokenize(input);
    const n = A.length, m = B.length;
    const dp = [];
    for (let i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = dictKey(A[i]) === dictKey(B[j])
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    // 回溯出匹配对
    const pairs = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (dictKey(A[i]) === dictKey(B[j])) { pairs.push([i, j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    const aStatus = new Array(n).fill('missing');
    const bStatus = new Array(m).fill('extra');
    let correct = 0, wrong = 0;
    pairs.forEach(p => { aStatus[p[0]] = 'correct'; bStatus[p[1]] = 'correct'; correct++; });
    // 把两侧的空隙配对成「替换」：原词记 wrong，用户词也记 wrong
    let ai = 0, bi = 0, pi = 0;
    while (pi <= pairs.length) {
      const ae = pi < pairs.length ? pairs[pi][0] : n;
      const be = pi < pairs.length ? pairs[pi][1] : m;
      const an = ae - ai, bn = be - bi;
      const k = Math.min(an, bn);
      for (let q = 0; q < k; q++) { aStatus[ai + q] = 'wrong'; bStatus[bi + q] = 'wrong'; wrong++; }
      ai = ae; bi = be;
      if (pi < pairs.length) { ai = pairs[pi][0] + 1; bi = pairs[pi][1] + 1; }
      pi++;
    }
    const miss = aStatus.filter(s => s === 'missing').length;
    const extra = bStatus.filter(s => s === 'extra').length;
    const denom = Math.max(n, m) || 1;
    return {
      tokens: A.map((w, k) => ({ word: w, status: aStatus[k] })),
      userTokens: B.map((w, k) => ({ word: w, status: bStatus[k] })),
      correct: correct, wrong: wrong, missing: miss, extra: extra,
      lenA: n, lenB: m,
      accuracy: Math.round(correct / denom * 100),
      wrongWords: A.filter((w, k) => aStatus[k] !== 'correct')
    };
  }
  function dictDiff(original, input) { return diffTokens(original, input, dictTokenizeEn); }
  // 通用版（笔记历史 Delta 的「变了什么」视图用它）—— 中文按单字成 token，否则整段中文会被当成一个词
  function diffWords(original, input) { return diffTokens(original, input, dictTokenizeAny); }

  // ---------- 错词本 ----------
  function dictWrongs() { return insLoad(DICT_WRONG_KEY, []) || []; }
  function dictAddWrongs(words, paraIdx) {
    if (!words || !words.length) return;
    const arr = dictWrongs();
    words.forEach(w => {
      const k = dictKey(w);
      if (!k) return;
      const rec = arr.filter(x => dictKey(x.word) === k)[0];
      if (rec) {
        rec.count = (rec.count || 1) + 1;
        rec.lastAt = new Date().toISOString();
        if (paraIdx && !rec.paraIdx) rec.paraIdx = paraIdx;
      } else {
        arr.push({ word: w, count: 1, articleId: articleId, paraIdx: paraIdx || '', at: new Date().toISOString() });
      }
    });
    arr.sort((a, b) => (b.count || 0) - (a.count || 0));
    insSave(DICT_WRONG_KEY, arr);
  }
  // 错词并进生词本：这是真的「复用」——生词网络 / 词频着色 / 今日复习全都跟着生效
  function dictWordToVocab(word, paraIdx, context) {
    const w = String(word || '').trim();
    if (!w) return;
    const exists = annotations.some(a => a.bucket === 'vocab' && dictKey(a.text) === dictKey(w));
    if (exists) { showTopToast('「' + w + '」已在生词本里'); return; }
    annotations.push({
      id: genId(), type: 'vocab', bucket: 'vocab', text: w,
      note: '默写错词', context: context || '', paraIdx: paraIdx || '',
      createdAt: new Date().toISOString(), from: 'dictation'
    });
    saveAnnotations();
    showTopToast('「' + w + '」已加入生词本');
  }

  // ---------- 面板 ----------
  let dictState = { idx: 0, filter: 'all', items: [], skipped: [], input: '', result: null, revealed: false };
  var _dictBound = false;

  function dictStats() { return insLoad(DICT_STATS_KEY, {}) || {}; }
  function dictStatOf(it) { return dictStats()[articleId + '#' + it.id] || null; }
  function openDictation(focusText) {
    const p = insPanel('dictation-panel', '🖊 中译英默写');
    insOpen(p);
    const built = dictItems();
    dictState.items = built.items;
    dictState.skipped = built.skipped;
    if (focusText) {
      const k = dictKey(String(focusText).slice(0, 60));
      const hit = dictState.items.findIndex(it => dictKey(it.en.slice(0, 60)) === k);
      if (hit >= 0) dictState.idx = hit;
    }
    if (dictState.idx >= dictState.items.length) dictState.idx = 0;
    dictState.input = ''; dictState.result = null; dictState.revealed = false;
    renderDictation();
    const body = document.getElementById('dictation-panel-body');
    if (body && !_dictBound) {
      _dictBound = true;
      body.addEventListener('click', e => {
        const t = e.target;
        const pick = t.closest && t.closest('[data-dfilter]');
        if (pick) { dictState.filter = pick.dataset.dfilter; dictState.idx = 0; nextDictItem(); return; }
        if (t.closest && t.closest('#dict-submit')) { submitDictation(); return; }
        if (t.closest && t.closest('#dict-skip')) { nextDictItem(); return; }
        if (t.closest && t.closest('#dict-reveal')) {
          dictState.revealed = true; dictState.result = dictDiff(currentItem().en, dictState.input);
          renderDictation(); return;
        }
        if (t.closest && t.closest('#dict-prev')) { moveDict(-1); return; }
        if (t.closest && t.closest('#dict-next')) { moveDict(1); return; }
        const v = t.closest && t.closest('[data-dvocab]');
        if (v) { dictWordToVocab(v.dataset.dvocab, v.dataset.dpara, currentItem().en); return; }
        const g = t.closest && t.closest('[data-dgoto]');
        if (g) { jumpToPara(g.dataset.dgoto); return; }
        const all = t.closest && t.closest('#dict-allvocab');
        if (all) {
          const r = dictState.result;
          if (!r) return;
          const uniq = Array.from(new Set(r.wrongWords.map(dictKey)));
          r.wrongWords.forEach(w => dictWordToVocab(w, currentItem().paraIdx, currentItem().en));
          showTopToast('已把 ' + uniq.length + ' 个错词加入生词本');
          return;
        }
      });
      body.addEventListener('input', e => {
        if (e.target && e.target.id === 'dict-input') dictState.input = e.target.value;
      });
      body.addEventListener('keydown', e => {
        if (e.target && e.target.id === 'dict-input' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault(); submitDictation();
        }
      });
    }
  }
  function currentItem() { return dictState.items[dictState.idx] || null; }
  function dictFiltered() {
    const st = dictStats();
    return dictState.items.filter(it => {
      const s = st[articleId + '#' + it.id];
      if (dictState.filter === 'todo') return !s;
      if (dictState.filter === 'fail') return s && s.accuracy < 80;
      if (dictState.filter === 'star') return !!it.star;
      return true;
    });
  }
  function moveDict(d) {
    const list = dictFiltered();
    const cur = currentItem();
    const pos = list.indexOf(cur);
    const next = list[(pos < 0 ? 0 : pos + d + list.length) % list.length];
    if (!next) return;
    dictState.idx = dictState.items.indexOf(next);
    dictState.input = ''; dictState.result = null; dictState.revealed = false;
    renderDictation();
  }
  function nextDictItem() {
    const list = dictFiltered();
    if (!list.length) { renderDictation(); return; }
    const cur = currentItem();
    const pos = list.indexOf(cur);
    const next = list[(pos + 1) % list.length];
    if (next) dictState.idx = dictState.items.indexOf(next);
    dictState.input = ''; dictState.result = null; dictState.revealed = false;
    renderDictation();
  }
  function submitDictation() {
    const it = currentItem();
    if (!it) return;
    const input = (dictState.input || '').trim();
    if (!input) { showTopToast('先写下你的译文再提交'); return; }
    const r = dictDiff(it.en, input);
    dictState.result = r;
    const st = dictStats();
    const k = articleId + '#' + it.id;
    const rec = st[k] || { n: 0, best: 0 };
    rec.n = (rec.n || 0) + 1;
    rec.lastAccuracy = r.accuracy;
    rec.best = Math.max(rec.best || 0, r.accuracy);
    rec.lastAt = new Date().toISOString();
    st[k] = rec;
    insSave(DICT_STATS_KEY, st);
    if (r.wrongWords.length) dictAddWrongs(r.wrongWords, it.paraIdx);
    renderDictation();
    showTopToast(r.accuracy >= 95 ? '几乎完全正确（' + r.accuracy + '%）'
      : r.accuracy >= 80 ? '不错（' + r.accuracy + '%），还有 ' + r.wrongWords.length + ' 处要改'
        : '正确率 ' + r.accuracy + '%，错词已记入错词本');
  }
  function dictTokenHTML(tokens, side) {
    if (!tokens.length) return '<span class="ins-dim">（空）</span>';
    return tokens.map(t => {
      const cls = 'dt-tok dt-' + t.status + (side === 'user' ? ' dt-u' : '');
      const title = t.status === 'correct' ? '' : t.status === 'missing' ? '遗漏' : t.status === 'extra' ? '多写' : '拼写/用词不符';
      return '<span class="' + cls + '" title="' + esc(title) + '">' + esc(t.word) + '</span>';
    }).join(' ');
  }
  function renderDictation() {
    const body = document.getElementById('dictation-panel-body');
    if (!body) return;
    if (!dictState.items.length) {
      body.innerHTML = '<div class="ins-empty">这篇没有可默写的句子。<br>' +
        '<span class="ins-dim">默写需要「英文段落 + 对应中文译文」成对出现，并且句子长度在 6-45 词之间。' +
        '如果这篇的中文是空的，或句式无法逐句对齐，就不出题 —— 硬凑会变成抄写。</span></div>';
      return;
    }
    const st = dictStats();
    const list = dictFiltered();
    const done = dictState.items.filter(it => st[articleId + '#' + it.id]).length;
    const it = currentItem();
    const rec = it ? st[articleId + '#' + it.id] : null;
    const r = dictState.result;
    const chips = [
      ['all', '全部 ' + dictState.items.length],
      ['todo', '未默写 ' + (dictState.items.length - done)],
      ['fail', '正确率 <80% ' + dictState.items.filter(x => st[articleId + '#' + x.id] && st[articleId + '#' + x.id].accuracy < 80).length],
      ['star', '★ 长难句 ' + dictState.items.filter(x => x.star).length]
    ];
    let html = '<div class="ins-filters">' + chips.map(c =>
      '<button type="button" class="ins-chip' + (dictState.filter === c[0] ? ' active' : '') +
      '" data-dfilter="' + c[0] + '">' + esc(c[1]) + '</button>').join('') +
      '<span class="ins-dim" style="margin-left:auto">已练 ' + done + ' / ' + dictState.items.length + ' 句</span></div>';

    if (!it) {
      html += '<div class="ins-empty">当前筛选下没有句子。</div>';
      body.innerHTML = html;
      return;
    }
    const posInList = list.indexOf(it);
    html += '<div class="dt-head">' +
      '<span class="ins-tag' + (it.star ? ' ok' : '') + '">' + (it.star ? '★ 长难句' : '正文') + '</span>' +
      '<span class="ins-tag type">第 ' + esc(it.paraIdx) + ' 段' + (it.whole ? '（整段）' : '') + '</span>' +
      (rec ? '<span class="ins-tag">练过 ' + rec.n + ' 次 · 最高 ' + rec.best + '%</span>' : '<span class="ins-tag">未练过</span>') +
      '<button type="button" class="ins-btn ghost" data-dgoto="' + esc(it.paraIdx) + '">看原文</button>' +
      '<span class="ins-dim" style="margin-left:auto">' + (posInList + 1) + ' / ' + list.length + '</span>' +
      '</div>';
    html += '<div class="dt-cn">' + esc(it.cn) + '</div>';
    html += '<div class="dt-hint ins-dim">看中文写出对应的英文句子（Ctrl+Enter 提交）。' +
      '只比词，不比标点与大小写。</div>';
    html += '<textarea id="dict-input" class="dt-input" rows="' + (it.whole ? 6 : 3) + '" ' +
      'placeholder="在这里默写英文…">' + esc(dictState.input) + '</textarea>';
    html += '<div class="ws-import-actions">' +
      '<button type="button" class="primary" id="dict-submit">提交比对</button>' +
      '<button type="button" class="ins-btn ghost" id="dict-reveal">看答案</button>' +
      '<button type="button" class="ins-btn ghost" id="dict-skip">跳过</button>' +
      '<button type="button" class="ins-btn ghost" id="dict-prev">上一句</button>' +
      '<button type="button" class="ins-btn ghost" id="dict-next">下一句</button>' +
      '</div>';

    if (r) {
      const pct = r.accuracy;
      const tag = pct >= 95 ? 'ok' : pct >= 80 ? '' : 'cause';
      html += '<div class="dt-verdict"><span class="ins-tag ' + tag + '">' + pct + '% 正确</span>' +
        '<span class="ins-dim">对 ' + r.correct + ' · 错 ' + r.wrong + ' · 漏 ' + r.missing + ' · 多 ' + r.extra +
        '（原文 ' + r.lenA + ' 词 / 你写 ' + r.lenB + ' 词）</span></div>';
      html += '<div class="dt-line"><span class="dt-label">你写的</span><div class="dt-tokens">' +
        dictTokenHTML(r.userTokens, 'user') + '</div></div>';
      html += '<div class="dt-line"><span class="dt-label">原文</span><div class="dt-tokens">' +
        dictTokenHTML(r.tokens, 'orig') + '</div></div>';
      if (r.wrongWords.length) {
        const uniq = [];
        r.wrongWords.forEach(w => { if (!uniq.some(x => dictKey(x) === dictKey(w))) uniq.push(w); });
        html += '<div class="dt-wrong"><b>错词 ' + uniq.length + ' 个（已记入错词本）</b>' +
          '<div class="dt-wrong-list">' + uniq.map(w =>
            '<button type="button" class="ins-chip" data-dvocab="' + esc(w) + '" data-dpara="' + esc(it.paraIdx) +
            '" title="加入生词本">' + esc(w) + ' ＋</button>').join('') + '</div>' +
          '<button type="button" class="ins-btn ghost" id="dict-allvocab">全部加入生词本</button></div>';
      } else {
        html += '<div class="dt-verdict"><span class="ins-tag ok">逐词全对</span></div>';
      }
    }
    const wrongs = dictWrongs();
    if (wrongs.length) {
      html += '<details class="ws-samples"><summary>错词本（本机累计 ' + wrongs.length + ' 个词）</summary>' +
        '<div class="dt-wrong-list">' + wrongs.slice(0, 40).map(w =>
          '<span class="ins-chip legend">' + esc(w.word) + ' ×' + (w.count || 1) + '</span>').join('') +
        '</div><div class="ins-dim">点上面「＋」可以把错词并进生词本，之后生词网络、词频着色、今日复习都会带上它。</div></details>';
    }
    if (dictState.skipped.length) {
      html += '<div class="ins-dim">另有 ' + dictState.skipped.length + ' 处未出题（英中无法逐句对齐或长度超出 6-45 词）。</div>';
    }
    body.innerHTML = html;
    const ta = document.getElementById('dict-input');
    if (ta && !r) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }

  window.openDictation = openDictation;
  window.dictDiff = dictDiff;
  window.diffWords = diffWords;   // 通用词级 diff（笔记历史 Delta 的对比视图用它）
  window.dictItems = dictItems;

﻿  // ===== 考试模式：5 个相互独立的模块 =====
  // 设计约定：
  //   * 「有哪些模块」的**唯一事实来源**是 <body data-exam-types>（由 scripts/sync_article_meta.py 维护）；
  //   * 本表只描述「每一类长什么样、怎么进」。新增一类 = 改 EXAM_TYPES + 在这里补一行，菜单自动出现；
  //   * 5 个模块彼此独立：各自一个页面或面板，各自存自己的数据，互不依赖。
  const EXAM_MODULES = [
    { key: 'reading', icon: '📝', label: '阅读理解', en: 'Reading Comprehension', prefix: 'exam_',
      desc: '五道选择题，计时作答，交卷才揭晓对错' },
    { key: 'cloze', icon: '🧩', label: '完形填空', en: 'Use of English', prefix: 'cloze_',
      desc: '20 空，选项自动联动生词本' },
    { key: 'newtype', icon: '🔗', label: '新题型', en: 'New Question Types', prefix: 'newtype_',
      desc: '七选五 / 排序 / 小标题' },
    { key: 'translation', icon: '✍', label: '翻译练习', en: 'Translation', prefix: 'translation_',
      desc: '5 句长难句英译中 + 分点自评' },
    { key: 'writing', icon: '✍️', label: '写作', en: 'Writing', panel: 'openWritingWorkshop',
      desc: '写作工坊：素材 / 建议文 / 长难句 / 词根' }
  ];
  function examModulesAvailable() {
    const on = articleMeta.examTypes || [];
    return EXAM_MODULES.filter(m => on.indexOf(m.key) >= 0);
  }
  function examModuleOpen(m) {
    if (!m) return;
    if (m.panel) { loadExamPanel().then(E => { if (E && E[m.panel]) E[m.panel](); }).catch(() => {}); return; }
    if (!articleMeta.slug) { showTopToast('本篇没有登记栏目 ID，无法打开考试模块'); return; }
    location.href = m.prefix + articleMeta.slug + '.html';
  }
  function examModuleItems() {
    const mods = examModulesAvailable();
    if (!mods.length) return '<div class="menu-note">本篇未收录考试模块</div>';
    return mods.map(m => menuItemHTML('exam-mod-' + m.key, m.icon, m.label, m.desc)).join('');
  }
  // 考试模式总览：把 5 个模块并排摆出来，各自独立进入（考研试卷的封套样式）
  function openExamHub() {
    closeAllMenus();
    const old = document.getElementById('exam-hub');
    if (old) old.remove();
    const on = articleMeta.examTypes || [];
    const src = document.querySelector('.title-block h1:not(.cn)');
    const cards = EXAM_MODULES.map(m => {
      const enabled = on.indexOf(m.key) >= 0;
      return '<button type="button" class="eh-card' + (enabled ? '' : ' is-off') + '"' +
        (enabled ? ' data-mod="' + m.key + '"' : ' disabled') + '>' +
        '<span class="eh-icon">' + m.icon + '</span>' +
        '<span class="eh-name">' + esc(m.label) + '</span>' +
        '<span class="eh-en">' + esc(m.en) + '</span>' +
        '<span class="eh-desc">' + esc(m.desc) + '</span>' +
        '<span class="eh-state">' + (enabled ? '进入 →' : '本篇未收录') + '</span></button>';
    }).join('');
    const ov = document.createElement('div');
    ov.className = 'exam-hub';
    ov.id = 'exam-hub';
    ov.innerHTML =
      '<div class="eh-box">' +
      '<header class="eh-head">' +
      '<div class="eh-secret">绝密★启用前</div>' +
      '<h3>考试模式</h3>' +
      '<div class="eh-sub">2026 年全国硕士研究生招生考试　英语（一）</div>' +
      (src ? '<div class="eh-src">' + esc(src.textContent.trim()) + '</div>' : '') +
      '</header>' +
      '<div class="eh-grid">' + cards + '</div>' +
      '<footer class="eh-foot">' +
      '<span>五个模块彼此独立：各有各的界面与记录，互不影响，可单独进入</span>' +
      '<button type="button" class="eh-close">关闭</button></footer>' +
      '</div>';
    document.body.appendChild(ov);
    ov.querySelector('.eh-close').addEventListener('click', () => ov.remove());
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
    ov.querySelectorAll('[data-mod]').forEach(b => {
      b.addEventListener('click', () => {
        const m = EXAM_MODULES.filter(x => x.key === b.dataset.mod)[0];
        ov.remove();
        examModuleOpen(m);
      });
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('exam-hub')) document.getElementById('exam-hub').remove();
  });
  window.openExamHub = openExamHub;

  // ===== Injected menu extras (UX-2 / UX-4 / UX-7) — article HTML stays untouched =====
  // 考试相关入口的显隐与寻址一律走 articleMeta（读 <body data-*>），
  // 不再维护「文件名 → slug」映射表；新增文章只要 HTML 属性写对即可。
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
  // 菜单里的「保存位置」标签：显示用户选过的文件夹名，没选过就说清楚默认会去哪儿
  function saveDirMenuLabel() {
    const saved = parseLS('wsj_reader:backupDirName', '');
    if (saved) return '保存到：' + saved + (backupDirVolatile() ? '（本次有效）' : '');
    return dirPickerSupported() ? '设置保存文件夹…' : '保存位置（浏览器下载）';
  }
  function saveDirMenuTitle() {
    if (!dirPickerSupported()) {
      return '当前浏览器不支持选文件夹，导出只能进浏览器默认下载文件夹；可在浏览器「设置 → 下载」里改默认目录';
    }
    if (backupDirVolatile()) {
      return '文件夹句柄没能存住（本机 IndexedDB 不可用）：这次会话内导出会写进去，重开页面后需要重选一次';
    }
    return '选一次文件夹，之后所有导出（Markdown / JSON / 生词 CSV / 作文 / 模板 / 备份）都直接写进去，不再走浏览器下载';
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
    const examSlug = articleMeta.hasExam ? articleMeta.slug : '';
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
      '<div class="menu-section-label">阅读版式</div>' +
      menuItemHTML('paper-mode-btn', '📰', '报纸版', '电子报版面：对开双页 + 多栏 + 翻版（← → 翻版）') +
      menuItemHTML('reader-mode-btn', '▤', '三栏对照', '原文 / 摘要 / 译文 三栏并排 + 滚动同步（适合逐段精读与编辑）') +
      '<div class="menu-sep"></div>' +
      menuItemHTML('toggle-header-btn', '📰', '标题区显隐') +
      menuItemHTML('freq-toggle-btn', '🎨', '词频着色') +
      '<div class="freq-legend"><span class="fl-h">高频</span><span class="fl-m">中频</span>' +
      '<span class="fl-l">低频</span><span class="fl-x">超纲</span><span class="fl-v">已录生词</span></div>' +
      menuItemHTML('undo-edit-btn', '↩', '撤销编辑', '撤销上一次对概要 / 中文 / 笔记的修改', 'Ctrl+Shift+Z') +
      menuItemHTML('shortcuts-help-btn', '⌨', '快捷键一览');

    // 3) 考试 —— 考试模式的 5 个模块，菜单由 <body data-exam-types> 动态生成（相互独立）
    const examMenu =
      '<div class="menu-section-label">考试模式</div>' +
      menuItemHTML('exam-hub-btn', '🎓', '考试模式总览', '本篇可用的全部考试模块，各自独立进入') +
      '<div class="menu-sep"></div>' +
      examModuleItems();

    // 4) 数据 —— 存下来 / 拿回来 / 导出去 / 看分析
    // 「错题本」与「能力雷达」都建立在既有数据上：4 个错题库 + wsj_exam:history 的逐题题型，
    // 所以它们属于「数据」这一组 —— 看的是已经攒下来的东西。
    const wrongN = (typeof dueWrongCount === 'function') ? dueWrongCount() : 0;    const dataMenu =
      '<div class="menu-section-label">学习分析</div>' +
      menuItemHTML('study-btn', '📚', '学习总览', '十篇文章一屏看完：进度 / 生词 / 长难句 / 素材 / 正确率 / 错题 / 默写') +
      menuItemHTML('wrongbook-btn', '📕', wrongN > 0 ? '错题本（' + wrongN + ' 道待复习）' : '错题本',
        '四个练习模块的错题汇总，按间隔重复安排复习，可就地重做', '', wrongN > 0 ? 'due-hot' : '') +
      menuItemHTML('radar-panel-btn', '📡', '六题型能力雷达', '按细节 / 推理 / 主旨 / 态度 / 词义 / 例证 统计正确率') +
      '<div class="menu-sep"></div><div class="menu-section-label">文件保存位置</div>' +
      menuItemHTML('save-dir-btn', '📂', saveDirMenuLabel(), saveDirMenuTitle()) +
      '<div class="menu-sep"></div><div class="menu-section-label">备份与恢复</div>' +
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
      '<div class="menu-sep"></div><div class="menu-section-label">精读工具</div>' +
      menuItemHTML('pfunc-btn', '🏷', '段落功能标签', '给每段标论点 / 论据 / 转折 / 结论 / 背景 / 例证，看清文章结构') +
      menuItemHTML('vocabnet-btn', '🕸', '生词网络', '同一个词在多篇文章里出现的位置，点一下跳过去') +
      menuItemHTML('dictation-btn', '🖊', '中译英默写', '看着本段中文译文默写英文原句，逐词比对、错词进错词本') +
      menuItemHTML('derived-btn', '🎯', '正文派生标注', '把你标注过的长难句 / 写作素材也标在原文上（点击看内容）') +
      '<div class="menu-sep"></div><div class="menu-section-label">复习</div>' +
      menuItemHTML('review-due-btn', '🎯', dueN > 0 ? '今日待复习 ' + dueN + ' 条' : '复习生词（文库）', '到期生词与题型卡，跳转文库开始复习', '', dueN > 0 ? 'due-hot' : '') +
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
    on('paper-mode-btn', () => togglePaper(true));
    on('reader-mode-btn', () => togglePaper(false));
    on('toggle-header-btn', toggleHeader); // 新菜单里的按钮没有 inline onclick，必须在这里绑
    on('backup-data-btn', () => { backupAllData(); });
    on('save-dir-btn', () => { openSaveDirDialog(); });
    on('backup-panel-btn', openBackupPanel);
    on('restore-data-btn', restoreData);
    on('export-md-btn', exportMarkdown);
    on('export-json-btn', exportJson);
    on('export-vocab-csv-btn', exportVocabCsv);
    on('print-btn', () => window.print());
    on('toggle-search-btn', () => toggleSearch());
    on('crossref-btn', () => toggleCrossRef());
    on('stats-panel-btn', openStatsPanel);
    on('exam-hub-btn', openExamHub);
    // 精读分析台（11-insights.js）
    on('wrongbook-btn', () => openWrongBook());
    on('radar-panel-btn', () => openRadar());
    on('pfunc-btn', () => openParaFuncPanel());
    on('vocabnet-btn', () => openVocabNet());
    on('dictation-btn', () => openDictation());
    on('derived-btn', () => setDerivedOn(!derivedOn()));
    on('study-btn', () => openStudyOverview());
    // 考试模式各模块（按本篇 data-exam-types 动态绑定）
    examModulesAvailable().forEach(m => on('exam-mod-' + m.key, () => examModuleOpen(m)));
    on('review-due-btn', openHub);
    on('ai-zhipu-btn', () => openAISide('zhipu'));
    on('ai-qwen-btn', () => openAISide('qwen'));
    on('hub-btn', openHub);
    on('compare-btn', openCompare);
    const freqBtn = document.getElementById('freq-toggle-btn');
    if (freqBtn) freqBtn.addEventListener('click', () => { toggleFreqColoring(); });
    updateFreqBtn();
    updatePaperButtons();
    injectExamModeToggle(examSlug);
  }
  // 考试页状态提示：在考试菜单的「阅读理解」项上标出当前是考试态还是练习态（由 exam.js 写入 localStorage）
  function injectExamModeToggle(examSlug) {
    if (!examSlug) return;
    const btn = document.getElementById('exam-mod-reading');
    if (!btn) return;
    let mode = 'exam';
    try { mode = JSON.parse(localStorage.getItem('exammode:' + examSlug) || '"exam"'); } catch (e) {}
    const label = btn.querySelector('span:nth-child(2)');
    if (label) label.textContent = '阅读理解（' + (mode === 'practice' ? '练习态' : '考试态') + '）';
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
    setupFloatMenu();
    // Lazy-load exam-panel.js, then init exam-related UI
    // ⚠ setupSyntaxPanel / upgradeSyntaxPanel / upgradeMaterialPanel 定义在 06-exam.js
    //   自己的 IIFE 里，reader.js 作用域访问不到——必须经 window.__exam（即回调参数 E）调用。
    //   曾因裸调用抛 ReferenceError 被 .catch 静默吞掉，导致句法/素材面板的升级代码从未执行。
    loadExamPanel().then((E) => {
      ensureExamUI();               // 本文件作用域（04-scroll.js）可直接调用
      if (!E) return;
      E.setupSyntaxPanel();
      E.upgradeSyntaxPanel();
      E.upgradeMaterialPanel();
    }).catch((err) => { console.warn('[reader] exam-panel 初始化失败:', err); });
    // UX-6: defer first height sync to idle time (fallback: 250ms)
    deferInitialHeightSync();
    // 段落功能标签：把已存的标签打到段落上（报纸版与三栏视图都能看到）
    renderParaFuncs();
    // F01：长难句 / 素材的派生标注（与上面的段落标签同属「段落装饰」，
    // 都必须在 reapplyAllHighlights / 词频着色之后做，否则会被它们的 DOM 重写冲掉）
    renderDerivedMarks();
    // 从别的页面带 #para-N 跳进来时定位（等报纸版建好再跳，见 initHashJump）
    initHashJump();
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
    // 恢复上次选的阅读版式。报纸版是覆盖层且要按真实排版分版，必须等字体/布局稳定后再建。
    if (paperModeOn()) {
      const bootPaper = () => setTimeout(() => { if (paperModeOn() && !paperIsOpen()) togglePaper(true); }, 30);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(bootPaper).catch(bootPaper);
      else bootPaper();
    }
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
  // Exam panel functions — loaded lazily via exam-panel.js
  window.openSyntaxPanel = (t) => loadExamPanel().then(E => E.openSyntaxPanel(t));
  window.closeSyntaxPanel = () => loadExamPanel().then(E => E.closeSyntaxPanel());
  window.saveSyntax = () => loadExamPanel().then(E => E.saveSyntax());
  window.openMaterialPanel = (t) => loadExamPanel().then(E => E.openMaterialPanel(t));
  window.closeMaterialPanel = () => loadExamPanel().then(E => E.closeMaterialPanel());
  window.saveMaterial = () => loadExamPanel().then(E => E.saveMaterial());
  window.exportQtype = () => loadExamPanel().then(E => E.exportQtype());
  window.recordRoot = (t) => loadExamPanel().then(E => E.recordRoot(t));
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
    // 报纸模式下触发按钮被搬进报眉的栏目索引栏（已不在 .toolbar 内）。
    // 此时不写 inline 偏移：下拉由 CSS 锚在各自栏目按钮的正下方，
    // 否则会残留三栏模式算出的 left 值，弹到按钮右边去。
    if (btn.closest('.np-menus')) {
      menu.style.left = ''; menu.style.right = ''; menu.style.top = '';
      return;
    }
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

  // ===== Bridge to exam-panel.js (lazy-loaded external script) =====
  window.__reader = {
    esc, genId, articleId, articleMeta,
    get annotations() { return annotations; },
    saveAnnotations, renderNotes,
    // 普通标注的统一入口（浮动菜单与外部注入都用它）—— 暴露出来是为了让
    // 「理解偏差」这类新 bucket 可被单独验证，也方便 exam-panel 直接建标注
    addAnnotation, deleteAnnotation,
    get settings() { return settings; },
    saveSettings, closeAllMenus,
    showTopToast, getShortTitle,
    // 统一落盘：exam-panel.js（独立 IIFE）与将来的模块都靠这两个往「用户选的文件夹」写文件，
    // 没有它们就只能退回 <a download> → 浏览器默认下载文件夹（这正是用户抱怨的那件事）
    saveFile, saveResultToast, sanitizeFilename,
    pickBackupDir, getBackupDir, forgetBackupDir, dirPickerSupported,
    get qTypeFilter() { return qTypeFilter; },
    set qTypeFilter(v) { qTypeFilter = v; },
    get qMasteryFilter() { return qMasteryFilter; },
    set qMasteryFilter(v) { qMasteryFilter = v; },
    get activeTagFilters() { return activeTagFilters; },
    get noteSearchQuery() { return noteSearchQuery; },
  };
})();
