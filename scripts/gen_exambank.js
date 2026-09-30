#!/usr/bin/env node
/**
 * gen_exambank.js — 从 articles/exam_*.html 提取题目，生成跨篇题库 articles/exambank.js
 * （T02 模拟套卷的数据源；构建文章后重跑一次。articles/ 不进 git。）
 * 用法: node scripts/gen_exambank.js
 */
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(__dirname, '..', 'articles');
const OUT = path.join(DIR, 'exambank.js');

const files = fs.readdirSync(DIR).filter(f => /^exam_.+\.html$/.test(f) && f !== 'exam_paper.html');
const bank = [];
for (const f of files) {
  const html = fs.readFileSync(path.join(DIR, f), 'utf8');
  const m = html.match(/window\.__EXAM_QUESTIONS__\s*=\s*(\[[\s\S]*?\]);\s*\n/);
  if (!m) { console.log('⚠ 跳过（无题目数据）: ' + f); continue; }
  let qs;
  try { qs = JSON.parse(m[1]); } catch (e) { console.log('⚠ 解析失败: ' + f + ' — ' + e.message); continue; }
  const title = (html.match(/window\.__EXAM_ARTICLE_TITLE__\s*=\s*"([\s\S]*?)";/) || [])[1] || f;
  const meta = (html.match(/window\.__EXAM_META__\s*=\s*"([\s\S]*?)";/) || [])[1] || '';
  bank.push({
    slug: f.replace(/^exam_|\.html$/g, ''),
    file: f.replace(/\.html$/, ''),
    title: title,
    meta: meta,
    qs: qs
  });
  console.log('✓ ' + f + ' — ' + qs.length + ' 题');
}
const out = '/* 由 scripts/gen_exambank.js 生成 —— 手改会被覆盖；重跑构建后需重新生成 */\n' +
  'window.__EXAM_BANK__ = ' + JSON.stringify(bank) + ';\n';
fs.writeFileSync(OUT, out, 'utf8');
console.log('---');
console.log('✓ exambank.js: ' + bank.length + ' 篇 / ' + bank.reduce((a, b) => a + b.qs.length, 0) + ' 题 -> ' + OUT);
