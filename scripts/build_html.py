#!/usr/bin/env python
"""
Final build (v4 layout) — Foreign Article Reader skill renderer.

Usage:
    python build_html.py --data _articles.json --out article.html
    python build_html.py --data _articles.json --out-dir ./out/

Output: one HTML per article. Filename from each article's `html` field.

Schema: see references/data-schema.md in skill root.
"""
import argparse
import json
import re
import sys
from pathlib import Path

# Default data directory: project root (parent of scripts/)
OUT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description='Render foreign-article-reader HTML from _articles.json')
    parser.add_argument('--data', default=str(OUT / '_articles.json'),
                        help='Path to _articles.json (default: <script_dir>/_articles.json)')
    parser.add_argument('--out', default=None,
                        help='Output HTML file (only if data has 1 article). '
                             'If --out is given, overrides article[0].html filename.')
    parser.add_argument('--out-dir', default=None,
                        help='Output directory (default: same dir as --data)')
    args = parser.parse_args()

    data_path = Path(args.data)
    if not data_path.exists():
        print(f"ERROR: data file not found: {data_path}", file=sys.stderr)
        sys.exit(1)

    out_dir = Path(args.out_dir) if args.out_dir else data_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    articles = load_articles(data_path)
    print(f"Loaded {len(articles)} article(s) from {data_path.name}")

    written_dirs = set()
    for art in articles:
        html = build_html(art)
        if args.out and len(articles) == 1:
            out_path = Path(args.out)
        else:
            out_path = out_dir / art['html']
        out_path.write_text(html, encoding='utf-8')
        written_dirs.add(out_path.parent)
        print(f"  Wrote {out_path.name}: {out_path.stat().st_size:,} bytes")

    # Shared assets: refresh reader.css / reader.js next to the generated articles
    # (source of truth: src/reader.css and src/reader.js)
    for d in sorted(written_dirs):
        with open(d / 'reader.css', 'w', encoding='utf-8', newline='\n') as fp:
            fp.write(CSS)
        with open(d / 'reader.js', 'w', encoding='utf-8', newline='\n') as fp:
            fp.write(JS)
        print(f"  Wrote reader.css + reader.js into {d}")

    # Generate Hub and Compare pages alongside articles
    script_dir = Path(__file__).parent
    hub_template = script_dir / 'WSJ_Hub_template.html'
    compare_template = script_dir / 'WSJ_Compare_template.html'
    if hub_template.exists():
        hub_path = out_dir / 'WSJ_Hub.html'
        hub_path.write_text(hub_template.read_text(encoding='utf-8'), encoding='utf-8')
        print(f"  Wrote {hub_path.name}: {hub_path.stat().st_size:,} bytes")
    if compare_template.exists():
        compare_path = out_dir / 'WSJ_Compare.html'
        compare_path.write_text(compare_template.read_text(encoding='utf-8'), encoding='utf-8')
        print(f"  Wrote {compare_path.name}: {compare_path.stat().st_size:,} bytes")

    print("Done.")


# Note: `if __name__ == '__main__': main()` is defined at the bottom of this file
# after `load_articles` so that the forward-reference resolves at call time.


# ---------- Article data (loaded from _articles.json) ----------
def load_articles(path=None):
    fp = Path(path) if path else OUT / '_articles.json'
    raw = json.loads(fp.read_text(encoding='utf-8'))
    out = []
    for a in raw:
        # para_summaries in JSON: list of [en, cn] pairs (or list of strings for legacy)
        raw_sums = a.get('para_summaries', [])
        para_summaries = []
        if raw_sums and isinstance(raw_sums[0], list):
            # New format: list of [en, cn] pairs
            for pair in raw_sums:
                if len(pair) >= 2:
                    para_summaries.append((pair[0], pair[1]))
        elif raw_sums and isinstance(raw_sums[0], str):
            # Legacy format: list of CN strings, build EN from first sentence
            en_sums = first_sentence_per_para(a['en_body'])
            n = min(len(en_sums), len(raw_sums))
            para_summaries = list(zip(en_sums[:n], raw_sums[:n]))
        out.append({
            'html': a['html'],
            'en_title': a['en_title'],
            'cn_title': a['cn_title'],
            'en_author': a['en_author'],
            'cn_author': a['cn_author'],
            'en_sub': a['en_sub'],
            'cn_sub': a['cn_sub'],
            'thesis': a.get('thesis', []),
            'para_summaries': para_summaries,
            'en_body': a['en_body'],
            'cn_body': a['cn_body'],
        })
    return out


