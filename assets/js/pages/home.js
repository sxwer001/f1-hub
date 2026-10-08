/**
 * 首页控制器：**下一站焦点**。
 *
 * 用户要求首页只保留三块内容，其余一律进各自独立页面（顶栏导航进入）：
 *   ① 下一站倒计时：距下一节会话 + 英文站名 + 赛道 / 本机时间 / 赛道当地时间 + 4 格倒计时
 *   ② 下一站的具体数据与时间：硬数据 statRow + 完整周末时间表（本机时区、天气、状态）
 *   ③ 相关新闻（Formula 1 官方 RSS；点击经 bindShellEvents 的 data-external 分支交给系统浏览器）
 *
 * 已从首页移除：照片大图 hero、赛季概览 stat 条、四条栏目入口卡片、积分榜前三、设置大卡片。
 * 「本赛季已完成 / 积分榜」等完整数据只在 pages/ 下的独立页面里，首页不再出现。
 * 提醒与设置不再占版面 —— 只留页脚一行文字 + #act-test-notify / #act-about 两个小按钮。
 *
 * 倒计时容器（.home-strip / #hero-count-target）**没有任何红色竖条装饰**：
 * 没有 border-left、没有 ::before 窄条、也没有 box-shadow: inset … var(--brand)。
 */

import { AUTO_REFRESH_MS, SEASON_YEAR } from '../config.js';
import { clearCache } from '../net.js';
import { loadSeason, refreshLive, sessionState, retime } from '../data/season.js';
import { getNews } from '../data/news.js';
import { circuitTimeZone } from '../data/maps.js';
import { getRaceForecast } from '../data/weather.js';
import { initSettings } from '../store.js';
import {
  byId, escapeHtml, fmtDateRange, fmtDateTime, fmtZoneDateTime, setHTML, setText, tzLabel,
} from '../utils.js';
import { countdownHtml, emptyBox, errorBox, statRow } from '../ui/atoms.js';
import { newsHtml, statusBarHtml } from '../ui/dashboard.js';
import { sessionsPanelHtml } from '../ui/race.js';
import { applyTheme, bindShellEvents, initShellChrome, mountShell, navHtml, renderClocks } from '../ui/shell.js';
import { countdownCells, onTick } from '../domain/schedule.js';

const MAX_NEWS = 8;

const state = {
  model: null,
  info: null,
  /** 焦点站天气（Open-Meteo 异步取回）。失败保持 null，时间表照常渲染，天气列显示 — */
  forecast: null,
  /** forecast 属于哪一站 —— 焦点站变化后旧预报不能再用 */
  forecastRaceId: null,
  news: [],
  newsLoaded: false,
  newsFailed: false,
};

/** 定时器与订阅的清理句柄 */
const cleanups = [];
let lastHeavyTick = 0;
let loading = false;
/**
 * 每次刷新自增的序号。await 回来后序号对不上，说明期间又发起过更新的刷新，
 * 本次结果必须丢弃 —— 否则旧请求回来会把新模型盖回去。
 */
let refreshSeq = 0;

/** 焦点站：优先下一站；赛季全部结束后退回最近一站（页面仍有内容可看） */
const currentRace = (model = state.model) => model?.nextRace || model?.lastCompleted || null;

/* ------------------------------------------------------------------ 渲染 */

/**
 * ① 下一站倒计时。
 * 结构固定 —— 永远含 #hero-count-target，且其内是 4 个 .cd-cell（每秒心跳只换它的内容）。
 */
