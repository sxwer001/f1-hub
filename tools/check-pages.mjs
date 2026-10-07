#!/usr/bin/env node
/**
 * 详情页渲染 + 数据层单元/回归断言
 * 运行：node tools/check-pages.mjs
 *
 * 覆盖：
 *   1. 纯函数单元断言（转义、URL 白名单、会话状态、时长文案）
 *   2. 离线回退：所有 https 请求失败时 loadSeason 仍返回 23 站快照
 *   3. 真实数据断言（下一站、赛历条数、进站统计）
 *   4. 注入防护：恶意站名不会产出可执行 HTML
 *   5. 分站详情页 jsdom 实际渲染
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const asset = (p) => new URL(`../${p}`, import.meta.url).href;

async function loadJsdom() {
  const candidates = [process.env.F1_JSDOM_ROOT, ROOT].filter(Boolean);
  const errors = [];
  for (const base of candidates) {
    try {
      return createRequire(join(base, 'noop.js'))('jsdom').JSDOM;
    } catch (err) {
      errors.push(`  - ${base}: ${String(err.message).split('\n')[0]}`);
    }
  }
  throw new Error(`无法加载 jsdom：\n${errors.join('\n')}`);
}

const JSDOM = await loadJsdom();
const nativeFetch = globalThis.fetch;

/** 把 file:// 请求交给本地读取，便于 jsdom 环境读取内置快照 */
function installFetchShim({ failRemote = false } = {}) {
  globalThis.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input?.url ?? String(input);
    if (href.startsWith('file:')) {
      const text = await readFile(fileURLToPath(href), 'utf8');
      return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (failRemote) throw new TypeError('fetch failed（自检模拟断网）');
    return nativeFetch(href, init);
  };
}

const results = {};
const failures = [];
function check(name, actual, expected) {
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected;
  results[name] = ok ? `✔ ${actual}` : `✘ 实际=${JSON.stringify(actual)} 期望=${expected}`;
  if (!ok) failures.push(name);
}

/* ------------------------------------------------------------ 1. 纯函数单元 */

const utils = await import(asset('assets/js/utils.js'));
check('escapeHtml 转义标签', utils.escapeHtml('<img src=x onerror=alert(1)>'), (v) => !v.includes('<') && v.includes('&lt;img'));
check('escapeHtml 转义引号', utils.escapeHtml(`"'&`), '&quot;&#39;&amp;');
check('escapeHtml 处理 null', utils.escapeHtml(null), '');
check('safeUrl 拦 javascript:', utils.safeUrl('javascript:alert(1)'), '#');
check('safeUrl 拦 data:', utils.safeUrl('data:text/html,<script>1</script>'), '#');
check('safeUrl 放行 https', utils.safeUrl('https://www.formula1.com/x'), 'https://www.formula1.com/x');
check('safeUrl 放行锚点', utils.safeUrl('#top'), '#top');
check('safeUrl 放行相对路径', utils.safeUrl('./pages/race.html'), './pages/race.html');
check('safeUrl 拦控制字符绕过', utils.safeUrl('java\nscript:alert(1)'), '#');
check('humanizeDuration 天级', utils.humanizeDuration(2 * 86400_000 + 5 * 3600_000), '2 天 5 小时后');
check('fmtTime 非法输入', utils.fmtTime('not-a-date'), '--:--');

installFetchShim({ failRemote: true });
const season = await import(asset('assets/js/data/season.js'));

const now = Date.parse('2026-10-06T14:00:00+08:00');
const longPast = { key: 'race', ts: now - 5 * 3600_000 };
const midRace = { key: 'race', ts: now - 3600_000 };
const future = { key: 'race', ts: now + 3600_000 };
check('sessionState 已结束', season.sessionState(longPast, now), 'done');
check('sessionState 正赛进行中（1 小时前开赛）', season.sessionState(midRace, now), 'live');
check('sessionState 未开始', season.sessionState(future, now), 'upcoming');

/* ------------------------------------------------------------ 2. 离线回退 */

