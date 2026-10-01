(function () {
  document.body.classList.add('page-newtype');
  // 注入隐藏左栏的样式（不依赖外部 CSS 的 class 选择器，确保生效）
  // 同时把标签页+操作栏吸顶：交卷按钮原来在页面顶部，答到下面时就看不见了
  (function injectHideCSS() {
    const s = document.createElement('style');
    s.textContent =
      'body.page-newtype .pane-article{display:none!important}' +
      'body.page-newtype .pane-questions{flex:1 1 100%;max-width:780px;margin:0 auto;padding:22px 28px 80px}' +
      'body.page-newtype .nt-tabs{position:sticky;top:0;z-index:7;background:var(--bg);' +
      'padding:8px 0 8px;margin-bottom:10px;border-bottom:1px solid var(--rule)}' +
      'body.page-newtype .nt-tools{position:sticky;top:52px;z-index:6;background:var(--bg);' +
      'padding:8px 0 10px;margin-bottom:12px;border-bottom:1px solid var(--rule)}' +
      'body.page-newtype .nt-hint{align-self:center;font-size:12px;color:var(--muted);margin-left:4px}';
    document.head.appendChild(s);
  })();
  const slug = document.body.dataset.examId || 'newtype';
  const KEY = 'nt:' + slug;

  // 启动即恢复主题（绿金默认 → 暗色 → 亮色）
  (function applyTheme() {
    let t = 'green';
    try { t = localStorage.getItem('wsj_exam:theme') || 'green'; } catch (e) {}
    if (t === 'dark' || t === 'green' || t === 'blue-gold') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  })();
  const WORD_RE = /[A-Za-z][A-Za-z'-]*/g;
  const lower = w => String(w || '').toLowerCase().replace(/^['-]+|['-]+$/g, '');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  // 测试钩子：在核心函数定义后尽早暴露（不被后续 buildAndRender 异常影响）。仅 ?test=1 触发。
  if (typeof window !== 'undefined' && new URLSearchParams(location.search).get('test') === '1') {
    window.__NT__ = window.__NT__ || {};
    window.__NT__.mulberry32 = mulberry32;
    window.__NT__.shuffle = (typeof shuffle === 'function' ? shuffle : null);
  }
  function shuffle(arr, rnd) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const FUNCTION_WORDS = new Set('the a an and or but if of in to for with on at by from as that this these those it its their there here when where why how what while because although though since until unless whereas whether nor is are was were be been being have has had do does did not no so than then very more most much many some any only just about into over under between among through during before after above below out up down off again once all both each few other another own same too also'.split(' '));
  function words(t) { return (t.match(WORD_RE) || []).map(lower); }
  function contentOverlap(a, b) {
    const wa = words(a).filter(w => !FUNCTION_WORDS.has(w) && w.length > 3);
    const setb = new Set(words(b));
    const hits = [];
    wa.forEach(w => { if (setb.has(w) && hits.indexOf(w) < 0) hits.push(w); });
    return hits;
  }
  function myVocab() {
    const set = new Set();
    try {
      const arr = JSON.parse(localStorage.getItem('annotations:' + slug) || '[]');
      (Array.isArray(arr) ? arr : []).forEach(a => {
        if (a && a.bucket === 'vocab' && a.text) String(a.text).toLowerCase().replace(/[^a-z'\- ]+/g, ' ').split(/\s+/).forEach(w => { if (w.length > 2) set.add(w); });
      });
    } catch (e) {}
    return set;
  }

  const PARAS = (window.__CLOZE_PARAS__ || []);
  const DEMO_ANAPHORA = /^(this|these|that|those|it|they|such|he|she)\b/i;
  const DEMO_CONN = /^(but|however|yet|still|instead|rather|therefore|thus|so|also|indeed|meanwhile|moreover|nevertheless|even)\b/i;
  const LETTERS = 'ABCDEFG';

  let state = loadLS();
  let exam = null;
  function loadLS() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function saveLS() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function curSt() { const t = state.type || 'A'; if (!state[t]) state[t] = { picks: {} }; return state[t]; }

  // picks schema 版本控制：算法/题结构变更时递增 SCHEMA_VERSION，触发旧 picks 数据自动重置
  // 用户的 picks/done/right 与 seed 强绑定，算法一改就错位，必须显式失效旧数据
  const SCHEMA_VERSION = 1;
  if (state.schemaVersion !== SCHEMA_VERSION) {
    state.schemaVersion = SCHEMA_VERSION;
    ['A','B','C','D'].forEach(k => {
      if (state[k]) { state[k].picks = {}; state[k].done = false; state[k].right = null; }
    });
    saveLS();
  }

  // 缩写点保护 + 句切分（所有句子切分统一走这里，防止 U.S. 等被切成残句）
  function protectAbbr(t) {
    return t.replace(/\b(U\.S|U\.K|Mr|Dr|Ms|Mrs|Prof|e\.g|i\.e|vs|Inc|Corp|Ph\.D|D\.C|St|Rev|Sen|Gen|Col)\./g, '$1\u0001');
  }
  function splitSents(protectedText) {
    return (protectedText.match(/[^.!?]+[.!?]+(\s|$)/g) || [protectedText])
      .map(x => x.replace(/\u0001/g, '.').trim());
  }

  // ============ Type A: 七选五 ============

  // 七选五挖空 5 种衔接类型（按考研真题分布）
  // - ANAPHORA（指代衔接）30%：空句以 this/that/these/it/they/such 开头
  // - LOGIC（逻辑衔接）25%：空句以 but/however/yet/still/because/therefore 开头
  // - REPETITION（词汇复现）20%：空句含与上下文重复的核心词
  // - THEME（段落主旨）15%：空句是段首或段尾主旨句
  // - EXAMPLE（例证）10%：空句以 for example/instance/consider/say 开头
  const HOLE_TYPES_A = [
    { code: 'ANAPHORA', weight: 30, regex: DEMO_ANAPHORA },
    { code: 'LOGIC',    weight: 25, regex: DEMO_CONN },
    { code: 'REPETITION', weight: 20, regex: null },  // 通过词汇复现检测
    { code: 'THEME',    weight: 15, regex: null },  // 通过位置检测（首/末句）
    { code: 'EXAMPLE',  weight: 10, regex: /^(for example|for instance|consider|take|suppose|imagine|say|said|notably|indeed)\b/i },
  ];
  const DEMO_EXAMPLE_RE = /^(for example|for instance|consider|take|suppose|imagine|say|said|notably|indeed)\b/i;

  function classifyHoleType(s, prev, next, position) {
    if (DEMO_ANAPHORA.test(s)) return 'ANAPHORA';
    if (DEMO_CONN.test(s)) return 'LOGIC';
    if (DEMO_EXAMPLE_RE.test(s)) return 'EXAMPLE';
    if (position === 'first' || position === 'last') return 'THEME';
    // REPETITION：与 prev 或 next 有 ≥ 2 个非功能词复现
    const ovPrev = contentOverlap(s, prev);
    const ovNext = contentOverlap(s, next);
    if (ovPrev.length >= 2 || ovNext.length >= 2) return 'REPETITION';
    return null;  // 待 fallback
  }

  function genA(seedN) {
    const rnd = mulberry32(555 + seedN * 104729);
    const vocab = myVocab();
    // 窗口：连续段 130-220 词、句数>=8
    let win = null;
    for (const [minWC, minSent] of [[130, 8], [110, 6]]) {
      for (let i = 0; i < PARAS.length && !win; i++) {
        for (let j = i + 1; j <= PARAS.length; j++) {
          const text = PARAS.slice(i, j).join(' ');
          const wc = words(text).length;
          const sents = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [];
          if (wc > 230) break;
          if (wc >= minWC && sents.length >= minSent) { win = { text, sents, start: i, end: j }; break; }
        }
      }
      if (win) break;
    }
    if (!win) { // 兜底：最长单段
      let best = PARAS[0] || '';
      PARAS.forEach(p => { if (words(p).length > words(best).length) best = p; });
      win = { text: best, sents: best.match(/[^.!?]+[.!?]+(\s|$)/g) || [best], start: 0, end: PARAS.length };
    }
    // 保护缩写点（U.S. / Mr. 等），避免句切分把缩写当句号产生残句
    const rawText = protectAbbr(win.text);
    const sents = splitSents(rawText);
    if (sents.length < 5) return null;

    // 5 种挖空类型：按权重分配，每种至少 1 个（如果能找到）
    const sentsLen = sents.length;
    const usedIdx = new Set();
    const holes = [];
    const targetTypes = ['ANAPHORA', 'LOGIC', 'REPETITION', 'THEME', 'EXAMPLE'];

    for (const tcode of targetTypes) {
      if (holes.length >= 5) break;
      // 找该类型的候选句
      const candidates = [];
      for (let i = 0; i < sentsLen && !usedIdx.has(i); i++) {
        if (i === 0 && tcode !== 'THEME') continue;  // 首句只作为 THEME
        const s = sents[i];
        if (words(s).length < 6 || words(s).length > 34) continue;
        const prev = sents[i - 1] || '';
        const next = sents[i + 1] || '';
        const position = i === 0 ? 'first' : (i === sentsLen - 1 ? 'last' : 'mid');
        const actualType = classifyHoleType(s, prev, next, position);
        if (actualType === tcode) {
          candidates.push({ i, s, demo: tcode });
        }
      }
      if (candidates.length > 0) {
        // 用 pickIndex 避开 mulberry32 精度问题（取随机候选）
        const pick = candidates[pickIndex(rnd, candidates.length)];
        holes.push(pick);
        usedIdx.add(pick.i);
      }
    }

    // 兜底：如果 5 个类型没填满，用 fallback（任意非首句、≥ 6 词的句子）
    if (holes.length < 5) {
      const fbCandidates = [];
      for (let i = 0; i < sentsLen; i++) {
        if (i === 0 || usedIdx.has(i)) continue;
        const s = sents[i];
        if (words(s).length < 6) continue;
        fbCandidates.push({ i, s });
      }
      while (holes.length < 5 && fbCandidates.length > 0) {
        const idx = pickIndex(rnd, fbCandidates.length);
        const pick = fbCandidates.splice(idx, 1)[0];
        const prev = sents[pick.i - 1] || '';
        const next = sents[pick.i + 1] || '';
        const actualType = classifyHoleType(pick.s, prev, next, 'mid') || 'FALLBACK';
        holes.push({ i: pick.i, s: pick.s, demo: actualType });
        usedIdx.add(pick.i);
      }
    }
    if (holes.length < 3) return null;
    // 按句子索引排序
    holes.sort((a, b) => a.i - b.i);

    // 干扰句：窗口外段落
    const holeTexts = holes.map(h => h.s);
    const outPool = splitSents(protectAbbr(PARAS.filter((p, k) => k < win.start || k >= (win.end || win.start + 100))
      .join(' ')));
    const inPool = sents.filter(s2 => holes.every(h => s2 !== h.s));
    const allPool = splitSents(protectAbbr(PARAS.join(' ')));
    const dis = [];
    const pools = [
      { src: outPool, excludeWindow: false },
      { src: inPool, excludeWindow: false },
      { src: allPool, excludeWindow: true },
    ];
    for (const { src, excludeWindow } of pools) {
      const cands = shuffle(src.filter(s2 => {
        const t2 = s2.trim();
        const wc = words(t2).length;
        if (wc < 6 || wc > 34) return false;
        if (holeTexts.indexOf(t2) >= 0) return false;
        if (dis.some(x => x === t2)) return false;
        if (excludeWindow && sents.indexOf(t2) >= 0) return false;
        return true;
      }), rnd);
      for (const c of cands) {
        if (dis.length >= 2) break;
        dis.push(c.trim());
      }
      if (dis.length >= 2) break;
    }
    const options = shuffle(holes.map(h => h.s).concat(dis), rnd);
    const answers = {}; // holeNo(41..45) -> option letter
    holes.forEach((h, k) => { answers[41 + k] = LETTERS[options.indexOf(h.s)]; });

    // 解析：每个空类型关联（5 层结构）
    const expl = {};
    holes.forEach((h, k) => {
      const prev = sents[h.i - 1] || '';
      const next = sents[h.i + 1] || '';
      const ovPrev = contentOverlap(h.s, prev);
      const ovNext = contentOverlap(h.s, next);
      let line = '【考点】' + h.demo + '（考研真题分布：' + HOLE_TYPES_A.find(t => t.code === h.demo)?.weight + '%）';
      if (h.demo === 'ANAPHORA') {
        line += '【题型】指代衔接 —— 空句以指示代词开头，必须指代前文内容。';
        if (ovPrev.length) line += '【线索词】前文复现：' + ovPrev.slice(0, 3).join('、') + '。';
      } else if (h.demo === 'LOGIC') {
        line += '【题型】逻辑衔接 —— 空句以连接词开头，承接上文的转折/因果/递进。';
      } else if (h.demo === 'EXAMPLE') {
        line += '【题型】例证衔接 —— 空句引出具体例子/数据，论点在前一句或后一句。';
      } else if (h.demo === 'THEME') {
        line += '【题型】段落主旨 —— 空句是段首/段尾主旨句，承载本段核心观点。';
      } else if (h.demo === 'REPETITION') {
        line += '【题型】词汇复现 —— 空句与上下文有共享关键词。';
        const allOv = [...new Set([...ovPrev, ...ovNext])];
        if (allOv.length) line += '【线索词】上下文复现：' + allOv.slice(0, 3).join('、') + '。';
      } else {
        line += '【题型】Fallback —— 此句与前后语义衔接最紧密。';
      }
      if (ovNext.length && h.demo !== 'REPETITION') line += '【线索词】后文复现：' + ovNext.slice(0, 3).join('、') + '。';
      expl[41 + k] = line;
    });
    dis.forEach((d, k) => {
      const ov = contentOverlap(d, win.text);
      expl['d' + k] = '【干扰项诊断】含原文词（' + (ov.slice(0, 3).join('、') || '同话题词') + '）但：' +
        '①指代对象不指向任何空 → 排除；' +
        '②不能作为逻辑衔接 → 排除；' +
        '③只是话题重叠，不是答案。';
    });
    return {
      type: 'A',
      passage: sents,
      holes: holes.map((h, k) => ({ idx: h.i, no: 41 + k, type: h.demo })),
      options, answers,
      dis, expl,
      winStart: win.start,
      mineNote: '',
    };
  }

  // ============ Type B: 排序 ============

  // 判断段落是否"看起来像首段"——没有指代词/逻辑连接词开头，有引介/主题词
  function looksLikeFirstParagraph(text) {
    if (DEMO_ANAPHORA.test(text)) return false;
    if (DEMO_CONN.test(text)) return false;
    if (DEMO_EXAMPLE_RE.test(text)) return false;  // 例证段也不像首段
    return true;  // 没有指代/连接/例证开头 → 候选是引入段
  }

  // 段落功能识别（引入/分析/例证/转折/总结/展望）
  function classifyParagraphFunction(text, position, total) {
    if (position === 0) return 'introduction';  // 首段固定为引入
    if (position === total - 1) return 'conclusion';  // 末段固定为结论
    if (DEMO_EXAMPLE_RE.test(text)) return 'example';
    if (DEMO_CONN.test(text)) return 'discussion';
    // 中段：判断是分析还是数据
    return 'analysis';
  }

  // 合并过短的段落（< 12 词视为过短，与相邻合并）
  function mergeShortParas(paras) {
    if (paras.length < 2) return paras;
    const merged = [];
    let buf = paras[0];
    for (let i = 1; i < paras.length; i++) {
      if (words(buf).length < 12 && words(paras[i]).length < 12) {
        buf = buf + ' ' + paras[i];  // 两个都短，合并
      } else if (words(buf).length < 12) {
        buf = buf + ' ' + paras[i];  // 当前短，合并下一个
      } else {
        merged.push(buf);
        buf = paras[i];
      }
    }
    if (buf) merged.push(buf);
    return merged.length >= 2 ? merged : paras;
  }

  function genB(seedN) {
    const rnd = mulberry32(777 + seedN * 2657);

    // 放宽：连续取 4-5 段，段落过短自动合并
    let win = null;
    for (let targetN of [5, 4]) {
      for (let i = 0; i < PARAS.length && !win; i++) {
        if (i + targetN > PARAS.length) continue;
        const seg = PARAS.slice(i, i + targetN);
        const merged = mergeShortParas(seg);
        if (merged.length >= 4) { win = { start: i, paras: merged }; break; }
      }
    }
    if (!win) return null;

    const paras = win.paras;
    const N = paras.length;

    let order = shuffle(paras.map((_, k) => k), rnd); // order[pos] = paraIdx
    if (order.every((v, k) => v === k)) { const t = order[0]; order[0] = order[1]; order[1] = t; }

    // 锚点：pos 0（首段）必给 + 50% 概率给 pos N-1（末段）
    const lastIsAnchor = pickIndex(rnd, 2) === 0;
    const anchorPos = lastIsAnchor ? [0, N - 1].sort((a, b) => a - b) : [0];
    // 如有需要，再加一个中间锚点
    if (N >= 5 && lastIsAnchor === false) {
      // 中间位置随机一个作锚
      const mid = 1 + Math.floor(N / 2);
      anchorPos.push(mid);
      anchorPos.sort((a, b) => a - b);
    }

    const alpha = shuffle([...Array(N).keys()], rnd); // paraIdx -> label letter
    const labelOf = [];
    alpha.forEach((pi, li) => { labelOf[pi] = LETTERS[li]; });

    const blanks = [];
    for (let pos = 0; pos < N; pos++) {
      if (anchorPos.includes(pos)) continue;
      blanks.push(pos);
    }

    // 解析：每个段落的功能 + 段间衔接线索
    const paraFuncs = paras.map((p, k) => classifyParagraphFunction(p, k, N));

    const expl = {};
    for (let pos = 0; pos < N; pos++) {
      expl['p' + pos] = '【第' + (pos + 1) + '段功能】' + paraFuncs[pos] + '\n' +
        (pos === 0 ? '【结构】这是首段（pos=0 锚点已知）。' :
         pos === N - 1 ? '【结构】这是末段（可能已知或待排）。' :
         '【结构】中段，承上启下。');
    }
    for (let pos = 0; pos + 1 < N; pos++) {
      const cur = paras[order[pos]], nxt = paras[order[pos + 1]];
      const lines = [];
      const first = (words(nxt)[0] || '');
      if (DEMO_ANAPHORA.test(nxt)) lines.push('【衔接' + (pos + 1) + '→' + (pos + 2) + '】' + nxt.split(/\s+/)[0] + ' 开头为指代词，指代上一段末尾内容');
      else if (DEMO_CONN.test(nxt)) lines.push('【衔接' + (pos + 1) + '→' + (pos + 2) + '】' + nxt.split(/\s+/)[0] + ' 为逻辑连接词，承接上一段的转折/因果');
      else lines.push('【衔接' + (pos + 1) + '→' + (pos + 2) + '】无明显衔接词，靠段间语义顺承');
      const ov = contentOverlap(cur, nxt);
      if (ov.length) lines.push('「' + ov.slice(0, 3).join('、') + '」在两段间词汇复现');
      expl[pos + '->' + (pos + 1)] = lines.join('；') || '两段语义顺承';
    }
    return { type: 'B', paras, order, labelOf, anchors: anchorPos, blanks, expl, winStart: win.start, paraFuncs };
  }

  // ============ Type C: 小标题 ============

  // 找段落主题句位置（首句 / 转折后 / 末句，按考研真题 70/20/10 法则）
  function findThemeSentence(para) {
    const rawText = protectAbbr(para);
    const sents = splitSents(rawText);
    if (sents.length === 0) return { text: para, position: 'first' };
    // 优先级 1：转折后句（10% 概率但优先级最高）
    const CONN_RE = /^(but|however|yet|still|although|though|nevertheless|while|whereas|instead)\b/i;
    for (let i = 0; i < sents.length; i++) {
      if (CONN_RE.test(sents[i])) return { text: sents[i], position: 'mid' };
    }
    // 优先级 2：首句（70% 概率）
    return { text: sents[0], position: 'first' };
  }

  // 模板法生成小标题（不再抄原句前 6 词）
  const TITLE_TEMPLATES = [
    (w1, w2) => `The challenge of ${w1}`,
    (w1, w2) => `${w1} and its impact on ${w2}`,
    (w1, w2) => `Why ${w1} matters now`,
    (w1, w2) => `The ${w1} debate`,
    (w1, w2) => `Looking ahead: ${w1}`,
    (w1, w2) => `Understanding ${w1}`,
    (w1, w2) => `${w1}: a closer look`,
    (w1, w2) => `How ${w1} is reshaping the landscape`,
  ];

  // 注意：原 mulberry32 算法实现有 bug（输出偏小 < 0.0001），导致 random 模板
  // 选择、shuffle 实际多样性差。这里用 hashInt 取整数模，避开小数精度问题。
  function pickIndex(rnd, n) {
    // 调 rnd() 一次并放大成 32-bit 整数后取模
    return Math.floor(rnd() * 0x7fffffff) % n;
  }

  function makeTitle(para, rnd) {
    const theme = findThemeSentence(para);
    const inPara = words(para);
    const freq = {};
    inPara.forEach(w => {
      if (w.length > 3 && !FUNCTION_WORDS.has(w)) freq[w] = (freq[w] || 0) + 1;
    });
    const topWords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
    if (topWords.length === 0) return { title: 'A key issue …', theme };
    const tpl = TITLE_TEMPLATES[pickIndex(rnd, TITLE_TEMPLATES.length)];
    const w1 = topWords[0] || '';
    const w2 = topWords[1] || topWords[0] || '';
    return { title: tpl(w1, w2), theme };
  }

  // 干扰项设计：2 类（细节型 + 泛化型）
  function makeDetailDistractor(para, rnd) {
    const ws = words(para).filter(w => w.length > 4 && !FUNCTION_WORDS.has(w));
    const w = ws[pickIndex(rnd, ws.length || 1)] || 'something';
    const tpls = [
      x => `A case study of ${x}`,
      x => `Inside the ${x} deal`,
      x => `The specific ${x} challenge`,
      x => `Why some ${x} fail`,
    ];
    return tpls[pickIndex(rnd, tpls.length)](w) + ' …';
  }
  function makeBroadDistractor(rnd) {
    const tpls = [
      'Multiple factors at play',
      'A wider perspective on the issue',
      'Several competing views',
      'Background and context',
    ];
    return tpls[pickIndex(rnd, tpls.length)] + ' …';
  }

  // ============ Type D: 信息匹配题 ============
  // 形式：选 5 段（≥ 25 词），给每段标 A-G 字母，
  // 用户为每段从 7 个"描述"选项里选最匹配的那条
  // 描述来源：该段的前 3 高频关键词 + 模板生成
  function makeDescription(para, rnd) {
    const inPara = words(para);
    const freq = {};
    inPara.forEach(w => {
      if (w.length > 4 && !FUNCTION_WORDS.has(w)) freq[w] = (freq[w] || 0) + 1;
    });
    const topWords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
    if (topWords.length === 0) return 'A key issue …';
    const tpls = [
      (w1, w2) => `Details about ${w1}`,
      (w1, w2) => `How ${w1} relates to ${w2}`,
      (w1, w2) => `Examples of ${w1}`,
      (w1, w2) => `${w1} in context`,
      (w1, w2) => `The role of ${w1}`,
    ];
    const tpl = tpls[pickIndex(rnd, tpls.length)];
    return tpl(topWords[0], topWords[1] || topWords[0]);
  }

  function genD(seedN) {
    const rnd = mulberry32(444 + seedN * 2971);
    // 选 5 个段落（25-150 词：上限太紧会让长段落文章——如 ai_cost/pothole——凑不够 5 段）
    const scored = PARAS.map((p, i) => ({ i, p, wc: words(p).length })).filter(x => x.wc >= 25 && x.wc <= 150);
    if (scored.length < 5) return null;
    const pick5 = shuffle(scored.slice(0, Math.max(5, Math.min(7, scored.length))), rnd).slice(0, 5);
    const others = scored.filter(x => !pick5.includes(x));

    // 为每段生成描述
    const items = pick5.map(x => ({
      paraIdx: x.i,
      para: x.p,
      desc: makeDescription(x.p, rnd)
    }));

    // 干扰项：1 个细节型 + 1 个泛化型
    const dis = [];
    if (others.length > 0) dis.push(makeDetailDistractor(others[0].p, rnd));
    dis.push(makeBroadDistractor(rnd));
    while (dis.length < 2) dis.push(makeBroadDistractor(rnd));

    // 7 选项 = 5 真描述 + 2 干扰
    const allOpts = shuffle(items.map(it => it.desc).concat(dis), rnd);

    // 解析
    const expl = {};
    items.forEach((it, k) => {
      const inPara = words(it.para);
      const tw = words(it.desc).filter(w => !FUNCTION_WORDS.has(w) && w.length > 4);
      const hits = tw.filter(w => inPara.includes(w));
      expl[it.desc] = '【题型】信息匹配题（考研真题 2021 年新增）' +
        '【关键词】描述中关键词：' + tw.slice(0, 3).join('、') + '；段中复现：' + (hits.length ? hits.join('、') : '语义相关') +
        '【段落特征】' + (it.para.slice(0, 80)) + '…';
    });
    dis.forEach(d => {
      expl[d] = d.includes('case study') || d.includes('Inside') || d.includes('specific') || d.includes('Why some')
        ? '【细节型干扰】只对应段中细节，无关键词复现 → 排除'
        : '【泛化型干扰】范围过宽，可对应多段 → 排除';
    });

    return { type: 'D', items, allOpts, dis, expl };
  }

  function genC(seedN) {
    const rnd = mulberry32(999 + seedN * 3833);
    const scored = PARAS.map((p, i) => ({ i, p, wc: words(p).length })).filter(x => x.wc >= 30);
    scored.sort((a, b) => b.wc - a.wc);
    if (scored.length < 5) return null;
    const pick5 = shuffle(scored.slice(0, Math.max(5, Math.min(7, scored.length))), rnd).slice(0, 5);
    const others = scored.filter(x => !pick5.includes(x));

    const items = pick5.map(x => {
      const { title, theme } = makeTitle(x.p, rnd);
      return { paraIdx: x.i, para: x.p, title, themeSentence: theme.text, themePosition: theme.position };
    });

    // 干扰项：1 个细节型 + 1 个泛化型
    const dis = [];
    if (others.length > 0) {
      const o = others[Math.floor(rnd() * others.length)];
      dis.push(makeDetailDistractor(o.p, rnd));
    }
    dis.push(makeBroadDistractor(rnd));
    while (dis.length < 2) dis.push(makeBroadDistractor(rnd));

    const allOpts = shuffle(items.map(it => it.title).concat(dis), rnd);

    const expl = {};
    items.forEach((it, k) => {
      const tw = words(it.title).filter(w => !FUNCTION_WORDS.has(w) && w.length > 3);
      const inPara = words(it.para);
      const cnt = tw.map(w => w + '×' + inPara.filter(x => x === w).length).join('、');
      let reason = '';
      if (it.themePosition === 'first') reason = '主题在首句（考研真题 70% 概率）：开门见山，第一句即论点。';
      else if (it.themePosition === 'mid') reason = '主题在转折后（考研真题 10% 概率）：转折词后才出现作者真正观点。';
      else reason = '主题在末句（考研真题 20% 概率）：先铺细节，末句总结。';
      expl[it.title] = '【概括方法】' + reason + ' 【关键词复现】段落中该词出现次数：' + cnt + '。';
    });
    dis.forEach(d => {
      expl[d] = d.includes('case study') || d.includes('Inside') || d.includes('specific') || d.includes('Why some')
        ? '【细节型干扰】标题只覆盖段中一个具体例子 / 数据，不是段落整体概括。'
        : '【泛化型干扰】标题过宽，可对应多段，区分度不足。';
    });

    return { type: 'C', items, allOpts, dis, expl };
  }

  // ============ 5 层解析速查块（v23+）============
  // 每题型末尾追加统一的"考点类型 + 知识扩展 + 复习提示"块，
  // 弥补逐题解析只覆盖"正确答案 + 干扰项"两层的情况，与 cloze.js / translation.js 对齐。
  function append5LayerSummary(list, type, E, st) {
    if (!st.done) return;  // 只在交卷后展示
    const META = {
      A: {
        title: 'A · 七选五',
        tags: ['ANAPHORA 指代', 'LOGIC 逻辑', 'REPETITION 复现', 'THEME 主题', 'EXAMPLE 例证'],
        ext: '七选五核心是<b>句间衔接</b>。解题三步：① 读空前 1 句 + 空后 1 句找信号词（指代/连接/重复）② 看 7 个选项，按信号词匹配 ③ 排除"含原文词但语义不符"的干扰项（细节型/泛化型）。',
        tip: '<b>本周重点</b>：① 背熟 5 类衔接信号词（this/these/however/therefore/in fact/such as）<br>② 找 3 篇真题七选五，画"空前后 2 句"的逻辑链<br>③ 干扰项诊断重点练"含原文词但不接"的判断'
      },
      B: {
        title: 'B · 段落排序',
        tags: ['引入段', '论述段', '例证段', '结论段', '过渡衔接'],
        ext: '段落排序核心是<b>论证逻辑</b>。解题四步：① 抓首段锚点（已给）② 找每段"功能"（引入/论述/例证/结论）③ 用指代词 + 词汇复现连成链 ④ 结论段必末位（含 however/therefore/in sum）。',
        tip: '<b>本周重点</b>：① 标 5 篇真题每段的"功能标签"<br>② 找段首指代词（this/these/it）回指前段<br>③ 结论段识别训练（in sum/therefore/consequently）'
      },
      C: {
        title: 'C · 小标题匹配',
        tags: ['主旨概括', '关键词复现', '细节型干扰', '泛化型干扰'],
        ext: '小标题匹配核心是<b>主旨匹配</b>。解题四步：① 通读 5 段抓每段核心关键词 ② 扫 7 标题找明显匹配 ③ 排除"细节型"（只对应一个例子）和"泛化型"（覆盖多段）④ 剩余难题对比段首段末。',
        tip: '<b>本周重点</b>：① 背 5 个常见小标题模板（The + N / How to V / Why X Matters）<br>② 找 3 篇真题小标题题，标每段的"核心动词 + 名词"<br>③ 训练"细节型 vs 概括型"区分能力'
      },
      D: {
        title: 'D · 信息匹配',
        tags: ['信息定位', '关键词匹配', '多对一', '细节型干扰'],
        ext: '信息匹配核心是<b>信息定位</b>。解题三步：① 读 5 个问题关键词（人名/数字/专有名词/引号词）② 扫 6 个信息块，标记含关键词的块 ③ 注意"多对一"可复用同一块；排除"含问题词但细节不符"的干扰项。',
        tip: '<b>本周重点</b>：① 训练"扫读定位"（10 秒内找到含关键词的段）<br>② 注意数字、专有名词、引号词三类强信号<br>③ 区分"主题相关"和"真实匹配"两类干扰'
      }
    };
    const m = META[type];
    if (!m) return;
    const html =
      '<div class="nt-5layer" style="margin-top:18px;padding:12px 14px;background:var(--panel);border-radius:8px;border-left:3px solid var(--accent);">' +
        '<div style="font-size:13px;font-weight:600;color:var(--accent);margin-bottom:6px;">📋 ' + m.title + ' · 5 层解析速查</div>' +
        '<div style="font-size:12.5px;margin-bottom:6px;"><b>① 题型标签</b>：' + m.tags.join(' / ') + '</div>' +
        '<div style="font-size:12.5px;margin-bottom:6px;"><b>② 正确答案</b>：见上方各题（已揭晓）</div>' +
        '<div style="font-size:12.5px;margin-bottom:6px;"><b>③ 干扰项</b>：见上方"干扰项解析"（仅 A/B 有；C/D 干扰项见各题正确 vs 你的对比）</div>' +
        '<div style="font-size:12.5px;margin-bottom:6px;"><b>④ 知识扩展</b>：' + m.ext + '</div>' +
        '<div style="font-size:12.5px;"><b>⑤ 复习提示</b>：' + m.tip + '</div>' +
      '</div>';
    list.insertAdjacentHTML('beforeend', html);
  }

  // ============ render ============
  function render() {
    const list = document.getElementById('q-list');
    // 给题目区容器加 region role（仅首次）
    if (list && !list.getAttribute('role')) {
      list.setAttribute('role', 'region');
      list.setAttribute('aria-label', '考研新题型题目区');
    }
    const type = state.type || 'A';
    const st = curSt();
    if (!exam) { list.innerHTML = '<div class="exam-empty">无法生成该题型（文章段落不足）。</div>'; return; }
    let html = '';
    html += '<div class="nt-tabs" role="tablist">' +
      [['A', 'A · 七选五'], ['B', 'B · 段落排序'], ['C', 'C · 小标题匹配'], ['D', 'D · 信息匹配']].map(t =>
        '<button class="nt-tab' + (type === t[0] ? ' active' : '') + '" data-nt="' + t[0] + '" role="tab" aria-selected="' + (type === t[0] ? 'true' : 'false') + '">' + t[1] + '</button>').join('') + '</div>';
    html += '<div class="nt-tools">' +
      '<button class="nt-btn primary" id="nt-submit"' + (st.done ? ' disabled' : '') + ' aria-pressed="' + (st.done ? 'true' : 'false') + '">' + (st.done ? '✓ 已交卷' : '交卷判分 · 看答案') + '</button>' +
      '<button class="nt-btn" id="nt-rebuild" aria-label="换一组新题">🔄 换一组</button>' +
      '<button class="nt-btn" id="nt-redo" aria-label="清空当前答案重做">🗑 重做</button>' +
      '<span class="nt-hint" aria-live="polite" aria-atomic="true">' + (st.done ? '答案与解析已展开 ↓' : '答完后点左侧按钮揭晓答案与解析') + '</span></div>';
    if (st.done && st.right != null) {
      html += '<div class="nt-score" style="display:block" role="status" aria-live="assertive" aria-atomic="true"><span class="num">' + st.right + '</span> / 10 分' +
        (st.perfect ? ' —— 满分！' : '') + '</div>';
    }
    const E = exam;
    if (type === 'A') {
      html += '<div class="nt-headline">Part A · 七选五（每题 2 分，共 10 分）</div>';
      html += '<div class="nt-notice">从下面文章中挖去了 5 个句子（[41]–[45]），请从 A–G 七个选项中为每个空选出最合适的一句。' + (st.done ? '' : '提示：优先看空格前后句的指代词与词汇复现。') + '</div>';
      html += '<div class="nt-passage">';
      E.passage.forEach((s2, i) => {
        const hole = E.holes.find(h => h.idx === i);
        if (hole) {
          const pick = st.picks[hole.no] || '';
          html += '<span class="nt-mark' + (pick ? ' filled' : '') + '">[' + hole.no + ']' + (st.done && pick ? ' ' + esc(pick) : '') + '</span> ';
        } else html += esc(s2) + ' ';
      });
      html += '</div>';
      html += '<div class="nt-optlist">' + E.options.map((o, k) => '<div class="it"><b>' + LETTERS[k] + '.</b> ' + esc(o) + '</div>').join('') + '</div>';
      E.holes.forEach(h => {
        const pick = st.picks[h.no] || '';
        const isRight = pick === E.answers[h.no];
        const slotCls = st.done ? (' nt-slot animate-in' + (isRight ? ' correct-slot' : (pick ? ' wrong-slot' : ''))) : '';
        html += '<div class="nt-slot' + slotCls + '">空 ' + h.no + '：<select data-q="' + h.no + '"' + (st.done ? ' disabled' : '') + '><option value="">—选择—</option>' +
          E.options.map((_, k) => '<option value="' + LETTERS[k] + '"' + (pick === LETTERS[k] ? ' selected' : '') + '>' + LETTERS[k] + '</option>').join('') +
          '</select>' +
          (st.done ? '<span class="nt-verdict ' + (isRight ? 'right' : 'wrong') + '">' + (isRight ? '✓ 正确' : '✗ 正确答案：' + E.answers[h.no]) + '</span>' : '') +
          (st.done ? '<div class="nt-expl open"><b>第' + h.no + '题（' + E.answers[h.no] + '）解析：</b>' + E.expl[h.no] + '</div>' : '') +
          '</div>';
      });
      if (st.done) {
        html += '<div class="nt-expl open"><b>干扰项解析：</b><br>' + E.dis.map((d, k) => esc(E.expl['d' + k])).join('<br>') + '</div>';
      }
    }
    if (type === 'B') {
      html += '<div class="nt-headline">Part B · 段落排序（每空 2.5 分，共 10 分）</div>';
      html += '<div class="nt-notice">以下 ' + E.paras.length + ' 个段落顺序已被打乱。已知 ' + E.anchors.map(p => '第 ' + (p + 1) + ' 段是 ' + E.labelOf[E.order[p]] + ' 段').join('、') + '，请为其余 ' + E.blanks.length + ' 个位置选出正确段落。提示：看段首指代词、段间词汇复现。</div>';
      html += '<div class="nt-para" style="margin-bottom:14px;"><span class="txt" style="color:var(--muted);font-size:13px;">段落选项（' + E.paras.length + ' 段，字母为段落标号）：</span></div>';
      E.order.forEach((pi, pos) => {
        const L = E.labelOf[pi];
        html += '<div class="nt-para"><span class="tag">' + L + '.</span><span class="txt">' + esc(E.paras[pi]) + '</span></div>';
      });
      E.paras.forEach((_, pos) => {
        const isAnchor = E.anchors.includes(pos);
        const pi = E.order[pos];
        const L = E.labelOf[pi];
        if (isAnchor) {
          html += '<div class="nt-slot fixed">第 ' + (pos + 1) + ' 段（已知）：<b>' + L + '</b></div>';
        } else {
          const pick = st.picks[pos] || '';
          const isRight = pick === L;
          const slotCls = st.done ? (' animate-in' + (isRight ? ' correct-slot' : (pick ? ' wrong-slot' : ''))) : '';
          const anchorLetters = E.anchors.map(pp => E.labelOf[E.order[pp]]);
          html += '<div class="nt-slot' + slotCls + '">第 ' + (pos + 1) + ' 段：<select data-b="' + pos + '"' + (st.done ? ' disabled' : '') + '><option value="">—选择—</option>' +
            E.labelOf.map((L2, k) => anchorLetters.indexOf(L2) >= 0 ? '' : '<option value="' + L2 + '"' + (pick === L2 ? ' selected' : '') + '>' + L2 + '</option>').join('') +
            '</select>' +
            (st.done ? '<span class="nt-verdict ' + (isRight ? 'right' : 'wrong') + '">' + (isRight ? '✓ 正确' : '✗ 正确：' + L) + '</span>' : '') +
            (st.done ? '<div class="nt-expl open"><b>衔接线索：</b>' + (E.expl[(pos - 1) + '->' + pos] || '') + (E.expl[pos + '->' + (pos + 1)] ? '；后接：' + E.expl[pos + '->' + (pos + 1)] : '') + '</div>' : '') +
            '</div>';
        }
      });
    }
    if (type === 'C') {
      html += '<div class="nt-headline">Part C · 小标题匹配（每题 2 分，共 10 分）</div>';
      html += '<div class="nt-notice">为下面 5 个段落选出最合适的小标题（' + E.allOpts.length + ' 选 5，含干扰项）。提示：找标题关键词在段落中的复现。</div>';
      html += '<div class="nt-optlist">' + E.allOpts.map((o, k) => '<div class="it"><b>' + LETTERS[k] + '.</b> ' + esc(o) + '</div>').join('') + '</div>';
      E.items.forEach((it, k) => {
        const correct = LETTERS[E.allOpts.indexOf(it.title)];
        const pick = st.picks[k] || '';
        const isRight = pick === correct;
        const slotCls = st.done ? (' animate-in' + (isRight ? ' correct-slot' : (pick ? ' wrong-slot' : ''))) : '';
        html += '<div class="nt-para"><span class="tag">第' + (k + 1) + '段</span><select data-c="' + k + '"' + (st.done ? ' disabled' : '') + '><option value="">—标题—</option>' +
          E.allOpts.map((o, ok) => '<option value="' + LETTERS[ok] + '"' + (pick === LETTERS[ok] ? ' selected' : '') + '>' + LETTERS[ok] + ' · ' + esc(o.slice(0, 26)) + '</option>').join('') +
          '</select>' +
          (st.done ? '<span class="nt-verdict ' + (isRight ? 'right' : 'wrong') + '">' + (isRight ? '✓ 正确' : '✗ 正确：' + correct) + '</span>' : '') +
          (st.done ? '<div class="nt-expl open"><b>解析：</b>' + E.expl[it.title] + '</div>' : '') +
          '</div>' +
          '<div class="nt-para' + (st.done ? ' animate-in' : '') + '" style="margin-top:-4px;"><span class="txt">' + esc(it.para.slice(0, 220)) + (it.para.length > 220 ? '…' : '') + '</span></div>';
      });
    }
    if (type === 'D') {
      html += '<div class="nt-headline">Part D · 信息匹配题（每题 2 分，共 10 分）</div>';
      html += '<div class="nt-notice">为下面 5 个段落选出最匹配的描述（' + E.allOpts.length + ' 选 5，含干扰项）。提示：描述中关键词在段落中复现 → 入选；细节型/泛化型描述 → 排除。考研真题 2021 年起新增。</div>';
      html += '<div class="nt-optlist">' + E.allOpts.map((o, k) => '<div class="it"><b>' + LETTERS[k] + '.</b> ' + esc(o) + '</div>').join('') + '</div>';
      E.items.forEach((it, k) => {
        const correct = LETTERS[E.allOpts.indexOf(it.desc)];
        const pick = st.picks[k] || '';
        const isRight = pick === correct;
        const slotCls = st.done ? (' animate-in' + (isRight ? ' correct-slot' : (pick ? ' wrong-slot' : ''))) : '';
        html += '<div class="nt-para"><span class="tag">第' + (k + 1) + '段</span><select data-d="' + k + '"' + (st.done ? ' disabled' : '') + '><option value="">—描述—</option>' +
          E.allOpts.map((o, ok) => '<option value="' + LETTERS[ok] + '"' + (pick === LETTERS[ok] ? ' selected' : '') + '>' + LETTERS[ok] + ' · ' + esc(o.slice(0, 30)) + '</option>').join('') +
          '</select>' +
          (st.done ? '<span class="nt-verdict ' + (isRight ? 'right' : 'wrong') + '">' + (isRight ? '✓ 正确' : '✗ 正确：' + correct) + '</span>' : '') +
          (st.done ? '<div class="nt-expl open"><b>解析：</b>' + E.expl[it.desc] + '</div>' : '') +
          '</div>' +
          '<div class="nt-para' + (st.done ? ' animate-in' : '') + '" style="margin-top:-4px;"><span class="txt">' + esc(it.para.slice(0, 220)) + (it.para.length > 220 ? '…' : '') + '</span></div>';
      });
    }
    list.innerHTML = html;
    wire();
    renderProgress();
    // v23+: 5 层解析速查块（题型总览 + 知识扩展 + 复习提示）
    append5LayerSummary(list, type, E, st);
    // 难度自适应提示挂在 .nt-tools 里，render 重建 DOM 后会丢，每次渲染后补挂
    adaptDifficultyHint();
    // 交卷后：逐题动画揭晓
    if (st.done) {
      const slots = list.querySelectorAll('.nt-slot.animate-in');
      slots.forEach((slot, i) => {
        setTimeout(() => slot.style.animationDelay = (i * 100) + 'ms', 0);
      });
    }
  }

  function renderProgress() {
    const el = document.getElementById('exam-progress');
    const type = state.type || 'A';
    const st = curSt();
    const total = (type === 'B' || type === 'D') ? E_blanks() : 5;
    const n = Object.keys(st.picks || {}).length;
    const pct = total > 0 ? Math.round((n / total) * 100) : 0;
    el.innerHTML = (n === 0 ? '未作答' :
      '<span class="nt-progress-text">' + n + '/' + total + ' 已作答</span>' +
      '<span class="nt-progress-bar"><span class="nt-progress-fill" style="width:' + pct + '%"></span></span>' +
      (st.done ? '<span class="nt-progress-tag">已交卷</span>' : ''));
  }
  function E_blanks() {
    if (!exam) return 5;
    return exam.type === 'B' ? exam.blanks.length : exam.type === 'D' ? 5 : 5;
  }

  function wire() {
    const list = document.getElementById('q-list');
    const type = state.type || 'A';
    const st = curSt();
    list.querySelectorAll('[data-nt]').forEach(b => b.addEventListener('click', () => {
      state.type = b.dataset.nt; saveLS(); buildAndRender();
    }));
    list.querySelectorAll('[data-q]').forEach(sel => sel.addEventListener('change', () => {
      curSt().picks[sel.dataset.q] = sel.value; saveLS(); render();
    }));
    list.querySelectorAll('[data-b]').forEach(sel => sel.addEventListener('change', () => {
      curSt().picks[sel.dataset.b] = sel.value; saveLS(); render();
    }));
    list.querySelectorAll('[data-c]').forEach(sel => sel.addEventListener('change', () => {
      curSt().picks[sel.dataset.c] = sel.value; saveLS(); render();
    }));
    list.querySelectorAll('[data-d]').forEach(sel => sel.addEventListener('change', () => {
      curSt().picks[sel.dataset.d] = sel.value; saveLS(); render();
    }));
    document.getElementById('nt-submit')?.addEventListener('click', () => {
      const st = curSt();
      if (st.done) return;
      let right = 0, total = 0;
      if (type === 'A') {
        E_holes().forEach(h => { total++; if (curSt().picks[h.no] === E.answers[h.no]) right++; });
        right = right * 2; total = 10;
      } else if (type === 'B') {
        exam.blanks.forEach(pos => { total++; if (curSt().picks[pos] === E.labelOf[E.order[pos]]) right++; });
        right = Math.round(right * 2.5 * 10) / 10; total = 10;
      } else if (type === 'D') {
        exam.items.forEach((it, k) => { total++; const correct = LETTERS[exam.allOpts.indexOf(it.desc)]; if (curSt().picks[k] === correct) right++; });
        right = right * 2; total = 10;
      } else {
        exam.items.forEach((it, k) => { total++; const correct = LETTERS[exam.allOpts.indexOf(it.title)]; if (curSt().picks[k] === correct) right++; });
        right = right * 2; total = 10;
      }
      st.done = true; st.right = right; state.examDone = { type: type, at: new Date().toISOString() }; saveLS(); render();
      // 接入 exam.js 共享的错题字典 (wsj_exam:wrongs) 和成绩历史 (wsj_exam:history)
      try {
        const wrongs = JSON.parse(localStorage.getItem('wsj_newtype:wrongs') || '[]');
        const NT_CAUSES = [['ANAPHORA', '指代错'], ['LOGIC', '逻辑错'], ['REPETITION', '复现识别错'], ['THEME', '主旨错'], ['EXAMPLE', '例证错'], ['POSITION', '位置错'], ['FALLBACK', '通用错']];
        const tagToCause = Object.fromEntries(NT_CAUSES);
        const newWrongs = [];
        if (type === 'A') {
          exam.holes.forEach((h, k) => {
            const pick = curSt().picks[h.no];
            const correct = exam.answers[h.no];
            if (pick && pick !== correct) {
              newWrongs.push({
                key: slug + '#A#' + h.no, slug, type: 'A', subType: h.type || 'FALLBACK',
                no: h.no, myAnswer: pick, answer: correct,
                // T11: 错题本就地重做所需题面（选项句组，字母键与作答一致）
                stem: '7选5 · 第' + h.no + '空：为该段选择匹配的句子',
                options: (function () { const o = {}; exam.allOpts.forEach(function (s, i2) { o[LETTERS[i2] || String(i2)] = s; }); return o; })(),
                cause: tagToCause[h.type] || '通用错',
                at: new Date().toISOString()
              });
            }
          });
        } else if (type === 'B') {
          exam.blanks.forEach((pos, k) => {
            const pick = curSt().picks[pos];
            const correct = exam.labelOf[exam.order[pos]];
            if (pick && pick !== correct) {
              newWrongs.push({
                key: slug + '#B#' + pos, slug, type: 'B', subType: 'POSITION',
                no: pos + 1, myAnswer: pick, answer: correct,
                // T11: 就地重做题面
                stem: '语段填空 · 第' + (pos + 1) + '处：选择放回原位的句子',
                options: (function () { const o = {}; exam.allOpts.forEach(function (s, i2) { o[LETTERS[i2] || String(i2)] = s; }); return o; })(),
                cause: '位置错',
                at: new Date().toISOString()
              });
            }
          });
        } else if (type === 'D') {
          exam.items.forEach((it, k) => {
            const pick = curSt().picks[k];
            const correct = LETTERS[exam.allOpts.indexOf(it.desc)];
            if (pick && pick !== correct) {
              newWrongs.push({
                key: slug + '#D#' + k, slug, type: 'D', subType: 'MATCH',
                no: k + 1, myAnswer: pick, answer: correct,
                cause: '匹配错',
                at: new Date().toISOString()
              });
            }
          });
        } else {
          exam.items.forEach((it, k) => {
            const pick = curSt().picks[k];
            const correct = LETTERS[exam.allOpts.indexOf(it.title)];
            if (pick && pick !== correct) {
              newWrongs.push({
                key: slug + '#C#' + k, slug, type: 'C', subType: 'THEME',
                no: k + 1, myAnswer: pick, answer: correct,
                cause: '主旨错',
                at: new Date().toISOString()
              });
            }
          });
        }
        // 合并到 localStorage（替换同 key）
        const merged = wrongs.filter(w => !newWrongs.some(n => n.key === w.key));
        merged.push(...newWrongs);
        localStorage.setItem('wsj_newtype:wrongs', JSON.stringify(merged));

        // 成绩历史（接 wsj_exam:history）
        const history = JSON.parse(localStorage.getItem('wsj_exam:history') || '[]');
        history.push({
          slug, mode: 'newtype', subType: type,
          correct: right, total: 10, at: new Date().toISOString(),
          wrongCount: newWrongs.length
        });
        localStorage.setItem('wsj_exam:history', JSON.stringify(history.slice(-50)));
      } catch (e) { /* 静默失败，不影响交卷主流程 */ }
      // 交卷后把分数卡滚入视野（用户在下方作答时分数卡在屏幕外）
      const list = document.getElementById('q-list');
      const scoreEl = list && list.querySelector('.nt-score');
      if (scoreEl) scoreEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.getElementById('nt-rebuild')?.addEventListener('click', () => {
      state.seed = (state.seed || 0) + 1; curSt().picks = {}; curSt().done = false; curSt().right = null;
      saveLS(); buildAndRender();
    });
    document.getElementById('nt-redo')?.addEventListener('click', () => {
      curSt().picks = {}; curSt().done = false; curSt().right = null; saveLS(); render();
    });
  }
  function E_holes() { return exam.holes; }
  const E = new Proxy({}, { get: (t, k) => (exam || {})[k] });

  function buildAndRender() {
    const seed = state.seed || 0;
    const type = state.type || 'A';
    exam = type === 'A' ? genA(seed) : type === 'B' ? genB(seed) : type === 'C' ? genC(seed) : genD(seed);
    if (!exam) { document.getElementById('q-list').innerHTML = '<div class="exam-empty">该题型在此文章上无法生成（段落结构不足），请换其他题型。</div>'; return; }
    // 注意：不要在这里重置 curSt().done / curSt().right —— 已交卷的题切走再回来
    // 必须保留 done 状态，否则用户以为答案失效。每个题型的 done / right 独立存在
    // state[type] 字典里（持久化在 localStorage），重置交由 nt-rebuild 按钮显式触发。
    render();
    // 难度自适应：根据最近 5 次正确率显示提示文字（不动题目本身）
    adaptDifficultyHint();
  }

  // 难度自适应：根据最近历史给用户显示提示（鼓励 / 加难点建议）
  function adaptDifficultyHint() {
    try {
      const history = JSON.parse(localStorage.getItem('wsj_exam:history') || '[]');
      const recent = history.filter(h => h.mode === 'newtype').slice(-5);
      if (recent.length < 3) return;
      const avgPct = recent.reduce((s, h) => s + (h.correct / h.total), 0) / recent.length;
      let tip;
      if (avgPct >= 0.85) tip = '🌟 连续高正确率，建议挑战 D 类型（信息匹配）或换不同文章';
      else if (avgPct >= 0.6) tip = '👍 表现稳定，保持当前节奏即可';
      else tip = '💡 最近正确率偏低，建议对照解析理解每道题的考点分类';
      const tools = document.querySelector('.nt-tools');
      if (tools && !document.querySelector('.nt-adapt-hint')) {
        const span = document.createElement('span');
        span.className = 'nt-hint nt-adapt-hint';
        span.style.marginLeft = 'auto';
        span.setAttribute('role', 'status');
        span.setAttribute('aria-live', 'polite');
        span.setAttribute('aria-atomic', 'true');
        span.textContent = tip;
        tools.appendChild(span);
      }
    } catch (e) {}
  }

  // 测试钩子（完整版）：在 DOMContentLoaded 注册前暴露所有核心算法，不依赖监听器触发。
  // 仅 ?test=1 query 触发，生产完全无副作用。
  if (typeof window !== 'undefined' && new URLSearchParams(location.search).get('test') === '1') {
    window.__NT__ = { mulberry32, shuffle, genA, genB, genC, genD, pickIndex };
  }
  // 回归套件数据采集：file:// 下父页无法跨 origin 读 iframe 里的 __NT__，
  // 由本页（?suite=1 时）算好可序列化 payload 再 postMessage 给 _test_suite.html。
  // 注意：本监听器注册于文件末尾的主初始化（DOMContentLoaded）之前，因此会先于
  // buildAndRender 执行——genA-D 都是从 PARAS 现算不受影响；schemaVersion 在顶层
  // 已写、下方 curSt()+saveLS() 兜底落盘题型字典，各断言在此时序下均成立。
  if (typeof window !== 'undefined' && new URLSearchParams(location.search).get('suite') === '1') {
    document.addEventListener('DOMContentLoaded', function () {
      function sampleN(seed, n) { const r = mulberry32(seed); const out = []; for (let i = 0; i < n; i++) out.push(r()); return out; }
      const m42 = sampleN(42, 10000);
      const m42b = sampleN(42, 100);
      const pickBuckets = [0, 0, 0, 0, 0];
      const pr = mulberry32(7);
      for (let i = 0; i < 5000; i++) pickBuckets[pickIndex(pr, 5)]++;
      let pickBoundsOk = true;
      const pb = mulberry32(99);
      for (let i = 0; i < 1000; i++) { const v = pickIndex(pb, 5); if (!Number.isInteger(v) || v < 0 || v >= 5) { pickBoundsOk = false; break; } }
      function summarize(f) {
        const a = f(0), b = f(0);
        if (!a) return { present: false, same: false };
        const s = { present: true, type: a.type, same: JSON.stringify(a) === JSON.stringify(b) };
        if (a.type === 'A') {
          s.passageIsArray = Array.isArray(a.passage);
          s.holes = (a.holes || []).length;
          s.options = (a.options || []).length;
          s.answersOk = (a.holes || []).every(h => /^[A-G]$/.test(String((a.answers || {})[h.no] || '')));
        } else if (a.type === 'B') {
          s.paras = (a.paras || []).length;
          s.anchors = (a.anchors || []).length;
          s.blanks = (a.blanks || []).length;
        } else {
          s.items = (a.items || []).length;
          s.allOpts = (a.allOpts || []).length;
          s.optsNonEmpty = (a.allOpts || []).every(o => o && String(o).length > 0);
        }
        return s;
      }
      function ntState() {
        try { return JSON.parse(localStorage.getItem('nt:' + (document.body.dataset.examId || 'newtype')) || '{}') || {}; } catch (e) { return {}; }
      }
      try { curSt(); saveLS(); } catch (e) {} // 测试前置：把当前题型字典落盘，typeKeys 才有内容可断言
      const payload = {
        mulberry: {
          n: m42.length,
          inRange: m42.every(v => v >= 0 && v < 1),
          allZero: m42.every(v => v === 0),
          deterministic: JSON.stringify(m42b) === JSON.stringify(sampleN(42, 100)),
          seed1: sampleN(1, 1)[0], seed2: sampleN(2, 1)[0]
        },
        pickIndex: { boundsOk: pickBoundsOk, buckets: pickBuckets },
        genA: summarize(genA), genB: summarize(genB), genC: summarize(genC), genD: summarize(genD),
        schemaVersion: ntState().schemaVersion === undefined ? null : ntState().schemaVersion,
        typeKeys: Object.keys(ntState()).filter(k => /^[ABCD]$/.test(k))
      };
      window.__NT_SUITE_PAYLOAD__ = payload;
      try { if (window.parent && window.parent !== window) window.parent.postMessage({ __ntSuite: true, payload: payload }, '*'); } catch (e) {}
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('page-newtype');
    document.getElementById('theme-btn').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const order = ['green', 'dark', 'blue-gold', 'light'];
      const next = order[(order.indexOf(cur || 'green') + 1) % order.length];
      try { localStorage.setItem('wsj_exam:theme', next); } catch (e) {}
      if (next === 'dark' || next === 'green' || next === 'blue-gold') document.documentElement.setAttribute('data-theme', next);
      else document.documentElement.removeAttribute('data-theme');
    });
    if (!state.type) state.type = 'A';
    const meta = document.getElementById('exam-meta');
    if (meta && window.__EXAM_META__) meta.textContent = window.__EXAM_META__;
    buildAndRender();
  });
})();
