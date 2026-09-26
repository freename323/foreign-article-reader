(function () {
  // Bridge to reader.js IIFE scope
  const R = window.__reader || {};
  const esc = R.esc || (s => String(s == null ? '' : s));
  const genId = R.genId || (() => Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  const articleId = R.articleId || 'article';
  const saveAnnotations = R.saveAnnotations || (() => {});
  const renderNotes = R.renderNotes || (() => {});
  const saveSettings = R.saveSettings || (() => {});
  const closeAllMenus = R.closeAllMenus || (() => {});
  const showTopToast = R.showTopToast || ((m) => console.log(m));
  const getShortTitle = R.getShortTitle || (() => 'article');
  // v29: IIFE 内 annotations / activeTagFilters 直接使用 R 上的引用，确保 .push / .splice
  // 写操作能立即反映到 reader.js 顶层（saveAnnotations 写 localStorage 时能包含新数据）
  // settings / qTypeFilter / qMasteryFilter / noteSearchQuery 是 scalar，用 syncToR() 同步
  let annotations = R.annotations || (R.annotations = []);
  let activeTagFilters = R.activeTagFilters || (R.activeTagFilters = []);
  let settings = R.settings || {};
  let qTypeFilter = R.qTypeFilter || 'all';
  let qMasteryFilter = R.qMasteryFilter || 'all';
  let noteSearchQuery = R.noteSearchQuery || '';
  function syncToR() {
    if (R.qTypeFilter !== qTypeFilter) R.qTypeFilter = qTypeFilter;
    if (R.qMasteryFilter !== qMasteryFilter) R.qMasteryFilter = qMasteryFilter;
    if (R.noteSearchQuery !== noteSearchQuery) R.noteSearchQuery = noteSearchQuery;
  }
  // showTopToast / getShortTitle moved to 00-head.js

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
    syncToR();
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
    // v29: annotations 现在是 R.annotations 的引用，.push 后 saveAnnotations 正确写入 localStorage
    annotations.push(ann);
    saveAnnotations();
    updateNoteCount();
    if (R.renderNotes) R.renderNotes();
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
    syncToR();
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
      btn.addEventListener('click', () => { qMasteryFilter = btn.dataset.qmfilter; syncToR(); renderNotes(); });
    });
    scope.querySelectorAll('[data-qtfilter]').forEach(btn => {
      btn.addEventListener('click', () => { qTypeFilter = btn.dataset.qtfilter; syncToR(); renderNotes(); });
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
  let _syntaxAutoId = null;
  let _syntaxParaIdx = '';      // 这条长难句来自第几段（素材/句库的「来源」跳转用）
  function openSyntaxPanel(text, paraIdx) {
    const panel = document.getElementById('syntax-panel');
    if (!panel) return;
    _syntaxParaIdx = paraIdx || '';
    document.getElementById('syntax-text').textContent = text || '';
    document.getElementById('syntax-note').value = '';
    resetStructRows();
    // Create record immediately so it auto-saves on blur
    const plain = (text || '').trim();
    if (plain) {
      _syntaxAutoId = genId();
      const key = 'syntax:' + articleId;
      let arr = [];
      try { arr = JSON.parse(localStorage.getItem(key)) || []; } catch(e) {}
      arr.push({ id: _syntaxAutoId, text: plain, html: document.getElementById('syntax-text').innerHTML, note: '', structure: collectStructRows(), paraIdx: _syntaxParaIdx, createdAt: new Date().toISOString() });
      try { localStorage.setItem(key, JSON.stringify(arr)); } catch(e) {}
    }
    panel.classList.add('visible');
    // Auto-save on blur
    const noteEl = document.getElementById('syntax-note');
    if (noteEl && !noteEl.dataset.bound) {
      noteEl.dataset.bound = '1';
      noteEl.addEventListener('blur', () => {
        if (!_syntaxAutoId) return;
        const key = 'syntax:' + articleId;
        let arr = [];
        try { arr = JSON.parse(localStorage.getItem(key)) || []; } catch(e) {}
        const rec = arr.find(x => x.id === _syntaxAutoId);
        if (rec) { rec.note = noteEl.value.trim(); try { localStorage.setItem(key, JSON.stringify(arr)); } catch(e) {} }
      });
    }
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
    arr.push({ id: genId(), text: plain, html: textEl.innerHTML, note: noteEl.value.trim(), structure: collectStructRows(), paraIdx: _syntaxParaIdx, createdAt: new Date().toISOString() });
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
    closeSyntaxPanel();
    showTopToast('已存入句库');
    // F01：长难句刚落库，正文里的派生标注要立刻跟上（renderDerivedMarks 定义在 11-insights.js，
    // 与这里同属一个 IIFE，运行期可直接调用）
    if (typeof renderDerivedMarks === 'function') renderDerivedMarks();
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
  let _materialAutoId = null;
  let _materialParaIdx = '';    // 这条素材来自第几段
  function openMaterialPanel(text, paraIdx) {
    const panel = document.getElementById('material-panel');
    if (!panel) return;
    _materialParaIdx = paraIdx || '';
    document.getElementById('material-source').textContent = text || '';
    panel.querySelectorAll('input, textarea').forEach(el => { el.value = ''; });
    setMaterialType('fact'); // default type
    // Create record immediately
    _materialAutoId = genId();
    const key = 'wsj_writing:materials';
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(key)) || []; } catch(e) {}
    arr.push({ id: _materialAutoId, sourceText: (text||'').trim(), articleId: articleId, paraIdx: _materialParaIdx,
      materialType: 'fact', topic: '', usedCount: 0, lastUsedAt: null, createdAt: new Date().toISOString() });
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch(e) {}
    panel.classList.add('visible');
    // Auto-save on blur of any field
    panel.querySelectorAll('input, textarea').forEach(el => {
      if (el.dataset.boundMat) return;
      el.dataset.boundMat = '1';
      el.addEventListener('blur', () => {
        if (!_materialAutoId) return;
        const key = 'wsj_writing:materials';
        let arr = [];
        try { arr = JSON.parse(localStorage.getItem(key)) || []; } catch(e) {}
        const rec = arr.find(x => x.id === _materialAutoId);
        if (!rec) return;
        const topicEl = document.getElementById('material-topic');
        rec.topic = normalizeTopicTags(topicEl ? topicEl.value : '');
        rec.materialType = materialType;
        (MATERIAL_TYPE_FIELDS[materialType] || []).forEach(f => {
          const fld = panel.querySelector('[data-mfield="' + f.key + '"]');
          const v = fld ? fld.value.trim() : '';
          if (v) rec[f.key] = v; else delete rec[f.key];
        });
        const usageEl = document.getElementById('material-usage');
        if (usageEl && usageEl.value.trim()) rec.usage = usageEl.value.trim(); else delete rec.usage;
        const tplEl = document.getElementById('material-template');
        if (tplEl && tplEl.value.trim()) rec.template = tplEl.value.trim(); else delete rec.template;
        try { localStorage.setItem(key, JSON.stringify(arr)); } catch(e) {}
      });
    });
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
      paraIdx: _materialParaIdx || (document.getElementById('material-panel').dataset.paraIdx || ''),
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
    if (typeof renderDerivedMarks === 'function') renderDerivedMarks();   // F01 同上
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
    // Auto-save on blur of meaning/examples
    ['root-meaning', 'root-examples'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.dataset.boundRoot) {
        el.dataset.boundRoot = '1';
        el.addEventListener('blur', () => {
          const rootEl = document.getElementById('root-word');
          const root = (rootEl.value || '').trim();
          if (!root) return;
          const key = 'wsj_roots:cards';
          let arr = [];
          try { arr = JSON.parse(localStorage.getItem(key)) || []; } catch(e) {}
          const norm = root.toLowerCase();
          let card = arr.find(c => String(c.root || '').trim().toLowerCase() === norm);
          if (!card) {
            card = { id: genId(), root: root, kind: document.getElementById('root-kind').value, meaning: '', examples: '', source: getShortTitle(), createdAt: new Date().toISOString() };
            arr.push(card);
          }
          card.meaning = document.getElementById('root-meaning').value.trim();
          card.examples = document.getElementById('root-examples').value.trim();
          try { localStorage.setItem(key, JSON.stringify(arr)); } catch(e) {}
        });
      }
    });
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

  // ===== Writing Workshop: unified panel for all writing-related collections =====
  function openWritingWorkshop(tab) {
    let panel = document.getElementById('writing-workshop');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'writing-workshop';
      panel.className = 'syntax-panel writing-workshop';
      panel.innerHTML =
        '<div class="syntax-header"><h3>✍️ 写作工坊</h3><button type="button" data-close="1" title="关闭">✕</button></div>' +
        '<div class="workshop-tabs">' +
        '<button class="workshop-tab active" data-wtab="all">📋 全部</button>' +
        '<button class="workshop-tab" data-wtab="essay">🏛 大作文</button>' +
        '<button class="workshop-tab" data-wtab="small">✉ 小作文</button>' +
        '<button class="workshop-tab" data-wtab="materials">📝 素材</button>' +
        '<button class="workshop-tab" data-wtab="advice">🖊 建议文</button>' +
        '<button class="workshop-tab" data-wtab="syntax">🧩 长难句</button>' +
        '<button class="workshop-tab" data-wtab="roots">🌱 词根</button>' +
        '<button class="workshop-tab" data-wtab="notes">✏️ 笔记</button>' +
        '<button class="workshop-tab" data-wtab="syn">🔁 同义替换</button>' +
        '<button class="workshop-tab" data-wtab="tpl">⬇ 模板导入</button>' +
        '</div>' +
        '<div class="workshop-body" id="workshop-body"></div>' +
        '<div class="syntax-actions"><button type="button" data-close="1">关闭</button></div>';
      document.body.appendChild(panel);
      panel.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => panel.classList.remove('visible')));
      panel.querySelectorAll('.workshop-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          panel.querySelectorAll('.workshop-tab').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          renderWorkshopBody(btn.dataset.wtab);
        });
      });
    }
    if (tab) {
      const btn = panel.querySelector('.workshop-tab[data-wtab="' + tab + '"]');
      if (btn) btn.click();
    } else {
      renderWorkshopBody(panel.querySelector('.workshop-tab.active').dataset.wtab);
    }
    panel.classList.add('visible');
  }
  function getMaterials() {
    try { return JSON.parse(localStorage.getItem('wsj_writing:materials')) || []; } catch(e) { return []; }
  }
  function getSyntaxData() {
    try { return JSON.parse(localStorage.getItem('syntax:' + articleId)) || []; } catch(e) { return []; }
  }
  function getRoots() {
    try { return JSON.parse(localStorage.getItem('wsj_roots:cards')) || []; } catch(e) { return []; }
  }
  // ⚠ 写作工坊的「✏️ 笔记」页签一直在调 getNotes() / saveNotes()，但这两个函数
  //   在整个项目里**从未定义过**（reader.js 里没有，文章页只暴露 annotations）——
  //   所以点「笔记」页签必然抛 ReferenceError，页签是死的。这里补齐：
  //   它存的是与文章无关的自由笔记（带历史版本），与 annotations 的「文章内笔记」分工不同。
  const WS_NOTES_KEY = 'wsj_writing:notes';
  function getNotes() {
    try { return JSON.parse(localStorage.getItem(WS_NOTES_KEY)) || []; } catch (e) { return []; }
  }
  function saveNotes(arr) {
    try { localStorage.setItem(WS_NOTES_KEY, JSON.stringify(arr)); } catch (e) { showTopToast('⚠ 笔记写入失败（存储已满？）'); }
  }
  function bindWsAddBtns() {
    const b1 = document.getElementById('ws-add-material');
    if (b1) b1.addEventListener('click', () => { document.getElementById('writing-workshop').classList.remove('visible'); openMaterialPanel(''); });
    const b2 = document.getElementById('ws-add-advice');
    if (b2) b2.addEventListener('click', () => { document.getElementById('writing-workshop').classList.remove('visible'); openComposePanel(); });
    const b3 = document.getElementById('ws-add-syntax');
    if (b3) b3.addEventListener('click', () => { document.getElementById('writing-workshop').classList.remove('visible'); openSyntaxPanel(''); });
    const b4 = document.getElementById('ws-add-root');
    if (b4) b4.addEventListener('click', () => { document.getElementById('writing-workshop').classList.remove('visible'); openRootPanel(''); });
  }
  // ===== 素材 / 长难句的「来源」标签（F12 双向溯源）=====
  // 每条记录都带 articleId（+ 现在也带 paraIdx），所以能一键回原文那一段。
  // 手动创建的素材 articleId='manual'，按规范**不显示来源**。
  function srcChip(fileId, paraIdx) {
    const a = String(fileId || '');
    if (!a || a === 'manual') return '';
    const cur = (window.__reader && window.__reader.articleId) || '';
    let title = '';
    if (a === cur) title = '本篇';
    else {
      let reg = [];
      try { reg = JSON.parse(localStorage.getItem('wsj_reader:registry') || '[]'); } catch (e) {}
      const r = reg.find(x => x.id === a);
      title = (r && r.title) ? r.title : a.replace(/_EN-CN_final\.html$/, '').replace(/_/g, ' ');
    }
    const label = '📎 ' + String(title).slice(0, 22) + (paraIdx ? ' · 第' + paraIdx + '段' : '');
    return '<button type="button" class="ws-src" data-wsrc="' + esc(a) + '" data-wpara="' + esc(paraIdx || '') +
      '" title="回到原文这一段">' + esc(label) + '</button>';
  }
  function wireWorkshopSrc(body) {
    if (body.dataset.srcWired) return;
    body.dataset.srcWired = '1';
    body.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('[data-wsrc]') : null;
      if (!b) return;
      e.preventDefault();
      if (typeof window.jumpToRef === 'function') window.jumpToRef(b.dataset.wsrc, b.dataset.wpara);
    });
  }

  // ===== F14 跨文章素材主题聚类 =====
  // 素材本来就带 `topic`（`normalizeTopicTags()` 规范化成「逗号分隔」），所以这一项**只加视图**：
  // 不新建索引、不改存储。一条素材可以带多个标签 → 在聚类视图里会出现在多个组
  // （写作时就是按话题找素材，重复出现是预期行为，组标题里也会注明）。
  let matView = 'topic';
  function materialTopics(m) {
    return String(m.topic || '').split(',').map(t => t.trim()).filter(Boolean);
  }
  function materialCardHTML(m, i, inGroup) {
    return '<div class="workshop-card">' +
      '<div class="workshop-card-head"><span>📝 ' + esc(m.topic || '未归类') + '</span>' +
      (m.usedCount ? '<span class="ins-tag ok">用过 ' + m.usedCount + ' 次</span>' : '') +
      '<button type="button" data-wdel="materials:' + i + '" class="workshop-del">✕</button></div>' +
      (m.articleId ? '<div class="workshop-src-row">' + srcChip(m.articleId, m.paraIdx) + '</div>' : '') +
      (m.source ? '<div class="workshop-source">「' + esc(m.source) + '」</div>' : '') +
      (m.sourceText ? '<div class="workshop-source">「' + esc(m.sourceText) + '」</div>' : '') +
      (m.cause ? '<div><b>起因：</b>' + esc(m.cause) + '</div>' : '') +
      (m.process ? '<div><b>经过：</b>' + esc(m.process) + '</div>' : '') +
      (m.develop ? '<div><b>发展：</b>' + esc(m.develop) + '</div>' : '') +
      (m.logic ? '<div><b>逻辑：</b>' + esc(m.logic) + '</div>' : '') +
      (m.usage ? '<div><b>用法：</b>' + esc(m.usage) + '</div>' : '') +
      // 主题可以直接在卡片上改（手动建的素材本来就没主题）
      '<div class="workshop-src-row"><label class="ws-mat-topic"><span>主题</span>' +
      '<input type="text" data-mtopic="' + i + '" value="' + esc(m.topic || '') +
      '" placeholder="多个用逗号分隔，如：科技,成本"></label></div>' +
      '</div>';
  }
  function renderMaterialsTab(body) {
    const items = getMaterials();
    const topics = {};
    items.forEach(m => materialTopics(m).forEach(t => { topics[t] = (topics[t] || 0) + 1; }));
    const noTopic = items.filter(m => !materialTopics(m).length).length;
    let html = '<div class="workshop-action-bar">' +
      '<button type="button" class="primary" id="ws-add-material">＋ 新建素材</button>' +
      '<span class="ins-filters" style="margin-left:auto">' +
      '<button type="button" class="ins-chip' + (matView === 'topic' ? ' active' : '') + '" data-mview="topic">按话题聚类</button>' +
      '<button type="button" class="ins-chip' + (matView === 'flat' ? ' active' : '') + '" data-mview="flat">平铺</button>' +
      '</span></div>';
    if (!items.length) {
      html += '<div class="workshop-empty">还没有写作素材。<br>点上方"新建素材"，或选中文章句子后从浮动菜单存素材。</div>';
      body.innerHTML = html; bindWsAddBtns(); return;
    }
    if (matView === 'flat') {
      html += '<div class="ins-dim">共 ' + items.length + ' 条。' +
        (Object.keys(topics).length ? '话题：' + Object.keys(topics).map(t => esc(t) + '(' + topics[t] + ')').join('、') : '还没有话题标签') +
        (noTopic ? '　·　未归类 ' + noTopic + ' 条' : '') + '</div>' +
        items.map((m, i) => materialCardHTML(m, i, false)).join('');
    } else {
      const keys = Object.keys(topics).sort((a, b) => topics[b] - topics[a] || a.localeCompare(b));
      html += '<div class="ins-dim">按话题聚成 ' + (keys.length + (noTopic ? 1 : 0)) + ' 组，共 ' + items.length +
        ' 条素材。一条素材可带多个话题 —— 会同时出现在每个相关组里，方便按话题取用。</div>';
      if (!keys.length) html += '<div class="ins-dim">（还没有任何素材带话题 —— 在下面卡片里填「主题」即可聚类）</div>';
      keys.forEach(t => {
        const group = items.map((m, i) => ({ m: m, i: i })).filter(x => materialTopics(x.m).indexOf(t) >= 0);
        html += '<details class="ws-cluster" open><summary>' + esc(t) + '<span class="ws-cluster-n">' + group.length + ' 条</span></summary>' +
          group.map(x => materialCardHTML(x.m, x.i, true)).join('') + '</details>';
      });
      if (noTopic) {
        const group = items.map((m, i) => ({ m: m, i: i })).filter(x => !materialTopics(x.m).length);
        html += '<details class="ws-cluster" open><summary>未归类<span class="ws-cluster-n">' + group.length + ' 条</span></summary>' +
          '<div class="ins-dim">给这些素材填上主题，就会自动归到相应话题下。</div>' +
          group.map(x => materialCardHTML(x.m, x.i, true)).join('') + '</details>';
      }
    }
    body.innerHTML = html;
    bindWsAddBtns();
    body.querySelectorAll('[data-mview]').forEach(b => b.addEventListener('click', () => {
      matView = b.dataset.mview; renderWorkshopBody('materials');
    }));
    body.querySelectorAll('[data-mtopic]').forEach(inp => {
      inp.addEventListener('blur', () => {
        const arr = getMaterials();
        const rec = arr[Number(inp.dataset.mtopic)];
        if (!rec) return;
        const next = normalizeTopicTags(inp.value);
        if (next === (rec.topic || '')) return;   // 没改动就别重渲染（会打断连续编辑）
        rec.topic = next;
        try { localStorage.setItem('wsj_writing:materials', JSON.stringify(arr)); } catch (e) {}
        renderWorkshopBody('materials');
      });
    });
  }

  // ==========================================================================
  // F15 笔记历史：Delta 增量存储
  // --------------------------------------------------------------------------
  // 原来每次自动保存都把**全文快照**推进 versions（最近 10 版）—— 一篇 3000 字的笔记
  // 光历史就占 30KB，而相邻两版往往只差几个字。改成：
  //   · versions[0] 存全文（基线，必须实体化，否则整条 delta 链没有起点）；
  //   · 之后每版存**与上一版的差异**（`[{op:'retain'|'insert'|'delete', length?, text?}]`，
  //     与说明书 §3.8 的格式一致）→ 复原时从基线正向逐条应用；
  //   · 超出上限时截断，并**把保留下来的第一版重新实体化成全文快照**（关键：
  //     直接 slice 掉基线会让剩下所有 delta 都无解）。
  // ⚠ 旧数据里 `{title, content, savedAt}` 的全文快照仍然认（兼容），恢复时自动判格式。
  const NOTE_VER_MAX = 10;
  function noteCommon(prefix, suffix) {
    // 公共前后缀：绝大多数编辑只动中间一小段，先把这段削掉能让后面的 LCS 小一个量级
    let p = 0;
    const max = Math.min(prefix.length, suffix.length);
    while (p < max && prefix[p] === suffix[p]) p++;
    let s = 0;
    while (s < max - p && prefix[prefix.length - 1 - s] === suffix[suffix.length - 1 - s]) s++;
    return { p: p, s: s };
  }
  function noteDelta(oldText, newText) {
    const a = String(oldText == null ? '' : oldText);
    const b = String(newText == null ? '' : newText);
    if (a === b) return [{ op: 'retain', length: a.length }];
    const c = noteCommon(a, b);
    const aMid = a.slice(c.p, a.length - c.s);
    const bMid = b.slice(c.p, b.length - c.s);
    const ops = [];
    if (c.p) ops.push({ op: 'retain', length: c.p });
    // 中间段：字符级 LCS。规模上限兜底 —— 超了就直接整体替换（delta 不再小而准，但不会卡住）
    let midOps;
    if (!aMid.length || !bMid.length || aMid.length * bMid.length > 4000000) {
      midOps = [];
      if (aMid.length) midOps.push({ op: 'delete', length: aMid.length });
      if (bMid.length) midOps.push({ op: 'insert', text: bMid });
    } else {
      const n = aMid.length, m = bMid.length;
      const dp = [];
      for (let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1));
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
          dp[i][j] = aMid[i] === bMid[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
      midOps = [];
      let i = 0, j = 0, run = null;
      const flush = () => { if (run) { midOps.push(run); run = null; } };
      while (i < n || j < m) {
        if (i < n && j < m && aMid[i] === bMid[j]) {
          if (!run || run.op !== 'retain') { flush(); run = { op: 'retain', length: 0 }; }
          run.length++; i++; j++;
        } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
          if (!run || run.op !== 'insert') { flush(); run = { op: 'insert', text: '' }; }
          run.text += bMid[j]; j++;
        } else {
          if (!run || run.op !== 'delete') { flush(); run = { op: 'delete', length: 0 }; }
          run.length++; i++;
        }
      }
      flush();
    }
    ops.push.apply(ops, midOps);
    if (c.s) ops.push({ op: 'retain', length: c.s });
    // 合并相邻同类 op，去掉 0 长度项
    const out = [];
    ops.forEach(o => {
      if (o.op === 'retain' || o.op === 'delete') { if (!o.length) return; } else if (!o.text) return;
      const last = out[out.length - 1];
      if (last && last.op === o.op) {
        if (o.op === 'insert') last.text += o.text;
        else last.length += o.length;
      } else out.push(o.op === 'insert' ? { op: 'insert', text: o.text } : { op: o.op, length: o.length });
    });
    return out;
  }
  function noteApplyDelta(text, delta) {
    let out = '', pos = 0;
    const src = String(text == null ? '' : text);
    (delta || []).forEach(o => {
      if (!o) return;
      if (o.op === 'retain') { out += src.substr(pos, o.length); pos += o.length; }
      else if (o.op === 'insert') { out += String(o.text || ''); }
      else if (o.op === 'delete') { pos += o.length; }
    });
    // delta 不覆盖的尾部（旧数据/异常 delta）原样保留，宁可多留也不截断用户内容
    if (pos < src.length) out += src.slice(pos);
    return out;
  }
  // 第 idx 版的内容：全文快照直接用；delta 从基线正向应用（比说明书写的「反向应用」简单且可验证）
  function noteVersionContent(n, idx) {
    const vs = (n && n.versions) || [];
    if (idx < 0 || idx >= vs.length) return '';
    let cur = '';
    for (let i = 0; i <= idx; i++) {
      const v = vs[i];
      if (v && typeof v.content === 'string') cur = v.content;        // 旧格式：全文快照
      else if (v && typeof v.full === 'string') cur = v.full;         // 新格式基线
      else if (v && v.delta) cur = noteApplyDelta(cur, v.delta);      // 新格式增量
    }
    return cur;
  }
  // 把「当前内容」压成一个历史版本；超上限时截断并重建基线
  function notePushVersion(n) {
    n.versions = n.versions || [];
    const snap = { title: n.title, savedAt: n.updatedAt || new Date().toISOString() };
    if (!n.versions.length) {
      snap.full = n.content;
      n.versions.push(snap);
    } else {
      snap.delta = noteDelta(noteVersionContent(n, n.versions.length - 1), n.content);
      n.versions.push(snap);
    }
    if (n.versions.length > NOTE_VER_MAX) {
      const cut = n.versions.length - NOTE_VER_MAX;
      const base = noteVersionContent(n, cut);   // ⚠ 必须在截断**之前**算
      const kept = n.versions.slice(cut);
      kept[0] = { title: kept[0].title, savedAt: kept[0].savedAt, full: base };
      n.versions = kept;
    }
    return n.versions;
  }
  // 存储占用对比：delta 模式 vs 假设每版都存全文
  function noteStorageCompare(n) {
    const vs = (n && n.versions) || [];
    const delta = JSON.stringify(vs).length;
    let full = 0;
    for (let i = 0; i < vs.length; i++) {
      full += JSON.stringify({ title: (vs[i] && vs[i].title) || '', content: noteVersionContent(n, i) }).length;
    }
    return { delta: delta, full: full, saved: full ? Math.max(0, Math.round((1 - delta / full) * 100)) : 0 };
  }
  function noteDiffHTML(oldText, newText) {
    const d = (typeof window.diffWords === 'function') ? window.diffWords(oldText, newText) : null;
    if (!d) return '<div class="ins-dim">无法对比（diff 模块未加载）</div>';
    const line = (tokens, cls) => tokens.map(t =>
      '<span class="' + (t.status === 'correct' ? '' : cls + ' ' + cls + '-' + t.status) + '">' + esc(t.word) + '</span>').join(' ');
    return '<div class="nt-diff">' +
      '<div class="nt-diff-row"><span class="dt-label">旧版</span><div class="dt-tokens">' + line(d.tokens, 'nt-del') + '</div></div>' +
      '<div class="nt-diff-row"><span class="dt-label">当前</span><div class="dt-tokens">' + line(d.userTokens, 'nt-ins') + '</div></div>' +
      '</div>';
  }

  function noteHistoryCtx(noteId) {
    return {
      noteId: noteId,
      restore: function (idx) {
        const notes = getNotes();
        const n = notes.filter(x => x.id === noteId)[0];
        if (!n) return;
        const content = noteVersionContent(n, idx);
        const title = (n.versions[idx] && n.versions[idx].title) || n.title;
        if (!confirm('恢复这一版？当前内容会先存进历史，不会丢。')) return;
        notePushVersion(n);                       // 先保当前内容，再覆盖
        n.content = content;
        n.title = title;
        n.updatedAt = new Date().toISOString();
        saveNotes(notes);
        showTopToast('已恢复历史版本');
        renderWorkshopBody('notes');
      }
    };
  }
  function renderNoteHistory(ctx) {
    const panel = document.getElementById('note-history-panel');
    if (!panel) return;
    const notes = getNotes();
    const n = notes.filter(x => x.id === ctx.noteId)[0];
    if (!n) { panel.innerHTML = '<div class="ins-dim">找不到这条笔记。</div>'; return; }
    const vs = n.versions || [];
    const store = noteStorageCompare(n);
    let html = '<div class="nt-hist-head">历史版本 ' + vs.length + ' 个（自动保留最近 ' + NOTE_VER_MAX + ' 次）</div>' +
      '<div class="ins-dim">增量存储占用 ' + store.delta + ' 字节' +
      (store.saved > 0 ? '，比逐版存全文省 ' + store.saved + '%' : '') +
      '　·　首次保存存全文，之后只存与上一版的差异。</div>';
    if (!vs.length) {
      panel.innerHTML = html + '<div class="ins-dim">还没有历史版本 —— 改动一次内容后就会出现。</div>';
      return;
    }
    html += vs.slice().reverse().map((v, ri) => {
      const idx = vs.length - 1 - ri;
      const when = v.savedAt ? new Date(v.savedAt).toLocaleString() : '';
      const kind = (typeof v.content === 'string') ? '全文（旧格式）' : (v.full !== undefined ? '全文（基线）' : '增量');
      return '<div class="nt-hist-row" data-hrow="' + idx + '">' +
        '<div class="nt-hist-meta"><b>' + esc(v.title || '未命名') + '</b>' +
        '<span class="ins-tag">' + kind + '</span>' +
        '<span class="ins-tag type">' + JSON.stringify(v).length + ' 字节</span></div>' +
        '<div class="ins-dim">' + esc(when) + '</div>' +
        '<div class="nt-hist-act">' +
        '<button type="button" class="ins-btn ghost" data-hdiff="' + idx + '">对比当前</button>' +
        '<button type="button" class="ins-btn ghost" data-hrestore="' + idx + '">恢复这一版</button>' +
        '</div></div>';
    }).join('');
    panel.innerHTML = html;
    panel.querySelectorAll('[data-hdiff]').forEach(b => b.addEventListener('click', () => {
      const row = b.closest('.nt-hist-row');
      if (!row) return;
      const old = row.querySelector('.nt-diff');
      if (old) { old.remove(); return; }
      const idx = Number(b.dataset.hdiff);
      const box = document.createElement('div');
      box.innerHTML = noteDiffHTML(noteVersionContent(n, idx), n.content);
      if (box.firstChild) row.appendChild(box.firstChild);
    }));
    panel.querySelectorAll('[data-hrestore]').forEach(b => b.addEventListener('click', () => {
      ctx.restore(Number(b.dataset.hrestore));
    }));
  }

  // ==========================================================================
  // F08 同义词替换表
  // --------------------------------------------------------------------------
  // 写作时最痛的不是「不知道换什么」，而是「想不起来当初记过什么」。所以这张表的作用是
  // **把阅读时遇到的替换关系存下来，写作文时一键用掉**：
  //   · 入口 1：阅读时选中单词 → 浮动菜单「🔁 同义替换」→ 打开本页签并预填这个词；
  //   · 入口 2：写作工坊 →「🔁 同义替换」页签，手动增删改 + JSON 导入导出；
  //   · 应用：先在大作文/小作文里选中要替换的词，再点候选；没选区时按词面查找后替换。
  // 存储 `wsj_writing:synonyms`（已入备份白名单）；不新起 `writing:` 命名空间。
  const SYN_KEY = 'wsj_writing:synonyms';
  let synQuery = '';
  let _lastSlotEl = null;   // 最后一次聚焦的作文输入框
  // ⚠ 光记 DOM 元素不够：切到「同义替换」页签会把大作文的输入框整个重建，
  //   元素已脱离文档（document.contains 为 false），替换就落空了。
  //   所以同时记「哪个草稿的哪个槽位 + 最后一次选区」，页签切走也能改到数据里。
  let _lastSlot = null;     // { draftId, slot, sel: [start, end] }

  function getSynonyms() {
    try { return JSON.parse(localStorage.getItem(SYN_KEY)) || []; } catch (e) { return []; }
  }
  function saveSynonyms(arr) {
    try { localStorage.setItem(SYN_KEY, JSON.stringify(arr)); } catch (e) { showTopToast('⚠ 同义表写入失败（存储已满？）'); }
  }
  function synAltsOf(rec) {
    const v = rec && (rec.replacements || rec.synonyms || rec.alts || rec.alternatives);
    return Array.isArray(v) ? v.filter(Boolean).map(x => String(x).trim()).filter(Boolean) : [];
  }
  // 导入容错：数组 / {synonyms:[...]} / 字符串（逗号分隔）都收
  function normalizeSynonyms(raw) {
    let obj = raw;
    if (typeof raw === 'string') {
      const str = raw.trim();
      // 以 [ / { 开头的才当 JSON 解析；其余直接交给下面的「纯文本」分支。
      // （原来无条件 JSON.parse，于是「increase: rise, grow」这种纯文本会被判成「解析失败」）
      if (str[0] === '[' || str[0] === '{') {
        try { obj = JSON.parse(str); } catch (e) { return { error: 'JSON 解析失败：' + e.message }; }
      } else {
        obj = str;
      }
    }
    if (obj && !Array.isArray(obj) && typeof obj === 'object') {
      if (Array.isArray(obj.synonyms)) obj = obj.synonyms;
      else if (Array.isArray(obj.pairs)) obj = obj.pairs;
      else if (Array.isArray(obj.list)) obj = obj.list;
    }
    if (typeof obj === 'string') {
      // 「word: a, b, c」一行一条的纯文本也认
      obj = obj.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const m = l.split(/[:：]/);
        return { word: (m[0] || '').trim(), replacements: (m.slice(1).join(':') || '').split(/[,，、]/).map(s => s.trim()).filter(Boolean) };
      });
    }
    if (!Array.isArray(obj)) return { error: '顶层必须是数组，或 { synonyms: [...] }' };
    const out = [], bad = [];
    obj.forEach((x, i) => {
      if (typeof x === 'string') { out.push({ word: x.trim(), replacements: [] }); return; }
      if (!x || typeof x !== 'object') { bad.push(i); return; }
      const word = String(x.word || x.term || x.from || '').trim();
      if (!word) { bad.push(i); return; }
      out.push({
        id: x.id || genId(), word: word, replacements: synAltsOf(x),
        note: String(x.note || x.tip || '').trim(),
        articleId: x.articleId || articleId, createdAt: x.createdAt || new Date().toISOString()
      });
    });
    if (!out.length) return { error: '没有解析出任何词条' + (bad.length ? '（' + bad.length + ' 条缺少 word 字段）' : '') };
    return { list: out, bad: bad.length };
  }
  function synReplaceText(cur, word, alt, sel) {
    const v = String(cur == null ? '' : cur);
    if (sel && sel[1] > sel[0] && sel[1] <= v.length) return v.slice(0, sel[0]) + alt + v.slice(sel[1]);
    const i = v.toLowerCase().indexOf(String(word).toLowerCase());
    if (i >= 0) return v.slice(0, i) + alt + v.slice(i + String(word).length);
    return v.replace(/\s*$/, '') + (v ? ' ' : '') + alt;
  }
  function synApply(word, alt) {
    const ta = (_lastSlotEl && document.contains(_lastSlotEl)) ? _lastSlotEl : null;
    if (!ta) {
      // 页签切走后输入框已经销毁 —— 直接改草稿数据，回作文页签就能看到
      if (_lastSlot && _lastSlot.draftId) {
        const all = essayDrafts();
        const d = all.filter(x => x.id === _lastSlot.draftId)[0];
        if (d && d.slots && d.slots[_lastSlot.slot] !== undefined) {
          d.slots[_lastSlot.slot] = synReplaceText(d.slots[_lastSlot.slot], word, alt, _lastSlot.sel);
          d.updatedAt = new Date().toISOString();
          saveEssayDrafts(all);
          showTopToast('已替换为「' + alt + '」（回到大作文页签即可看到）');
          return true;
        }
      }
      try { navigator.clipboard.writeText(alt); } catch (e) {}
      showTopToast('已复制「' + alt + '」—— 到大作文/小作文里替换即可');
      return false;
    }
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = synReplaceText(ta.value, word, alt, (typeof s === 'number' && e > s) ? [s, e] : null);
    if (typeof s === 'number' && e > s) ta.setSelectionRange(s + alt.length, s + alt.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    try { ta.focus(); } catch (e) {}
    showTopToast('已替换为「' + alt + '」');
    return true;
  }
  function renderSynonymTab(body) {
    const all = getSynonyms();
    const q = synQuery.trim().toLowerCase();
    const list = q ? all.filter(r => String(r.word).toLowerCase().indexOf(q) >= 0 ||
      synAltsOf(r).some(a => a.toLowerCase().indexOf(q) >= 0)) : all;
    let html = '<div class="workshop-action-bar">' +
      '<button type="button" class="primary" id="syn-add">＋ 新增词条</button>' +
      '<input type="search" id="syn-q" class="ws-syn-search" placeholder="搜主词或替换词…" value="' + esc(synQuery) + '">' +
      '<span style="color:var(--text-muted);font-size:12px;">' + all.length + ' 组</span></div>' +
      '<div class="ins-dim">先在大作文 / 小作文里选中要替换的词，再点这里的候选即可替换；没有选中时按词面查找替换。' +
      '阅读时选中单词 → 浮动菜单「🔁 同义替换」也能把它记进来。</div>';
    if (!all.length) {
      html += '<div class="workshop-empty">还没有同义替换记录。<br>点「＋ 新增词条」，或用下面的导入框批量导入。</div>';
    } else if (!list.length) {
      html += '<div class="workshop-empty">没有匹配「' + esc(synQuery) + '」的词条。</div>';
    } else {
      html += list.map(r => {
        const alts = synAltsOf(r);
        const i = all.indexOf(r);
        return '<div class="workshop-card ws-syn-card" data-synrow="' + esc(r.id) + '">' +
          '<div class="workshop-card-head">' +
          '<input type="text" class="ws-syn-word" data-synword="' + i + '" value="' + esc(r.word) + '" placeholder="主词">' +
          '<button type="button" class="workshop-del" data-syndelete="' + i + '" title="删除">✕</button></div>' +
          (alts.length
            ? '<div class="ws-syn-alts">' + alts.map(a =>
              '<button type="button" class="ws-syn-alt" data-synuse="' + i + '" data-synalt="' + esc(a) + '" title="点击替换">' + esc(a) + '</button>').join('') + '</div>'
            : '<div class="ins-dim">还没有替换词 —— 在下面输入，逗号分隔</div>') +
          '<input type="text" class="ws-syn-input" data-synalts="' + i + '" value="' + esc(alts.join(', ')) + '" placeholder="替换词，逗号分隔，如：crucial, vital, significant">' +
          '<input type="text" class="ws-syn-input" data-synnote="' + i + '" value="' + esc(r.note || '') + '" placeholder="备注（可选）：区别、语域、搭配">' +
          '</div>';
      }).join('');
    }
    html += '<details class="ws-samples"><summary>批量导入 / 导出（JSON）</summary>' +
      '<textarea id="syn-json" rows="5" placeholder=\'支持三种写法：[{"word":"important","replacements":["crucial","vital"]}]　或　{"synonyms":[...]}　或　纯文本每行「important: crucial, vital」\'></textarea>' +
      '<div class="ws-import-actions">' +
      '<button type="button" class="primary" id="syn-import">解析并导入</button>' +
      '<button type="button" class="ins-btn ghost" id="syn-export">导出当前</button>' +
      '</div><div id="syn-msg" class="ws-import-msg"></div></details>';
    body.innerHTML = html;
    const show = (kind, text) => {
      const m = body.querySelector('#syn-msg');
      if (!m) return;
      m.className = 'ws-import-msg ' + kind;
      m.innerHTML = text;
    };
    const flush = () => {
      const arr = getSynonyms();
      body.querySelectorAll('[data-synword]').forEach(inp => {
        const r = arr[Number(inp.dataset.synword)];
        if (r) r.word = inp.value.trim();
      });
      body.querySelectorAll('[data-synalts]').forEach(inp => {
        const r = arr[Number(inp.dataset.synalts)];
        if (r) r.replacements = inp.value.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
      });
      body.querySelectorAll('[data-synnote]').forEach(inp => {
        const r = arr[Number(inp.dataset.synnote)];
        if (r) r.note = inp.value.trim();
      });
      saveSynonyms(arr.filter(r => r.word || synAltsOf(r).length));
    };
    body.querySelector('#syn-add').addEventListener('click', () => {
      flush();
      const arr = getSynonyms();
      arr.push({ id: genId(), word: '', replacements: [], note: '', articleId: articleId, createdAt: new Date().toISOString() });
      saveSynonyms(arr);
      renderSynonymTab(body);
      const last = body.querySelector('.ws-syn-word[data-synword="' + (arr.length - 1) + '"]');
      if (last) last.focus();
    });
    const qEl = body.querySelector('#syn-q');
    if (qEl) {
      qEl.addEventListener('input', () => { synQuery = qEl.value; renderSynonymTab(body); });
      qEl.addEventListener('focus', () => { synQuery = qEl.value; });
    }
    body.querySelectorAll('[data-synword],[data-synalts],[data-synnote]').forEach(inp => {
      // ⚠ 三类输入都要重渲染：只对「主词」重渲染的话，刚填的替换词永远不会变成可点候选
      inp.addEventListener('blur', () => { flush(); renderSynonymTab(body); });
    });
    body.querySelectorAll('[data-synuse]').forEach(b => b.addEventListener('click', () => {
      const arr = getSynonyms();
      const r = arr[Number(b.dataset.synuse)];
      if (r) synApply(r.word, b.dataset.synalt);
    }));
    body.querySelectorAll('[data-syndelete]').forEach(b => b.addEventListener('click', () => {
      const arr = getSynonyms();
      arr.splice(Number(b.dataset.syndelete), 1);
      saveSynonyms(arr);
      renderSynonymTab(body);
    }));
    body.querySelector('#syn-import').addEventListener('click', () => {
      const raw = (body.querySelector('#syn-json').value || '').trim();
      if (!raw) { show('bad', '先把内容粘进来。'); return; }
      const r = normalizeSynonyms(raw);
      if (r.error) { show('bad', '✗ ' + esc(r.error)); return; }
      const arr = getSynonyms();
      let add = 0, upd = 0;
      r.list.forEach(x => {
        const hit = arr.filter(y => String(y.word).toLowerCase() === String(x.word).toLowerCase())[0];
        if (hit) {
          const merged = synAltsOf(hit).concat(x.replacements).filter((v, i, a) => a.indexOf(v) === i);
          hit.replacements = merged;
          if (x.note) hit.note = x.note;
          upd++;
        } else { arr.push(x); add++; }
      });
      saveSynonyms(arr);
      renderSynonymTab(body);
      show('ok', '✓ 新增 ' + add + ' 组、合并 ' + upd + ' 组' + (r.bad ? '（' + r.bad + ' 条被跳过）' : ''));
    });
    body.querySelector('#syn-export').addEventListener('click', () => {
      // 去向由 downloadText → saveFile 的 toast 说明，这里不重复报一遍
      downloadText(JSON.stringify(getSynonyms().map(r => ({
        word: r.word, replacements: synAltsOf(r), note: r.note || ''
      })), null, 2), 'synonyms.json');
    });
  }
  // 浮动菜单「🔁 同义替换」的入口：打开页签并预填这个词
  function openSynonymPanel(word) {
    const w = String(word || '').trim();
    openWritingWorkshop('syn');
    if (!w) return;
    const arr = getSynonyms();
    const hit = arr.filter(r => String(r.word).toLowerCase() === w.toLowerCase())[0];
    if (!hit) {
      arr.push({ id: genId(), word: w, replacements: [], note: '', articleId: articleId, createdAt: new Date().toISOString() });
      saveSynonyms(arr);
    }
    synQuery = hit ? synQuery : '';
    const body = document.getElementById('workshop-body');
    if (body) renderSynonymTab(body);
    showTopToast(hit ? '「' + w + '」已在同义表里' : '已加入同义表：' + w);
  }

  function renderWorkshopBody(tab) {
    const body = document.getElementById('workshop-body');
    if (!body) return;
    wireWorkshopSrc(body);
    // 这四个页签自带渲染与事件，提前返回（不落到文末的 [data-wdel] 通用绑定）
    if (tab === 'all') { renderWorkshopOverview(body); return; }
    if (tab === 'essay') { renderBigEssayTab(body); return; }
    if (tab === 'small') { renderSmallEssayTab(body); return; }
    if (tab === 'tpl') { renderTemplateTab(body); return; }
    if (tab === 'syn') { renderSynonymTab(body); return; }
    if (tab === 'materials') {
      renderMaterialsTab(body);
    } else if (tab === 'advice') {
      const items = getCompositions().filter(x => x.articleId === articleId);
      let html = '<div class="workshop-action-bar"><button type="button" class="primary" id="ws-add-advice">＋ 新建建议文</button><span style="color:var(--text-muted);font-size:12px;">' + items.length + ' 条</span></div>';
      if (!items.length) { html += '<div class="workshop-empty">还没有建议文条目。<br>点上方"新建建议文"添加。</div>'; body.innerHTML = html; bindWsAddBtns(); return; }
      html += items.map((m) =>
        '<div class="workshop-card">' +
        '<div class="workshop-card-head"><span>🖊 ' + esc(m.theme || '条目') + '</span><button type="button" data-wdel="advice:' + m.id + '" class="workshop-del">✕</button></div>' +
        (m.point ? '<div><b>论点：</b>' + esc(m.point) + '</div>' : '') +
        (m.advice ? '<div><b>建议：</b>' + esc(m.advice) + '</div>' : '') +
        (m.argue ? '<div><b>论述：</b>' + esc(m.argue) + '</div>' : '') +
        '</div>'
      ).join('');
      body.innerHTML = html; bindWsAddBtns();
    } else if (tab === 'syntax') {
      const items = getSyntaxData();
      let html = '<div class="workshop-action-bar"><button type="button" class="primary" id="ws-add-syntax">＋ 新建长难句</button><span style="color:var(--text-muted);font-size:12px;">' + items.length + ' 条</span></div>';
      if (!items.length) { html += '<div class="workshop-empty">还没有长难句记录。<br>点上方"新建长难句"，或选中句子后从浮动菜单存长难句。</div>'; body.innerHTML = html; bindWsAddBtns(); return; }
      html += items.map((m, i) => {
        const plain = String((m.html ? m.html.replace(/<[^>]+>/g, '') : m.text) || '').trim();
        return '<div class="workshop-card">' +
        '<div class="workshop-card-head"><span>🧩 句 ' + (i+1) + '</span><button type="button" data-wdel="syntax:' + i + '" class="workshop-del">✕</button></div>' +
        '<div class="workshop-src-row">' + srcChip(m.articleId || (window.__reader && window.__reader.articleId), m.paraIdx) + '</div>' +
        '<div class="workshop-source">' + (m.html ? m.html.replace(/<[^>]+>/g, '') : esc(m.text)) + '</div>' +
        (m.note ? '<div><b>笔记：</b>' + esc(m.note) + '</div>' : '') +
        // 长难句正好是默写的好素材（F11）：把这句话带去默写面板
        '<div class="ws-slot-tools"><button type="button" class="ins-btn ghost" data-dict="' + esc(plain.slice(0, 200)) +
        '">🖊 中译英默写这句</button></div>' +
        '</div>';
      }).join('');
      body.innerHTML = html; bindWsAddBtns();
      body.querySelectorAll('[data-dict]').forEach(b => b.addEventListener('click', () => {
        const panel = document.getElementById('writing-workshop');
        if (panel) panel.classList.remove('visible');
        if (typeof window.openDictation === 'function') window.openDictation(b.dataset.dict);
        else showTopToast('本篇没有可默写的句子');
      }));
    } else if (tab === 'roots') {
      const items = getRoots();
      let html = '<div class="workshop-action-bar"><button type="button" class="primary" id="ws-add-root">＋ 新建词根</button><span style="color:var(--text-muted);font-size:12px;">' + items.length + ' 条</span></div>';
      if (!items.length) { html += '<div class="workshop-empty">还没有词根记录。<br>点上方"新建词根"，或选中单词后从浮动菜单存词根。</div>'; body.innerHTML = html; bindWsAddBtns(); return; }
      html += items.map((m, i) =>
        '<div class="workshop-card">' +
        '<div class="workshop-card-head"><span>🌱 ' + esc(m.root || m.word || '') + '</span><button type="button" data-wdel="roots:' + i + '" class="workshop-del">✕</button></div>' +
        '<div><b>类型：</b>' + esc(m.kind || '') + '</div>' +
        (m.meaning ? '<div><b>含义：</b>' + esc(m.meaning) + '</div>' : '') +
        (m.examples ? '<div><b>例词：</b>' + esc(m.examples) + '</div>' : '') +
        '</div>'
      ).join('');
      body.innerHTML = html; bindWsAddBtns();
    } else if (tab === 'notes') {
      const notes = getNotes();
      const activeId = body.dataset.activeNote || (notes.length ? notes[notes.length-1].id : '');
      const active = notes.find(n => n.id === activeId);
      let html = '<div class="notes-layout">';
      // Left: note list
      html += '<div class="notes-list-pane">';
      html += '<button type="button" id="note-add-btn" class="primary" style="width:100%;padding:6px;margin-bottom:8px;">＋ 新建笔记</button>';
      if (!notes.length) {
        html += '<div class="workshop-empty">还没有笔记。</div>';
      } else {
        html += notes.slice().reverse().map(n =>
          '<div class="note-list-item' + (n.id === activeId ? ' active' : '') + '" data-note-id="' + n.id + '">' +
          '<div class="note-list-title">' + esc(n.title || '未命名') + '</div>' +
          '<div class="note-list-meta">' + (n.updatedAt ? new Date(n.updatedAt).toLocaleDateString() : '') + '</div>' +
          '</div>'
        ).join('');
      }
      html += '</div>';
      // Right: editor
      html += '<div class="notes-editor-pane">';
      if (active) {
        const verCount = (active.versions || []).length;
        const store = noteStorageCompare(active);
        html += '<div class="note-editor-head">' +
          '<input type="text" id="note-title-input" value="' + esc(active.title || '') + '" placeholder="笔记标题" style="width:100%;font-size:16px;font-weight:600;border:1px solid var(--border);border-radius:6px;padding:6px 8px;background:var(--panel-bg);color:var(--text);">' +
          '<div style="display:flex;gap:8px;align-items:center;margin-top:4px;font-size:12px;color:var(--text-muted);flex-wrap:wrap;">' +
          '<span id="note-save-status">已自动保存</span>' +
          (verCount > 0 ? '<button type="button" id="note-history-btn" style="font-size:12px;background:none;border:1px solid var(--border);border-radius:4px;padding:2px 8px;cursor:pointer;">🕘 历史 (' + verCount + ')</button>' : '') +
          (verCount > 1 ? '<span id="note-store-info" title="历史版本改用增量存储（只存与上一版的差异）">历史占用 ' + store.delta + ' 字节' +
            (store.saved > 0 ? '（比存全文省 ' + store.saved + '%）' : '') + '</span>' : '') +
          '</div>' +
          '</div>';
        html += '<textarea id="note-content-input" placeholder="开始写…自动保存" style="width:100%;height:300px;margin-top:8px;border:1px solid var(--border);border-radius:6px;padding:8px;background:var(--panel-bg);color:var(--text);font-size:14px;line-height:1.7;resize:vertical;">' + esc(active.content || '') + '</textarea>';
        html += '<div id="note-history-panel" style="display:none;margin-top:8px;border:1px solid var(--border);border-radius:6px;padding:8px;max-height:200px;overflow-y:auto;"></div>';
      } else {
        html += '<div class="workshop-empty">选左侧笔记开始编辑，或新建一条。</div>';
      }
      html += '</div></div>';
      body.innerHTML = html;
      body.dataset.activeNote = activeId;
      // New note button
      document.getElementById('note-add-btn').addEventListener('click', () => {
        const notes = getNotes();
        const n = { id: genId(), title: '', content: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), versions: [] };
        notes.push(n);
        saveNotes(notes);
        body.dataset.activeNote = n.id;
        renderWorkshopBody('notes');
      });
      // Note list click
      body.querySelectorAll('.note-list-item').forEach(el => {
        el.addEventListener('click', () => { body.dataset.activeNote = el.dataset.noteId; renderWorkshopBody('notes'); });
      });
      // Auto-save with debounce
      const titleInput = document.getElementById('note-title-input');
      const contentInput = document.getElementById('note-content-input');
      let saveTimer = null;
      function autoSave() {
        const status = document.getElementById('note-save-status');
        if (status) status.textContent = '保存中…';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          const notes = getNotes();
          const n = notes.find(x => x.id === activeId);
          if (!n) return;
          // 把「修改前的内容」压成历史版本（F15：首次存全文，之后只存与上一版的增量）
          if (n.content !== contentInput.value || n.title !== titleInput.value) {
            notePushVersion(n);
          }
          n.title = titleInput.value.trim();
          n.content = contentInput.value;
          n.updatedAt = new Date().toISOString();
          saveNotes(notes);
          if (status) status.textContent = '✓ 已自动保存 ' + new Date().toLocaleTimeString();
        }, 800);
      }
      if (titleInput) titleInput.addEventListener('input', autoSave);
      if (contentInput) contentInput.addEventListener('input', autoSave);
      // History button
      const histBtn = document.getElementById('note-history-btn');
      if (histBtn) histBtn.addEventListener('click', () => {
        const panel = document.getElementById('note-history-panel');
        if (panel.style.display === 'none') {
          renderNoteHistory(noteHistoryCtx(activeId));
          panel.style.display = 'block';
        } else {
          panel.style.display = 'none';
        }
      });
    }
    body.querySelectorAll('[data-wdel]').forEach(btn => {
      btn.addEventListener('click', () => {
        const parts = btn.dataset.wdel.split(':');
        const type = parts[0], idx = parts[1];
        if (type === 'materials') {
          const arr = getMaterials(); arr.splice(Number(idx), 1);
          localStorage.setItem('wsj_writing:materials', JSON.stringify(arr));
        } else if (type === 'advice') {
          const arr = getCompositions().filter(x => x.id !== idx);
          saveCompositions(arr);
        } else if (type === 'syntax') {
          const arr = getSyntaxData(); arr.splice(Number(idx), 1);
          localStorage.setItem('syntax:' + articleId, JSON.stringify(arr));
        } else if (type === 'roots') {
          const arr = getRoots(); arr.splice(Number(idx), 1);
          localStorage.setItem('wsj_roots:cards', JSON.stringify(arr));
        }
        showTopToast('已删除');
        renderWorkshopBody(tab);
      });
    });
  }
  // ==========================================================================
  // F05 大作文框架 / F06 小作文模板库 / F17 作文自评清单
  // --------------------------------------------------------------------------
  // 设计要点（三条，都要守住）：
  //   1) **内容靠导入，代码只提供骨架**：三段式的槽位、10 类应用文的格式与结构是内置的，
  //      套话库 / 开头句式 / 范文 / 自定义框架全部从 JSON 导入 —— 不替用户编内容；
  //   2) 存储沿用 wsj_ 前缀的既有命名习惯：`wsj_writing:templates`（模板库）、
  //      `wsj_writing:essays`（草稿）；不新起 `writing:` 命名空间（会与既有键分裂）；
  //   3) 与素材打通：大作文槽位旁边可以一键把 `wsj_writing:materials` 的素材插进去，
  //      同时累加 usedCount / lastUsedAt（F12 的「用了多少次」就落在这里）。
  // 导入格式与步骤见 references/作文模板导入说明.md。
  // ==========================================================================
  const TPL_KEY = 'wsj_writing:templates';
  const ESSAY_KEY = 'wsj_writing:essays';

  // F17：作文自评清单（说明书写「数据存在 writing:essays 的 selfScore 字段」——
  // 字段名沿用，键名按项目习惯加 wsj_ 前缀）
  const DEFAULT_CHECKLIST = [
    { key: 'content', label: '内容完整', hint: '图画描述无遗漏、三段齐全、字数达标' },
    { key: 'grammar', label: '语法准确', hint: '时态一致、主谓一致、无残缺句' },
    { key: 'vocab', label: '词汇多样', hint: '避免反复用同一个词，多用具体名词与动词' },
    { key: 'syntax', label: '句式多样', hint: '至少一个从句 + 一个非谓语结构' },
    { key: 'cohesion', label: '衔接连贯', hint: '段落间有过渡，指代清楚' }
  ];
  // 内置骨架：只给结构，套话留空等导入（opening/closing 为空时面板会提示去导入）
  const BUILTIN_BIG = [
    {
      id: 'big_three',
      title: '三段式通用框架（图画/图表作文）',
      topic: '',
      note: '骨架：只给槽位与写作任务，开头句式与范文请从「模板导入」页签导入。',
      slots: [
        { key: 'p1', label: '第一段·图画描述', role: '描述', words: '60-80',
          tip: '一句总体描述 + 两句细节。用现在时，注意图中的人/物/动作/文字。', starters: [] },
        { key: 'p2', label: '第二段·寓意揭示与论证', role: '论证', words: '120-150',
          tip: '先一句点出寓意，再用「原因 / 影响 / 例证」中的一种展开。', starters: [] },
        { key: 'p3', label: '第三段·观点与建议', role: '结论', words: '40-60',
          tip: '表明态度 + 给出 1-2 条可操作建议，不要泛泛而谈。', starters: [] }
      ]
    }
  ];
  const BUILTIN_SMALL = [
    { id: 'small_suggestion', type: 'suggestion', name: '建议信', format: '称呼 + 正文 + 落款', structure: ['写信目的', '具体建议（2-3 条）', '期望回复'], openings: [], closings: [] },
    { id: 'small_complaint', type: 'complaint', name: '投诉信', format: '称呼 + 正文 + 落款', structure: ['说明问题', '造成的影响', '期望的处理方式'], openings: [], closings: [] },
    { id: 'small_invitation', type: 'invitation', name: '邀请信', format: '称呼 + 正文 + 落款', structure: ['邀请事由', '时间地点与安排', '期待回复'], openings: [], closings: [] },
    { id: 'small_thanks', type: 'thanks', name: '感谢信', format: '称呼 + 正文 + 落款', structure: ['致谢事由', '对方的帮助带来的影响', '再次致谢'], openings: [], closings: [] },
    { id: 'small_apology', type: 'apology', name: '道歉信', format: '称呼 + 正文 + 落款', structure: ['致歉事由', '解释原因', '补救措施'], openings: [], closings: [] },
    { id: 'small_recommend', type: 'recommend', name: '推荐信', format: '称呼 + 正文 + 落款', structure: ['推荐对象', '推荐理由（2-3 条）', '期望采纳'], openings: [], closings: [] },
    { id: 'small_application', type: 'application', name: '求职信', format: '称呼 + 正文 + 落款', structure: ['应聘职位来源', '资格与经历', '期待面试'], openings: [], closings: [] },
    { id: 'small_notice', type: 'notice', name: '通知', format: '标题 + 正文 + 署名与日期', structure: ['事由', '时间地点参与方式', '联系人与要求'], openings: [], closings: [] },
    { id: 'small_announcement', type: 'announcement', name: '告示', format: '标题 + 正文 + 署名与日期', structure: ['公告事项', '具体要求', '联系方式'], openings: [], closings: [] },
    { id: 'small_memo', type: 'memo', name: '备忘录', format: 'To / From / Date / Subject + 正文', structure: ['事由', '要点（分条）', '后续动作'], openings: [], closings: [] }
  ];

  function essayTemplates() {
    const stored = (function () {
      try { return JSON.parse(localStorage.getItem(TPL_KEY)) || null; } catch (e) { return null; }
    })() || {};
    // ⚠ 内置模板也要过一遍 normalize*：否则内置项与导入项的字段集不一致
    //   （内置的 small 没有 samples 字段，渲染时读 .length 直接抛错）。
    const big = Array.isArray(stored.big) && stored.big.length ? stored.big.map(normalizeBig) : BUILTIN_BIG.map(normalizeBig);
    const small = Array.isArray(stored.small) && stored.small.length ? stored.small.map(normalizeSmall) : BUILTIN_SMALL.map(normalizeSmall);
    const checklist = Array.isArray(stored.checklist) && stored.checklist.length ? stored.checklist : DEFAULT_CHECKLIST;
    return { big: big, small: small, checklist: checklist, meta: stored.meta || {}, custom: !!(stored.big || stored.small) };
  }
  function saveEssayTemplates(t) {
    try {
      localStorage.setItem(TPL_KEY, JSON.stringify({
        big: t.big, small: t.small, checklist: t.checklist,
        meta: { importedAt: new Date().toISOString(), name: t.meta && t.meta.name || '自定义模板' }
      }));
    } catch (e) { showTopToast('⚠ 模板太大，浏览器存储写入失败'); }
  }

  // ---------- 导入：把各种常见写法归一化 ----------
  // 宽容度是刻意的：用户从别处拷来的 JSON 命名五花八门（framework/slots/paragraphs、
  // starters/templates/openings），归一化失败才是真正的失败。
  function asArray(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }
  function pickStr(o, keys, fb) {
    for (let i = 0; i < keys.length; i++) {
      const v = o[keys[i]];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return fb || '';
  }
  function normalizeSlot(raw, idx) {
    const s = (raw && typeof raw === 'object') ? raw : { label: String(raw || '') };
    const starters = [];
    ['starters', 'templates', 'openings', 'phrases', 'sentences'].forEach(k => {
      asArray(s[k]).forEach(x => { if (typeof x === 'string' && x.trim()) starters.push(x.trim()); });
    });
    return {
      key: pickStr(s, ['key', 'id'], 'p' + (idx + 1)),
      label: pickStr(s, ['label', 'name', 'title'], '第 ' + (idx + 1) + ' 段'),
      role: pickStr(s, ['role', 'func', 'function'], ''),
      words: pickStr(s, ['words', 'wordCount', 'length'], ''),
      tip: pickStr(s, ['tip', 'hint', 'note'], ''),
      starters: starters
    };
  }
  function normalizeBig(raw, i) {
    const t = (raw && typeof raw === 'object') ? raw : {};
    let slots = asArray(t.slots || t.framework || t.paragraphs || t.parts);
    if (!slots.length && t.paragraphs && typeof t.paragraphs === 'object') {
      slots = Object.keys(t.paragraphs).sort().map(k => Object.assign({ key: k }, t.paragraphs[k]));
    }
    return {
      id: pickStr(t, ['id'], 'big_' + i),
      title: pickStr(t, ['title', 'name'], '大作文框架 ' + (i + 1)),
      topic: pickStr(t, ['topic', 'theme'], ''),
      note: pickStr(t, ['note', 'desc', 'description'], ''),
      slots: slots.length ? slots.map(normalizeSlot) : BUILTIN_BIG[0].slots.slice()
    };
  }
  function normalizeSmall(raw, i) {
    const t = (raw && typeof raw === 'object') ? raw : {};
    // ⚠ 这里原来写的是 `arrs('closings').concat(arrs('closing').length ? 'closing' : 'closings')`，
    //   三元的两个分支都是**字符串**，于是 concat 会把字面量 'closings' 当成一条套话加进去
    //   —— 小作文面板会凭空多出一条叫「closings」的结尾句。改成规规矩矩地按别名收集。
    const arrs = function () {
      let out = [];
      for (let a = 0; a < arguments.length; a++) {
        asArray(t[arguments[a]]).forEach(function (x) {
          if (typeof x === 'string' && x.trim()) out.push(x.trim());
        });
      }
      return out.filter(function (x, k, list) { return list.indexOf(x) === k; });
    };
    return {
      id: pickStr(t, ['id', 'type'], 'small_' + i),
      type: pickStr(t, ['type', 'id'], 'type_' + i),
      name: pickStr(t, ['name', 'title'], '应用文 ' + (i + 1)),
      format: pickStr(t, ['format', 'layout'], ''),
      structure: arrs('structure', 'outline'),
      openings: arrs('openings', 'opening'),
      closings: arrs('closings', 'closing'),
      samples: asArray(t.samples || t.examples).map(s => (typeof s === 'string'
        ? { title: '', text: s } : { title: pickStr(s, ['title', 'name'], ''), text: pickStr(s, ['text', 'body', 'content'], '') }))
        .filter(s => s.text)
    };
  }
  function normalizeTemplates(raw) {
    let obj = raw;
    if (typeof raw === 'string') {
      try { obj = JSON.parse(raw); }
      catch (e) { return { error: 'JSON 解析失败：' + e.message }; }
    }
    if (Array.isArray(obj)) {
      // 纯数组：按特征判大小作文
      const big = [], small = [];
      obj.forEach((x, i) => {
        const isSmall = x && (x.openings || x.closings || x.format || (x.type && !x.slots && !x.paragraphs));
        (isSmall ? small : big).push(x);
        if (isSmall) small[small.length - 1].__i = i; else big[big.length - 1].__i = i;
      });
      obj = { big: big, small: small };
    }
    if (!obj || typeof obj !== 'object') return { error: '顶层必须是对象或数组' };
    const bigSrc = asArray(obj.big || obj.essays || obj.large);
    const smallSrc = asArray(obj.small || obj.applications || obj.letters);
    const warnings = [];
    if (!bigSrc.length && !smallSrc.length) {
      return { error: '没找到 big / small 数组（也接受顶层直接是模板数组）' };
    }
    const big = bigSrc.map(normalizeBig);
    const small = smallSrc.map(normalizeSmall);
    const checklist = asArray(obj.checklist).map((c, i) => ({
      key: pickStr(c, ['key', 'id'], 'c' + i),
      label: pickStr(c, ['label', 'name'], '维度 ' + (i + 1)),
      hint: pickStr(c, ['hint', 'tip', 'note'], '')
    })).filter(c => c.label);
    small.forEach(t => {
      if (!t.openings.length && !t.closings.length) warnings.push('小作文「' + t.name + '」没有开头/结尾套话，只导入到结构');
    });
    big.forEach(t => {
      if (!t.slots.some(s => s.starters.length)) warnings.push('大作文「' + t.title + '」各段没有开头句式，只导入到槽位');
    });
    return { big: big, small: small, checklist: checklist, warnings: warnings, name: pickStr(obj, ['name', 'title'], '') };
  }

  // ---------- 草稿 ----------
  function essayDrafts() {
    try { return JSON.parse(localStorage.getItem(ESSAY_KEY)) || []; } catch (e) { return []; }
  }
  function saveEssayDrafts(arr) {
    try { localStorage.setItem(ESSAY_KEY, JSON.stringify(arr)); } catch (e) { showTopToast('⚠ 草稿写入失败（存储已满？）'); }
  }
  function wordNum(t) { return String(t || '').trim().split(/\s+/).filter(Boolean).length; }

  let _essaySel = { kind: 'big', tplId: '', draftId: '' };
  function openEssayWorkshop(kind) {
    openWritingWorkshop(kind === 'small' ? 'small' : 'essay');
  }

  // ---------- 页签 0：全部（原来这个页签是空的 —— 默认打开却是白板）----------
  function renderWorkshopOverview(body) {
    const mats = getMaterials().length;
    const advice = getCompositions().filter(x => x.articleId === articleId).length;
    const syntax = getSyntaxData().length;
    const roots = getRoots().length;
    const notes = getNotes().length;
    const drafts = essayDrafts().length;
    const tpl = essayTemplates();
    const cell = (tab, icon, name, n, hint) =>
      '<button type="button" class="ws-ov-card" data-wstab="' + tab + '">' +
      '<span class="ws-ov-ico">' + icon + '</span><span class="ws-ov-num">' + n + '</span>' +
      '<span class="ws-ov-name">' + esc(name) + '</span><span class="ws-ov-hint">' + esc(hint) + '</span></button>';
    body.innerHTML =
      '<div class="ins-dim">写作工坊收齐了考研英语一写作会用到的东西：整套框架与素材都在本机，不联网。</div>' +
      '<div class="ws-ov-grid">' +
      cell('essay', '🏛', '大作文', drafts, tpl.big.length + ' 个框架 · 三段式草稿') +
      cell('small', '✉', '小作文', tpl.small.length, '10 类应用文 · 格式与套话') +
      cell('materials', '📝', '素材', mats, '文章里存的起因/经过/逻辑') +
      cell('advice', '🖊', '建议文', advice, '论点 · 建议 · 论述') +
      cell('syntax', '🧩', '长难句', syntax, '本篇句库，可用于默写') +
      cell('roots', '🌱', '词根', roots, '词根词缀卡') +
      cell('notes', '✏️', '笔记', notes, '自由笔记，带历史版本') +
      cell('syn', '🔁', '同义替换', getSynonyms().length, '阅读时存的替换关系，写作一键用') +
      cell('tpl', '⬇', '模板导入', tpl.custom ? '已导入' : '内置', '把作文模板 JSON 导进来') +
      '</div>';
    body.querySelectorAll('[data-wstab]').forEach(b => b.addEventListener('click', () => {
      const panel = document.getElementById('writing-workshop');
      const tab = panel && panel.querySelector('.workshop-tab[data-wtab="' + b.dataset.wstab + '"]');
      if (tab) tab.click();
    }));
  }

  // ---------- 页签 1：大作文 ----------
  function renderBigEssayTab(body) {
    const t = essayTemplates();
    if (!_essaySel.tplId || !t.big.some(x => x.id === _essaySel.tplId)) _essaySel.tplId = t.big[0] ? t.big[0].id : '';
    const tpl = t.big.filter(x => x.id === _essaySel.tplId)[0] || t.big[0];
    if (!tpl) { body.innerHTML = '<div class="workshop-empty">模板库为空，请到「模板导入」页签导入。</div>'; return; }
    body.innerHTML =
      '<div class="ws-essay-bar">' +
      '<button type="button" class="primary" id="essay-new">＋ 新建草稿</button>' +
      '<select id="essay-tpl">' + t.big.map(x =>
        '<option value="' + esc(x.id) + '"' + (x.id === tpl.id ? ' selected' : '') + '>' + esc(x.title) + '</option>').join('') + '</select>' +
      '<span class="ins-dim" style="margin-left:auto">' + tpl.slots.length + ' 段框架' +
      (tpl.topic ? ' · 话题：' + esc(tpl.topic) : '') + '</span>' +
      '</div>' +
      '<div class="ws-essay-body" id="essay-draft-area"></div>';
    body.querySelector('#essay-tpl').addEventListener('change', (e) => {
      _essaySel.tplId = e.target.value; _essaySel.draftId = '';
      renderBigEssayTab(body);
    });
    body.querySelector('#essay-new').addEventListener('click', () => {
      const d = { id: genId(), kind: 'big', templateId: tpl.id, title: tpl.title, topic: tpl.topic,
        slots: {}, scores: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      tpl.slots.forEach(s => { d.slots[s.key] = ''; });
      const all = essayDrafts(); all.push(d); saveEssayDrafts(all);
      _essaySel.draftId = d.id;
      renderBigEssayTab(body);
    });
    renderDraftArea(body, tpl, 'big');
  }

  // ---------- 页签 2：小作文 ----------
  function renderSmallEssayTab(body) {
    const t = essayTemplates();
    if (!_essaySel.smallTplId || !t.small.some(x => x.id === _essaySel.smallTplId)) {
      _essaySel.smallTplId = t.small[0] ? t.small[0].id : '';
    }
    const tpl = t.small.filter(x => x.id === _essaySel.smallTplId)[0] || t.small[0];
    if (!tpl) { body.innerHTML = '<div class="workshop-empty">模板库为空，请到「模板导入」页签导入。</div>'; return; }
    const samples = tpl.samples || [];
    const tplMeta = [tpl.format ? '格式：' + tpl.format : '', tpl.structure.length ? '结构：' + tpl.structure.join(' → ') : ''].filter(Boolean).join('　｜　');
    body.innerHTML =
      '<div class="ws-small-picker">' + t.small.map(x =>
        '<button type="button" class="ws-type' + (x.id === tpl.id ? ' active' : '') + '" data-stype="' + esc(x.id) + '">' +
        esc(x.name) + '</button>').join('') + '</div>' +
      '<div class="ins-dim">' + esc(tplMeta || '该类型暂无格式说明') + '</div>' +
      '<div class="ws-essay-bar"><button type="button" class="primary" id="small-new">＋ 新建这篇作文</button>' +
      '<span class="ins-dim" style="margin-left:auto">' + (tpl.openings.length + tpl.closings.length) +
      ' 条套话' + (samples.length ? ' · ' + samples.length + ' 篇范文' : '') + '</span></div>' +
      (tpl.openings.length || tpl.closings.length
        ? '<div class="ws-say-list">' +
          tpl.openings.map((s, i) => '<button type="button" class="ws-say" data-say="' + esc(s) + '">开头 ' + (i + 1) + '　' + esc(s) + '</button>').join('') +
          tpl.closings.map((s, i) => '<button type="button" class="ws-say" data-say="' + esc(s) + '">结尾 ' + (i + 1) + '　' + esc(s) + '</button>').join('') +
          '</div>'
        : '<div class="ws-tpl-tip">这个类型还没有套话库 —— 点「⬇ 模板导入」把 openings / closings 导进来，这里就会列出可一键插入的句子。</div>') +
      (samples.length ? '<details class="ws-samples"><summary>范文 ' + samples.length + ' 篇</summary>' +
        samples.map(s => '<div class="ws-sample"><b>' + esc(s.title || '范文') + '</b><div>' + esc(s.text) + '</div></div>').join('') +
        '</details>' : '') +
      '<div class="ws-essay-body" id="essay-draft-area"></div>';
    body.querySelectorAll('[data-stype]').forEach(b => b.addEventListener('click', () => {
      _essaySel.smallTplId = b.dataset.stype; _essaySel.draftId = '';
      renderSmallEssayTab(body);
    }));
    body.querySelectorAll('[data-say]').forEach(b => b.addEventListener('click', () => {
      const ta = body.querySelector('#essay-slot-body') || body.querySelector('[data-slot]');
      if (!ta) { showTopToast('先点「＋ 新建这篇作文」，再插入套话'); return; }
      ta.value = ta.value ? ta.value.replace(/\s*$/, '') + ' ' + b.dataset.say : b.dataset.say;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }));
    body.querySelector('#small-new').addEventListener('click', () => {
      const d = { id: genId(), kind: 'small', templateId: tpl.id, title: tpl.name + '（' + new Date().toLocaleDateString() + '）',
        topic: tpl.name, slots: { body: '' }, scores: {},
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      const all = essayDrafts(); all.push(d); saveEssayDrafts(all);
      _essaySel.draftId = d.id;
      renderSmallEssayTab(body);
    });
    renderDraftArea(body, tpl, 'small');
  }

  // ---------- 草稿编辑区（大作文按槽位 / 小作文单框）+ 旧稿列表 + F17 自评 ----------
  function renderDraftArea(body, tpl, kind) {
    const area = body.querySelector('#essay-draft-area');
    if (!area) return;
    const all = essayDrafts();
    const mine = all.filter(d => d.kind === kind);
    let draft = mine.filter(d => d.id === _essaySel.draftId)[0];
    if (!draft) draft = mine[mine.length - 1];
    if (!draft) {
      // 没有草稿时也要能看清这个框架长什么样（否则页签是一片空白，用户不知道框架里有什么）
      const preview = (kind === 'big' ? (tpl.slots || []) : []).map(s =>
        '<div class="ws-slot" data-slot-preview="' + esc(s.key) + '">' +
        '<div class="ws-slot-head"><b>' + esc(s.label) + '</b>' +
        (s.role ? '<span class="ins-tag">' + esc(s.role) + '</span>' : '') +
        (s.words ? '<span class="ins-tag type">' + esc(s.words) + ' 词</span>' : '') + '</div>' +
        (s.tip ? '<div class="ins-dim">' + esc(s.tip) + '</div>' : '') +
        (s.starters.length
          ? '<div class="ws-say-list">' + s.starters.map(x => '<span class="ws-say">' + esc(x) + '</span>').join('') + '</div>'
          : '<div class="ws-tpl-tip">这一段还没有开头句式 —— 到「⬇ 模板导入」导入后即可一键插入。</div>') +
        '</div>').join('');
      area.innerHTML = '<div class="workshop-empty">还没有草稿。点上方「＋ 新建」，会按当前框架生成段落槽位并自动保存。</div>' +
        (preview ? '<div class="ws-slot-nav" style="margin-bottom:6px">框架预览</div>' + preview : '');
      return;
    }
    _essaySel.draftId = draft.id;
    const tplNow = (kind === 'big' ? essayTemplates().big : essayTemplates().small).filter(x => x.id === draft.templateId)[0] || tpl;
    const slots = kind === 'big' ? (tplNow.slots || []) : [{ key: 'body', label: '正文', role: '', words: '', tip: '', starters: [] }];
    const total = slots.reduce((n, s) => n + wordNum(draft.slots[s.key]), 0);
    const target = kind === 'big'
      ? (tplNow.slots || []).map(s => s.words).filter(Boolean).join(' + ') || '200'
      : '100 左右';
    let html = '<div class="ws-draft-head">' +
      '<input type="text" id="essay-title" value="' + esc(draft.title || '') + '" placeholder="标题" style="flex:1">' +
      '<select id="essay-draft-list">' + mine.map(d =>
        '<option value="' + esc(d.id) + '"' + (d.id === draft.id ? ' selected' : '') + '>' +
        esc((d.title || '未命名').slice(0, 18)) + ' · ' + String(d.updatedAt || '').slice(5, 16).replace('T', ' ') + '</option>').join('') + '</select>' +
      '<button type="button" class="workshop-del" data-ddel="' + esc(draft.id) + '" title="删除这篇草稿">✕</button>' +
      '</div>';
    html += '<div class="ws-slot-nav">' + slots.map((s, i) =>
      '<span class="ws-slot-nav-item">' + (i + 1) + '. ' + esc(s.label) +
      (s.role ? ' <span class="ins-tag">' + esc(s.role) + '</span>' : '') +
      (s.words ? ' <span class="ins-tag type">' + esc(s.words) + ' 词</span>' : '') +
      ' <b class="ws-slot-wc" data-wc-for="' + esc(s.key) + '">' + wordNum(draft.slots[s.key]) + '</b></span>').join('') + '</div>';
    slots.forEach(s => {
      html += '<div class="ws-slot">' +
        '<div class="ws-slot-head"><b>' + esc(s.label) + '</b>' +
        (s.tip ? '<span class="ins-dim">' + esc(s.tip) + '</span>' : '') + '</div>' +
        (s.starters.length ? '<div class="ws-say-list">' + s.starters.map(x =>
          '<button type="button" class="ws-say" data-say="' + esc(x) + '">' + esc(x) + '</button>').join('') + '</div>'
          : '<div class="ws-tpl-tip">这一段还没有开头句式 —— 到「⬇ 模板导入」导入后即可一键插入。</div>') +
        '<textarea data-slot="' + esc(s.key) + '" class="ws-slot-input" rows="4" ' +
        'placeholder="' + (s.words ? '建议 ' + esc(s.words) + ' 词' : '写这一段…') + '">' + esc(draft.slots[s.key] || '') + '</textarea>' +
        (kind === 'big' ? '<div class="ws-slot-tools"><button type="button" class="ins-btn ghost" data-insmat="' + esc(s.key) + '">📎 插入素材</button>' +
          '<span class="ins-dim">从「素材」页签一键插入 —— 素材取自文章，可直接用于论据</span></div>' : '') +
        '</div>';
    });
    // F17 自评清单
    const ck = essayTemplates().checklist;
    const scored = ck.reduce((n, c) => n + (Number(draft.scores[c.key]) || 0), 0);
    html += '<div class="ws-check"><div class="ws-check-head">作文自评清单（每项 1-5 分，自动保存）</div>' +
      ck.map(c => {
        const v = Number(draft.scores[c.key]) || 0;
        return '<div class="ws-check-row"><span class="ws-check-label" title="' + esc(c.hint || '') + '">' + esc(c.label) + '</span>' +
          '<span class="ws-check-stars">' + [1, 2, 3, 4, 5].map(n =>
            '<button type="button" class="ws-star' + (n <= v ? ' on' : '') + '" data-score="' + esc(c.key) + '" data-val="' + n + '">' + n + '</button>').join('') +
          '</span></div>';
      }).join('') +
      (scored ? '<div class="ins-dim">合计 ' + scored + ' / ' + (ck.length * 5) +
        '　' + wsAdvice(draft, ck) + '</div>'
        : '<div class="ins-dim">打完分会给出一句改进建议；分数随草稿保存。</div>') +
      '</div>';
    html += '<div class="ws-draft-foot"><span class="ins-dim">全文 <b id="essay-wc">' + total + '</b> 词（目标 ' + esc(target) + '）' +
      '　·　<span id="essay-save-state">已自动保存</span></span>' +
      '<button type="button" class="ins-btn ghost" data-export-draft="' + esc(draft.id) + '">导出这篇</button></div>';
    area.innerHTML = html;

    // —— 事件 ——
    const findDraft = () => essayDrafts().filter(d => d.id === draft.id)[0];
    let timer = null;
    const flush = () => {
      const all2 = essayDrafts();
      const d = all2.filter(x => x.id === draft.id)[0];
      if (!d) return;
      d.slots = d.slots || {};
      area.querySelectorAll('[data-slot]').forEach(ta => { d.slots[ta.dataset.slot] = ta.value; });
      const titleEl = area.querySelector('#essay-title');
      if (titleEl) d.title = titleEl.value.trim();
      d.updatedAt = new Date().toISOString();
      saveEssayDrafts(all2);
      const st = area.querySelector('#essay-save-state');
      if (st) st.textContent = '已自动保存 ' + new Date().toLocaleTimeString();
    };
    // 记录「最后一次编辑的作文槽位」：同义替换页签要往它里面替换词。
    // 记两层：DOM 元素（页签没切走时直接改 DOM）+ 草稿坐标（页签切走后改数据）。
    area.querySelectorAll('[data-slot]').forEach(ta => {
      const mark = () => {
        _lastSlotEl = ta;
        _lastSlot = { draftId: draft.id, slot: ta.dataset.slot, sel: [ta.selectionStart, ta.selectionEnd] };
      };
      ta.addEventListener('focus', mark);
      ta.addEventListener('keyup', mark);
      ta.addEventListener('mouseup', mark);
      ta.addEventListener('input', mark);
    });
    area.addEventListener('input', () => {
      const st = area.querySelector('#essay-save-state');
      if (st) st.textContent = '保存中…';
      // 字数实时更新
      let tot = 0;
      area.querySelectorAll('[data-slot]').forEach(ta => {
        const n = wordNum(ta.value); tot += n;
        const b = area.querySelector('[data-wc-for="' + ta.dataset.slot + '"]');
        if (b) b.textContent = n;
      });
      const wcEl = area.querySelector('#essay-wc');
      if (wcEl) wcEl.textContent = tot;
      clearTimeout(timer);
      timer = setTimeout(flush, 600);
    });
    area.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'essay-draft-list') {
        flush();
        _essaySel.draftId = e.target.value;
        if (kind === 'big') renderBigEssayTab(body); else renderSmallEssayTab(body);
      }
    });
    area.addEventListener('click', (e) => {
      const t = e.target;
      const say = t.closest && t.closest('[data-say]');
      if (say) {
        const ta = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.slot
          ? document.activeElement : area.querySelector('[data-slot]');
        if (ta) {
          ta.value = ta.value ? ta.value.replace(/\s*$/, '') + ' ' + say.dataset.say : say.dataset.say;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.focus();
        }
        return;
      }
      const star = t.closest && t.closest('[data-score]');
      if (star) {
        const all2 = essayDrafts();
        const d = all2.filter(x => x.id === draft.id)[0];
        if (!d) return;
        d.scores = d.scores || {};
        d.scores[star.dataset.score] = Number(star.dataset.val);
        d.updatedAt = new Date().toISOString();
        saveEssayDrafts(all2);
        if (kind === 'big') renderBigEssayTab(body); else renderSmallEssayTab(body);
        return;
      }
      const del = t.closest && t.closest('[data-ddel]');
      if (del) {
        if (!confirm('删除这篇草稿？')) return;
        saveEssayDrafts(essayDrafts().filter(x => x.id !== del.dataset.ddel));
        _essaySel.draftId = '';
        if (kind === 'big') renderBigEssayTab(body); else renderSmallEssayTab(body);
        return;
      }
      const exp = t.closest && t.closest('[data-export-draft]');
      if (exp) { exportOneDraft(exp.dataset.exportDraft); return; }
      const ins = t.closest && t.closest('[data-insmat]');
      if (ins) { toggleMaterialPicker(area, ins, ins.dataset.insmat); return; }
      const pick = t.closest && t.closest('[data-pickslot]');
      if (pick) {
        const ta = area.querySelector('[data-slot="' + pick.dataset.pickslot + '"]');
        if (ta) {
          const add = pick.dataset.mattext || '';
          ta.value = ta.value ? ta.value.replace(/\s*$/, '') + '\n' + add : add;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          bumpMaterialUse(pick.dataset.matid);
          showTopToast('已插入素材');
        }
        const box = area.querySelector('.ws-mat-pick');
        if (box) box.remove();
        return;
      }
    });
  }
  // F17：按最低的三个维度给一句改进建议
  function wsAdvice(draft, ck) {
    const rows = ck.map(c => ({ c: c, v: Number(draft.scores[c.key]) || 0 }))
      .filter(r => r.v > 0).sort((a, b) => a.v - b.v).slice(0, 2);
    if (!rows.length) return '';
    return '改进重点：' + rows.map(r => r.c.label + '（' + r.v + ' 分）' + (r.c.hint ? ' —— ' + r.c.hint : '')).join('；');
  }
  // 素材插入：列出全局素材，点一条插进当前槽位
  function toggleMaterialPicker(area, btn, slotKey) {
    const old = area.querySelector('.ws-mat-pick');
    if (old) { old.remove(); return; }
    const mats = getMaterials();
    const box = document.createElement('div');
    box.className = 'ws-mat-pick';
    if (!mats.length) {
      box.innerHTML = '<div class="ins-dim">素材库是空的 —— 到「素材」页签新建，或阅读时选中句子存素材。</div>';
    } else {
      box.innerHTML = mats.map((m, i) => {
        const text = [m.source || m.sourceText || '', m.cause ? '起因：' + m.cause : '',
          m.process ? '经过：' + m.process : '', m.develop ? '发展：' + m.develop : '',
          m.logic ? '逻辑：' + m.logic : '', m.usage ? '用法：' + m.usage : ''].filter(Boolean).join('　');
        return '<button type="button" class="ws-mat-item" data-pickslot="' + esc(slotKey) + '" data-matid="' + esc(m.id || i) +
          '" data-mattext="' + esc(text.replace(/<[^>]+>/g, '')) + '">' +
          '<b>' + esc(m.topic || '素材') + '</b> ' + esc(String(text).slice(0, 80)) + '</button>';
      }).join('');
    }
    btn.insertAdjacentElement('afterend', box);
  }
  function bumpMaterialUse(id) {
    const key = 'wsj_writing:materials';
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return; }
    const rec = arr.filter(x => x.id === id)[0];
    if (!rec) return;
    rec.usedCount = (rec.usedCount || 0) + 1;
    rec.lastUsedAt = new Date().toISOString();
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
  }
  // 单篇导出：直接给一段可粘进 Word / 微信的纯文本
  function exportOneDraft(id) {
    const d = essayDrafts().filter(x => x.id === id)[0];
    if (!d) return;
    const t = essayTemplates();
    const tpl = (d.kind === 'big' ? t.big : t.small).filter(x => x.id === d.templateId)[0];
    const lines = ['# ' + (d.title || '未命名'), ''];
    if (tpl && d.kind === 'big') {
      (tpl.slots || []).forEach(s => { lines.push('## ' + s.label, d.slots[s.key] || '（未写）', ''); });
    } else {
      lines.push(d.slots.body || '（未写）', '');
    }
    const ck = t.checklist;
    const scored = ck.filter(c => d.scores[c.key]);
    if (scored.length) {
      lines.push('## 自评', scored.map(c => '- ' + c.label + '：' + d.scores[c.key] + '/5').join('\n'),
        '', '合计 ' + scored.reduce((n, c) => n + d.scores[c.key], 0) + ' / ' + (ck.length * 5), '');
    }
    const text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => showTopToast('已复制到剪贴板'))
        .catch(() => downloadText(text, (d.title || 'essay') + '.md'));
    } else downloadText(text, (d.title || 'essay') + '.md');
  }
  function downloadText(text, name) {
    // 统一走 reader 的落盘层：优先写进用户选定的保存文件夹，没设过才退回浏览器下载。
    // ⚠ exam-panel.js 是独立 IIFE，只能经 window.__reader 桥调用
    const R = window.__reader;
    if (R && typeof R.saveFile === 'function') {
      return R.saveFile(name, text, 'text/plain;charset=utf-8').then(r => {
        showTopToast(R.saveResultToast(r), r.where === 'folder' ? 3000 : 7000);
        return r;
      }).catch(() => {});
    }
    try {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) { showTopToast('导出失败'); }
  }
  // 大作文槽位数量由模板决定，草稿要跟着模板走：缺的补空、多的保留
  function syncDraftSlots() {
    const t = essayTemplates();
    const all = essayDrafts();
    let n = 0;
    all.forEach(d => {
      const tpl = (d.kind === 'big' ? t.big : t.small).filter(x => x.id === d.templateId)[0];
      if (!tpl || d.kind !== 'big') return;
      d.slots = d.slots || {};
      (tpl.slots || []).forEach(s => { if (d.slots[s.key] === undefined) { d.slots[s.key] = ''; n++; } });
    });
    if (n) saveEssayDrafts(all);
    return n;
  }

  // ---------- 页签 3：模板导入 / 导出 ----------
  function renderTemplateTab(body) {
    const t = essayTemplates();
    const fmt = {
      big: t.big.map(x => ({ id: x.id, title: x.title, topic: x.topic, slots: x.slots })),
      small: t.small.map(x => ({ id: x.id, type: x.type, name: x.name, format: x.format, structure: x.structure, openings: x.openings, closings: x.closings }))
    };
    body.innerHTML =
      '<div class="ins-dim">模板走「导入」而不是写死在代码里：你可以随时把自己的框架、套话库、范文换进来。' +
      'JSON 格式与字段说明见项目里的 <code>references/作文模板导入说明.md</code>。</div>' +
      '<div class="ws-tpl-stat">大作文框架 <b>' + t.big.length + '</b> 个　·　小作文类型 <b>' + t.small.length + '</b> 个　·　自评维度 <b>' +
      t.checklist.length + '</b> 项　·　状态：<b>' + (t.custom ? '已导入自定义模板' : '内置骨架') + '</b>' +
      (t.meta.importedAt ? '（导入于 ' + esc(String(t.meta.importedAt).slice(0, 16).replace('T', ' ')) + '）' : '') + '</div>' +
      '<div class="ws-import-box">' +
      '<textarea id="tpl-json" rows="6" placeholder=\'在这里粘贴模板 JSON。也支持顶层直接是数组：[{"name":"建议信","openings":[...]}, ...]\'></textarea>' +
      '<div class="ws-import-actions">' +
      '<button type="button" class="primary" id="tpl-merge">解析并合并</button>' +
      '<button type="button" class="ins-btn ghost" id="tpl-replace">替换全部</button>' +
      '<button type="button" class="ins-btn ghost" id="tpl-file">从文件读取…</button>' +
      '<input type="file" id="tpl-file-input" accept=".json,.txt,application/json" hidden>' +
      '<button type="button" class="ins-btn ghost" id="tpl-export">导出当前模板</button>' +
      '<button type="button" class="ins-btn ghost" id="tpl-reset">恢复内置骨架</button>' +
      '</div>' +
      '<div id="tpl-msg" class="ws-import-msg"></div>' +
      '</div>' +
      '<details class="ws-samples"><summary>当前模板预览（导出格式就这么写）</summary><pre class="ws-json">' +
      esc(JSON.stringify(fmt, null, 2).slice(0, 6000)) + '</pre></details>';
    const ta = body.querySelector('#tpl-json');
    // 每次都重新取节点：重渲染会把 #tpl-msg 换成新节点，闭包里抓住的旧节点是脱离文档的
    const show = (kind, text) => {
      const m = body.querySelector('#tpl-msg');
      if (!m) return;
      m.className = 'ws-import-msg ' + kind;
      m.innerHTML = text;
    };
    const doImport = (mode) => {
      const raw = (ta.value || '').trim();
      if (!raw) { show('bad', '先把 JSON 粘进来，或点「从文件读取…」。'); return; }
      const r = normalizeTemplates(raw);
      if (r.error) { show('bad', '✗ ' + esc(r.error)); return; }
      // 基底只取「已经导入的」内容，不把内置骨架混进来 ——
      // 否则用户导入 1 个框架会看到 2 个（内置那个还没有开头句式，纯噪声）。
      // 没有导入内容时（空数组）essayTemplates() 会回落到内置骨架。
      const rawStored = (function () {
        try { return JSON.parse(localStorage.getItem(TPL_KEY)) || {}; } catch (e) { return {}; }
      })();
      const curBig = Array.isArray(rawStored.big) ? rawStored.big : [];
      const curSmall = Array.isArray(rawStored.small) ? rawStored.small : [];
      const curCheck = Array.isArray(rawStored.checklist) && rawStored.checklist.length ? rawStored.checklist : DEFAULT_CHECKLIST;
      const out = {
        big: r.big.length ? (mode === 'replace' ? r.big : mergeById(curBig, r.big)) : (mode === 'replace' ? [] : curBig),
        small: r.small.length ? (mode === 'replace' ? r.small : mergeById(curSmall, r.small)) : (mode === 'replace' ? [] : curSmall),
        checklist: r.checklist.length ? r.checklist : curCheck,
        meta: { name: r.name || (rawStored.meta && rawStored.meta.name) || '' }
      };
      saveEssayTemplates(out);
      syncDraftSlots();
      const summary = '✓ 已' + (mode === 'replace' ? '替换' : '合并') + '模板：大作文 <b>' + out.big.length +
        '</b> 个、小作文 <b>' + out.small.length + '</b> 个、自评维度 <b>' + out.checklist.length + '</b> 项。' +
        (r.warnings.length ? '<br><span class="ins-dim">提示：' + r.warnings.slice(0, 5).map(esc).join('<br>') + '</span>' : '');
      // ⚠ 必须先记下提示文案再重渲染：重渲染会换掉 #tpl-msg 节点，
      //   写进旧节点等于写进一个已经脱离文档的 div，用户什么都看不到。
      renderTemplateTab(body);
      show('ok', summary);
    };
    body.querySelector('#tpl-merge').addEventListener('click', () => doImport('merge'));
    body.querySelector('#tpl-replace').addEventListener('click', () => {
      if (!confirm('替换全部模板？会覆盖现有自定义模板（草稿不受影响）。')) return;
      doImport('replace');
    });
    body.querySelector('#tpl-file').addEventListener('click', () => body.querySelector('#tpl-file-input').click());
    body.querySelector('#tpl-file-input').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { ta.value = String(rd.result || ''); show('ok', '已读入 ' + f.name + '（' + ta.value.length + ' 字符），点「解析并合并」。'); };
      rd.onerror = () => show('bad', '✗ 文件读取失败');
      rd.readAsText(f, 'utf-8');
    });
    body.querySelector('#tpl-export').addEventListener('click', () => {
      const t2 = essayTemplates();
      downloadText(JSON.stringify({
        name: '我的作文模板', big: t2.big, small: t2.small, checklist: t2.checklist
      }, null, 2), 'essay-templates.json');
      show('ok', '已导出（这个文件可以直接再导入回来）');
    });
    body.querySelector('#tpl-reset').addEventListener('click', () => {
      if (!confirm('清空导入的自定义模板，恢复内置骨架？')) return;
      try { localStorage.removeItem(TPL_KEY); } catch (e) {}
      renderTemplateTab(body);
      show('ok', '已恢复内置骨架');
    });
  }
  // 合并策略：同 id 覆盖，否则追加（导入多次不会产生重复条目）
  function mergeById(cur, add) {
    const out = cur.slice();
    add.forEach(x => {
      const i = out.findIndex(y => y.id === x.id);
      if (i >= 0) out[i] = x; else out.push(x);
    });
    return out;
  }

  // ===== Expose to reader.js via window.__exam =====
  // (qTypeFilter / qMasteryFilter / activeTagFilters are already defined as getters/setters
  // on window.__reader inside reader.js IIFE — redefining here would silently no-op in
  // non-strict mode. Filter state stays owned by 03-notes.js and is read directly via
  // window.__reader getter if needed.)

  window.__exam = {
    QTYPE_ORDER, QTYPE_META,
    openSyntaxPanel, closeSyntaxPanel, saveSyntax,
    setupSyntaxPanel, upgradeSyntaxPanel,
    openMaterialPanel, closeMaterialPanel, saveMaterial, upgradeMaterialPanel, setMaterialType,
    recordRoot, openRootPanel, closeRootPanel, saveRootCard,
    openComposePanel, closeComposePanel,
    openWritingWorkshop,
    // F05/F06/F17：大作文框架 / 小作文模板库 / 模板导入 / 作文自评
    openEssayWorkshop, essayTemplates, saveEssayTemplates, normalizeTemplates,
    essayDrafts, saveEssayDrafts, syncDraftSlots, exportOneDraft,
    renderWorkshopOverview,
    // F08 同义替换表
    openSynonymPanel, getSynonyms, saveSynonyms, normalizeSynonyms, synApply, synAltsOf,
    // F14 素材聚类
    materialTopics, renderMaterialsTab,
    // F15 笔记历史 Delta
    noteDelta, noteApplyDelta, noteVersionContent, notePushVersion, noteStorageCompare, noteDiffHTML,
    renderQtypeList, renderQtypeCard, renderQtypeFilterRow,
    wireQtypeInteractions, addQtypeAnnotation,
    exportQtype, recomputeCorrect,
    annTags, addAnnotationTag, removeAnnotationTag,
    wireTagInteractions, renderTagRow, renderTagFilterRow,
    // Shared filter predicates (used by getFilteredSorted in 03-notes.js and elsewhere)
    matchesAllFilters, matchesTagFilter, matchesQFilter, matchesNoteSearch,
  };
})();