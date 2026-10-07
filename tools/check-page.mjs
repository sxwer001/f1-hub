#!/usr/bin/env node
/**
 * 单页冒烟自检（通用）。
 * 用法：node tools/check-page.mjs <home|schedule|standings|results|race>
 *
 * 每个页面独立进程运行 —— 五个控制器都会改写 globalThis.document，
 * 同进程内连跑会互相干扰。
 *
 * 做法：jsdom 载入真实 HTML → 把 file:// 请求 shim 成本地读文件（其余交给
 * Node 原生 fetch）→ import 该页控制器 → 轮询等待渲染完成 → 断言。
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const PAGES = {
  home: {
    html: 'index.html',
    controller: 'assets/js/pages/home.js',
    url: 'http://localhost/index.html',
    ready: () => q('#hero-count-target .cd-cell') >= 4 || q('.display') > 0,
    // 新闻是异步的：等它落地（在线出 .news-list，离线出 .state-empty），否则会误判
    settle: () => q('#news-body .news-list li') > 0 || q('#news-body .state-empty') > 0,
    assert: (a) => {
      a.ok('大标题存在', textOf('.display').length > 0);
      a.eq('倒计时单元 4 个', q('#hero-count-target .cd-cell'), 4);

      // 新版首页只保留三块：① 下一站倒计时 ② 下一站数据与时间 ③ 相关新闻
      a.eq('首页内容块共 3 块', q('main.page > section'), 3);
      a.eq('① 下一站倒计时块', q('#hero'), 1);
      a.eq('② 下一站数据与时间块', q('#race-card #race-body'), 1);
      a.eq('③ 相关新闻块', q('#news-card #news-body'), 1);

      const schedRows = q('#race-body .sessions-table tbody tr');
      const stats = q('#race-body .stat-row .stat');
      const newsRows = q('#news-body .news-list li');
      a.ok('周末时间表 ≥ 5 行', schedRows >= 5, `实际 ${schedRows}`);
      a.ok('硬数据 .stat-row ≥ 4 格', stats >= 4, `实际 ${stats}`);
      a.ok(
        '新闻块已落地',
        newsRows > 0 || q('#news-body .state-empty') > 0,
        newsRows > 0 ? `${newsRows} 条` : '离线空态',
      );

      // 旧首页结构必须彻底消失（照片 hero / 四条入口卡片 / 积分榜 / 设置大卡片 / 赛季概览条）
      a.eq('无 .home-hero 照片 hero', q('.home-hero') + q('.detail-hero'), 0);
      a.eq('无 .home-entry 入口卡片', q('.home-entry'), 0);
      a.eq('无首页卡片组 #cards-*', q('#cards-next') + q('#cards-done') + q('#cards-upcoming'), 0);
      a.eq('无首页积分榜 #standings-body', q('#standings-body') + q('#top-standings'), 0);
      a.eq('无首页时间表 #schedule-body', q('#schedule-body'), 0);
      a.eq('无设置大卡片 #settings-body', q('#settings-body'), 0);
      a.eq('无独立赛季概览 stat 条', q('main.page > .stat-row') + q('#season-stats') + q('#overview-stats'), 0);

      // 四条入口只许出现在顶栏导航里，内容区不得再有入口卡片
      const entryLinks = [...doc.querySelectorAll('a[href]')]
        .filter((el) => !el.closest('#topnav'))
        .filter((el) =>
          ['pages/schedule.html', 'pages/standings.html', 'pages/results.html', 'pages/race.html']
            .includes(el.getAttribute('href')));
      a.eq('内容区无四条入口卡片链接', entryLinks.length, 0);

      // 无任何红色竖条装饰：内联 border-left / inset 一律不允许
      const bars = [...doc.querySelectorAll('[style]')].filter((el) =>
        /border-left|inset/i.test(el.getAttribute('style') || ''));
      a.eq('无红色竖条（内联 border-left / inset）', bars.length, 0);

      // 页脚：状态栏 + 一行紧凑的提醒 / 关于入口（限定在 .app-footer 内，
      // 因为设置面板里也有同名按钮）
      a.eq('页脚状态栏 .status-bar', q('.status-bar'), 1);
      a.eq('页脚提醒 / 关于入口', q('.app-footer #act-test-notify') + q('.app-footer #act-about'), 2);

      // 设置面板：触发键常驻，内容懒渲染（打开时才由 shell.js 填）
      a.eq('顶栏设置触发键', q('#act-settings'), 1);
      a.eq('设置面板容器存在', q('#settings-pop'), 1);
      a.eq('设置面板默认收起', q('#settings-pop:not([hidden])'), 0);
      a.eq('设置面板未打开时不渲染控件', q('#settings-pop #set-notify') + q('#settings-pop #set-theme'), 0);
    },
  },
  schedule: {
    html: 'pages/schedule.html',
    controller: 'assets/js/pages/schedule.js',
    url: 'http://localhost/pages/schedule.html',
    ready: () => q('.race-card') >= 23,
    assert: (a) => {
      a.eq('赛历卡片总数 23', q('.race-card'), 23);
      a.eq('下一站卡片为红色态', q('.race-card.is-next'), 1);
      a.eq('已完成卡片 16 张', q('#cards-done .race-card') || q('.race-card.is-done'), 16);
      // 卡片的领奖台行（.podium/.podium-item）与领奖台聚焦（.podium-hero-*）是两套类，必须各归各
      a.ok('已完成卡片带领奖台行', q('.race-card .podium .podium-item') >= 3, `实际 ${q('.race-card .podium .podium-item')}`);
      a.eq('赛历页不出现领奖台聚焦', q('.podium-hero'), 0);
    },
  },
  standings: {
    html: 'pages/standings.html',
    controller: 'assets/js/pages/standings.js',
    url: 'http://localhost/pages/standings.html',
    ready: () => q('table tbody tr') >= 11,
    assert: (a) => {
      const rows = q('table tbody tr');
      a.ok('表格行数为 23 或 11', rows === 23 || rows === 11, `实际 ${rows}`);
      a.eq('星标数等于行数', q('.star'), rows);
      // 车队榜 11 支全部有徽标
      a.eq('每行都有头像/徽标', q('.avatar'), rows);
      // 页面在 pages/ 下，图片路径必须是 ../assets/...（缺斜杠会拼成 ..assets/...）
      a.eq('图片路径相对 pages/ 正确', q('.avatar img[src^="../assets/img/"]'), q('.avatar img'));
    },
  },
  results: {
    html: 'pages/results.html',
    controller: 'assets/js/pages/results.js',
    url: 'http://localhost/pages/results.html',
    ready: () => q('table tbody tr') >= 22,
    assert: (a) => {
      a.ok('正赛成绩 ≥ 22 行', q('table tbody tr') >= 22);
      a.eq('站次选择器选项 16', q('#round-select option'), 16);
      a.ok('冠军榜存在', q('table tbody tr') >= 22);
      a.eq('领奖台 3 张卡', q('.podium-hero-card'), 3);
      a.eq('领奖台 3 张照片', q('.podium-hero-photo img'), 3);
      a.ok('成绩表有车手头像', q('.avatar img') >= 20, `实际 ${q('.avatar img')}`);
      // 命名空间隔离：领奖台聚焦一律 podium-hero-*，不能借用赛历卡片的 .podium 家族
      a.eq('聚焦卡不混用卡片领奖台类', q('.podium-hero .podium-item') + q('.podium-hero .podium-name'), 0);
    },
  },
  race: {
    html: 'pages/race.html',
    controller: 'assets/js/pages/race-detail.js',
    url: 'http://localhost/pages/race.html?round=16',
    ready: () => q('#result-body tbody tr') > 0 && q('#sessions-body tbody tr') > 0,
    assert: (a) => {
      a.eq('会话表 5 行', q('#sessions-body tbody tr'), 5);
      a.eq('正赛成绩 22 行', q('#result-body tbody tr'), 22);
      a.eq('本赛季冠军 16 行', q('#winners-body tbody tr'), 16);
      a.eq('领奖台 3 张卡', q('.podium-hero-card'), 3);
      a.ok('正赛成绩有车手头像', q('#result-body .avatar img') >= 20, `实际 ${q('#result-body .avatar img')}`);
    },
  },
};

const name = process.argv[2];
const spec = PAGES[name];
if (!spec) {
  console.error(`未知页面：${name}。可选：${Object.keys(PAGES).join(' | ')}`);
  process.exit(2);
}

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
const html = await readFile(join(ROOT, spec.html), 'utf8');
const dom = new JSDOM(html, { url: spec.url, pretendToBeVisual: true });

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

const doc = dom.window.document;
const q = (sel) => doc.querySelectorAll(sel).length;
const textOf = (sel) => doc.querySelector(sel)?.textContent?.trim() ?? '';

const results = [];
const failures = [];
const a = {
  ok(label, value, extra = '') {
    const pass = Boolean(value);
    results.push(`${pass ? '✔' : '✘'} ${label}${extra ? ` (${extra})` : ''}`);
    if (!pass) failures.push(label);
  },
  eq(label, actual, expected) {
    const pass = actual === expected;
    results.push(`${pass ? '✔' : '✘'} ${label} = ${actual}${pass ? '' : ` (期望 ${expected})`}`);
    if (!pass) failures.push(label);
  },
};

await import(new URL(`../${spec.controller}`, import.meta.url).href);

const deadline = Date.now() + 40_000;
while (Date.now() < deadline) {
  try {
    if (spec.ready()) break;
  } catch {
    /* 渲染过程中查询可能短暂抛错 */
  }
  await new Promise((r) => setTimeout(r, 200));
}
await new Promise((r) => setTimeout(r, 400));

// 可选：等某个异步渲染落地（例如首页新闻要等真实 RSS 返回），超时也继续 —— 断言里会给出实际值。
// 30s 与 electron/main.js 自检的等待窗口一致：RSS 慢于 10s 时旧窗口会误报「新闻块未落地」。
if (spec.settle) {
  const settleDeadline = Date.now() + 30_000;
  while (Date.now() < settleDeadline) {
    try {
      if (spec.settle()) break;
    } catch {
      /* 渲染过程中查询可能短暂抛错 */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

spec.assert(a);

const errorStates = q('.page .state-error');
a.eq('内容区无错误态', errorStates, 0);
a.ok('无 <script> 注入', !/<script/i.test(doc.querySelector('.page')?.innerHTML ?? ''));

console.log(`\n=== ${name} (${spec.html}) ===`);
results.forEach((line) => console.log('  ' + line));
console.log(`  —— 通过 ${results.length - failures.length}/${results.length}`);
process.exit(failures.length ? 1 : 0);
