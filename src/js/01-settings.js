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
  // v35: 剪报本唯一的开关 —— 只做折叠/展开（折叠 = 收成 38px 工具条，按钮仍可点）。
  // 过去的「× 关」+ 工具栏打开按钮 + 报纸版 paperNotesOpen 三套状态互相打架，
  // 现在只留这一个入口，其余打开路径全部移除。
  function toggleNotes() {
    settings.showNotes = !settings.showNotes; saveSettings();
    const sec = document.querySelector('.notes-section');
    sec.classList.toggle('collapsed', !settings.showNotes);
    const btn = sec.querySelector('.close-notes');
    if (btn) {
      btn.textContent = settings.showNotes ? '▸ 折叠' : '▾ 展开';
      btn.title = settings.showNotes ? '折叠笔记面板' : '展开笔记面板';
    }
    showTopToast(settings.showNotes ? '笔记面板已展开' : '笔记面板已折叠');
  }
