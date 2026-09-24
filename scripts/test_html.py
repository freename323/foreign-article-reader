"""Test the rendered HTML with Playwright (25 sanity checks).

Usage:
    python test_html.py --html article.html
    python test_html.py --dir ./out/
    python test_html.py --dir ./out/ --shots ./v4_shots/

Output: prints PASS/FAIL for each test. Exit code 0 if all pass.
"""
import argparse
import asyncio
import sys
from pathlib import Path

# We try to import playwright; if not installed, fail gracefully
try:
    from playwright.async_api import async_playwright
except ImportError:
    print("ERROR: playwright not installed. Run: pip install playwright && playwright install chromium", file=sys.stderr)
    sys.exit(1)


# Default viewport
VW, VH = 1500, 1100


async def run_test(page, html_path, shots_dir):
    """Run all 25 sanity checks on one HTML file. Return (pass_count, fail_count, results_list)."""
    results = []

    def add(name, ok, msg=''):
        results.append((name, ok, msg))

    await page.goto(f"file://{html_path.resolve()}")
    await page.evaluate("localStorage.clear()")
    await page.reload()
    await page.wait_for_function("document.fonts && document.fonts.ready", timeout=15000)
    await page.wait_for_timeout(500)

    # 1. 3 columns layout
    cols = await page.locator('.col-en, .col-body.en, .col-summary, .col-cn, .col-body.cn').count()
    has_main = await page.locator('.main-wrap').count()
    add('3 columns layout', has_main > 0 and cols >= 2, f'main-wrap={has_main}, cols={cols}')

    # 2. Header visible
    header_visible = await page.evaluate("""() => {
        const h = document.querySelector('.header');
        if (!h) return false;
        const cs = getComputedStyle(h);
        return cs.display !== 'none' && parseFloat(cs.maxHeight || '9999') > 0;
    }""")
    add('header visible', header_visible, '')

    # 3. Paragraph summaries
    sum_count = await page.locator('.para-summary-item').count()
    add('paragraph summaries', sum_count > 0, f'count={sum_count}')

    # 4. Scroll sync (EN -> CN) — scroll to the bottom so short articles also exercise sync
    before = await page.evaluate("""() => {
        const en = document.querySelector('.col-body.en, .col-en .col-body');
        return en ? en.scrollTop : 0;
    }""")
    await page.evaluate("""() => {
        const en = document.querySelector('.col-body.en, .col-en .col-body');
        if (en) en.scrollTop = en.scrollHeight;
        en.dispatchEvent(new Event('scroll'));
    }""")
    await page.wait_for_timeout(500)
    after = await page.evaluate("""() => {
        const cn = document.querySelector('.col-body.cn, .col-cn .col-body');
        return cn ? { top: cn.scrollTop, max: cn.scrollHeight - cn.clientHeight } : { top: 0, max: 0 };
    }""")
    drift = abs(after['top'] - after['max'])
    add('scroll sync EN->CN (bottom, drift<200)', drift < 200, f'en_before={before}, cn_top={after["top"]}, cn_max={after["max"]}, drift={drift}')
    await page.screenshot(path=str(shots_dir / f'sync_{html_path.stem}.png'))

    # 5. line alignment (rough check: P height similar)
    line_aligned = await page.evaluate("""() => {
        const ens = document.querySelectorAll('.col-body.en p[data-para-idx]');
        const cns = document.querySelectorAll('.col-body.cn p[data-para-idx]');
        if (ens.length === 0 || cns.length === 0) return null;
        // Check P1 heights are equal
        const e1 = ens[0].getBoundingClientRect().height;
        const c1 = cns[0].getBoundingClientRect().height;
        return Math.abs(e1 - c1) < 20;
    }""")
    add('line alignment (P1 heights equal)', line_aligned is True, f'p1_heights_match={line_aligned}')

    # 6. summary heights aligned
    sum_heights = await page.evaluate("""() => {
        const item = document.querySelector('.para-summary-item');
        if (!item) return null;
        const en = item.querySelector('.en-sum');
        const cn = item.querySelector('.cn-sum');
        if (!en || !cn) return null;
        const eh = en.getBoundingClientRect().height;
        const ch = cn.getBoundingClientRect().height;
        return Math.abs(eh - ch) < 30;
    }""")
    add('summary heights aligned', sum_heights is True, f'sum1_heights_match={sum_heights}')

    # 7. toggle summary
    await page.evaluate("""() => {
        const btn = document.querySelector('[onclick*=\"toggleSummary\"], #toggle-summary, button[title*=\"概要\"]');
        if (btn) btn.click();
    }""")
    await page.wait_for_timeout(300)
    no_sum = await page.evaluate("() => document.querySelector('.main-wrap')?.classList.contains('no-summary')")
    await page.evaluate("""() => {
        const btn = document.querySelector('[onclick*=\"toggleSummary\"], #toggle-summary, button[title*=\"概要\"]');
        if (btn) btn.click();
    }""")
    add('toggle summary (no-summary class)', no_sum is True, f'no_summary={no_sum}')

    # 8. toggle CN（用精确 id：title*="中文" 会误伤「撤销/重置」等含「中文」字样的菜单项）
    await page.evaluate("""() => {
        const btn = document.querySelector('#toggle-cn-btn');
        if (btn) btn.click();
    }""")
    await page.wait_for_timeout(300)
    no_cn = await page.evaluate("() => document.querySelector('.main-wrap')?.classList.contains('no-cn')")
    await page.evaluate("""() => {
        const btn = document.querySelector('#toggle-cn-btn');
        if (btn) btn.click();
    }""")
    add('toggle CN (no-cn class)', no_cn is True, f'no_cn={no_cn}')

    # 9. toggle header（title*="标题" 会命中「新题型：七选五/排序/小标题」菜单项并跳页，必须用 id）
    await page.evaluate("""() => {
        const btn = document.querySelector('#toggle-header-btn');
        if (btn) btn.click();
    }""")
    await page.wait_for_timeout(300)
    header_collapsed = await page.evaluate("() => document.querySelector('.header')?.classList.contains('collapsed')")
    await page.evaluate("""() => {
        const btn = document.querySelector('#toggle-header-btn');
        if (btn) btn.click();
    }""")
    add('toggle header (collapsed class)', header_collapsed is True, f'collapsed={header_collapsed}')

    # 10. open notes via open-vocab-btn. openNotes is a TOGGLE now (clicking the same
    # bucket again closes the panel), so collapse first to make the click mean "open".
    was_open = await page.evaluate("() => !document.querySelector('.notes-section')?.classList.contains('collapsed')")
    if was_open:
        await page.evaluate("() => window.toggleNotes && window.toggleNotes()")
        await page.wait_for_timeout(300)
    try:
        await page.locator('#open-vocab-btn').click(force=True, timeout=5000)
    except Exception:
        await page.evaluate("() => window.openNotes && window.openNotes('vocab')")
    await page.wait_for_timeout(400)
    notes_now_open = await page.evaluate("() => !document.querySelector('.notes-section')?.classList.contains('collapsed')")
    vocab_active = await page.evaluate("() => document.querySelector('[data-notes-bucket=\"vocab\"]')?.classList.contains('active')")
    add('open notes (vocab btn opens + vocab tab)', notes_now_open is True and vocab_active is True, f'opened={notes_now_open}, vocab_active={vocab_active}')
    try:
        await page.locator('#open-note-btn').click(force=True, timeout=5000)
    except Exception:
        await page.evaluate("() => window.openNotes && window.openNotes('note')")
    await page.wait_for_timeout(400)
    note_active = await page.evaluate("() => document.querySelector('[data-notes-bucket=\"note\"]')?.classList.contains('active')")
    add('open notes (note btn switches to note tab)', note_active is True, f'note_active={note_active}')

    # 11. EN float menu (real mouse drag to select text)
    en_p_box = await page.evaluate("""() => {
        const en = document.querySelector('.col-body.en');
        if (en) en.scrollTop = 0;
        const p = document.querySelector('.col-body.en p[data-para-idx]');
        if (!p) return null;
        const r = p.getBoundingClientRect();
        return { x: r.left + 50, y: r.top + 20 };
    }""")
    if en_p_box:
        await page.mouse.move(en_p_box['x'], en_p_box['y'])
        await page.mouse.down()
        await page.mouse.move(en_p_box['x'] + 50, en_p_box['y'], steps=3)
        await page.mouse.up()
    await page.wait_for_timeout(400)
    en_menu_visible = await page.evaluate("() => document.querySelector('.float-menu')?.classList.contains('visible')")
    add('EN float menu on select', en_menu_visible is True, f'menu_show={en_menu_visible}')
    await page.screenshot(path=str(shots_dir / f'float_menu_en_{html_path.stem}.png'))

    # 12. CN float menu (real mouse drag)
    cn_p_box = await page.evaluate("""() => {
        const cn = document.querySelector('.col-body.cn');
        if (cn) cn.scrollTop = 0;
        const p = document.querySelector('.col-body.cn p[data-para-idx]');
        if (!p) return null;
        const r = p.getBoundingClientRect();
        return { x: r.left + 50, y: r.top + 20 };
    }""")
    if cn_p_box:
        await page.mouse.move(cn_p_box['x'], cn_p_box['y'])
        await page.mouse.down()
        await page.mouse.move(cn_p_box['x'] + 50, cn_p_box['y'], steps=3)
        await page.mouse.up()
    await page.wait_for_timeout(400)
    cn_menu_visible = await page.evaluate("() => document.querySelector('.float-menu')?.classList.contains('visible')")
    add('CN float menu on select', cn_menu_visible is True, f'menu_show={cn_menu_visible}')

    # 13. dark mode — four-dropdown rebuild removed #theme-menu-btn; click the
    # 暗色 button inside the 视图 menu, then restore the default theme
    await page.evaluate("""() => {
        const btn = document.querySelector('#menu-view .menu-theme-row button[onclick*=dark]');
        if (btn) btn.click();
    }""")
    await page.wait_for_timeout(300)
    is_dark = await page.evaluate("() => document.documentElement.dataset.theme === 'dark'")
    await page.evaluate("() => window.setTheme && window.setTheme('green')")
    add('dark mode toggle', is_dark is True, f'dark={is_dark}')
    await page.screenshot(path=str(shots_dir / f'dark_{html_path.stem}.png'))

    # 14. persistence (set localStorage, reload, check it stuck)
    await page.evaluate("""() => {
        localStorage.setItem('test:anno', JSON.stringify([{id: 't1', type: 'word', text: 'test'}]));
    }""")
    await page.reload()
    await page.wait_for_function("document.fonts && document.fonts.ready", timeout=15000)
    await page.wait_for_timeout(500)
    persisted = await page.evaluate("() => localStorage.getItem('test:anno') !== null")
    add('localStorage persistence', persisted is True, f'persisted={persisted}')

    # 15. jump button
    has_jump = await page.locator('.jump-btn').count()
    add('jump buttons present', has_jump > 0, f'count={has_jump}')
    if has_jump > 0:
        await page.locator('.jump-btn').first.click()
        await page.wait_for_timeout(500)
        scrolled = await page.evaluate("""() => {
            const en = document.querySelector('.col-body.en');
            return en ? en.scrollTop > 100 : false;
        }""")
        add('jump button scrolls', scrolled is True, f'scrolled={scrolled}')

    # 16. CN editable
    cn_editable = await page.evaluate("""() => {
        const p = document.querySelector('.col-body.cn p[data-para-idx]');
        return p ? p.getAttribute('contenteditable') === 'true' : false;
    }""")
    add('CN paragraphs editable', cn_editable is True, f'editable={cn_editable}')

    # 17. summary editable
    sum_editable = await page.evaluate("""() => {
        const e = document.querySelector('.para-summary-item .en-sum .editable, .para-summary-item .en-sum span');
        return e ? e.getAttribute('contenteditable') === 'true' : false;
    }""")
    add('summary items editable', sum_editable is True, f'editable={sum_editable}')

    # 18. MD export button (label is "Markdown"; "MD" as substring no longer occurs)
    has_md = await page.locator('button:has-text("Markdown"), button[onclick="exportMarkdown()"]').count()
    add('MD export button', has_md > 0, f'count={has_md}')

    # 19. blockquote (sidebar) heights aligned
    bq_aligned = await page.evaluate("""() => {
        const en = document.querySelector('.col-body.en blockquote');
        const cn = document.querySelector('.col-body.cn blockquote');
        if (!en || !cn) return null;
        const eh = en.getBoundingClientRect().height;
        const ch = cn.getBoundingClientRect().height;
        return Math.abs(eh - ch) < 30;
    }""")
    add('blockquote heights aligned', bq_aligned is not False, f'bq_match={bq_aligned} (null = 本篇无 blockquote，跳过)')

    # 20. notes tabs present (生词本 / 笔记 / 全部)
    tabs_exist = await page.evaluate("""() => {
        const tabs = document.querySelectorAll('[data-notes-bucket]');
        return tabs.length >= 3;
    }""")
    add('notes tabs (生词本/笔记/全部)', tabs_exist is True, f'tabs_count={await page.locator("[data-notes-bucket]").count()}')

    # Clear selection from previous tests and reset
    await page.evaluate("() => window.getSelection()?.removeAllRanges()")
    await page.evaluate("() => document.getElementById('float-menu')?.classList.remove('visible')")
    await page.wait_for_timeout(200)
    # Scroll EN col to top
    await page.evaluate("() => document.querySelector('.col-body.en').scrollTop = 0")
    await page.wait_for_timeout(200)

    # 21. add a vocab annotation: select text via real mouse, click vocab button
    p1_box = await page.evaluate("""() => {
        const p = document.querySelector('.col-body.en p[data-para-idx="1"]');
        if (!p) return null;
        const r = p.getBoundingClientRect();
        return { x: r.left + 30, y: r.top + 20 };
    }""")
    vocab_clicked = False
    if p1_box:
        # 双击选整词（真实用户手势）。标注高亮按词边界匹配，不会包裹半截单词，
        # 所以不能用固定像素拖选（会选到词中间的碎片，无法成词）。
        # x+6 落在段首第一个词的字符上，避免落在词间空格
        await page.mouse.dblclick(p1_box['x'] + 6, p1_box['y'])
        await page.wait_for_timeout(500)
        # Click vocab button in float menu
        menu_visible = await page.evaluate("() => document.getElementById('float-menu')?.classList.contains('visible')")
        if menu_visible:
            vocab_btn = page.locator('#float-menu button[data-act="vocab"]')
            if await vocab_btn.count() > 0:
                try:
                    await vocab_btn.click(timeout=2000, force=True)
                    vocab_clicked = True
                    await page.wait_for_timeout(500)
                except Exception as e:
                    print(f"  vocab click failed: {e}")
    # Check mark.hl-vocab exists
    has_vocab_mark = await page.evaluate("() => document.querySelectorAll('mark.hl-vocab').length > 0")
    add('vocab annotation has hl-vocab class', has_vocab_mark is True, f'has_vocab={has_vocab_mark} (clicked={vocab_clicked})')

    # 22. notes panel shows the vocab in 生词本 tab
    notes_shows_vocab = await page.evaluate("""() => {
        const list = document.getElementById('notes-list');
        if (!list) return false;
        const cards = list.querySelectorAll('.note-card, .note-cn-format');
        return cards.length > 0;
    }""")
    add('vocab appears in notes panel (生词本 tab default)', notes_shows_vocab is True, f'shown={notes_shows_vocab}')

    # 23. switch to 笔记 tab and verify it's empty
    note_btn = page.locator('[data-notes-bucket="note"]')
    if await note_btn.count() > 0:
        try:
            await note_btn.click(timeout=2000)
        except Exception:
            pass
    await page.wait_for_timeout(300)
    note_tab_empty = await page.evaluate("""() => {
        const list = document.getElementById('notes-list');
        const hint = list.querySelector('.empty-hint');
        return hint && hint.textContent.includes('笔记');
    }""")
    add('笔记 tab is empty initially', note_tab_empty is True, f'empty={note_tab_empty}')

    # Final screenshot
    await page.evaluate("window.scrollTo(0, 0)")
    await page.wait_for_timeout(300)
    await page.screenshot(path=str(shots_dir / f'final_{html_path.stem}.png'))

    passes = sum(1 for _, ok, _ in results if ok)
    fails = sum(1 for _, ok, _ in results if not ok)
    return passes, fails, results


