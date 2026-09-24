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
