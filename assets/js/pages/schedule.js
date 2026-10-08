/**
 * 赛历页控制器：23 站卡片（下一站 / 本赛季已完成 / 后续分站）+ 顶部本地筛选。
 * 只负责「取数 → 交给视图 → 挂事件」，HTML 一律由 assets/js/ui/dashboard.js 生成。
 *
 * 启动顺序与首页一致：① 注册事件 → ② 内置快照出画面 → ③ 实时积分榜后台补齐。
 */

import { APP_NAME } from '../config.js';
import { loadSeason, refreshLive, retime } from '../data/season.js';
import { clearCache } from '../net.js';
import { circuitTimeZone } from '../data/maps.js';
import { initSettings } from '../store.js';
import { onTick } from '../domain/schedule.js';
import {
  navHtml, mountShell, renderClocks, applyTheme, initShellChrome, bindShellEvents,
} from '../ui/shell.js';
import { getRaceForecast, forecastForRaceDay, weatherText } from '../data/weather.js';
import { getCircuitInfo } from '../data/circuit-info.js';
import { byId, setHTML, setText, escapeHtml, safeUrl, fmtDateRange } from '../utils.js';
import { card, skeleton, errorBox, statRow } from '../ui/atoms.js';
import { sessionsPanelHtml } from '../ui/race.js';
import * as view from '../ui/dashboard.js';

/** 顶部筛选页签（data-tab 值，顺序即按钮顺序） */
const TABS = ['all', 'done', 'upcoming'];

/** 每个页签显示哪些分区：`all` 全显示；`done` 只看已完成；`upcoming` 看下一站 + 后续分站 */
const TAB_BANDS = {
  all: ['band-next', 'band-done', 'band-upcoming'],
  done: ['band-done'],
  upcoming: ['band-next', 'band-upcoming'],
};

const ALL_BANDS = TAB_BANDS.all;
const CARD_HOSTS = ['cards-next', 'cards-done', 'cards-upcoming'];

const state = {
  model: null,
  info: null,
  tab: 'all',
  now: Date.now(),
  lastSlowPaint: 0,
  /** 下一站天气预报（异步补齐；取不到就是 null，渲染端不显示天气、不报错） */
  forecast: null,
  /** 已成功结算（或确认取不到）的下一站 round，避免 30 秒心跳重复打接口 */
  forecastRound: null,
  forecastTryRound: null,
  forecastTries: 0,
  forecastPending: false,
};

/* ------------------------------------------------------------------ 工具 */

/**
 * 每次 live 刷新自增的序号：await 回来后对不上（或 model 已经不是发起时那份）
 * 就丢弃结果，避免晚到的响应覆盖用户切走 / 手动刷新后的新模型。
 */
let refreshSeq = 0;