def first_sentence_per_para(en_body_html):
    """Return list of first-sentence snippets, one per <p id="para-X">."""
    sentences = []
    for m in re.finditer(r'<p id="para-(\d+)"[^>]*>(.*?)</p>', en_body_html, re.DOTALL):
        idx = int(m.group(1))
        content = re.sub(r'<[^>]+>', '', m.group(2)).strip()
        content = re.sub(r'\s+', ' ', content)
        # First sentence
        s = re.split(r'(?<=[.!?])\s+', content, maxsplit=1)[0]
        # Cap to ~200 chars
        if len(s) > 220:
            s = s[:217].rstrip() + '...'
        sentences.append(s)
    return sentences


# ---------- HTML escape ----------
def esc(s):
    if s is None:
        return ''
    return (str(s)
            .replace('&', '&amp;')
            .replace('<', '&lt;')
            .replace('>', '&gt;')
            .replace('"', '&quot;')
            .replace("'", '&#39;'))


# ---------- Editorial artwork ----------
# 每篇文章一幅编辑部线稿插画（内联 SVG，颜色走 CSS 变量，跟随亮/暗/绿金主题）
ARTWORK_SVG = {'AI_Regulation': '<svg viewBox="0 0 172 110" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="img"><line class="ink" x1="66" y1="96" x2="106" y2="96"/><line class="ink" x1="86" y1="96" x2="86" y2="36"/><line class="ink" x1="44" y1="44" x2="128" y2="44"/><circle class="gold" cx="86" cy="39" r="3.2"/><line class="ink" x1="44" y1="44" x2="32" y2="66"/><line class="ink" x1="44" y1="44" x2="56" y2="66"/><path class="ink" d="M28,66 Q44,80 60,66"/><line class="ink" x1="128" y1="44" x2="116" y2="66"/><line class="ink" x1="128" y1="44" x2="140" y2="66"/><path class="ink" d="M112,66 Q128,80 144,66"/><rect class="gold" x="36" y="55" width="17" height="13" rx="2"/><line class="ink" x1="41" y1="68" x2="41" y2="72"/><line class="ink" x1="48" y1="68" x2="48" y2="72"/><circle class="ink" cx="128" cy="57" r="7"/><line class="ink" x1="128" y1="52" x2="128" y2="62"/><line class="soft" x1="20" y1="101" x2="152" y2="101"/></svg>', 'Ammo_Shortage': '<svg viewBox="0 0 172 110" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="img"><path class="ink" d="M34,88 v-24 a8,10 0 0 1 16,0 v24 z"/><path class="gold" d="M58,88 v-24 a8,10 0 0 1 16,0 v24 z"/><path class="ink" d="M82,88 v-24 a8,10 0 0 1 16,0 v24 z"/><line class="ink" x1="28" y1="88" x2="104" y2="88"/><polyline class="gold-line" points="16,36 48,42 72,58 96,66 124,76 150,88"/><line class="gold-line" x1="150" y1="88" x2="141" y2="87"/><line class="gold-line" x1="150" y1="88" x2="145" y2="80"/></svg>', 'Hidden_Cost_AI': '<svg viewBox="0 0 172 110" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="img"><rect class="ink" x="52" y="40" width="46" height="50" rx="2"/><line class="ink" x1="52" y1="57" x2="98" y2="57"/><line class="ink" x1="52" y1="74" x2="98" y2="74"/><circle class="ink-fill" cx="59" cy="48" r="1.8"/><circle class="ink-fill" cx="59" cy="65" r="1.8"/><circle class="ink-fill" cx="59" cy="82" r="1.8"/><line class="soft" x1="70" y1="48" x2="92" y2="48"/><line class="soft" x1="70" y1="65" x2="92" y2="65"/><line class="soft" x1="70" y1="82" x2="92" y2="82"/><path class="soft" d="M70,36 q3,-6 0,-10 q-3,-4 0,-8"/><g transform="rotate(-14 124 34)"><rect class="gold" x="110" y="27" width="28" height="14" rx="2"/><circle class="soft" cx="124" cy="34" r="3.4"/></g><g transform="rotate(9 141 58)"><rect class="ink" x="130" y="52" width="22" height="12" rx="2"/><circle class="soft" cx="141" cy="58" r="2.6"/></g><line class="soft" x1="24" y1="101" x2="148" y2="101"/></svg>', 'FCC_Sports': '<svg viewBox="0 0 172 110" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="img"><line class="ink" x1="76" y1="40" x2="62" y2="20"/><line class="ink" x1="96" y1="40" x2="110" y2="20"/><circle class="ink-fill" cx="62" cy="20" r="1.6"/><circle class="ink-fill" cx="110" cy="20" r="1.6"/><rect class="ink" x="40" y="40" width="92" height="54" rx="5"/><rect class="soft" x="48" y="48" width="76" height="38" rx="2"/><ellipse class="gold" cx="86" cy="67" rx="19" ry="8"/><line class="ink" x1="76" y1="67" x2="96" y2="67" stroke-width="1.2"/><line class="ink" x1="81" y1="64" x2="81" y2="70" stroke-width="1.2"/><line class="ink" x1="86" y1="64" x2="86" y2="70" stroke-width="1.2"/><line class="ink" x1="91" y1="64" x2="91" y2="70" stroke-width="1.2"/><line class="ink" x1="56" y1="94" x2="50" y2="100"/><line class="ink" x1="116" y1="94" x2="122" y2="100"/><path class="soft" d="M124,30 q10,6 12,16"/><path class="soft" d="M130,24 q14,8 17,22"/></svg>', 'Haldane_Chainsaw': '<svg viewBox="0 0 172 110" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="img"><path class="ink" d="M36,50 q2,-12 14,-12"/><rect class="ink" x="30" y="50" width="42" height="24" rx="6"/><line class="soft" x1="38" y1="58" x2="48" y2="58"/><line class="soft" x1="38" y1="63" x2="48" y2="63"/><rect class="ink" x="72" y="56" width="58" height="10" rx="5"/><line class="soft" x1="76" y1="54" x2="124" y2="54" stroke-dasharray="3,3"/><circle class="gold" cx="133" cy="61" r="4.2"/><path class="ink" d="M138,84 l14,-6" stroke-dasharray="4,3"/><path class="ink" d="M160,74 l8,-3" stroke-dasharray="4,3"/><path class="soft" d="M140,92 q4,4 10,2"/></svg>', 'Pothole': '<svg viewBox="0 0 172 110" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="img"><line class="ink" x1="16" y1="66" x2="66" y2="66"/><path class="ink" d="M66,66 Q86,94 106,66"/><line class="ink" x1="106" y1="66" x2="156" y2="66"/><path class="soft" d="M72,66 Q86,86 100,66"/><polygon class="ink-fill" points="60,74 64,70 66,76"/><circle class="ink-fill" cx="108" cy="74" r="1.5"/><circle class="ink-fill" cx="112" cy="70" r="1.2"/><circle class="gold" cx="86" cy="36" r="9"/><circle class="soft" cx="86" cy="36" r="5.5"/><line class="soft" x1="78" y1="52" x2="82" y2="48"/><line class="soft" x1="90" y1="52" x2="94" y2="48"/></svg>', 'Pensions': '<svg viewBox="0 0 172 110" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="img"><ellipse class="ink" cx="84" cy="70" rx="34" ry="21"/><rect class="ink-fill" x="74" y="50" width="20" height="5" rx="2"/><circle class="ink" cx="50" cy="66" r="7"/><circle class="ink-fill" cx="47" cy="64" r="1"/><circle class="ink-fill" cx="47" cy="69" r="1"/><path class="ink" d="M58,52 l6,-8 6,6"/><line class="ink" x1="66" y1="90" x2="66" y2="97"/><line class="ink" x1="100" y1="90" x2="100" y2="97"/><path class="ink" d="M118,66 q8,-2 6,8"/><circle class="gold" cx="84" cy="38" r="6"/><line class="soft" x1="84" y1="46" x2="84" y2="52" stroke-dasharray="2,2"/><path class="gold-line" d="M112,48 q0,-10 8,-14"/><path class="gold-line" d="M120,34 q10,-2 12,6 q-10,2 -12,-6"/><path class="gold-line" d="M120,38 q-8,-4 -12,2 q8,4 12,-2"/></svg>', 'Narrowing_Window': '<svg viewBox="0 0 172 110" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="img"><rect class="ink" x="28" y="24" width="116" height="62"/><polygon points="28,24 78,24 84,86 28,86" style="fill:var(--summary-bg);stroke:var(--art-ink);stroke-width:1.6"/><polygon points="144,24 94,24 88,86 144,86" style="fill:var(--summary-bg);stroke:var(--art-ink);stroke-width:1.6"/><ellipse class="gold" cx="86" cy="53" rx="7" ry="11"/><circle class="ink-fill" cx="86" cy="53" r="3.5"/><line class="gold-line" x1="86" y1="70" x2="86" y2="78"/><line class="gold-line" x1="80" y1="90" x2="76" y2="96"/><line class="gold-line" x1="92" y1="90" x2="96" y2="96"/></svg>', 'Moral_Economics': '<svg viewBox="0 0 172 110" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="img"><circle class="ink" cx="60" cy="60" r="22"/><circle class="ink" cx="60" cy="60" r="6"/><line class="ink" x1="82" y1="60" x2="88" y2="60"/><line class="ink" x1="76" y1="78" x2="80" y2="80"/><line class="ink" x1="60" y1="82" x2="60" y2="88"/><line class="ink" x1="44" y1="78" x2="40" y2="80"/><line class="ink" x1="38" y1="60" x2="32" y2="60"/><line class="ink" x1="44" y1="42" x2="40" y2="40"/><line class="ink" x1="60" y1="38" x2="60" y2="32"/><line class="ink" x1="76" y1="42" x2="80" y2="40"/><circle class="ink" cx="114" cy="70" r="14"/><circle class="ink" cx="114" cy="70" r="4"/><line class="ink" x1="128" y1="70" x2="134" y2="70"/><line class="ink" x1="121" y1="82" x2="124" y2="87"/><line class="ink" x1="107" y1="82" x2="104" y2="87"/><line class="ink" x1="100" y1="70" x2="94" y2="70"/><line class="ink" x1="107" y1="58" x2="104" y2="53"/><line class="ink" x1="121" y1="58" x2="124" y2="53"/><line class="gold-line" x1="88" y1="58" x2="92" y2="48"/><line class="gold-line" x1="90" y1="64" x2="100" y2="62"/><line class="gold-line" x1="86" y1="54" x2="88" y2="46"/><line class="soft" x1="24" y1="96" x2="148" y2="96"/></svg>'}
ARTWORK_CAP = {'AI_Regulation': 'Weighing AI · 为 AI 立规', 'Ammo_Shortage': 'Running dry · 弹药告急', 'Hidden_Cost_AI': 'Burn rate · 烧钱的速度', 'FCC_Sports': 'Game on air · 荧屏之战', 'Haldane_Chainsaw': 'Cutting red tape · 繁文缛节', 'Pothole': 'The claim · 坑洞索赔记', 'Pensions': 'Nest egg · 子女的钱罐', 'Narrowing_Window': 'Narrowing window · 收窄的窗口', 'Moral_Economics': 'Social friction · 社会摩擦'}