async def run_one(html_path, shots_dir):
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": VW, "height": VH})
        page = await ctx.new_page()
        passes, fails, results = await run_test(page, html_path, shots_dir)
        await browser.close()
        return passes, fails, results


async def main_async(args):
    if args.html:
        files = [Path(args.html)]
    elif args.dir:
        d = Path(args.dir)
        files = sorted(d.glob('*_final.html'))
    else:
        print("ERROR: must specify --html or --dir", file=sys.stderr)
        return 1

    if not files:
        print(f"ERROR: no _final.html files found", file=sys.stderr)
        return 1

    shots_dir = Path(args.shots) if args.shots else Path('v4_shots')
    shots_dir.mkdir(parents=True, exist_ok=True)

    total_pass = 0
    total_fail = 0
    for f in files:
        print(f"\n{'=' * 70}")
        print(f"TESTING: {f.name}")
        print("=" * 70)
        passes, fails, results = await run_one(f, shots_dir)
        for name, ok, msg in results:
            tag = '[OK]  ' if ok else '[FAIL]'
            print(f"  {tag} {name}" + (f" ({msg})" if msg else ""))
        print(f"  -- {passes} pass, {fails} fail --")
        total_pass += passes
        total_fail += fails

    print()
    print("=" * 70)
    print(f"TOTAL: {total_pass} pass, {total_fail} fail across {len(files)} file(s)")
    print("=" * 70)
    return 0 if total_fail == 0 else 1


def main():
    parser = argparse.ArgumentParser(description='Run Playwright sanity tests on rendered HTML')
    parser.add_argument('--html', help='Single HTML file to test')
    parser.add_argument('--dir', help='Directory of _final.html files to test')
    parser.add_argument('--shots', help='Screenshot output directory (default: ./v4_shots)')
    args = parser.parse_args()
    code = asyncio.run(main_async(args))
    sys.exit(code)


if __name__ == '__main__':
    main()
