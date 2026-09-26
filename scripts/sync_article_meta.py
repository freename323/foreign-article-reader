#!/usr/bin/env python3
"""同步文章 <body> 上的元数据属性（data-edition / data-has-exam / data-exam-types）。

reader.js 不再维护「文件名 -> slug」映射表，改为直接读 <body data-*>。
本脚本负责把这份属性从「文件系统事实」推导出来后写回 HTML：

  * data-edition     —— 取自文章正文文件名（EDITION_KEYS 关键字匹配），缺失则报警告；
  * data-has-exam    —— 当且仅当同目录存在 exam_<slug>.html 时写 "true"；
  * data-exam-types  —— 有考试时写默认四类题型。

幂等：可反复运行；属性齐全且正确时不改动文件。

用法:
    python scripts/sync_article_meta.py            # 写入
    python scripts/sync_article_meta.py --check    # 只检查，不写入（CI / 构建前校验）
"""
import argparse
import re
import sys
from pathlib import Path

ART = Path(__file__).resolve().parent.parent / 'articles'

EDITION_KEYS = [
    ('AI_Regulation', 'ai_regulation'), ('Hidden_Cost_AI', 'ai_cost'),
    ('Ammo_Shortage', 'ammo_shortage'), ('FCC_Sports', 'fcc_sports'),
    ('Haldane_Chainsaw', 'haldane'), ('Narrowing_Window', 'horvitz'),
    ('Moral_Economics', 'moral_econ'), ('Pensions', 'pensions'), ('Pothole', 'pothole'),
]
# 考试模式的模块清单（顺序即菜单顺序）。这串是**唯一事实来源**：
# reader.js 的「考试」菜单按它动态生成，新增一类只需在这里加一项 + 在注册表里补描述。
#   reading 阅读理解 / cloze 完形填空 / newtype 新题型 / translation 翻译练习 / writing 写作
EXAM_TYPES = 'reading,cloze,newtype,translation,writing'

BODY_RE = re.compile(r'<body\b([^>]*)>')


def edition_of(html_filename):
    for key, eid in EDITION_KEYS:
        if key in html_filename:
            return eid
    return ''


def set_attr(attrs, name, value):
    """在属性串中设置 name="value"（已存在则替换，不存在则追加）。value 为空则删除该属性。"""
    pat = re.compile(r'\s*' + re.escape(name) + r'="[^"]*"')
    if value is None:
        return pat.sub('', attrs)
    if pat.search(attrs):
        return pat.sub(' ' + name + '="' + value + '"', attrs)
    return attrs + ' ' + name + '="' + value + '"'


def main():
    ap = argparse.ArgumentParser(description='Sync <body> meta attributes on article HTML')
    ap.add_argument('--check', action='store_true', help='只检查不写入')
    args = ap.parse_args()

    if not ART.is_dir():
        print(f'ERROR: articles dir not found: {ART}', file=sys.stderr)
        return 1

    files = sorted(p for p in ART.glob('*_final.html'))
    if not files:
        print('no *_final.html found'); return 1

    warnings, changed, ok = [], 0, 0
    for p in files:
        src = p.read_text(encoding='utf-8')
        m = BODY_RE.search(src)
        if not m:
            warnings.append(f'{p.name}: 未找到 <body> 标签')
            continue

        edition = edition_of(p.name)
        if not edition:
            warnings.append(f'{p.name}: 文件名无法匹配 EDITION_KEYS，data-edition 将为空')
        has_exam = bool(edition) and (ART / f'exam_{edition}.html').exists()

        attrs = set_attr(m.group(1), 'data-edition', edition or None)
        attrs = set_attr(attrs, 'data-has-exam', 'true' if has_exam else None)
        attrs = set_attr(attrs, 'data-exam-types', EXAM_TYPES if has_exam else None)

        new = src[:m.start()] + '<body' + attrs + '>' + src[m.end():]
        if new == src:
            ok += 1
            continue
        if args.check:
            warnings.append(f'{p.name}: 属性不同步（需运行 sync_article_meta.py）')
            continue
        p.write_text(new, encoding='utf-8')
        changed += 1
        print(f'  updated {p.name}: edition={edition or "-"} hasExam={has_exam}')

    print(f'\nsync_article_meta: {len(files)} files, {changed} updated, {ok} already in sync')
    for w in warnings:
        print(f'  WARN: {w}')
    if args.check and warnings:
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
