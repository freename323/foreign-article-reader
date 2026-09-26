  // ===== 精读分析台（错题本 / 能力雷达 / 段落功能 / 生词网络）=====
  //
  // ⚠ 这一组功能全部**复用既有存储**，不新建并行数据源：
  //   · 错题本读既有的 4 个错题库（wsj_exam / wsj_cloze / wsj_newtype / wsj_translation），
  //     只额外加一个「复习调度」侧车键（wsj_wrongrev），不动既有记录的字段；
  //   · 能力雷达直接聚合 wsj_exam:history 里的 perQ[].type —— 每道题的题型早已逐题落库；
  //   · 段落功能走既有 annotations:<articleId>，新增一个 bucket='paraFunc'；
  //   · 生词网络从 registry + annotations:<篇> 现场推导，**不建 vocab:index 索引**（避免第二份真相）。
  //
  // ⚠ 编号 11 只是模块序号；它必须排在 10-toolbar.js **之前**（后者负责收尾并定义 window.__reader）。

  // ---------- 小工具 ----------
  function insToday() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function insAddDays(n) {
    const d = new Date(); d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function insLoad(key, fb) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
  function insSave(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
  function insRegistry() { return insLoad('wsj_reader:registry', []) || []; }
  // registry 的 id 就是**页面文件名**（这一点全项目一致，别换成 slug）
  function insTitleOf(fileId) {
    const r = insRegistry().find(x => x.id === fileId);
    if (r && r.title) return r.title;
    if (fileId === articleId) return getShortTitle();
    return String(fileId || '').replace(/_EN-CN_final\.html$/, '').replace(/_/g, ' ');
  }
  function insSlugOf(fileId) {
    const r = insRegistry().find(x => x.id === fileId);
    return (r && r.slug) || (fileId === articleId ? articleMeta.slug : '');
  }
  function insPageUrl(fileId) {
    return location.pathname.replace(/[^/]+$/, '') + fileId;
  }

  // ---------- 通用浮层面板（沿用 .syntax-panel 基类 + .visible，与既有面板同一套皮肤）----------
  function insPanel(id, title, extraHead) {
    let p = document.getElementById(id);
    if (p) return p;
    p = document.createElement('div');
    p.id = id;
    p.className = 'syntax-panel insight-panel';
    p.innerHTML =
      '<div class="syntax-header"><h3>' + esc(title) + '</h3>' +
      '<button type="button" data-close="1" title="关闭">✕</button></div>' +
      '<div class="insight-body" id="' + id + '-body"></div>' +
      '<div class="syntax-actions">' + (extraHead || '') +
      '<button type="button" data-close="1">关闭</button></div>';
    document.body.appendChild(p);
    p.querySelectorAll('[data-close]').forEach(b =>
      b.addEventListener('click', () => p.classList.remove('visible')));
    return p;
  }
  function insOpen(p) { p.classList.add('visible'); }

  // ==========================================================================
  // F04 错题本 + 间隔重复
  // ==========================================================================
  // 4 个错题库各自独立（历史遗留），这里做一层**只读适配**合并成统一视图。
  // 只有「阅读理解」的库里带题干与选项（exam.js 写入），因此只有它能就地重做；
  // 其余三类给出「回原练习页重做」的跳转 —— 不假装能重做。
  const WRONG_STORES = [
    { key: 'wsj_exam:wrongs', label: '阅读理解', page: s => 'exam_' + s + '.html' },
    { key: 'wsj_cloze:wrongs', label: '完形填空', page: s => 'cloze_' + s + '.html' },
    { key: 'wsj_newtype:wrongs', label: '新题型', page: s => 'newtype_' + s + '.html' },
    { key: 'wsj_translation:wrongs', label: '翻译', page: s => 'translation_' + s + '.html' }
  ];
  const WRONG_CAUSES = {
    vocab: '词汇', syntax: '长难句', logic: '逻辑', qtype: '题型', careless: '粗心', trans: '误译',
    location: '定位错误', trap: '干扰项陷阱', 语境词: '语境词', 误译: '误译', 粗心: '粗心'
  };
  const WRONG_REV_KEY = 'wsj_wrongrev';     // 侧车：{ '<store>|<key>': {n, nextDue, last, done} }
  // 间隔序列（与项目既有复习语义对齐：答错回 1 天，答对逐步拉长）
  const WRONG_STEPS = [1, 2, 4, 8, 16];
  const WRONG_MASTER_N = 3;

  function wrongRevAll() { return insLoad(WRONG_REV_KEY, {}) || {}; }
  function wrongRevKey(store, key) { return store + '|' + String(key || ''); }
  function wrongRevOf(w) { return wrongRevAll()[wrongRevKey(w.store, w.key)] || null; }
  // 复习调度：答对递进、答错归零；连对 WRONG_MASTER_N 次标「已掌握」并移出队列
  // （说明书写的「连对 2 次」太松 —— 错题只隔一天答对两次就出列，等于没复习；
  //   项目既有的题型卡复习在「已掌握」后仍按 15 天复看，这里取折中：3 次出列但记录保留）
  function wrongSchedule(w, wasCorrect) {
    const all = wrongRevAll();
    const k = wrongRevKey(w.store, w.key);
    const r = all[k] || { n: 0, nextDue: insToday(), last: null, done: false };
    if (wasCorrect) {
      r.n = (r.n || 0) + 1;
      if (r.n >= WRONG_MASTER_N) { r.done = true; r.nextDue = ''; }
      else r.nextDue = insAddDays(WRONG_STEPS[Math.min(r.n, WRONG_STEPS.length - 1)]);
    } else {
      r.n = 0; r.done = false; r.nextDue = insAddDays(1);
    }
    r.last = new Date().toISOString();
    all[k] = r; insSave(WRONG_REV_KEY, all);
    return r;
  }
  function collectWrongs() {
    const out = [];
    WRONG_STORES.forEach(st => {
      (insLoad(st.key, []) || []).forEach(r => {
        if (!r || !r.key) return;
        const rev = wrongRevOf({ store: st.key, key: r.key });
        out.push({
          store: st.key, storeLabel: st.label, key: r.key, page: st.page,
          slug: r.slug || '', title: r.title || insTitleOf('') ,
          no: r.no, type: r.type || r.kind || '', mode: r.mode || '',
          myAnswer: r.myAnswer || '', answer: r.answer || '', cause: r.cause || '',
          at: r.at || '', stem: r.stem || '', options: r.options || {},
          analysis: r.analysis || '', refs: r.refs || [],
          rev: rev, due: !rev || (!rev.done && (!rev.nextDue || rev.nextDue <= insToday())),
          redo: !!(r.stem && r.options && Object.keys(r.options).length)
        });
      });
    });
    out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return out;
  }
  // 供 07-wordfreq.js 的 dueReviewCount() 合并统计（工具栏角标同时算生词与错题）
  function dueWrongCount() {
    return collectWrongs().filter(w => !w.rev || (!w.rev.done && w.rev.nextDue && w.rev.nextDue <= insToday())).length;
  }
  function wrongStats(list) {
    let due = 0, done = 0, fresh = 0;
    list.forEach(w => {
      if (w.rev && w.rev.done) { done++; return; }
      if (!w.rev || !w.rev.last) fresh++;
      if (w.due) due++;
    });
    return { total: list.length, due: due, done: done, fresh: fresh };
  }
  let wrongFilter = { scope: 'due', type: '', cause: '' };
  function openWrongBook() {
    const p = insPanel('wrongbook-panel', '📕 错题本');
    insOpen(p);
    renderWrongBook();
    // 首次绑事件（渲染是整块重建，用事件委托一次绑好）
    const body = document.getElementById('wrongbook-panel-body');
    if (!body.dataset.wired) {
      body.dataset.wired = '1';
      body.addEventListener('click', e => {
        const t = e.target;
        const scope = t.closest && t.closest('[data-wscope]');
        if (scope) { wrongFilter.scope = scope.dataset.wscope; renderWrongBook(); return; }
        const redo = t.closest && t.closest('[data-wredo]');
        if (redo) { startWrongRedo(redo.dataset.wredo); return; }
        const pick = t.closest && t.closest('[data-wpick]');
        if (pick) { submitWrongRedo(pick.dataset.wpick, pick.dataset.wopt); return; }
        const back = t.closest && t.closest('[data-wback]');
        if (back) { renderWrongBook(); return; }
      });
      body.addEventListener('change', e => {
        const t = e.target;
        if (t && t.dataset && t.dataset.wfilter === 'type') { wrongFilter.type = t.value; renderWrongBook(); }
        if (t && t.dataset && t.dataset.wfilter === 'cause') { wrongFilter.cause = t.value; renderWrongBook(); }
      });
    }
  }
  let wrongRedoUid = null;
  function renderWrongBook() {
    const body = document.getElementById('wrongbook-panel-body');
    if (!body) return;
    const all = collectWrongs();
    const s = wrongStats(all);
    const types = Array.from(new Set(all.map(w => w.type).filter(Boolean))).sort();
    const causes = Array.from(new Set(all.map(w => w.cause).filter(Boolean)));
    let list = all;
    if (wrongFilter.scope === 'due') list = all.filter(w => w.due);
    else if (wrongFilter.scope === 'done') list = all.filter(w => w.rev && w.rev.done);
    if (wrongFilter.type) list = list.filter(w => w.type === wrongFilter.type);
    if (wrongFilter.cause) list = list.filter(w => w.cause === wrongFilter.cause);

    const chip = (val, cur, attr, label) =>
      '<button type="button" class="ins-chip' + (val === cur ? ' active' : '') + '" ' + attr + '="' + esc(val) + '">' +
      esc(label) + '</button>';

    let html =
      '<div class="ins-kpi">' +
      '<div class="ins-kpi-item"><b>' + s.total + '</b><span>总错题</span></div>' +
      '<div class="ins-kpi-item hot"><b>' + s.due + '</b><span>待复习</span></div>' +
      '<div class="ins-kpi-item"><b>' + s.done + '</b><span>已掌握</span></div>' +
      '<div class="ins-kpi-item"><b>' + s.fresh + '</b><span>未复习过</span></div>' +
      '</div>' +
      '<div class="ins-filters">' +
      chip('due', wrongFilter.scope, 'data-wscope', '待复习') +
      chip('all', wrongFilter.scope, 'data-wscope', '全部') +
      chip('done', wrongFilter.scope, 'data-wscope', '已掌握') +
      (types.length ? '<select data-wfilter="type"><option value="">题型：全部</option>' +
        types.map(t => '<option value="' + esc(t) + '"' + (t === wrongFilter.type ? ' selected' : '') + '>' + esc(t) + '</option>').join('') +
        '</select>' : '') +
      (causes.length ? '<select data-wfilter="cause"><option value="">错因：全部</option>' +
        causes.map(t => '<option value="' + esc(t) + '"' + (t === wrongFilter.cause ? ' selected' : '') + '>' +
          esc(WRONG_CAUSES[t] || t) + '</option>').join('') +
        '</select>' : '') +
      '</div>';

    if (!list.length) {
      html += '<div class="ins-empty">' +
        (all.length ? '当前筛选下没有错题。' :
          '还没有错题记录。<br><span class="ins-dim">做完一篇模拟考试，答错的题会自动进这里，并按间隔重复安排复习。</span>') +
        '</div>';
    } else {
      html += '<div class="ins-list">' + list.map(w => {
        const uid = esc(wrongRevKey(w.store, w.key));
        const rev = w.rev || {};
        const when = rev.last ? String(rev.last).replace('T', ' ').slice(0, 16) : '未复习';
        const state = rev.done ? '<span class="ins-tag ok">已掌握</span>'
          : (rev.nextDue ? '<span class="ins-tag' + (w.due ? ' due' : '') + '">' + (w.due ? '今日到期' : rev.nextDue + ' 复习') + '</span>' : '<span class="ins-tag">未开始</span>');
        return '<div class="ins-row">' +
          '<div class="ins-row-main">' +
          '<div class="ins-row-title">' +
          '<span class="ins-tag type">' + esc(w.storeLabel) + '</span>' +
          (w.type ? '<span class="ins-tag">' + esc(w.type) + '</span>' : '') +
          (w.cause ? '<span class="ins-tag cause">' + esc(WRONG_CAUSES[w.cause] || w.cause) + '</span>' : '') +
          state +
          '</div>' +
          '<div class="ins-row-sub">' + esc(w.title || w.slug) + ' · 第 ' + esc(w.no) + ' 题' +
          (w.myAnswer ? ' · 你选 ' + esc(w.myAnswer) : '') + (w.answer ? ' · 正确 ' + esc(w.answer) : '') +
          ' · ' + esc(when) + (rev.n ? ' · 连对 ' + rev.n + ' 次' : '') + '</div>' +
          (w.stem ? '<div class="ins-row-stem">' + esc(String(w.stem).slice(0, 160)) + '</div>' : '') +
          '</div>' +
          '<div class="ins-row-act">' +
          (w.redo ? '<button type="button" class="ins-btn" data-wredo="' + uid + '">重做</button>' : '') +
          (w.slug ? '<a class="ins-btn ghost" href="' + esc(w.page(w.slug)) + '" title="回到原练习页">原题</a>' : '') +
          '</div>' +
          '</div>';
      }).join('') + '</div>';
    }
    if (wrongRedoUid) html = renderWrongRedoHTML(all.find(w => wrongRevKey(w.store, w.key) === wrongRedoUid));
    body.innerHTML = html;
  }
  function startWrongRedo(uid) {
    wrongRedoUid = uid;
    renderWrongBook();
    const body = document.getElementById('wrongbook-panel-body');
    if (body) body.scrollTop = 0;
  }
  function renderWrongRedoHTML(w) {
    if (!w) { wrongRedoUid = null; return '<div class="ins-empty">找不到这道题。</div>'; }
    const opts = Object.keys(w.options || {});
    return '<div class="ins-redo">' +
      '<div class="ins-redo-head">' +
      '<span class="ins-tag type">' + esc(w.storeLabel) + '</span>' +
      '<b>' + esc(w.title || w.slug) + '</b><span class="ins-dim">第 ' + esc(w.no) + ' 题</span>' +
      '</div>' +
      '<div class="ins-redo-stem">' + esc(w.stem) + '</div>' +
      '<div class="ins-redo-opts">' + opts.map(k =>
        '<button type="button" class="ins-opt" data-wpick="' + esc(wrongRevKey(w.store, w.key)) + '" data-wopt="' + esc(k) + '">' +
        '<b>' + esc(k) + '</b>' + esc(String(w.options[k]).replace(/^\s*[A-D][.、)]\s*/, '')) + '</button>').join('') +
      '</div>' +
      '<div class="ins-dim">答案已遮罩 —— 先自己判断，再点选项。提交后按间隔重复安排下次复习。</div>' +
      '<div class="ins-actions"><button type="button" class="ins-btn ghost" data-wback="1">返回列表</button></div>' +
      '</div>';
  }
  function submitWrongRedo(uid, pick) {
    const w = collectWrongs().find(x => wrongRevKey(x.store, x.key) === uid);
    if (!w) { wrongRedoUid = null; renderWrongBook(); return; }
    const ok = String(pick) === String(w.answer);
    const rev = wrongSchedule(w, ok);
    wrongRedoUid = null;
    renderWrongBook();
    showTopToast(ok
      ? '答对了 · ' + (rev.done ? '已掌握，移出复习队列' : '下次复习 ' + rev.nextDue)
      : '还不对 · 1 天后再来（正确 ' + (w.answer || '—') + '）');
  }

  // ==========================================================================
  // F13 六题型能力雷达图
  // ==========================================================================
  // 数据来自 wsj_exam:history 的 perQ[].type —— 每道题的题型早在交卷时就逐题落库了，
  // **不需要**说明书里的 exam:stats:<articleId> 这种新键。
  const RADAR_TYPES = ['细节', '推理', '主旨', '态度', '词义', '例证'];
  function radarData() {
    const hist = insLoad('wsj_exam:history', []) || [];
    const acc = {};
    RADAR_TYPES.forEach(t => { acc[t] = { total: 0, correct: 0 }; });
    let other = 0, sessions = 0, answered = 0;
    hist.forEach(h => {
      if (!h || !Array.isArray(h.perQ) || !h.perQ.length) return;
      sessions++;
      h.perQ.forEach(q => {
        if (!q || !q.mine) return;                  // 未作答不计入（考试态留空 ≠ 答错）
        answered++;
        const ok = String(q.mine) === String(q.right);
        const t = String(q.type || '').trim();
        if (acc[t]) { acc[t].total++; if (ok) acc[t].correct++; }
        else other++;
      });
    });
    return { acc: acc, other: other, sessions: sessions, answered: answered };
  }
  function radarSvg(acc, size) {
    const N = RADAR_TYPES.length;
    const cx = size / 2, cy = size / 2, R = size * 0.33;
    const pt = (i, r) => {
      const a = -Math.PI / 2 + (Math.PI * 2 * i) / N;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    };
    const ring = k => RADAR_TYPES.map((_, i) => pt(i, R * k).map(v => v.toFixed(1)).join(',')).join(' ');
    const poly = RADAR_TYPES.map((t, i) => {
      const d = acc[t];
      const rate = d.total ? d.correct / d.total : 0;
      return pt(i, Math.max(R * 0.02, R * rate)).map(v => v.toFixed(1)).join(',');
    }).join(' ');
    let s = '<svg class="ins-radar" viewBox="0 0 ' + size + ' ' + size + '" width="100%" role="img" aria-label="六题型正确率雷达图">';
    [0.25, 0.5, 0.75, 1].forEach(k => {
      s += '<polygon points="' + ring(k) + '" fill="none" stroke="currentColor" stroke-opacity="' + (k === 1 ? 0.35 : 0.14) + '" stroke-width="1"/>';
    });
    RADAR_TYPES.forEach((t, i) => {
      const [x, y] = pt(i, R);
      s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) +
        '" stroke="currentColor" stroke-opacity="0.18" stroke-width="1"/>';
      const [lx, ly] = pt(i, R + 26);
      const d = acc[t];
      const pct = d.total ? Math.round(d.correct / d.total * 100) : 0;
      s += '<text x="' + lx.toFixed(1) + '" y="' + (ly - 5).toFixed(1) + '" text-anchor="middle" font-size="12" fill="currentColor">' + esc(t) + '</text>';
      s += '<text x="' + lx.toFixed(1) + '" y="' + (ly + 9).toFixed(1) + '" text-anchor="middle" font-size="11" fill="currentColor" fill-opacity="0.6">' +
        (d.total ? pct + '%' : '—') + '</text>';
    });
    s += '<polygon points="' + poly + '" fill="var(--accent)" fill-opacity="0.22" stroke="var(--accent)" stroke-width="1.5"/>';
    RADAR_TYPES.forEach((t, i) => {
      const d = acc[t];
      if (!d.total) return;
      const [x, y] = pt(i, Math.max(R * 0.02, R * (d.correct / d.total)));
      s += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.6" fill="var(--accent)"/>';
    });
    s += '</svg>';
    return s;
  }
  function openRadar() {
    const p = insPanel('radar-panel', '📡 六题型能力雷达');
    insOpen(p);
    const body = document.getElementById('radar-panel-body');
    if (!body) return;
    const d = radarData();
    let html = '';
    if (!d.answered) {
      html = '<div class="ins-empty">还没有可统计的作答记录。<br>' +
        '<span class="ins-dim">做完任意一篇模拟考试（交卷后）就会按题型统计到这里。</span></div>';
    } else {
      html = '<div class="ins-radar-wrap">' + radarSvg(d.acc, 300) + '</div>' +
        '<div class="ins-kpi">' +
        '<div class="ins-kpi-item"><b>' + d.sessions + '</b><span>考试次数</span></div>' +
        '<div class="ins-kpi-item"><b>' + d.answered + '</b><span>已作答题数</span></div>' +
        (d.other ? '<div class="ins-kpi-item"><b>' + d.other + '</b><span>其他题型</span></div>' : '') +
        '</div>' +
        '<table class="ins-table"><thead><tr><th>题型</th><th>答对 / 作答</th><th>正确率</th><th>薄弱</th></tr></thead><tbody>' +
        RADAR_TYPES.map(t => {
          const x = d.acc[t];
          const rate = x.total ? x.correct / x.total : 0;
          const pct = x.total ? Math.round(rate * 100) : 0;
          return '<tr' + (x.total && pct < 60 ? ' class="weak"' : '') + '><td>' + esc(t) + '</td>' +
            '<td>' + (x.total ? x.correct + ' / ' + x.total : '—') + '</td>' +
            '<td>' + (x.total ? pct + '%' : '—') + '</td>' +
            '<td>' + (x.total && pct < 60 ? '需要加练' : '') + '</td></tr>';
        }).join('') +
        '</tbody></table>' +
        '<div class="ins-dim">数据来源：本地成绩记录（不联网）。未作答的题不计入正确率；只统计六大阅读题型，' +
        '完形 / 新题型 / 翻译的题型另行归类。</div>';
    }
    body.innerHTML = html;
  }

  // ==========================================================================
  // F02 段落功能标签
  // ==========================================================================
  const PARA_FUNCS = [
    ['argument', '论点'], ['evidence', '论据'], ['transition', '转折'],
    ['conclusion', '结论'], ['background', '背景'], ['example', '例证']
  ];
  const PARA_FUNC_MAP = {};
  PARA_FUNCS.forEach(f => { PARA_FUNC_MAP[f[0]] = f[1]; });
  // 一段只保留一个功能标签
  function paraFuncIdxList() {
    const set = new Set();
    document.querySelectorAll('.col-body.en p[data-para-idx]').forEach(p => set.add(String(p.dataset.paraIdx)));
    return Array.from(set).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  }
  function paraFuncOf(idx) {
    const a = annotations.find(x => x.bucket === 'paraFunc' && String(x.paraIdx) === String(idx));
    return a ? a.func : '';
  }
  function setParaFunc(idx, func) {
    annotations = annotations.filter(a => !(a.bucket === 'paraFunc' && String(a.paraIdx) === String(idx)));
    if (func) {
      annotations.push({
        id: genId(), type: 'paraFunc', bucket: 'paraFunc',
        text: '第 ' + idx + ' 段', paraIdx: Number(idx), func: func,
        createdAt: new Date().toISOString()
      });
    }
    saveAnnotations();
    renderParaFuncs();
    showTopToast(func ? '第 ' + idx + ' 段标为「' + (PARA_FUNC_MAP[func] || func) + '」' : '已清除第 ' + idx + ' 段的功能标签');
  }
  // 标签做成「内容为空的 span + CSS content」，这样 textContent 不掺字：
  // 导出 Markdown / 复制正文 / 词频统计都不会把「论点」当成正文。
  function renderParaFuncs() {
    const map = {};
    annotations.forEach(a => { if (a.bucket === 'paraFunc' && a.paraIdx) map[String(a.paraIdx)] = a.func; });
    document.querySelectorAll('.col-body.en p[data-para-idx], .col-body.cn p[data-para-idx]').forEach(p => {
      const idx = String(p.dataset.paraIdx);
      Array.prototype.slice.call(p.querySelectorAll('.pfunc-chip')).forEach(c => c.remove());
      const f = map[idx];
      if (!f) { delete p.dataset.paraFunc; return; }
      p.dataset.paraFunc = f;
      const chip = document.createElement('span');
      chip.className = 'pfunc-chip';
      chip.setAttribute('data-pfunc', PARA_FUNC_MAP[f] || f);
      chip.setAttribute('contenteditable', 'false');
      chip.title = '段落功能：' + (PARA_FUNC_MAP[f] || f) + '（点击修改）';
      chip.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); openParaFuncPanel(idx); });
      p.insertBefore(chip, p.firstChild);
    });
  }
  function openParaFuncPanel(focusIdx) {
    const p = insPanel('pfunc-panel', '🏷 段落功能标签');
    insOpen(p);
    const body = document.getElementById('pfunc-panel-body');
    if (!body) return;
    const idxs = paraFuncIdxList();
    if (!idxs.length) {
      body.innerHTML = '<div class="ins-empty">没有找到正文段落。</div>';
      return;
    }
    const count = {};
    PARA_FUNCS.forEach(f => { count[f[0]] = 0; });
    annotations.forEach(a => { if (a.bucket === 'paraFunc' && count[a.func] !== undefined) count[a.func]++; });
    body.innerHTML =
      '<div class="ins-dim">给每段标一个功能：读结构、写作文、做新题型都用得上。标签存本篇，不写进正文。</div>' +
      '<div class="ins-filters">' + PARA_FUNCS.map(f =>
        '<span class="ins-chip legend f-' + f[0] + '">' + esc(f[1]) + ' ' + count[f[0]] + '</span>').join('') +
      '</div>' +
      '<div class="ins-list">' + idxs.map(i => {
        const f = paraFuncOf(i);
        const p0 = document.querySelector('.col-body.en p[data-para-idx="' + i + '"]');
        const preview = p0 ? String(p0.textContent || '').replace(/\s+/g, ' ').slice(0, 70) : '';
        return '<div class="ins-row' + (String(i) === String(focusIdx) ? ' focus' : '') + '" data-pfrow="' + i + '">' +
          '<div class="ins-row-main"><div class="ins-row-sub"><b>第 ' + i + ' 段</b> ' + esc(preview) + '…</div></div>' +
          '<div class="ins-row-act">' +
          '<select data-pfsel="' + i + '"><option value="">— 未标注 —</option>' +
          PARA_FUNCS.map(x => '<option value="' + x[0] + '"' + (f === x[0] ? ' selected' : '') + '>' + x[1] + '</option>').join('') +
          '</select>' +
          '<button type="button" class="ins-btn ghost" data-pfgoto="' + i + '">定位</button>' +
          '</div></div>';
      }).join('') + '</div>';
    if (!body.dataset.wired) {
      body.dataset.wired = '1';
      body.addEventListener('change', (e) => {
        const t = e.target;
        if (t && t.dataset && t.dataset.pfsel) setParaFunc(t.dataset.pfsel, t.value);
      });
      body.addEventListener('click', (e) => {
        const g = e.target.closest && e.target.closest('[data-pfgoto]');
        if (g) jumpToPara(g.dataset.pfgoto);
      });
    }
    const row = body.querySelector('[data-pfrow="' + focusIdx + '"]');
    if (row) row.scrollIntoView({ block: 'center' });
  }

  // ==========================================================================
  // F07 跨文章生词网络（+ F12 素材来源跳转共用这段跳转逻辑）
  // ==========================================================================
  // ⚠ 不建 vocab:index：词表完全可以由 registry + 各篇 annotations:<篇> 现场推导，
  //   再存一份索引就是第二份真相，还要考虑失效与迁移。
  function vocabOccurrences(word) {
    const w = String(word || '').trim().toLowerCase();
    if (!w) return [];
    const ids = insRegistry().map(r => r.id).filter(Boolean);
    if (ids.indexOf(articleId) < 0) ids.push(articleId);
    const out = [], seen = new Set();
    ids.forEach(id => {
      (insLoad('annotations:' + id, []) || []).forEach(a => {
        if (!a || a.bucket !== 'vocab' || !a.text) return;
        if (String(a.text).trim().toLowerCase() !== w) return;
        const k = id + '|' + (a.paraIdx || '?');
        if (seen.has(k)) return;
        seen.add(k);
        out.push({ id: id, paraIdx: a.paraIdx || '', context: a.context || '' });
      });
    });
    out.sort((a, b) => (a.id === articleId ? -1 : b.id === articleId ? 1 : 0));
    return out;
  }
  function allVocabWords() {
    const ids = insRegistry().map(r => r.id).filter(Boolean);
    if (ids.indexOf(articleId) < 0) ids.push(articleId);
    const map = {};   // lower → { word, articles:Set, mine:bool }
    ids.forEach(id => {
      (insLoad('annotations:' + id, []) || []).forEach(a => {
        if (!a || a.bucket !== 'vocab' || !a.text) return;
        const k = String(a.text).trim().toLowerCase();
        if (!k) return;
        if (!map[k]) map[k] = { word: String(a.text).trim(), articles: new Set(), mine: false };
        map[k].articles.add(id);
        if (id === articleId) map[k].mine = true;
      });
    });
    return Object.keys(map).map(k => ({ word: map[k].word, n: map[k].articles.size, mine: map[k].mine }))
      .sort((a, b) => b.n - a.n || a.word.localeCompare(b.word));
  }
  let vocabNetQuery = '';
  function openVocabNet(focusWord) {
    const p = insPanel('vocabnet-panel', '🕸 生词网络');
    insOpen(p);
    if (focusWord) vocabNetQuery = String(focusWord);
    renderVocabNet();
    const body = document.getElementById('vocabnet-panel-body');
    if (!body.dataset.wired) {
      body.dataset.wired = '1';
      body.addEventListener('input', (e) => {
        if (e.target && e.target.id === 'vocabnet-q') { vocabNetQuery = e.target.value; renderVocabNet(true); }
      });
      body.addEventListener('click', (e) => {
        const j = e.target.closest && e.target.closest('[data-vjump]');
        if (j) { jumpToRef(j.dataset.vjump, j.dataset.vpara); return; }
        const expand = e.target.closest && e.target.closest('[data-vexp]');
        if (expand) {
          // ⚠ 不要用 CSS.escape + 属性选择器查行：jsdom 里 CSS.escape 未必存在，
          //   直接从未被点的按钮往上找最近的 .ins-row 更稳。
          const row = expand.closest('.ins-row');
          const occ = row ? row.querySelector('.ins-occ') : null;
          if (occ) occ.hidden = !occ.hidden;
        }
      });
    }
  }
  function renderVocabNet(keepFocus) {
    const body = document.getElementById('vocabnet-panel-body');
    if (!body) return;
    const q = vocabNetQuery.trim().toLowerCase();
    const words = allVocabWords().filter(w => !q || w.word.toLowerCase().indexOf(q) >= 0);
    const cross = words.filter(w => w.n >= 2);
    const mineOnly = words.filter(w => w.mine && w.n < 2);
    const head =
      '<div class="ins-search"><input id="vocabnet-q" type="search" placeholder="搜一个词…" value="' + esc(vocabNetQuery) + '"></div>' +
      '<div class="ins-dim">同一篇里存过的生词会自动跨文章关联 —— 点位置直接跳到那篇文章那一段。</div>';
    if (!words.length) {
      body.innerHTML = head + '<div class="ins-empty">还没有生词记录。<br>' +
        '<span class="ins-dim">阅读时选中单词 → 「生词」，就会进这张网。</span></div>';
      return;
    }
    const rowHTML = w => {
      const occ = vocabOccurrences(w.word);
      const chips = occ.map(o =>
        '<button type="button" class="ins-chip jump" data-vjump="' + esc(o.id) + '" data-vpara="' + esc(o.paraIdx) + '" title="' +
        esc((o.context || '').slice(0, 90)) + '">' +
        esc(insTitleOf(o.id).slice(0, 16)) + (o.paraIdx ? ' · 第' + esc(o.paraIdx) + '段' : '') + '</button>').join('');
      return '<div class="ins-row" data-vrow="' + esc(w.word) + '">' +
        '<div class="ins-row-main">' +
        '<div class="ins-row-title"><b class="ins-word">' + esc(w.word) + '</b>' +
        (w.n >= 2 ? '<span class="ins-tag ok">' + w.n + ' 篇复现</span>' : '<span class="ins-tag">仅 1 篇</span>') +
        (w.mine ? '<span class="ins-tag type">本篇</span>' : '') +
        '<button type="button" class="ins-btn ghost" data-vexp="' + esc(w.word) + '">位置</button>' +
        '</div>' +
        '<div class="ins-occ" hidden>' + chips + '</div>' +
        '</div></div>';
    };
    body.innerHTML = head +
      (cross.length ? '<div class="ins-section">跨篇复现（' + cross.length + '）</div><div class="ins-list">' +
        cross.map(rowHTML).join('') + '</div>' : '') +
      (mineOnly.length ? '<div class="ins-section">本篇生词（' + mineOnly.length + '）</div><div class="ins-list">' +
        mineOnly.map(rowHTML).join('') + '</div>' : '');
    if (keepFocus) { const i = body.querySelector('#vocabnet-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }
  // 跳转到「另一篇文章的第 N 段」：带上 #para-N，目标页加载后由 initHashJump 定位
  function jumpToRef(fileId, paraIdx) {
    const h = paraIdx ? '#para-' + paraIdx : '';
    if (fileId === articleId) { if (paraIdx) jumpToPara(paraIdx); return; }
    location.href = insPageUrl(fileId) + h;
  }
  // 本页内跳到某段：报纸版走版次，三栏视图走滚动
  function jumpToPara(idx) {
    if (typeof paperIsOpen === 'function' && paperIsOpen() &&
        typeof paperGotoParaIdx === 'function' && paperGotoParaIdx(String(idx))) {
      flashPara(idx);
      return true;
    }
    const p = document.querySelector('.col-body.en p[data-para-idx="' + idx + '"]') ||
      document.querySelector('.col-body.cn p[data-para-idx="' + idx + '"]');
    if (!p) return false;
    p.scrollIntoView({ block: 'center', behavior: 'smooth' });
    flashPara(idx);
    return true;
  }
  function flashPara(idx) {
    document.querySelectorAll('.para-flash').forEach(el => el.classList.remove('para-flash'));
    document.querySelectorAll('.col-body.en p[data-para-idx="' + idx + '"], .col-body.cn p[data-para-idx="' + idx + '"]')
      .forEach(el => {
        el.classList.add('para-flash');
        setTimeout(() => el.classList.remove('para-flash'), 2600);
      });
  }
  // 从别的页面跳进来时带 #para-N：等报纸版建好再定位（建版是异步的，太早找不到版）
  function initHashJump() {
    const m = /^#para-(\d+)$/.exec(String(location.hash || ''));
    if (!m) return;
    const idx = m[1];
    let tries = 0;
    const attempt = () => {
      tries++;
      const ok = jumpToPara(idx);
      if (!ok && tries < 6) setTimeout(attempt, 400);
    };
    setTimeout(attempt, 800);
  }

  // ==========================================================================
  // F01 原文可视化标注（派生层）
  // ==========================================================================
  // 既有机制只覆盖 annotations（生词/笔记/题型）—— 它们有 `<mark data-id>`。
  // 真正的缺口是**长难句与写作素材**：它们存在 `syntax:<篇>` 和 `wsj_writing:materials` 里，
  // 从来没有出现在正文上，所以「我在正文里标过的东西」和「我攒下来的句子」是两张皮。
  //
  // 派生层（不新增存储，纯渲染）：
  //   · 从句库里取本篇的长难句、从素材库里取 articleId===本篇 的句子，回到正文里找**原句**；
  //   · 用 `<mark class="hl hl-derived hl-syntax|hl-material">` 包起来，点击弹出内容卡片；
  //   · ⚠ 不与既有标注**嵌套**：TreeWalker 直接拒绝 MARK 内的文本节点，
  //     所以「已经标过生词的词」不会被再包一层 —— 这是这一层唯一必须守住的约束；
  //   · ⚠ 幂等：每次重渲染先 unwrap 掉所有 `.hl-derived` 再重建；
  //   · 开关：`wsj_reader:derivedAnns`（默认开），层太花时可关掉。
  const DERIVED_PREF_KEY = 'wsj_reader:derivedAnns';
  function derivedOn() {
    let v = null;
    try { v = localStorage.getItem(DERIVED_PREF_KEY); } catch (e) {}
    return v === null || v === undefined ? true : v === '1' || v === true;
  }
  function setDerivedOn(on) {
    try { localStorage.setItem(DERIVED_PREF_KEY, on ? '1' : '0'); } catch (e) {}
    renderDerivedMarks();
    showTopToast(on ? '已开启正文派生标注（长难句 / 素材）' : '已隐藏正文派生标注');
  }
  function insMaterials() { return insLoad('wsj_writing:materials', []) || []; }
  function derivedEntries() {
    const out = [];
    (insLoad('syntax:' + articleId, []) || []).forEach((s, i) => {
      const t = String((s && (s.text || s.html)) || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (t.length >= 8) out.push({ kind: 'syntax', i: i, text: t });
    });
    insMaterials().forEach((m, i) => {
      if (m && m.articleId && m.articleId !== articleId) return;   // 只标本篇的素材
      const t = String((m && (m.sourceText || m.source)) || '').replace(/\s+/g, ' ').trim();
      if (t.length >= 8) out.push({ kind: 'material', i: i, text: t });
    });
    return out;
  }
  function unwrapDerived() {
    document.querySelectorAll('mark.hl-derived').forEach(m => {
      if (!m.parentNode) return;
      m.parentNode.replaceChild(document.createTextNode(m.textContent), m);
    });
    document.querySelectorAll('.col-body').forEach(el => { if (el.normalize) el.normalize(); });
  }
  function renderDerivedMarks() {
    unwrapDerived();
    if (!derivedOn()) return 0;
    const entries = derivedEntries();
    if (!entries.length) return 0;
    // 长句先占位：短句/短语不会把长句切碎
    entries.sort((a, b) => b.text.length - a.text.length);
    const bodies = document.querySelectorAll('.col-body.en');
    let n = 0;
    bodies.forEach(body => {
      entries.forEach(en => {
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
          acceptNode: (nd) => {
            if (!nd.parentNode) return NodeFilter.FILTER_REJECT;
            let p = nd.parentNode;
            while (p && p !== body) {
              if (p.nodeType === 1) {
                if (p.tagName === 'MARK') return NodeFilter.FILTER_REJECT;          // 不许嵌套
                if (p.classList && p.classList.contains('pfunc-chip')) return NodeFilter.FILTER_REJECT;
                if (p.tagName === 'SCRIPT' || p.tagName === 'STYLE') return NodeFilter.FILTER_REJECT;
              }
              p = p.parentNode;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        const nodes = [];
        let nd;
        while ((nd = walker.nextNode())) nodes.push(nd);
        for (let k = 0; k < nodes.length; k++) {
          const node = nodes[k];
          if (!node.parentNode) continue;
          const val = node.nodeValue;
          let from = 0;
          let placed = false;
          while (from <= val.length - en.text.length) {
            const i = val.indexOf(en.text, from);
            if (i < 0) break;
            if (isWordBoundaryMatch(val, i, en.text)) {
              const mark = document.createElement('mark');
              mark.className = 'hl hl-derived hl-' + en.kind;
              mark.dataset.derived = en.kind + ':' + en.i;
              mark.title = (en.kind === 'syntax' ? '长难句' : '写作素材') + '：点开看内容';
              mark.addEventListener('click', (e) => {
                e.preventDefault();
                openDerivedCard(mark.dataset.derived);
              });
              // ⚠ 必须**把原来那个文本节点搬进 mark**，不能给 mark 赋 textContent：
              //   赋 textContent 会在原地生成一份副本，而 splitText 切出来的那段还在文档里
              //   → 正文里同一句话出现两遍（实测被 verify_dictation 的「★ 长难句」用例抓到）。
              const mid = node.splitText(i);        // node=[0,i)  mid=[i,end)
              const tail = mid.splitText(en.text.length);   // mid=[i,i+len)  tail=余下
              mark.appendChild(mid);                // 把 mid 从文档里摘进 mark（不复制文本）
              tail.parentNode.insertBefore(mark, tail);
              n++;
              placed = true;
              break;
            }
            from = i + 1;
          }
          if (placed) break;   // 一个句子在本篇通常只出现一次，标到就停
        }
      });
    });
    return n;
  }
  // 点派生标注 → 内容卡片（长难句给结构，素材给起因/经过/逻辑）
  function openDerivedCard(key) {
    const m = /^(syntax|material):(\d+)$/.exec(String(key || ''));
    if (!m) return;
    const kind = m[1], i = Number(m[2]);
    const p = insPanel('derived-card', kind === 'syntax' ? '🧩 长难句' : '✍️ 写作素材');
    insOpen(p);
    const body = document.getElementById('derived-card-body');
    if (!body) return;
    if (kind === 'syntax') {
      const rec = (insLoad('syntax:' + articleId, []) || [])[i];
      if (!rec) { body.innerHTML = '<div class="ins-empty">这条长难句已经不在了。</div>'; return; }
      const plain = String(rec.html ? rec.html.replace(/<[^>]+>/g, '') : rec.text || '');
      body.innerHTML =
        '<div class="dt-cn" style="border-left-color:#3182ce;font-size:14px">' + esc(plain) + '</div>' +
        (rec.structure ? '<div class="ins-section">结构</div><div class="ins-dim">' + esc(String(rec.structure).replace(/\n/g, '　')) + '</div>' : '') +
        (rec.note ? '<div class="ins-section">笔记</div><div>' + esc(rec.note) + '</div>' : '') +
        '<div class="ins-dim">来源：' + esc(insTitleOf(articleId)) + (rec.paraIdx ? ' · 第 ' + esc(rec.paraIdx) + ' 段' : '') + '</div>' +
        '<div class="ins-actions">' +
        (rec.paraIdx ? '<button type="button" class="ins-btn ghost" data-dgoto="' + esc(rec.paraIdx) + '">看原文</button>' : '') +
        '<button type="button" class="ins-btn" data-ddict="' + esc(plain.slice(0, 200)) + '">🖊 默写这句</button>' +
        '</div>';
    } else {
      const rec = insMaterials()[i];
      if (!rec) { body.innerHTML = '<div class="ins-empty">这条素材已经不在了。</div>'; return; }
      body.innerHTML =
        '<div class="ins-row-title"><span class="ins-tag type">' + esc(rec.topic || '未归类') + '</span>' +
        (rec.usedCount ? '<span class="ins-tag ok">用过 ' + rec.usedCount + ' 次</span>' : '') + '</div>' +
        '<div class="dt-cn" style="border-left-color:#38a169;font-size:14px">「' + esc(rec.sourceText || rec.source || '') + '」</div>' +
        (rec.cause ? '<div><b>起因：</b>' + esc(rec.cause) + '</div>' : '') +
        (rec.process ? '<div><b>经过：</b>' + esc(rec.process) + '</div>' : '') +
        (rec.develop ? '<div><b>发展：</b>' + esc(rec.develop) + '</div>' : '') +
        (rec.logic ? '<div><b>逻辑：</b>' + esc(rec.logic) + '</div>' : '') +
        (rec.usage ? '<div><b>用法：</b>' + esc(rec.usage) + '</div>' : '') +
        '<div class="ins-actions">' +
        (rec.paraIdx ? '<button type="button" class="ins-btn ghost" data-dgoto="' + esc(rec.paraIdx) + '">看原文</button>' : '') +
        '<button type="button" class="ins-btn ghost" data-dopen-mat="1">去写作工坊</button>' +
        '</div>';
    }
    if (!body.dataset.wired) {
      body.dataset.wired = '1';
      body.addEventListener('click', (e) => {
        const t = e.target;
        const g = t.closest && t.closest('[data-dgoto]');
        if (g) { jumpToPara(g.dataset.dgoto); return; }
        const d = t.closest && t.closest('[data-ddict]');
        if (d && typeof window.openDictation === 'function') { window.openDictation(d.dataset.ddict); return; }
        if (t.closest && t.closest('[data-dopen-mat]')) { openWorkshopFromCard('materials'); return; }
      });
    }
  }
  // 卡片上的「去写作工坊」：走 window.__exam（面板在 exam-panel.js 里，reader 作用域拿不到）
  function openWorkshopFromCard(tab) {
    if (window.__exam && typeof window.__exam.openWritingWorkshop === 'function') {
      window.__exam.openWritingWorkshop(tab);
    } else {
      showTopToast('写作工坊还没准备好，请从「考试」菜单进入');
    }
  }

  // ==========================================================================
  // F18 学习总览（10 篇一屏看完）
  // ==========================================================================
  // 数据全部来自既有键：`reading:<id>`（时长/位置）+ `wsj_reader:article:<id>`（段数）+
  // `annotations:<id>` + `syntax:<id>` + `wsj_writing:materials` + `wsj_exam:history` + 4 个错题库
  // + `wsj_dictation:stats`。**不新建任何聚合键**（那会成为第二份真相）。
  function studyRowFor(id) {
    const reg = insRegistry().filter(r => r.id === id)[0] || {};
    const anns = insLoad('annotations:' + id, []) || [];
    const rd = insLoad('reading:' + id, {}) || {};
    const art = insLoad('wsj_reader:article:' + id, null) || {};
    const paras = (art.enParas || []).map(p => Number(p && p.idx) || 0);
    const paraMax = paras.length ? Math.max.apply(null, paras) : 0;
    const lastPos = Number(rd.lastPosition || 0);
    const title = reg.title || (id === articleId ? getShortTitle() : '') ||
      String(id).replace(/_EN-CN_final\.html$/, '').replace(/_/g, ' ');
    // 栏目 ID：本篇直接用 <body data-edition>；别的篇没有全局映射，靠考试记录里的 title 反查
    const hist = insLoad('wsj_exam:history', []) || [];
    let slug = (id === articleId && articleMeta.slug) ? articleMeta.slug : '';
    if (!slug && title) {
      const hit = hist.filter(h => h && h.slug && h.title === title)[0];
      if (hit) slug = hit.slug;
    }
    let correct = 0, total = 0;
    hist.forEach(h => {
      if (!slug || !h || h.slug !== slug) return;
      if (h.mode && h.mode !== 'exam' && h.mode !== 'reading') return;   // 阅读理解的成绩才算这一项
      correct += Number(h.correct || 0);
      total += Number(h.total || 0);
    });
    const wrongs = WRONG_STORES.reduce((n, st) =>
      n + (insLoad(st.key, []) || []).filter(w => w && slug && w.slug === slug).length, 0);
    const dictKeys = Object.keys(insLoad(DICT_STATS_KEY, {}) || {}).filter(k => k.indexOf(id + '#') === 0);
    return {
      id: id, title: title, slug: slug,
      seconds: Number(rd.totalSeconds || 0),
      progress: paraMax ? Math.min(100, Math.round(lastPos / paraMax * 100)) : 0,
      started: !!rd.lastPosition,
      vocab: anns.filter(a => a.bucket === 'vocab').length,
      note: anns.filter(a => a.bucket === 'note').length,
      misread: anns.filter(a => a.bucket === 'misread').length,
      syntax: (insLoad('syntax:' + id, []) || []).length,
      material: insMaterials().filter(m => m && m.articleId === id).length,
      rate: total ? Math.round(correct / total * 100) : null,
      trials: total, wrongs: wrongs, dict: dictKeys.length
    };
  }
  function studyRows() {
    const ids = insRegistry().map(r => r.id).filter(Boolean);
    if (articleId && ids.indexOf(articleId) < 0) ids.push(articleId);
    const rows = ids.map(studyRowFor);
    rows.sort((a, b) => b.seconds - a.seconds || a.title.localeCompare(b.title));
    return rows;
  }
  function fmtMinutes(sec) {
    const m = Math.round((sec || 0) / 60);
    return m >= 60 ? (m / 60).toFixed(1) + ' 小时' : m + ' 分钟';
  }
  function openStudyOverview() {
    const p = insPanel('study-panel', '📚 学习总览', '<button type="button" class="ins-btn ghost" data-srefresh="1">刷新</button>');
    insOpen(p);
    renderStudyOverview();
    const body = document.getElementById('study-panel-body');
    if (body && !body.dataset.wired) {
      body.dataset.wired = '1';
      body.addEventListener('click', (e) => {
        const t = e.target;
        if (t.closest && t.closest('[data-srefresh]')) { renderStudyOverview(); return; }
        const j = t.closest && t.closest('[data-sjump]');
        if (j) { jumpToRef(j.dataset.sjump, j.dataset.spara || ''); return; }
      });
    }
  }
  function renderStudyOverview() {
    const body = document.getElementById('study-panel-body');
    if (!body) return;
    const rows = studyRows();
    const sum = rows.reduce((a, r) => {
      a.seconds += r.seconds; a.vocab += r.vocab; a.syntax += r.syntax; a.material += r.material;
      a.wrongs += r.wrongs; a.dict += r.dict; a.misread += r.misread;
      if (r.started) a.started++;
      if (r.trials) { a.correct += 0; }
      return a;
    }, { seconds: 0, vocab: 0, syntax: 0, material: 0, wrongs: 0, dict: 0, misread: 0, started: 0, correct: 0 });
    const cross = allVocabWords().filter(w => w.n >= 2).length;
    let correct = 0, total = 0;
    (insLoad('wsj_exam:history', []) || []).forEach(h => {
      if (!h || (h.mode && h.mode !== 'exam' && h.mode !== 'reading')) return;
      correct += Number(h.correct || 0); total += Number(h.total || 0);
    });
    const dueWords = (typeof dueReviewCount === 'function') ? dueReviewCount() : 0;
    const dueWrongs = (typeof dueWrongCount === 'function') ? dueWrongCount() : 0;
    const readPct = rows.length ? Math.round(rows.reduce((n, r) => n + r.progress, 0) / rows.length) : 0;
    let html =
      '<div class="ins-kpi">' +
      '<div class="ins-kpi-item"><b>' + sum.started + '/' + rows.length + '</b><span>已开始阅读</span></div>' +
      '<div class="ins-kpi-item"><b>' + fmtMinutes(sum.seconds) + '</b><span>累计阅读</span></div>' +
      '<div class="ins-kpi-item"><b>' + sum.vocab + '</b><span>生词</span></div>' +
      '<div class="ins-kpi-item"><b>' + cross + '</b><span>≥2 篇复现</span></div>' +
      '<div class="ins-kpi-item"><b>' + sum.syntax + '</b><span>长难句</span></div>' +
      '<div class="ins-kpi-item"><b>' + sum.material + '</b><span>素材</span></div>' +
      '</div>' +
      '<div class="ins-kpi">' +
      '<div class="ins-kpi-item"><b>' + (total ? Math.round(correct / total * 100) + '%' : '—') + '</b><span>阅读题正确率</span></div>' +
      '<div class="ins-kpi-item"><b>' + sum.wrongs + '</b><span>错题</span></div>' +
      '<div class="ins-kpi-item"><b>' + sum.misread + '</b><span>理解偏差</span></div>' +
      '<div class="ins-kpi-item"><b>' + sum.dict + '</b><span>默写句数</span></div>' +
      '<div class="ins-kpi-item hot"><b>' + dueWords + '</b><span>今日待复习生词</span></div>' +
      '<div class="ins-kpi-item hot"><b>' + dueWrongs + '</b><span>今日待复习错题</span></div>' +
      '</div>' +
      '<div class="so-bar"><span>整体阅读进度</span><span class="so-track"><span class="so-fill" style="width:' + readPct + '%"></span></span><b>' + readPct + '%</b></div>';
    if (!rows.length) {
      html += '<div class="ins-empty">还没有任何文章记录。<br><span class="ins-dim">打开过一篇再回来，这里就会汇总。</span></div>';
    } else {
      html += '<table class="ins-table so-table"><thead><tr>' +
        '<th>文章</th><th>进度</th><th>生词</th><th>长难句</th><th>素材</th><th>正确率</th><th>错题</th><th>默写</th>' +
        '</tr></thead><tbody>' +
        rows.map(r =>
          '<tr' + (r.id === articleId ? ' class="cur"' : '') + '>' +
          '<td class="so-title">' +
          (((r.id === articleId) || !r.started) ? esc(r.title) :
            '<button type="button" class="so-link" data-sjump="' + esc(r.id) + '" title="打开这篇">' + esc(r.title) + '</button>') +
          (r.id === articleId ? ' <span class="ins-tag type">本篇</span>' : '') + '</td>' +
          '<td><span class="so-track"><span class="so-fill" style="width:' + r.progress + '%"></span></span> ' + r.progress + '%</td>' +
          '<td>' + (r.vocab || '—') + '</td><td>' + (r.syntax || '—') + '</td><td>' + (r.material || '—') + '</td>' +
          '<td>' + (r.rate === null ? '—' : r.rate + '%') + '</td><td>' + (r.wrongs || '—') + '</td><td>' + (r.dict || '—') + '</td>' +
          '</tr>').join('') +
        '</tbody></table>' +
        '<div class="ins-dim">正确率只统计阅读理解（完形 / 新题型 / 翻译的题型不同，混在一起没有意义）；' +
        '带下划线的标题可以点开那篇文章。所有数字都来自本机已有记录，不联网。' +
        (rows.filter(r => !r.slug).length ? '<br>注：有 ' + rows.filter(r => !r.slug).length +
          ' 篇暂时认不出栏目 ID（栏目 ID 只写在文章 HTML 里），这几篇的正确率与错题数会显示为 —。' : '') +
        '</div>';
    }
    body.innerHTML = html;
  }

  window.openWrongBook = openWrongBook;
  window.openRadar = openRadar;
  window.openParaFuncPanel = openParaFuncPanel;
  window.openVocabNet = openVocabNet;
  window.renderParaFuncs = renderParaFuncs;
  window.setParaFunc = setParaFunc;
  window.dueWrongCount = dueWrongCount;
  window.jumpToRef = jumpToRef;
  // F01 派生标注层 / F18 学习总览
  window.renderDerivedMarks = renderDerivedMarks;
  window.derivedOn = derivedOn;
  window.setDerivedOn = setDerivedOn;
  window.openDerivedCard = openDerivedCard;
  window.openStudyOverview = openStudyOverview;
  window.studyRows = studyRows;
