# -*- coding: utf-8 -*-
"""Build exam pages: questions/*/mode*.md + articles HTML -> articles/exam_<slug>.html"""
import re, json, html, os, glob, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
QDIR = os.path.join(ROOT, 'questions')
ADIR = os.path.join(ROOT, 'articles')

SLUG_TO_ARTICLE = {
    'ai_cost':       'SundayTimes_2026-06-14_Hidden_Cost_AI_Fortson_EN-CN_final.html',
    'ai_regulation': 'WSJ_2026-03-21_AI_Regulation_Fryer_EN-CN_final.html',
    'ammo_shortage': 'WSJ_2026-03-21_Ammo_Shortage_Jones_EN-CN_final.html',
    'fcc_sports':    'WSJ_2026-03-21_FCC_Sports_Jenkins_EN-CN_final.html',
    'haldane':       'SundayTimes_2026-06-14_Haldane_Chainsaw_Regulation_Treanor_EN-CN_final.html',
    'horvitz':       'Science_2026-06-04_Narrowing_Window_AI_Horvitz-West_EN-CN_final.html',
    'moral_econ':    'Science_2026-03-26_Moral_Economics_Perry_EN-CN_final.html',
    'pensions':      'SundayTimes_2026-06-14_Junior_Pensions_Filby_EN-CN_final.html',
    'pothole':       'SundayTimes_2026-06-14_Pothole_Compensation_Harwood-Baynes_EN-CN_final.html',
}

TEMPLATE = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · 考研阅读模拟</title>
<link rel="stylesheet" href="exam.css">
</head>
<body data-exam-id="{slug}">

<div class="exam-bar">
  <div class="exam-title">
    <h1>{title}</h1>
    <div class="exam-meta" id="exam-meta"></div>
  </div>
  <div class="exam-timer">
    <span class="timer-display" id="timer-display">00:00</span>
    <button id="timer-btn" title="空格键也可开始/暂停">▶ 开始</button>
    <button id="timer-reset-btn" title="重置计时">↺</button>
    <span class="timer-record" id="timer-record"></span>
    <button id="limit-btn" title="20 分钟限时训练，与主计时同步">⏳ 限时20分钟</button>
    <span class="limit-display" id="limit-display" hidden></span>
  </div>
  <span class="exam-progress" id="exam-progress">未作答</span>
  <div class="hl-group">
    <button class="hl-color-btn" data-color="hl-y" title="黄色划线"></button>
    <button class="hl-color-btn" data-color="hl-g" title="绿色划线"></button>
    <button class="hl-color-btn" data-color="hl-b" title="蓝色划线"></button>
    <button id="hl-btn" title="先选中文字，再点此按钮">✍ 划线</button>
    <button id="hl-clear-btn">清除划线</button>
  </div>
  <button id="reset-answers-btn" title="清空作答与标注">🗑 清空作答</button>
  <button id="theme-btn" title="切换主题">🌓</button>
  <div class="bar-links">
    <a href="{article}">📖 阅读模式</a>
    <a href="WSJ_Hub.html">📚 文库</a>
  </div>
</div>

<div class="exam-main">
  <div class="pane pane-article">
    <div class="article-head">
      <h2>{title}<br><span style="font-size:16px;color:var(--muted);font-weight:400;">{cn_title}</span></h2>
      <div class="byline">{byline}</div>
    </div>
    <div id="article-body">
{paras}
    </div>
  </div>
  <div class="pane pane-questions">
    <div id="q-list"></div>
  </div>
</div>

