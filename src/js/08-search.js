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
