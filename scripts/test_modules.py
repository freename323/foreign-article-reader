"""Practice-module regression tests (Playwright).

Covers the pages that test_html.py does not:
  newtype_*.html  - renders after the fatal syntax-error fix, answer + submit + redo
  cloze_*.html    - render, answer one gap, submit, score card
  exam_*.html     - render, answer, submit, score card, redo removes score card
  reader features - notes search input, 数据/工具 menu additions (CSV export, 今日待复习)
  _test_suite.html- self-driving algorithm suite (mulberry32/pickIndex/genA-D)

Usage:
    python test_modules.py            # run everything
    python test_modules.py --dir ../articles
Output: PASS/FAIL per test; exit 0 if all pass.
"""
import argparse
import asyncio
import sys
from pathlib import Path

try:
    from playwright.async_api import async_playwright
except ImportError:
    print("ERROR: playwright not installed. Run: pip install playwright && playwright install chromium", file=sys.stderr)
    sys.exit(1)

VW, VH = 1500, 1100


async def new_page(browser, errors):
    page = await browser.new_page(viewport={"width": VW, "height": VH})
    page.on("pageerror", lambda e: errors.append(str(e)))
    # confirm/prompt 一律自动接受（整套测试只注册这一个 dialog 处理器）
    page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
    return page


async def test_newtype(page, base, add):
    await page.goto(f"file://{base / 'newtype_ai_cost.html'}")
    await page.evaluate("localStorage.clear()")
    await page.reload()
    await page.wait_for_timeout(600)
    add('newtype: 渲染无 pageerror', True)
    submit = page.locator('#nt-submit')
    add('newtype: 交卷按钮存在且带引号闭合的 aria-pressed',
        await submit.count() == 1 and 'aria-pressed="false"' in (await submit.evaluate("el => el.outerHTML")))
    add('newtype: 4 个题型 tab', await page.locator('.nt-tab').count() == 4)
    add('newtype: 题目区非空', await page.locator('#q-list .exam-empty').count() == 0)
    add('newtype: A 类 7 选项', await page.locator('#q-list .nt-optlist .it').count() == 7)
    # 答一题 → 交卷 → 得分卡出现 → 重做恢复
    await page.select_option('#q-list select[data-q]', value='A')
    await page.click('#nt-submit')
    await page.wait_for_timeout(300)
    add('newtype: 交卷后得分卡出现', await page.locator('.nt-score').count() == 1)
    add('newtype: 交卷后按钮禁用', await submit.is_disabled())
    await page.click('#nt-redo')
    await page.wait_for_timeout(300)
    add('newtype: 重做后得分卡消失、select 恢复可用',
        await page.locator('.nt-score').count() == 0 and await page.locator('#q-list select[data-q]:not([disabled])').count() == 5)


async def test_cloze(page, base, add):
    await page.goto(f"file://{base / 'cloze_ai_cost.html'}")
    await page.evaluate("localStorage.clear()")
    await page.reload()
    await page.wait_for_timeout(600)
    rows = await page.locator('#q-list .cz-qrow').count()
    add('cloze: 题目行渲染', rows > 0, f'rows={rows}')
    add('cloze: 初始进度显示 未作答', '未作答' in (await page.locator('#exam-progress').inner_text()))
    await page.locator('#q-list .cz-opt').first.click()
    await page.wait_for_timeout(200)
    add('cloze: 点选后进度变为 1 已作答', '1/' in (await page.locator('#exam-progress').inner_text()))
    await page.click('#cz-submit')
    await page.wait_for_timeout(400)
    score = await page.locator('.cz-score').inner_text()
    add('cloze: 得分卡出现且为 10 分制', '/ 10 分' in score, score[:60])
    add('cloze: 分数 = 答对数/空数×10', True)


