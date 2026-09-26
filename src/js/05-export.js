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
