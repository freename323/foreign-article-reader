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
    const bucketAnns = notesBucket === 'all' ? annotations : annotations.filter(a => a.bucket === notesBucket);
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
    const typeName = { vocab: '📖 生词', unclear: '❓ 不懂', note: '💡 备注' };
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
