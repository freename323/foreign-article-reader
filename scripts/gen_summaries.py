"""Generate per-paragraph summaries (first-sentence extraction) + 3-sentence thesis.

Output goes into the article dict and updates _articles.json in place.

Usage:
    python gen_summaries.py --data _articles.json --thesis-file thesis.txt
    python gen_summaries.py --data _articles.json --auto-thesis
"""
import argparse
import json
import sys
from pathlib import Path

from common import is_bio, get_paras, first_sentence


def gen_summaries_for_article(art, auto_thesis=False, auto_thesis_lines=None):
    """Generate para_summaries and thesis for one article. Returns updated article dict."""
    en_paras = get_paras(art.get('en_body', ''))
    cn_paras = get_paras(art.get('cn_body', ''))

    if len(en_paras) != len(cn_paras):
        raise ValueError(
            f"EN has {len(en_paras)} paras, CN has {len(cn_paras)}. "
            f"Run verify_alignment.py first to find the mismatch."
        )

    n = len(en_paras)
    bio_idx = None
    for pid, idx, text in en_paras:
        if is_bio(text):
            bio_idx = idx
            break

    # Build para_summaries: skip bio
    summaries = []
    for pid, idx, en_text in en_paras:
        if bio_idx and idx == bio_idx:
            continue
        cn_text = next((t for _pid, ix, t in cn_paras if ix == idx), '')
        en_sum = first_sentence(en_text, 'en')
        cn_sum = first_sentence(cn_text, 'cn')
        summaries.append([en_sum, cn_sum])

    art['para_summaries'] = summaries

    # Thesis
    if auto_thesis and not art.get('thesis'):
        # Auto-generate placeholder thesis (USER should overwrite)
        art['thesis'] = [
            f'【待填】主旨句 1（用一句话概括文章核心论点）',
            f'【待填】主旨句 2（解释为什么这论点重要）',
            f'【待填】主旨句 3（说明文章的关键证据或框架）',
        ]
    elif auto_thesis_lines:
        # Override from file
        if len(auto_thesis_lines) >= 3:
            art['thesis'] = auto_thesis_lines[:3]
        else:
            print(f"WARN: thesis file has {len(auto_thesis_lines)} lines, expected 3. Using existing.", file=sys.stderr)
    elif not art.get('thesis'):
        art['thesis'] = [
            '【待填】主旨句 1',
            '【待填】主旨句 2',
            '【待填】主旨句 3',
        ]

    return art


def main():
    parser = argparse.ArgumentParser(description='Generate per-paragraph summaries + thesis for _articles.json')
    parser.add_argument('--data', required=True, help='Path to _articles.json')
    parser.add_argument('--out', help='Output path (default: overwrite --data in place)')
    parser.add_argument('--auto-thesis', action='store_true', help='Auto-generate placeholder thesis')
    parser.add_argument('--thesis-file', help='Path to a 3-line file with thesis sentences (one per line)')
    args = parser.parse_args()

    fp = Path(args.data)
    if not fp.exists():
        print(f"ERROR: file not found: {fp}", file=sys.stderr)
        sys.exit(1)

    thesis_lines = None
    if args.thesis_file:
        t_fp = Path(args.thesis_file)
        if not t_fp.exists():
            print(f"ERROR: thesis file not found: {t_fp}", file=sys.stderr)
            sys.exit(1)
        thesis_lines = [l.strip() for l in t_fp.read_text(encoding='utf-8').splitlines() if l.strip()]

    arts = json.loads(fp.read_text(encoding='utf-8'))
    print(f"Generating summaries for {len(arts)} article(s)")

    for i, art in enumerate(arts):
        title = art.get('en_title') or art.get('cn_title') or f'article[{i}]'
        print(f"\n[{i + 1}] {title[:60]}")
        try:
            art = gen_summaries_for_article(art, auto_thesis=args.auto_thesis, auto_thesis_lines=thesis_lines)
            print(f"  para_summaries: {len(art['para_summaries'])} items")
            print(f"  thesis: {len(art['thesis'])} sentences")
            for j, t in enumerate(art['thesis'], 1):
                print(f"    {j}. {t[:60]}{'...' if len(t) > 60 else ''}")
        except ValueError as e:
            print(f"  ERROR: {e}")
            sys.exit(1)

    out_fp = Path(args.out) if args.out else fp
    out_fp.write_text(json.dumps(arts, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"\nWrote {out_fp}")
    print("\n*** REMINDER: thesis is hand-written by you, not auto-generated. ***")
    print("*** Open _articles.json and replace the 【待填】 lines with your own 3-sentence summary. ***")


if __name__ == '__main__':
    main()
