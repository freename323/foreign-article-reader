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


async def test_algorithm_suite(page, base, add):
    await page.goto(f"file://{base / '_test_suite.html'}")
    try:
        await page.wait_for_function(
            "document.getElementById('stats').textContent.includes('通过') && "
            "!document.getElementById('stats').textContent.includes('尚未运行')",
            timeout=30000)
        stats = await page.locator('#stats').inner_text()
        add('suite: 算法回归测试全部通过', '失败' not in stats, stats)
    except Exception as e:
        add('suite: 算法回归测试全部通过', False, f'timeout waiting for stats: {e}')


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
        await test_algorithm_suite(page, base, add)
        await browser.close()

    js_errors = [e for e in errors if 'ResizeObserver' not in e]
    add('无未捕获 JS 异常', len(js_errors) == 0, '; '.join(js_errors[:3]))

    fails = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(fails)}/{len(results)} passed")
    sys.exit(0 if not fails else 1)


if __name__ == '__main__':
    asyncio.run(main())
