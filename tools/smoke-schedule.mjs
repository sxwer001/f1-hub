#!/usr/bin/env node
/**
 * 赛历页（pages/schedule.html）冒烟自检（jsdom）
 * 运行：
 *   $env:F1_JSDOM_ROOT = '<你的 node 工作区>'
 *   node tools/smoke-schedule.mjs
 *
 * 说明：file:// 的快照请求被 shim 成本地读文件，其余请求交给 Node 原生 fetch。
 * 断言失败时退出码为 1，全部通过为 0。
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PAGE_URL = 'http://localhost/pages/schedule.html';

async function loadJsdom() {
  const candidates = [
    process.env.F1_JSDOM_ROOT,
    ROOT,
  ].filter(Boolean);

  const errors = [];
  for (const base of candidates) {
    try {
      return createRequire(join(base, 'noop.js'))('jsdom').JSDOM;
    } catch (err) {
      errors.push(`  - ${base}: ${String(err.message).split('\n')[0]}`);
    }
  }
  throw new Error(`无法加载 jsdom，候选路径均失败：\n${errors.join('\n')}`);
}

const JSDOM = await loadJsdom();

const html = await readFile(join(ROOT, 'pages', 'schedule.html'), 'utf8');
const dom = new JSDOM(html, { url: PAGE_URL, pretendToBeVisual: true });

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.MouseEvent = dom.window.MouseEvent;

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const href = typeof input === 'string' ? input : input?.url ?? String(input);
  if (href.startsWith('file:')) {
    const text = await readFile(fileURLToPath(href), 'utf8');
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return nativeFetch(href, init);
};

const page = await import(new URL('../assets/js/pages/schedule.js', import.meta.url).href);

/** 内置快照：用来把右栏渲染结果和「数据源真值」对齐，而不是硬编码期望值 */
const season = JSON.parse(await readFile(join(ROOT, 'assets', 'data', 'season.json'), 'utf8'));
const nextRace = season.races.find((r) => r.round === season.nextRound);

const d = dom.window.document;
const q = (sel) => d.querySelectorAll(sel).length;
const textOf = (sel) => d.querySelector(sel)?.textContent?.trim() ?? '(缺失)';