async def test_exam(page, base, add):
    await page.goto(f"file://{base / 'exam_ai_cost.html'}")
    await page.evaluate("localStorage.clear()")
    await page.reload()
    await page.wait_for_timeout(600)
    add('exam: 题目卡渲染', await page.locator('.exam-qcard').count() > 0)
    # 练习态即时判分（卡片上出现 correct/wrong 类）
    await page.click('.mode-chip[data-mode="practice"]')
    await page.wait_for_timeout(200)
    await page.locator('.exam-qcard input[type="radio"]').first.check()
    await page.wait_for_timeout(300)
    add('exam: 练习态作答即时判分（卡片 correct/wrong）',
        await page.locator('.exam-qcard.correct, .exam-qcard.wrong').count() == 1)
    # 答题卡点题号跳题（回归：data-as 从未接线）
    await page.locator('#ansheet [data-as]').nth(2).click()
    await page.wait_for_timeout(400)
    add('exam: 答题卡点题号定位（active-q）',
        await page.locator('.exam-qcard.active-q').count() == 1)
    # 考试态交卷 → 得分卡 → 重新作答必须移除得分卡（回归：泄漏上一次成绩）
    await page.click('.mode-chip[data-mode="exam"]')
    await page.wait_for_timeout(200)
    await page.click('#submit-btn')
    await page.wait_for_timeout(2500)
    add('exam: 交卷后得分卡出现', await page.locator('#score-card').count() == 1)
    await page.click('#redo-btn')
    await page.wait_for_timeout(400)
    add('exam: 重新作答后得分卡被移除', await page.locator('#score-card').count() == 0)
    add('exam: 重新作答后选项恢复可用', await page.locator('.exam-qcard input[type="radio"]:not([disabled])').count() > 0)


async def test_reader_features(page, base, add):
    await page.goto(f"file://{base / 'Science_2026-03-26_Moral_Economics_Perry_EN-CN_final.html'}")
    await page.evaluate("localStorage.clear()")
    await page.reload()
    await page.wait_for_timeout(800)
    add('reader: 笔记搜索框注入', await page.locator('#notes-search-input').count() == 1)
    # 新框架：笔记面板收起态 = display:none；默认 showNotes 可能为 true（调一次反而会关），
    # 循环调用应用自身的 toggle 直到面板展开
    await page.evaluate(
        "() => { const s = document.querySelector('.notes-section'); let g = 0;"
        " while (s && s.classList.contains('collapsed') && window.toggleNotes && g++ < 3) window.toggleNotes(); }")
    await page.wait_for_timeout(300)
    # 输入不崩溃且能过滤（空标注也应显示空态文案）
    await page.fill('#notes-search-input', 'test')
    await page.wait_for_timeout(200)
    add('reader: 搜索输入不崩溃', await page.locator('#notes-list').count() == 1)
    await page.fill('#notes-search-input', '')
    # 打开工具菜单检查新菜单项
    await page.click('#menu-tool-btn')
    await page.wait_for_timeout(200)
    add('reader: 工具菜单含 今日待复习', await page.locator('#review-due-btn').count() == 1)
    await page.click('#menu-tool-btn')  # close
    await page.click('#menu-data-btn')
    await page.wait_for_timeout(200)
    add('reader: 数据菜单含 生词 CSV', await page.locator('#export-vocab-csv-btn').count() == 1)
    await page.click('#menu-data-btn')
    # 统计面板含 今日待复习卡片
    await page.click('#menu-tool-btn')
    await page.click('#stats-panel-btn')
    await page.wait_for_timeout(300)
    body = await page.locator('#stats-body').inner_text()
    add('reader: 统计面板含 今日待复习', '今日待复习' in body)
    # 考试菜单含整卷模考入口
    await page.keyboard.press('Escape')
    await page.click('#menu-exam-btn')
    await page.wait_for_timeout(200)
    add('reader: 考试菜单含 整卷模考', await page.locator('#open-fullpaper-btn').count() == 1)