const offlineModel = await season.loadSeason({ now });
check('离线：数据源为快照', offlineModel.source, 'snapshot');
check('离线：赛历 23 站', offlineModel.races.length, 23);
const liveAttempt = await season.refreshLive(offlineModel, { now });
check('离线：refreshLive 返回 null', liveAttempt, null);
check('离线：下一站为新加坡', offlineModel.nextRace?.nameZh, '新加坡大奖赛');
check('离线：已完赛 16 站', offlineModel.races.filter((r) => r.status === 'completed').length, 16);
check('离线：冲刺周末标记正确', offlineModel.nextRace?.sprint, true);
check('离线：新加坡 5 节会话', offlineModel.nextRace?.sessions.length, 5);
check(
  '离线：会话按时间升序',
  offlineModel.nextRace?.sessions.every((s, i, a) => i === 0 || a[i - 1].ts <= s.ts),
  true,
);
check('离线：未来会话已排序', offlineModel.upcomingSessions.every((s, i, a) => i === 0 || a[i - 1].ts <= s.ts), true);

installFetchShim();
const online = await import(asset('assets/js/data/season.js'));
const model = await online.loadSeason({ now });

/* ------------------------------------------------------------ 3. 真实数据 */

const r16 = model.byRound.get(16);
const results16 = online.raceResults(model, 16);
check('R16 成绩 22 名', results16.length, 22);
check('R16 冠军为维斯塔潘', results16[0]?.nameZh, '维斯塔潘');
check('R16 冠军车队色存在', /^#[0-9a-f]{6}$/i.test(results16[0]?.teamColor ?? ''), true);
const quali16 = online.raceQualifying(model, 16);
check('R16 排位成绩非空', quali16.length > 0, true);
const insight = online.tyreInsight(model, 16);
check('R16 进站统计有数据', insight && insight.totalStops > 0, true);
check('R16 人均进站合理（0.5~4）', insight.averageStops > 0.5 && insight.averageStops < 4, true);
check('快照覆盖 16 站成绩', Object.keys(model.results).length, 16);
check('车手积分榜 23 人', model.drivers.length, 23);
check('车队积分榜 11 支', model.constructors.length, 11);
check('积分榜名次连续', model.drivers.every((d, i) => d.pos === i + 1), true);

/* ------------------------------------------------------------ 4. 注入防护 */

const dashboardView = await import(asset('assets/js/ui/dashboard.js'));
const evil = {
  ...model,
  nextRace: {
    ...model.nextRace,
    nameZh: '<img src=x onerror="globalThis.__pwned=1">',
    circuitZh: '<script>globalThis.__pwned=1</script>',
    localityZh: '"><iframe>',
    countryZh: '</title><svg onload=1>',
    name: '"><img src=x onerror=1> Grand Prix',
    flag: '🏁',
    raceUtc: model.nextRace.raceUtc,
    sessions: model.nextRace.sessions,
    round: 17,
  },
};

/**
 * 注入载具必须是**活着的**渲染路径 —— 死函数上的转义断言不能证明线上安全。
 * 这里覆盖三处真实会被外部数据喂到的出口：详情页头图（nameZh/localityZh）、
 * 赛道信息面板、以及赛历卡片（name/circuit/领奖台时间与车队色）。
 */
const raceView = await import(asset('assets/js/ui/race.js'));
const evilHtml =
  raceView.detailHeroHtml({ race: evil.nextRace, forecast: null }) +
  raceView.circuitPanelHtml({ race: evil.nextRace }) +
  dashboardView.cardsHtml({ races: [evil.nextRace], model: evil, now, variant: 'next' });
check('恶意站名被转义（无 <img）', /<img/i.test(evilHtml), false);
check('恶意站名被转义（无 <script）', /<script/i.test(evilHtml), false);
check('恶意站名被转义（无 <iframe）', /<iframe/i.test(evilHtml), false);

/**
 * 比字符串匹配更可靠的做法：把产物真正解析成 DOM，
 * 断言没有注入出任何元素、也没有任何可执行的事件属性。
 */
const evilDom = new JSDOM(`<body>${evilHtml}</body>`);
const injectedEls = evilDom.window.document.querySelectorAll('img, iframe, script, svg, object, embed');
const eventAttrs = [];
evilDom.window.document.querySelectorAll('*').forEach((el) => {
  for (const attr of el.attributes) {
    if (/^on/i.test(attr.name)) eventAttrs.push(`${el.tagName}.${attr.name}`);
  }
});
check('注入产物中无新增元素', injectedEls.length, 0);
check('注入产物中无 on* 事件属性', eventAttrs.join(',') || '无', '无');
check('引号已转义（不出现 onerror="）', /onerror="/i.test(evilHtml), false);

/** 车队色会写进内联 style，必须同样不可逃逸 */
const evilPodium = dashboardView.raceCardHtml({
  race: model.byRound.get(16),
  model: {
    ...model,
    results: { 16: [{ code: 'X"><script>1</script>', time: '"><img src=x>', teamColor: '#fff"><script>alert(1)</script>' }] },
  },
  now,
  variant: 'done',
});
const podiumDom = new JSDOM(`<body>${evilPodium}</body>`);
check('内联样式中的车队色不可逃逸', podiumDom.window.document.querySelectorAll('script, img').length, 0);
check(
  '内联样式仅含一条合法声明（无分号逃逸）',
  [...podiumDom.window.document.querySelectorAll('.podium-item')].every((el) =>
    /^border-left:\s*4px solid #[0-9a-f]{6}$/i.test(el.getAttribute('style') || ''),
  ),
  true,
);
check('safeColor 拒绝分号注入', (await import(asset('assets/js/utils.js'))).safeColor('#fff;background:url(x)'), '#8b8b93');
check('safeColor 放行合法色值', (await import(asset('assets/js/utils.js'))).safeColor('#27f4d2'), '#27f4d2');

const evilNews = dashboardView.newsHtml([{ title: '<img src=x onerror=1>', link: 'javascript:alert(1)', author: 'x' }]);
check('新闻标题被转义', /<img/i.test(evilNews), false);
check('新闻链接被降级为 #', evilNews.includes('href="#"'), true);

/* ------------------------------------------------------------ 5. 详情页渲染 */

const raceHtml = await readFile(join(ROOT, 'pages', 'race.html'), 'utf8');
const dom = new JSDOM(raceHtml, { url: 'http://localhost/pages/race.html?round=16', pretendToBeVisual: true });

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.MouseEvent = dom.window.MouseEvent;

await import(asset('assets/js/pages/race-detail.js'));

const d = dom.window.document;
const deadline = Date.now() + 40_000;
while (Date.now() < deadline) {
  if (d.querySelectorAll('#result-body tbody tr').length > 0 && d.querySelectorAll('#sessions-body tbody tr').length > 0) break;
  await new Promise((r) => setTimeout(r, 200));
}
await new Promise((r) => setTimeout(r, 300));

const q = (sel) => d.querySelectorAll(sel).length;
const title = d.querySelector('#detail-hero .dh-title')?.textContent?.trim() ?? '(缺失)';

check('详情页标题为英文站名', /Grand Prix/.test(title), true);
check('详情页会话表 5 行', q('#sessions-body tbody tr'), 5);
check('详情页正赛成绩 22 行', q('#result-body tbody tr'), 22);
check('详情页排位成绩非空', q('#qualifying-body tbody tr') > 0, true);
check('详情页进站表非空', q('#pit-body tbody tr') > 0, true);
check('详情页赛道信息含坐标', /纬度/.test(d.querySelector('#circuit-body')?.textContent ?? ''), true);
check('详情页本赛季冠军 16 行', q('#winners-body tbody tr'), 16);
check('详情页无错误态', q('#detail-hero .state-error') + q('#result-body .state-error'), 0);
check('详情页无残留注入', /<script/i.test(d.querySelector('#detail-hero')?.innerHTML ?? ''), false);
check('页面标题已更新', /F1 观赛助手/.test(d.title), true);

/* ------------------------------------------------------------ 输出 */

const failed = Object.entries(results).filter(([, v]) => String(v).startsWith('✘'));
console.log(JSON.stringify(results, null, 2));
console.log(`\n共 ${Object.keys(results).length} 项断言，通过 ${Object.keys(results).length - failed.length}，失败 ${failed.length}`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach(([k, v]) => console.log(`  - ${k}: ${v}`));
}
process.exit(failed.length ? 1 : 0);
