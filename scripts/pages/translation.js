(function () {
  document.body.classList.add('page-translation');
  // 注入隐藏左栏的样式（与完形/新题型一致：右栏已含原文，左栏多余）
  (function injectHideCSS() {
    const s = document.createElement('style');
    s.textContent = 'body.page-translation .pane-article{display:none!important}' +
      'body.page-translation .pane-questions{flex:1 1 100%;max-width:840px;margin:0 auto;padding:22px 28px 80px}' +
      'body.page-translation .tr-tools{position:sticky;top:0;z-index:6;background:var(--bg);' +
      'padding:8px 0 10px;margin-bottom:12px;border-bottom:1px solid var(--rule)}';
    document.head.appendChild(s);
  })();
  const slug = document.body.dataset.examId || 'translation';
  const KEY = 'transq:' + slug;
  const T_KEY = 'transtimer:' + slug;

  function loadLS(k, f) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch (e) { return f; } }
  function saveLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  const QUESTIONS = (window.__TRANSLATION_QUESTIONS__ || []).map((q, i) => ({
    no: i + 1, para: q.para || '', en: q.en || '', split: q.split || '',
    ref: q.ref || '', points: q.points || '', difficulty: q.difficulty || ''
  }));
  const SCORES = [0, 1, 2]; // 自评 0/1/2 分

  // ===== Theme =====
  function applyTheme() {
    let t = 'green';
    try { t = localStorage.getItem('wsj_exam:theme') || 'green'; } catch (e) {}
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

  // ===== Timer (persisted) =====
  let elapsed = (loadLS(T_KEY, null) || {}).elapsed || 0;
  let running = false, tickIv = null;
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
  }
  function startTimer() {
    if (running) return;
    running = true;
    tickIv = setInterval(() => { elapsed++; renderTimer(); if (elapsed % 5 === 0) saveLS(T_KEY, { elapsed }); }, 1000);
    renderTimer();
  }
  function pauseTimer() {
    running = false;
    if (tickIv) { clearInterval(tickIv); tickIv = null; }
    saveLS(T_KEY, { elapsed });
    renderTimer();
  }

  // ===== State =====
  let state = loadLS(KEY, {}); // { [no]: { answer, revealed, score } }
  function st(no) { if (!state[no]) state[no] = { answer: '', revealed: false, score: -1 }; return state[no]; }
  function save() { saveLS(KEY, state); }

  function answeredCount() { return QUESTIONS.filter(q => (st(q.no).answer || '').trim()).length; }
  function scoredCount() { return QUESTIONS.filter(q => st(q.no).score >= 0); }
  function totalScore() { return scoredCount().reduce((s, q) => s + st(q.no).score, 0); }
  function renderProgress() {
    const el = document.getElementById('exam-progress');
    if (!el) return;
    const done = answeredCount(), scored = scoredCount().length, total = QUESTIONS.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    if (done === 0) { el.textContent = '未作答'; return; }
    el.innerHTML = '<span class="nt-progress-text">' + done + '/' + total + ' 已译</span>' +
      '<span class="nt-progress-bar"><span class="nt-progress-fill" style="width:' + pct + '%"></span></span>' +
      (scored > 0 ? '<span class="nt-progress-tag">自评 ' + totalScore() + '/' + (scored * 2) + ' 分</span>' : '');
  }

  // ===== Render =====

  // v26: 把 split 字段解析成可视化色块
  function renderStructure(split) {
    if (!split || !split.trim()) return '<span style="color:var(--muted);font-size:12px;">（无拆分数据）</span>';
    const COLOR_MAP = [
      { re: /^(主干|主句|主s*谓s*宾|主s*谓)/, color: '#1a3a6c', tag: '主干' },
      { re: /^(从句|定语从句|状语从句|宾语从句|主语从句|同位语从句)/, color: '#2e7d32', tag: '从句' },
      { re: /^(修饰|定语|状语|补语|插入|插入语|介词短语|分词短语|不定式|现在分词|过去分词)/, color: '#ef6c00', tag: '修饰' },
      { re: /^(并列|并列分句|并列谓语|并列宾语|并列主语)/, color: '#7a8599', tag: '并列' },
      { re: /^(主|谓|宾|定|状|补|表|同位|连|插入|从)/, color: '#8b5cf6', tag: '成分' }
    ];
    const parts = split.split('｜').filter(p => p.trim());
    const htmls = parts.map((p, i) => {
      // 提取角色名（"角色："前的部分）
      const m = p.match(/^([^：:]+)[：:]/);
      const role = m ? m[1].trim() : ('分段' + (i + 1));
      const rest = m ? p.substring(m[0].length).trim() : p.trim();
      // 找匹配颜色
      let color = '#7a8599';  // 默认灰
      for (const cm of COLOR_MAP) {
        if (cm.re.test(role)) { color = cm.color; break; }
      }
      // v27: 提取英文片段（"；"拆子段；去成对括号注释；保留 ...）
      const fragments = [];
      rest.split(/[；;]/).forEach(sub => {
        const clean = sub.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '')
                          .replace(/[.,;:!?]+$/, '').trim();
        if (clean.length >= 4 && /[a-zA-Z]{3,}/.test(clean)) fragments.push(clean);
      });
      const fragAttr = fragments.length > 0
        ? ' data-orig-fragment="' + esc(fragments.join(' || ')) + '"'
        : '';
      const clickable = fragments.length > 0 ? ' clickable' : ' unmatched';
      // 简短显示（前 30 字 + "..."）
      const short = rest.length > 30 ? rest.substring(0, 30) + '…' : rest;
      const full = esc(rest);
      const tip = fragments.length > 0
        ? '点击高亮原文对应片段（共 ' + fragments.length + ' 处）\n角色：' + esc(role) + '\n内容：' + full
        : '该分段无英文片段可联动\n角色：' + esc(role) + '\n内容：' + full;
      return '<div class="tr-struct-block' + clickable + '"' + fragAttr +
        ' style="border-left:4px solid ' + color + ';" title="' + tip + '">' +
        '<span class="tr-struct-role" style="color:' + color + ';">' + esc(role) + '</span>' +
        '<span class="tr-struct-text">' + esc(short) + '</span>' +
      '</div>';
    });
    return '<div class="tr-structure-flow">' + htmls.join('') + '</div>' +
      '<div style="font-size:11px;color:var(--muted);margin-top:6px;">💡 悬停看完整拆分；点击色块联动高亮原文对应片段</div>';
  }

  // v27: 点击色块 → 在该题原文 .tr-original 中高亮对应片段 + 滚动
  function highlightFragment(card, blockEl) {
    const raw = blockEl.getAttribute('data-orig-fragment');
    if (!raw) return;
    const origEl = card.querySelector('.tr-original');
    if (!origEl) return;
    const enText = origEl.textContent;
    const fragments = raw.split(' || ').filter(Boolean);
    if (fragments.length === 0) return;
    clearHighlights(card);
    let firstMark = null;
    let totalMatched = 0;
    fragments.forEach(frag => {
      const matched = tryMatch(enText, frag);
      if (!matched) return;
      totalMatched++;
      wrapMatchInText(origEl, matched.start, matched.end, matched.text);
      if (!firstMark) {
        const m = origEl.querySelector('.tr-highlight');
        if (m) firstMark = m;
      }
    });
    if (firstMark) firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (totalMatched === 0) {
      flashTip(blockEl, '原文未找到该片段（可能跨段）');
    } else {
      flashTip(blockEl, '✓ 已高亮 ' + totalMatched + ' 处原文片段');
      setTimeout(() => clearHighlights(card), 2200);
    }
  }
  function tryMatch(enText, frag) {
    // 1) 直接子串
    let i = enText.indexOf(frag);
    if (i >= 0) return { start: i, end: i + frag.length, text: frag };
    // 2) 空白归一
    const normEn = enText.replace(/\s+/g, ' ');
    const normFrag = frag.replace(/\s+/g, ' ');
    i = normEn.indexOf(normFrag);
    if (i >= 0) {
      const rawStart = mapNormToRaw(enText, i);
      const rawEnd = mapNormToRaw(enText, i + normFrag.length);
      return { start: rawStart, end: rawEnd, text: enText.substring(rawStart, rawEnd) };
    }
    // 3) ... 模糊正则
    try {
      const ELLIP = '\u0000ELLIP\u0000';
      const safeFrag = frag.replace(/[.*+?${}()|[\]\\]/g, '\\$&').replace(/\.\.\./g, ELLIP);
      const re = new RegExp(safeFrag.replace(new RegExp(ELLIP, 'g'), '[\\s\\S]{0,80}?'));
      const m = enText.match(re);
      if (m) return { start: m.index, end: m.index + m[0].length, text: m[0] };
    } catch (e) {}
    return null;
  }
  function mapNormToRaw(raw, normIdx) {
    let i = 0, n = 0;
    while (i < raw.length && n < normIdx) {
      if (/\s/.test(raw[i])) {
        while (i < raw.length && /\s/.test(raw[i])) i++;
        n++;
      } else {
        i++; n++;
      }
    }
    return i;
  }
  function wrapMatchInText(el, start, end, matchedText) {
    const fullText = el.textContent;
    const before = fullText.substring(0, start);
    const mid = fullText.substring(start, end);
    const after = fullText.substring(end);
    el.innerHTML = esc(before) + '<mark class="tr-highlight">' + esc(mid) + '</mark>' + esc(after);
  }
  function clearHighlights(scope) {
    const marks = scope.querySelectorAll('.tr-highlight');
    marks.forEach(m => {
      const parent = m.parentNode;
      if (!parent) return;
      const text = document.createTextNode(m.textContent);
      parent.replaceChild(text, m);
      parent.normalize();
    });
  }
  function flashTip(blockEl, msg) {
    const tip = document.createElement('span');
    tip.className = 'tr-struct-flash';
    tip.textContent = msg;
    tip.style.cssText = 'position:absolute;background:var(--en-tag);color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;z-index:99;pointer-events:none;top:-22px;left:0;';
    blockEl.style.position = 'relative';
    blockEl.appendChild(tip);
    setTimeout(() => { if (tip.parentNode) tip.remove(); }, 1400);
  }

  function renderQuestion(q) {
    const s = st(q.no);
    const paraLabel = q.para ? '<span class="tr-para">原文第 ' + q.para + ' 段</span>' : '';
    let back = '';
    if (s.revealed) {
      // 5 层解析结构（与 cloze.js / newtype.js 一致），使用现有 .tr-* 类样式
      back = '<div class="tr-back">' +
        // Layer 1: 题型标签 + 难度（v25+ 加 4 步答题流程 + 6 大翻译技巧）
        '<div class="tr-block"><span class="tr-label">📌 题型</span><div class="tr-points">' +
        '<b>英译汉长难句</b> · 难度：' + (q.difficulty || '中') + '<br>' +
        '考点：英汉树形 vs 竹形结构差异、主语确定、被动转主动、显化连接词、词性切换</div></div>' +
        '<div class="tr-block"><span class="tr-label">📝 4 步答题流程</span><div class="tr-points">' +
        '<b>① 通读全文</b>：理解大意 + 主题体裁（不要逐字翻译）<br>' +
        '<b>② 拆分定位</b>：找主干（主谓宾 / 主系表）+ 修饰（定状补）<br>' +
        '<b>③ 选择词义</b>：根据上下文选词（特别一词多义）+ 转换词性<br>' +
        '<b>④ 通读检查</b>：检查漏译 / 错译 / 中文表达通顺性' +
        '</div></div>' +
        '<div class="tr-block"><span class="tr-label">🎯 6 大翻译技巧</span><div class="tr-points">' +
        '<b>① 增译法</b>：补充英文省略的部分（如范畴词"问题/情况/状态"）<br>' +
        '<b>② 减译法</b>：省略英文冠词 / 代词 / 连词（中文不需要）<br>' +
        '<b>③ 词性转换</b>：英名→中动 / 英形→中副（灵活变通）<br>' +
        '<b>④ 语序调整</b>：英语定语从句后置→中文前置 / 状语位置调整<br>' +
        '<b>⑤ 被动转主动</b>：英文被动→中文主动（更自然）<br>' +
        '<b>⑥ 分译与合译</b>：英语长句拆成几个中文短句（分）/ 短句合并（合）' +
        '</div></div>' +
        // Layer 2: 考点定位（基于 split 已有数据）
        '<div class="tr-block"><span class="tr-label">🔍 拆分定位</span><div class="tr-split">' +
        q.split.split('｜').map(x => '<div>' + esc(x) + '</div>').join('') +
        '</div></div>' +
        // Layer 3: 参考译文
        '<div class="tr-block"><span class="tr-label">📖 参考译文</span><div class="tr-ref">' + esc(q.ref) + '</div></div>' +
        // Layer 4: 评分要点（要点分点列出）
        '<div class="tr-block"><span class="tr-label">⭐ 评分要点</span><div class="tr-points">' + esc(q.points).replace(/；/g, '；<br>') + '</div></div>' +
        // Layer 5: 易错点（干扰项）
        '<div class="tr-block"><span class="tr-label">⚠ 易错点</span><div class="tr-points" style="color:var(--fg);">' +
        '本题最易踩的 3 类坑：超长定语堆砌、直接直译不按中文语序、主语缺失/错位。建议先把句子的"谁做了什么"找准，再把修饰各回各家。' +
        '</div></div>' +
        // Layer 5.5 (v25+): 4 档评分细则（考研英语一 10 分制）
        '<div class="tr-block"><span class="tr-label">📊 4 档评分细则</span><div class="tr-points" style="color:var(--fg);">' +
        '<b>第1档（9-10 分）</b>：理解准确无误 / 表达通顺清楚 / 没有错译漏译<br>' +
        '<b>第2档（6-8 分）</b>：理解基本准确 / 表达比较通顺 / 没有重大错译漏译<br>' +
        '<b>第3档（3-5 分）</b>：理解原文不够准确 / 表达欠通顺 / 有明显漏译错译<br>' +
        '<b>第4档（1-2 分）</b>：不能理解原文 / 表达不通顺 / 文字支离破碎' +
        '</div></div>' +
        // Layer 5.6 (v26+): 长难句拆分可视化
        '<div class="tr-block"><span class="tr-label">🌳 句子结构</span><div class="tr-structure">' +
        renderStructure(q.split) +
        '</div></div>' +
        // Layer 6 (v23+): 知识扩展
        '<div class="tr-block"><span class="tr-label">🔗 知识扩展</span><div class="tr-points">' +
        '长难句翻译 = <b>结构识别</b> + <b>顺序调整</b> + <b>词性切换</b>。<br>' +
        '① 找主干（主谓宾 / 主系表）② 找修饰（定状补）③ 按中文"竹形"重组<br>' +
        '同类句型训练：找 3 个含 25+ 词的真题长难句，先做"主干提取"再动笔翻译，准确率会显著提升。' +
        '</div></div>' +
        // Layer 7 (v23+): 复习提示
        '<div class="tr-block"><span class="tr-label">📌 复习提示</span><div class="tr-points">' +
        '<b>本周重点</b>：① 背熟 5 个高频长难句连接词（however / therefore / although / while / because）<br>' +
        '② 复习定语从句 3 种译法（前置 / 后置 / 融合）<br>' +
        '③ 做 1 篇真题翻译，重点对照"易错点"3 项' +
        '</div></div>' +
        '</div>';
    }
    const grade = s.revealed ? (
      '<div class="tr-grade"><span class="tr-glabel">自评（满分 2 分）：</span>' +
      SCORES.map(n => '<button type="button" class="tr-gbtn' + (s.score === n ? ' active g' + n : '') + '" data-gno="' + q.no + '" data-gval="' + n + '">' +
        (n === 0 ? '✗ 未达意 0分' : n === 1 ? '◐ 基本达意 1分' : '✓ 信达雅 2分') + '</button>').join('') +
      '</div>') : '';
    return '<div class="tr-qcard' + (s.score >= 0 ? ' scored' : '') + '" data-qno="' + q.no + '">' +
      '<div class="tr-qhead"><span class="tr-qno">第' + q.no + '题（2分）</span>' + paraLabel +
      '<button type="button" class="tr-reveal" data-reveal="' + q.no + '">' + (s.revealed ? '▲ 收起参考' : '▼ 对照参考') + '</button></div>' +
      '<div class="tr-original">' + esc(q.en) + '</div>' +
      '<textarea class="tr-answer" data-ans="' + q.no + '" rows="3" placeholder="在此输入你的译文……（作答后再对照参考）" spellcheck="false">' + esc(s.answer || '') + '</textarea>' +
      back + grade +
      '</div>';
  }

  function renderAll() {
    const list = document.getElementById('q-list');
    if (!list) return;
    if (QUESTIONS.length === 0) {
      list.innerHTML = '<div class="exam-empty">本篇暂无翻译题目数据</div>';
      return;
    }
    const allRevealed = QUESTIONS.length > 0 && QUESTIONS.every(q => st(q.no).revealed);
    list.innerHTML = '<div class="tr-headline">翻译练习（共10分）</div>' +
      '<div class="tr-tools"><button type="button" class="tr-btn" id="tr-reveal-all">' +
      (allRevealed ? '📖 收起全部答案' : '📖 查看全部答案（参考译文 + 结构拆分 + 评分要点）') + '</button></div>' +
      QUESTIONS.map(renderQuestion).join('');
    // wiring
    list.querySelectorAll('[data-ans]').forEach(ta => {
      ta.addEventListener('input', () => {
        const no = parseInt(ta.dataset.ans);
        st(no).answer = ta.value; save(); renderProgress();
      });
    });
    list.querySelectorAll('[data-reveal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const no = parseInt(btn.dataset.reveal);
        const s = st(no);
        s.revealed = !s.revealed;
        save(); renderAll();
        const card = list.querySelector('.tr-qcard[data-qno="' + no + '"]');
        if (card && s.revealed) {
          const backEl = card.querySelector('.tr-back');
          if (backEl) backEl.classList.add('animate-in');
          card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          const ta = card.querySelector('.tr-answer');
          if (ta) ta.focus();
        }
      });
    });
    list.querySelectorAll('[data-gval]').forEach(btn => {
      btn.addEventListener('click', () => {
        const no = parseInt(btn.dataset.gno);
        const score = parseInt(btn.dataset.gval);
        st(no).score = score;
        save(); renderAll(); renderProgress();
        // 错题字典 + 成绩历史（接 exam.js）
        try {
          // 根据自评分（0=未达意，1=基本达意，2=信达雅）记录错题
          if (score < 2) {
            const wrongs = JSON.parse(localStorage.getItem('wsj_translation:wrongs') || '[]');
            const key = slug + '#' + no;
            const data = {
              key, slug, mode: 'translation',
              no, score, myAnswer: st(no).answer || '',
              ref: QUESTIONS.find(q => q.no === no)?.ref || '',
              // T11: 错题本就地重做所需（英文原句）
              en: (QUESTIONS.find(q => q.no === no) || {}).en || '',
              cause: score === 0 ? '误译' : '粗心',
              at: new Date().toISOString()
            };
            const existing = wrongs.find(r => r.key === key);
            if (existing) Object.assign(existing, data); else wrongs.push(data);
            localStorage.setItem('wsj_translation:wrongs', JSON.stringify(wrongs));
          }
          // 成绩历史（用户每次评分时记录）
          const history = JSON.parse(localStorage.getItem('wsj_exam:history') || '[]');
          const allScored = QUESTIONS.every(q => st(q.no).score >= 0);
          if (allScored) {
            const tot = QUESTIONS.reduce((s, q) => s + (st(q.no).score >= 0 ? st(q.no).score : 0), 0);
            history.push({
              slug, mode: 'translation',
              correct: tot, total: QUESTIONS.length * 2,
              at: new Date().toISOString()
            });
            localStorage.setItem('wsj_exam:history', JSON.stringify(history.slice(-50)));
          }
        } catch (e) { /* 静默失败 */ }
      });
    });
    // v27: 拆分色块点击联动高亮原文（事件委托）
    list.addEventListener('click', (e) => {
      const block = e.target.closest('.tr-struct-block.clickable');
      if (!block) return;
      const card = block.closest('.tr-qcard');
      if (!card) return;
      highlightFragment(card, block);
    });
    // 查看/收起全部答案：按当前状态切换（标签由 renderAll 根据状态渲染）
    const revealAllBtn = list.querySelector('#tr-reveal-all');
    if (revealAllBtn) {
      revealAllBtn.addEventListener('click', () => {
        const allRev = QUESTIONS.every(q => st(q.no).revealed);
        QUESTIONS.forEach(q => { st(q.no).revealed = !allRev; });
        save(); renderAll();
        if (!allRev) {
          // 逐题错开滑入
          const backs = list.querySelectorAll('.tr-back');
          backs.forEach((el, i) => setTimeout(() => el.classList.add('animate-in'), i * 110));
        }
      });
    }
    renderProgress();
  }

  function resetAll() {
    if (!confirm('清空本篇的全部译文与自评？（计时保留）')) return;
    state = {};
    save();
    renderAll();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    bind('timer-btn', () => { running ? pauseTimer() : startTimer(); });
    bind('timer-reset-btn', () => { pauseTimer(); elapsed = 0; saveLS(T_KEY, { elapsed }); renderTimer(); });
    bind('reset-answers-btn', resetAll);
    bind('theme-btn', window.toggleTheme);
    renderAll();
    renderTimer();
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !/INPUT|TEXTAREA/.test(e.target.tagName) && !e.target.isContentEditable) {
        e.preventDefault();
        running ? pauseTimer() : startTimer();
      }
    });
  });
})();
