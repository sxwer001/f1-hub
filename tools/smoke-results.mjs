#!/usr/bin/env node
/**
 * 成绩页（pages/results.html）结构与交互自检（jsdom）
 *
 * 运行（见 docs/PAGE-SPEC.md「验证」）：
 *   $env:F1_JSDOM_ROOT = '<你的 node 工作区>'
 *   node tools/smoke-results.mjs
 *
 * 说明：file:// 的快照请求被 shim 成本地读文件，其余请求交给 Node 原生 fetch。
 * 所有等待都用轮询（waitFor），不用固定 sleep 赌渲染时序。
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

async function loadJsdom() {
  const candidates = [
    process.env.F1_JSDOM_ROOT,
    ROOT,
  ].filter(Boolean);

  const errors = [];
  for (const base of candidates) {
    try {
      const require = createRequire(join(base, 'noop.js'));
      return require('jsdom').JSDOM;
    } catch (err) {
      errors.push(`  - ${base}: ${String(err.message).split('\n')[0]}`);
    }
  }
  throw new Error(`无法加载 jsdom，候选路径均失败：\n${errors.join('\n')}`);
}

const JSDOM = await loadJsdom();

const html = await readFile(join(ROOT, 'pages', 'results.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/pages/results.html', pretendToBeVisual: true });

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.Event = dom.window.Event;

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const href = typeof input === 'string' ? input : input?.url ?? String(input);
  if (href.startsWith('file:')) {
    const text = await readFile(fileURLToPath(href), 'utf8');
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return nativeFetch(href, init);
};

await import(new URL('../assets/js/pages/results.js', import.meta.url).href);

const d = dom.window.document;
const q = (s) => d.querySelectorAll(s).length;
const textOf = (s) => d.querySelector(s)?.textContent?.trim() ?? '(缺失)';

async function waitFor(predicate, { timeoutMs = 30_000, stepMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}

/** 概要条里按标签取统计值（真实数据，非硬编码） */
function statValue(label) {
  const cell = Array.from(d.querySelectorAll('#round-stats .stat')).find(
    (s) => (s.querySelector('span')?.textContent ?? '').trim() === label,
  );
  return cell?.querySelector('b')?.textContent?.trim() ?? '(无)';
}

const form = () => ({
  round: d.getElementById('round-select')?.value ?? '',
  resultRows: q('#result-body tbody tr'),
  qualifyingRows: q('#qualifying-body tbody tr'),
  pitRows: q('#pit-body tbody tr'),
  winnerRows: q('#winners-body tbody tr'),
  champion: statValue('分站冠军'),
});

/* ---------------------------------------------------------------- 首屏 */
const firstPaint = await waitFor(() => q('#round-select option') > 0 && q('#result-body tbody tr') > 0);
const winnersReady = await waitFor(() => q('#winners-body tbody tr') > 0);
const select = d.getElementById('round-select');
const optionTexts = Array.from(select.options).map((o) => o.textContent.trim());
// 默认态必须在切换之前抓下来，否则读到的是切换之后的 DOM
const defaultValue = select.value;
const defaults = form();
const defaultFirstRow = (d.querySelector('#result-body tbody tr')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);
const statsBefore = Array.from(d.querySelectorAll('#round-stats .stat')).map(
  (s) => `${s.querySelector('span').textContent.trim()}=${s.querySelector('b').textContent.trim()}`,
);
const subbarBefore = `${textOf('#sub-round')} · ${textOf('#sub-name')}`;

/* ---------------------------------------------------------------- 切到 R1 */
select.value = '1';
select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
const switched = await waitFor(() => {
  const f = form();
  return f.round === '1' && f.resultRows === defaults.resultRows && f.champion !== defaults.champion;
});
const afterSwitch = form();
const statsAfter = Array.from(d.querySelectorAll('#round-stats .stat')).map(
  (s) => `${s.querySelector('span').textContent.trim()}=${s.querySelector('b').textContent.trim()}`,
);
const subbarAfter = `${textOf('#sub-round')} · ${textOf('#sub-name')}`;