EDITION_KEYS = [
    ('AI_Regulation', 'ai_regulation'), ('Hidden_Cost_AI', 'ai_cost'),
    ('Ammo_Shortage', 'ammo_shortage'), ('FCC_Sports', 'fcc_sports'),
    ('Haldane_Chainsaw', 'haldane'), ('Narrowing_Window', 'horvitz'),
    ('Moral_Economics', 'moral_econ'), ('Pensions', 'pensions'), ('Pothole', 'pothole'),
]


def edition_of(html_filename):
    for key, eid in EDITION_KEYS:
        if key in html_filename:
            return eid
    return ''


def build_art_block(html_filename):
    """Return the .art-block HTML for an article (empty string if no artwork)."""
    for key in ARTWORK_SVG:
        if key in html_filename:
            return ('  <div class="art-block">\n    ' + ARTWORK_SVG[key] +
                    '\n    <div class="art-cap">' + ARTWORK_CAP[key] + '</div>\n  </div>\n')
    return ''

# ---------- CSS ----------
# ---------- Asset loading (CSS/JS source files in src/) ----------
_SRC_DIR = Path(__file__).resolve().parent.parent / 'src'

def _read_asset(name):
    """Read a CSS/JS source file from src/ directory."""
    p = _SRC_DIR / name
    if not p.exists():
        raise FileNotFoundError(f'Asset not found: {p}. Run from project root.')
    return p.read_text(encoding='utf-8')

