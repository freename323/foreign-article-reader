"""EN/CN 对齐校验（等效 verify_alignment.py 的成品 HTML 版，规则来自 SKILL.md Step 3）：
  硬规则：EN 与 CN 段数相等；para id 与 data-para-idx 均为 1..N 连续且 EN/CN 一一对应
  软规则：末段应呈 bio 形态（不通过仅 WARN——成品 HTML 无显式 bio 标记）
属性解析基于字典，兼容任意属性顺序。CN 段判定：class 含 cn-translatable，或
data-para-num 为 CJK（罗马数字=EN，中文数字=CN）。
用法：python scripts/check_alignment_html.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ART = ROOT / 'articles'
TAG = re.compile(r'<p\b[^>]*\bid="para-\d+"[^>]*>')
ATTR = re.compile(r'([\w:-]+)\s*=\s*"([^"]*)"')
LAST_P = re.compile(r'<p id="para-[^"]*"[^>]*>(.*?)</p>', re.S)
BIO = re.compile(r'^(Mr\.|Ms\.|Mrs\.|Dr\.|Prof\.|[A-Z][\w.\- ]{2,40}|[\u4e00-\u9fa5]{0,12})(先生|女士|教授|博士|作者|记者|是)')
CJK = re.compile(r'[\u4e00-\u9fa5]')


def para_split(body):
    """返回 (en, cn, classes)；每项为 (id_num, idx_num) 升序无关原序。"""
    en, cn, classes = [], [], set()
    for tag in TAG.findall(body):
        d = dict(ATTR.findall(tag))
        num = int(re.match(r'para-(\d+)$', d.get('id', '')).group(1))
        idx = int(d.get('data-para-idx', '0'))
        cls = d.get('class', '')
        classes.add(cls)
        if 'cn-translatable' in cls or CJK.search(d.get('data-para-num', '')):
            cn.append((num, idx))
        else:
            en.append((num, idx))
    return en, cn, classes


def main():
    files = sorted(ART.glob('*_EN-CN_final.html'))
    fails, warns = 0, 0
    for f in files:
        body = f.read_text(encoding='utf-8')
        en, cn, classes = para_split(body)
        en_ids = [a for a, b in en]
        cn_ids = [a for a, b in cn]
        en_idx = sorted(b for a, b in en)
        cn_idx = sorted(b for a, b in cn)
        n = len(en)
        problems = []
        if n == 0 or len(cn) == 0:
            problems.append(f'段提取失败（class 值：{sorted(classes)!r}）')
        if len(en) != len(cn):
            problems.append(f'EN {len(en)} 段 != CN {len(cn)} 段')
        if en_ids != cn_ids:
            problems.append('EN/CN para id 序列不一致')
        if en_idx != list(range(1, n + 1)):
            problems.append(f'EN data-para-idx 不连续 1..{n}')
        if cn_idx != list(range(1, len(cn) + 1)):
            problems.append(f'CN data-para-idx 不连续 1..{len(cn)}')
        if en_ids != sorted(en_ids) or cn_ids != sorted(cn_ids):
            problems.append('para id 非升序')
        warnmsgs = []
        last = LAST_P.findall(body)
        if last:
            plain = re.sub(r'<[^>]+>', '', last[-1]).strip()
            if plain and not BIO.match(plain):
                warnmsgs.append('末段不像 bio：' + plain[:30])
        name = f.name[:44]
        if problems:
            fails += 1
            print(f'FAIL {name}: ' + '；'.join(problems))
        else:
            if warnmsgs:
                warns += 1
            print(f'PASS {name}: {n} 段，id/idx 连续一致' + ('  [WARN] ' + '；'.join(warnmsgs) if warnmsgs else ''))
    print(f'\n{len(files) - fails}/{len(files)} 篇硬规则通过，{warns} 篇有 bio 软警告')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
