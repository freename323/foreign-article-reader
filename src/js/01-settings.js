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
    w.classList.toggle('no-summary', !settings.showSummary);
    w.classList.toggle('no-cn', !settings.showCN);
    document.getElementById('toggle-summary-btn').classList.toggle('active', settings.showSummary);
    document.getElementById('toggle-cn-btn').classList.toggle('active', settings.showCN);
    const notesBtn = document.getElementById('toggle-notes-btn');
    if (notesBtn) notesBtn.classList.toggle('active', settings.showNotes);
    const hdr = document.querySelector('.header');
    if (hdr) hdr.classList.toggle('collapsed', !settings.showHeader);
    const hdrBtn = document.getElementById('toggle-header-btn');
    if (hdrBtn) hdrBtn.classList.toggle('active', settings.showHeader);
  }
  function toggleSummary() { settings.showSummary = !settings.showSummary; saveSettings(); applyLayout(); showTopToast(settings.showSummary ? '概要列已显示' : '概要列已隐藏'); setTimeout(() => window.__resyncScroll && window.__resyncScroll(), 50); }
  function toggleCN() { settings.showCN = !settings.showCN; saveSettings(); applyLayout(); showTopToast(settings.showCN ? '中文列已显示' : '中文列已隐藏'); setTimeout(() => window.__resyncScroll && window.__resyncScroll(), 50); }
  function toggleHeader() { settings.showHeader = !settings.showHeader; saveSettings(); applyLayout(); showTopToast(settings.showHeader ? '标题区已显示' : '标题区已隐藏'); setTimeout(() => window.__resyncScroll && window.__resyncScroll(), 50); }
  function toggleNotes() {
    settings.showNotes = !settings.showNotes; saveSettings();
    const sec = document.querySelector('.notes-section');
    sec.classList.toggle('collapsed', !settings.showNotes);
    const nb = document.getElementById('toggle-notes-btn');
    if (nb) nb.classList.toggle('active', settings.showNotes);
    showTopToast(settings.showNotes ? '笔记面板已展开' : '笔记面板已折叠');
    updateNotesButtons();
  }
  // Direct open or toggle: if already showing this bucket, close; otherwise open & switch
  function openNotes(bucket) {
    if (settings.showNotes && notesBucket === bucket) {
      settings.showNotes = false; saveSettings();
      document.querySelector('.notes-section').classList.add('collapsed');
    } else {
      const wasCollapsed = !settings.showNotes;
      if (wasCollapsed) {
        settings.showNotes = true; saveSettings();
        document.querySelector('.notes-section').classList.remove('collapsed');
      }
      if (bucket) setNotesBucket(bucket);
      if (wasCollapsed) {
        const sec = document.querySelector('.notes-section');
        if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }
    updateNotesButtons();
  }
  function updateNotesButtons() {
    const vb = document.getElementById('open-vocab-btn');
    const nb = document.getElementById('open-note-btn');
    if (vb) {
      const on = settings.showNotes && notesBucket === 'vocab';
      vb.classList.toggle('active', on);
      vb.style.background = on ? '#cfe2ff' : '';
      vb.style.color = on ? '#1a365d' : '';
      vb.style.fontWeight = on ? '600' : '';
    }
    if (nb) {
      const on = settings.showNotes && notesBucket === 'note';
      nb.classList.toggle('active', on);
      nb.style.background = on ? '#d4f4dd' : '';
      nb.style.color = on ? '#1c4532' : '';
      nb.style.fontWeight = on ? '600' : '';
    }
  }
