  // ===== Clock, Reading Timer & Position =====
  const READING_KEY = 'reading:' + articleId;
  let readingData = { totalSeconds: 0, lastPosition: null, sessions: [] };
  let sessionSeconds = 0;
  let timerInterval = null;
  let posSaveTimer = null;
  let currentSession = null;

  function loadReading() {
    try {
      readingData = JSON.parse(localStorage.getItem(READING_KEY)) || { totalSeconds: 0, lastPosition: null, sessions: [] };
      if (!readingData.sessions) readingData.sessions = [];
    } catch(e) { readingData = { totalSeconds: 0, lastPosition: null, sessions: [] }; }
  }
  function saveReading() {
    localStorage.setItem(READING_KEY, JSON.stringify(readingData));
  }

  // --- Clock ---
  function tickClock() {
    const el = document.getElementById('toolbar-clock');
    if (!el) return;
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    el.textContent = h + ':' + m + ':' + s;
  }

  // --- Timer ---
  function fmtTime(sec) {
    sec = Math.floor(sec);
    if (sec < 3600) {
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      return mm + ':' + ss;
    }
    const hh = String(Math.floor(sec / 3600)).padStart(2, '0');
    const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    return hh + ':' + mm + ':' + ss;
  }
  function updateTimerDisplay() {
    const se = document.getElementById('session-timer');
    const te = document.getElementById('total-timer');
    // 只写时间本身，标签交给 CSS（报纸版读作「已读 / 累计」，三栏视图读作 ⏱ / 📊）
    if (se) {
      se.textContent = fmtTime(sessionSeconds);
      se.title = '本次阅读时长 ' + fmtTime(sessionSeconds);
    }
    if (te) {
      te.textContent = fmtTime(readingData.totalSeconds);
      te.title = '累计阅读时长 ' + fmtTime(readingData.totalSeconds);
    }
  }
  function startTimer() {
    if (timerInterval) return;
    const startPara = getCurrentPosition() || 0;
    currentSession = { start: new Date().toISOString(), end: null, paras: [startPara, startPara] };
    timerInterval = setInterval(() => {
      sessionSeconds++;
      readingData.totalSeconds++;
      if (currentSession) currentSession.paras[1] = getCurrentPosition() || currentSession.paras[1];
      if (sessionSeconds % 10 === 0) saveReading();
      updateTimerDisplay();
    }, 1000);
  }
  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (currentSession) {
      currentSession.end = new Date().toISOString();
      currentSession.paras[1] = getCurrentPosition() || currentSession.paras[1];
      readingData.sessions.push(currentSession);
      currentSession = null;
    }
    saveReading();
  }
  function initTimer() {
    loadReading();
    updateTimerDisplay();
    startTimer();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopTimer(); else startTimer();
    });
    window.addEventListener('beforeunload', stopTimer);
  }

  // --- Reading position ---
  // 记录的是「段号 data-para-idx」而非位置序号 —— 报纸阅读页会把段落分到不同版，
  // 位置序号会随分版结果漂移，段号才稳定。
  function getCurrentPosition() {
    // 报纸阅读页：位置 = 当前版第一段的段号
    if (typeof paperIsOpen === 'function' && paperIsOpen()) {
      return (typeof paperCurrentParaIdx === 'function') ? paperCurrentParaIdx() : null;
    }
    const enCol = document.querySelector('.main-wrap .col-body.en') || document.querySelector('.col-body.en');
    if (!enCol) return null;
    const paras = enCol.querySelectorAll('p[data-para-idx]');
    if (paras.length === 0) return null;
    const colTop = enCol.getBoundingClientRect().top;
    let best = null;
    paras.forEach((p) => {
      const rect = p.getBoundingClientRect();
      if (rect.top <= colTop + 80) best = parseInt(p.dataset.paraIdx, 10);
    });
    return best;
  }
  function savePosition() {
    const pos = getCurrentPosition();
    if (pos !== null) {
      readingData.lastPosition = pos;
      saveReading();
    }
  }
  function initPositionTracking() {
    loadReading();
    if (readingData.lastPosition !== null) {
      let btn = document.getElementById('bookmark-btn');
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'bookmark-btn';
        btn.className = 'bookmark-pill';
        btn.textContent = '📍 回到上次阅读';
        btn.addEventListener('click', jumpToLastPosition);
        document.body.appendChild(btn);
      }
      btn.style.display = '';
    }
    const enCol = document.querySelector('.col-body.en');
    if (enCol) {
      enCol.addEventListener('scroll', () => {
        clearTimeout(posSaveTimer);
        posSaveTimer = setTimeout(savePosition, 2000);
      }, { passive: true });
    }
  }
  function jumpToLastPosition() {
    loadReading();
    if (readingData.lastPosition === null) return;
    // 报纸阅读页：先翻到含该段的那一版，再高亮该段
    if (typeof paperIsOpen === 'function' && paperIsOpen()) {
      const idx = readingData.lastPosition;
      if (typeof window.paperGotoParaIdx === 'function') window.paperGotoParaIdx(idx);
      const el = document.querySelector('.np-leaf-en p[data-para-idx="' + idx + '"]');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.outline = '2px solid var(--cn-tag)';
        el.style.outlineOffset = '2px';
        setTimeout(() => { el.style.outline = 'none'; }, 2500);
      }
      const bb = document.getElementById('bookmark-btn');
      if (bb) bb.style.display = 'none';
      return;
    }
    const enCol = document.querySelector('.main-wrap .col-body.en') || document.querySelector('.col-body.en');
    if (!enCol) return;
    const el = enCol.querySelector('p[data-para-idx="' + readingData.lastPosition + '"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.style.outline = '2px solid var(--cn-tag)';
      el.style.outlineOffset = '2px';
      el.style.transition = 'outline 0.3s';
      setTimeout(() => { el.style.outline = 'none'; }, 2500);
    }
    const btn = document.getElementById('bookmark-btn');
    if (btn) btn.style.display = 'none';
  }

  // ===== UX-2: Backup & restore all app data =====
  // 考试练习页（exam_/cloze_/newtype_/translation_）的数据也在同一浏览器里，必须一起备份
  const BACKUP_PREFIXES = ['annotations:', 'reading:', 'settings:', 'summary:', 'translation:', 'syntax:',
    'wsj_review:', 'wsj_reader:',
    'examq:', 'examtimer:', 'examlimit:', 'exammode:', 'exammark:', 'examansheet:', 'examhist:', 'examhl:', 'examsess:',
    'cz:', 'transq:', 'transtimer:', 'nt:'];
  // ⚠ 新增独立键时**必须**加进这两个白名单，否则备份会静默漏掉它（不报错、只是丢数据）。
  //   曾经就漏过——完形 / 新题型 / 翻译三个模块的错题库（wsj_cloze / wsj_newtype /
  //   wsj_translation）一直是写了但没备份，错题本的 4 个库里只有 1 个进得了备份文件。
  const BACKUP_EXACT_KEYS = ['wsj_writing:materials', 'wsj_writing:advice', 'wsj_roots:cards',
    // 写作工坊：作文模板库 + 大小作文草稿 + 自由笔记（F05/F06/F17）+ 同义替换表（F08）
    'wsj_writing:templates', 'wsj_writing:essays', 'wsj_writing:notes', 'wsj_writing:synonyms',
    'wsj_exam:wrongs', 'wsj_exam:overtime', 'wsj_exam:history', 'wsj_exam:theme',
    // 三个练习页自己的错题库（错题本会把它们和 wsj_exam:wrongs 合并成一张清单）
    'wsj_cloze:wrongs', 'wsj_newtype:wrongs', 'wsj_translation:wrongs',
    // 错题本的复习调度（间隔重复）—— 11-insights.js
    'wsj_wrongrev',
    // 中译英默写：每题成绩 + 错词本 —— 12-dictation.js
    'wsj_dictation:stats', 'wsj_dictation:wrongs'];
  function collectAppKeys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (BACKUP_EXACT_KEYS.indexOf(k) >= 0 || BACKUP_PREFIXES.some(p => k.startsWith(p))) keys.push(k);
    }
    return keys;
  }
  // ---- 备份落盘：记住一个本机文件夹 → 之后一键写进去；不支持时降级为下载并讲清去向 ----
  const IDB_NAME = 'english-reader-files';
  const IDB_STORE = 'handles';
  // ⚠ 这两个 key 历史上都被误写成同一个字面量 '***'：
  //   * 「备份记录」与「备份文件夹名」互相覆盖——写一个就冲掉另一个；
  //   * 与读取端 parseLS（走 JSON.parse）的约定不一致，文件夹名永远读不回来。
  // 现改为独立 key，并做一次幂等抢救迁移。
  const BACKUP_LOG_KEY = 'wsj_reader:backupLog';
  const BACKUP_DIR_NAME_KEY = 'wsj_reader:backupDirName';
  // 句柄没能存进 IndexedDB 时置位：这次会话能用，重启后还得重选。要如实告诉用户，
  // 否则会出现「明明设过，下次又下载」这种静默失效。
  const BACKUP_DIR_VOLATILE_KEY = 'wsj_reader:backupDirVolatile';
  const BACKUP_LEGACY_KEY = '***';
  (function migrateLegacyBackupKeys() {
    let legacy = null;
    try { legacy = localStorage.getItem(BACKUP_LEGACY_KEY); } catch (e) { return; }
    if (!legacy) return;
    let parsed = null, isJson = true;
    try { parsed = JSON.parse(legacy); } catch (e) { isJson = false; }
    try {
      if (isJson && Array.isArray(parsed)) {
        if (!localStorage.getItem(BACKUP_LOG_KEY)) localStorage.setItem(BACKUP_LOG_KEY, legacy);
      } else {
        // 旧代码写入文件夹名时没有 JSON.stringify，故非 JSON 的裸串也按文件夹名抢救
        const name = (isJson && typeof parsed === 'string') ? parsed : (isJson ? null : legacy);
        if (name && !localStorage.getItem(BACKUP_DIR_NAME_KEY)) {
          localStorage.setItem(BACKUP_DIR_NAME_KEY, JSON.stringify(name));
        }
      }
    } catch (e) {}
    try { localStorage.removeItem(BACKUP_LEGACY_KEY); } catch (e) {}
  })();
  function idbOpen() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(IDB_NAME, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => { try { req.result.createObjectStore(IDB_STORE); } catch (e) {} };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function idbPut(value, key) {
    return idbOpen().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    }));
  }
  function idbGet(key) {
    return idbOpen().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const rq = tx.objectStore(IDB_STORE).get(key);
      rq.onsuccess = () => resolve(rq.result || null);
      rq.onerror = () => reject(rq.error);
    }));
  }
  // ⚠ 任何一次 IDB 调用都必须有超时：IndexedDB 在部分环境（file:// 的某些浏览器版本、
  //   隐私模式、被策略禁用）会**既不成功也不失败**，直接挂住。挂住的后果是
  //   saveFile 卡在 await 上 —— 用户点「导出」什么都不会发生，比下载更糟。
  function withTimeout(p, ms, fallback) {
    return Promise.race([
      p.catch(() => fallback),
      new Promise(r => setTimeout(() => r(fallback), ms))
    ]);
  }
  function dirPickerSupported() {
    return typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined';
  }
  // 句柄缓存 + 权限记忆：保证「点导出」到「真的要写盘」之间不夹多余的 await。
  // 原因：requestPermission 依赖「用户激活」（transient activation），中间多一次
  // IndexedDB 往返就可能把它耗掉，于是明明授权过却每次都要重新问。
  let dirHandleCache = null;
  let dirPermOk = false;
  async function getBackupDir() {
    if (!dirPickerSupported()) return null;
    if (dirHandleCache) return dirHandleCache;
    const h = await withTimeout(idbGet('backupDir'), 700, null);
    if (h) dirHandleCache = h;
    return h || null;
  }
  async function pickBackupDir() {
    const h = await window.showDirectoryPicker({ id: 'reader-backup-dir', mode: 'readwrite' });
    // 先把句柄放进内存缓存：即使下面 IDB 写失败，本次会话内的导出也已经能直写了
    dirHandleCache = h; dirPermOk = true;
    // 句柄只能存 IndexedDB（localStorage 存不了对象句柄）
    const persisted = await withTimeout(idbPut(h, 'backupDir').then(() => true), 1500, false);
    try {
      // 必须 JSON.stringify：读取端用 parseLS（JSON.parse），裸串会解析失败而永远显示不出来
      localStorage.setItem(BACKUP_DIR_NAME_KEY, JSON.stringify(h.name || ''));
      if (persisted) localStorage.removeItem(BACKUP_DIR_VOLATILE_KEY);
      else localStorage.setItem(BACKUP_DIR_VOLATILE_KEY, JSON.stringify('1'));
    } catch (e) {}
    return h;
  }
  function backupDirVolatile() { return parseLS(BACKUP_DIR_VOLATILE_KEY, '') === '1'; }
  function forgetBackupDir() {
    dirHandleCache = null; dirPermOk = false;
    try { localStorage.removeItem(BACKUP_DIR_NAME_KEY); } catch (e) {}
    try { localStorage.removeItem(BACKUP_DIR_VOLATILE_KEY); } catch (e) {}
    try { withTimeout(idbPut(null, 'backupDir'), 1500, false); } catch (e) {}
  }
  async function ensureDirPermission(h) {
    if (!h || !h.queryPermission) return true;
    if (dirPermOk && h === dirHandleCache) return true;
    const d = { mode: 'readwrite' };
    try {
      if (await h.queryPermission(d) === 'granted') { dirPermOk = true; return true; }
      const ok = (await h.requestPermission(d)) === 'granted';
      if (ok) dirPermOk = true;
      return ok;
    } catch (e) { return false; }
  }
  // ---- 文件名净化：走文件夹直写时，非法字符不再由浏览器兜底，会直接抛异常 ----
  function sanitizeFilename(name) {
    let n = String(name == null ? '' : name)
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')      // Windows 非法字符（导出标题里最常见的冒号）
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')                              // 不能以点开头
      .replace(/[. ]+$/, '');                           // Windows 不允许以点/空格结尾
    if (!n) n = 'untitled';
    const m = /^(.*?)(\.[A-Za-z0-9]{1,8})$/.exec(n);
    const base = m ? m[1] : n, ext = m ? m[2] : '';
    n = (base.length > 80 ? base.slice(0, 80) : base) + ext;
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) n = '_' + n;
    return n;
  }
  // 已存在就换名（导出同一篇两次不该互相覆盖，也不该静默丢内容）
  async function uniqueFileName(dir, name) {
    const m = /^(.*?)(\.\w{1,8})?$/.exec(name);
    const base = m[1], ext = m[2] || '';
    for (let i = 1; i <= 20; i++) {
      const cand = i === 1 ? name : base + ' (' + i + ')' + ext;
      try { await dir.getFileHandle(cand); }
      catch (e) { return cand; }   // 取不到 = 不存在 = 这个能用
    }
    return base + ' (' + Date.now() + ')' + ext;
  }
  // ---- 统一落盘入口：所有导出 / 备份都走这里 ----
  // Web 平台刻意不允许网页自行决定保存路径（防静默写盘），只有 File System Access
  // 拿到用户亲手授权过的目录句柄才能直写。所以：
  //   有句柄  → 直接写进那个文件夹（不再走浏览器下载）
  //   无句柄  → 退回下载，并明确告诉用户去哪儿找、怎么固定位置
  async function saveFile(name, text, type, opts) {
    const o = opts || {};
    const safe = sanitizeFilename(name);
    if (dirPickerSupported()) {
      let dir = null;
      try {
        dir = await getBackupDir();
        if (dir && !(await withTimeout(ensureDirPermission(dir), 1200, false))) dir = null;
      } catch (e) { dir = null; }
      if (dir) {
        try {
          const target = o.overwrite ? safe : await uniqueFileName(dir, safe);
          await writeToDir(dir, target, text);
          return { where: 'folder', dir: dir.name || '所选文件夹', name: target, renamed: target !== safe };
        } catch (e) {
          // 写失败（权限被撤、文件被占用、句柄过期）→ 降级下载，但把原因说清楚
          o.fallbackReason = (e && e.message) ? e.message : String(e);
        }
      }
    }
    downloadFile(safe, text, type || 'text/plain;charset=utf-8');
    return { where: 'download', dir: '浏览器下载文件夹', name: safe, renamed: safe !== name, reason: o.fallbackReason || '' };
  }
  // 保存结果 → 一句用户看得懂的话
  function saveResultToast(r, verb) {
    const v = verb || '已保存';
    if (r.where === 'folder') {
      return '✅ ' + v + '到文件夹「' + r.dir + '」／' + r.name + (r.renamed ? '（重名已自动编号）' : '');
    }
    return '⬇ ' + v + '，但走的是浏览器下载 → 请到「下载」文件夹找 ' + r.name +
      (r.reason ? '（写入文件夹失败：' + r.reason + '）' : '') +
      '\n要固定存放位置：数据 ▾ → 📂 设置保存文件夹（选一次，以后都写进去）';
  }
  function backupStamp() {
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  }
  function buildBackupPayload() {
    const data = {};
    collectAppKeys().forEach(k => { data[k] = localStorage.getItem(k); });
    return { app: 'english-reader-backup', version: 2, createdAt: new Date().toISOString(), data };
  }
  function backupSizeText(payload) {
    const bytes = JSON.stringify(payload).length;
    return bytes > 1048576 ? (bytes / 1048576).toFixed(2) + ' MB' : (bytes / 1024).toFixed(0) + ' KB';
  }
  function backupLogList() { return parseLS(BACKUP_LOG_KEY, []); }
  function logBackup(entry) {
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(BACKUP_LOG_KEY) || '[]'); } catch (e) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    arr.push(entry);
    try { localStorage.setItem(BACKUP_LOG_KEY, JSON.stringify(arr.slice(-12))); } catch (e) {}
  }
  async function writeToDir(dirHandle, name, text) {
    const fh = await dirHandle.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
    return fh;
  }
  // 主入口：有已记目录就直接写；没有就先让用户挑一次目录；不支持则走浏览器下载
  async function backupAllData() {
    let payload, name, text;
    try {
      payload = buildBackupPayload();
      name = 'reader-backup-' + backupStamp() + '.json';
      text = JSON.stringify(payload, null, 2);
    } catch (e) {
      showTopToast('备份失败：' + (e && e.message ? e.message : '未知错误'));
      return;
    }
    // 备份与导出共用一条落盘路径；唯一区别是「没设过文件夹时先弹一次选择器」
    // （备份是低频、明确的数据安全动作，值得打断一次；导出天天用，不适合每次弹）
    if (dirPickerSupported()) {
      let dir = null;
      try { dir = await getBackupDir(); } catch (e) { dir = null; }
      if (dir && !(await ensureDirPermission(dir))) dir = null;
      if (!dir) {
        try { dir = await pickBackupDir(); }
        catch (e) {
          if (e && e.name === 'AbortError') { showTopToast('已取消备份'); return; }
          dir = null;
        }
      }
    }
    const r = await saveFile(name, text, 'application/json;charset=utf-8');
    // 备份固定覆盖同一分钟的重名文件（saveFile 默认改名为 xxx (2).json —— 备份宁可多留一份也不覆盖）
    try { localStorage.setItem('wsj_reader:lastBackupAt', JSON.stringify(new Date().toISOString())); } catch (e) {}
    logBackup({ at: new Date().toISOString(), file: r.name,
      where: r.where === 'folder' ? 'folder' : 'download',
      dir: r.where === 'folder' ? r.dir : '浏览器下载文件夹',
      size: backupSizeText(payload), keys: Object.keys(payload.data).length });
    if (r.where === 'folder') showTopToast('✅ 已备份到文件夹「' + r.dir + '」／' + r.name + '（下次一键备份到同一处）', 5200);
    else showTopToast(saveResultToast(r, '已备份') + (r.reason ? '' : '\n（备份是低频操作，建议先选一次文件夹）'), 7000);
  }
  // 备份提醒：有积累数据且超过设定天数没备份时，打开文章页温和提示一次
  function maybeRemindBackup() {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf('annotations:') !== 0) continue;
      try {
        const arr = JSON.parse(localStorage.getItem(k) || '[]');
        if (Array.isArray(arr)) total += arr.length;
      } catch (e) {}
    }
    if (total === 0) return;
    const last = parseLS('wsj_reader:lastBackupAt', null);
    const ageDays = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : Infinity;
    if (ageDays < 7) return;
    const when = last ? '上次备份 ' + fmtDate(last) : '还没有备份过';
    showTopToast('💾 已积累 ' + total + ' 条标注（' + when + '）。建议备份：💾 数据 ▾ → 备份全部数据', 4500);
  }
  async function listDirBackups(dirHandle) {
    const out = [];
    if (!dirHandle || !dirHandle.values) return out;
    try {
      for await (const entry of dirHandle.values()) {
        if (entry.kind !== 'file') continue;
        const n = entry.name || '';
        if (!/\.json$/i.test(n)) continue;
        if (!/reader-backup|reader-export|^backup/i.test(n) && !/backup/i.test(n)) continue;
        let meta = { name: n };
        try { const fh = await entry.getFile(); meta.size = fh.size; meta.lastModified = fh.lastModified; } catch (e) {}
        out.push(meta);
      }
    } catch (e) {}
    out.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
    return out.slice(0, 20);
  }
  function applyBackupPayload(payload) {
    Object.keys(payload.data).forEach(k => {
      try { localStorage.setItem(k, payload.data[k]); } catch (e) {}
    });
  }
  function validateBackupPayload(obj) {
    return !!(obj && obj.app === 'english-reader-backup' && typeof obj.data === 'object' && obj.data !== null);
  }
  async function restoreFromText(text, label) {
    let payload;
    try { payload = JSON.parse(text); } catch (e) { showTopToast('恢复失败：文件解析错误'); return; }
    if (!validateBackupPayload(payload)) { showTopToast('恢复失败：不是本阅读器的备份文件'); return; }
    const n = Object.keys(payload.data).length;
    if (!confirm('将用「' + label + '」恢复 ' + n + ' 项数据，并覆盖当前浏览器中的同名数据（标注/概要/翻译/设置/考试记录等）。\n确定继续？')) return;
    applyBackupPayload(payload);
    showTopToast('恢复成功，即将刷新');
    setTimeout(() => location.reload(), 800);
  }
  async function restoreFromDirHandle(fh, name) {
    try {
      const file = await fh.getFile();
      restoreFromText(await file.text(), name);
    } catch (e) {
      showTopToast('读取备份文件失败：' + (e && e.message ? e.message : e));
    }
  }
  // 「从文件恢复」兜底：原生文件选择器（任何浏览器都能用）
  let restoreFileInput = null;
  function setupRestoreInput() {
    if (restoreFileInput) return;
    restoreFileInput = document.createElement('input');
    restoreFileInput.type = 'file';
    restoreFileInput.accept = '.json,application/json';
    restoreFileInput.style.display = 'none';
    document.body.appendChild(restoreFileInput);
    restoreFileInput.addEventListener('change', () => {
      const file = restoreFileInput.files && restoreFileInput.files[0];
      restoreFileInput.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => restoreFromText(String(reader.result), file.name);
      reader.onerror = () => showTopToast('恢复失败：无法读取文件');
      reader.readAsText(file, 'utf-8');
    });
  }
  function restoreData() {
    setupRestoreInput();
    restoreFileInput.click();
  }
  // 备份记录面板：现在备份去哪了 + 历史 + 从文件夹里挑一份恢复
  async function openBackupPanel() {
    closeAllMenus();
    const old = document.getElementById('backup-overlay');
    if (old) old.remove();
    const dir = await getBackupDir();
    const dirName = dir ? (dir.name || '已选文件夹') :
      (parseLS(BACKUP_DIR_NAME_KEY, '') || (dirPickerSupported() ? '未设置（备份时会让你选一次）' : '当前浏览器不支持选文件夹'));
    const files = dir && await ensureDirPermission(dir) ? await listDirBackups(dir) : [];
    const last = parseLS('wsj_reader:lastBackupAt', null);
    const logs = backupLogList().slice().reverse();
    let keys = 0, annoTotal = 0;
    try {
      collectAppKeys().forEach(k => {
        keys++;
        if (k.indexOf('annotations:') === 0) {
          try { const a = JSON.parse(localStorage.getItem(k) || '[]'); if (Array.isArray(a)) annoTotal += a.length; } catch (e) {}
        }
      });
    } catch (e) {}
    const overlay = document.createElement('div');
    overlay.className = 'backup-overlay';
    overlay.id = 'backup-overlay';
    overlay.innerHTML =
      '<div class="backup-box">' +
      '<div class="bk-head"><h3>💾 备份与恢复</h3><button type="button" class="bk-close" title="关闭">✕</button></div>' +
      '<div class="bk-facts">' +
      '<div><span class="bk-k">本机数据</span><span class="bk-v">' + keys + ' 项 key · ' + annoTotal + ' 条标注</span></div>' +
      '<div><span class="bk-k">上次备份</span><span class="bk-v">' + (last ? esc(fmtDate(last)) + ' ' + esc(fmtTimeHM(last)) : '从未备份') + '</span></div>' +
      '<div><span class="bk-k">备份文件夹</span><span class="bk-v">' + esc(dirName) + (dir ? '' : '（尚未选择）') + '</span></div>' +
      '</div>' +
      '<div class="bk-actions">' +
      '<button type="button" class="bk-btn primary" data-act="backup">备份全部数据</button>' +
      '<button type="button" class="bk-btn" data-act="pickdir">' + (dir ? '更换备份文件夹' : '选择备份文件夹') + '</button>' +
      '<button type="button" class="bk-btn" data-act="file">从文件恢复…</button>' +
      '</div>' +
      (files.length ? '<div class="bk-label">文件夹内的备份（点「恢复」写回本机）</div><div class="bk-files">' +
        files.map((f, i) => '<div class="bk-file"><span class="bk-fname">' + esc(f.name) + '</span>' +
          '<span class="bk-fmeta">' + (f.size ? (f.size / 1024).toFixed(0) + ' KB · ' : '') +
          (f.lastModified ? esc(fmtDate(new Date(f.lastModified).toISOString())) : '') + '</span>' +
          '<button type="button" class="bk-mini" data-restore="' + i + '">恢复</button></div>').join('') + '</div>'
        : (dir ? '<div class="bk-label">文件夹内暂无备份文件</div>' : '')) +
      '<div class="bk-label">本机备份记录（最近 ' + logs.length + ' 次）</div>' +
      (logs.length ? '<div class="bk-log">' + logs.map(l =>
        '<div class="bk-logrow"><span>' + esc((l.at || '').replace('T', ' ').slice(0, 16)) + '</span>' +
        '<span class="bk-file2">' + esc(l.file || '') + '</span>' +
        '<span class="bk-fmeta">' + esc(l.where === 'folder' ? '📁 ' + (l.dir || '') : '⬇ ' + (l.dir || '下载')) +
        (l.size ? ' · ' + esc(l.size) : '') + '</span></div>').join('') + '</div>'
        : '<div class="bk-fmeta">还没有备份记录</div>') +
      '<div class="bk-note">恢复会覆盖当前浏览器里的同名数据，只影响这台电脑这个浏览器；换电脑请先备份再恢复。</div>' +
      '</div>';
    document.body.appendChild(overlay);
    if (dir) {
      overlay.querySelectorAll('[data-restore]').forEach(btn => {
        const target = files[btn.dataset.restore];
        btn.addEventListener('click', async () => {
          let fh = null;
          try { fh = await dir.getFileHandle(target.name); } catch (e) {}
          if (fh) restoreFromDirHandle(fh, target.name);
          else showTopToast('找不到该备份文件');
        });
      });
    }
    overlay.querySelector('.bk-close').addEventListener('click', closeBackupPanel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeBackupPanel(); });
    overlay.querySelector('[data-act="backup"]').addEventListener('click', () => { backupAllData().then(closeBackupPanel); });
    overlay.querySelector('[data-act="pickdir"]').addEventListener('click', async () => {
      if (!dirPickerSupported()) { showTopToast('当前浏览器不支持选择文件夹，备份会走下载'); return; }
      try { await pickBackupDir(); showTopToast('已记住备份文件夹，下次直接写进去'); closeBackupPanel(); openBackupPanel(); }
      catch (e) { if (e && e.name !== 'AbortError') showTopToast('选择文件夹失败：' + (e && e.message ? e.message : e)); }
    });
    overlay.querySelector('[data-act="file"]').addEventListener('click', () => { closeBackupPanel(); restoreData(); });
  }
  function closeBackupPanel() {
    const o = document.getElementById('backup-overlay');
    if (o) o.remove();
  }
  // 「设置保存文件夹」：把所有导出动作的落点从「浏览器下载文件夹」改到用户指定的文件夹
  function openSaveDirDialog() {
    closeAllMenus();
    const old = document.getElementById('save-dir-overlay');
    if (old) old.remove();
    const saved = parseLS(BACKUP_DIR_NAME_KEY, '');
    const sup = dirPickerSupported();
    const overlay = document.createElement('div');
    overlay.className = 'backup-overlay';
    overlay.id = 'save-dir-overlay';
    overlay.innerHTML =
      '<div class="backup-box">' +
      '<div class="bk-head"><h3>📂 文件保存位置</h3><button type="button" class="bk-close" title="关闭">✕</button></div>' +
      '<div class="bk-facts">' +
      '<div><span class="bk-k">当前</span><span class="bk-v">' +
      esc(saved || (sup ? '未设置 —— 导出会进浏览器默认的「下载」文件夹' : '浏览器不支持，只能用「下载」文件夹')) +
      (saved && backupDirVolatile() ? '（本机存不住句柄，重开页面后要重选一次）' : '') + '</span></div>' +
      '<div><span class="bk-k">会跟着变的</span><span class="bk-v">Markdown 笔记 / JSON / 生词 CSV / 作文 / 模板 / 同义表 / 全部数据备份</span></div>' +
      '</div>' +
      '<div class="bk-actions">' +
      (sup ? '<button type="button" class="bk-btn primary" data-act="pick">' + (saved ? '更换文件夹' : '选择文件夹') + '</button>' : '') +
      (saved ? '<button type="button" class="bk-btn" data-act="forget">清除保存位置</button>' : '') +
      '<button type="button" class="bk-btn" data-act="close">关闭</button>' +
      '</div>' +
      '<div class="bk-note">浏览器出于安全不允许网页自己决定保存路径（否则任何网页都能往你的磁盘里塞文件），' +
      '所以只能由你亲手选一次。选过之后本机记住这个文件夹，之后所有导出与备份都直接写进去，不再走下载。' +
      (sup ? '' : '<br>当前浏览器不支持选文件夹：可到浏览器「设置 → 下载」里改默认下载目录作为替代。') +
      '</div></div>';
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    const refreshLabel = () => {
      const btn = document.getElementById('save-dir-btn');
      if (!btn) return;
      const spans = btn.querySelectorAll('span');
      if (spans[1]) spans[1].textContent = saveDirMenuLabel();
    };
    overlay.querySelector('.bk-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const pick = overlay.querySelector('[data-act="pick"]');
    if (pick) pick.addEventListener('click', async () => {
      try {
        const h = await pickBackupDir();   // 必须在点击的手势里调用
        showTopToast('✅ 保存位置已设为「' + (h.name || '所选文件夹') + '」——之后导出与备份都直接写进去', 5200);
        refreshLabel();
        close();
      } catch (e) {
        if (e && e.name !== 'AbortError') showTopToast('选择文件夹失败：' + (e && e.message ? e.message : e));
      }
    });
    const forget = overlay.querySelector('[data-act="forget"]');
    if (forget) forget.addEventListener('click', () => {
      if (!confirm('清除保存位置？之后导出会重新回到浏览器默认下载文件夹（已保存的文件不受影响）。')) return;
      forgetBackupDir();
      showTopToast('已清除保存位置，导出将回到浏览器下载文件夹');
      refreshLabel();
      close();
    });
    overlay.querySelector('[data-act="close"]').addEventListener('click', close);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('backup-overlay')) closeBackupPanel();
  });

  // ===== UX-7: Undo for contenteditable edits =====
  const EDIT_UNDO_CAP = 50;
  let editUndoStack = [];      // [{ el, html }] checkpoints, capped at EDIT_UNDO_CAP
  let editBaseline = null;     // { el, html } state at focus / last checkpoint
  let editCheckpointTimer = null;
  function pushUndoSnapshot(el, html) {
    const top = editUndoStack[editUndoStack.length - 1];
    if (top && top.el === el && top.html === html) return; // no duplicate states
    editUndoStack.push({ el: el, html: html });
    if (editUndoStack.length > EDIT_UNDO_CAP) editUndoStack.shift();
  }
  function flushEditBaseline() {
    clearTimeout(editCheckpointTimer);
    if (!editBaseline) return;
    const el = editBaseline.el;
    const html = editBaseline.html;
    editBaseline = null;
    if (el && el.isConnected && el.innerHTML !== html) pushUndoSnapshot(el, html);
  }
  function setupEditUndo() {
    document.addEventListener('focusin', (e) => {
      const el = e.target;
      if (!el || !el.getAttribute || el.getAttribute('contenteditable') !== 'true') return;
      flushEditBaseline();
      editBaseline = { el: el, html: el.innerHTML };
    });
    document.addEventListener('focusout', (e) => {
      if (editBaseline && editBaseline.el === e.target) flushEditBaseline();
    });
    document.addEventListener('input', (e) => {
      if (!editBaseline || e.target !== editBaseline.el) return;
      clearTimeout(editCheckpointTimer);
      editCheckpointTimer = setTimeout(() => {
        if (!editBaseline) return;
        const el = editBaseline.el;
        if (el.isConnected && el.innerHTML !== editBaseline.html) {
          pushUndoSnapshot(el, editBaseline.html);
          editBaseline.html = el.innerHTML; // new baseline for the next checkpoint
        }
      }, 1000);
    });
  }
  function undoEdit() {
    flushEditBaseline(); // capture the in-progress edit before popping
    let snap = null;
    while (editUndoStack.length > 0) {
      const s = editUndoStack.pop();
      if (s && s.el && s.el.isConnected) { snap = s; break; }
    }
    if (!snap) { showTopToast('没有可撤销的编辑'); return; }
    snap.el.innerHTML = snap.html;
    // Notify persistence handlers bound to 'input' (qfields, note edits)
    snap.el.dispatchEvent(new Event('input', { bubbles: true }));
    // 概要/主旨字段只在 blur 时持久化——撤销后必须手动同步 summaryData，
    // 否则刷新页面会复活刚被撤销的文本（key 计算与 initSummary 共用 summaryKeyFor）
    if (snap.el.hasAttribute && snap.el.hasAttribute('data-default')) {
      const sKey = summaryKeyFor(snap.el);
      if (sKey) { summaryData[sKey] = snap.el.textContent.trim(); saveSummary(); }
    }
    // CN translation paragraphs persist on blur, not input — sync manually
    if (snap.el.classList && snap.el.classList.contains('cn-translatable')) {
      const key = 'para-' + snap.el.dataset.paraIdx;
      const txt = snap.el.textContent.trim();
      translationData[key] = txt;
      saveTranslation();
      snap.el.classList.toggle('cn-edited', txt !== snap.el.dataset.default);
      updateTransCount();
    }
    showTopToast('已撤销');
  }
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'Z' || e.key === 'z')) {
      e.preventDefault();
      undoEdit();
    }
  });

  // ===== UX-4: Shortcuts help modal =====
  function openShortcutsHelp() {
    if (document.getElementById('shortcuts-overlay')) return;
    // Compiled from the actual keydown handlers in this file
    const rows = [
      ['<kbd>Ctrl</kbd> + <kbd>F</kbd>', '打开全文搜索 / 聚焦搜索框'],
      ['<kbd>Enter</kbd>', '搜索：跳到下一个结果'],
      ['<kbd>Shift</kbd> + <kbd>Enter</kbd>', '搜索：跳到上一个结果'],
      ['<kbd>Esc</kbd>', '关闭搜索面板 / 关闭本弹窗'],
      ['<kbd>↑</kbd> / <kbd>↓</kbd>', '标注跳转：上一个 / 下一个（笔记面板展开且不在输入框中）'],
      ['<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd>', '撤销编辑（可连续撤销）'],
      ['<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd>', '打开诊断面板'],
      ['<kbd>Shift</kbd> + 点击高亮', '删除该条标注']
    ];
    const overlay = document.createElement('div');
    overlay.className = 'shortcuts-overlay';
    overlay.id = 'shortcuts-overlay';
    overlay.innerHTML = '<div class="shortcuts-box"><h3>⌨ 快捷键</h3><table><tbody>' +
      rows.map(r => '<tr><td class="k">' + r[0] + '</td><td>' + esc(r[1]) + '</td></tr>').join('') +
      '</tbody></table><button class="sc-close" type="button">关闭</button></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.sc-close').addEventListener('click', closeShortcutsHelp);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeShortcutsHelp(); });
  }
  function closeShortcutsHelp() {
    const o = document.getElementById('shortcuts-overlay');
    if (o) o.remove();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('shortcuts-overlay')) closeShortcutsHelp();
  });

  // ===== UX-3: Mobile column switch bar (CSS hides it above 860px) =====
  function setupMobileColBar() {
    if (document.querySelector('.mobile-col-bar')) return;
    const bar = document.createElement('div');
    bar.className = 'mobile-col-bar';
    const modes = [['en', '英文'], ['cn', '中文'], ['both', '双语'], ['sum', '概要']];
    modes.forEach((mo) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.mode = mo[0];
      b.textContent = mo[1];
      b.addEventListener('click', () => setMobileMode(mo[0]));
      bar.appendChild(b);
    });
    document.body.appendChild(bar);
    setMobileMode(settings.mobileMode || 'both');
  }
  function setMobileMode(mode) {
    if (['en', 'cn', 'both', 'sum'].indexOf(mode) < 0) mode = 'both';
    const wrap = document.querySelector('.main-wrap');
    if (wrap) {
      ['m-en', 'm-cn', 'm-both', 'm-sum'].forEach(c => wrap.classList.remove(c));
      wrap.classList.add('m-' + mode);
    }
    document.querySelectorAll('.mobile-col-bar button[data-mode]').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    settings.mobileMode = mode;
    saveSettings();
  }