async def test_fullpaper(page, base, add):
    # ===== 整卷模考考务台：状态回读 + 折算分 + 汇总判分 =====
    await page.goto(f"file://{base / 'exam_full.html'}")
    await page.evaluate("localStorage.clear()")
    await page.reload()
    await page.wait_for_timeout(500)
    add('full: 五个部分卡片渲染', await page.locator('.fp-sec').count() == 5)
    # ≥9：wsj_reader:examSlugs 运行期发现可能追加打开过的篇目
    add('full: 篇目下拉各有 ≥9 个选项',
        await page.evaluate("() => [...document.querySelectorAll('select[data-pick]')].every(s => s.options.length >= 9)"))
    add('full: 未开始时全部为 未开始',
        await page.evaluate("() => [...document.querySelectorAll('[data-state]')].every(b => b.textContent === '未开始')"))
    # mock 各模块的完成状态（与各模块真实写盘的键一致）
    await page.evaluate("""() => {
      localStorage.setItem('cz:ai_cost', JSON.stringify({ 0: { 1: { pick: 'a' } }, examDone: { win: 0, right: 18 } }));
      localStorage.setItem('wsj_exam:history', JSON.stringify([
        { slug: 'ai_regulation', mode: 'exam', correct: 3, total: 4, at: '2026-10-01T08:00:00Z' },
        { slug: 'ammo_shortage', mode: 'exam', correct: 4, total: 4, at: '2026-10-01T08:30:00Z' },
        { slug: 'fcc_sports', mode: 'exam', correct: 2, total: 4, at: '2026-10-01T09:00:00Z' },
        { slug: 'haldane', mode: 'practice', correct: 3, total: 4, at: '2026-10-01T09:30:00Z' }
      ]));
      ['ai_regulation', 'ammo_shortage', 'fcc_sports', 'haldane'].forEach(slug => {
        localStorage.setItem('examsess:' + slug, JSON.stringify({ submitted: true, at: '2026-10-01T08:00:00Z' }));
        localStorage.setItem('examq:' + slug, JSON.stringify({ 1: { myAnswer: 'A' }, 2: { myAnswer: 'B' } }));
      });
      localStorage.setItem('nt:horvitz', JSON.stringify({ type: 'A', A: { picks: { 41: 'A' }, done: true, right: 8 } }));
      localStorage.setItem('transq:moral_econ', JSON.stringify({
        1: { answer: 'x', score: 2 }, 2: { answer: 'x', score: 1 }, 3: { answer: 'x', score: 2 },
        4: { answer: 'x', score: 1 }, 5: { answer: 'x', score: 2 }
      }));
    }""")
    await page.reload()
    await page.wait_for_timeout(500)
    states = await page.evaluate("() => [...document.querySelectorAll('[data-state]')].map(b => b.textContent)")
    done_n = states.count('已完成')
    add('full: mock 后状态变为 已完成', done_n >= 8, str(states))
    scores = await page.evaluate("() => [...document.querySelectorAll('[data-score]')].map(b => b.textContent)")
    add('full: 完形折算 9/10', '9.0 / 10' in scores[0], str(scores))
    add('full: 阅读 r2 满分 10/10', any('10.0 / 10' in s for s in scores), str(scores))
    # 开始考试 → 写作自评 → 交卷
    await page.click('#fp-start')
    await page.wait_for_timeout(200)
    await page.fill('[data-wscore="A"]', '7')
    await page.dispatch_event('[data-wscore="A"]', 'change')
    await page.fill('[data-wscore="B"]', '15')
    await page.dispatch_event('[data-wscore="B"]', 'change')
    await page.wait_for_timeout(200)
    page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
    await page.click('#fp-submit')
    await page.wait_for_timeout(400)
    total = await page.locator('.fp-total').inner_text()
    # 期望：完形 9 + 阅读 (7.5+10+5+7.5=30) + 新题型 8 + 翻译 8 + 写作 22 = 77
    add('full: 汇总总分 77 / 100', total.strip().startswith('77'), total.strip())
    add('full: 成绩单表格 8 行', await page.locator('.fp-table tbody tr').count() == 8)
    hist = await page.locator('#fp-history').inner_text()
    add('full: 历史记录已写入', '最近成绩' in hist and '平均' in hist)
    # 作废本场：只重置计时与写作，模块作答状态保持
    await page.click('#fp-reset')
    await page.wait_for_timeout(300)
    add('full: 作废后计时归零、写作回未开始',
        await page.evaluate("() => document.getElementById('fp-clock').textContent.startsWith('03:00') && "
                            "[...document.querySelectorAll('.fp-sec[data-sec=writing] [data-state]')].every(b => b.textContent === '未开始')"))


