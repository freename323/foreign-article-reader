  // ===== 考试模式：5 个相互独立的模块 =====
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
