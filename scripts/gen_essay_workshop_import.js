#!/usr/bin/env node
/**
 * gen_essay_workshop_import.js — 把「英语作文包_20260930」的范文转换成写作工坊的模板导入 JSON。
 *
 * 用法: node scripts/gen_essay_workshop_import.js [作文包目录] [输出文件]
 *   默认目录: <项目根>/英语作文包_20260930/英语作文包_20260930/1_作文(md)
 *   默认输出: <项目根>/英语作文包_20260930/作文包_写作工坊导入.json
 *
 * 映射规则（格式见 references/作文模板导入说明.md）：
 *   - 每篇大作文范文 → readings[] 一条（v36：工坊「📚 范文」页签按日期阅读，不再做成写作框架）
 *     · 「### 大作文练习」节的 ①②③ 三段式 → 规范稿（同日排最前，段落带 段名/角色/字数）
 *     · 「### 范文练习」节的 Article 1/2/…（CET-6/考研风格）→ 全部保留，各自一条
 *   - 每封小作文 → 按类型（建议信/投诉信/邀请信…）归入 small[] 对应条目的 samples[]
 *   - small[] 必须带全 10 个内置类型（含 format/structure）：工坊合并基底只含「已导入」内容，
 *     只导 3 个类型会把另外 7 个内置类型挤掉（essayTemplates 用 stored 整体替代内置）。
 *   - 逐词对照表格（| 开头的行）与「### 用词对照」节剥除；20260911 是 HTML 版式，跳过。
 *
 * 导入路径：文章页 → 考试 → 写作 → 写作工坊 → ⬇ 模板导入 → 从文件读取 → 解析并合并。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PKG = path.resolve(ROOT, '英语作文包_20260930');
const DIR = process.argv[2] ? path.resolve(process.argv[2]) : path.join(PKG, '英语作文包_20260930', '1_作文(md)');
const OUT = process.argv[3] ? path.resolve(process.argv[3]) : path.join(PKG, '作文包_写作工坊导入.json');

// ===== 内置骨架（与 src/js/06-exam.js 的 BUILTIN_BIG / BUILTIN_SMALL 逐字一致）=====
// small[] 必须自带这 10 条：见上方「为什么」注释。
const BUILTIN_BIG = [
  {
    id: 'big_three',
    title: '三段式通用框架（图画/图表作文）',
    topic: '',
    note: '骨架：只给槽位与写作任务，开头句式与范文请从「模板导入」页签导入。',
    slots: [
      { key: 'p1', label: '第一段·图画描述', role: '描述', words: '60-80',
        tip: '一句总体描述 + 两句细节。用现在时，注意图中的人/物/动作/文字。', starters: [] },
      { key: 'p2', label: '第二段·寓意揭示与论证', role: '论证', words: '120-150',
        tip: '先一句点出寓意，再用「原因 / 影响 / 例证」中的一种展开。', starters: [] },
      { key: 'p3', label: '第三段·观点与建议', role: '结论', words: '40-60',
        tip: '表明态度 + 给出 1-2 条可操作建议，不要泛泛而谈。', starters: [] }
    ]
  }
];
const BUILTIN_SMALL = [
  { id: 'small_suggestion', type: 'suggestion', name: '建议信', format: '称呼 + 正文 + 落款', structure: ['写信目的', '具体建议（2-3 条）', '期望回复'], openings: [], closings: [], samples: [] },
  { id: 'small_complaint', type: 'complaint', name: '投诉信', format: '称呼 + 正文 + 落款', structure: ['说明问题', '造成的影响', '期望的处理方式'], openings: [], closings: [], samples: [] },
  { id: 'small_invitation', type: 'invitation', name: '邀请信', format: '称呼 + 正文 + 落款', structure: ['邀请事由', '时间地点与安排', '期待回复'], openings: [], closings: [], samples: [] },
  { id: 'small_thanks', type: 'thanks', name: '感谢信', format: '称呼 + 正文 + 落款', structure: ['致谢事由', '对方的帮助带来的影响', '再次致谢'], openings: [], closings: [], samples: [] },
  { id: 'small_apology', type: 'apology', name: '道歉信', format: '称呼 + 正文 + 落款', structure: ['致歉事由', '解释原因', '补救措施'], openings: [], closings: [], samples: [] },
  { id: 'small_recommend', type: 'recommend', name: '推荐信', format: '称呼 + 正文 + 落款', structure: ['推荐对象', '推荐理由（2-3 条）', '期待采纳'], openings: [], closings: [], samples: [] },
  { id: 'small_application', type: 'application', name: '求职信', format: '称呼 + 正文 + 落款', structure: ['应聘职位来源', '资格与经历', '期待面试'], openings: [], closings: [], samples: [] },
  { id: 'small_notice', type: 'notice', name: '通知', format: '标题 + 正文 + 署名与日期', structure: ['事由', '时间地点参与方式', '联系人与要求'], openings: [], closings: [], samples: [] },
  { id: 'small_announcement', type: 'announcement', name: '告示', format: '标题 + 正文 + 署名与日期', structure: ['公告事项', '具体要求', '联系方式'], openings: [], closings: [], samples: [] },
  { id: 'small_memo', type: 'memo', name: '备忘录', format: 'To / From / Date / Subject + 正文', structure: ['事由', '要点（分条）', '后续动作'], openings: [], closings: [], samples: [] }
];

// ===== 文本工具 =====
const stripBold = (s) => s.replace(/\*\*/g, '').trim();
const cleanPara = (s) => stripBold(s.replace(/\s+/g, ' '));
const truncate = (s, n) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s);
const firstSentence = (s) => {
  const parts = s.split(/(?<=[.!?])\s+(?=[A-Z"'])/);
  return truncate(parts[0] || s, 120);
};
// 小作文类型名 → 内置条目（按前缀匹配：如「邀请信 · 请求索取桶」→ 邀请信）
function matchSmallType(name, small) {
  const n = name.trim();
  return small.find(t => n.startsWith(t.name) || t.name.startsWith(n)) || null;
}
const ROLE_OF_LABEL = (label) => /描述/.test(label) ? '描述' : (/阐释|论证|意义/.test(label) ? '论证' : (/总结|展望|结论|建议/.test(label) ? '结论' : ''));
const WORDS_OF_IDX = ['60-80', '120-150', '40-60'];

// ===== 单篇大作文范文 → readings[] 条目（v36：范文走独立页签，不再做成写作框架）=====
function makeReading(date, dateStr, essay, orderTag) {
  const paragraphs = essay.paragraphs.map(cleanPara).filter(Boolean);
  if (!paragraphs.length) return null;
  const title = essay.title || '外刊范文';
  return {
    id: 'read_' + date + '_' + orderTag,
    date: dateStr,
    title: dateStr + ' · ' + truncate(title, 42),
    topic: essay.topic || '',
    note: truncate(essay.note || '', 90),
    paragraphs: paragraphs.map((p, i) => {
      const m = essay.marked && essay.marks[i];
      const label = m ? m.label : '第' + '一二三四五六'[i] + '段';
      const role = m ? (ROLE_OF_LABEL(m.label) || '') : (['描述', '论证', '结论'][i] || '');
      return { label: label, role: role, words: WORDS_OF_IDX[i] || '', text: p };
    })
  };
}

// ===== 解析一个 md 文件 =====
function parseFile(file) {
  const date = file.match(/(\d{8})\.md$/)[1];
  const dateStr = date.slice(0, 4) + '/' + date.slice(4, 6) + '/' + date.slice(6, 8);
  const raw = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/\r\n/g, '\n');
  const src = (raw.match(/^>\s*\*\*来源\*\*：(.+)$/m) || [])[1] || '';
  const noteBase = stripBold(src).replace(/（配套单词[：:]?[^）]*）?$/, '').trim() || '外刊阅读';

  // 按 ### 切节（# 主标题 + > 引言行丢进前言）
  const sections = []; // { header, body }
  let cur = { header: '', body: [] };
  for (const line of raw.split('\n')) {
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) { if (cur.body.length || cur.header) sections.push(cur); cur = { header: h[1].trim(), body: [] }; }
    else cur.body.push(line);
  }
  if (cur.body.length || cur.header) sections.push(cur);

  const bigs = [], letters = [];
  let seq = 0;

  for (const sec of sections) {
    if (/^范文练习/.test(sec.header)) {
      // Article N（风格）块：以 **Article 行分界
      const blocks = [];
      let b = null;
      for (const line of sec.body) {
        const am = line.match(/^\*\*Article\s+\d+\s*\(([^)]+)\)\*\*/);
        if (am) { if (b) blocks.push(b); b = { style: am[1].trim(), lines: [] }; continue; }
        if (b) b.lines.push(line);
      }
      if (b) blocks.push(b);
      for (const blk of blocks) {
        const essays = splitArticleBlock(blk.lines, blk.style);
        for (const e of essays) { e.note = noteBase + (blk.style ? ' · ' + blk.style : ''); const made = makeReading(date, dateStr, e, 'v' + (++seq)); if (made) bigs.push(made); }
      }
    } else if (/^大作文练习/.test(sec.header)) {
      const type = (sec.header.match(/（([^）]*)）/) || [])[1] || '';
      const topic = /图表/.test(type) ? '图表作文' : (/图画/.test(type) ? '图画作文' : type);
      const body = sec.body.join('\n');
      if (/\*\*[①②③]/.test(body)) {
        const e = parseMarkedEssay(sec.body, topic);
        e.note = noteBase;
        const made = makeReading(date, dateStr, e, 'p'); if (made) bigs.unshift(made); // 规范框架排同日最前
      } else {
        // 少见形态：大作文练习节里也是 Article 块
        const blocks = [];
        let bb = null;
        for (const line of sec.body) {
          const am = line.match(/^\*\*Article\s+\d+\s*\(([^)]+)\)\*\*/);
          if (am) { if (bb) blocks.push(bb); bb = { style: am[1].trim(), lines: [] }; continue; }
          if (bb) bb.lines.push(line);
        }
        if (bb) blocks.push(bb);
        for (const blk of blocks) {
          for (const e of splitArticleBlock(blk.lines, blk.style)) { e.note = noteBase + (blk.style ? ' · ' + blk.style : ''); const made = makeReading(date, dateStr, e, 'v' + (++seq)); if (made) bigs.push(made); }
        }
      }
    } else if (/^小作文练习/.test(sec.header)) {
      const typeName = ((sec.header.match(/（([^）]*)）/) || [])[1] || '').trim();
      const letter = extractLetter(sec.body);
      if (letter) letters.push({ typeName: typeName.split('·')[0].trim(), label: typeName, text: letter, dateStr: dateStr, note: noteBase });
    }
  }
  return { date: date, dateStr: dateStr, bigs: bigs, letters: letters };
}

