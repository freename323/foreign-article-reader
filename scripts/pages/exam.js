(function () {
  const examId = document.body.dataset.examId ||
    (location.pathname.split('/').pop() || '').replace(/^exam_|\.html$/g, '') || 'exam';
  const HL_KEY = 'examhl:' + examId;
  const Q_KEY = 'examq:' + examId;
  const T_KEY = 'examtimer:' + examId;
  const LIMIT_KEY = 'examlimit:' + examId;
  const MODE_KEY = 'exammode:' + examId;   // 考试态 / 练习态
  const MARK_KEY = 'exammark:' + examId;   // 答题卡「标记待复核」
  const SESS_KEY = 'examsess:' + examId;   // 交卷状态 + 当前计时题
  const W_KEY = 'wsj_exam:wrongs';
  const O_KEY = 'wsj_exam:overtime';
  const H_KEY = 'wsj_exam:history';        // 成绩历史（跨文章）
  const CAUSES = [['vocab', '词汇'], ['syntax', '长难句'], ['logic', '逻辑'], ['qtype', '题型'], ['careless', '粗心'], ['trans', '误译']];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function genId() { return Date.now() + '-' + Math.random().toString(36).slice(2, 8); }
  function loadLS(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
  function saveLS(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }

  // ===== Data =====
  const QUESTIONS = (window.__EXAM_QUESTIONS__ || []).map(q => ({
    no: q.no, type: q.type || '', difficulty: q.difficulty || '',
    stem: q.stem || '', options: q.options || {},
    answer: q.answer || '', analysis: q.analysis || ''
  }));

  // ===== Theme =====
  function applyTheme() {
    let t = 'system';
    try { t = localStorage.getItem('wsj_exam:theme') || 'system'; } catch (e) {}
    if (t === 'dark' || t === 'green' || t === 'blue-gold') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  applyTheme();
  window.toggleTheme = function () {
    const cur = document.documentElement.getAttribute('data-theme');
    const order = ['green', 'dark', 'blue-gold', 'light'];
    const next = order[(order.indexOf(cur || 'green') + 1) % order.length];
    try { localStorage.setItem('wsj_exam:theme', next); } catch (e) {}
    applyTheme();
  };

  // ===== Toast =====
  let toastTimer = null;
  function toast(msg) {
    let t = document.getElementById('exam-toast');
    if (!t) { t = document.createElement('div'); t.id = 'exam-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('visible'), 2200);
  }

  // ===== Timer (start / pause / reset, persisted) =====
  let elapsed = 0, running = false, tickIv = null;
  const st = loadLS(T_KEY, null);
  if (st && typeof st.elapsed === 'number') elapsed = st.elapsed;

  function fmt(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function renderTimer() {
    const d = document.getElementById('timer-display');
    if (d) d.textContent = fmt(elapsed);
    const btn = document.getElementById('timer-btn');
    if (btn) {
      btn.textContent = running ? '⏸ 暂停' : '▶ 开始';
      btn.classList.toggle('running', running);
    }
    const rec = document.getElementById('timer-record');
    if (rec) rec.textContent = elapsed > 0 ? '上次用时 ' + fmt(elapsed) : '';
  }
  function persistTimer() { saveLS(T_KEY, { elapsed: elapsed }); }
  function startTimer() {
    if (running) return;
    running = true;
    tickIv = setInterval(() => { elapsed++; renderTimer(); tickLimit(); if (elapsed % 5 === 0) persistTimer(); }, 1000);
    renderTimer();
  }
  function pauseTimer() {
    running = false;
    if (tickIv) { clearInterval(tickIv); tickIv = null; }
    persistTimer(); renderTimer();
  }
  function resetTimer() {
    pauseTimer(); elapsed = 0; persistTimer(); renderTimer();
  }

  // ===== Countdown limit (限时节奏训练: 20 min / article) =====
  const LIMIT_SECONDS = 20 * 60;
  let limitOn = false, limitLeft = LIMIT_SECONDS, overRecorded = false;
  const lst = loadLS(LIMIT_KEY, null);
  if (lst) { limitOn = !!lst.on; limitLeft = typeof lst.left === 'number' ? lst.left : LIMIT_SECONDS; overRecorded = !!lst.over; }

  function articleTitle() { return window.__EXAM_ARTICLE_TITLE__ || document.title || examId; }
  function persistLimit() { saveLS(LIMIT_KEY, { on: limitOn, left: limitLeft, over: overRecorded }); }
  function renderLimit() {
    const d = document.getElementById('limit-display');
    const btn = document.getElementById('limit-btn');
    if (btn) btn.classList.toggle('active', limitOn);
    if (!d) return;
    if (!limitOn) { d.hidden = true; d.className = 'limit-display'; return; }
    d.hidden = false;
    if (limitLeft >= 0) {
      d.textContent = '⏳ 剩余 ' + fmt(limitLeft);
      d.className = 'limit-display' + (limitLeft <= 120 ? ' danger' : (limitLeft <= 300 ? ' warn' : ''));
    } else {
      d.textContent = '⏰ 超时 +' + fmt(-limitLeft);
      d.className = 'limit-display danger';
    }
  }
  function recordOvertime() {
    const arr = loadLS(O_KEY, []);
    arr.push({ slug: examId, title: articleTitle(), at: new Date().toISOString() });
    saveLS(O_KEY, arr.slice(-100));
  }
  function tickLimit() {
    if (!limitOn) return;
    limitLeft--;
    if (limitLeft === 0) {
      toast('⏰ 20 分钟到！已记录超时，可继续完成');
      if (!overRecorded) { overRecorded = true; recordOvertime(); }
    }
    renderLimit();
    if (limitLeft % 5 === 0) persistLimit();
  }
  function toggleLimit() {
    if (limitOn) {
      limitOn = false; persistLimit(); renderLimit();
      toast('已关闭限时');
      return;
    }
    limitLeft = LIMIT_SECONDS; overRecorded = false; limitOn = true;
    persistLimit(); renderLimit();
    if (!running) startTimer();
    toast('⏳ 限时 20 分钟开始，计时同步启动');
  }

  // ===== Highlighting in article pane =====
  // Offsets are measured against the paragraph's FULL textContent, so highlights
  // survive reloads and work in paragraphs containing inline tags (em/strong/a).
  // The old scheme stored offsets relative to p.firstChild, which threw on any
  // paragraph whose first text node was shorter than the offset.
  let hlColor = 'hl-y';
  let highlights = loadLS(HL_KEY, []);

  function paraTextOffset(p, container, offsetInContainer) {
    try {
      const pre = document.createRange();
      pre.selectNodeContents(p);
      pre.setEnd(container, offsetInContainer);
      return pre.toString().length;
    } catch (e) { return null; }
  }

  function wrapHighlightSegment(node, start, end, h) {
    const val = node.nodeValue;
    const parent = node.parentNode;
    const frag = document.createDocumentFragment();
    if (start > 0) frag.appendChild(document.createTextNode(val.slice(0, start)));
    const span = document.createElement('span');
    span.className = 'exam-hl ' + h.color;
    span.dataset.hlId = h.id;
    span.textContent = val.slice(start, end);
    frag.appendChild(span);
    if (end < val.length) frag.appendChild(document.createTextNode(val.slice(end)));
    parent.replaceChild(frag, node);
  }

  function applyHighlight(h) {
    const container = document.getElementById('article-body');
    if (!container) return;
    try {
      const p = container.querySelector('p[data-para-idx="' + h.paraIdx + '"]');
      if (!p) return;
      const full = p.textContent;
      if (h.start < 0 || h.end > full.length || h.start >= h.end) return;
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null);
      const nodes = [];
      let n;
      while ((n = walker.nextNode())) nodes.push(n);
      let pos = 0;
      for (const node of nodes) {
        const len = node.nodeValue.length;
        const insideHl = node.parentNode && node.parentNode.closest && node.parentNode.closest('.exam-hl');
        if (!insideHl) {
          const s = Math.max(0, h.start - pos);
          const e = Math.min(len, h.end - pos);
          if (e > s) wrapHighlightSegment(node, s, e, h);
        }
        pos += len; // 已划线 span 内的文本也要计入偏移
      }
    } catch (e) {}
  }
  function applyAllHighlights() {
    highlights.slice().sort((a, b) => (a.paraIdx - b.paraIdx) || (a.start - b.start)).forEach(applyHighlight);
  }
  function saveSelectionAsHighlight() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { toast('请先在左侧文章中选中文字'); return; }
    const range = sel.getRangeAt(0);
    const container = document.getElementById('article-body');
    if (!container.contains(range.commonAncestorContainer)) { toast('只能在文章正文中划线'); return; }
    const nodePara = (nd) => {
      const el = nd.nodeType === 1 ? nd : nd.parentElement;
      return el ? el.closest('p[data-para-idx]') : null;
    };
    const startP = nodePara(range.startContainer);
    const endP = nodePara(range.endContainer);
    if (!startP || startP !== endP) { toast('划线请不要跨段落'); return; }
    if ([...startP.querySelectorAll('.exam-hl')].some(sp => range.intersectsNode(sp))) {
      toast('请不要与已有划线重叠'); return;
    }
    const start = paraTextOffset(startP, range.startContainer, range.startOffset);
    const text = range.toString();
    if (start == null || !text.trim()) { toast('划线失败，请重新选择'); return; }
    const h = { id: genId(), paraIdx: parseInt(startP.dataset.paraIdx), start: start, end: start + text.length, color: hlColor };
    highlights.push(h);
    saveLS(HL_KEY, highlights);
    applyHighlight(h);
    sel.removeAllRanges();
    toast('已划线（' + ({ 'hl-y': '黄', 'hl-g': '绿', 'hl-b': '蓝' }[hlColor] || '') + '）');
  }
  function clearHighlights() {
    document.querySelectorAll('#article-body .exam-hl').forEach(s => {
      const parent = s.parentNode;
      while (s.firstChild) parent.insertBefore(s.firstChild, s);
      parent.removeChild(s);
      if (parent.normalize) parent.normalize();
    });
    highlights = [];
    saveLS(HL_KEY, highlights);
    toast('已清除全部划线');
  }

  // ===== 双模式：考试态（交卷揭晓）/ 练习态（即时判分） =====
  let mode = loadLS(MODE_KEY, 'exam') === 'practice' ? 'practice' : 'exam';
  let marks = loadLS(MARK_KEY, {});        // { [no]: true } 标记待复核
  let session = loadLS(SESS_KEY, null) || { submitted: false, at: '', activeNo: 0, activeTs: 0 };
  const isSubmitted = () => session.submitted;
  const revealAllowed = () => mode === 'practice' || session.submitted;

  function setMode(next) {
    if (next === mode) return;
    if (next === 'exam' && session.submitted) {
      if (!confirm('切回考试态会隐藏已揭晓的答案（可再次交卷）。继续？')) return;
      session.submitted = false; saveLS(SESS_KEY, session);
      // 旧得分卡会泄漏上一次的成绩/答案分布，重考前必须移除
      const sc = document.getElementById('score-card'); if (sc) sc.remove();
    }
    mode = next; saveLS(MODE_KEY, mode);
    renderQuestions(); renderAnsheet(); renderBarMode();
    toast(next === 'exam' ? '已切到考试态：作答不判分，交卷时揭晓' : '已切到练习态：选完即判');
  }
  function toggleMark(no) {
    marks[no] = !marks[no];
    if (!marks[no]) delete marks[no];
    saveLS(MARK_KEY, marks);
    const card = qCard(no); if (card) card.classList.toggle('marked', !!marks[no]);
    renderAnsheet();
    toast(marks[no] ? '⚑ 已标记第 ' + no + ' 题' : '已取消标记');
  }

  // ===== 每题计时 =====
  function flushTiming() {
    const now = Date.now();
    if (session.activeNo && session.activeTs) {
      const s = qs(session.activeNo);
      s.ms = (s.ms || 0) + Math.max(0, now - session.activeTs);
    }
    session.activeTs = now;
    saveLS(SESS_KEY, session); saveQ();
  }
  function setActive(no) {
    if (session.activeNo === no) return;
    flushTiming();
    session.activeNo = no;
    document.querySelectorAll('.exam-qcard').forEach(c =>
      c.classList.toggle('active-q', +c.dataset.qno === no));
    saveLS(SESS_KEY, session);
  }

  // ===== 题目状态 =====
  const qState = loadLS(Q_KEY, {}); // { [no]: { myAnswer, note, revealed, cause, ms } }
  function qs(no) {
    if (!qState[no]) qState[no] = { myAnswer: '', note: '', revealed: false, cause: '', ms: 0 };
    return qState[no];
  }
  function saveQ() { saveLS(Q_KEY, qState); }
  const LETTERS = ['A', 'B', 'C', 'D'];
  function qCard(no) { return document.querySelector('.exam-qcard[data-qno="' + no + '"]'); }
  function verdictOf(no) {
    const s = qs(no); if (!s.myAnswer) return 'blank';
    const q = QUESTIONS.find(x => x.no === no);
    return (q && s.myAnswer === q.answer) ? 'right' : 'wrong';
  }
  function answeredCount() { return QUESTIONS.filter(q => qs(q.no).myAnswer).length; }
  function correctCount() { return QUESTIONS.filter(q => qs(q.no).myAnswer && qs(q.no).myAnswer === q.answer).length; }
  function totalMs() { return QUESTIONS.reduce((s, q) => s + (qs(q.no).ms || 0), 0); }

  // ===== 错题记录（Hub 错题分析 + 阅读器「错题本」共享） =====
  // ⚠ 这里额外存 stem / options / analysis：阅读器的错题本要能**就地重做**，
  //   而题干与选项只活在考试页里（window.__EXAM_QUESTIONS__），不落库就没得重做。
  //   只对错题落库，约 400 字节/题，量很小。
  function recordExamState(no) {
    const q = QUESTIONS.find(x => x.no === no); if (!q) return;
    const s = qs(no);
    let recs = loadLS(W_KEY, []);
    const key = examId + '#' + no;
    const data = {
      key: key, slug: examId, title: articleTitle(), no: no, type: q.type || '',
      myAnswer: s.myAnswer || '', answer: q.answer || '', cause: s.cause || '',
      stem: q.stem || '', options: q.options || {}, analysis: q.analysis || '',
      at: new Date().toISOString()
    };
    const existing = recs.find(r => r.key === key);
    if (existing) Object.assign(existing, data); else recs.push(data);
    saveLS(W_KEY, recs);
  }

  // ===== 解析定位原文：从题干+解析里抽段落号 =====
  function extractParaRefs(q) {
    const txt = (q.stem || '') + '\n' + (q.analysis || '');
    const set = new Set();
    let m;
    const re1 = /第\s*(\d+)\s*(?:[-–~至]\s*(\d+)\s*)?段/g;
    while ((m = re1.exec(txt))) { const a = +m[1], b = m[2] ? +m[2] : a; for (let i = a; i <= Math.min(b, a + 5); i++) set.add(i); }
    const re2 = /Paragraphs?\s+([\d,\s]+(?:\s*and\s+\d+)?)/gi;
    while ((m = re2.exec(txt))) { m[1].split(/[\s,]+|\s+and\s+/i).forEach(x => { const n = parseInt(x, 10); if (n > 0 && n < 30) set.add(n); }); }
    const re3 = /\bP\s?(\d{1,2})\b/g;
    while ((m = re3.exec(txt))) set.add(+m[1]);
    const max = document.querySelectorAll('#article-body p[data-para-idx]').length;
    return [...set].filter(n => n >= 1 && n <= max).sort((a, b) => a - b);
  }
  function locateChipsHtml(q) {
    const refs = extractParaRefs(q);
    if (!refs.length) return '';
    return '<div class="loc-row"><span class="loc-label">📍 原文定位</span>' +
      refs.map(n => '<button type="button" class="loc-chip" data-loc="' + n + '">第 ' + n + ' 段</button>').join('') +
      '</div>';
  }
  function locatePara(n) {
    const p = document.querySelector('#article-body p[data-para-idx="' + n + '"]');
    if (!p) { toast('第 ' + n + ' 段不存在'); return; }
    document.querySelectorAll('#article-body .para-located').forEach(el => el.classList.remove('para-located'));
    p.scrollIntoView({ behavior: 'smooth', block: 'center' });
    p.classList.add('para-located');
    setTimeout(() => p.classList.remove('para-located'), 2600);
  }

  // ===== 错因行 =====
  function causeRowHtml(q, s) {
    const allowed = revealAllowed();
    const vis = allowed && s.myAnswer;
    const isWrong = s.myAnswer && s.myAnswer !== q.answer;
    const label = isWrong ? '错因' : (s.myAnswer ? '对题复盘（可标猜对原因）' : '错因');
    const chips = CAUSES.map(c =>
      '<button type="button" class="cause-chip' + (s.cause === c[0] ? ' active' : '') + '" data-cause="' + c[0] + '" data-qno="' + q.no + '">' + c[1] + '</button>'
    ).join('');
    return '<div class="exam-cause-row' + (vis ? '' : ' hidden') + '"><span class="cause-label">🔍 ' + label +
      '</span><div class="cause-chips">' + chips + '</div></div>';
  }

  // ===== 渲染单题 =====
  function renderQuestion(q) {
    const s = qs(q.no);
    const allowed = revealAllowed();
    const v = verdictOf(q.no);
    const revealedNow = allowed && (s.revealed || session.submitted);
    const opts = LETTERS.map(L => {
      const txt = q.options[L] || '';
      if (!txt) return '';
      const sel = s.myAnswer === L;
      const isRight = allowed && L === q.answer;
      const isMyWrong = allowed && sel && v === 'wrong';
      let cls = 'exam-opt' + (sel ? ' selected' : '');
      if (revealedNow) {
        if (isRight) cls += ' opt-right';
        if (isMyWrong) cls += ' opt-mine-wrong';
      }
      return '<label class="' + cls + '"><input type="radio" name="q' + q.no + '" value="' + L + '"' +
        (sel ? ' checked' : '') + (allowed && session.submitted ? ' disabled' : '') +
        '><span class="opt-letter">' + L + '</span><span class="opt-text">' + esc(txt) + '</span></label>';
    }).join('');
    const verdictBadge = allowed && v !== 'blank'
      ? '<span class="verdict ' + v + '">' + (v === 'right' ? '✓ 正确' : '✗ 应选 ' + q.answer) + '</span>'
      : '';
    const revealBtn = allowed
      ? '<button type="button" class="reveal-btn" data-reveal="' + q.no + '">' +
        (s.revealed ? '▲ 收起解析' : '▼ 查看解析') + '</button>'
      : '<button type="button" class="reveal-btn reveal-locked" title="交卷后可查看">🔒 交卷后查看</button>';
    return '<div class="exam-qcard' +
      (v === 'wrong' ? ' wrong' : '') + (v === 'right' ? ' correct' : '') +
      (revealedNow ? ' revealed' : '') + (marks[q.no] ? ' marked' : '') +
      (session.activeNo === q.no ? ' active-q' : '') +
      '" data-qno="' + q.no + '">' +
      '<div class="exam-qhead">' +
      '<span class="qno">第' + q.no + '题</span>' +
      (q.type ? '<span class="qtype-tag">' + esc(q.type) + '</span>' : '') +
      (q.difficulty ? '<span class="qdiff">难度：' + esc(q.difficulty) + '</span>' : '') +
      '<span class="qmark" data-mark="' + q.no + '" title="标记待复核">' + (marks[q.no] ? '⚑' : '⚐') + '</span>' +
      verdictBadge + '</div>' +
      '<div class="exam-stem">' + esc(q.stem) + '</div>' +
      '<div class="exam-opts">' + opts + '</div>' +
      causeRowHtml(q, s) +
      '<div class="exam-note-row"><span class="note-label">✏ 标注</span>' +
      '<div class="exam-note" contenteditable="true" data-placeholder="定位 / 思路 / 错因…">' + esc(s.note) + '</div></div>' +
      revealBtn +
      '<div class="exam-answer' + (revealedNow && s.revealed ? '' : ' hidden') + '">' +
      '<div class="ans-line">正确答案：<b class="ans-letter">' + esc(q.answer) + '</b>' +
      (q.options[q.answer] ? ' — ' + esc(q.options[q.answer]) : '') + '</div>' +
      locateChipsHtml(q) +
      '<div class="analysis">' + esc(q.analysis).replace(/\n/g, '<br>') + '</div></div></div>';
  }

  // ===== 进度栏 =====
  function renderProgress() {
    const el = document.getElementById('exam-progress');
    if (!el) return;
    const done = answeredCount(), total = QUESTIONS.length;
    if (done === 0) { el.textContent = '未作答'; return; }
    el.textContent = done + '/' + total + ' 已答' +
      (isSubmitted() ? ' · ' + correctCount() + '/' + total + ' 对' : '');
  }

  // ===== 答题卡（题号导航器 + 三态） =====
  function renderAnsheet() {
    let el = document.getElementById('ansheet');
    if (!el) {
      const pane = document.querySelector('.pane-questions');
      if (!pane) return;
      el = document.createElement('div');
      el.id = 'ansheet';
      el.className = 'ansheet';
      pane.insertBefore(el, pane.firstChild);
    }
    if (QUESTIONS.length === 0) { el.innerHTML = ''; return; }
    const btns = QUESTIONS.map(q => {
      const s = qs(q.no), v = verdictOf(q.no), m = !!marks[q.no];
      let cls = 'as-btn' + (s.myAnswer ? ' as-answered' : ' as-blank') + (m ? ' as-marked' : '');
      if (revealAllowed()) cls += (v === 'right' ? ' as-right' : v === 'wrong' ? ' as-wrong' : '');
      return '<button type="button" class="' + cls + '" data-as="' + q.no + '">' + q.no + '</button>';
    }).join('');
    el.innerHTML = '<div class="as-head"><span class="as-title">答题卡</span>' +
      '<span class="as-legend"><i class="as-dot blank"></i>未答 <i class="as-dot answered"></i>已答' +
      (revealAllowed() ? ' <i class="as-dot right"></i>对 <i class="as-dot wrong"></i>错' : '') +
      ' <i class="as-dot marked"></i>⚑标记</span></div>' +
      '<div class="as-grid">' + btns + '</div>';
    // 点题号跳到对应题目（innerHTML 每次重建，跟着重绑）
    el.querySelectorAll('[data-as]').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = qCard(parseInt(btn.dataset.as));
        if (!card) return;
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActive(parseInt(btn.dataset.as));
      });
    });
  }

  // ===== 工具栏注入：模式切换 + 交卷按钮 + 成绩按钮 =====
  function renderBarMode() {
    const bar = document.querySelector('.exam-bar');
    if (!bar) return;
    let wrap = document.getElementById('exam-mode-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'exam-mode-wrap';
      wrap.className = 'exam-mode-wrap';
      const ref = document.querySelector('.bar-links') || bar.lastElementChild;
      bar.insertBefore(wrap, ref);
    }
    wrap.innerHTML =
      '<button type="button" class="mode-chip' + (mode === 'exam' ? ' active' : '') + '" data-mode="exam">📝 考试态</button>' +
      '<button type="button" class="mode-chip' + (mode === 'practice' ? ' active' : '') + '" data-mode="practice">💡 练习态</button>' +
      (isSubmitted()
        ? '<button type="button" class="submit-btn done" id="submit-btn" disabled>✓ 已交卷</button>' +
          '<button type="button" class="redo-btn" id="redo-btn">重新作答</button>'
        : '<button type="button" class="submit-btn" id="submit-btn">交卷</button>') +
      '<button type="button" class="history-btn" id="history-btn">📈 成绩</button>';
    wrap.querySelectorAll('[data-mode]').forEach(b => {
      b.addEventListener('click', () => setMode(b.dataset.mode));
    });
    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn && !submitBtn.disabled) submitBtn.addEventListener('click', submitExam);
    const redoBtn = document.getElementById('redo-btn');
    if (redoBtn) redoBtn.addEventListener('click', () => {
      if (!confirm('重新作答会清空所有答案与判分，保留划线。确定？')) return;
      Object.keys(qState).forEach(k => { delete qState[k].myAnswer; delete qState[k].cause; delete qState[k].revealed; qState[k].ms = 0; });
      session.submitted = false; session.at = ''; session.activeNo = 0; session.activeTs = 0;
      saveQ(); saveLS(SESS_KEY, session);
      const sc = document.getElementById('score-card'); if (sc) sc.remove();
      renderQuestions(); renderAnsheet(); renderBarMode();
      toast('已清空作答，重新开始');
    });
    const histBtn = document.getElementById('history-btn');
    if (histBtn) histBtn.addEventListener('click', openHistoryPanel);
  }

  // ===== 交卷：逐题揭晓动画 =====
  let submitting = false;
  function submitExam() {
    if (submitting || session.submitted) return;
    const unanswered = QUESTIONS.filter(q => !qs(q.no).myAnswer);
    if (unanswered.length && !confirm('还有 ' + unanswered.length + ' 题未作答，确定交卷？')) return;
    submitting = true;
    flushTiming();
    session.submitted = true; session.at = new Date().toISOString();
    saveLS(SESS_KEY, session);
    // 记录成绩
    pushHistory();
    // 逐题揭晓
    const cards = QUESTIONS.map(q => qCard(q.no)).filter(Boolean);
    let i = 0;
    function revealNext() {
      if (i >= cards.length) { onRevealComplete(); return; }
      const card = cards[i]; const no = +card.dataset.qno; const q = QUESTIONS.find(x => x.no === no);
      const v = verdictOf(no);
      // 刷新这题的渲染（现在 revealAllowed=true，所以会带上对错标记）
      if (q) card.outerHTML = renderQuestion(q);
      const newCard = qCard(no);
      if (newCard) {
        if (v === 'right') newCard.classList.add('animate-right');
        else if (v === 'wrong') newCard.classList.add('animate-wrong');
        newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        wireSingleCard(no);
      }
      i++;
      setTimeout(revealNext, 280);
    }
    renderBarMode();
    renderAnsheet();
    revealNext();
  }
  function onRevealComplete() {
    submitting = false;
    renderProgress();
    renderScoreCard();
    toast('🎉 判分完成！');
  }

  // ===== 得分卡 =====
  function renderScoreCard() {
    const correct = correctCount(), total = QUESTIONS.length;
    const pct = total ? Math.round(correct / total * 100) : 0;
    const elapsedStr = fmt(elapsed);
    // 每题耗时排序（最慢 2 题）
    const perQ = QUESTIONS.map(q => ({ no: q.no, ms: qs(q.no).ms || 0, type: q.type }));
    perQ.sort((a, b) => b.ms - a.ms);
    const slowest = perQ.slice(0, 2).filter(x => x.ms > 0);
    // 按题型统计
    const typeMap = {};
    QUESTIONS.forEach(q => {
      const t = q.type || '其他';
      if (!typeMap[t]) typeMap[t] = { total: 0, correct: 0 };
      typeMap[t].total++;
      if (verdictOf(q.no) === 'right') typeMap[t].correct++;
    });
    // 与上次对比
    const hist = loadLS(H_KEY, []);
    const prev = hist.slice().reverse().find(h => h.slug === examId && h.at !== session.at);
    const prevPct = prev ? Math.round(prev.correct / prev.total * 100) : null;
    const delta = prevPct !== null ? pct - prevPct : null;
    // 趋势 SVG（近 10 次本篇）
    const sameSlug = hist.filter(h => h.slug === examId).slice(-10);
    const svgHtml = sameSlug.length >= 2 ? trendSvg(sameSlug.map(h => Math.round(h.correct / h.total * 100)), 240, 52) : '';
    let el = document.getElementById('score-card');
    if (!el) {
      el = document.createElement('div');
      el.id = 'score-card';
      el.className = 'score-card';
      const pane = document.querySelector('.pane-questions');
      if (pane) pane.insertBefore(el, document.getElementById('q-list'));
    }
    const cls = pct >= 75 ? 'sc-great' : pct >= 50 ? 'sc-ok' : 'sc-low';
    el.innerHTML =
      '<div class="sc-head"><span class="sc-icon">🎉</span><span class="sc-title">判分结果</span></div>' +
      '<div class="sc-body">' +
      '<div class="sc-big ' + cls + '"><span class="sc-num">' + correct + '</span><span class="sc-sep">/</span><span class="sc-total">' + total + '</span>' +
      '<span class="sc-pct">' + pct + '%</span>' +
      (delta !== null ? '<span class="sc-delta ' + (delta >= 0 ? 'up' : 'down') + '">' + (delta >= 0 ? '▲' : '▼') + Math.abs(delta) + '%</span>' : '') +
      '</div>' +
      '<div class="sc-bar-wrap"><div class="sc-bar ' + cls + '" style="width:' + pct + '%"></div></div>' +
      '<div class="sc-facts">' +
      '<div><span class="sc-k">用时</span><span class="sc-v">' + elapsedStr + '</span></div>' +
      '<div><span class="sc-k">平均耗时</span><span class="sc-v">' + (total ? fmtMs(totalMs() / total) : '--') + '</span></div>' +
      (slowest.length ? '<div class="sc-slowest"><span class="sc-k">最慢</span>' +
        slowest.map(x => '<span class="sc-v">第' + x.no + '题 ' + fmtMs(x.ms) + (x.type ? ' (' + x.type + ')' : '') + '</span>').join('') + '</div>' : '') +
      '</div>' +
      '<div class="sc-types">' + Object.entries(typeMap).map(([t, d]) =>
        '<span class="sc-type-chip"><b>' + esc(t) + '</b> ' + d.correct + '/' + d.total + '</span>').join('') + '</div>' +
      (svgHtml ? '<div class="sc-trend"><span class="sc-k">近 ' + sameSlug.length + ' 次趋势</span>' + svgHtml + '</div>' : '') +
      '<div class="sc-actions">' +
      '<button type="button" class="sc-btn" id="sc-export-btn">⬇ 导出复盘</button>' +
      '<button type="button" class="sc-btn" id="sc-history-btn">📈 全部成绩</button>' +
      '</div></div>';
    el.classList.add('animate-in');
    const expBtn = document.getElementById('sc-export-btn');
    if (expBtn) expBtn.addEventListener('click', exportReview);
    const histBtn = document.getElementById('sc-history-btn');
    if (histBtn) histBtn.addEventListener('click', openHistoryPanel);
  }

  // ===== 趋势折线 SVG =====
  function trendSvg(points, w, h) {
    if (points.length < 2) return '';
    const pad = 6, max = 100;
    const stepX = (w - pad * 2) / Math.max(points.length - 1, 1);
    const pts = points.map((v, i) => (pad + i * stepX) + ',' + (h - pad - (v / max) * (h - pad * 2)));
    const dotPts = points.map((v, i) => '<circle cx="' + (pad + i * stepX) + '" cy="' + (h - pad - (v / max) * (h - pad * 2)) +
      '" r="2.5" fill="' + (v >= 75 ? '#2e7d32' : v >= 50 ? '#ef6c00' : '#c62828') + '"><title>' + v + '%</title></circle>').join('');
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<line x1="' + pad + '" y1="' + (h - pad - 0.75 * (h - pad * 2)) + '" x2="' + (w - pad) + '" y2="' + (h - pad - 0.75 * (h - pad * 2)) + '" stroke="#ccc" stroke-dasharray="3,3" stroke-width="0.5"/>' +
      '<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--en-tag)" stroke-width="1.5" stroke-linejoin="round"/>' +
      dotPts + '</svg>';
  }
  function fmtMs(ms) { return ms >= 60000 ? Math.round(ms / 60000) + '分' + Math.round((ms % 60000) / 1000) + '秒' : (ms / 1000).toFixed(1) + '秒'; }

  // ===== 成绩历史记录 =====
  function pushHistory() {
    const arr = loadLS(H_KEY, []);
    const perQ = QUESTIONS.map(q => {
      const s = qs(q.no);
      return { no: q.no, mine: s.myAnswer || '', right: q.answer, type: q.type || '', ms: s.ms || 0, cause: s.cause || '' };
    });
    arr.push({
      slug: examId, title: articleTitle(), mode: mode, at: session.at,
      correct: correctCount(), total: QUESTIONS.length, elapsed: elapsed,
      perQ: perQ
    });
    saveLS(H_KEY, arr.slice(-200));
  }

  // ===== 成绩历史面板 =====
  function openHistoryPanel() {
    const old = document.getElementById('exam-history-overlay');
    if (old) old.remove();
    const hist = loadLS(H_KEY, []);
    const same = hist.filter(h => h.slug === examId).slice(-10).reverse();
    const all = hist.slice(-100).reverse();
    const overlay = document.createElement('div');
    overlay.className = 'exam-history-overlay';
    overlay.id = 'exam-history-overlay';
    let html = '<div class="eh-box"><div class="eh-head"><h3>📈 成绩记录</h3><button type="button" class="eh-close">✕</button></div>';
    if (same.length >= 2) {
      const pts = same.slice().reverse().map(h => Math.round(h.correct / h.total * 100));
      html += '<div class="eh-section"><div class="eh-label">本篇趋势（近 ' + same.length + ' 次）</div>' + trendSvg(pts, 300, 64) + '</div>';
    }
    html += '<div class="eh-label">本篇记录</div><div class="eh-list">' +
      (same.length ? same.map((h, i) =>
        '<div class="eh-row"><span class="eh-idx">' + (same.length - i) + '</span>' +
        '<span class="eh-pct' + (h.correct / h.total >= 0.75 ? ' g' : '') + '">' + Math.round(h.correct / h.total * 100) + '%</span>' +
        '<span class="eh-score">' + h.correct + '/' + h.total + '</span>' +
        '<span class="eh-mode">' + (h.mode === 'practice' ? '练习' : '考试') + '</span>' +
        '<span class="eh-time">' + fmt(h.elapsed || 0) + '</span>' +
        '<span class="eh-date">' + esc((h.at || '').replace('T', ' ').slice(0, 16)) + '</span></div>'
      ).join('') : '<div class="eh-empty">还没有记录</div>') + '</div>';
    if (all.length > same.length) {
      html += '<div class="eh-label">全部记录（最近 ' + all.length + ' 次）</div><div class="eh-list">' +
        all.map((h, i) =>
          '<div class="eh-row"><span class="eh-idx">' + (all.length - i) + '</span>' +
          '<span class="eh-slug">' + esc(h.slug || '') + '</span>' +
          '<span class="eh-pct">' + Math.round(h.correct / h.total * 100) + '%</span>' +
          '<span class="eh-score">' + h.correct + '/' + h.total + '</span>' +
          '<span class="eh-date">' + esc((h.at || '').replace('T', ' ').slice(0, 16)) + '</span></div>'
        ).join('') + '</div>';
    }
    html += '</div>';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
    overlay.querySelector('.eh-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('exam-history-overlay'))
      document.getElementById('exam-history-overlay').remove();
  });

  // ===== 导出复盘 Markdown =====
  function exportReview() {
    const correct = correctCount(), total = QUESTIONS.length;
    const pct = total ? Math.round(correct / total * 100) : 0;
    let md = '# ' + articleTitle() + ' · 考试复盘\n\n';
    md += '- 日期：' + (session.at || '').replace('T', ' ').slice(0, 16) + '\n';
    md += '- 模式：' + (mode === 'practice' ? '练习态' : '考试态') + '\n';
    md += '- 得分：' + correct + '/' + total + '（' + pct + '%）\n';
    md += '- 用时：' + fmt(elapsed) + '\n\n';
    md += '---\n\n';
    QUESTIONS.forEach(q => {
      const s = qs(q.no); const v = verdictOf(q.no);
      md += '## 第 ' + q.no + ' 题' + (q.type ? ' · ' + q.type : '') + (q.difficulty ? ' [难度：' + q.difficulty + ']' : '') + '\n\n';
      md += '**题干**：' + q.stem + '\n\n';
      md += '**选项**：\n';
      LETTERS.forEach(L => {
        if (!q.options[L]) return;
        const mark = s.myAnswer === L ? ' ← 我的答案' : '';
        const markR = L === q.answer ? ' ✓' : '';
        md += '- ' + L + '. ' + q.options[L] + markR + mark + '\n';
      });
      md += '\n**结果**：' + (v === 'right' ? '✓ 正确' : v === 'wrong' ? '✗ 错误（正确答案 ' + q.answer + '）' : '未作答') + '\n';
      if (s.cause) md += '**错因**：' + (CAUSES.find(c => c[0] === s.cause) || [])[1] + '\n';
      if (s.ms) md += '**耗时**：' + fmtMs(s.ms) + '\n';
      if (s.note) md += '**笔记**：' + s.note + '\n';
      if (q.analysis) md += '\n**解析**：\n' + q.analysis + '\n';
      md += '\n---\n\n';
    });
    const name = 'exam-review-' + examId + '-' + backupStamp() + '.md';
    saveTextFile(name, md);
    toast('⬇ 已导出复盘：' + name);
  }
  // 复用 reader.js 的 backupStamp，若没有则本地兜底
  const _bStamp = typeof backupStamp === 'function' ? backupStamp : function () {
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  };
  function backupStamp() { return _bStamp(); }

  // ===== 本地文件下载（exam.js 不依赖 reader.js） =====
  function saveTextFile(name, content) {
    if (typeof window.showSaveFilePicker === 'function') {
      window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }] })
        .then(fh => fh.createWritable())
        .then(w => { w.write(content); return w.close(); })
        .catch(e => { if (e && e.name !== 'AbortError') downloadFile(name, content, 'text/markdown;charset=utf-8'); });
    } else {
      downloadFile(name, content, 'text/markdown;charset=utf-8');
    }
  }
  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ===== 渲染全部题目 + 事件绑定 =====
  function renderQuestions() {
    const list = document.getElementById('q-list');
    if (!list) return;
    if (QUESTIONS.length === 0) {
      list.innerHTML = '<div class="exam-empty">本篇暂无题目数据</div>';
      return;
    }
    list.innerHTML = QUESTIONS.map(renderQuestion).join('');
    wireQuestionEvents(list);
    renderProgress();
    renderAnsheet();
    renderBarMode();
  }

  function wireQuestionEvents(list) {
    // 事件委托：错因 chip、标记、定位（已绑定则跳过）
    if (!list.dataset.clickWired) {
      list.dataset.clickWired = '1';
      list.addEventListener('click', (e) => {
        const t = e.target, closest = t && t.closest ? t.closest.bind(t) : () => null;
        // 错因 chip
        const chip = closest('.cause-chip');
        if (chip) {
          const no = parseInt(chip.dataset.qno);
          const s = qs(no);
          s.cause = (s.cause === chip.dataset.cause) ? '' : chip.dataset.cause;
          saveQ(); recordExamState(no);
          chip.parentElement.querySelectorAll('.cause-chip').forEach(c =>
            c.classList.toggle('active', c.dataset.cause === s.cause));
          toast(s.cause ? '已标记错因：' + (CAUSES.find(c => c[0] === s.cause) || [])[1] : '已取消错因标记');
          return;
        }
        // 标记待复核
        const markBtn = closest('.qmark');
        if (markBtn) { toggleMark(+markBtn.dataset.mark); return; }
        // 定位原文
        const locChip = closest('.loc-chip');
        if (locChip) { locatePara(+locChip.dataset.loc); return; }
      });
    }
    // 单选
    list.querySelectorAll('input[type="radio"]').forEach(r => {
      r.addEventListener('change', () => {
        const no = parseInt(r.name.slice(1));
        const s = qs(no);
        s.myAnswer = r.value;
        setActive(no);
        saveQ();
        recordExamState(no);
        const card = list.querySelector('.exam-qcard[data-qno="' + no + '"]');
        if (card) {
          card.querySelectorAll('.exam-opt').forEach(o =>
            o.classList.toggle('selected', o.querySelector('input').checked));
          // 练习态即时判分动画
          if (mode === 'practice') {
            const q = QUESTIONS.find(x => x.no === no);
            const isRight = q && r.value === q.answer;
            if (isRight) { card.classList.remove('wrong'); card.classList.add('correct', 'animate-right'); setTimeout(() => card.classList.remove('animate-right'), 600); }
            else { card.classList.remove('correct'); card.classList.add('wrong', 'animate-wrong'); setTimeout(() => card.classList.remove('animate-wrong'), 500); }
            const causeRow = card.querySelector('.exam-cause-row');
            if (causeRow) { causeRow.hidden = false; const lbl = causeRow.querySelector('.cause-label'); if (lbl) lbl.textContent = '🔍 ' + (isRight ? '对题复盘（可标猜对原因）' : '错因'); }
          }
        }
        renderProgress(); renderAnsheet();
      });
    });
    // 笔记
    list.querySelectorAll('.exam-note').forEach(nEl => {
      const no = parseInt(nEl.closest('.exam-qcard').dataset.qno);
      nEl.addEventListener('blur', () => { qs(no).note = nEl.textContent.trim(); saveQ(); });
    });
    // 解析按钮
    list.querySelectorAll('[data-reveal]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('reveal-locked')) { toast('🔒 考试态下需交卷后才能查看解析'); return; }
        const no = parseInt(btn.dataset.reveal);
        const s = qs(no);
        s.revealed = !s.revealed; saveQ();
        const ans = btn.closest('.exam-qcard').querySelector('.exam-answer');
        if (ans) ans.hidden = !s.revealed;
        btn.textContent = s.revealed ? '▲ 收起解析' : '▼ 查看解析';
      });
    });
  }

  // 重新渲染单张卡片（交卷后逐题替换用）
  function wireSingleCard(no) {
    const card = qCard(no); if (!card) return;
    const newQ = QUESTIONS.find(x => x.no === no); if (!newQ) return;
    // 利用事件冒泡：整张卡片的 click 事件已在 renderQuestions 绑定到 list 上
    // 但 radio change 需要重新绑定
    card.querySelectorAll('input[type="radio"]').forEach(r => {
      r.addEventListener('change', () => {
        const qNo = parseInt(r.name.slice(1));
        qs(qNo).myAnswer = r.value; saveQ(); recordExamState(qNo);
      });
    });
    card.querySelectorAll('[data-reveal]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('reveal-locked')) return;
        const qNo = parseInt(btn.dataset.reveal);
        const s = qs(qNo); s.revealed = !s.revealed; saveQ();
        const ans = btn.closest('.exam-qcard').querySelector('.exam-answer');
        if (ans) ans.hidden = !s.revealed;
        btn.textContent = s.revealed ? '▲ 收起解析' : '▼ 查看解析';
      });
    });
  }

  // ===== 重做 =====
  function resetAnswers() {
    if (!confirm('清空本篇的作答与标注？（划线保留）')) return;
    Object.keys(qState).forEach(k => delete qState[k]);
    session.submitted = false; session.at = ''; session.activeNo = 0; session.activeTs = 0;
    saveQ(); saveLS(SESS_KEY, session);
    const sc = document.getElementById('score-card'); if (sc) sc.remove();
    renderQuestions(); renderAnsheet(); renderBarMode();
    toast('作答与标注已清空');
  }

  // ===== Init =====
  document.addEventListener('DOMContentLoaded', () => {
    const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    bind('timer-btn', () => { running ? pauseTimer() : startTimer(); });
    bind('timer-reset-btn', resetTimer);
    bind('limit-btn', toggleLimit);
    bind('theme-btn', window.toggleTheme);
    bind('hl-btn', saveSelectionAsHighlight);
    bind('hl-clear-btn', clearHighlights);
    bind('reset-answers-btn', resetAnswers);
    document.querySelectorAll('.hl-color-btn').forEach(b => {
      b.addEventListener('click', () => {
        hlColor = b.dataset.color || 'hl-y';
        document.querySelectorAll('.hl-color-btn').forEach(x => x.classList.toggle('active', x === b));
      });
    });
    const defColorBtn = document.querySelector('.hl-color-btn[data-color="hl-y"]');
    if (defColorBtn) defColorBtn.classList.add('active');

    const meta = document.getElementById('exam-meta');
    if (meta && window.__EXAM_META__) meta.textContent = window.__EXAM_META__;

    applyAllHighlights();
    renderQuestions();
    renderTimer();
    renderLimit();

    // 如果之前已交卷，重建得分卡
    if (session.submitted) { setTimeout(renderScoreCard, 200); }

    // 空格键控制计时
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !/INPUT|TEXTAREA/.test(e.target.tagName) && !e.target.isContentEditable) {
        e.preventDefault();
        running ? pauseTimer() : startTimer();
      }
    });
    // 页面卸载前保存计时
    window.addEventListener('beforeunload', flushTiming);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushTiming(); });

    initPaperSkin();
  });

  // ===================================================================
  //  考研英语（一）试卷版式
  //  ------------------------------------------------------------------
  //  纯视觉层：只新增/移除自己创建的节点与一个 body class，
  //  不改动任何既有 id / class / data-* 属性，考试交互逻辑零影响。
  //  「📄 试卷版式」按钮可在试卷皮肤与紧凑界面之间切换，偏好记在 localStorage。
  // ===================================================================
  const KAOYAN_OFFSET = 20;   // 考研英语一：Section Ⅰ 完形占 1-20，故 Section Ⅱ Part A 从 21 题起
  const PAPER_SKIN_KEY = 'wsj_exam:paperSkin';
  let paperSkinOn = true;

  function paperSkinSaved() {
    try { return localStorage.getItem(PAPER_SKIN_KEY) !== '0'; } catch (e) { return true; }
  }
  function paperSkinApply(on) {
    paperSkinOn = !!on;
    document.body.classList.toggle('paper-skin', paperSkinOn);
    const b = document.getElementById('paper-skin-btn');
    if (b) b.classList.toggle('active', paperSkinOn);
    try { localStorage.setItem(PAPER_SKIN_KEY, paperSkinOn ? '1' : '0'); } catch (e) {}
  }

  // 题号改成考研式连续编号（21…）。只改显示文本，绝不碰 data-qno / data-as / radio name。
  function kaoyanRenumber() {
    document.querySelectorAll('#q-list .exam-qcard[data-qno]').forEach(card => {
      const n = parseInt(card.dataset.qno, 10);
      const el = card.querySelector('.qno');
      if (el && !isNaN(n)) el.textContent = String(KAOYAN_OFFSET + n);
    });
    document.querySelectorAll('#ansheet [data-as]').forEach(btn => {
      const n = parseInt(btn.dataset.as, 10);
      if (!isNaN(n)) btn.textContent = String(KAOYAN_OFFSET + n);
    });
  }

  // renderQuestions / renderAnsheet 每次都会重建 DOM，故用 MutationObserver 跟随重编号。
  // 注意只观察直接子节点（subtree:false）：重编号改的是更深层的文本，不会回环触发。
  function paperSkinObserve() {
    const pq = document.querySelector('.pane-questions');
    if (pq && !pq.dataset.rw) {
      pq.dataset.rw = '1';
      new MutationObserver(() => { kaoyanRenumber(); paperSkinObserve(); }).observe(pq, { childList: true });
    }
    ['q-list', 'ansheet'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.dataset.rw) {
        el.dataset.rw = '1';
        new MutationObserver(kaoyanRenumber).observe(el, { childList: true });
      }
    });
  }

  function initPaperSkin() {
    const bar = document.querySelector('.exam-bar');
    const main = document.querySelector('.exam-main');
    if (!bar || !main) return;

    // ---- 试卷头 ----
    if (!document.querySelector('.exam-paperhead')) {
      const head = document.createElement('section');
      head.className = 'exam-paperhead';
      head.innerHTML =
        '<div class="eph-secret">绝密★启用前</div>' +
        '<h1 class="eph-title">2026 年全国硕士研究生招生考试</h1>' +
        '<div class="eph-sub">英　语（一）</div>' +
        '<div class="eph-code">（科目代码：201　试题册）</div>' +
        '<div class="eph-notes"><b>考 生 注 意 事 项</b><ol>' +
        '<li>答题前，考生须在答题卡指定位置填写本人姓名、考生编号等信息，并仔细核对条形码上的信息是否与本人相符。</li>' +
        '<li>选择题的答案须用 2B 铅笔填涂在答题卡上；其他题目的答案须用 0.5 毫米黑色字迹签字笔写在答题卡指定区域内。</li>' +
        '<li>本部分为 Section Ⅱ Reading Comprehension（Part A），共 5 小题，每小题 2 分，共 10 分。</li>' +
        '</ol></div>' +
        '<div class="eph-cut"><span>考生编号</span><i></i><span>姓　　名</span><i></i>' +
        '<b>密　封　线　内　不　要　答　题</b></div>';
      main.parentNode.insertBefore(head, main);
    }

    // ---- 左栏分节标题（考研试卷的 Section / Part / Directions / Text） ----
    const pa = document.querySelector('.pane-article');
    if (pa && !pa.querySelector('.paper-sec')) {
      pa.insertAdjacentHTML('afterbegin',
        '<div class="paper-sec">' +
        '<div class="ps-line"><span class="ps-main">Section Ⅱ　Reading Comprehension</span></div>' +
        '<div class="ps-part">Part A</div>' +
        '<div class="ps-dir">Directions: Read the following text and answer the questions by choosing ' +
        'A, B, C or D. Mark your answers on the ANSWER SHEET. (10 points)</div>' +
        '<div class="ps-text">Text 1</div>' +
        '</div>');
    }

    // ---- 右栏分节标题 ----
    const pq = document.querySelector('.pane-questions');
    if (pq && !pq.querySelector('.paper-sec')) {
      const n = (typeof QUESTIONS !== 'undefined' && QUESTIONS.length) ? QUESTIONS.length : 5;
      const sec = document.createElement('div');
      sec.className = 'paper-sec';
      sec.innerHTML = '<div class="ps-line"><span class="ps-main">试　　题</span></div>' +
        '<div class="ps-dir">Questions ' + (KAOYAN_OFFSET + 1) + ' – ' + (KAOYAN_OFFSET + n) +
        ' are based on the text on the left.</div>';
      pq.insertBefore(sec, pq.firstChild);
    }

    // ---- 页脚 ----
    if (!document.querySelector('.exam-paperfoot')) {
      const n = (typeof QUESTIONS !== 'undefined' && QUESTIONS.length) ? QUESTIONS.length : 5;
      const foot = document.createElement('footer');
      foot.className = 'exam-paperfoot';
      foot.innerHTML = '<span>英　语（一）　Section Ⅱ　Reading Comprehension</span>' +
        '<span>第 ' + (KAOYAN_OFFSET + 1) + ' — ' + (KAOYAN_OFFSET + n) + ' 题</span>' +
        '<span>共 1 页</span>';
      document.body.appendChild(foot);
    }

    // ---- 版式开关 ----
    if (!document.getElementById('paper-skin-btn')) {
      const b = document.createElement('button');
      b.id = 'paper-skin-btn';
      b.type = 'button';
      b.title = '在「考研试卷版式」与「紧凑界面」之间切换';
      b.textContent = '📄 试卷版式';
      const anchor = document.getElementById('reset-answers-btn') || document.getElementById('theme-btn');
      if (anchor) bar.insertBefore(b, anchor); else bar.appendChild(b);
      b.addEventListener('click', () => paperSkinApply(!paperSkinOn));
    }

    paperSkinApply(paperSkinSaved());
    kaoyanRenumber();
    paperSkinObserve();
    setTimeout(paperSkinObserve, 400);   // #ansheet 是懒创建的，稍后再挂一次观察
  }
})();
