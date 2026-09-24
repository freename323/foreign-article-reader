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
