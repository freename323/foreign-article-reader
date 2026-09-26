#!/usr/bin/env python3
"""
给 articles/*.html 里的本地 css/js 引用自动加上 ?v=<资源文件mtime> 缓存戳。
资源文件一改动，版本号就变，浏览器必然重新拉取，避免「改了代码但页面还是旧的」。
可反复运行（幂等）：已有 ?v= 的会被更新为当前 mtime。
"""
import pathlib, re, sys

ART = pathlib.Path(__file__).resolve().parent.parent / 'articles'

# 匹配 src="x.js" / href="x.css"，允许已经带 ?v=... 或 #...
PAT = re.compile(r'(?P<attr>\b(?:src|href))="(?P<name>[^"?#/\\]+\.(?:js|css))(?:\?v=[^"#]*)?"')

# 版本组：exam-panel.js / wordfreq.js 是「懒加载脚本」——HTML 里没有它们的 <script>，
# 由 reader.js 在运行期按自己的 ?v= 动态插入（见 src/js/00-head.js 的 ASSET_V）。
# 因此它们必须与 reader.js / reader.css 共用同一个版本戳：
# 否则单独改动 exam-panel.js 时 reader.js 的 ?v= 不变 → 懒加载 URL 不变 → 浏览器继续用旧缓存。
VERSION_GROUP = ['reader.js', 'reader.css', 'exam-panel.js', 'wordfreq.js']

def main():
    assets = {p.name: int(p.stat().st_mtime) for p in ART.iterdir()
              if p.is_file() and p.suffix in ('.js', '.css')}
    if not assets:
        print('no assets found'); return 1

    group_stamp = max((assets[n] for n in VERSION_GROUP if n in assets), default=None)
    if group_stamp:
        for n in VERSION_GROUP:
            if n in assets:
                assets[n] = group_stamp

    htmls = sorted(ART.glob('*.html'))
    total_files = 0
    total_refs = 0
    for h in htmls:
        src = h.read_text(encoding='utf-8')
        hits = []

        def repl(m):
            name = m.group('name')
            if name not in assets:
                return m.group(0)          # 外部资源（CDN 等）不动
            hits.append(name)
            return f'{m.group("attr")}="{name}?v={assets[name]}"'

        new = PAT.sub(repl, src)
        if new != src:
            h.write_text(new, encoding='utf-8')
            total_files += 1
            total_refs += len(hits)
    print(f'stamped {total_refs} refs across {total_files} html files')
    for n, v in sorted(assets.items()):
        print(f'  {n} -> v={v}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