function countdownStripHtml({ model, now }) {
  const race = currentRace(model);

  if (!race) {
    return `<div class="home-strip-copy">
        <span class="cd-strip-label">${escapeHtml(String(model.season ?? SEASON_YEAR))} 赛季</span>
        <h2 class="cd-strip-title">暂无分站数据</h2>
        <span class="cd-strip-note">请点击右上角「刷新数据」重试。</span>
      </div>
      <span id="hero-count-target" class="home-strip-cells">${countdownHtml(countdownCells(0))}</span>`;
  }

  const sessions = race.sessions || [];
  const pending = sessions.find((s) => sessionState(s, now) !== 'done') || null;
  const target = pending || sessions[sessions.length - 1] || null;
  const live = pending ? sessionState(pending, now) === 'live' : false;
  const ms = pending?.ts ? Math.max(0, pending.ts - now) : 0;
  const tz = circuitTimeZone(race.id);

  // 会话名用英文（专有名词一律英文），与 ui/dashboard.js 的 heroStripHtml 同一口径
  const label = live
    ? `${pending.labelEn} 进行中`
    : pending
      ? `距 ${pending.labelEn}`
      : '本周末赛程已结束';

  // 赛道 · 本机时间 · 赛道当地时间
  const note = [
    race.circuit,
    `${fmtDateTime(target?.utc)}（本机 ${tzLabel()}）`,
    `赛道当地 ${fmtZoneDateTime(target?.utc, tz)}`,
  ]
    .filter(Boolean)
    .map((part) => escapeHtml(String(part)))
    .join(' · ');

  return `<div class="home-strip-copy">
      <span class="cd-strip-label">${escapeHtml(label)}</span>
      <h2 class="cd-strip-title">${escapeHtml(race.name)}</h2>
      <span class="cd-strip-note">${note}</span>
    </div>
    <span id="hero-count-target" class="home-strip-cells">${countdownHtml(countdownCells(ms))}</span>`;
}

function renderCountdown(now = Date.now()) {
  const host = byId('hero');
  if (!host) return;
  if (!state.model) {
    setHTML(host, '<p class="state state-loading">正在载入赛季数据…</p>');
    return;
  }
  setHTML(host, countdownStripHtml({ model: state.model, now }));
}

/**
 * 该站硬数据。
 * 只渲染数据里真实存在的字段 —— 缺哪个就不渲染哪一格，绝不补假值。
 * tone 只落在真实语义上：日期与赛道名是这一格的「主体」用 --ink 提重（.tone-ink），
 * 城市 / 国家 / 周末形式 / 时区保持中性，不给所有格子都上色。
 */
function raceStatItems(race) {
  const items = [];
  const tz = circuitTimeZone(race.id);
  const firstUtc = race.sessions?.[0]?.utc ?? race.raceUtc ?? null;

  if (firstUtc && race.raceUtc) items.push({ label: '周末日期', value: fmtDateRange(firstUtc, race.raceUtc, tz), tone: 'strong' });
  if (race.circuit) items.push({ label: '赛道', value: race.circuit, tone: 'strong' });
  if (race.locality) items.push({ label: '城市', value: race.locality });
  if (race.country) items.push({ label: '国家', value: race.country });
  if (typeof race.sprint === 'boolean') {
    items.push({ label: '周末形式', value: race.sprint ? '冲刺周末' : '常规周末' });
  }
  if (tz) items.push({ label: '赛道时区', value: tz });

  return items;
}

/** ② 下一站的具体数据与时间：硬数据 + 完整周末时间表（含天气，天气取不到时该列为 —） */
function renderRacePanel(now = Date.now()) {
  const host = byId('race-body');
  if (!host) return;
  if (!state.model) return;

  const race = currentRace();
  if (!race) {
    setText(byId('race-caption'), '');
    setHTML(host, emptyBox('暂无下一站数据。'));
    return;
  }

  const caption = [];
  if (race.round) caption.push(`ROUND ${race.round} / ${state.model.races.length}`);
  if (typeof race.sprint === 'boolean') caption.push(race.sprint ? '冲刺周末' : '常规周末');
  setText(byId('race-caption'), caption.join(' · '));

  const stats = raceStatItems(race);
  const forecast = state.forecastRaceId === race.id ? state.forecast : null;
  setHTML(
    host,
    `${stats.length ? statRow(stats) : ''}${sessionsPanelHtml({ race, forecast, now })}`,
  );
}

