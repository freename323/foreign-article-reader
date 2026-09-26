  // ===== F11 中译英默写（看着中文译文，默写英文原句，逐词比对）=====
  //
  // 题库从**文章本身**现取，不新建索引：
  //   · 主来源 = 本篇 `.col-body.en p[data-para-idx]` ↔ `.col-body.cn p[data-para-idx]` 逐段配对，
  //     段内按句切分；英中句数一致就逐句配对，不一致则整段作为一格（标「整段」）；
  //   · 加成来源 = 本篇已标注的长难句（`syntax:<articleId>`），标 ★ 并排在前面；
  //   · 没有中文对照的句子（跨篇素材等）**不进题库** —— 默写必须有中文提示，硬凑会变成抄写。
  //
  // 存储：
  //   `wsj_dictation:stats`  每题的练习次数与最近正确率（用于「未默写 / 错过」筛选）
  //   `wsj_dictation:wrongs` 拼错的词侧车（spec 的「错词本」）—— 可一键并进生词本
  // 两个键都要在 09-reading.js 的备份白名单里。
  //
  // ⚠ 本模块必须排在 10-toolbar.js 之前（后者负责收尾 IIFE）。

  const DICT_STATS_KEY = 'wsj_dictation:stats';
  const DICT_WRONG_KEY = 'wsj_dictation:wrongs';

  // ---------- 句子切分 ----------
  // 英文：句末标点 + 空白/结尾。⚠ 必须用 lookahead —— 用 /[^.!?]+[.!?]+(\s+|$)/ 取第一个 match
  // 遇到 "the U.S. Senate" 这类缩写会从 "S. " 开始匹配（完形生成器踩过同一个坑）。
  function dictSplitEn(text) {
    const out = [];
    const re = /[.!?]["')\]]?(?=\s|$)/g;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      out.push(text.slice(last, m.index + m[0].length));
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out.map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }
  // 中文：句末标点后切。不用 lookbehind，避免老浏览器不支持。
  function dictSplitCn(text) {
    const out = [];
    let cur = '';
    String(text || '').split('').forEach(ch => {
      cur += ch;
      if ('。！？；'.indexOf(ch) >= 0) { if (cur.replace(/\s+/g, '').trim()) out.push(cur.trim()); cur = ''; }
    });
    if (cur.replace(/\s+/g, '').trim()) out.push(cur.trim());
    return out;
  }
  function dictWords(s) {
    return (String(s || '').match(/[A-Za-z0-9][A-Za-z0-9'’\-]*/g) || [])
      .map(w => w.replace(/^['’\-]+|['’\-]+$/g, ''))
      .filter(Boolean);
  }
  function dictKey(w) { return String(w).toLowerCase().replace(/[’']/g, ''); }

  // ---------- 题库 ----------
  function dictParaMap(cls) {
    const map = {};
    document.querySelectorAll('.col-body.' + cls + ' p[data-para-idx]').forEach(p => {
      map[String(p.dataset.paraIdx)] = String(p.textContent || '').replace(/\s+/g, ' ').trim();
    });
    return map;
  }
  function dictItems() {
    const en = dictParaMap('en'), cn = dictParaMap('cn');
    const idxs = Object.keys(en).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    // 长难句来源（标 ★）
    const star = {};
    let syn = [];
    try { syn = JSON.parse(localStorage.getItem('syntax:' + articleId)) || []; } catch (e) { syn = []; }
    syn.forEach(s => {
      const t = String((s && (s.text || s.html || '')) || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (t) star[dictKey(t.slice(0, 60))] = true;
    });
    const items = [], skipped = [];
    idxs.forEach(idx => {
      const enText = en[idx], cnText = cn[idx] || '';
      if (!cnText) { skipped.push(idx); return; }
      const enS = dictSplitEn(enText), cnS = dictSplitCn(cnText);
      if (enS.length > 1 && enS.length === cnS.length) {
        enS.forEach((s, k) => {
          const n = dictWords(s).length;
          if (n < 6 || n > 45) { skipped.push(idx); return; }
          items.push({
            id: 'p' + idx + 's' + (k + 1), paraIdx: idx, en: s, cn: cnS[k],
            star: !!star[dictKey(s.slice(0, 60))]
          });
        });
      } else {
        // 英中句数不一致：整段作为一格（太长就不出题，避免默写 200 词）
        const n = dictWords(enText).length;
        if (n < 6 || n > 45) { skipped.push(idx); return; }
        items.push({
          id: 'p' + idx + 'all', paraIdx: idx, en: enText, cn: cnText, whole: true,
          star: !!star[dictKey(enText.slice(0, 60))]
        });
      }
    });
    items.sort((a, b) => (b.star ? 1 : 0) - (a.star ? 1 : 0) || parseInt(a.paraIdx, 10) - parseInt(b.paraIdx, 10));
    // skipped 按「段」去重：面板提示说的是「有几段没出题」，不是有几个失败分支
    const skippedParas = [];
    skipped.forEach(s => { if (skippedParas.indexOf(s) < 0) skippedParas.push(s); });
    return { items: items, skipped: skippedParas };
  }

  // ---------- 逐词比对（LCS）----------
  // 不是简单的「公共子序列长度」——还要能告诉用户哪个词拼错了、哪个词漏了、多了什么，
  // 所以先求出对齐对，再把两侧的「空隙」配成 替换(missing) / 多写(extra)。
  //
  // 分词器是可换的：默写用「英文词」，笔记历史对比（F15）用「英文词 + 单个汉字 + 其它单字符」。
  // 两者共用同一套 LCS 与状态判定，避免出现两份会各自跑偏的 diff。
  function dictTokenizeEn(s) { return dictWords(s); }
  function dictTokenizeAny(s) {
    return (String(s || '').match(/[A-Za-z0-9'’\-]+|[\u4e00-\u9fff]|[^\s]/g) || []);
  }
  function diffTokens(original, input, tokenize) {
    const A = tokenize(original), B = tokenize(input);
    const n = A.length, m = B.length;
    const dp = [];
    for (let i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = dictKey(A[i]) === dictKey(B[j])
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    // 回溯出匹配对
    const pairs = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (dictKey(A[i]) === dictKey(B[j])) { pairs.push([i, j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    const aStatus = new Array(n).fill('missing');
    const bStatus = new Array(m).fill('extra');
    let correct = 0, wrong = 0;
    pairs.forEach(p => { aStatus[p[0]] = 'correct'; bStatus[p[1]] = 'correct'; correct++; });
    // 把两侧的空隙配对成「替换」：原词记 wrong，用户词也记 wrong
    let ai = 0, bi = 0, pi = 0;
    while (pi <= pairs.length) {
      const ae = pi < pairs.length ? pairs[pi][0] : n;
      const be = pi < pairs.length ? pairs[pi][1] : m;
      const an = ae - ai, bn = be - bi;
      const k = Math.min(an, bn);
      for (let q = 0; q < k; q++) { aStatus[ai + q] = 'wrong'; bStatus[bi + q] = 'wrong'; wrong++; }
      ai = ae; bi = be;
      if (pi < pairs.length) { ai = pairs[pi][0] + 1; bi = pairs[pi][1] + 1; }
      pi++;
    }
    const miss = aStatus.filter(s => s === 'missing').length;
    const extra = bStatus.filter(s => s === 'extra').length;
    const denom = Math.max(n, m) || 1;
    return {
      tokens: A.map((w, k) => ({ word: w, status: aStatus[k] })),
      userTokens: B.map((w, k) => ({ word: w, status: bStatus[k] })),
      correct: correct, wrong: wrong, missing: miss, extra: extra,
      lenA: n, lenB: m,
      accuracy: Math.round(correct / denom * 100),
      wrongWords: A.filter((w, k) => aStatus[k] !== 'correct')
    };
  }
  function dictDiff(original, input) { return diffTokens(original, input, dictTokenizeEn); }
  // 通用版（笔记历史 Delta 的「变了什么」视图用它）—— 中文按单字成 token，否则整段中文会被当成一个词
  function diffWords(original, input) { return diffTokens(original, input, dictTokenizeAny); }

  // ---------- 错词本 ----------
  function dictWrongs() { return insLoad(DICT_WRONG_KEY, []) || []; }
  function dictAddWrongs(words, paraIdx) {
    if (!words || !words.length) return;
    const arr = dictWrongs();
    words.forEach(w => {
      const k = dictKey(w);
      if (!k) return;
      const rec = arr.filter(x => dictKey(x.word) === k)[0];
      if (rec) {
        rec.count = (rec.count || 1) + 1;
        rec.lastAt = new Date().toISOString();
        if (paraIdx && !rec.paraIdx) rec.paraIdx = paraIdx;
      } else {
        arr.push({ word: w, count: 1, articleId: articleId, paraIdx: paraIdx || '', at: new Date().toISOString() });
      }
    });
    arr.sort((a, b) => (b.count || 0) - (a.count || 0));
    insSave(DICT_WRONG_KEY, arr);
  }
  // 错词并进生词本：这是真的「复用」——生词网络 / 词频着色 / 今日复习全都跟着生效
  function dictWordToVocab(word, paraIdx, context) {
    const w = String(word || '').trim();
    if (!w) return;
    const exists = annotations.some(a => a.bucket === 'vocab' && dictKey(a.text) === dictKey(w));
    if (exists) { showTopToast('「' + w + '」已在生词本里'); return; }
    annotations.push({
      id: genId(), type: 'vocab', bucket: 'vocab', text: w,
      note: '默写错词', context: context || '', paraIdx: paraIdx || '',
      createdAt: new Date().toISOString(), from: 'dictation'
    });
    saveAnnotations();
    showTopToast('「' + w + '」已加入生词本');
  }

  // ---------- 面板 ----------
  let dictState = { idx: 0, filter: 'all', items: [], skipped: [], input: '', result: null, revealed: false };
  var _dictBound = false;

  function dictStats() { return insLoad(DICT_STATS_KEY, {}) || {}; }
  function dictStatOf(it) { return dictStats()[articleId + '#' + it.id] || null; }
  function openDictation(focusText) {
    const p = insPanel('dictation-panel', '🖊 中译英默写');
    insOpen(p);
    const built = dictItems();
    dictState.items = built.items;
    dictState.skipped = built.skipped;
    if (focusText) {
      const k = dictKey(String(focusText).slice(0, 60));
      const hit = dictState.items.findIndex(it => dictKey(it.en.slice(0, 60)) === k);
      if (hit >= 0) dictState.idx = hit;
    }
    if (dictState.idx >= dictState.items.length) dictState.idx = 0;
    dictState.input = ''; dictState.result = null; dictState.revealed = false;
    renderDictation();
    const body = document.getElementById('dictation-panel-body');
    if (body && !_dictBound) {
      _dictBound = true;
      body.addEventListener('click', e => {
        const t = e.target;
        const pick = t.closest && t.closest('[data-dfilter]');
        if (pick) { dictState.filter = pick.dataset.dfilter; dictState.idx = 0; nextDictItem(); return; }
        if (t.closest && t.closest('#dict-submit')) { submitDictation(); return; }
        if (t.closest && t.closest('#dict-skip')) { nextDictItem(); return; }
        if (t.closest && t.closest('#dict-reveal')) {
          dictState.revealed = true; dictState.result = dictDiff(currentItem().en, dictState.input);
          renderDictation(); return;
        }
        if (t.closest && t.closest('#dict-prev')) { moveDict(-1); return; }
        if (t.closest && t.closest('#dict-next')) { moveDict(1); return; }
        const v = t.closest && t.closest('[data-dvocab]');
        if (v) { dictWordToVocab(v.dataset.dvocab, v.dataset.dpara, currentItem().en); return; }
        const g = t.closest && t.closest('[data-dgoto]');
        if (g) { jumpToPara(g.dataset.dgoto); return; }
        const all = t.closest && t.closest('#dict-allvocab');
        if (all) {
          const r = dictState.result;
          if (!r) return;
          const uniq = Array.from(new Set(r.wrongWords.map(dictKey)));
          r.wrongWords.forEach(w => dictWordToVocab(w, currentItem().paraIdx, currentItem().en));
          showTopToast('已把 ' + uniq.length + ' 个错词加入生词本');
          return;
        }
      });
      body.addEventListener('input', e => {
        if (e.target && e.target.id === 'dict-input') dictState.input = e.target.value;
      });
      body.addEventListener('keydown', e => {
        if (e.target && e.target.id === 'dict-input' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault(); submitDictation();
        }
      });
    }
  }
  function currentItem() { return dictState.items[dictState.idx] || null; }
  function dictFiltered() {
    const st = dictStats();
    return dictState.items.filter(it => {
      const s = st[articleId + '#' + it.id];
      if (dictState.filter === 'todo') return !s;
      if (dictState.filter === 'fail') return s && s.accuracy < 80;
      if (dictState.filter === 'star') return !!it.star;
      return true;
    });
  }
  function moveDict(d) {
    const list = dictFiltered();
    const cur = currentItem();
    const pos = list.indexOf(cur);
    const next = list[(pos < 0 ? 0 : pos + d + list.length) % list.length];
    if (!next) return;
    dictState.idx = dictState.items.indexOf(next);
    dictState.input = ''; dictState.result = null; dictState.revealed = false;
    renderDictation();
  }
  function nextDictItem() {
    const list = dictFiltered();
    if (!list.length) { renderDictation(); return; }
    const cur = currentItem();
    const pos = list.indexOf(cur);
    const next = list[(pos + 1) % list.length];
    if (next) dictState.idx = dictState.items.indexOf(next);
    dictState.input = ''; dictState.result = null; dictState.revealed = false;
    renderDictation();
  }
  function submitDictation() {
    const it = currentItem();
    if (!it) return;
    const input = (dictState.input || '').trim();
    if (!input) { showTopToast('先写下你的译文再提交'); return; }
    const r = dictDiff(it.en, input);
    dictState.result = r;
    const st = dictStats();
    const k = articleId + '#' + it.id;
    const rec = st[k] || { n: 0, best: 0 };
    rec.n = (rec.n || 0) + 1;
    rec.lastAccuracy = r.accuracy;
    rec.best = Math.max(rec.best || 0, r.accuracy);
    rec.lastAt = new Date().toISOString();
    st[k] = rec;
    insSave(DICT_STATS_KEY, st);
    if (r.wrongWords.length) dictAddWrongs(r.wrongWords, it.paraIdx);
    renderDictation();
    showTopToast(r.accuracy >= 95 ? '几乎完全正确（' + r.accuracy + '%）'
      : r.accuracy >= 80 ? '不错（' + r.accuracy + '%），还有 ' + r.wrongWords.length + ' 处要改'
        : '正确率 ' + r.accuracy + '%，错词已记入错词本');
  }
  function dictTokenHTML(tokens, side) {
    if (!tokens.length) return '<span class="ins-dim">（空）</span>';
    return tokens.map(t => {
      const cls = 'dt-tok dt-' + t.status + (side === 'user' ? ' dt-u' : '');
      const title = t.status === 'correct' ? '' : t.status === 'missing' ? '遗漏' : t.status === 'extra' ? '多写' : '拼写/用词不符';
      return '<span class="' + cls + '" title="' + esc(title) + '">' + esc(t.word) + '</span>';
    }).join(' ');
  }
  function renderDictation() {
    const body = document.getElementById('dictation-panel-body');
    if (!body) return;
    if (!dictState.items.length) {
      body.innerHTML = '<div class="ins-empty">这篇没有可默写的句子。<br>' +
        '<span class="ins-dim">默写需要「英文段落 + 对应中文译文」成对出现，并且句子长度在 6-45 词之间。' +
        '如果这篇的中文是空的，或句式无法逐句对齐，就不出题 —— 硬凑会变成抄写。</span></div>';
      return;
    }
    const st = dictStats();
    const list = dictFiltered();
    const done = dictState.items.filter(it => st[articleId + '#' + it.id]).length;
    const it = currentItem();
    const rec = it ? st[articleId + '#' + it.id] : null;
    const r = dictState.result;
    const chips = [
      ['all', '全部 ' + dictState.items.length],
      ['todo', '未默写 ' + (dictState.items.length - done)],
      ['fail', '正确率 <80% ' + dictState.items.filter(x => st[articleId + '#' + x.id] && st[articleId + '#' + x.id].accuracy < 80).length],
      ['star', '★ 长难句 ' + dictState.items.filter(x => x.star).length]
    ];
    let html = '<div class="ins-filters">' + chips.map(c =>
      '<button type="button" class="ins-chip' + (dictState.filter === c[0] ? ' active' : '') +
      '" data-dfilter="' + c[0] + '">' + esc(c[1]) + '</button>').join('') +
      '<span class="ins-dim" style="margin-left:auto">已练 ' + done + ' / ' + dictState.items.length + ' 句</span></div>';

    if (!it) {
      html += '<div class="ins-empty">当前筛选下没有句子。</div>';
      body.innerHTML = html;
      return;
    }
    const posInList = list.indexOf(it);
    html += '<div class="dt-head">' +
      '<span class="ins-tag' + (it.star ? ' ok' : '') + '">' + (it.star ? '★ 长难句' : '正文') + '</span>' +
      '<span class="ins-tag type">第 ' + esc(it.paraIdx) + ' 段' + (it.whole ? '（整段）' : '') + '</span>' +
      (rec ? '<span class="ins-tag">练过 ' + rec.n + ' 次 · 最高 ' + rec.best + '%</span>' : '<span class="ins-tag">未练过</span>') +
      '<button type="button" class="ins-btn ghost" data-dgoto="' + esc(it.paraIdx) + '">看原文</button>' +
      '<span class="ins-dim" style="margin-left:auto">' + (posInList + 1) + ' / ' + list.length + '</span>' +
      '</div>';
    html += '<div class="dt-cn">' + esc(it.cn) + '</div>';
    html += '<div class="dt-hint ins-dim">看中文写出对应的英文句子（Ctrl+Enter 提交）。' +
      '只比词，不比标点与大小写。</div>';
    html += '<textarea id="dict-input" class="dt-input" rows="' + (it.whole ? 6 : 3) + '" ' +
      'placeholder="在这里默写英文…">' + esc(dictState.input) + '</textarea>';
    html += '<div class="ws-import-actions">' +
      '<button type="button" class="primary" id="dict-submit">提交比对</button>' +
      '<button type="button" class="ins-btn ghost" id="dict-reveal">看答案</button>' +
      '<button type="button" class="ins-btn ghost" id="dict-skip">跳过</button>' +
      '<button type="button" class="ins-btn ghost" id="dict-prev">上一句</button>' +
      '<button type="button" class="ins-btn ghost" id="dict-next">下一句</button>' +
      '</div>';

    if (r) {
      const pct = r.accuracy;
      const tag = pct >= 95 ? 'ok' : pct >= 80 ? '' : 'cause';
      html += '<div class="dt-verdict"><span class="ins-tag ' + tag + '">' + pct + '% 正确</span>' +
        '<span class="ins-dim">对 ' + r.correct + ' · 错 ' + r.wrong + ' · 漏 ' + r.missing + ' · 多 ' + r.extra +
        '（原文 ' + r.lenA + ' 词 / 你写 ' + r.lenB + ' 词）</span></div>';
      html += '<div class="dt-line"><span class="dt-label">你写的</span><div class="dt-tokens">' +
        dictTokenHTML(r.userTokens, 'user') + '</div></div>';
      html += '<div class="dt-line"><span class="dt-label">原文</span><div class="dt-tokens">' +
        dictTokenHTML(r.tokens, 'orig') + '</div></div>';
      if (r.wrongWords.length) {
        const uniq = [];
        r.wrongWords.forEach(w => { if (!uniq.some(x => dictKey(x) === dictKey(w))) uniq.push(w); });
        html += '<div class="dt-wrong"><b>错词 ' + uniq.length + ' 个（已记入错词本）</b>' +
          '<div class="dt-wrong-list">' + uniq.map(w =>
            '<button type="button" class="ins-chip" data-dvocab="' + esc(w) + '" data-dpara="' + esc(it.paraIdx) +
            '" title="加入生词本">' + esc(w) + ' ＋</button>').join('') + '</div>' +
          '<button type="button" class="ins-btn ghost" id="dict-allvocab">全部加入生词本</button></div>';
      } else {
        html += '<div class="dt-verdict"><span class="ins-tag ok">逐词全对</span></div>';
      }
    }
    const wrongs = dictWrongs();
    if (wrongs.length) {
      html += '<details class="ws-samples"><summary>错词本（本机累计 ' + wrongs.length + ' 个词）</summary>' +
        '<div class="dt-wrong-list">' + wrongs.slice(0, 40).map(w =>
          '<span class="ins-chip legend">' + esc(w.word) + ' ×' + (w.count || 1) + '</span>').join('') +
        '</div><div class="ins-dim">点上面「＋」可以把错词并进生词本，之后生词网络、词频着色、今日复习都会带上它。</div></details>';
    }
    if (dictState.skipped.length) {
      html += '<div class="ins-dim">另有 ' + dictState.skipped.length + ' 处未出题（英中无法逐句对齐或长度超出 6-45 词）。</div>';
    }
    body.innerHTML = html;
    const ta = document.getElementById('dict-input');
    if (ta && !r) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }

  window.openDictation = openDictation;
  window.dictDiff = dictDiff;
  window.diffWords = diffWords;   // 通用词级 diff（笔记历史 Delta 的对比视图用它）
  window.dictItems = dictItems;
