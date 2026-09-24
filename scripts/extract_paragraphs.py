"""Extract paragraphs from a markdown or text file.

Input: EN or CN markdown (one paragraph per blank-line-separated block).
Output: JSON with `paragraphs` (list of strings) and `bio_index` (1-based, or null).

Usage:
    python extract_paragraphs.py --input article.md --lang en --out en_paras.json
    python extract_paragraphs.py --input article.md --lang en        # print to stdout
"""
import argparse
import json
import re
import sys
from pathlib import Path

from common import is_bio, html_escape


def extract_from_markdown(md_text):
    """Split markdown into paragraphs by blank lines. Strip heading marks and leading bullets."""
    # Normalize line endings
    md_text = md_text.replace('\r\n', '\n').replace('\r', '\n')
    # Split on blank lines
    blocks = re.split(r'\n\s*\n', md_text)
    paras = []
    for b in blocks:
        # Strip leading heading marks and bullets
        b = re.sub(r'^#+\s*', '', b)
        b = re.sub(r'^[\*\-]\s*', '', b, flags=re.MULTILINE)
        # Strip blockquote marks
        b = re.sub(r'^>\s*', '', b, flags=re.MULTILINE)
        # Collapse whitespace
        b = re.sub(r'[ \t]+', ' ', b)
        b = re.sub(r'\n+', ' ', b)
        b = b.strip()
        if b:
            paras.append(b)
    return paras


def make_paragraphs_html(paras, lang='en'):
    """Wrap paragraphs as <p id="para-N" data-para-idx="N">...</p>."""
    if lang == 'cn':
        out = []
        for i, t in enumerate(paras, 1):
            out.append(f'<p id="para-{i}" data-para-idx="{i}" class="cn-translatable">{html_escape(t)}</p>')
        return '\n'.join(out)
    else:
        out = []
        for i, t in enumerate(paras, 1):
            out.append(f'<p id="para-{i}" data-para-idx="{i}">{html_escape(t)}</p>')
        return '\n'.join(out)


def main():
    parser = argparse.ArgumentParser(description='Extract paragraphs from markdown and emit paragraph IDs')
    parser.add_argument('--input', '-i', required=True, help='Input markdown or text file')
    parser.add_argument('--lang', '-l', choices=['en', 'cn'], default='en', help='Language (en or cn)')
    parser.add_argument('--out', '-o', help='Output JSON file (default: stdout)')
    parser.add_argument('--format', '-f', choices=['json', 'html'], default='json',
                        help='Output format: json (with paragraphs + bio_index) or html (raw <p> tags)')
    args = parser.parse_args()

    fp = Path(args.input)
    if not fp.exists():
        print(f"ERROR: file not found: {fp}", file=sys.stderr)
        sys.exit(1)

    text = fp.read_text(encoding='utf-8')
    paras = extract_from_markdown(text)
    if not paras:
        print(f"ERROR: no paragraphs found in {fp}", file=sys.stderr)
        sys.exit(1)

    # Detect bio
    bio_index = None
    for i, t in enumerate(paras):
        if is_bio(t):
            bio_index = i + 1  # 1-based

    if args.format == 'json':
        result = {
            'source': str(fp),
            'lang': args.lang,
            'count': len(paras),
            'bio_index': bio_index,
            'paragraphs': paras,
        }
        out = json.dumps(result, ensure_ascii=False, indent=2)
        if args.out:
            Path(args.out).write_text(out, encoding='utf-8')
            print(f"Wrote {len(paras)} paragraphs (bio at P{bio_index}) to {args.out}", file=sys.stderr)
        else:
            print(out)
    else:  # html
        html = make_paragraphs_html(paras, lang=args.lang)
        if args.out:
            Path(args.out).write_text(html, encoding='utf-8')
            print(f"Wrote {len(paras)} <p> tags to {args.out}", file=sys.stderr)
        else:
            print(html)


if __name__ == '__main__':
    main()