// Article 块内可能有多篇（**Title 分界）；返回 [{title, paragraphs, topic, style}]
function splitArticleBlock(lines, style) {
  const essays = [];
  let cur = null;
  for (const line of lines) {
    const tm = line.match(/^\*\*Title:\s*(.+?)\s*\*\*\s*$/);
    const sep = /^-{3,}\s*$/.test(line.trim());
    if (tm) { if (cur) essays.push(cur); cur = { title: tm[1].trim(), paras: [], style: style }; continue; }
    if (sep) { if (cur && cur.paras.length) { essays.push(cur); cur = null; } continue; }
    if (/^\s*\|/.test(line)) continue; // 对照表
    if (cur) cur.paras.push(line);
  }
  if (cur) essays.push(cur);
  return essays.map(e => ({
    title: e.title,
    topic: style ? '' : '',
    paragraphs: e.paras.join('\n').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean),
    marked: false
  })).filter(e => e.paragraphs.length);
}

// ①②③ 三段式：**① 图画/现象描述段**：正文…
function parseMarkedEssay(lines, topic) {
  const marks = [];
  let cur = null;
  for (const line of lines) {
    const tm = line.match(/^\*\*Title:\s*(.+?)\s*\*\*\s*$/);
    const mm = line.match(/^\*\*([①②③④⑤])\s*([^*]*?段)\*\*[：:]\s*(.*)$/);
    if (tm) { continue; }
    if (mm) { cur = { label: mm[2].trim(), text: [mm[3]] }; marks.push(cur); continue; }
    if (/^\s*\|/.test(line)) continue;
    if (/^-{3,}\s*$/.test(line.trim())) continue;
    if (cur) cur.text.push(line);
  }
  return {
    title: (lines.join('\n').match(/\*\*Title:\s*(.+?)\s*\*\*/) || [])[1] || '图画作文',
    topic: topic,
    paragraphs: marks.map(m => m.text.join(' ')),
    marks: marks,
    marked: true
  };
}

