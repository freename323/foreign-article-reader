"""Common utilities shared by extract / verify / gen_summaries scripts.

Extracted from duplicate code in:
  - extract_paragraphs.py
  - verify_alignment.py
  - gen_summaries.py
"""
import re


# Bio paragraph detection patterns (EN + CN)
BIO_PATTERNS = [
    re.compile(r'^(Mr\.|Ms\.|Mrs\.|Dr\.|Prof\.|Sir)\s'),
    re.compile(r'\bis a (professor|journalist|founder|columnist|member|writer|contributor|economist)\b'),
    re.compile(r'\bworked at\b', re.IGNORECASE),
    re.compile(r'^[\u4e00-\u9fa5\s]*(先生|女士|教授|博士|记者|专栏|撰稿人)'),
    re.compile(r'是.{0,15}(教授|博士|记者|专栏|撰稿人|创始人)'),
    re.compile(r'《.{1,20}》.{0,3}撰稿人'),
]


def is_bio(text):
    """Return True if the paragraph looks like an author bio."""
    text = text.strip()
    if not text:
        return False
    for p in BIO_PATTERNS:
        if p.search(text):
            return True
    return False


def get_paras(body):
    """Extract (pid, idx, text) tuples from a body HTML string.

    Matches <p id="para-N" data-para-idx="M">...</p>.
    If data-para-idx is missing, idx falls back to id (for legacy data).
    """
    out = []
    for m in re.finditer(
        r'<p[^>]*?id="para-(\d+)"[^>]*?(?:data-para-idx="(\d+)")?[^>]*>(.*?)</p>',
        body, re.DOTALL,
    ):
        pid = int(m.group(1))
        idx = int(m.group(2)) if m.group(2) else pid
        text = re.sub(r'<[^>]+>', '', m.group(3))
        text = text.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&#39;', "'").replace('&quot;', '"')
        text = re.sub(r'\s+', ' ', text).strip()
        out.append((pid, idx, text))
    return out


def html_escape(s):
    """Escape special HTML characters."""
    return (str(s)
            .replace('&', '&amp;')
            .replace('<', '&lt;')
            .replace('>', '&gt;')
            .replace('"', '&quot;')
            .replace("'", '&#39;'))


def first_sentence(text, lang='en'):
    """Extract the first sentence from a paragraph."""
    text = text.strip()
    if not text:
        return ''

    if lang == 'en':
        m = re.search(r'^(.+?[.!?])(?:\s+[A-Z]|$)', text, re.DOTALL)
        if m:
            return m.group(1).strip()
        return text[:200].strip() + ('...' if len(text) > 200 else '')
    else:  # cn
        m = re.search(r'^(.+?[。！？])', text, re.DOTALL)
        if m:
            return m.group(1).strip()
        return text[:80].strip() + ('...' if len(text) > 80 else '')
