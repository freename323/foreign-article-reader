import json, re, sys
from pathlib import Path

SRC = Path(__file__).resolve().parent / "_source"
paths = sorted(SRC.glob("*.json"))
if not paths:
    print(f"No JSON files found in {SRC}", file=sys.stderr)
    sys.exit(1)
for path in paths:
    d = json.load(open(path, "r", encoding="utf-8"))
    en_paras = d["en_paras"]
    # 取英文实质段：idx<=11 且前 50 字符全 ASCII
    en_main = [p["text"] for p in en_paras if p["idx"] <= 11 and all(ord(c) < 128 for c in p["text"][:50])]
    n_main = sum(len(re.findall(r"\S+", t)) for t in en_main)
    en_author = next(
        (p["text"] for p in en_paras if p["idx"] in (12, 9) and all(ord(c) < 128 for c in p["text"][:50])),
        "",
    )
    n_author = len(re.findall(r"\S+", en_author))
    n_para = len(en_main)
    print(f"{d['id']}: 英文实质段数={n_para}, 实质段总词数={n_main}, 含作者信息={n_main+n_author}")