/** 轮询等待渲染完成（不使用固定 sleep） */
async function waitFor(predicate, { timeoutMs = 30_000, stepMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}

const clicked = (sel) => {
  const el = d.querySelector(sel);
  el?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  return Boolean(el);
};

/* ------------------------------------------------------------ 断言框架 */

const results = {};
const failures = [];
function check(name, actual, expected) {
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected;
  results[name] = ok ? `✔ ${actual}` : `✘ 实际=${JSON.stringify(actual)} 期望=${expected}`;
  if (!ok) failures.push(name);
}

/* ------------------------------------------------------------ 1. 渲染完成 */

const rendered = await waitFor(
  () => q('#cards-next .race-card') > 0 && q('#cards-done .race-card') > 0 && q('#cards-upcoming .race-card') > 0,
);
check('卡片区渲染完成', rendered, true);

/* ------------------------------------------------------------ 2. 核心结构断言 */

check('下一站卡片数（应为 1）', q('#cards-next .race-card'), 1);
check('下一站卡片带 .is-next', q('#cards-next .race-card.is-next'), 1);
check('下一站卡片容器为 .cards.cards-featured', q('#cards-next.cards.cards-featured'), 1);
check('本赛季已完成卡片数（应为 16）', q('#cards-done .race-card'), 16);
check('已完成卡片均带 .is-done', q('#cards-done .race-card.is-done'), 16);
check('后续分站卡片数（应为 6）', q('#cards-upcoming .race-card'), 6);
check('卡片总数（应为 23）', q('.race-card'), 23);

const doneRounds = [...d.querySelectorAll('#cards-done .card-round')].map((el) => Number(el.textContent.replace(/\D/g, '')));
check('已完成区 ROUND 倒序（16 → 1）', doneRounds.join(','), '16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1');
check('下一站为 R17 Singapore', textOf('#cards-next .card-country'), (v) => /Singapore/.test(v));

/* ------------------------------------------------------------ 3. 安全与状态断言 */

const hosts = ['#cards-next', '#cards-done', '#cards-upcoming', '#band-next', '#band-done', '#band-upcoming'];
check('渲染容器内无 <script> 注入', hosts.filter((sel) => /<script/i.test(d.querySelector(sel)?.innerHTML ?? '')).join(',') || '无', '无');
check('内容区无 .state-error', q('main.page .state-error'), 0);
check('卡片区无 .state-empty 误报', q('main.page .state-empty'), 0);
/**
 * jsdom 未开启脚本执行时会把 <noscript> 的内容按普通标签解析，
 * 因此全页 .state-error 会数到 1 条 —— 断言它确实是 noscript 兜底文案而非错误态。
 */
const pageErrors = [...d.querySelectorAll('.state-error')];
check(
  '全页唯一的 .state-error 是 <noscript> 兜底',
  pageErrors.length === 1 && pageErrors[0].closest('noscript') !== null,
  true,
);
check('卡片内无 on* 事件属性', [...d.querySelectorAll('.race-card *')].flatMap((el) => [...el.attributes].map((a) => a.name)).filter((n) => /^on/i.test(n)).join(',') || '无', '无');

/* ------------------------------------------------------------ 4. 「下一站」右栏面板
 * 断言口径：右栏必须真的把「数据源里的值」渲染出来（会话数、会话英文名、赛道规格），
 * 而不是渲染占位文案；天气是否取到不影响断言（取不到只显示 '—'，且不得出现错误态）。
 */

const side = d.querySelector('#next-side');
check('右栏容器存在（#next-side）', Boolean(side), true);
check('右栏与红卡同处 .next-split（左卡右栏两列）', Boolean(d.querySelector('.next-split > #cards-next.cards.cards-featured')) && Boolean(d.querySelector('.next-split > #next-side')), true);
check('右栏仍在「下一站」分区内', side?.closest('#band-next') === d.querySelector('#band-next'), true);

/* 任务 2：赛道信息卡从右栏移到左列红卡下方，让「下一站」两列高度均衡。
 * 断言口径：挂载点必须是 .next-split 的直接子元素、且 DOM 顺序在红卡之后、右栏之前；
 * 赛道信息必须渲染进左列挂载点，右栏里不得再有它。 */
check('左列赛道信息挂载点存在（.next-split > #next-circuit-host）', Boolean(d.querySelector('.next-split > #next-circuit-host')), true);
check(
  '两列 DOM 顺序为 红卡 → 赛道信息挂载点 → 右栏',
  [...d.querySelectorAll('.next-split > *')].map((el) => el.id).filter(Boolean).join(','),
  'cards-next,next-circuit-host,next-side',
);
check('赛道信息渲染进左列挂载点（#next-circuit-host 内有 #next-circuit）', Boolean(d.querySelector('#next-circuit-host #next-circuit')), true);
check('赛道信息已移出右栏（#next-side 内不再有 #next-circuit）', d.querySelector('#next-side #next-circuit'), null);
check('赛道信息仍属「下一站」分区', d.querySelector('#next-circuit')?.closest('#band-next') === d.querySelector('#band-next'), true);

// ① 各会话具体时间（共享视图 sessionsPanelHtml）
const sessRows = [...d.querySelectorAll('#next-sessions .sessions-table tbody tr')];
check('时间表面板存在（#next-sessions）', Boolean(d.querySelector('#next-sessions .sessions-table')), true);
check(`会话行数 = 该站会话数（R${nextRace.round} 共 ${nextRace.sessions.length} 节）`, sessRows.length, nextRace.sessions.length);
check('会话表 7 列（会话/日期/开始/天气/气温/降水/状态）', d.querySelectorAll('#next-sessions .sessions-table thead th').length, 7);
check('每行 7 格（无缺列）', sessRows.every((tr) => tr.children.length === 7), true);
check(
  '会话行含数据源里的英文名（Sprint / Qualifying / Practice）',
  sessRows.map((tr) => tr.querySelector('.cell-sub')?.textContent ?? '').join(' | '),
  (v) => nextRace.sessions.every((s) => v.includes(s.labelEn)) && /Sprint/.test(v) && /Qualifying/.test(v),
);
/**
 * 会话时间必须真的是「数据源里的 utc → 本机时区」，这里用 Intl/本地 getter 独立算一遍对照，
 * 不依赖页面自己的格式化实现（也就不会掩盖换算偏差）。
 */
const localHHMM = (iso) => new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const localDayLabel = (iso) => { const dt = new Date(iso); return `${dt.getMonth() + 1}月${dt.getDate()}日`; };
check(
  '会话时间列 = 数据源 utc 换算到本机时区（逐条对照）',
  sessRows.map((tr) => tr.children[2].textContent.trim()).join(' | '),
  nextRace.sessions.map((s) => localHHMM(s.utc)).join(' | '),
);
check(
  '会话日期列 = 数据源 utc 的本机日期（逐条对照）',
  sessRows.map((tr) => tr.children[1].textContent.trim()).join(' | '),
  (v) => nextRace.sessions.every((s, i) => v.split('|')[i].includes(localDayLabel(s.utc))),
);
check(
  '会话行状态列为倒计时（R17 尚未开赛）',
  sessRows.map((tr) => tr.children[6].textContent.trim()).join(' | '),
  (v) => !v.includes('—') && /天|小时|分钟/.test(v),
);
check(
  '天气列：取到则显示真实值，取不到则为占位（不报错）',
  sessRows.map((tr) => tr.children[5].textContent.trim()).join(' | '),
  (v) => v.split('|').every((cell) => cell.trim() === '—' || /%/.test(cell)),
);

// ② 天气预测：异步补齐后才可能出现「正赛日概览」，缺失时不得是错误态
check('右栏内无 .state-error（天气失败也不报错）', q('#next-side .state-error'), 0);
check(
  '正赛日天气概览：有预报才渲染（3 项），无则整块省略（0 项）',
  q('#next-sessions .card-body > .stat-row .stat'),
  (n) => n === 0 || n === 3,
);

// ③ 赛道信息（真实规格；缺字段即省略）
const circuitPanel = d.querySelector('#next-circuit');
check('赛道信息面板存在（#next-circuit）', Boolean(circuitPanel), true);
check('赛道面板基础字段 ≥ 5 项（赛道/城市/国家/周末形式/赛道时区）', q('#next-circuit .stat'), (n) => n >= 5);
check('赛道基础字段取自数据源（赛道名 / 城市 / 国家）', textOf('#next-circuit'), (v) => v.includes(nextRace.circuitZh) && v.includes(nextRace.localityZh) && v.includes(nextRace.countryZh));
check('周末形式与冲刺属性一致', textOf('#next-circuit'), (v) => v.includes(nextRace.sprint ? '冲刺周末' : '常规周末'));
check('赛道面板显示赛道当地时区（取自 maps.js）', textOf('#next-circuit'), (v) => /Asia\/Singapore/.test(v));
check('时间表面板标题右侧标注赛道当地时区', textOf('#next-sessions .card-caption'), (v) => /Asia\/Singapore/.test(v));
check(
  '渲染出至少 1 个真实赛道规格字段（长度/弯数/圈数/首办年）',
  ['km', '个', '圈', '年'].filter((u) => textOf('#next-circuit').includes(u)),
  (arr) => arr.length >= 1,
);
check('R17 marina_bay 规格与数据源一致（4.927 km / 19 弯 / 62 圈）', textOf('#next-circuit'), (v) => /4\.927 km/.test(v) && /19 个/.test(v) && /62 圈/.test(v));
check('赛道规格附可核对来源', textOf('#next-circuit .block-note'), (v) => /formula1\.com/.test(v) && /wikipedia/i.test(v));
check('右栏无 <script> 注入', /<script/i.test(side?.innerHTML ?? ''), false);

// ③b 「有则显示、无则不显示」的契约（直接测导出函数，不依赖当前渲染）
check(
  '缺失字段一律不渲染（circuitSpecItems 只输出存在的字段）',
  page.circuitSpecItems({ lengthKm: 5.414, laps: 57 }).map((it) => it.label).join(','),
  '赛道长度,正赛圈数',
);
check('无规格数据时输出 0 项（不塞占位）', page.circuitSpecItems(null).length, 0);
check('全字段齐备时输出 4 项', page.circuitSpecItems({ lengthKm: 1, turns: 2, laps: 3, firstHeld: 1999 }).length, 4);

/* ------------------------------------------------------------ 5. 链接解析 */

const hrefs = [...d.querySelectorAll('.race-card > a')].map((a) => a.getAttribute('href'));
const resolved = [...d.querySelectorAll('.race-card > a')].map((a) => a.href);
/**
 * 共享视图 assets/js/ui/dashboard.js 的 raceCardHtml({base}) 已修好：
 * 根目录页面传 base=''（pages/race.html），pages/ 下的页面传 base='../'，
 * 于是本页输出的 href 是 ../pages/race.html?round=N，解析为 /pages/race.html?round=N。
 * （此前 base 未生效 / 少了结尾斜杠，链接被解析成 /pages/pages/race.html 或 /pages/..pages/race.html 的坏链。）
 */
check('卡片链接写法（共享视图带 base，指向上一级 pages/）', hrefs.every((h) => /^\.\.\/pages\/race\.html\?round=\d+$/.test(h)), true);
check('卡片链接在本页解析到 /pages/race.html（无 pages/pages、无 ..pages 残段）', resolved.every((h) => /^http:\/\/localhost\/pages\/race\.html\?round=\d+$/.test(h)), true);
check('解析样例（R17）', resolved[0], 'http://localhost/pages/race.html?round=17');
check(
  '反证：不带 base 的写法会解析成 /pages/pages/race.html',
  new URL('pages/race.html?round=17', PAGE_URL).href,
  'http://localhost/pages/pages/race.html?round=17',
);
check(
  '回归：解析结果里不再出现 pages/pages 或 ..pages 残段',
  resolved.filter((h) => h.includes('/pages/pages/') || h.includes('..')).length,
  0,
);

/* ------------------------------------------------------------ 6. 外壳 */

const navItems = [...d.querySelectorAll('#topnav .topnav-item')];
check('顶栏导航项数', navItems.length, 4);
check('顶栏高亮项文案', textOf('#topnav .topnav-item.is-active'), '赛历');
check('顶栏导航链接解析正确', navItems.every((a) => /^http:\/\/localhost\/pages\/[a-z]+\.html$/.test(a.href)), true);
check('页面标题', d.title, '赛历 · F1 观赛助手');
check('次栏轮次', textOf('#sub-round'), 'R17');
check('次栏赛道当地日期区间', textOf('#sub-date'), (v) => /\d{2} – \d{2} [A-Z]{3}/.test(v));
check('数据源徽标已更新', textOf('#data-source'), (v) => v !== '数据加载中');
check('下一站说明含日期区间与时区名', textOf('#next-note'), (v) => /–/.test(v) && /Asia\/Singapore/.test(v));
check('已完成说明', textOf('#done-note'), (v) => /16/.test(v));
check('后续分站说明', textOf('#upcoming-note'), (v) => /6/.test(v));
check('状态栏项目数', q('#status-bar .status-item'), (n) => n >= 3);

/* ------------------------------------------------------------ 7. 本地筛选交互 */

clicked('#schedule-filter .seg-btn[data-tab="done"]');
await new Promise((r) => setTimeout(r, 200));
check('切到「已完成」：下一站分区隐藏', d.querySelector('#band-next').hidden, true);
check('切到「已完成」：已完成分区可见', d.querySelector('#band-done').hidden, false);
check('切到「已完成」：后续分区隐藏', d.querySelector('#band-upcoming').hidden, true);
check('切到「已完成」：卡片总数仍为 23', q('.race-card'), 23);
check('切到「已完成」：已完成卡片仍为 16', q('#cards-done .race-card'), 16);
check('切到「已完成」：高亮按钮唯一且正确', d.querySelector('.seg-btn.is-active')?.dataset.tab, 'done');

clicked('#schedule-filter .seg-btn[data-tab="upcoming"]');
await new Promise((r) => setTimeout(r, 200));
check('切到「后续」：下一站分区可见', d.querySelector('#band-next').hidden, false);
check('切到「后续」：已完成分区隐藏', d.querySelector('#band-done').hidden, true);
check('切到「后续」：后续分区可见', d.querySelector('#band-upcoming').hidden, false);
check('切到「后续」：后续卡片仍为 6', q('#cards-upcoming .race-card'), 6);
check('切到「后续」：高亮按钮唯一且正确', d.querySelector('.seg-btn.is-active')?.dataset.tab, 'upcoming');

clicked('#schedule-filter .seg-btn[data-tab="all"]');
await new Promise((r) => setTimeout(r, 200));
check('切回「全部」：三个分区均可见', ['#band-next', '#band-done', '#band-upcoming'].every((s) => d.querySelector(s).hidden === false), true);
check('切回「全部」：卡片总数仍为 23', q('.race-card'), 23);
check('筛选只重绘卡片区（状态栏未被清空）', q('#status-bar .status-item'), (n) => n >= 3);
check('筛选后无残留注入', /<script/i.test(d.querySelector('#cards-done')?.innerHTML ?? ''), false);
check('切换筛选后右栏仍在（会话行数与数据源一致）', q('#next-side .sessions-table tbody tr'), season.races.find((r) => r.round === season.nextRound).sessions.length);

/* ------------------------------------------------------------ 8. 联网自查（可选，不参与断言）
 * 设置 F1_SMOKE_FORECAST=1 时，最多等 20 秒让 Open-Meteo 预报落地，打印真实渲染结果。
 * 默认不开启：本冒烟在离线环境下也必须全绿（天气取不到只显示 '—'）。
 */

if (process.env.F1_SMOKE_FORECAST === '1') {
  const firstRow = () => d.querySelector('#next-sessions .sessions-table tbody tr');
  const landed = await waitFor(() => !(firstRow()?.children[5]?.textContent ?? '—').includes('—'), { timeoutMs: 20_000, stepMs: 250 });
  console.log(`\n[联网] 逐会话天气落地=${landed}`);
  [...d.querySelectorAll('#next-sessions .sessions-table tbody tr')].forEach((tr) => {
    console.log(`[联网]   ${tr.textContent.replace(/\s+/g, ' ').trim()}`);
  });
  const dayRow = d.querySelector('#next-sessions .card-body > .stat-row');
  console.log(`[联网] 正赛日概览=${dayRow ? dayRow.textContent.replace(/\s+/g, ' ').trim() : '(未渲染，预报里没有正赛日)'}`);
}

/* ------------------------------------------------------------ 输出 */

check('selectedFilter 最终态', d.querySelector('.seg-btn.is-active')?.dataset.tab, 'all');

const failed = Object.entries(results).filter(([, v]) => String(v).startsWith('✘'));
console.log(JSON.stringify(results, null, 2));
console.log(`\n共 ${Object.keys(results).length} 项断言，通过 ${Object.keys(results).length - failed.length}，失败 ${failed.length}`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach(([k, v]) => console.log(`  - ${k}: ${v}`));
}
process.exit(failed.length ? 1 : 0);
