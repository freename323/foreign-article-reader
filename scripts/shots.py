#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
用无头 Edge 给页面截图 —— 不改产品代码，也能看见「真实排版」。

为什么需要它：本项目没有安装 Playwright（拉浏览器成本高），而 jsdom 没有排版引擎，
分版 / 多栏 / 抽屉透明度这类问题在 jsdom 里测不出来。Windows 自带 Edge，
`--headless=new --screenshot` 就能拿到真实渲染结果。

用法：
    python scripts/shots.py                                  # 默认给第 1 篇文章截图
    python scripts/shots.py --page 3                         # 翻到第 4 版
    python scripts/shots.py --panel sum                       # 顺带点开「导读」抽屉
    python scripts/shots.py --panel notes --width 1280        # 剪报本 / 自定义视口
    python scripts/shots.py --article articles/exam_ai_cost.html
    python scripts/shots.py --js "console.log(1)" --dump      # 只跑一段 JS 并打印结果
    python scripts/shots.py --lang cn                         # 看中文版（另一份报纸）
    python scripts/shots.py --cols 3                         # 强制三栏

原理：把文章 HTML 复制一份到 articles/ 下（这样相对的 reader.js / reader.css 才找得到），
      在 </body> 前插一段探针脚本，再用 Edge 无头模式截图 / dump-dom，最后删掉副本。
"""

import argparse
import glob
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, 'articles')
OUT_DIR = os.path.join(ROOT, '.workbuddy', 'shots')
PROFILE = os.path.join(ROOT, '.workbuddy', 'edgeprofile')

EDGE_CANDIDATES = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
]


def find_browser():
    for p in EDGE_CANDIDATES:
        if os.path.exists(p):
            return p
    raise SystemExit('没有找到 Edge / Chrome，无法截图')


def probe_script(page, panel, js, dump, lang=None, cols=None):
    """拼出探针脚本。⚠ 不要用 location.reload() —— 探针会在 reload 后重跑，形成死循环。"""
    parts = []
    if panel == 'sum':
        parts.append("setTimeout(function(){var b=document.getElementById('np-sum');if(b)b.click();},1200);")
    elif panel == 'notes':
        parts.append("setTimeout(function(){var b=document.getElementById('np-notes');if(b)b.click();},1200);")
    # 语言 / 栏数都是全局偏好，写进 localStorage 即可（报纸版进入时会读到）
    if lang:
        parts.append("try{localStorage.setItem('wsj_reader:paperLang','%s');}catch(e){}" % lang)
    if cols:
        parts.append("try{localStorage.setItem('wsj_reader:paperCols','%d');}catch(e){}" % cols)
    if page:
        parts.append(
            "setTimeout(function(){var b=document.getElementById('np-next');"
            "for(var i=0;i<%d;i++) if(b) b.click();},1200);" % page)
    if js:
        parts.append("setTimeout(function(){try{%s}catch(e){document.title='ERR '+e.message;}},2000);" % js)
    if dump:
        parts.append(
            "setTimeout(function(){document.body.setAttribute('data-diag', String(window.__diag||''));},2400);")
    return '<script>\n' + '\n'.join(parts) + '\n</script>\n</body>'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--article', default=None, help='文章 HTML（默认取第一篇 *_final.html）')
    ap.add_argument('--page', type=int, default=0, help='翻到第 N 版（0 = 首页）')
    ap.add_argument('--panel', choices=['', 'sum', 'notes'], default='', help='顺带点开哪个抽屉')
    ap.add_argument('--lang', choices=['en', 'cn'], default=None, help='看英文版还是中文版（默认沿用页面里已有的偏好）')
    ap.add_argument('--cols', type=int, choices=[1, 2, 3], default=None, help='页内栏数 1/2/3')
    ap.add_argument('--width', type=int, default=1440)
    ap.add_argument('--height', type=int, default=900)
    ap.add_argument('-o', '--out', default=None)
    ap.add_argument('--js', default=None, help='额外执行的一段 JS（配合 --dump 看结果）')
    ap.add_argument('--dump', action='store_true', help='只 dump DOM（配合 --js 打印诊断）')
    args = ap.parse_args()

    article = args.article
    if not article:
        cands = sorted(glob.glob(os.path.join(ART, '*_final.html')))
        if not cands:
            raise SystemExit('articles/ 下没有 *_final.html')
        article = cands[0]
    if not os.path.isabs(article):
        article = os.path.join(ROOT, article)
    if not os.path.exists(article):
        raise SystemExit('找不到 %s' % article)

    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(PROFILE, exist_ok=True)
    # ⚠ 探针副本必须**保留原文件名**（只加 .probe 后缀）：
    #   产品里 articleId = 页面文件名，报头日期在 meta 没写日期时要靠文件名里的 ISO 日期兜底。
    #   如果随便起名（如 _probe_shot.html），日期会退化成「今天」，截图会给出错误印象。
    probe = os.path.join(ART, os.path.basename(article)[:-5] + '.probe.html')
    out = args.out or os.path.join(OUT_DIR, 'shot.png')
    if not os.path.isabs(out):
        out = os.path.join(ROOT, out)

    src = open(article, encoding='utf-8').read()
    open(probe, 'w', encoding='utf-8', newline='\n').write(
        src.replace('</body>', probe_script(args.page, args.panel, args.js, args.dump,
                                           args.lang, args.cols), 1))

    browser = find_browser()
    cmd = [browser, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
           '--user-data-dir=' + PROFILE,
           '--window-size=%d,%d' % (args.width, args.height),
           '--virtual-time-budget=7000']
    url = 'file:///' + probe.replace('\\', '/')
    if args.dump:
        cmd.append('--dump-dom')
    else:
        cmd.append('--screenshot=' + out.replace('\\', '/'))
    cmd.append(url)

    try:
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8',
                           errors='replace', timeout=120)
    finally:
        if os.path.exists(probe):
            os.remove(probe)

    if args.dump:
        m = re.search(r'data-diag="([^"]*)"', r.stdout or '')
        print(m.group(1).replace(' || ', '\n') if m else (r.stdout or '')[:2000])
    else:
        print('截图已写入：%s' % out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
