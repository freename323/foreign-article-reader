(function() {
  // ===== 资源版本戳 =====
  // reader.js 由 <script src="reader.js?v=..."> 引入。在解析期把它自己的 ?v= 记下来，
  // 供之后动态插入的懒加载脚本（exam-panel.js / wordfreq.js）复用。
  // 否则这两个文件的改动永远不会失效浏览器缓存 —— 典型「改了代码但页面还是旧的」。
  const ASSET_V = (function() {
    try {
      const s = document.currentScript ||
        document.querySelector('script[src*="reader.js"]');
      const m = s && s.src && s.src.match(/[?&]v=([^&#]+)/);
      return m ? '?v=' + m[1] : '';
    } catch (e) { return ''; }
  })();

  // ===== 文章元数据（唯一 ID 来源，取代旧 EXAM_SLUGS「文件名 → slug」硬编码映射表）=====
  // 文章 <body> 上的 data-edition / data-has-exam / data-exam-types 由构建脚本写入，
  // 与每篇配色（reader.css 的 body[data-edition=...]）共用同一份数据。
  // 这样新增文章只需写对 HTML 属性，无需改任何 JS、无需重新维护映射表。
  const articleMeta = (function() {
    const ds = (document.body && document.body.dataset) || {};
    return {
      slug: (ds.edition || '').trim(),                 // 栏目 ID（如 ai_cost），用于考试/练习页寻址
      hasExam: ds.hasExam === 'true',                  // 是否显示「考试」菜单（缺失即不显示）
      examTypes: (ds.examTypes || '').split(',').map(s => s.trim()).filter(Boolean)
    };
  })();
  // 注意：articleId 是 localStorage key 后缀，语义恒为「页面文件名（含 .html）」。
  // 它决定存量标注 / 概要 / 翻译 / 阅读记录的归属，改动会导致数据失联，故保持不变。
  const articleId = location.pathname.split('/').pop() || 'article';
  const ANNO_KEY = 'annotations:' + articleId;
  const SUM_KEY = 'summary:' + articleId;
  const TRANS_KEY = 'translation:' + articleId;
  const SETTINGS_KEY = 'settings:' + articleId;
  let annotations = [];
  let summaryData = {};
  let translationData = {};
  let settings = { theme: 'green', fontSize: 16, showSummary: true, showCN: true, showNotes: true, showHeader: true, mobileMode: 'both',
    view: 'paper',         // 阅读模式默认就是报纸版（'reader' 可切回三栏对照）
    paperCn: true,         // 报纸版是否显示中文对照页
    paperFont: 16.5 };     // 报纸版正文字号
  let initializing = true; // UX-5: suppress operation toasts during first load
  const mobileQuery = window.matchMedia ? window.matchMedia('(max-width: 860px)') : { matches: false }; // UX-3/UX-6

  // ===== Util =====
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function unesc(s) { return String(s == null ? '' : s).replace(/&(amp|lt|gt|quot|#39);/g, c => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[c])); }
  function genId() { return Date.now() + '-' + Math.random().toString(36).slice(2, 8); }
  function localDateStr(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

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

  // ===== Toast (shared with exam-panel.js) =====
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

  // ===== Lazy-load exam-panel.js (49KB, only when exam/material features are used) =====
  let _examLoading = null;
  function loadExamPanel() {
    if (window.__exam) return Promise.resolve(window.__exam);
    if (_examLoading) return _examLoading;
    _examLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'exam-panel.js' + ASSET_V;
      s.onload = () => resolve(window.__exam);
      s.onerror = () => { _examLoading = null; reject(new Error('exam-panel.js failed to load')); };
      document.head.appendChild(s);
    });
    return _examLoading;
  }