CSS = _read_asset('reader.css')
JS = _read_asset('reader.js')




# ---------- Build HTML ----------
def build_html(art):
    """Build a complete HTML for one article."""
    en_title = esc(art['en_title'])
    cn_title = esc(art['cn_title'])
    en_author = esc(art['en_author'])
    cn_author = esc(art['cn_author'])
    en_sub = esc(art['en_sub'])
    cn_sub = esc(art['cn_sub'])
    thesis_html = ''.join(
        f'<li><span class="editable" contenteditable="true" data-default="{esc(t)}">{esc(t)}</span></li>'
        for t in art['thesis']
    )
    para_sums = art['para_summaries']
    para_sum_html = ''.join(
        f'''<div class="para-summary-item" data-idx="{i+1}">
          <div class="item-head">
            <span class="num">P{i+1}</span>
            <button class="jump-btn" data-jump="{i+1}" title="跳转到第 {i+1} 段">→</button>
          </div>
          <div class="en-sum editable"><span contenteditable="true" data-lang="en" data-default="{esc(en)}">{esc(en)}</span></div>
          <div class="cn-sum editable"><span contenteditable="true" data-lang="cn" data-default="{esc(cn)}">{esc(cn)}</span></div>
        </div>'''
        for i, (en, cn) in enumerate(para_sums)
    )
    en_body = art['en_body']
    art_block = build_art_block(art['html'])
    edition = edition_of(art['html'])
    cn_body = art['cn_body']

    # Number labels for paragraphs (EN: roman numerals — 外刊惯例且窄，不与正文重叠)
    EN_NUM_WORDS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
                    'XI', 'XII', 'XIII', 'XIV', 'XV']
    CN_NUM_CHARS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
                    '十一', '十二', '十三', '十四', '十五']

    def num_label(idx_str, is_cn):
        i = int(idx_str) - 1
        if is_cn:
            return CN_NUM_CHARS[i] if 0 <= i < len(CN_NUM_CHARS) else idx_str
        else:
            return EN_NUM_WORDS[i] if 0 <= i < len(EN_NUM_WORDS) else idx_str

    # Add data-para-num to EN paragraphs
    en_body = re.sub(
        r'<p id="para-(\d+)"',
        lambda m: f'<p id="para-{m.group(1)}" data-para-num="{num_label(m.group(1), False)}"',
        en_body,
    )
    # Add cn-translatable class + data-para-num to CN paragraphs
    cn_body = re.sub(
        r'<p id="para-(\d+)"',
        lambda m: f'<p id="para-{m.group(1)}" class="cn-translatable" data-para-num="{num_label(m.group(1), True)}"',
        cn_body,
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<!-- generated by build_final.py -->

<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{en_title} / {cn_title} — Bilingual EN/CN · 3-Column · Notes</title>
<link rel="stylesheet" href="reader.css">
</head>
<body data-edition="{edition}">

<div class="progress-bar" id="progress-bar"></div>

<div class="toolbar">
  <!-- buildMenus() in reader.js replaces these old trigger buttons with 视图/考试/数据/工具 -->
  <button class="toolbar-btn arrow" id="menu-left-btn" onclick="toggleMenu('left')" title="视图设置（字号/主题）">⚙ <span>▾</span></button>
  <button class="toolbar-btn active" id="toggle-summary-btn" onclick="toggleSummary()" title="显示/隐藏概要列" style="background:#f0e6c8;color:#7a5a07;font-weight:600;">📌 概要</button>
  <button class="toolbar-btn active" id="toggle-cn-btn" onclick="toggleCN()" title="显示/隐藏中文列" style="background:#dfe7f5;color:#1a365d;font-weight:600;">🀄 中文</button>
  <button class="toolbar-btn" id="open-vocab-btn" onclick="openNotes('vocab')" title="打开生词本" style="background:#cfe2ff;color:#1a365d;font-weight:600;">📖 生词</button>
  <button class="toolbar-btn" id="open-note-btn" onclick="openNotes('note')" title="打开笔记" style="background:#d4f4dd;color:#1c4532;font-weight:600;">📝 笔记</button>
  <span class="title inline-stats trans-count note-count">{en_title} / {cn_title}<span><span title="已修改的中文段落数">✏️译<span id="trans-count"></span></span> <span title="标注数量">📌<span id="note-count"></span></span></span></span>
  <div class="toolbar-right">
    <span class="toolbar-clock-area">
      <span class="toolbar-clock" id="toolbar-clock"></span>
      <span class="toolbar-timer" id="session-timer" title="本次阅读时长"></span>
      <span class="toolbar-total" id="total-timer" title="累计阅读时长"></span>
    </span>
    <button class="toolbar-btn arrow" id="menu-right-btn" onclick="toggleMenu('right')" title="工具 / 导出 / 导航">工具 <span>▾</span></button>
  </div>
  <!-- Old menu-left/menu-right containers: removed by buildMenus() at runtime, replaced with 视图/考试/数据/工具 -->
  <div class="menu-dropdown left" id="menu-left">
    <div class="menu-section-label">字号</div>
    <div class="menu-size-row"><button onclick="changeSize(-1)">A−</button><span class="size-display" id="size-display">16px</span><button onclick="changeSize(1)">A+</button></div>
    <div class="menu-sep"></div>
    <div class="menu-section-label">主题</div>
    <button class="btn-icon btn-label" onclick="setTheme('green')"><span>🌿</span><span>绿金</span></button><button class="btn-icon btn-label" onclick="setTheme('light')"><span>☀</span><span>亮色</span></button>
    <button class="btn-icon btn-label" onclick="setTheme('dark')"><span>🌙</span><span>暗色</span></button><button class="btn-icon btn-label" onclick="setTheme('system')"><span>⚙</span><span>系统</span></button>
  </div>
  <div class="menu-dropdown right" id="menu-right"></div>
</div>

<div class="search-panel" id="search-panel">
  <input type="text" id="search-input" placeholder="搜索 / Search… (Enter 下一个, Shift+Enter 上一个)" autocomplete="off" spellcheck="false">
  <span class="search-info" id="search-info"></span>
  <button onclick="searchNav(-1)" title="上一个 (Shift+Enter)">▲</button>
  <button onclick="searchNav(1)" title="下一个 (Enter)">▼</button>
  <button onclick="toggleSearch()" title="关闭搜索">✕</button>
</div>

<div class="crossref-panel" id="crossref-panel">
  <div class="crossref-header">
    <h3>🔗 本文与其他文章的关联</h3>
    <button onclick="toggleCrossRef()">✕</button>
  </div>
  <div class="crossref-body" id="crossref-body"></div>
</div>

<div class="header">
  <div class="title-block">
    <div class="meta">{en_sub} &nbsp;·&nbsp; {cn_sub}</div>
    <h1>{en_title}</h1>
    <h1 class="cn">{cn_title}</h1>
    <p class="author">{en_author}</p>
    <p class="author cn">{cn_author}</p>
  </div>
  <div class="thesis-block">
    <span class="label">📌 文章主旨 / Thesis <span style="font-weight: 400; text-transform: none;">（可点击编辑）</span></span>
    <ol>{thesis_html}</ol>
  </div>
{art_block}</div>

<div class="main-wrap">
  <div class="col">
    <div class="col-header">
      <span class="lang-tag">EN</span>
      <h1>{en_title}</h1>
      <div class="col-actions"></div>
    </div>
    <div class="col-body en">
      {en_body}
    </div>
  </div>

  <div class="col summary-col">
    <div class="col-header">
      <span class="lang-tag" style="background: #8a6d3b;">概要</span>
      <h1>各段概要</h1>
      <div class="col-actions"></div>
    </div>
    <div class="col-body">
      {para_sum_html}
    </div>
  </div>

  <div class="col">
    <div class="col-header">
      <span class="lang-tag cn">中</span>
      <h1>{cn_title}</h1>
      <div class="col-actions"></div>
    </div>
    <div class="col-body cn">
      {cn_body}
    </div>
  </div>
</div>

<aside class="notes-section">
  <header>
    <h3>📚 笔记与生词</h3>
    <div class="actions">
      <button onclick="resetSummary()" title="重置概要为默认">↺ 概要</button>
      <button onclick="resetTranslation()" title="重置中文翻译为默认">↺ 译</button>
      <button onclick="clearAllAnnotations()" title="清空标注">🗑</button>
      <button onclick="resetAll()" title="清空所有数据">⚠</button>
      <button onclick="extractVocab()" title="一键提取生词和解释到剪贴板" style="background:#e8f5e9;border-color:#81c784;">📋 提取</button>
      <button class="close-notes" onclick="toggleNotes()" title="关闭/展开笔记面板" style="color: var(--cn-tag);">× 关</button>
    </div>
  </header>
  <div class="notes-list" id="notes-list"></div>
</aside>

<div class="float-menu" id="float-menu">
  <button data-act="vocab" title="生词">📖</button>
  <button data-act="unclear" title="不懂">❓</button>
  <button data-act="note" title="备注">💡</button>
  <button data-act="copy" title="复制">📋</button>
</div>

<script src="accesslog_hook.js?v=3"></script><script src="reader.js"></script>

</body>
</html>
"""


# Old main() removed; CLI main is defined near the top of this file.


if __name__ == '__main__':
    main()