<script>
window.__EXAM_QUESTIONS__ = {qjson};
window.__EXAM_META__ = {meta_json};
window.__EXAM_ARTICLE_TITLE__ = {title_json};
</script>
<script src="exam.js"></script>
</body>
</html>
'''

def parse_questions(path):
    md = open(path, encoding='utf-8').read()
    mode_line = ''
    m = re.search(r'^-\s*模式：(.+)$', md, re.M)
    if m: mode_line = m.group(1).strip()
    blocks = re.split(r'^### 第(\d+)题', md, flags=re.M)
    # blocks: [pre, no1, body1, no2, body2, ...]
    out = []
    for i in range(1, len(blocks) - 1, 2):
        no = int(blocks[i])
        body = blocks[i + 1]
        hm = re.match(r'\s*(.*?)\s*\[难度：\s*(.+?)\s*\]\s*\n', body)
        qtype = hm.group(1).strip() if hm else ''
        diff = hm.group(2).strip() if hm else ''
        sm = re.search(r'\*\*题干\*\*：\s*(.+?)\s*\n\s*\n?\s*\*\*选项\*\*', body, re.S)
        stem = sm.group(1).strip() if sm else ''
        om = re.search(r'\*\*选项\*\*：\s*\n(.*?)\n\s*\*\*答案\*\*', body, re.S)
        options = {}
        if om:
            cur = None
            for line in om.group(1).split('\n'):
                lm = re.match(r'^([A-D])[.、]\s*(.*)$', line.strip())
                if lm:
                    cur = lm.group(1)
                    options[cur] = lm.group(2).strip()
                elif cur and line.strip():
                    options[cur] += ' ' + line.strip()
        am = re.search(r'\*\*答案\*\*：\s*([A-D])', body)
        answer = am.group(1) if am else ''
        an = re.search(r'\*\*解析\*\*：\s*\n(.*?)(?:\n---|\Z)', body, re.S)
        analysis = an.group(1).strip() if an else ''
        out.append({'no': no, 'type': qtype, 'difficulty': diff, 'stem': stem,
                    'options': options, 'answer': answer, 'analysis': analysis})
    return mode_line, out

def extract_article(path):
    h = open(path, encoding='utf-8').read()
    def q1(pattern):
        m = re.search(pattern, h, re.S)
        return html.unescape(m.group(1).strip()) if m else ''
    title = q1(r'<div class="title-block">[\s\S]*?<h1>(.*?)</h1>')
    cn = q1(r'<h1 class="cn">(.*?)</h1>')
    author = q1(r'<p class="author">(.*?)</p>').replace('By ', '')
    meta = q1(r'<div class="meta">(.*?)</div>').replace('&nbsp;', ' ').strip()
    en_block = re.search(r'<div class="col-body en">([\s\S]*?)</div>', h)
    paras = []
    if en_block:
        for pm in re.finditer(r'<p id="para-(\d+)"[^>]*data-para-idx="\1"[^>]*>([\s\S]*?)</p>', en_block.group(1)):
            paras.append((int(pm.group(1)), pm.group(2).strip()))
    return title, cn, author, meta, paras

def main():
    built = 0
    for slug, article_file in SLUG_TO_ARTICLE.items():
        mode_files = glob.glob(os.path.join(QDIR, slug, 'mode*.md'))
        if not mode_files:
            print('WARN: no question file for', slug); continue
        apath = os.path.join(ADIR, article_file)
        if not os.path.exists(apath):
            print('WARN: article missing for', slug); continue
        mode_line, questions = parse_questions(mode_files[0])
        title, cn, author, meta_src, paras = extract_article(apath)
        paras_html = '\n'.join(
            '      <p data-para-idx="%d" data-para-num="%d">%s</p>' % (i, i, text)
            for i, text in paras)
        meta = ' · '.join(x for x in [meta_src.split('·')[0].strip(), mode_line, str(len(questions)) + ' 道题'] if x)
        byline = ('By ' + author if author else '') + (' · ' + meta_src.split('·')[0].strip() if meta_src else '')
        out = TEMPLATE.format(
            slug=slug, title=html.escape(title), cn_title=html.escape(cn),
            article=article_file, byline=html.escape(byline),
            paras=paras_html,
            qjson=json.dumps(questions, ensure_ascii=False),
            meta_json=json.dumps(meta, ensure_ascii=False),
            title_json=json.dumps(title, ensure_ascii=False))
        outpath = os.path.join(ADIR, 'exam_' + slug + '.html')
        open(outpath, 'w', encoding='utf-8', newline='').write(out)
        print('built', os.path.basename(outpath), '-', len(questions), 'questions,', len(paras), 'paras')
        built += 1
    print('done:', built, 'exam pages')

if __name__ == '__main__':
    main()
