#!/usr/bin/env node
/**
 * sync_page_scripts.js — 把练习页脚本（版本管理源在 scripts/pages/）同步到 articles/。
 *
 * 背景（T11）：cloze.js / newtype.js / translation.js / exam.js 是四个练习页的运行器，
 * 过去只存在于 articles/（gitignore，不进版本库）——本地的手工修改一旦重建就丢失。
 * 现在源码收编在 scripts/pages/（git 跟踪），articles/ 里的是同步产物。
 *
 * 用法: node scripts/sync_page_scripts.js
 * 幂等：以 scripts/pages/ 为准单向覆盖。练习页 HTML 引用的是 articles/ 下的文件名。
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, 'pages');
const OUT = path.resolve(__dirname, '..', 'articles');

['cloze.js', 'newtype.js', 'translation.js', 'exam.js'].forEach(f => {
  const src = path.join(SRC, f);
  if (!fs.existsSync(src)) { console.log('⚠ 源缺失，跳过: ' + f); return; }
  fs.copyFileSync(src, path.join(OUT, f));
  console.log('✓ ' + f + ' -> articles/ (' + (fs.statSync(src).size / 1024).toFixed(1) + ' KB)');
});
console.log('--- 同步完成（源: scripts/pages/，git 跟踪）---');