/** 赛道当地时区的 UTC 偏移文案，例如 UTC+8（取不到时返回空串） */
function zoneOffsetLabel(iso, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(new Date(iso));
    const value = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    return value.replace('GMT', 'UTC');
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ 渲染 */

/**
 * 本页位于 pages/ 下，卡片链接需要 base:'../' 前缀。
 * 注意必须带结尾斜杠：base 是直接拼在 `pages/race.html` 前面的，
 * 写成 '..' 会得到 '..pages/race.html'（解析成 /pages/..pages/race.html 的坏链）。
 */
const CARD_BASE = '../';

function renderNext(now) {
  const { model } = state;
  const next = model.nextRace;
  const host = byId('cards-next');
  setHTML(host, view.cardsHtml({ races: next ? [next] : [], model, now, variant: 'next', base: CARD_BASE }));

  // 右栏时间表 + 左列赛道信息卡与红卡同源同帧重绘
  renderNextSide(now);
  ensureNextForecast(next);

  if (!next) {
    setText(byId('next-note'), '本赛季已全部结束');
    return;
  }
  const tz = circuitTimeZone(next.id);
  const firstUtc = next.sessions[0]?.utc ?? next.raceUtc;
  const offset = zoneOffsetLabel(firstUtc, tz);
  setText(
    byId('next-note'),
    `${fmtDateRange(firstUtc, next.raceUtc, tz)} · 赛道当地时区 ${tz}${offset ? ` (${offset})` : ''}`,
  );
}

/* ------------------------------------------------ 下一站右栏：时间表 / 天气 / 赛道 */

/**
 * 把赛道规格排成 .stat-row 的项：**只输出确实存在的字段**，缺哪个就不显示哪个
 * （不编造、不用占位符）。导出供 tools/_smoke-schedule.mjs 直接断言这一契约。
 * @param {{lengthKm?:number,turns?:number,laps?:number,firstHeld?:number}|null} info
 */
export function circuitSpecItems(info) {
  const items = [];
  if (!info) return items;
  if (Number.isFinite(info.lengthKm)) items.push({ label: '赛道长度', value: `${info.lengthKm} km` });
  if (Number.isFinite(info.turns)) items.push({ label: '弯数', value: `${info.turns} 个` });
  if (Number.isFinite(info.laps)) items.push({ label: '正赛圈数', value: `${info.laps} 圈` });
  if (Number.isFinite(info.firstHeld)) items.push({ label: '首次举办 F1', value: `${info.firstHeld} 年` });
  return items;
}

/**
 * 「下一站」右栏 + 左列尾卡：① 周末时间表（会话英文名 / 本机时区日期时间 / 天气 / 气温 / 降水 / 状态）
 * ② 正赛日天气概览（并入时间表卡）③ 赛道信息（赛季数据 + 真实规格，挂到左列红卡下方）。
 * 天气预报还没落地时只显示 '—'（由 sessionsPanelHtml 处理），绝不渲染错误态 / 空态报错。
 *
 * 挂载位置：时间表 → #next-side（右栏）；赛道信息 → #next-circuit-host（左列红卡之后）。
 * 内容与渲染逻辑不变，只有承载容器不同 —— 让左右两列高度接近，消掉左列下方的大片空白。
 */
function renderNextSide(now = state.now) {
  const host = byId('next-side');
  const circuitHost = byId('next-circuit-host');
  if (!host && !circuitHost) return;
  const next = state.model?.nextRace;
  if (!next) {
    if (host) setHTML(host, '');
    if (circuitHost) setHTML(circuitHost, '');
    return;
  }

  const forecast = state.forecastRound === next.round ? state.forecast : null;
  const tz = circuitTimeZone(next.id);
  const offset = zoneOffsetLabel(next.sessions[0]?.utc ?? next.raceUtc, tz);
  const info = getCircuitInfo(next.circuitId) ?? getCircuitInfo(next.id);

  // ① 周末时间表（共享视图，含本机时区换算说明）
  const table = `<div class="table-scroll">${sessionsPanelHtml({ race: next, forecast, now })}</div>`;

  // ② 正赛日天气概览（预报里真的有这一天的完整数据时才出现，缺值不显示 NaN）
  const day = forecast ? forecastForRaceDay(forecast, next) : null;
  const dayOk = Boolean(day)
    && Number.isFinite(day.code) && Number.isFinite(day.max)
    && Number.isFinite(day.min) && Number.isFinite(day.rainChance);
  const dayRow = dayOk
    ? statRow([
      { label: '正赛日天气', value: weatherText(day.code) },
      { label: '最高 / 最低', value: `${Math.round(day.max)}° / ${Math.round(day.min)}°` },
      { label: '降水概率', value: `${Math.round(day.rainChance)}%` },
    ])
    : '';

  // ③ 赛道信息：赛季数据（必有）+ 真实规格（缺失即省略）+ 来源
  const metaRow = statRow([
    { label: '赛道', value: next.circuitZh || next.circuit || '—' },
    { label: '城市', value: next.localityZh || next.locality || '—' },
    { label: '国家', value: next.countryZh || next.country || '—' },
    { label: '周末形式', value: next.sprint ? '冲刺周末' : '常规周末' },
    { label: '赛道当地时区', value: `${tz}${offset ? ` (${offset})` : ''}` },
  ]);
  const specs = circuitSpecItems(info);
  const specRow = specs.length ? statRow(specs) : '';
  const sourceNote = info?.source
    ? `<p class="block-note">赛道规格来源（逐条可核对）—— ${escapeHtml(info.source)}</p>`
    : '<p class="block-note">该站赛道规格暂未收录：取不到就不显示，不编造字段。</p>';

  setHTML(host, card('周末时间表 · 本机时区', `${table}${dayRow}`, {
    className: 'next-panel',
    id: 'next-sessions',
    actions: `<span class="card-caption">赛道当地 ${escapeHtml(`${tz}${offset ? ` (${offset})` : ''}`)}</span>`,
  }));
  // 赛道信息卡改挂左列（红卡正下方），内容与上面算出的 metaRow/specRow/sourceNote 完全一致
  if (circuitHost) {
    setHTML(circuitHost, card('赛道信息', `${metaRow}${specRow}${sourceNote}`, {
      className: 'next-panel',
      id: 'next-circuit',
    }));
  }
}

/**
 * 异步补齐下一站天气预报；失败 / 离线只 console.warn，forecast 保持 null。
 * 心跳每 30 秒会重绘右栏，所以用 round 做闸门 + 失败最多重试 3 次，避免反复打接口。
 */
async function ensureNextForecast(race, { force = false } = {}) {
  const round = race?.round;
  if (round == null) return;
  if (force) {
    state.forecast = null;
    state.forecastRound = null;
    state.forecastTries = 0;
  }
  if (state.forecastTryRound !== round) {
    state.forecastTryRound = round;
    state.forecastTries = 0;
    state.forecast = null;
    state.forecastRound = null;
  }
  if (state.forecastPending || state.forecastRound === round || state.forecastTries >= 3) return;

  state.forecastPending = true;
  state.forecastTries += 1;
  try {
    const forecast = await getRaceForecast(race);
    if (state.model?.nextRace?.round !== round) return; // 期间换站了，结果作废
    state.forecast = forecast ?? null;
    state.forecastRound = round; // 成功或「无坐标可取」都算结算完毕
  } catch (err) {
    state.forecast = null;
    console.warn('[schedule] 下一站天气预报获取失败（右栏先不显示天气）：', err?.message ?? err);
  } finally {
    state.forecastPending = false;
    renderNextSide();
  }
}

function renderDone(now) {
  const { model } = state;
  // 最近完赛的排在最前：按 round 倒序
  const done = model.races.filter((r) => r.status === 'completed').sort((a, b) => b.round - a.round);
  const host = byId('cards-done');
  setHTML(host, view.cardsHtml({ races: done, model, now, variant: 'done', base: CARD_BASE }));
  setText(byId('done-note'), `共 ${done.length} 站 · 最近完赛在前`);
}

function renderUpcoming(now) {
  const { model } = state;
  const next = model.nextRace;
  const upcoming = model.races.filter((r) => r.status === 'upcoming' && r.round !== next?.round);
  const host = byId('cards-upcoming');
  setHTML(host, view.cardsHtml({ races: upcoming, model, now, variant: 'upcoming', base: CARD_BASE }));
  setText(byId('upcoming-note'), `共 ${upcoming.length} 站`);
}

/** 只重绘三个卡片区，不碰分区外壳（筛选状态因此不会被重置） */
function renderCards(now = state.now) {
  if (!state.model) return;
  renderNext(now);
  renderDone(now);
  renderUpcoming(now);
}

function renderStatus(now) {
  if (!state.model) return;
  setHTML(byId('status-bar'), view.statusBarHtml({ model: state.model, info: state.info, now }));
}

/* ------------------------------------------------------------------ 筛选 */

/** 应用筛选：切换分区可见性 + 同步按钮高亮 + 重绘卡片区 */
function applyFilter(tab = state.tab) {
  state.tab = TABS.includes(tab) ? tab : 'all';
  const shown = TAB_BANDS[state.tab];
  ALL_BANDS.forEach((id) => {
    const band = byId(id);
    if (band) band.hidden = !shown.includes(id);
  });
  document.querySelectorAll('#schedule-filter .seg-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.tab === state.tab);
  });
  renderCards();
}

