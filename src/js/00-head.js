(function() {
  const articleId = location.pathname.split('/').pop() || 'article';
  const ANNO_KEY = 'annotations:' + articleId;
  const SUM_KEY = 'summary:' + articleId;
  const TRANS_KEY = 'translation:' + articleId;
  const SETTINGS_KEY = 'settings:' + articleId;
  let annotations = [];
  let summaryData = {};
  let translationData = {};
  let settings = { theme: 'green', fontSize: 16, showSummary: true, showCN: true, showNotes: true, showHeader: true, mobileMode: 'both' };
  let initializing = true; // UX-5: suppress operation toasts during first load
  const mobileQuery = window.matchMedia ? window.matchMedia('(max-width: 860px)') : { matches: false }; // UX-3/UX-6

  // ===== Util =====
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function unesc(s) { return String(s == null ? '' : s).replace(/&(amp|lt|gt|quot|#39);/g, c => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[c])); }
  function genId() { return Date.now() + '-' + Math.random().toString(36).slice(2, 8); }

  // ===== Load/save =====
  function loadAll() {
    try { const a = localStorage.getItem(ANNO_KEY); if (a) annotations = JSON.parse(a); } catch(e) { annotations = []; }
    // Migrate: ensure every annotation has a bucket field (older versions may lack it)
    let migrated = false;
    annotations.forEach(a => {
      if (!a.bucket) { a.bucket = (a.type === 'note') ? 'note' : 'vocab'; migrated = true; }
    });
    if (migrated) saveAnnotations();
    try { const s = localStorage.getItem(SUM_KEY); if (s) summaryData = JSON.parse(s); } catch(e) { summaryData = {}; }
    try { const t = localStorage.getItem(TRANS_KEY); if (t) translationData = JSON.parse(t); } catch(e) { translationData = {}; }
    try { const st = localStorage.getItem(SETTINGS_KEY); if (st) Object.assign(settings, JSON.parse(st)); } catch(e) {}
    // 一次性迁移：旧默认「跟随系统」→「绿金」（新默认主题）。显式选过暗色/亮色的不受影响
    if (!localStorage.getItem('wsj_reader:themeMigrated')) {
      try { localStorage.setItem('wsj_reader:themeMigrated', '1'); } catch (e) {}
      if (settings.theme === 'system') settings.theme = 'green';
    }
    // 「考研阅读」阅读模式已移除（与模拟考试页重复），清理遗留开关
    try { localStorage.removeItem('wsj_reader:mode'); } catch (e) {}
  }
  function saveAnnotations() { try { localStorage.setItem(ANNO_KEY, JSON.stringify(annotations)); } catch(e) { handleQuotaError(e); } checkStorageQuota(); }
  function saveSummary() { try { localStorage.setItem(SUM_KEY, JSON.stringify(summaryData)); } catch(e) { handleQuotaError(e); } checkStorageQuota(); }
  function saveTranslation() { try { localStorage.setItem(TRANS_KEY, JSON.stringify(translationData)); } catch(e) { handleQuotaError(e); } checkStorageQuota(); }
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch(e) { handleQuotaError(e); } checkStorageQuota(); }

  // ===== Storage quota warning =====
  let quotaWarned = false;
  function getStorageUsage() {
    try {
      let total = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        total += (k.length + localStorage.getItem(k).length) * 2; // UTF-16
      }
      return total;
    } catch (e) { return 0; }
  }
  function checkStorageQuota() {
    if (quotaWarned) return;
    const used = getStorageUsage();
    // localStorage limit is typically 5MB (5 * 1024 * 1024 bytes)
    const limit = 5 * 1024 * 1024;
    const pct = used / limit;
    if (pct > 0.8) {
      quotaWarned = true;
      const mb = (used / 1024 / 1024).toFixed(1);
      showTopToast('⚠ 本地存储已用 ' + mb + 'MB（' + Math.round(pct * 100) + '%），建议尽快导出备份：💾 数据 → 备份全部数据', 8000);
    }
  }
  function handleQuotaError(e) {
    if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
      showTopToast('❌ 本地存储已满！请先导出备份再清理：💾 数据 → 备份全部数据 → 清理数据', 10000);
    }
  }