// 小作文信件全文：到下一个节标题 / 表格 / 结尾分隔线为止
function extractLetter(lines) {
  const out = [];
  for (const line of lines) {
    if (/^#{1,4}\s/.test(line)) break;
    if (/^\s*\|/.test(line)) break;
    if (/^>{1}\s/.test(line)) continue;
    out.push(line);
  }
  return cleanPara(out.join('\n').replace(/\n-{3,}\s*$/, '').replace(/\n+/g, '\n'));
}

// ===== 主流程 =====
const files = fs.readdirSync(DIR).filter(f => /^外刊作文_\d{8}\.md$/.test(f)).sort();
const skipped = [];
const allBig = [], letters = [];
for (const f of files) {
  try {
    const r = parseFile(f);
    if (!r.bigs.length && !r.letters.length) { skipped.push(f); continue; }
    allBig.push(...r.bigs);
    letters.push(...r.letters);
  } catch (e) { skipped.push(f + ' (' + e.message + ')'); }
}

// 小作文按类型归组（深拷贝内置，避免改到常量）
const small = BUILTIN_SMALL.map(t => Object.assign({}, t, { samples: t.samples.slice() }));
let unmatched = [];
for (const L of letters) {
  const t = matchSmallType(L.typeName, small);
  if (!t) { unmatched.push(L.dateStr + ' ' + L.typeName); continue; }
  t.samples.push({ title: L.dateStr + ' · ' + truncate(L.note, 26), text: L.text });
}

// readings 排序：按日期，同日内规范稿（_p）在前
allBig.sort((a, b) => (a.date + (a.id.endsWith('_p') ? '0' : '1')).localeCompare(b.date + (b.id.endsWith('_p') ? '0' : '1')));

const out = {
  name: '英语作文包范文库（2026/04/09 ~ 2026/09/18）',
  readings: allBig,
  small: small
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');

console.log('输入文件: ' + files.length + ' 个 md');
console.log('范文条目: ' + allBig.length);
for (const t of small) if (t.samples.length) console.log('小作文「' + t.name + '」范文 ' + t.samples.length + ' 篇');
if (unmatched.length) console.log('未匹配类型的信件: ' + unmatched.join('；'));
if (skipped.length) console.log('跳过: ' + skipped.join('；'));
console.log('输出: ' + OUT + ' (' + fs.statSync(OUT).size + ' B)');

// ===== 自校验：用工坊同一套归一化逻辑跑一遍（复刻自 06-exam.js v36，勿改逻辑）=====
function asArray(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }
function pickStr(o, keys, fb) { for (let i = 0; i < keys.length; i++) { const v = o[keys[i]]; if (typeof v === 'string' && v.trim()) return v.trim(); } return fb || ''; }
function normalizeReading(x, i) {
  x = (x && typeof x === 'object') ? x : {};
  const paras = asArray(x.paragraphs || x.slots).map(p => (typeof p === 'string'
    ? { label: '', role: '', words: '', text: p }
    : { label: pickStr(p, ['label', 'name', 'title'], ''), role: pickStr(p, ['role', 'func'], ''), words: pickStr(p, ['words', 'wordCount'], ''), text: pickStr(p, ['text', 'body', 'content'], '') }))
    .filter(p => p.text);
  return { id: pickStr(x, ['id'], 'read_' + i), date: pickStr(x, ['date'], ''), title: pickStr(x, ['title', 'name'], '范文 ' + (i + 1)), topic: pickStr(x, ['topic', 'theme'], ''), note: pickStr(x, ['note', 'desc'], ''), paragraphs: paras };
}
function normalizeSmall(t, i) {
  t = (t && typeof t === 'object') ? t : {};
  const arrs = function () { let o = []; for (let a = 0; a < arguments.length; a++) { asArray(t[arguments[a]]).forEach(function (x) { if (typeof x === 'string' && x.trim()) o.push(x.trim()); }); } return o.filter(function (x, k, list) { return list.indexOf(x) === k; }); };
  return { id: pickStr(t, ['id', 'type'], 'small_' + i), type: pickStr(t, ['type', 'id'], 'type_' + i), name: pickStr(t, ['name', 'title'], '应用文 ' + (i + 1)), format: pickStr(t, ['format', 'layout'], ''), structure: arrs('structure', 'outline'), openings: arrs('openings', 'opening'), closings: arrs('closings', 'closing'), samples: asArray(t.samples || t.examples).map(s => (typeof s === 'string' ? { title: '', text: s } : { title: pickStr(s, ['title', 'name'], ''), text: pickStr(s, ['text', 'body', 'content'], '') })).filter(s => s.text) };
}
const warnings = [];
const nr = out.readings.map(normalizeReading).filter(x => x.paragraphs.length);
const ns = out.small.map(normalizeSmall);
ns.forEach(t => { if (!t.openings.length && !t.closings.length) warnings.push('小作文「' + t.name + '」没有开头/结尾套话，只导入到结构'); });
const idSet = new Set();
let dupIds = false;
for (const x of nr) { if (idSet.has(x.id)) dupIds = true; idSet.add(x.id); }
if (dupIds) warnings.push('readings 存在重复 id');
let badSort = false;
for (let i = 1; i < nr.length; i++) { if (nr[i - 1].date > nr[i].date) badSort = true; }
if (badSort) warnings.push('readings 日期非升序');
console.log('--- 自校验 ---');
console.log('normalize 后: readings ' + nr.length + ' 篇（全部带段落: ' + nr.every(x => x.paragraphs.length) + '）、small ' + ns.length + ' 条、信件范文总数 ' + ns.reduce((a, t) => a + t.samples.length, 0));
if (warnings.length) console.log('工坊会显示的提示: ' + warnings.join('；')); else console.log('无警告');
