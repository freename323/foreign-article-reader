"""Concatenate src/js/*.js module files into src/reader.js.

The modules are split by functional region but share one IIFE scope,
so they must be concatenated in order (00-head.js first, 10-toolbar.js last).

Usage:
    python scripts/concat_reader.py
    python scripts/concat_reader.py --check   # verify only, don't write
"""
import argparse
import sys
from pathlib import Path

JS_DIR = Path(__file__).resolve().parent.parent / 'src' / 'js'
OUTPUT = Path(__file__).resolve().parent.parent / 'src' / 'reader.js'

# Must be in dependency order (00 first, 10 last)
MODULES = [
    '00-head.js',
    '01-settings.js',
    '02-content.js',
    '03-notes.js',
    '04-scroll.js',
    '05-export.js',
    # '06-exam.js' — now lazy-loaded as exam-panel.js via window.__exam bridge
    '07-wordfreq.js',
    '08-search.js',
    '09-reading.js',
    '10-newspaper.js',   # 报纸版阅读模式（电子报 + 翻版）
    '11-insights.js',    # 精读分析台（错题本 / 能力雷达 / 段落功能 / 生词网络）
    '12-dictation.js',   # F11 中译英默写（看着中文默写英文，LCS 逐词比对 + 错词本）
    '10-toolbar.js',     # ⚠ 必须留在最后：它闭合 IIFE（})();）并定义 window.__reader 桥
]


def concat():
    parts = []
    for name in MODULES:
        p = JS_DIR / name
        if not p.exists():
            print(f"ERROR: missing module {p}", file=sys.stderr)
            sys.exit(1)
        parts.append(p.read_text(encoding='utf-8'))
    return '\n'.join(parts)


def main():
    parser = argparse.ArgumentParser(description='Concatenate reader.js modules')
    parser.add_argument('--check', action='store_true', help='Verify concatenation matches output, don\'t write')
    args = parser.parse_args()

    result = concat()

    if args.check:
        if not OUTPUT.exists():
            print(f"ERROR: {OUTPUT} does not exist", file=sys.stderr)
            sys.exit(1)
        existing = OUTPUT.read_text(encoding='utf-8')
        if result == existing:
            print(f"OK: concatenation matches {OUTPUT.name} ({len(result)} bytes, {len(MODULES)} modules)")
        else:
            print(f"MISMATCH: concatenation differs from {OUTPUT.name}", file=sys.stderr)
            # Find first difference
            for i, (a, b) in enumerate(zip(result.split('\n'), existing.split('\n'))):
                if a != b:
                    print(f"  First diff at line {i+1}:")
                    print(f"    concat: {a[:80]}")
                    print(f"    file:   {b[:80]}")
                    break
            sys.exit(1)
    else:
        OUTPUT.write_text(result, encoding='utf-8')
        print(f"Wrote {OUTPUT}: {len(result)} bytes from {len(MODULES)} modules")


if __name__ == '__main__':
    main()
