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
            loadExamPanel().then(E => E.openSyntaxPanel(info.text));
            window.getSelection().removeAllRanges(); hideMenu();
          } else if (act === 'material') {
            loadExamPanel().then(E => E.openMaterialPanel(info.text));
            window.getSelection().removeAllRanges(); hideMenu();
          } else if (act === 'root') {
            loadExamPanel().then(E => E.openRootPanel(info.text));
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