/**
 * 自己的筛选监听：挂在控件容器上（不是 document），
 * 因此不会和 bindShellEvents 里服务积分榜的 `.seg-btn` 分支互相干扰
 * ——本页不传 onStandingsTab，那一分支只会切换 is-active。
 */
function bindFilter() {
  const seg = byId('schedule-filter');
  if (!seg) return;
  seg.addEventListener('click', (event) => {
    const btn = event.target.closest('.seg-btn');
    if (!btn || !TABS.includes(btn.dataset.tab)) return;
    applyFilter(btn.dataset.tab);
  });
}

/* ------------------------------------------------------------------ 取数 */

function refreshLiveInBackground() {
  // 启动时的后台补齐：与手动刷新共用 refreshSeq，晚到的结果不许盖掉更新的模型
  const model = state.model;
  const seq = ++refreshSeq;
  refreshLive(model)
    .then((live) => {
      if (!live) return;
      if (seq !== refreshSeq || state.model !== model) return;
      state.model = live;
      mountShell({ race: state.model.nextRace || state.model.lastCompleted, model: live });
      renderCards(Date.now());
      renderStatus(Date.now());
    })
    .catch((err) => console.warn('[schedule] 实时积分榜刷新失败：', err.message));
}

/* ------------------------------------------------------------------ 启动 */