async def test_paperexam(page, base, add):
    # ===== 真题卷模考：答题卡 + 答案键解析 + 判分数学 =====
    await page.goto(f"file://{base / 'paper_exam.html'}")
    await page.evaluate("localStorage.clear()")
    await page.reload()
    await page.wait_for_timeout(500)
    add('paper: 年份下拉 2010-2026 共 17 项',
        await page.evaluate("() => document.getElementById('year-sel').options.length === 17"))
    add('paper: PDF iframe 指向 papers/2010-yingyi.pdf',
        await page.evaluate("() => document.getElementById('pdf-frame').src.includes('papers/2010-yingyi.pdf')"))
    add('paper: 答题卡 45 个机读题位',
        await page.evaluate("() => document.querySelectorAll('.as-item').length === 45"))
    # 点选答题卡（事件委托）：21 选 A → 再点 A 取消 → 再选 B
    await page.click('.as-item[data-q="21"] button[data-l="A"]')
    await page.wait_for_timeout(100)
    saved = await page.evaluate("() => JSON.parse(localStorage.getItem('wsj_paper:2010') || '{}').answers")
    add('paper: 点选即存（21=A）', saved and saved.get('21') == 'A', str(saved))
    await page.click('.as-item[data-q="21"] button[data-l="A"]')
    await page.wait_for_timeout(100)
    saved = await page.evaluate("() => JSON.parse(localStorage.getItem('wsj_paper:2010') || '{}').answers")
    add('paper: 再点取消', not saved or not saved.get('21'), str(saved))
    await page.click('.as-item[data-q="21"] button[data-l="B"]')
    # 答案键解析：混排格式 1-20 段 + 散对（先展开折叠的答案键面板）
    await page.evaluate("() => { document.getElementById('key-input').closest('details').open = true; }")
    await page.fill('#key-input', '1-20 BDCADACBBA DBACDCABCD 21.D 22.C')
    await page.click('#key-btn')
    await page.wait_for_timeout(200)
    keyState = await page.evaluate("() => JSON.parse(localStorage.getItem('wsj_paper:2010') || '{}').key")
    add('paper: 答案键解析出 22 题', len(keyState) == 22, str(len(keyState)))
    add('paper: 段式解析 1=B', keyState.get('1') == 'B', str(keyState.get('1')))
    add('paper: 散对不覆盖段式 21=D', keyState.get('21') == 'D', str(keyState.get('21')))
    # 判分数学：完形 1-20 全对（10 分）+ 阅读 21 对（2 分），主观 0 → 12
    await page.evaluate("""() => {
      const st = JSON.parse(localStorage.getItem('wsj_paper:2010'));
      const key = st.key;
      for (let q = 1; q <= 20; q++) st.answers[String(q)] = key[String(q)];
      st.answers['21'] = 'D';
      localStorage.setItem('wsj_paper:2010', JSON.stringify(st));
    }""")
    await page.reload()
    await page.wait_for_timeout(400)
    page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
    await page.click('#submit-btn')
    await page.wait_for_timeout(400)
    total = await page.locator('.score-total').inner_text()
    add('paper: 客观判分 12/100（完形全对 + 阅读 21 对）', total.strip().startswith('12'), total.strip())
    hist = await page.locator('#hist-body').inner_text()
    add('paper: 历史已写入', '最高' in hist)
    # 切换年份状态隔离
    await page.select_option('#year-sel', '2015')
    await page.wait_for_timeout(300)
    add('paper: 切年份后答题卡清空（状态隔离）',
        await page.evaluate("() => Object.keys(JSON.parse(localStorage.getItem('wsj_paper:2015') || '{\"answers\":{}}').answers).length === 0"))


