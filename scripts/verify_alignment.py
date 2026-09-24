"""Verify EN/CN paragraph alignment in _articles.json.

Checks (per article):
- EN/CN paragraph counts equal
- data-para-idx is 1..N continuous (no gaps, no duplicates)
- bio paragraph detected at end (matches Mr./Ms./Dr./Prof. or 是 撰稿人)
- para_summaries count == paragraph count - 1 (skips bio)

Usage:
    python verify_alignment.py --data _articles.json
    python verify_alignment.py --data _articles.json --strict
"""
import argparse
import json
import sys
from pathlib import Path

from common import is_bio, get_paras


def check_article(art, strict=False):
    """Check one article; return list of error/warning strings."""
    issues = []

    # 1. Counts
    en_paras = get_paras(art.get('en_body', ''))
    cn_paras = get_paras(art.get('cn_body', ''))
    if len(en_paras) != len(cn_paras):
        issues.append(f"COUNTS MISMATCH: EN has {len(en_paras)} paras, CN has {len(cn_paras)}")
        if strict:
            return issues

    n = len(en_paras)
    if n == 0:
        issues.append("NO PARAGRAPHS found in en_body")
        return issues

    # 2. ID continuity
    en_ids = [p[0] for p in en_paras]
    cn_ids = [p[0] for p in cn_paras]
    expected = list(range(1, n + 1))
    if en_ids != expected:
        issues.append(f"EN ids not 1..{n} continuous: {en_ids}")
    if cn_ids != expected:
        issues.append(f"CN ids not 1..{n} continuous: {cn_ids}")

    # 3. IDX continuity (the most critical check)
    en_idxs = [p[1] for p in en_paras]
    cn_idxs = [p[1] for p in cn_paras]
    if en_idxs != expected:
        from collections import Counter
        c = Counter(en_idxs)
        dups = [k for k, v in c.items() if v > 1]
        if dups:
            issues.append(f"EN idx DUPLICATES: {dups}")
        missing = sorted(set(expected) - set(en_idxs))
        if missing:
            issues.append(f"EN idx MISSING: {missing}")
    if cn_idxs != expected:
        from collections import Counter
        c = Counter(cn_idxs)
        dups = [k for k, v in c.items() if v > 1]
        if dups:
            issues.append(f"CN idx DUPLICATES: {dups}")
        missing = sorted(set(expected) - set(cn_idxs))
        if missing:
            issues.append(f"CN idx MISSING: {missing}")

    # 4. Bio detection
    en_texts = [p[2] for p in en_paras]
    cn_texts = [p[2] for p in cn_paras]
    en_bio_idx = None
    cn_bio_idx = None
    for i, t in enumerate(en_texts):
        if is_bio(t):
            en_bio_idx = i + 1  # 1-based
            break
    for i, t in enumerate(cn_texts):
        if is_bio(t):
            cn_bio_idx = i + 1
            break

    if en_bio_idx is None and n > 1:
        issues.append("WARN: no bio paragraph detected in EN (last paragraph should be bio)")
    if cn_bio_idx is None and n > 1:
        issues.append("WARN: no bio paragraph detected in CN")
    if en_bio_idx and cn_bio_idx and en_bio_idx != cn_bio_idx:
        issues.append(f"BIO MISMATCH: EN bio at P{en_bio_idx}, CN bio at P{cn_bio_idx}")
    elif en_bio_idx:
        # 5. para_summaries count == n - 1 (if bio at end)
        n_sums = len(art.get('para_summaries', []))
        expected_sums = n - 1 if en_bio_idx == n else n
        if n_sums != expected_sums:
            issues.append(f"para_summaries count: got {n_sums}, expected {expected_sums} ({n} paras - {1 if en_bio_idx == n else 0} bio)")

    # 6. Class check for CN
    cn_body = art.get('cn_body', '')
    cn_translatable_count = cn_body.count('cn-translatable')
    if cn_translatable_count < n:
        issues.append(f"WARN: CN has only {cn_translatable_count} 'cn-translatable' class instances, expected {n}")

    return issues


def main():
    parser = argparse.ArgumentParser(description='Verify EN/CN paragraph alignment in _articles.json')
    parser.add_argument('--data', required=True, help='Path to _articles.json')
    parser.add_argument('--strict', action='store_true', help='Stop on first error')
    args = parser.parse_args()

    fp = Path(args.data)
    if not fp.exists():
        print(f"ERROR: file not found: {fp}", file=sys.stderr)
        sys.exit(1)

    arts = json.loads(fp.read_text(encoding='utf-8'))
    print(f"Verifying {len(arts)} article(s) in {fp.name}")
    print("=" * 70)

    total_issues = 0
    for i, art in enumerate(arts):
        title = art.get('en_title') or art.get('cn_title') or f'article[{i}]'
        print(f"\n[{i + 1}] {title[:60]}")
        print("-" * 70)
        issues = check_article(art, strict=args.strict)
        if not issues:
            print("  [OK] All checks pass")
        else:
            for issue in issues:
                tag = "ERR " if not issue.startswith("WARN") else "WARN"
                print(f"  [{tag}] {issue}")
                total_issues += 1

    print()
    print("=" * 70)
    if total_issues == 0:
        print("ALL ARTICLES PASS")
        sys.exit(0)
    else:
        print(f"FOUND {total_issues} issue(s)")
        sys.exit(1)


if __name__ == '__main__':
    main()