/** ③ 相关新闻 */
function renderNews() {
  const host = byId('news-body');
  if (!host) return;
  // 首次加载还没回来时保持骨架屏，避免先闪一下「暂无新闻」
  if (!state.newsLoaded) return;
  // 新闻失败只降级成空态，不报错、不弹窗
  if (!state.news.length) {
    setHTML(host, emptyBox(state.newsFailed ? '新闻暂时不可用。' : '暂无新闻。'));
    return;
  }
  setHTML(host, newsHtml(state.news));
}

function renderStatus(now = Date.now()) {
  if (!state.model) return;
  setHTML(byId('status-bar'), statusBarHtml({ model: state.model, info: state.info || {}, now }));
}

function renderAll(now = Date.now()) {
  renderCountdown(now);
  renderRacePanel(now);
  renderNews();
  renderStatus(now);
}

/* -------------------------------------------------------------- 数据流程 */

async function refreshAll(force = false) {
  if (loading) return;
  loading = true;
  const seq = ++refreshSeq; // 让在途的旧刷新 / 后台补齐全部作废
  try {
    if (force) clearCache();
    // force 必须一路透下去：net.js 的渲染层缓存与主进程那层缓存都要绕过
    const model = state.model ? retime(state.model) : await loadSeason({ now: Date.now(), force });
    if (seq !== refreshSeq) return; // 期间已有更新的刷新 → 丢弃本次结果，不写回不重绘
    state.model = model;
    renderAll();
    mountShell({ race: currentRace(), model });
    refreshLiveInBackground(force);
    // 天气也是刷新的一部分：焦点站换站后必须重取，否则天气列会一直是一片「—」
    loadForecast().catch((err) => console.warn('[home] 天气加载异常：', err?.message ?? err));
  } catch (err) {
    if (seq !== refreshSeq) return; // 已经不作数了，别再往界面上画错误态
    console.warn('[home] 赛季数据加载失败：', err?.message ?? err);
    setHTML(
      byId('hero'),
      errorBox('赛季数据加载失败。', '请检查网络后点击右上角「刷新数据」重试。'),
    );
    setText(byId('race-caption'), '数据不可用');
    setHTML(byId('race-body'), errorBox('下一站数据不可用。'));
  } finally {
    loading = false;
  }
}

/** 实时积分榜后台补齐：失败返回 null，沿用快照即可 */
function refreshLiveInBackground(force = false) {
  const model = state.model;
  if (!model) return;
  const seq = ++refreshSeq;
  Promise.resolve(refreshLive(model, { force }))
    .then((next) => {
      if (!next) return;
      // 期间用户手动刷新过、或又发起了新一轮补齐 → 本次结果作废，不写回也不重绘
      if (seq !== refreshSeq || state.model !== model) return;
      state.model = next;
      renderCountdown();
      renderRacePanel();
      renderStatus();
      mountShell({ race: currentRace(), model: next });
    })
    .catch((err) => console.warn('[home] 实时数据补齐失败：', err?.message ?? err));
}

/** 天气是「可选增强」：失败就传 forecast: null，时间表的天气列显示 —，不报错 */
async function loadForecast() {
  const race = currentRace();
  if (!race) return;
  const raceId = race.id;
  /** 期间换了焦点站 → 这次结果作废，绝不能把旧站的预报贴到新站上 */
  const stillCurrent = () => Boolean(state.model) && currentRace()?.id === raceId;
  try {
    const forecast = await getRaceForecast(race);
    if (!stillCurrent()) return;
    state.forecast = forecast || null;
    state.forecastRaceId = raceId;
  } catch (err) {
    console.warn('[home] 天气加载失败：', err?.message ?? err);
    if (!stillCurrent()) return;
    state.forecast = null;
    state.forecastRaceId = raceId;
  }
  // 预报回来后重绘该面板；渲染异常只降级成警告 —— 天气是可选增强，不能变成未处理拒绝
  try {
    if (stillCurrent()) renderRacePanel(Date.now());
  } catch (err) {
    console.warn('[home] 天气面板重绘失败：', err?.message ?? err);
  }
}