/* ---------------------------------------------------------------- 断言 */
const renderedContainers = [
  '#round-stats', '#result-body', '#qualifying-body', '#pit-body', '#circuit-body', '#winners-body',
];
const injected = renderedContainers.filter((sel) => /<script/i.test(d.querySelector(sel)?.innerHTML ?? ''));
const errorStates = q('.state-error');

const checks = [
  ['首屏渲染完成', firstPaint],
  ['本赛季冠军表渲染完成', winnersReady],
  ['#round-select 选项数 = 16', optionTexts.length === 16],
  ['选项按 round 倒序（首项 R16、末项 R1）', optionTexts[0].startsWith('R16 · ') && optionTexts[15].startsWith('R1 · ')],
  ['默认选中 model.lastCompleted.round（R16）', defaultValue === '16' && defaults.round === '16'],
  ['默认站正赛成绩 = 22 行', defaults.resultRows === 22],
  ['默认站排位赛非空', defaults.qualifyingRows > 0],
  ['默认站进站表非空', defaults.pitRows > 0],
  ['本赛季冠军表 = 16 行', defaults.winnerRows === 16],
  ['概要条含日期/冠军/最快圈/杆位/完赛五项真实统计', ['赛道当地日期', '分站冠军', '最快圈', '杆位', '完赛 / 发车'].every((l) => statsBefore.some((s) => s.startsWith(`${l}=`)))],
  ['R16 完赛口径与数据一致（19 / 22）', statsBefore.includes('完赛 / 发车=19 / 22')],
  ['切到 R1 后正赛成绩仍 = 22 行', switched && afterSwitch.resultRows === 22],
  ['切到 R1 后冠军姓氏变化', afterSwitch.champion !== defaults.champion],
  ['切换后选择器 value = 1', afterSwitch.round === '1'],
  ['次栏跟随选中站变化（R16 → R1）', subbarBefore.startsWith('R16') && subbarAfter.startsWith('R1')],
  ['切换后概要条日期区间随站变化', !statsAfter.some((s) => statsBefore.includes(s) && s.startsWith('赛道当地日期='))],
  ['无 .state-error', errorStates === 0],
  ['渲染容器内无 <script> 注入', injected.length === 0],
];

const report = {
  '首屏渲染完成': firstPaint,
  '选择器选项数': optionTexts.length,
  '选择器首项': optionTexts[0],
  '选择器第 2 项': optionTexts[1],
  '选择器末项': optionTexts[15],
  '默认选中 value': `${defaultValue}（期望 16）`,
  'R16 概要条': statsBefore,
  'R16 正赛成绩行数': defaults.resultRows,
  'R16 排位赛行数': defaults.qualifyingRows,
  'R16 进站表行数': defaults.pitRows,
  'R16 本赛季冠军行数': defaults.winnerRows,
  'R16 冠军姓氏': defaults.champion,
  '正赛卡片标题': textOf('#result-body thead tr'),
  'R16 正赛榜首行': defaultFirstRow,
  '切换后（R1）正赛成绩行数': afterSwitch.resultRows,
  '切换后（R1）冠军姓氏': afterSwitch.champion,
  '切换后（R1）概要条': statsAfter,
  '切换后（R1）排位赛行数': afterSwitch.qualifyingRows,
  '切换后（R1）进站表行数': afterSwitch.pitRows,
  '切换后（R1）本赛季冠军行数': afterSwitch.winnerRows,
  '顶栏导航项数': q('#topnav .topnav-item'),
  '顶栏高亮项': textOf('#topnav .topnav-item.is-active'),
  'R16 次栏（轮次 · 国家）': subbarBefore,
  '切换后（R1）次栏（轮次 · 国家）': subbarAfter,
  '数据源徽标': textOf('#data-source'),
  '状态栏项目数': q('#status-bar .status-item'),
  '页面标题': d.title,
  '.state-error 数量': errorStates,
  '渲染容器内的 <script> 注入': injected.length ? `有（异常）：${injected.join(',')}` : '无',
  '断言结果': checks.map(([name, ok]) => `${ok ? 'PASS' : 'FAIL'} ${name}`),
};

console.log(JSON.stringify(report, null, 2));

const failed = checks.filter(([, ok]) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 项断言通过`);
if (failed.length) {
  console.log('失败项：' + failed.map(([name]) => name).join('、'));
  process.exit(1);
}
process.exit(0);
