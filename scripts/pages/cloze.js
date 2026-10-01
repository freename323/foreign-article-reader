(function () {
  document.body.classList.add('page-cloze');
  // 注入隐藏左栏的样式（不依赖外部 CSS 的 class 选择器，确保生效）
  // 同时把操作栏做成吸顶：交卷按钮原来在页面最顶部，答完 20 题滚到底部后就看不见了
  (function injectHideCSS() {
    const s = document.createElement('style');
    s.textContent =
      'body.page-cloze .pane-article{display:none!important}' +
      'body.page-cloze .pane-questions{flex:1 1 100%;max-width:780px;margin:0 auto;padding:22px 28px 80px}' +
      'body.page-cloze .cz-tools{position:sticky;top:0;z-index:6;background:var(--bg);' +
      'padding:8px 0 10px;margin-bottom:12px;border-bottom:1px solid var(--rule)}' +
      'body.page-cloze .cz-hint{align-self:center;font-size:12px;color:var(--muted);margin-left:4px}';
    document.head.appendChild(s);
  })();
  const slug = document.body.dataset.examId || 'cloze';
  const KEY = 'cz:' + slug;

  // 启动即恢复主题（绿金默认 → 暗色 → 亮色）
  (function applyTheme() {
    let t = 'green';
    try { t = localStorage.getItem('wsj_exam:theme') || 'green'; } catch (e) {}
    if (t === 'dark' || t === 'green' || t === 'blue-gold') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  })();

  // ---------- utils ----------
  const WORD_RE = /[A-Za-z][A-Za-z'-]*/g;
  const lower = w => String(w || '').toLowerCase().replace(/^['-]+|['-]+$/g, '');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  // seeded shuffle (stable per session/storage)
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function shuffle(arr, rnd) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // ---------- morphology helpers ----------
  const FUNCTION_WORDS = new Set(('the a an and or but if of in to for with on at by from as that which who whom whose this these those than then so such very more most much many some any no not only just about into over under between among through during before after above below out up down off again further once all both each few other another own same too also can could may might must shall should will would do does did done is are was were be been being have has had having it its they them their there here when where why how what while because although though since until unless whereas whether nor ever never still yet however therefore thus moreover furthermore meanwhile instead otherwise indeed perhaps maybe across toward upon within without along behind beyond per via amid amongst i me my mine we us our ours you your yours he him his she her hers myself himself herself itself ourselves themselves mr mrs dr ms'.split(' ')));
  const NOUN_SUF = /(tion|sion|ment|ness|ity|ance|ence|ism|ist|ship|hood|age|ure|acy|cies|cies|ers|ism)$/;
  // 语篇衔接词：posOf 判为 func —— 它们只通过 CONNECTORS 库出题，不进实词池
  const DISCOURSE = new Set(('however therefore moreover furthermore nevertheless nonetheless meanwhile instead otherwise thus hence besides accordingly likewise namely notably arguably yet still indeed perhaps maybe rather almost nearly always often seldom'.split(' ')));
  const ADJ_SUF = /(ful|ous|ive|able|ible|ant|ent|ic|less|ish|ary)$/;
  const VERB_SUF = /(ize|ise|ify|ate)$/;
  const COMMON_VERBS = new Set(('say says said make makes made take takes took taken come comes came go goes went gone give gives gave given get gets got get find finds found think thinks thought know knows knew know want wants wanted use uses used tell told ask asked work works worked seem seems seemed feel felt try tried leave left call called need needed become became may might should could would will shall argue argued show showed shown suggest suggested suggest point pointed include included allow allowed require require create created provide provided lead led lead mean meant bring brought grow grew grown spend spent build built offer offered push pushed pull pulled rise rose risen raise raised raise fall fell fallen drop dropped cut cut hit hit put put set set run ran turn turned start started begin began begun move moved play played happen happened consider considered remain remained expect expect produce produced grow grew').split(' '));
  function posOf(word) {
    const w = lower(word);
    if (FUNCTION_WORDS.has(w)) return 'func';
    // 语篇连接副词 / 衔接词：不参与实词挖空，也不进干扰项池（它们当作连接词单独考）
    if (DISCOURSE.has(w)) return 'func';
    if (/ly$/.test(w) && w.length > 4) return 'adv';
    if (COMMON_VERBS.has(w) || VERB_SUF.test(w)) return 'verb';
    if (/ed$/.test(w) && w.length > 4) return 'verb';
    if (/ing$/.test(w) && w.length > 5) return 'verb';
    if (NOUN_SUF.test(w) || /^[A-Z]/.test(word)) return 'noun';
    if (ADJ_SUF.test(w)) return 'adj';
    if (w.length <= 3) return 'func';
    return 'word';
  }
  function baseForm(w) {
    let x = lower(w);
    if (/ies$/.test(x)) return x.slice(0, -3) + 'y';
    if (/es$/.test(x) && x.length > 4) return x.slice(0, -2);
    if (/s$/.test(x) && !/ss$/.test(x)) return x.slice(0, -1);
    if (/ing$/.test(x)) { return x.slice(0, -3); }
    if (/ed$/.test(x)) return x.slice(0, -2);
    return x;
  }
  // 实义词挖空资格：首字母小写（排除专名与句首词）、长度>=3（排除 AI/TV/MR/S 等碎片）
  function isGapWord(t) {
    if (!/^[A-Za-z][A-Za-z'-]*$/.test(t)) return false;
    if (t.length < 3) return false;
    if (t[0] !== t[0].toLowerCase()) return false;
    return true;
  }

  function vocabHit(word, vocab) {
    const w = lower(word);
    if (vocab.has(w)) return w;
    const b = baseForm(w);
    if (vocab.has(b)) return b;
    return null;
  }

  // ---------- libraries ----------
  // 逻辑连接词库：word -> {zh: 逻辑含义, mates: [同类干扰]}; 解析动态生成
  const CONNECTORS = {
    however: { zh: '表转折', mates: ['therefore', 'moreover', 'meanwhile'] },
    therefore: { zh: '表因果（因此）', mates: ['however', 'nonetheless', 'meanwhile'] },
    moreover: { zh: '表递进（此外）', mates: ['however', 'therefore', 'instead'] },
    meanwhile: { zh: '表时间并列（与此同时）', mates: ['therefore', 'however', 'instead'] },
    instead: { zh: '表替代转折（相反）', mates: ['moreover', 'therefore', 'meanwhile'] },
    nevertheless: { zh: '表让步转折（尽管如此）', mates: ['therefore', 'thus', 'moreover'] },
    thus: { zh: '表因果（因而）', mates: ['however', 'moreover', 'meanwhile'] },
    indeed: { zh: '表强调确认（事实上）', mates: ['however', 'otherwise', 'meanwhile'] },
    otherwise: { zh: '表反面假设（否则）', mates: ['therefore', 'moreover', 'indeed'] },
    whereas: { zh: '表对比（然而/鉴于）', mates: ['because', 'so', 'unless'] },
    although: { zh: '表让步（虽然）', mates: ['because', 'so', 'if'] },
    because: { zh: '表原因（因为）', mates: ['although', 'so', 'but'] },
    while: { zh: '表对比/时间（然而/当……时）', mates: ['because', 'unless', 'so'] },
    since: { zh: '表原因/时间（既然/自……起）', mates: ['but', 'unless', 'while'] },
    unless: { zh: '表否定条件（除非）', mates: ['because', 'although', 'if'] },
    if: { zh: '表条件（如果）', mates: ['because', 'although', 'so'] },
    so: { zh: '表结果（所以）', mates: ['because', 'although', 'if'] },
    but: { zh: '表转折（但是）', mates: ['so', 'because', 'and'] },
    and: { zh: '表并列（和）', mates: ['but', 'or', 'so'] },
    or: { zh: '表选择（或者）', mates: ['and', 'but', 'so'] },
  };
  // 近义辨析组：命中文中词 → 组内互为干扰
  // —— 组表越全，题型越多样（实测原先 9 篇只命中 9 个近义空，全篇几乎只剩「实词辨析」）
  const SYN_GROUPS = [
    { words: ['affect', 'effect', 'affects', 'effects'], note: 'affect 是动词"影响"；effect 多作名词"效果/影响"（作动词意为"促成"）。本空需要动词/名词形态与空前后语法一致。' },
    { words: ['imply', 'infer', 'implying', 'implied'], note: 'imply 指说话人"暗含/暗示"；infer 指听者"推断出"。方向相反。' },
    { words: ['rise', 'arise', 'raise', 'risen', 'raised', 'arisen'], note: 'rise（上升，不及物）/arise（问题等出现，不及物）/raise（举起、提高，及物）。' },
    { words: ['adapt', 'adopt', 'adapted', 'adopted', 'adept'], note: 'adapt"适应/改编"；adopt"采纳/收养"；adept"熟练的"（形容词）。' },
    { words: ['principal', 'principle', 'principles'], note: 'principal 作形容词"主要的"、名词"校长/本金"；principle 名词"原则"。' },
    { words: ['considerable', 'considerate'], note: 'considerable"相当大的"；considerate"体贴的"。' },
    { words: ['ensure', 'insure', 'assure', 'ensures', 'assures'], note: 'ensure"确保（某事发生）"；assure"向某人保证"；insure"投保"。' },
    { words: ['lie', 'lay', 'lies', 'lays', 'lying'], note: 'lie（躺/位于，不及物）/lay（放置，及物）。' },
    { words: ['amount', 'number', 'amounts', 'numbers'], note: 'amount 搭配不可数名词；number 搭配可数名词复数。' },
    { words: ['economic', 'economical'], note: 'economic"经济（学）的"；economical"节省的、划算的"。' },
    { words: ['contribute', 'attribute', 'distribute', 'contributes', 'attributes'], note: 'contribute"贡献/促成"；attribute A to B"把 A 归因于 B"；distribute"分配"。' },
    { words: ['acquire', 'require', 'inquire', 'acquired', 'required'], note: 'acquire"获得"；require"需要/要求"；inquire"询问"。' },
    { words: ['comprise', 'compose', 'compromise', 'comprises', 'composed'], note: 'comprise"包含"；compose"构成/创作"；compromise"妥协"。' },
    { words: ['attain', 'obtain', 'contain', 'attained', 'obtained'], note: 'attain"达到（目标/水平）"；obtain"获得（实物/许可）"；contain"包含"。' },
    { words: ['access', 'excess', 'assess', 'assessed'], note: 'access"接近/使用权"；excess"过量"；assess"评估"。' },
    { words: ['sensible', 'sensitive'], note: 'sensible"明智的"；sensitive"敏感的"。' },
    { words: ['respectful', 'respectable', 'respective'], note: 'respectful"恭敬的"；respectable"体面的"；respective"各自的"。' },
    { words: ['historic', 'historical'], note: 'historic"有历史意义的"；historical"历史的（史实的）"。' },
    { words: ['imaginary', 'imaginative', 'imaginable'], note: 'imaginary"虚构的"；imaginative"富有想象力的"；imaginable"可想象的"。' },
    { words: ['industrial', 'industrious'], note: 'industrial"工业的"；industrious"勤勉的"。' },
    { words: ['efficient', 'effective', 'efficiency'], note: 'efficient"效率高的"（投入产出比）；effective"有效的"（达到目的）。' },
    { words: ['precede', 'proceed', 'proceeds'], note: 'precede"先于"；proceed"继续进行"。' },
    { words: ['deprive', 'derive', 'derived'], note: 'deprive sb of sth"剥夺"；derive A from B"从 B 得到 A"。' },
    { words: ['impose', 'expose', 'dispose', 'imposed', 'exposed'], note: 'impose on"强加"；expose to"使暴露于"；dispose of"处理掉"。' },
    { words: ['intelligent', 'intelligible', 'intellectual'], note: 'intelligent"聪明的"；intelligible"可理解的"；intellectual"智力的/知识分子"。' },
    { words: ['worth', 'worthy', 'worthwhile'], note: 'worth 后接名词/动名词；worthy of 后接名词；worthwhile 可作定语或表语。' },
    { words: ['conscious', 'conscientious', 'consciousness'], note: 'conscious"有意识的"；conscientious"认真尽责的"。' },
  ];
  // 固定搭配表（在文中命中短语才出题）：phrase 数组 → 挖其中某一词
  const COLLOCATIONS = [
    { phrase: ['take', 'into', 'account'], hole: 2, note: '固定搭配 take ... into account "把……考虑在内"。' },
    { phrase: ['in', 'light', 'of'], hole: 1, note: '固定短语 in light of "鉴于、根据"。' },
    { phrase: ['account', 'for'], hole: 1, note: 'account for "解释、占（比例）"。' },
    { phrase: ['lead', 'to'], hole: 1, note: 'lead to "导致"，to 为介词，后接名词。' },
    { phrase: ['rely', 'on'], hole: 1, note: 'rely on "依赖"。' },
    { phrase: ['depend', 'on'], hole: 1, note: 'depend on "取决于、依靠"。' },
    { phrase: ['participate', 'in'], hole: 1, note: 'participate in "参与"。' },
    { phrase: ['as', 'a', 'result'], hole: 2, note: '固定短语 as a result "结果"。' },
    { phrase: ['in', 'addition'], hole: 0, note: '固定短语 in addition "此外"。' },
    { phrase: ['according', 'to'], hole: 1, note: 'according to "根据"。' },
    { phrase: ['in', 'contrast'], hole: 0, note: 'in contrast "相比之下"。' },
    { phrase: ['at', 'least'], hole: 1, note: 'at least "至少"。' },
    { phrase: ['for', 'example'], hole: 1, note: 'for example "例如"。' },
    { phrase: ['pay', 'attention', 'to'], hole: 1, note: 'pay attention to "注意"，attention 前动词固定为 pay。' },
    { phrase: ['play', 'a', 'role'], hole: 1, note: 'play a role "发挥作用"。' },
    { phrase: ['in', 'terms', 'of'], hole: 1, note: 'in terms of "就……而言/从……角度"。' },
    { phrase: ['take', 'advantage', 'of'], hole: 1, note: 'take advantage of "利用"。' },
    { phrase: ['make', 'sense'], hole: 1, note: 'make sense "说得通、有道理"。' },
    { phrase: ['give', 'rise', 'to'], hole: 1, note: 'give rise to "导致、引起"。' },
    { phrase: ['bear', 'in', 'mind'], hole: 2, note: 'bear ... in mind "把……记在心里"。' },
    { phrase: ['call', 'into', 'question'], hole: 2, note: 'call ... into question "对……提出质疑"。' },
    { phrase: ['on', 'average'], hole: 1, note: 'on average "平均而言"。' },
    { phrase: ['at', 'odds', 'with'], hole: 1, note: 'at odds with "与……不一致、相冲突"。' },
    { phrase: ['in', 'line', 'with'], hole: 1, note: 'in line with "与……一致"。' },
    { phrase: ['subject', 'to'], hole: 1, note: 'be subject to "易于遭受；取决于"。to 为介词。' },
    { phrase: ['rather', 'than'], hole: 1, note: 'rather than "而不是"，前后结构需对称。' },
    { phrase: ['instead', 'of'], hole: 1, note: 'instead of "代替、而不是"。' },
    { phrase: ['capable', 'of'], hole: 1, note: 'be capable of doing "有能力做"。' },
    { phrase: ['based', 'on'], hole: 1, note: 'be based on "以……为基础"。' },
    { phrase: ['associated', 'with'], hole: 1, note: 'be associated with "与……有关联"。' },
    { phrase: ['compared', 'with'], hole: 1, note: 'compared with/to "与……相比"。' },
    { phrase: ['responsible', 'for'], hole: 1, note: 'be responsible for "对……负责；是……的原因"。' },
    { phrase: ['compensate', 'for'], hole: 1, note: 'compensate for "补偿、弥补"。' },
    { phrase: ['allow', 'for'], hole: 1, note: 'allow for "考虑到、留出"。' },
    { phrase: ['substitute', 'for'], hole: 1, note: 'substitute A for B "用 A 替代 B"。' },
  ];
  const POS_ZH = { verb: '动词', noun: '名词', adj: '形容词', adv: '副词', func: '虚词（介词/连词/代词等）', word: '实义词' };

  // ---------- state ----------
  const PARAS = window.__CLOZE_PARAS__ || [];
  let state = loadLS();
  let exam = null; // {tokens, gaps:[{no, idx, answer, pos, kind, opts:[4], expl}], done}

  function loadLS() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function saveLS() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  function myVocab() {
    const set = new Set();
    try {
      const arr = JSON.parse(localStorage.getItem('annotations:' + slug) || '[]');
      (Array.isArray(arr) ? arr : []).forEach(a => {
        if (a && a.bucket === 'vocab' && a.text) {
          String(a.text).toLowerCase().replace(/[^a-z'\- ]+/g, ' ').split(/\s+/)
            .forEach(w => { if (w.length > 2) { set.add(w); set.add(baseForm(w)); } });
        }
      });
    } catch (e) {}
    return set;
  }
  function myNoteCount() {
    try {
      const arr = JSON.parse(localStorage.getItem('annotations:' + slug) || '[]');
      return (Array.isArray(arr) ? arr : []).filter(a => a && a.bucket === 'vocab').length;
    } catch (e) { return 0; }
  }

  // ---------- passage selection ----------
  function wordCount(t) { return (t.match(WORD_RE) || []).length; }
  function selectWindow(seed, cycle) {
    // 连续段落滑窗，总词数 240-280；按窗口内用户生词命中数优先
    const vocab = myVocab();
    const wins = [];
    for (let i = 0; i < PARAS.length; i++) {
      let wc = 0, j = i;
      while (j < PARAS.length && wc < 240) { wc += wordCount(PARAS[j]); j++; }
      if (wc >= 240 && wc <= 300) {
        const text = PARAS.slice(i, j).join(' ');
        const hits = (text.match(WORD_RE) || []).filter(w => vocabHit(w, vocab)).length;
        wins.push({ start: i, end: j, text, wc, hits });
      }
    }
    if (wins.length === 0) {
      // 兜底：拼到 200 词以上也接受
      for (let i = 0; i < PARAS.length; i++) {
        let wc = 0, j = i;
        while (j < PARAS.length && wc < 200) { wc += wordCount(PARAS[j]); j++; }
        if (wc >= 200) {
          const text = PARAS.slice(i, j).join(' ');
          wins.push({ start: i, end: j, text, wc, hits: 0 });
        }
      }
    }
    if (wins.length === 0) return null;
    if (cycle) return wins[(seed || 0) % wins.length];
    wins.sort((a, b) => (b.hits - a.hits) || Math.abs(a.wc - 260) - Math.abs(b.wc - 260));
    const s2 = seed || 0;
    return wins[cycle ? (s2 % wins.length) : Math.min(s2, wins.length - 1)];
  }

  // ---------- gap generation ----------
  // ── 质量约束 ───────────────────────────────────────────────────────────────
  // 完形的质量不取决于「有没有答案」，而取决于**干扰项能不能构成有效区分**。
  // 上一版实测（9 篇 × 20 空 = 180 空）暴露的 6 个问题与对策：
  //   ① 干扰项混进专名（buffett / january / obama / lbj / shropshire…）→ 一眼排除，送分题；
  //      → properWords() 建专名黑名单：只以大写形式出现过的词 + 全大写缩写一律不参与；
  //   ② 干扰项与答案词形不一致（答案 take，干扰项 produced）→ 语法上直接排除，等于送分；
  //      → formOf() 要求干扰项与答案形态一致（base / -s / -ed / -ing）；
  //   ③ 连续挖空（实测有两空只隔 1 个字符）→ 两个空之间至少隔 MIN_GAP_TOKENS 个 token；
  //   ④ 挖在段首句（实测 30/180）→ 首句是段落主题锚点，整体设为禁挖区
  //      （单句成段时不设禁挖，否则整段无空）；
  //   ⑤ 固定搭配题从未命中（实测 9 篇 0 个）——短语匹配把空白 token 也算进了下标；
  //      → 改为按「词 token」序列匹配，并检查短语在原文里确实连续；
  //   ⑥ 解析里写「考研真题 30%」这类无来源百分比、写「兜底」暴露生成机制（实测 180/180）；
  //      → 全部删除，改为「考点 / 答案 / 逐个干扰项为什么不行 / 方法」四行。
  const MIN_GAP_TOKENS = 8;
  const PURE_WORD = /^[a-z]{3,}$/;   // 纯小写字母且 ≥3：排除缩写 / 撇号 / 连字符 / 数字
  const PREP_POOL = ['to', 'of', 'for', 'with', 'in', 'on', 'at', 'from', 'by', 'into', 'as', 'about', 'against', 'over'];
  const KIND_META = {
    mine:   { tag: '生词复现', tip: '这个词你在生词本里记录过 —— 先回想含义，再看选项。' },
    colloc: { tag: '固定搭配', tip: '看空前后的词能否与选项构成固定搭配。' },
    conn:   { tag: '逻辑衔接', tip: '先判断空前后是因果、转折、让步还是并列，再选连接词。' },
    syn:    { tag: '近义词辨析', tip: '同组词含义相近，差别在方向与搭配上。' },
    pos:    { tag: '实词辨析', tip: '四个选项词性与词形一致 —— 只能靠上下文的语义与搭配排除。' }
  };
  // 考研英语一常见实词：只在「配平阶段」作为**优先候选**信号，不做硬过滤
  const HIGH_FREQ = new Set(('account achieve acknowledge acquire adapt address adequate adjust adopt advocate affect alternative ambiguous anticipate apparent approach appropriate assess assume attain attribute available aware benefit capacity challenge circumstance cite clarify coherent coincide collapse commitment compensate competent complex comply comprise conceive concern conclude conduct confine conflict conform confront consensus consequence considerable consistent constitute constrain consume contemplate contradict contrast contribute controversial conventional convey convince crucial cultivate decline deduce define demonstrate deny derive diminish discard disclose discrete distinguish distribute diverse dominate eliminate emerge emphasize empirical enable encounter endorse enhance ensure entail essential establish evaluate evident evolve exceed exclude exhibit expand explicit exploit expose external facilitate feasible fluctuate formulate foster framework fulfill fundamental generate genuine guarantee highlight identify illustrate imply impose incentive incline incorporate indicate inevitable infer inherent initiate innovate insight justify legitimate maintain manipulate marginal maximize mechanism minimize modify monitor negotiate notion objective obligation obtain obvious occupy occurrence offset perceive persist perspective phenomenon possess potential precise predominant preliminary presume prevail prohibit promote prospect provoke pursue radical random rational recover refine reinforce reject relevant reluctant remedy render require resemble resolve resource retain reveal revenue reverse revise rigid scarce scrutiny secure seek sequence significant simulate sole stable stimulate strategy subsequent substantial substitute subtle sufficient sustain tackle temporary terminate thereby thesis tolerant transcend transfer transform transmit undermine underestimate undergo uniform universal utilize vague valid verify viable violate virtue voluntary widespread').split(' '));

  function formOf(w) {
    const x = lower(w);
    if (/ing$/.test(x) && x.length > 5) return 'ing';
    if (/ied$/.test(x) || (/ed$/.test(x) && x.length > 4)) return 'ed';
    if (/ies$/.test(x) || (/[^s]s$/.test(x) && !/ss$/.test(x) && x.length > 3)) return 's';
    return 'base';
  }
  // 专名黑名单：文中「只以大写形式出现」的词（大小写两种形式都出现过 → 不是专名）+ 全大写缩写
  let _proper = null;
  function properWords() {
    if (_proper) return _proper;
    const cap = new Set(), low = new Set();
    PARAS.forEach(p => (p.match(WORD_RE) || []).forEach(w => {
      if (w.length < 2) return;
      if (w[0] !== w[0].toLowerCase()) cap.add(w.toLowerCase()); else low.add(w.toLowerCase());
    }));
    const out = new Set();
    cap.forEach(w => { if (!low.has(w)) out.add(w); });
    PARAS.forEach(p => (p.match(/\b[A-Z][A-Z]+\b/g) || []).forEach(w => out.add(w.toLowerCase())));
    // ⚠ 句首大写且从不小写出现的连接词会被误判成专名（Indeed / Moreover），逐一剔除：
    //   它们是标准英语衔接词，必须能作为「逻辑衔接题」的选项。
    Object.keys(CONNECTORS).forEach(w => out.delete(w));
    DISCOURSE.forEach(w => out.delete(w));
    _proper = out;
    return out;
  }
  // 是否可作为考点：纯小写字母、非专名、非功能词、词性可判
  function gapWorthy(t) {
    if (!PURE_WORD.test(t)) return false;
    if (properWords().has(t)) return false;
    if (FUNCTION_WORDS.has(t)) return false;
    return posOf(t) !== 'func';
  }
  function context(tokens, i) {
    return tokens.slice(Math.max(0, i - 6), i).join('') + ' ▢ ' + tokens.slice(i + 1, i + 7).join('');
  }
  function orderOpts(list, rnd, ansPos) {
    const seen = [];
    list.forEach(x => { const l = lower(x); if (l && !seen.map(lower).includes(l)) seen.push(x); });
    const arr = shuffle(seen, rnd).slice(0, 4);
    if (ansPos === undefined || arr.length < 4) return arr;
    // 把答案摆到指定位置：实测纯随机时 9 篇里 D 占 31%、B 只占 19%，
    // 固定按插入序 0/1/2/3 轮转可保证四个位置各占 1/4，学生没法靠蒙同一个字母得分。
    const ai = arr.findIndex(x => lower(x) === lower(list[0]));
    if (ai < 0) return arr;
    const keep = arr.splice(ai, 1)[0];
    arr.splice(Math.max(0, Math.min(3, ansPos)), 0, keep);
    return arr;
  }
  function explFor(kind, answer, dists, tokens, tIdx, note) {
    const meta = KIND_META[kind] || KIND_META.pos;
    const lines = [];
    lines.push('<div class="cz-layer"><b>📌 考点</b> ' + meta.tag + ' — ' + meta.tip + '</div>');
    lines.push('<div class="cz-layer"><b>✅ 答案</b> <b>' + esc(answer) + '</b>　语境：「…' + esc(context(tokens, tIdx)) + '…」</div>');
    if (kind === 'conn') {
      lines.push('<div class="cz-layer"><b>❌ 其他选项</b> ' + dists.map(d =>
        '「' + esc(d) + '」' + (CONNECTORS[lower(d)] ? '（' + CONNECTORS[lower(d)].zh + '）' : '') +
        '与空前后的逻辑关系不符').join('；') + '</div>');
      lines.push('<div class="cz-layer"><b>💡 方法</b> 连接词按关系分四类：因果 / 转折 / 让步 / 并列，先定关系再选词。</div>');
    } else if (kind === 'syn') {
      lines.push('<div class="cz-layer"><b>❌ 其他选项</b> ' + dists.map(d => '「' + esc(d) + '」').join('、') +
        ' 与答案同源或同义，但在本句的语境与搭配中不成立。</div>');
      if (note) lines.push('<div class="cz-layer"><b>💡 辨析</b> ' + esc(note) + '</div>');
    } else if (kind === 'colloc') {
      lines.push('<div class="cz-layer"><b>❌ 其他选项</b> ' + dists.map(d => '「' + esc(d) + '」').join('、') +
        ' 与空相邻的词混搭不构成固定搭配。</div>');
      if (note) lines.push('<div class="cz-layer"><b>💡 搭配</b> ' + esc(note) + '</div>');
    } else {
      lines.push('<div class="cz-layer"><b>❌ 其他选项</b> ' + dists.map(d => '「' + esc(d) + '」').join('、') +
        ' 与答案词性、词形一致，但在本句搭配中语义不成立。</div>');
      lines.push('<div class="cz-layer"><b>💡 方法</b> 先看空后接什么（介词 / 宾语 / 时态），再用语义排除。</div>');
    }
    if (kind === 'mine') lines.push('<div class="cz-layer"><b>📌 复习提示</b> 此词你在生词本中记录过，优先复习。</div>');
    return lines.join('');
  }

  function buildExam(win, seedN) {
    const vocab = myVocab();
    const rnd = mulberry32(12345 + seedN * 7919 + win.start * 31);
    // 保留空白 token，渲染时 join('') 才能还原空格
    const tokens = win.text.match(/[A-Za-z][A-Za-z'-]*|\s+|[^A-Za-z\s]+/g) || [];
    const proper = properWords();
    // 干扰项词池：只收「可做考点」的词（已排除专名 / 缩写 / 撇号连字符）
    // 分三层，干扰项按「同词性 → 同类型 → 任意」逐层放宽，避免名词空里塞进形容词
    const pool = { verb: [], noun: [], adj: [], adv: [], word: [], any: [] };
    const poolSeen = Object.create(null);
    PARAS.forEach(p => (p.match(WORD_RE) || []).forEach(w => {
      const l = w.toLowerCase();
      if (!PURE_WORD.test(l) || proper.has(l) || FUNCTION_WORDS.has(l)) return;
      const pos = posOf(l);
      if (pos === 'func') return;
      if (poolSeen[pos + l]) return;
      poolSeen[pos + l] = 1;
      pool[pos].push(l);
      pool.any.push(l);
    }));
    // 每个 token 的字符偏移（切片渲染用）
    const offs = [];
    let _acc = 0;
    tokens.forEach(t => { offs.push(_acc); _acc += t.length; });
    // 词 token 序列（固定搭配必须按「词」匹配，不能把空白 token 算进下标）
    const wtok = [];
    tokens.forEach((t, i) => { if (/[A-Za-z]/.test(t)) wtok.push({ t: lower(t), i: i }); });

    // 段落首句禁挖区：单句成段的段落不设禁挖，否则整段一个空都没有
    // ⚠ 首句终点必须用「句末标点 + 空白/结尾」的 lookahead 来找：
    //   上一版用 /[^.!?]+[.!?]+(\s+|$)/g 取第一个 match，遇到 "the U.S. Senate" 这种
    //   缩写会从 "S. " 开始匹配（前一段被跳过），于是整段几乎不受禁挖约束 —— 实测漏了 30/180。
    const firstSentRanges = (function () {
      const out = []; let cur = 0;
      for (let pi = win.start; pi < win.end; pi++) {
        const p = PARAS[pi] || '';
        const m = /[.!?]["')\]]?(?=\s|$)/.exec(p);
        const end = m ? m.index + m[0].length : -1;
        if (end > 0 && end < p.length - 1) out.push([cur, cur + end]);
        cur += p.length + 1;
      }
      return out;
    })();
    const inFirstSent = off => firstSentRanges.some(r => off >= r[0] && off < r[1]);

    const usedIdx = new Set();
    const usedWords = new Set();   // 同一个词只挖一次，避免重复考点
    const gaps = [];
    function canPlace(i, off) {
      if (usedIdx.has(i)) return false;
      if (inFirstSent(off)) return false;
      for (let k = 0; k < gaps.length; k++) if (Math.abs(i - gaps[k].tIdx) < MIN_GAP_TOKENS) return false;
      return true;
    }
    // 干扰项：优先「同词性 + 同词形 + 拼写近邻」，再退到同词形随机；始终排除专名与非法词形
    function distract(pos, answer, n) {
      n = n || 3;
      const fa = formOf(answer), a = lower(answer), out = [];
      const ok = w => !!w && PURE_WORD.test(w) && w !== a && !proper.has(w) && !out.includes(w);
      const push = w => { if (ok(w) && out.length < n) out.push(w); };
      const syn = SYN_GROUPS.find(g => g.words.map(lower).includes(a));
      if (syn) syn.words.map(lower).forEach(w => { if (formOf(w) === fa) push(w); });
      function fill(src) {
        const same = src.filter(w => formOf(w) === fa && ok(w));
        same.filter(w => w.slice(0, 3) === a.slice(0, 3)).forEach(push);
        let g = 0;
        while (out.length < n && same.length && g++ < 200) push(same[Math.floor(rnd() * same.length)]);
      }
      fill(pool[pos] || []);
      if (out.length < n && pos !== 'word') fill(pool.word);
      if (out.length < n) fill(pool.any);
      return out.slice(0, n);
    }
    // 选项固定 4 个；凑不出 4 个就放弃这个空（宁缺毋滥，后面还有别的候选）
    function addGap(tIdx, kind, pos, answer, dists, mine, note) {
      if (gaps.length >= 20) return false;
      const ds = dists || distract(pos, answer);
      const opts = orderOpts([answer].concat(ds), rnd, gaps.length % 4);
      if (opts.length < 4) return false;
      gaps.push({
        no: gaps.length + 1, tIdx: tIdx, off: offs[tIdx],
        answer: answer, disp: tokens[tIdx], pos: pos, kind: kind,
        opts: opts, expl: explFor(kind, answer, ds, tokens, tIdx, note), mine: !!mine
      });
      usedIdx.add(tIdx);
      usedWords.add(lower(answer));
      return true;
    }

    // 1) 用户生词优先（考自己记过的词，激励最大）
    const mineIdx = [];
    tokens.forEach((t, i) => {
      if (!gapWorthy(t)) return;
      if (i <= 2 || i >= tokens.length - 2) return;
      if (vocabHit(t, vocab)) mineIdx.push(i);
    });
    let mineAdded = 0;
    shuffle(mineIdx, rnd).forEach(i => {
      if (mineAdded >= 6) return;
      const w = lower(tokens[i]);
      if (usedWords.has(w) || !canPlace(i, offs[i])) return;
      if (addGap(i, 'mine', posOf(w), w, null, true)) mineAdded++;
    });

    // 2) 固定搭配（按词 token 匹配；介词类空用介词池做干扰项）——整篇最多 3 个，防止一份卷子全是介词
    let collocN = 0;
    COLLOCATIONS.forEach(c => {
      if (gaps.length >= 20 || collocN >= 3) return;
      const L = c.phrase.length;
      for (let k = 0; k + L <= wtok.length; k++) {
        let hit = true;
        for (let q = 0; q < L; q++) { if (wtok[k + q].t !== c.phrase[q]) { hit = false; break; } }
        if (!hit) continue;
        // 短语在原文里必须连续（中间只能是空白 / 连字符）
        let contiguous = true;
        for (let q = 1; q < L; q++) {
          const between = tokens.slice(wtok[k + q - 1].i + 1, wtok[k + q].i).join('');
          if (!/^[\s\-]*$/.test(between)) { contiguous = false; break; }
        }
        if (!contiguous) continue;
        const hi = wtok[k + c.hole].i;
        const answer = lower(tokens[hi]);
        if (usedWords.has(answer) || !canPlace(hi, offs[hi])) continue;
        const isFunc = FUNCTION_WORDS.has(answer);
        const ds = isFunc
          ? shuffle(PREP_POOL.filter(p => p !== answer), rnd).slice(0, 3)
          : distract(isFunc ? 'func' : posOf(answer), answer);
        addGap(hi, 'colloc', isFunc ? 'func' : posOf(answer), answer, ds, false,
          c.phrase.join(' ') + '　' + c.note);
        collocN++;
        return;
      }
    });

    // 3) 逻辑连接词（配额 4-5）
    let connN = 0;
    for (let i = 0; i < tokens.length && connN < 5 && gaps.length < 20; i++) {
      const w = lower(tokens[i]);
      if (!CONNECTORS[w] || usedWords.has(w)) continue;
      if (!canPlace(i, offs[i])) continue;
      const ds = shuffle(CONNECTORS[w].mates, rnd).slice(0, 3);
      if (addGap(i, 'conn', 'func', w, ds, false)) connN++;
    }

    // 4) 近义辨析（每组最多 1 个；组内必须有形态一致的伙伴，否则「辨析」不成立）
    SYN_GROUPS.forEach(g => {
      if (gaps.length >= 20) return;
      for (let i = 0; i < tokens.length; i++) {
        const w = lower(tokens[i]);
        if (g.words.map(lower).indexOf(w) < 0 || usedWords.has(w)) continue;
        if (!canPlace(i, offs[i])) continue;
        const mates = g.words.map(lower).filter(x => x !== w && formOf(x) === formOf(w));
        if (!mates.length) continue;
        if (addGap(i, 'syn', posOf(w), w, null, false, g.note)) return;
      }
    });

    // 5) 按词性配额配平（动词 / 名词为主，形容词次之，副词少量）——优先考研高频实词
    [['verb', 5], ['noun', 4], ['adj', 4], ['adv', 2]].forEach(function (item) {
      const pos = item[0], quota = item[1];
      for (let n = 0; n < quota && gaps.length < 20; n++) {
        if (gaps.filter(x => x.pos === pos).length >= quota) break;
        const cand = [];
        tokens.forEach((t, i) => {
          if (posOf(t) !== pos) return;
          if (!gapWorthy(t)) return;
          if (i <= 2 || i >= tokens.length - 2) return;
          if (usedWords.has(lower(t))) return;
          if (!canPlace(i, offs[i])) return;
          cand.push(i);
        });
        if (!cand.length) break;
        const hf = cand.filter(i => HIGH_FREQ.has(baseForm(tokens[i])));
        const from = hf.length ? hf : cand;
        const i = from[Math.floor(rnd() * from.length)];
        if (addGap(i, 'pos', pos, lower(tokens[i]), null, false)) { /* ok */ }
        else usedIdx.add(i);
      }
    });

    // 6) 兜底：任何合法候选，凑满 20（仍受专名 / 词形 / 间距 / 段首句约束）
    for (let guard = 0; gaps.length < 20 && guard < 400; guard++) {
      const cand = [];
      tokens.forEach((t, i) => {
        if (!gapWorthy(t)) return;
        if (i <= 2 || i >= tokens.length - 2) return;
        if (usedWords.has(lower(t))) return;
        if (!canPlace(i, offs[i])) return;
        cand.push(i);
      });
      if (!cand.length) break;
      const i = cand[Math.floor(rnd() * cand.length)];
      if (!addGap(i, 'pos', posOf(tokens[i]), lower(tokens[i]), null, false)) usedIdx.add(i);
    }

    gaps.sort((a, b) => a.off - b.off);
    gaps.forEach((g, i) => g.no = i + 1);
    return { tokens, gaps, winStart: win.start, winEnd: win.end, passage: win.text, wc: win.wc, mineCount: gaps.filter(g => g.mine).length };
  }

  // ---------- render ----------
  function render() {
    const list = document.getElementById('q-list');
    if (!exam) {
      list.innerHTML = '<div class="exam-empty">无法生成完形填空（段落不足）。</div>';
      return;
    }
    const st = state[exam.winStart] || {};
    const answered = exam.gaps.filter(g => (st[g.no] || {}).pick).length;
    const done = exam.done;
    let html = '';
    html += '<div class="cz-notice">📝 选段：原文第 ' + (exam.winStart + 1) + '–' + exam.winEnd + ' 段（约 ' + exam.wc + ' 词），' + exam.gaps.length + ' 个空。' +
      (exam.mineCount > 0 ? ' 其中 <b>' + exam.mineCount + ' 个空</b>考的是你在本篇生词本记录过的词 📌。' : ' 先在文章页标注生词，练习会优先考你记过的词。') + '</div>';
    html += '<div class="cz-headline">完形填空练习（共10分）</div>';
    html += '<div class="cz-tools">' +
      '<button class="cz-btn primary" id="cz-submit"' + (done ? ' disabled title="重做请点「重做本段」"' : '') + '>' + (done ? '✓ 已交卷（' + exam.doneRight + '/' + exam.gaps.length + ' 对）' : '交卷判分 · 看答案') + '</button>' +
      '<button class="cz-btn" id="cz-rebuild">🔄 换一段</button>' +
      '<button class="cz-btn" id="cz-redo">🗑 重做本段</button>' +
      '<span class="cz-hint">' + (done ? '答案与解析已展开 ↓' : '答完后点左侧按钮揭晓答案与解析') + '</span></div>';
    if (done) {
      const total = exam.gaps.length;
      const right = exam.gaps.filter(g => (st[g.no] || {}).pick === lower(g.answer)).length;
      exam.doneRight = right;
      const score = total ? (right / total * 10).toFixed(1) : '0.0';
      html += '<div class="cz-score" style="display:block"><span class="num">' + score + '</span> / 10 分 ——答对 ' + right + ' / ' + total + ' 空。灰色解析已展开，错空已在文中标红。</div>';
    }
    // passage — 按段落分组（每 2 段一组，尾部不足与开头合并）
    const sorted = exam.gaps.slice().sort((a, b) => a.off - b.off);
    // 计算每个段落在 passage 字符串中的起止偏移
    const pRanges = []; // [{pIdx, start, end}]
    let cumOff = 0;
    for (let pi = exam.winStart; pi < exam.winEnd; pi++) {
      const w = PARAS[pi] || '';
      pRanges.push({ pIdx: pi, start: cumOff, end: cumOff + w.length });
      cumOff += w.length + 1; // +1 for the space join
    }
    // 分组：每 2 段一组；若最后只剩 1 段，合并到第 1 组
    const groups = []; // [{start, end, pIdxes, label}]
    const STEP = 2;
    for (let gi = 0; gi < pRanges.length; gi += STEP) {
      let end = gi + STEP;
      if (end > pRanges.length) end = pRanges.length;
      groups.push({ start: pRanges[gi].start, end: pRanges[end - 1].end, pIdxes: pRanges.slice(gi, end).map(r => r.pIdx) });
    }
    // 若只剩 1 组（段落≤2），不显示组标题
    const showGroupLabels = groups.length > 1;

    html += '<div class="cz-groups">';
    groups.forEach((gr, gi) => {
      const gStart = gr.start, gEnd = gr.end;
      const gGaps = sorted.filter(g => g.off >= gStart && g.off < gEnd);
      const label = showGroupLabels
        ? '<div class="cz-group-label">第 ' + gr.pIdxes.map(i => i + 1).join('、') + ' 段</div>'
        : '';
      // passage text for this group (with inline gap markers)
      let pHtml = '';
      let last = gStart;
      gGaps.forEach(g => {
        pHtml += esc(exam.passage.slice(last, g.off));
        const pick = (st[g.no] || {}).pick || '';
        const cls = 'cz-gap' + (pick ? ' answered' : '') + (done ? (pick === lower(g.answer) ? ' right' : ' wrong') : '') + ((state.cur === g.no) ? ' current' : '');
        pHtml += '<span class="' + cls + '" data-gap="' + g.no + '">' + (done ? esc(g.disp || g.answer) : (g.no + '. ' + (pick || '▢'))) + '</span> ';
        last = g.off + g.answer.length;
      });
      pHtml += esc(exam.passage.slice(last, gEnd));
      // options for this group
      let oHtml = '';
      gGaps.forEach(g => {
        const pick = (st[g.no] || {}).pick || '';
        oHtml += '<div class="cz-qrow' + (state.cur === g.no ? ' current' : '') + '" data-qrow="' + g.no + '">' +
          '<span class="cz-qno">' + g.no + '.</span>';
        ['A', 'B', 'C', 'D'].forEach((L, k) => {
          const w = g.opts[k] || '';
          let cls = 'cz-opt' + (pick === lower(w) ? ' picked' : '');
          if (done) {
            if (lower(w) === lower(g.answer)) cls += ' right';
            else if (pick === lower(w)) cls += ' wrongpick';
          }
          oHtml += '<button type="button" class="' + cls + '" data-q="' + g.no + '" data-w="' + esc(w) + '"' + (done ? ' disabled' : '') + '>' + L + '. ' + esc(w) + '</button>';
        });
        if (done) {
          const right = pick === lower(g.answer);
          oHtml += '<div class="cz-expl open"><b>' + g.no + '. 答案：' + esc(g.disp || g.answer) + '</b>（你选：' + (pick ? esc(pick) : '未作答') + (right ? ' ✓' : ' ✗') + '）<br>' + g.expl + '</div>';
        }
        oHtml += '</div>';
      });
      html += '<div class="cz-group">' + label +
        '<div class="cz-passage">' + pHtml + '</div>' +
        oHtml + '</div>';
    });
    html += '</div>';
    list.innerHTML = html;
    wire();
    renderProgress();
    // 交卷后：逐题动画揭晓
    if (done) {
      const rows = list.querySelectorAll('.cz-qrow');
      rows.forEach((row, i) => {
        setTimeout(() => {
          row.classList.add('animate-in');
          const rightBtn = row.querySelector('.cz-opt.right');
          const wrongBtn = row.querySelector('.cz-opt.wrongpick');
          if (rightBtn) rightBtn.classList.add('animate-in');
          if (wrongBtn) wrongBtn.classList.add('animate-in');
        }, i * 80);
      });
      const gaps = list.querySelectorAll('.cz-gap.right, .cz-gap.wrong');
      gaps.forEach((gap, i) => {
        setTimeout(() => gap.classList.add('animate-in'), i * 60);
      });
    }
  }

  function renderProgress() {
    const el = document.getElementById('exam-progress');
    const st = state[exam.winStart] || {};
    const answered = exam.gaps.filter(g => (st[g.no] || {}).pick).length;
    const total = exam.gaps.length;
    const pct = total > 0 ? Math.round((answered / total) * 100) : 0;
    if (answered === 0) { el.textContent = '未作答'; return; }
    el.innerHTML = '<span class="cz-progress-text">' + answered + '/' + total + ' 已作答</span>' +
      '<span class="cz-progress-bar"><span class="cz-progress-fill" style="width:' + pct + '%"></span></span>' +
      (exam.done ? '<span class="cz-progress-tag">已交卷</span>' : '');
  }

  function wire() {
    const list = document.getElementById('q-list');
    list.querySelectorAll('.cz-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        if (exam.done) return;
        const no = parseInt(btn.dataset.q), w = btn.dataset.w;
        const key = exam.winStart;
        if (!state[key]) state[key] = {};
        state[key][no] = Object.assign({}, state[key][no], { pick: w });
        saveLS(); render();
      });
    });
    list.querySelectorAll('[data-gap]').forEach(sp => {
      sp.addEventListener('click', () => {
        state.cur = parseInt(sp.dataset.gap); saveLS();
        document.querySelectorAll('.cz-qrow').forEach(r => r.classList.remove('current'));
        const row = document.querySelector('.cz-qrow[data-qrow="' + state.cur + '"]');
        if (row) { row.classList.add('current'); row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      });
    });
    document.getElementById('cz-submit')?.addEventListener('click', () => {
      if (exam.done) return; // 已交卷；重做请走「重做本段」
      exam.done = true;
      const st = state[exam.winStart] || {};
      const right = exam.gaps.filter(g => (st[g.no] || {}).pick === lower(g.answer)).length;
      exam.doneRight = right;
      state.examDone = { win: exam.winStart, right: right };
      saveLS(); render();
      // 错题字典 + 成绩历史（接 exam.js）
      try {
        const wrongs = JSON.parse(localStorage.getItem('wsj_cloze:wrongs') || '[]');
        const CZ_CAUSES = [['SYNONYM', '近义辨析'], ['COLLOCATION', '固定搭配'], ['CONNECTOR', '逻辑连接'], ['MINE', '生词'], ['POS', '词性'], ['CONTEXT', '语境词']];
        const tagToCause = Object.fromEntries(CZ_CAUSES);
        exam.gaps.forEach(g => {
          const pick = (st[g.no] || {}).pick;
          if (pick && pick !== lower(g.answer)) {
            const key = slug + '#' + exam.winStart + '#' + g.no;
            const data = {
              key, slug, mode: 'cloze', kind: g.kind,
              no: g.no, myAnswer: pick, answer: g.answer,
              // T11: 错题本就地重做所需题面（选项组 + 该空解析）
              opts: g.opts, expl: g.expl || '',
              cause: tagToCause[g.kind] || '语境词',
              at: new Date().toISOString()
            };
            const existing = wrongs.find(r => r.key === key);
            if (existing) Object.assign(existing, data); else wrongs.push(data);
          }
        });
        localStorage.setItem('wsj_cloze:wrongs', JSON.stringify(wrongs));
        // 成绩历史
        const history = JSON.parse(localStorage.getItem('wsj_exam:history') || '[]');
        history.push({
          slug, mode: 'cloze', subType: 'cloze',
          correct: right, total: exam.gaps.length,
          at: new Date().toISOString()
        });
        localStorage.setItem('wsj_exam:history', JSON.stringify(history.slice(-50)));
      } catch (e) { /* 静默失败 */ }
      // 交卷后把分数卡滚入视野（原来滚到文章段落会把分数推出屏幕顶部）
      const scoreEl = document.querySelector('.cz-score');
      if (scoreEl) scoreEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.getElementById('cz-rebuild')?.addEventListener('click', () => {
      const seed = (state.seed || 0) + 1;
      state.seed = seed; state[exam.winStart] = {}; state.examDone = null; exam.done = false; saveLS();
      exam = buildExam(selectWindow(seed), seed); render();
    });
    document.getElementById('cz-redo')?.addEventListener('click', () => {
      state[exam.winStart] = {}; state.examDone = null; exam.done = false; saveLS(); render();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    bind('theme-btn', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const order = ['green', 'dark', 'blue-gold', 'light'];
      const next = order[(order.indexOf(cur || 'green') + 1) % order.length];
      try { localStorage.setItem('wsj_exam:theme', next); } catch (e) {}
      if (next === 'dark' || next === 'green' || next === 'blue-gold') document.documentElement.setAttribute('data-theme', next);
      else document.documentElement.removeAttribute('data-theme');
    });
    const seed = state.seed || 0;
    const win = selectWindow(seed);
    if (win) {
      exam = buildExam(win, seed);
      if (state.examDone && state.examDone.win === exam.winStart) {
        exam.done = true; // 交卷状态持久化：刷新后仍可查看判分
        exam.doneRight = state.examDone.right;
      }
    }
    render();
    const meta = document.getElementById('exam-meta');
    if (meta && window.__EXAM_META__) meta.textContent = window.__EXAM_META__;
  });
})();