async function loadNews() {
  try {
    const items = await getNews(MAX_NEWS);
    state.news = Array.isArray(items) ? items.slice(0, MAX_NEWS) : [];
    state.newsFailed = false;
  } catch (err) {
    console.warn('[home] 新闻加载失败：', err?.message ?? err);
    state.news = [];
    state.newsFailed = true;
  }
  state.newsLoaded = true;
  // 渲染同样放进 try：渲染异常只降级成警告，不能冒泡成渲染层的未处理拒绝
  try {
    renderNews();
  } catch (err) {
    console.warn('[home] 新闻渲染失败：', err?.message ?? err);
  }
}

/* -------------------------------------------------------------- 心跳 */

function handleTick(now) {
  if (state.model) {
    const previousRace = currentRace();
    retime(state.model, now);
    if (currentRace() !== previousRace) {
      mountShell({ race: currentRace(), model: state.model });
      renderAll(now);
      loadForecast().catch((err) => console.warn('[home] 天气加载异常：', err?.message ?? err));
    }
    const target = byId('hero-count-target');
    if (target) {
      // 只换倒计时数字，避免整块重绘；结构必须保持 4 个 .cd-cell
      const session = currentRace()?.sessions.find((s) => sessionState(s, now) !== 'done');
      const key = session ? `${currentRace().round}:${session.key}:${sessionState(session, now)}` : '';
      if (target.dataset.session !== key) renderCountdown(now);
      const cells = byId('hero-count-target');
      cells.dataset.session = key;
      cells.innerHTML = countdownHtml(countdownCells(session?.ts ? Math.max(0, session.ts - now) : 0));
    }
    renderClocks(currentRace(), now);
  }
  // 每 30 秒才重绘较重区块（时间表状态、状态栏相对时间）
  if (now - lastHeavyTick >= 30_000) {
    lastHeavyTick = now;
    renderCountdown(now);
    renderRacePanel(now);
    renderStatus(now);
  }
}

/* -------------------------------------------------------------- 启动 */

function teardown() {
  cleanups.forEach((fn) => {
    try {
      fn();
    } catch {
      /* 卸载阶段的异常忽略 */
    }
  });
  cleanups.length = 0;
}

async function boot() {
  try {
    await initSettings();
  } catch (err) {
    console.warn('[home] 设置读取失败：', err?.message ?? err);
  }
  applyTheme();

  // 首页不属于 4 项导航，active 传空串 → 4 项都不高亮；logo 即回首页
  setHTML(byId('topnav'), navHtml('', ''));
  renderCountdown();

  state.info = (await initShellChrome().catch((err) => {
    console.warn('[home] 外壳信息读取失败：', err?.message ?? err);
    return null;
  })) || {};

  // 先注册事件（#act-refresh / #act-test-notify / #act-about 由外壳统一处理），再做网络请求
  bindShellEvents({
    onRefresh: async (id) => {
      if (id === 'act-test-notify') return; // 外壳已处理
      await refreshAll(true);
    },
  });

  // 首页的第一次季节数据 + 天气都走 refreshAll（天气在模型写回之后再取）
  await refreshAll(false);
  loadNews().catch((err) => console.warn('[home] 新闻加载异常：', err?.message ?? err));

  cleanups.push(onTick(handleTick));

  // 自动刷新（refreshAll 内部含天气重取）
  const refreshTimer = setInterval(() => {
    refreshAll(false).catch((err) => console.warn('[home] 自动刷新异常：', err?.message ?? err));
    loadNews().catch((err) => console.warn('[home] 新闻加载异常：', err?.message ?? err));
  }, AUTO_REFRESH_MS);
  cleanups.push(() => clearInterval(refreshTimer));

  window.addEventListener('beforeunload', teardown);
}

boot();
