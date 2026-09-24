#!/usr/bin/env python3
"""
One-way sync: articles/reader.css + articles/reader.js → scripts/build_html.py (CSS/JS blocks).
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CSS_FILE = ROOT / 'articles' / 'reader.css'
JS_FILE  = ROOT / 'articles' / 'reader.js'
BUILD    = ROOT / 'scripts' / 'build_html.py'

CSS_START = 'CSS = r"""'
JS_START  = 'JS = r"""'
END_MARKER = '"""'

def read(p): return p.read_text(encoding='utf-8')

def inject_block(source, marker, new_content):
    start = source.find(marker)
    if start < 0:
        print(f"  ERROR: '{marker}' not found", file=sys.stderr)
        return source
    content_start = start + len(marker)
    end = source.find(END_MARKER, content_start)
    if end < 0:
        print(f"  ERROR: closing '\"\"\"' not found after '{marker}'", file=sys.stderr)
        return source
    old = source[content_start:end]
    if old == new_content:
        print(f"  {marker.split('=')[0].strip()} already in sync ({len(new_content):,} chars)")
        return source
    if END_MARKER in new_content:
        print(f"  ERROR: content contains '\"\"\"' — cannot inject", file=sys.stderr)
        return source
    result = source[:content_start] + new_content + source[end:]
    print(f"  {marker.split('=')[0].strip()} synced: {len(old):,} → {len(new_content):,} chars")
    return result

def main():
    css = read(CSS_FILE)
    js  = read(JS_FILE)
    build = read(BUILD)

    build = inject_block(build, CSS_START, css)
    build = inject_block(build, JS_START, js)

    BUILD.write_text(build, encoding='utf-8')
    print(f"  Wrote {BUILD.name} ({BUILD.stat().st_size:,} bytes)")
    print("  Done.")

if __name__ == '__main__':
    main()
