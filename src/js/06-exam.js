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
