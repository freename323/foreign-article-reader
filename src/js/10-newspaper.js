  // ===== 报纸阅读页（两份相互独立的报纸：英文版 / 中文版）=====
  // 设计目标：阅读模式 = 电子报。**英文版与中文版是两份各自完整的报纸**（各有自己的报头、
  // 主标题、速览、页码），互不混排；报眉上的语言切换（EN / 中文）在两份报纸之间跳转。
  //
  // 关键架构决策（改动务必先读）：
  // 1) **搬真实元素，不复制内容**。段落 <p>、blockquote、插画 SVG 都是从原列里「搬」进版面的，
  //    所以标注 <mark>、词频着色 <span>、可编辑译文的 contenteditable、浮动批注菜单**全部照常工作**。
  // 2) **每版正文容器都带 `col-body en` / `col-body cn` 类**，于是
  //    `querySelectorAll('.col-body.en p[data-para-idx]')` 这类既有选择器跨版依然能找齐所有段落，
  //    只有 4 处「用 querySelector 取首个 .col-body」的滚动相关代码需要适配（进度条 / 阅读位置 /
  //    列高同步 / 两列滚动同步），它们已改为「报纸模式下走页码」。
  // 3) **原列在报纸模式下清空并摘掉 col-body 类**，退出时按原顺序还原 —— 保证任一时刻
  //    `.col-body.en` 只对应一套真实段落，不会出现「同一个段落有两个容器」的歧义。
  // 4) 两条流各自分版：英文流 → 英文版第 1..N 版；中文流 → 中文版第 1..M 版，
  //    版序连续放在同一条轨道上。**翻版被限制在当前语言那一本里**（见 paperGoto 的钳制），
  //    所以「下一版」永远不会翻进另一份报纸 —— 语言只由报眉的 EN / 中文 切换。
  const PAPER_VIEW = 'paper';
  // 「我习惯怎么读」是全局偏好，不该按篇记
  const PAPER_VIEW_KEY = 'wsj_reader:view';
  // 当前在看哪一份报纸（'en' | 'cn'）。同样是全局偏好，换文章照样生效。
  const PAPER_LANG_KEY = 'wsj_reader:paperLang';
  const PAPER_LANGS = ['en', 'cn'];
  let paperPages = [];
  let paperIndex = 0;
  let paperRestore = null;      // 退出时还原用的原容器 / 原始子节点顺序
  let paperResizeTimer = null;

  function paperViewPref() {
    try {
      const v = localStorage.getItem(PAPER_VIEW_KEY);
      if (v === PAPER_VIEW || v === 'reader') return v;
    } catch (e) {}
    return settings.view === PAPER_VIEW ? PAPER_VIEW : 'reader';
  }
  function paperSetView(v) {
    try { localStorage.setItem(PAPER_VIEW_KEY, v); } catch (e) {}
    settings.view = v; saveSettings();
  }
  function paperModeOn() { return paperViewPref() === PAPER_VIEW; }
  function paperPageIndex() { return paperIndex; }
  function paperPageCount() { return paperPages.length; }

  // ---------- 语言（两份相互独立的报纸）----------
  function paperLangGet() {
    try {
      const v = localStorage.getItem(PAPER_LANG_KEY);
      if (PAPER_LANGS.indexOf(v) >= 0) return v;
    } catch (e) {}
    return 'en';
  }
  function paperSetLangPref(v) { try { localStorage.setItem(PAPER_LANG_KEY, v); } catch (e) {} }
  // 某个语言对应的版序区间（0 基，含两端）。「中文版」从英文版的末版之后开始。
  // 版面尚未构建 / 该语言没有内容时返回 null。
  function paperLangRange(lang) {
    const cap = paperRestore;
    const enN = (cap && cap.enPages) || 0;
    const cnN = (cap && cap.cnPages) || 0;
    if (lang === 'cn') return cnN ? { from: enN, to: enN + cnN - 1 } : null;
    return enN ? { from: 0, to: enN - 1 } : null;
  }
  function paperLangOf(index) {
    const r = paperLangRange('en');
    return r && index <= r.to ? 'en' : 'cn';
  }

  // ---------- 报头文案 ----------
  // ⚠ 各篇文章的 `.title-block .meta` 写法**并不统一**（有的把日期塞在同一条里、
  //   有的根本没写日期、中文来源有的有有的没有），所以这里做两层取值：
  //     ① 从 meta 的分段里找「带四位年份」的那一段当日期
  //     ② 找不到就回落到**文件名里的 ISO 日期** —— <来源>_YYYY-MM-DD_<slug>_..._EN-CN_final.html
  //   实测 9 篇里有 1 篇 meta 完全没有日期（Science 那篇），只靠 meta 会静默退化成「今天」。
  function paperIsoDate() {
    const m = /((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})/.exec(String(articleId || ''));
    return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
  }
  function paperSource() {
    const el = document.querySelector('.title-block .meta');
    const parts = (el ? el.textContent : '').split('·').map(s => s.trim()).filter(Boolean).map(s => s.replace(/\s+/g, ' '));
    let date = '', cnSource = '';
    parts.forEach(p => {
      if (!date && /(?:19|20)\d{2}/.test(p)) date = p;
      // 中文来源：短、且不是日期/句子（"星期日泰晤士报" 是来源；"谄媚式 AI 扭曲社会……" 是标题）
      if (!cnSource && /[\u4e00-\u9fa5]/.test(p) && !/[年月日]/.test(p) &&
          p.length <= 12 && !/[，。；]/.test(p)) cnSource = p;
    });
    const source = parts[0] || '';
    return { source: source, date: date, iso: paperIsoDate(), cnSource: cnSource || source };
  }
  // 中文刊名（中文版报纸的报头）
  function paperName() {
    const names = {
      ai_cost: 'AI 资本观察', ai_regulation: '监管经济评论', ammo_shortage: '国防供应链',
      fcc_sports: '传媒与体育', haldane: '监管与增长', horvitz: '科学前沿',
      moral_econ: '社会心理研究', pensions: '家庭财经', pothole: '消费者权益'
    };
    return names[articleMeta.slug] || '外刊精读日报';
  }
  // 英文刊名（英文版报纸的报头）—— 英文版与中文版是两份相互独立的报纸，刊名各自成体系
  function paperNameEn() {
    const names = {
      ai_cost: 'AI Capital Watch', ai_regulation: 'Regulation & Markets', ammo_shortage: 'Defense Supply',
      fcc_sports: 'Media & Sports', haldane: 'Growth & Regulation', horvitz: 'Science Frontier',
      moral_econ: 'Mind & Society', pensions: 'Family Finance', pothole: 'Consumer Watch'
    };
    return names[articleMeta.slug] || 'Foreign Press Weekly';
  }
  function paperTitle() {
    const el = document.querySelector('.title-block h1:not(.cn)');
    return el ? el.textContent.trim() : (document.title || '');
  }
  function paperCnTitle() {
    const el = document.querySelector('.title-block h1.cn');
    return el ? el.textContent.trim() : '';
  }
  function paperAuthor() {
    const el = document.querySelector('.title-block .author:not(.cn)');
    return el ? el.textContent.trim() : '';
  }
  function paperCnAuthor() {
    const el = document.querySelector('.title-block .author.cn');
    return el ? el.textContent.trim() : '';
  }
  // 英文日期 / 中文日期各一份，都从同一个 Date 对象派生（保证两份报纸说的是同一天）
  const PAPER_EN_MON = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  function paperDateObj() {
    const { date, iso } = paperSource();
    let d = null;
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(date || ''));
    if (m) d = new Date(+m[1], +m[2] - 1, +m[3]);
    else if (date) { const t = Date.parse(date); if (!isNaN(t)) d = new Date(t); }
    if ((!d || isNaN(d.getTime())) && iso) d = new Date(iso.y, iso.mo - 1, iso.d);
    if (!d || isNaN(d.getTime())) d = new Date();
    return d;
  }
  function paperDateEn() {
    const d = paperDateObj();
    return PAPER_EN_MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  // ---------- 报纸版字号 ----------
  // ⚠ CSS 里**不能**声明 --np-font：一旦给 body 或 .paper-root 声明了，就会在子树里
  //   盖掉 <html> 上的内联值，A+/A− 点了没反应。所以字号只由这里写到 documentElement。
  function paperFontPx() {
    const base = settings.paperFont || 16.5;
    // 小屏收一点，一行能多放几个词；用户仍可用 A+/A− 覆盖
    return window.innerWidth <= 900 ? Math.round(base * 0.92 * 10) / 10 : base;
  }
  function paperApplyFont() {
    document.documentElement.style.setProperty('--np-font', paperFontPx() + 'px');
  }

  // ---------- 分栏数 ----------
  // 每版一张纸、页内多栏。默认：≥760px 双栏（报纸的常规栏宽），窄屏单栏。
  // 报眉的「栏」按钮可以在 1 / 2 / 3 栏之间切，选择全局记住 —— 三类宽度都合规矩，
  // 到底几栏读着舒服是眼睛的事，所以做成可切而不是写死。
  const PAPER_COL_GAP = 40;
  const PAPER_COLS_KEY = 'wsj_reader:paperCols';
  function paperColsPref() {
    let v = 0;
    try { v = parseInt(localStorage.getItem(PAPER_COLS_KEY) || '0', 10) || 0; } catch (e) {}
    if (v === 1 || v === 2 || v === 3) return v;
    return window.innerWidth >= 760 ? 2 : 1;
  }
  function paperLayoutMetrics() {
    return { cols: paperColsPref() };
  }

  // ---------- 版面骨架 ----------
  // 栏头做成和三栏视图一致的「标签 + 名称」样式，一眼看清是哪一页
  function paperRunhead(tag, name, title, pageNo) {
    return '<header class="np-runhead">' +
      '<span class="np-tag np-tag-' + tag.toLowerCase() + '">' + esc(tag) + '</span>' +
      '<span class="np-run-name">' + esc(name) + '</span>' +
      '<span class="np-run-title">' + esc(title) + '</span>' +
      '<span class="np-run-page">第 ' + pageNo + ' 版</span></header>';
  }
  // 页脚也是「一本书一份」：英文版用英文刊名与原文来源，中文版用中文刊名与中文来源
  function paperLeafFoot(kind, pageNo, total) {
    const { source, cnSource } = paperSource();
    const en = kind === 'en';
    const left = en ? (source || paperNameEn()) : (cnSource || paperName());
    const mid = en
      ? '— Page ' + pageNo + (total ? ' of ' + total : '') + ' —'
      : '— 第 ' + pageNo + (total ? ' / ' + total : '') + ' 版 —';
    const right = en ? 'ORIGINAL EDITION' : '中文版 · 译文原载于本刊英文版';
    return '<footer class="np-foot"><span>' + esc(left) + '</span>' +
      '<span class="np-pageno">' + esc(mid) + '</span>' +
      '<span>' + esc(right) + '</span></footer>';
  }

  // 「本篇速览 / AT A GLANCE」——按语言各成一份（英文版数词数，中文版数字数）
  // ⚠ 必须从捕获到的原始子节点里数，不能再去查 `.main-wrap .col-body.en`：
  //   报纸模式已经把原列改名成 np-source 且清空了，查选择器只会得到 0。
  function paperQuickFacts(cap) {
    let words = 0, paras = 0, chars = 0;
    (cap && cap.enKids || []).forEach(k => {
      if (!k.dataset || !k.dataset.paraIdx) return;
      const mm = k.textContent.match(/[A-Za-z][A-Za-z'\-]*/g);
      if (mm) words += mm.length;
    });
    (cap && cap.cnKids || []).forEach(k => {
      if (!k.dataset || !k.dataset.paraIdx) return;
      paras++;
      chars += k.textContent.replace(/\s/g, '').length;
    });
    const vocab = annotations.filter(a => a && a.bucket === 'vocab' && a.text).length;
    return {
      words: words, chars: chars, paras: paras, vocab: vocab,
      minutesEn: Math.max(1, Math.round(words / 180)),
      minutesCn: Math.max(1, Math.round(chars / 300))
    };
  }
  function paperFactsHTML(f, lang) {
    if (lang === 'cn') {
      return '<aside class="np-facts">' +
        '<div class="np-facts-h">本篇速览</div>' +
        '<div class="np-facts-grid">' +
        '<div><b>' + f.chars + '</b><span>字</span></div>' +
        '<div><b>' + f.paras + '</b><span>段</span></div>' +
        '<div><b>' + f.vocab + '</b><span>你的生词</span></div>' +
        '<div><b>' + f.minutesCn + '</b><span>分钟</span></div>' +
        '</div></aside>';
    }
    return '<aside class="np-facts">' +
      '<div class="np-facts-h">AT A GLANCE</div>' +
      '<div class="np-facts-grid">' +
      '<div><b>' + f.words + '</b><span>words</span></div>' +
      '<div><b>' + f.paras + '</b><span>paragraphs</span></div>' +
      '<div><b>' + f.vocab + '</b><span>your vocab</span></div>' +
      '<div><b>' + f.minutesEn + '</b><span>min read</span></div>' +
      '</div></aside>';
  }

  // 「精读提示」框——挂在英文正文末尾，像报纸的「语言点」小栏目
  function paperDigestHTML() {
    const points = [];
    document.querySelectorAll('.thesis-block ol > li').forEach(li => {
      const t = li.textContent.trim();
      if (t) points.push(t);
    });
    const vocab = annotations.filter(a => a && a.bucket === 'vocab' && a.text).slice(0, 14);
    if (!points.length && !vocab.length) return '';
    let h = '<div class="np-digest"><div class="np-digest-h">精读提示</div>';
    if (points.length) {
      h += '<div class="np-digest-sec"><span class="np-digest-t">本篇要点</span><ol>' +
        points.map(p => '<li>' + esc(p) + '</li>').join('') + '</ol></div>';
    }
    if (vocab.length) {
      h += '<div class="np-digest-sec"><span class="np-digest-t">重点表达</span><ul>' +
        vocab.map(v => '<li><b>' + esc(v.text) + '</b><i>' + esc((v.definition || v.note || '').trim() || '—') + '</i></li>').join('') +
        '</ul></div>';
    }
    return h + '</div>';
  }

  // 每种语言的「第 1 版」都是一张完整报纸的头版（独立报头 + 主标题 + 题图 + 速览），
  // 后续版只出内页眉 —— 这正是「英文版 / 中文版两份相互独立的报纸」的落点。
  function paperHeadFor(kind, pageNo, total, artHtml, facts, isFirst) {
    if (isFirst) {
      const { source, cnSource } = paperSource();
      const en = kind === 'en';
      const name = en ? paperNameEn() : paperName();
      const src = en ? (source || 'FOREIGN PRESS') : (cnSource || source || '星期日泰晤士报');
      const date = en ? paperDateEn() : paperDateText();
      const title = en ? paperTitle() : (paperCnTitle() || paperTitle());
      const sub = en ? (paperCnTitle() || '') : (paperCnTitle() ? paperTitle() : '');
      const by = en ? paperAuthor() : (paperCnAuthor() || paperAuthor());
      const tag = en ? 'FOREIGN PRESS · BILINGUAL READER' : '外刊精读 · 双语对照';
      return '<header class="np-masthead">' +
        '<div class="np-m-top"><span>' + esc(src) + '</span>' +
        '<span>' + esc(date) + '</span>' +
        '<span>' + (total ? (en ? total + ' pages' : '共 ' + total + ' 版') : '') + '</span></div>' +
        '<h1 class="np-m-name">' + esc(name) + '</h1>' +
        '<div class="np-m-rule"><span>' + esc(tag) + '</span><span>' + esc(by || (en ? 'READING EDITION' : '精读版')) + '</span></div>' +
        '</header>' +
        '<div class="np-lead' + (artHtml ? ' has-art' : '') + '">' +
        '<div class="np-lead-text">' +
        '<h2 class="np-headline">' + esc(title) + '</h2>' +
        (sub ? '<div class="np-subhead">' + esc(sub) + '</div>' : '') +
        (by ? '<div class="np-byline">' + esc(by) + '</div>' : '') +
        '</div>' +
        (artHtml ? '<figure class="np-fig">' + artHtml + '</figure>' : '') +
        '</div>' +
        (facts ? paperFactsHTML(facts, kind) : '');
    }
    // 内页眉也按「哪一份报纸」着色：EN 徽标配英文刊名，CN 徽标配中文版刊名
    return kind === 'cn'
      ? paperRunhead('CN', '中文版 · ' + paperName(), (paperCnTitle() || paperTitle()).slice(0, 40), pageNo)
      : paperRunhead('EN', paperNameEn(), paperTitle().slice(0, 40), pageNo);
  }
  // 每版就是一张纸。英文版的第 1 版与中文版的第 1 版都出完整头版
  // （各自的报头 / 主标题 / 题图 / 速览），因为它们是**两份独立的报纸**。
  function paperMakePage(pageNo, total, m, kind, artHtml, facts, isFirst) {
    const page = document.createElement('section');
    page.className = 'np-page np-page-' + kind + (isFirst ? ' is-first' : '');
    page.dataset.page = String(pageNo);
    page.dataset.lang = kind;
    const leaf = document.createElement('article');
    leaf.className = 'np-leaf np-leaf-' + kind;
    leaf.innerHTML = paperHeadFor(kind, pageNo, total, artHtml, facts, isFirst) +
      '<div class="np-body col-body ' + (kind === 'cn' ? 'cn' : 'en') + '"></div>' +
      paperLeafFoot(kind, pageNo, total);
    page.appendChild(leaf);
    return page;
  }

  // ---------- 构建 / 分版 ----------
  function paperEn() {
    return document.querySelector('.main-wrap .col-body.en') ||
      document.querySelector('.main-wrap .col-body');
  }
  function paperCn() {
    return document.querySelector('.main-wrap .col-body.cn');
  }

  function paperCapture() {
    const en = paperEn();
    const cn = paperCn();
    if (!en || !cn) return null;
    const artHost = document.querySelector('.art-block');
    return {
      en: en, cn: cn,
      enKids: Array.prototype.slice.call(en.children),
      cnKids: Array.prototype.slice.call(cn.children),
      artHost: artHost,
      artSvg: artHost ? artHost.querySelector('svg') : null,
      // 原列的类名要在退出时精确还原
      enClass: en.className, cnClass: cn.className
    };
  }

  // 把一条正文流分版到多张纸上；返回用掉的最后一个版号。
  //
  // 分版方式：**先塞满、再按真实溢出回退**（实测，不估算）。
  //   ① 把剩余块全部 append 进本版正文容器；
  //   ② 多栏容器一旦装不下，浏览器会排到第 3 栏（版面外的隐式栏），此时 scrollWidth > clientWidth；
  //   ③ 从末尾逐个移除，直到不再溢出 —— 此刻的容量就是「刚好装满」。
  //
  // 为什么不能用「逐块累加高度、超了就 break」的估算法：
  //   那个算法假设「块不可断开」，可 CSS 是允许 <p> 跨栏断开的（报纸正是这么排的）。
  //   两者一矛盾就会严重低估容量 —— 实测每版只装到 86%，还会把「精读提示」单独挤成一版，
  //   上一版底部留下大片空白。
  // ⚠ 必须显式强制一次重排再读 scrollWidth。
  //   removeChild 之后直接读 scrollWidth 会拿到**上一次布局的缓存值**（仍是「溢出」），
  //   结果回退循环会一路删到只剩一个块 —— 表现出来就是每版只装 1~3 段、底部大片空白。
  function paperOverflowed(body) {
    void body.offsetWidth;
    if (body.scrollWidth <= body.clientWidth + 1) return false;
    void body.offsetWidth;                                   // 复核一次，避免缓存
    return body.scrollWidth > body.clientWidth + 1;
  }
  function paperPackFlow(track, flow, kind, m, startPage, artHtml, facts) {
    const MAX_PAGES = 80;
    const firstPage = startPage + 1;
    let i = 0, pageNo = startPage;
    do {
      pageNo++;
      const isFirst = pageNo === firstPage;   // 每种语言的第 1 版都出完整头版
      const localNo = pageNo - startPage;     // 版号是「这一份报纸内部」的编号，从 1 起
      const page = paperMakePage(localNo, 0, m, kind,
        isFirst ? artHtml : '', isFirst ? facts : null, isFirst);
      track.appendChild(page);
      const body = page.querySelector('.np-body');
      // 每版的正文容器显式设为多栏：JS 与 CSS 必须一致，否则溢出判定不成立
      body.style.columnCount = String(m.cols);
      body.style.columnGap = PAPER_COL_GAP + 'px';

      // ① 剩余块全部放进本版（搬真实元素，保留 <mark> 标注 / 词频 <span> / contenteditable）
      const from = i;
      while (i < flow.length) {
        const b = flow[i];
        if (b.el) {
          if (b.quote) b.el.classList.add('np-quote');
          body.appendChild(b.el);
        } else {
          body.insertAdjacentHTML('beforeend', b.html);
        }
        i++;
      }
      // ③ 逐个回退到刚好不溢出；至少留一个块，避免「单块超高」把整版清空导致死循环
      let guard = 0;
      while (body.children.length > 1 && paperOverflowed(body) && guard++ < 400) {
        body.removeChild(body.lastElementChild);
        i--;
      }
      if (i === from) i = from + 1;   // 兜底：本版什么都装不下也至少推进一格
    } while (i < flow.length && pageNo < MAX_PAGES);
    return pageNo;
  }

  function paperBuild() {
    const root = document.getElementById('paper-root');
    if (!root) return;
    if (!paperRestore) paperRestore = paperCapture();
    const cap = paperRestore;
    if (!cap) { showTopToast('未找到正文列，无法生成报纸版'); return; }
    paperBuilding = true;

    // ⚠⚠ 必须先把「跨列等高」留下的 inline min-height 清掉再分版。
    //   三栏视图的 doHeightSync 会让 EN/CN 同一段等高，做法是给每个段落写 inline min-height
    //   （实测最长到 633px）。它在页面载入时先于报纸版跑过一次，那些 min-height 就留在段落上；
    //   报纸分版是按真实高度算的，段落被撑大后 →
    //     ① 每段占一大块、段号之间隔着一大片空白（用户看到的「中间空着大部分」）
    //     ② 每版装不下几段，版数近乎翻倍（实测 6 版 → 9 版）
    //   这里直接按捕获到的原始子节点清，不依赖类名（此刻原列已改名为 .np-source，
    //   按 `.col-body p` 查是查不到的）。
    cap.enKids.concat(cap.cnKids).forEach(k => {
      if (k.style) k.style.minHeight = '';
    });

    const track = root.querySelector('#np-track');
    const m = paperLayoutMetrics();
    const artHtml = cap.artSvg ? cap.artSvg.outerHTML : '';

    // 清场：把上一版的段落原地收回，再重排（避免元素被搬来搬去丢失事件绑定）
    Array.prototype.slice.call(track.querySelectorAll('.np-page')).forEach(p => p.remove());
    cap.enKids.forEach(k => cap.en.appendChild(k));
    cap.cnKids.forEach(k => cap.cn.appendChild(k));

    // 两条流**各自独立成流**：英文版只取英文列的子节点，中文版只取中文列的子节点。
    // ⚠ 这里刻意**不做「逐段配对」**：中文段落不必与英文一一对应（译文可以合并或拆分段落），
    //   一旦按 data-para-idx 配对，中文列里那些「找不到对应英文段」的段落会被静默丢掉 ——
    //   而中文版是一份独立的报纸，它的段落完整性只取决于它自己的内容。
    //   两条流用的都是**真实元素**（不复制），所以标注 / 词频 / 译文编辑照常工作。
    const buildFlow = (kids) => {
      const flow = [];
      kids.forEach(k => {
        if (k.tagName === 'BLOCKQUOTE') flow.push({ el: k, quote: true });
        else if (k.dataset && k.dataset.paraIdx) flow.push({ el: k });
      });
      return flow;
    };
    const flowEn = buildFlow(cap.enKids);
    const flowCn = buildFlow(cap.cnKids);
    // 「精读提示」框是报纸背面的「语言点」小栏目。
    // ⚠ 挂在**译文流末尾**而不是英文流末尾：中文段落比英文短，最后一版通常有余量，
    //   挂这里既填满末版留白，又不会像挂在英文流时那样被挤成「单独占一整版、四周空白」。
    //   本篇不看译文时才退回英文流末尾。
    // ⚠ 中文版**始终构建**（只要本文有译文）：英文版与中文版是两份相互独立的报纸，
    //   语言切换不应该依赖「显示中文」那个三栏视图的开关。
    const hasCnFlow = flowCn.length > 0;
    const digest = paperDigestHTML();
    if (digest) (hasCnFlow ? flowCn : flowEn).push({ html: digest });

    const facts = paperQuickFacts(cap);
    cap.enPages = paperPackFlow(track, flowEn, 'en', m, 0, artHtml, facts);
    cap.cnPages = hasCnFlow
      ? paperPackFlow(track, flowCn, 'cn', m, cap.enPages, artHtml, facts) - cap.enPages
      : 0;

    paperPages = Array.prototype.slice.call(track.querySelectorAll('.np-page'));
    cap.pagesTotal = paperPages.length;
    // 版号是**每份报纸内部**的编号：英文版 Page 1..N、中文版第 1..M 版，
    // 两份各自从「第 1 版」重新起算 —— 它们本来就是两份独立的报纸。
    paperPages.forEach((p, k) => {
      const isCn = k >= cap.enPages;
      const local = isCn ? k - cap.enPages + 1 : k + 1;
      const totalInEd = isCn ? cap.cnPages : cap.enPages;
      // **每一本的最后一版改成平衡分栏**：末版内容常常只占 1 栏多一点，
      // 用 column-fill:auto 会「第一栏满、第二栏几乎空」，看着像漏排。
      // 平衡后两栏等高，读者看到的是「这一版就这么多」，而不是「缺了一块」。
      // 安全性：末版的内容总量必然 ≤ 栏数（否则分版时就溢出了），
      // 所以平衡后每栏都不会超过 100%，不会引入溢出。
      if (local === totalInEd) {
        const body = p.querySelector('.np-body');
        if (body) body.style.columnFill = 'balance';
      }
      const s = p.querySelectorAll('.np-m-top span');
      if (s[2]) s[2].textContent = isCn ? ('共 ' + totalInEd + ' 版') : (totalInEd + ' pages');
      p.querySelectorAll('.np-run-page').forEach(el => { el.textContent = '第 ' + local + ' 版'; });
      p.querySelectorAll('.np-pageno').forEach(el => {
        el.textContent = isCn
          ? ('— 第 ' + local + ' / ' + totalInEd + ' 版 —')
          : ('— Page ' + local + ' of ' + totalInEd + ' —');
      });
    });
    paperBuilding = false;
    // 当前语言那一本可能不存在（本文没有译文 → 中文版没建）→ 回落到英文版
    if (!paperLangRange(paperLangGet())) paperSetLangPref('en');
    paperApplyLayout(false);
    paperApplyLang();
    // 建版 / 重排后的落位不算「翻版」，不要放动画
    paperGoto(Math.min(paperIndex, paperPages.length - 1), { silent: true });
  }

  // ---------- 建立 / 关闭 ----------
  // 报纸的「出版信息」：日期做成报头 dateline 的读法（2026 年 6 月 14 日  星期日）
  function paperDateText() {
    const d = paperDateObj();
    return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日  星期' +
      '日一二三四五六'[d.getDay()];
  }

  /* 报眉分两行，都是报纸上真实存在的东西：
     ① 报名栏 .np-mastbar —— 刊名 + 出版信息（日期 / 时刻 / 阅读计时）
     ② 栏目索引栏 .np-indexbar —— 四个下拉（视图·考试·数据·工具）+ 翻版 + 工具按钮
     底栏 (.toolbar) 在报纸模式下整条不再显示；其中真正有用的部分由
     paperAdoptControls() 在运行时搬进这里（DOM 与事件监听原样保留）。 */
  function paperTopbarHTML() {
    return '<div class="np-topbar">' +
      '<div class="np-mastbar">' +
      // 刊名 / 来源 / 出版日期 / 版次 都按「当前这一份报纸」填，见 paperApplyLang
      '<div class="np-brand"><span class="np-brand-name" id="np-brand-name"></span>' +
      '<span class="np-brand-sub" id="np-brand-sub"></span></div>' +
      '<div class="np-dateline">' +
      '<span class="np-dl-ed" id="np-dl-ed"></span>' +
      '<span class="np-dl-date" id="np-dl-date"></span>' +
      '<span class="np-timehost" id="np-timehost"></span>' +
      '</div>' +
      '</div>' +
      '<div class="np-indexbar">' +
      '<div class="np-menus" id="np-menus"></div>' +
      // 语言切换：英文版 / 中文版 是两份相互独立的报纸，这里是唯一的入口
      '<div class="np-langseg" role="group" aria-label="语言切换 / Language">' +
      '<button type="button" class="np-lang-btn" id="np-lang-en" aria-pressed="true" title="English edition">EN</button>' +
      '<button type="button" class="np-lang-btn" id="np-lang-cn" aria-pressed="false" title="中文版">中文</button>' +
      '</div>' +
      '<div class="np-flip">' +
      '<button type="button" class="np-btn" id="np-prev" title="上一版（←）">‹ 上一版</button>' +
      '<span class="np-pos" id="np-pos">1 / 1</span>' +
      '<button type="button" class="np-btn" id="np-next" title="下一版（→）">下一版 ›</button>' +
      '</div>' +
      '<div class="np-tools">' +
      (articleMeta.hasExam
        ? '<button type="button" class="np-btn np-exam" id="np-exam" title="考试模式：阅读理解 / 完形填空 / 新题型 / 翻译练习 / 写作">🎓 考试</button>'
        : '') +
      '<button type="button" class="np-btn" id="np-sum" title="展开/收起导读摘要">导读</button>' +
      '<button type="button" class="np-btn" id="np-notes" title="展开/收起剪报本（笔记与生词）">笔记</button>' +
      '<button type="button" class="np-btn" id="np-cols" title="切换栏数：1 / 2 / 3 栏">栏 2</button>' +
      '<button type="button" class="np-btn" id="np-sd" title="缩小字号">A−</button>' +
      '<button type="button" class="np-btn" id="np-su" title="放大字号">A+</button>' +
      '<button type="button" class="np-btn" id="np-print" title="打印成纸质报纸">打印</button>' +
      '<button type="button" class="np-btn np-exit" id="np-exit" title="切到三栏对照视图">三栏对照</button>' +
      '</div>' +
      '</div></div>';
  }

  // 把底栏里真正有用的东西搬进报眉：四个下拉菜单 → 栏目索引栏；时钟/计时 → 出版信息条。
  // 只移动节点、不动事件监听，退出时按记录的位置原样放回。
  let paperAdopted = [];
  function paperAdoptControls() {
    const host = document.getElementById('np-menus');
    const timeHost = document.getElementById('np-timehost');
    if (!host) return;
    paperAdopted = [];
    const move = (el, target) => {
      if (!el || !target || el.parentNode === target) return;
      paperAdopted.push({ el: el, parent: el.parentNode, next: el.nextSibling });
      target.appendChild(el);
    };
    document.querySelectorAll('.toolbar .menu-trigger-wrap').forEach(w => move(w, host));
    // 时钟 / 计时 → 出版信息条。
    // ⚠ 模板有两种形态：新版把三个时钟元素包在 .toolbar-clock-area 里，旧版是散着的。
    //   优先搬包装（保住它自带的布局），没有包装就逐个搬，两种都能落到出版信息条。
    const clockArea = document.querySelector('.toolbar .toolbar-clock-area');
    if (timeHost) {
      if (clockArea) move(clockArea, timeHost);
      else ['toolbar-clock', 'session-timer', 'total-timer'].forEach(id =>
        move(document.querySelector('.toolbar #' + id), timeHost));
    }
    if (!host.children.length) host.remove();
    // 底栏整条收起的开关交给 JS 置位 —— 万一搬移失败，底栏仍然可见可用（不会丢入口）
    document.body.classList.add('paper-controls-adopted');
  }
  function paperReleaseControls() {
    // 逆序放回，保证先恢复被当作 nextSibling 参照的那个节点
    for (let i = paperAdopted.length - 1; i >= 0; i--) {
      const it = paperAdopted[i];
      if (!it.parent) continue;
      if (it.next && it.next.parentNode === it.parent) it.parent.insertBefore(it.el, it.next);
      else it.parent.appendChild(it.el);
    }
    paperAdopted = [];
    document.body.classList.remove('paper-controls-adopted');
  }

  function paperEnsureRoot() {
    let root = document.getElementById('paper-root');
    if (root) return root;
    root = document.createElement('div');
    root.className = 'paper-root';
    root.id = 'paper-root';
    root.innerHTML = paperTopbarHTML() +
      '<div class="np-stage"><div class="np-track" id="np-track"></div></div>' +
      '<div class="np-hint">← → 翻版 · 点版面右/左侧翻页 · L 换语言 · Esc 切回三栏</div>';
    document.body.appendChild(root);
    paperAdoptControls();

    const rootEl = root;
    const go = d => paperGoto(paperIndex + d);
    rootEl.querySelector('#np-prev').addEventListener('click', () => go(-1));
    rootEl.querySelector('#np-next').addEventListener('click', () => go(1));
    rootEl.querySelector('#np-exit').addEventListener('click', () => togglePaper(false));
    rootEl.querySelector('#np-print').addEventListener('click', () => window.print());
    const exBtn = rootEl.querySelector('#np-exam');
    if (exBtn) exBtn.addEventListener('click', () => { if (window.openExamHub) window.openExamHub(); });
    // 语言切换：英文版 / 中文版两份独立报纸，各自从头版看起
    rootEl.querySelector('#np-lang-en').addEventListener('click', () => paperSetLang('en'));
    rootEl.querySelector('#np-lang-cn').addEventListener('click', () => paperSetLang('cn'));
    rootEl.querySelector('#np-sum').addEventListener('click', () => { paperSumOpen = !paperSumOpen; paperApplyLayout(); });
    rootEl.querySelector('#np-notes').addEventListener('click', () => {
      paperNotesOpen = !paperNotesOpen;
      // 展开时刷新一次列表（标注可能刚改过）
      if (paperNotesOpen && typeof renderNotes === 'function') renderNotes();
      paperApplyLayout();
    });
    rootEl.querySelector('#np-sd').addEventListener('click', () => paperBumpFont(-1));
    rootEl.querySelector('#np-su').addEventListener('click', () => paperBumpFont(1));
    rootEl.querySelector('#np-cols').addEventListener('click', () => paperCycleCols());
    paperApplyFont();
    // 点版面靠右/靠左处翻版（报纸随手翻页的手感）；点文字或按钮不触发
    rootEl.querySelector('.np-stage').addEventListener('click', (e) => {
      if (e.target.closest('a,button,input,label,.np-drawer,.notes-section,#float-menu,.np-vocab-box')) return;
      if (window.getSelection && String(window.getSelection()).length) return;
      if (e.target.closest('[contenteditable="true"]')) return;
      const r = e.currentTarget.getBoundingClientRect();
      if (e.clientX - r.left > r.width * 0.5) go(1); else go(-1);
    });
    return root;
  }

  function paperBumpFont(d) {
    const v = Math.max(12, Math.min(24, (settings.paperFont || 16.5) + d));
    settings.paperFont = v; saveSettings();
    paperApplyFont();
    scheduleHeightSync(true);
    paperBuild();
  }

  // 栏数：1 → 2 → 3 → 1 循环。字号的颗粒是「行」，栏数的颗粒是「一行多长」，
  // 这两件事最影响读报手感，所以都给一个一键入口而不是写死。
  function paperCycleCols() {
    const cur = paperColsPref();
    const next = cur >= 3 ? 1 : cur + 1;
    try { localStorage.setItem(PAPER_COLS_KEY, String(next)); } catch (e) {}
    updatePaperColsBtn();
    paperBuild();
    showTopToast('版面改成 ' + next + ' 栏');
  }
  function updatePaperColsBtn() {
    const b = document.getElementById('np-cols');
    if (b) b.textContent = '栏 ' + paperColsPref();
  }

  // ---------- 语言切换（英文版 ⇄ 中文版）----------
  // 两份报纸在同一条轨道上（英文版 1..N 版，中文版 1..M 版）。版面**一次全部建好**，
  // 所以切换只是「跳到另一本的第 1 版」——不重排、不刷新，只叠一次交叉淡入。
  function paperApplyLang() {
    const root = document.getElementById('paper-root');
    const lang = paperLangGet();
    const en = lang === 'en';
    if (root) root.dataset.lang = lang;
    // 报眉上的刊名 / 来源 / 日期 / 版次 也跟着换 —— 切换后看到的是一份「另一份报纸」
    const { source, cnSource } = paperSource();
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setText('np-brand-name', en ? paperNameEn() : paperName());
    setText('np-brand-sub', en ? (source || '') : (cnSource || source || ''));
    setText('np-dl-ed', en ? 'ENGLISH EDITION' : '中 文 版');
    setText('np-dl-date', en ? paperDateEn() : paperDateText());
    const set = (id, isCur, missing, title) => {
      const b = document.getElementById(id);
      if (!b) return;
      b.classList.toggle('active', isCur);
      b.setAttribute('aria-pressed', isCur ? 'true' : 'false');
      b.disabled = missing;
      b.title = title;
    };
    const hasEn = !!paperLangRange('en'), hasCn = !!paperLangRange('cn');
    set('np-lang-en', en, !hasEn, hasEn ? 'English edition' : '本篇没有英文版');
    set('np-lang-cn', !en, !hasCn, hasCn ? '中文版（本文的对应翻译版）' : '本篇没有中文版');
    updatePaperColsBtn();
  }
  let paperLangFxTimer = null;
  function paperLangFx() {
    const root = document.getElementById('paper-root');
    if (!root) return;
    root.classList.remove('np-lang-swap');
    void root.offsetWidth;
    root.classList.add('np-lang-swap');
    clearTimeout(paperLangFxTimer);
    paperLangFxTimer = setTimeout(() => root.classList.remove('np-lang-swap'), 460);
  }
  function paperSetLang(lang, opts) {
    if (PAPER_LANGS.indexOf(lang) < 0) return;
    const range = paperLangRange(lang);
    if (!range) { showTopToast(lang === 'cn' ? '本篇没有中文版' : '本篇没有英文版'); return; }
    const changed = paperLangGet() !== lang;
    paperSetLangPref(lang);
    if (changed && !(opts && opts.silent) && !paperMotionOff()) paperLangFx();
    paperGoto(range.from, { silent: true });
    paperApplyLang();
    if (changed && !(opts && opts.silent)) {
      showTopToast(lang === 'cn' ? '已切到中文版（本文的对应翻译版）' : 'Switched to the English edition');
    }
  }

  // 报纸模式下把「标题区 / 概要 / 中文 / 笔记」的显隐同步到报纸版式
  // repaginate=false 用于「正在分版中」的调用，避免互相触发成死循环
  // ⚠ 「导读」与「剪报本」两个抽屉都用独立的运行时状态（paperSumOpen / paperNotesOpen），
  //   **默认都是关闭的**、不跟 settings.showSummary / settings.showNotes 走：
  //   后两者默认 true（三栏视图默认显示概要列与笔记条），若沿用就会一进报纸版
  //   两个抽屉自己拉开、盖住半边纸面 —— 报纸阅读页一打开应该就是干干净净一张报。
  let paperBuilding = false;
  let paperSumOpen = false;
  let paperNotesOpen = false;
  function paperApplyLayout(repaginate) {
    const root = document.getElementById('paper-root');
    if (!root) return;
    // 「标题区显隐」在报纸版里控制报头 + 主标题区（否则这个开关在报纸模式下点了没反应）
    const noHead = !settings.showHeader;
    const headChanged = root.classList.contains('no-head') !== noHead;
    root.classList.toggle('no-head', noHead);
    // ⚠ 「中文」不再是一个显隐开关 —— 中文版是一份独立的报纸，由报眉的 EN / 中文 切换。
    //   过去那套 no-cn / m-en / m-cn / m-sum 的四态类已废弃（它会把另一本整个藏掉）。
    const sm = root.querySelector('#np-sum');
    if (sm) sm.classList.toggle('active', paperSumOpen);
    const col = document.querySelector('.summary-col');
    if (col) col.classList.toggle('np-open', paperSumOpen);
    const nb = root.querySelector('#np-notes');
    if (nb) nb.classList.toggle('active', paperNotesOpen);
    const ns = document.querySelector('.notes-section');
    if (ns) ns.classList.toggle('collapsed', !paperNotesOpen);
    // 标题区一收，正文可用高度就变了，必须重新分版
    if (headChanged && repaginate !== false && !paperBuilding) {
      if (typeof window.__paperRepaginate === 'function') window.__paperRepaginate();
    }
  }

  function paperEnter() {
    if (!paperRestore) paperRestore = paperCapture();
    if (!paperRestore) return;
    paperEnsureRoot();
    document.body.classList.add('paper-open');
    const cap = paperRestore;
    // 原列交给报纸接管：摘掉 col-body 类并清空，避免选择器出现两个同名容器
    cap.en.className = 'np-source';
    cap.cn.className = 'np-source';
    paperBuild();
    // 进入时若正在看某段，落到对应版
    updatePaperButtons();
  }

  function paperExit() {
    const cap = paperRestore;
    const root = document.getElementById('paper-root');
    if (cap) {
      // ① 先清掉「分版时才注入的合成块」（如精读提示框 .np-digest）——
      //    它们不是原文元素，回收时会污染原列。
      const enSet = new Set(cap.enKids), cnSet = new Set(cap.cnKids);
      if (root) {
        root.querySelectorAll('.np-body').forEach(b => {
          Array.prototype.slice.call(b.children).forEach(k => {
            if (!enSet.has(k) && !cnSet.has(k)) k.remove();
          });
        });
      }
      // ② 再按原始子节点顺序把真实元素放回去
      cap.enKids.forEach(k => cap.en.appendChild(k));
      cap.cnKids.forEach(k => cap.cn.appendChild(k));
      // ③ 清理分版时贴上的类
      cap.en.className = cap.enClass;
      cap.cn.className = cap.cnClass;
      cap.enKids.forEach(k => { if (k.classList && k.classList.contains('np-quote')) k.classList.remove('np-quote'); });
      cap.cnKids.forEach(k => { if (k.classList && k.classList.contains('np-quote')) k.classList.remove('np-quote'); });
      paperRestore = null;
    }
    // ⚠ 必须先把报眉里借来的东西（四个下拉菜单 + 时钟）搬回底栏，再删报纸层 ——
    //   否则它们会随 paper-root 一起被移除，底栏就永久丢了入口。
    paperReleaseControls();
    if (root) root.remove();
    paperPages = []; paperIndex = 0;
    document.body.classList.remove('paper-open');
    clearTimeout(paperTurnTimer);
    paperSumOpen = false;
    paperNotesOpen = false;
    document.querySelector('.summary-col')?.classList.remove('np-open');
    // 笔记条在三栏视图里由 settings.showNotes 决定，退出报纸版要还原回去
    const nsBack = document.querySelector('.notes-section');
    if (nsBack) nsBack.classList.toggle('collapsed', !settings.showNotes);
    updatePaperButtons();
    // 三栏视图恢复后需要重新对齐列高
    lastSyncedWidth = -1;
    scheduleHeightSync(true);
  }

  // 「偏好」不等于「已进入」：首屏偏好就是 paper，但版面尚未构建。
  // 用独立状态位判断，否则会把首次进入当成重复调用而直接返回。
  let paperEntered = false;
  function paperIsOpen() { return paperEntered; }

  function togglePaper(force) {
    const want = force === undefined ? !paperEntered : !!force;
    if (want === paperEntered) return;
    if (want) {
      paperEntered = true;
      paperSetView(PAPER_VIEW);
      paperEnter();
      if (!initializing) showTopToast('报纸版：← → 翻版，点版面左右翻页，Esc 切回三栏');
    } else {
      paperEntered = false;
      paperSetView('reader');
      paperExit();
      if (!initializing) showTopToast('已切到三栏对照视图');
    }
  }
  function updatePaperButtons() {
    const on = paperEntered;
    const btn = document.getElementById('paper-mode-btn');
    if (btn) btn.classList.toggle('active', on);
    const btn2 = document.getElementById('reader-mode-btn');
    if (btn2) btn2.classList.toggle('active', !on);
  }

  // ---------- 翻报动画 ----------
  // 光让轨道横向平移（translateX）看着就是「切换」而不是「翻报纸」。
  // 这里在平移之上再叠一层纸面翻掀：旧版绕右边折走、新版绕左边铺下来，
  // 配合 .np-stage 的 perspective 就有翻页的立体感。
  // ⚠ 动画类要在「强制重排」之后再加，否则连续翻版时同名动画不会重播。
  let paperTurnTimer = null;
  function paperMotionOff() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function paperTurnFx(prevIdx, nextIdx) {
    const pages = paperPages;
    pages.forEach(p => p.classList.remove('np-turn-in', 'np-turn-out'));
    if (prevIdx === nextIdx) return;
    const out = pages[prevIdx], inn = pages[nextIdx];
    if (!out && !inn) return;
    // 强制重排：让刚移除的动画类生效，下一次添加才会重新触发动画
    void (inn || out).offsetWidth;
    if (out) out.classList.add('np-turn-out');
    if (inn) inn.classList.add('np-turn-in');
    clearTimeout(paperTurnTimer);
    paperTurnTimer = setTimeout(() => {
      pages.forEach(p => p.classList.remove('np-turn-in', 'np-turn-out'));
    }, 700);
  }

  function paperGoto(n, opts) {
    if (!paperPages.length) return;
    // 翻版被限制在「当前这一份报纸」里：翻到边界就停，永远不会翻进另一份报纸。
    // 语言只能由报眉的 EN / 中文 切换 —— 这是「两份相互独立的报纸」的落点。
    const rng = paperLangRange(paperLangGet()) || { from: 0, to: paperPages.length - 1 };
    const prevIdx = paperIndex;
    paperIndex = Math.max(rng.from, Math.min(rng.to, n));
    const track = document.getElementById('np-track');
    if (track) track.style.transform = 'translateX(' + (-paperIndex * 100) + '%)';
    paperPages.forEach((p, k) => p.classList.toggle('is-current', k === paperIndex));
    const pos = document.getElementById('np-pos');
    // 页码是「这一份报纸内部」的页序，不是整条轨道的序号
    if (pos) pos.textContent = (paperIndex - rng.from + 1) + ' / ' + (rng.to - rng.from + 1);
    const prev = document.getElementById('np-prev'), next = document.getElementById('np-next');
    if (prev) prev.disabled = paperIndex === rng.from;
    if (next) next.disabled = paperIndex === rng.to;
    // 首次建版 / 字号重排 / 显式要求时不要动画（否则一进报纸版就凭空翻一下）
    if (!(opts && opts.silent) && !paperMotionOff()) paperTurnFx(prevIdx, paperIndex);
    updateProgressBar();
  }
  function paperNext() { paperGoto(paperIndex + 1); }
  function paperPrev() { paperGoto(paperIndex - 1); }
  // 当前版第一段的 para-idx（阅读位置记录用）。中文版同理 —— 两本都用 .np-body 里的真实段落。
  function paperCurrentParaIdx() {
    const p = paperPages[paperIndex];
    if (!p) return null;
    const first = p.querySelector('.np-body p[data-para-idx]');
    return first ? parseInt(first.dataset.paraIdx, 10) : null;
  }
  // 跳到含某段的版。先在本语言那一本里找（阅读位置是跟着当前那份报纸记的），
  // 找不到再全局兜底（例如该段只存在于另一本）。
  function paperGotoParaIdx(idx) {
    const sel = '.np-body p[data-para-idx="' + idx + '"]';
    const rng = paperLangRange(paperLangGet()) || { from: 0, to: paperPages.length - 1 };
    for (let i = rng.from; i <= rng.to; i++) {
      if (paperPages[i] && paperPages[i].querySelector(sel)) { paperGoto(i); return true; }
    }
    for (let i = 0; i < paperPages.length; i++) {
      if (paperPages[i].querySelector(sel)) { paperSetLang(paperLangOf(i), { silent: true }); paperGoto(i); return true; }
    }
    return false;
  }

  // ---------- 键盘 / 触屏 / 尺寸 ----------
  document.addEventListener('keydown', (e) => {
    if (!paperModeOn()) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (document.getElementById('search-panel')?.classList.contains('visible')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); paperNext(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); paperPrev(); }
    else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); paperSetLang(paperLangGet() === 'en' ? 'cn' : 'en'); }
    else if (e.key === 'Escape') { e.preventDefault(); togglePaper(false); }
  });
  (function paperSwipe() {
    let x0 = null, y0 = null;
    document.addEventListener('touchstart', (e) => {
      if (!paperModeOn() || e.touches.length !== 1) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (!paperModeOn() || x0 === null) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0, dy = t.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) { if (dx < 0) paperNext(); else paperPrev(); }
    }, { passive: true });
  })();
  window.addEventListener('resize', () => {
    if (!paperModeOn()) return;
    clearTimeout(paperResizeTimer);
    paperResizeTimer = setTimeout(() => { if (paperModeOn()) paperBuild(); }, 320);
  });

  window.togglePaper = togglePaper;
  window.paperNext = paperNext;
  window.paperPrev = paperPrev;
  window.paperModeOn = paperModeOn;
  window.paperIsOpen = paperIsOpen;
  window.paperPageIndex = paperPageIndex;
  window.paperPageCount = paperPageCount;
  window.paperCurrentParaIdx = paperCurrentParaIdx;
  window.paperGotoParaIdx = paperGotoParaIdx;
  window.paperApplyLayout = paperApplyLayout;
  window.paperSetLang = paperSetLang;
  window.paperLangGet = paperLangGet;
  window.paperCycleCols = paperCycleCols;
  window.__paperRepaginate = () => { if (paperModeOn()) paperBuild(); };