async function boot() {
  // 1) 静态骨架：导航与卡片占位
  setHTML(byId('topnav'), navHtml('schedule', '../'));
  CARD_HOSTS.forEach((id) => setHTML(byId(id), skeleton()));

  // 2) 外壳与主题
  await initSettings();
  applyTheme();
  state.info = await initShellChrome();

  // 3) 先挂事件，再走网络（交互永远有反馈）
  bindShellEvents({
    onRefresh: () => {
      if (!state.model) return;
      // 手动刷新必须带 force：赛历/积分榜 TTL 是 10 分钟，
      // 只清渲染层缓存不够（主进程那层 5 分钟缓存会把同一份 body 发回来）
      clearCache();
      const model = state.model;
      const seq = ++refreshSeq; // 让在途的后台补齐 / 上一次手动刷新作废
      refreshLive(model, { force: true })
        .then((live) => {
          if (seq !== refreshSeq) return; // 期间已有更新的刷新 → 丢弃本次结果
          if (live) state.model = live;
          mountShell({ race: state.model.nextRace || state.model.lastCompleted, model: state.model });
          renderCards(Date.now());
          renderStatus(Date.now());
          // 手动刷新顺带重取下一站天气预报（force 会清掉闸门，取不到也只是 warn）
          ensureNextForecast(state.model.nextRace, { force: true });
        })
        .catch((err) => console.warn('[schedule] 手动刷新失败：', err.message));
    },
  });
  bindFilter();

  // 4) 内置快照，毫秒级出画面
  try {
    state.model = await loadSeason({});
  } catch (err) {
    console.error('[schedule] 初始化失败：', err);
    CARD_HOSTS.forEach((id) => setHTML(byId(id), errorBox('数据加载失败。', '请检查 assets/data/season.json 是否存在。')));
    return;
  }
  state.now = Date.now();
  mountShell({ race: state.model.nextRace || state.model.lastCompleted, model: state.model });
  applyFilter(state.tab);
  renderStatus(state.now);

  // 5) 实时积分榜后台补齐
  refreshLiveInBackground();

  // 6) 心跳：每秒只走时钟，每 30 秒才重绘较重区块
  onTick((now) => {
    state.now = now;
    const previousRace = state.model.nextRace;
    retime(state.model, now);
    if (previousRace !== state.model.nextRace) {
      mountShell({ race: state.model.nextRace || state.model.lastCompleted, model: state.model });
      renderCards(now);
    }
    renderClocks(state.model?.nextRace || state.model?.lastCompleted, now);
    if (now - state.lastSlowPaint > 30_000) {
      state.lastSlowPaint = now;
      renderCards(now);
      renderStatus(now);
    }
  });
}

document.title = `赛历 · ${APP_NAME}`;
boot();