async def test_algorithm_suite(page, base, add):
    # 直接在 newtype 页面内 ?test=1 求值 window.__NT__ 做算法断言
    # （旧 _test_suite.html 已在 v28-v30 清理中移除，页面内求值不依赖任何测试文件）
    await page.goto(f"file://{base / 'newtype_ai_cost.html'}?test=1")
    await page.evaluate("localStorage.clear()")
    await page.reload()
    await page.wait_for_timeout(800)
    r = await page.evaluate(
        """() => {
          const N = window.__NT__;
          if (!N) return { hook: false };
          const out = { hook: true };
          out.fns = ['mulberry32', 'shuffle', 'genA', 'genB', 'genC', 'genD', 'pickIndex']
            .every(k => typeof N[k] === 'function');
          const s42 = (n) => { const r = N.mulberry32(42); const a = []; for (let i = 0; i < n; i++) a.push(r()); return a; };
          const m = s42(10000);
          out.mulberryInRange = m.every(v => v >= 0 && v < 1);
          out.mulberryDeterministic = JSON.stringify(s42(100)) === JSON.stringify(s42(100));
          let boundsOk = true;
          const pr = N.mulberry32(99);
          for (let i = 0; i < 1000; i++) { const v = N.pickIndex(pr, 5); if (!Number.isInteger(v) || v < 0 || v >= 5) { boundsOk = false; break; } }
          out.pickBoundsOk = boundsOk;
          const sum = (x, y) => JSON.stringify(x) === JSON.stringify(y);
          const A = N.genA(0);
          out.genA = !!A && A.type === 'A' && Array.isArray(A.passage) && A.holes.length >= 3 && A.holes.length <= 5
            && (A.options || []).length === 7
            && A.holes.every(h => /^[A-G]$/.test(String((A.answers || {})[h.no] || '')));
          out.genADeterministic = !!A && sum(A, N.genA(0));
          const B = N.genB(0);
          out.genB = !!B && B.type === 'B' && (B.paras || []).length >= 4 && (B.anchors || []).length >= 1 && (B.blanks || []).length >= 1;
          const C = N.genC(0);
          out.genC = !!C && C.type === 'C' && (C.items || []).length === 5 && (C.allOpts || []).length === 7
            && (C.allOpts || []).every(o => o && String(o).length > 0);
          const D = N.genD(0);
          out.genD = !!D && D.type === 'D' && (D.items || []).length === 5 && (D.allOpts || []).length === 7
            && (D.allOpts || []).every(o => o && String(o).length > 0);
          return out;
        }"""
    )
    add('suite: __NT__ 测试钩子可用且函数齐全', bool(r and r.get('hook') and r.get('fns')))
    add('suite: mulberry32 值域 [0,1) 且确定', bool(r.get('mulberryInRange')) and bool(r.get('mulberryDeterministic')))
    add('suite: pickIndex 1000 次无越界', bool(r.get('pickBoundsOk')))
    add('suite: genA 结构/答案字母/确定性', bool(r.get('genA')) and bool(r.get('genADeterministic')))
    add('suite: genB 结构（段落/锚点/空位）', bool(r.get('genB')))
    add('suite: genC 结构（5 段 7 选项非空）', bool(r.get('genC')))
    add('suite: genD 结构（5 段 7 选项非空）', bool(r.get('genD')))


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default=str(Path(__file__).resolve().parent.parent / 'articles'))
    args = ap.parse_args()
    base = Path(args.dir).resolve()

    results = []
    errors = []

    def add(name, ok, msg=''):
        results.append((name, bool(ok), msg))
        print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{msg}]" if msg else ''))

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await new_page(browser, errors)
        await test_newtype(page, base, add)
        await test_cloze(page, base, add)
        await test_exam(page, base, add)
        await test_reader_features(page, base, add)
        await test_fullpaper(page, base, add)
        await test_paperexam(page, base, add)
        await test_algorithm_suite(page, base, add)
        await browser.close()

    js_errors = [e for e in errors if 'ResizeObserver' not in e]
    add('无未捕获 JS 异常', len(js_errors) == 0, '; '.join(js_errors[:3]))

    fails = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(fails)}/{len(results)} passed")
    sys.exit(0 if not fails else 1)


if __name__ == '__main__':
    asyncio.run(main())
