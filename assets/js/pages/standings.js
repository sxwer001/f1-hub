/**
 * 积分榜页控制器：车手 / 车队完整积分榜 + 关注置顶 + 领先者小结。
 * 只负责「取数 → 交给共享视图 → 挂事件」，表格 HTML 一律由 ui/dashboard.js 产出。
 */

import { APP_NAME, AUTO_REFRESH_MS } from '../config.js';
import { loadSeason, refreshLive, retime } from '../data/season.js';
import { initSettings, favoriteRank } from '../store.js';
import { onTick } from '../domain/schedule.js';
import { clearCache } from '../net.js';
import {
  navHtml, mountShell, renderClocks, applyTheme, initShellChrome,
  bindShellEvents, favoritesSnapshot,
} from '../ui/shell.js';
import { standingsHtml, statusBarHtml } from '../ui/dashboard.js';
import { card, statRow, emptyBox, errorBox } from '../ui/atoms.js';
import { byId, setHTML, setText, surnameOf, escapeHtml } from '../utils.js';

/** 两张表的说明文案（专有名词一律英文，与官网一致） */
const NOTES = {
  drivers: '车手姓名用英文姓氏（如 Verstappen），车队用英文名（如 Red Bull Racing）。点 ★ 可关注，关注项在表中高亮置顶。',
  constructors: '车队用英文名（如 Red Bull Racing），车手姓名用英文姓氏（如 Verstappen）。点 ★ 可关注，关注项在表中高亮置顶。',
};

const state = { model: null, info: {}, tab: 'drivers', now: Date.now(), lastSlowPaint: 0 };
let refreshTimer = null;
/** 每次刷新自增的序号：await 回来后对不上就丢弃结果，避免旧请求把新模型盖回去 */
let refreshSeq = 0;
/** loading 闸门：同一时刻只允许一次刷新，自动刷新撞上手动刷新时直接跳过 */
let refreshing = false;

/* ------------------------------------------------------------------ 小工具 */

/** 积分可能是 .5（冲刺周末），整数不显示小数位 */
function fmtPoints(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** 分差：真数据相减，缺数据时按 0 算 */
const gapOf = (first, second) => Number(first?.points ?? 0) - Number(second?.points ?? 0);

/** 取前两名：显式按 pos 排序，不假设上游数组顺序 */
const topTwo = (rows) => [...(rows || [])].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0)).slice(0, 2);

/**
 * 关注项置顶：共享的 favoriteRank 给权重（关注车手 < 关注车队 < 其它），
 * 同权重内保持原有名次顺序，因此用的是稳定排序。
 */
function pinnedRows(rows) {
  return [...(rows || [])].sort((a, b) => favoriteRank(a) - favoriteRank(b) || (a.pos ?? 0) - (b.pos ?? 0));
}

/* ------------------------------------------------------------------ 渲染 */

function renderOverview() {
  const model = state.model;
  if (!model) return;
  const completed = model.races.filter((r) => r.status === 'completed').length;
  setHTML(
    byId('overview-body'),
    statRow([
      { label: '积分榜截至', value: `第 ${model.standingsRound} 站` },
      { label: '车手', value: `${model.drivers.length} 人` },
      { label: '车队', value: `${model.constructors.length} 支` },
      { label: '数据来源', value: model.source === 'live' ? '实时数据' : '离线快照' },
    ]),
  );
  setText(byId('overview-note'), `${completed} 站已完赛 / 共 ${model.races.length} 站`);
}

function syncSeg() {
  document.querySelectorAll('.seg-btn').forEach((btn) => {
    const on = btn.dataset.tab === state.tab;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function renderStandings() {
  const model = state.model;
  if (!model) return;
  const isDriver = state.tab !== 'constructors';
  const rows = pinnedRows(isDriver ? model.drivers : model.constructors);
  setHTML(
    byId('standings-body'),
    standingsHtml({
      rows,
      type: isDriver ? 'driver' : 'constructor',
      favorites: favoritesSnapshot(),
      base: '../',
    }),
  );
  syncSeg();
  setText(byId('standings-note'), `共 ${rows.length} ${isDriver ? '位车手' : '支车队'}。${NOTES[isDriver ? 'drivers' : 'constructors']}`);
}

/** 领先者小结：第一与第二名的真实分差 */
function renderLeaders() {
  const model = state.model;
  const [d1, d2] = topTwo(model.drivers);
  const [c1, c2] = topTwo(model.constructors);
  if (!d1 || !c1) {
    setHTML(byId('leaders-body'), card('领先者小结', emptyBox('积分榜暂无数据。')));
    return;
  }

  const dGap = gapOf(d1, d2);
  const cGap = gapOf(c1, c2);
  const group = (label, first, second, gap, nameOf) => `
    <p class="block-note">${escapeHtml(label)}</p>
    ${statRow([
      { label: `P1 ${nameOf(first)}`, value: fmtPoints(first.points) },
      { label: `P2 ${second ? nameOf(second) : '—'}`, value: fmtPoints(second?.points ?? 0) },
      { label: 'P1 − P2 分差', value: `${fmtPoints(gap)} 分` },
    ])}`;

  setHTML(
    byId('leaders-body'),
    card(
      '领先者小结',
      `${group('车手榜', d1, d2, dGap, surnameOf)}
       ${group('车队榜', c1, c2, cGap, (r) => r.team)}
       <p class="block-note">分差按真实积分相减：车手榜 ${escapeHtml(fmtPoints(d1.points))} − ${escapeHtml(fmtPoints(d2?.points ?? 0))} = ${escapeHtml(fmtPoints(dGap))} 分；车队榜 ${escapeHtml(fmtPoints(c1.points))} − ${escapeHtml(fmtPoints(c2?.points ?? 0))} = ${escapeHtml(fmtPoints(cGap))} 分。</p>`,
    ),
  );
}

function renderStatus(now = Date.now()) {
  if (!state.model) return;
  setHTML(byId('status-bar'), statusBarHtml({ model: state.model, info: state.info, now }));
}

function renderAll(now = Date.now()) {
  renderOverview();
  renderStandings();
  renderLeaders();
  renderStatus(now);
}

/* ------------------------------------------------------------------ 取数 */

async function refreshData(force = false) {
  if (!state.model) return;
  if (refreshing) return; // 闸门：正在刷新时不再重入（自动刷新撞上手动刷新就跳过本轮）
  refreshing = true;
  const seq = ++refreshSeq; // 让在途的旧刷新 / 后台补齐作废
  if (force) clearCache();
  try {
    // force 必须一路透下去：只清渲染层缓存不够，主进程那层还有一份 5 分钟 TTL 缓存
    const live = await refreshLive(state.model, { force });
    if (seq !== refreshSeq) return; // 期间已有更新的刷新 → 丢弃本次结果，不写回不重绘
    if (!live) {
      renderStatus(Date.now());
      return;
    }
    state.model = live;
    mountShell({ race: live.nextRace || live.lastCompleted, model: live });
    renderAll();
  } catch (err) {
    console.warn('[standings] 刷新失败：', err.message);
  } finally {
    refreshing = false;
  }
}

/* ------------------------------------------------------------------ 启动 */

async function boot() {
  setHTML(byId('topnav'), navHtml('standings', '../'));
  document.title = `积分榜 · ${APP_NAME}`;

  // 外壳与主题
  await initSettings();
  applyTheme();
  state.info = await initShellChrome();

  // 先注册事件，再做任何网络请求（否则交互没有反馈）
  bindShellEvents({
    onFavoritesChanged: () => renderAll(),
    onStandingsTab: (tab) => {
      state.tab = tab === 'constructors' ? 'constructors' : 'drivers';
      renderStandings();
    },
    onRefresh: () => refreshData(true),
  });

  // 内置快照立刻出画面
  try {
    state.model = await loadSeason({});
  } catch (err) {
    console.error('[standings] 初始化失败：', err);
    setHTML(byId('overview-body'), errorBox('数据加载失败。', '请确认 assets/data/season.json 是否存在。'));
    setHTML(byId('standings-body'), errorBox('积分榜加载失败。', '请检查网络，或确认内置快照存在。'));
    setHTML(byId('leaders-body'), errorBox('领先者数据不可用。'));
    return;
  }

  mountShell({ race: state.model.nextRace || state.model.lastCompleted, model: state.model });
  renderAll();

  // 实时积分榜后台补齐
  const liveSeq = ++refreshSeq;
  const captured = state.model;
  refreshLive(captured)
    .then((live) => {
      if (!live) return;
      // await 期间用户手动刷新过 / 又发起了新一轮 → 旧结果作废，不覆盖新模型
      if (liveSeq !== refreshSeq || state.model !== captured) return;
      state.model = live;
      mountShell({ race: live.nextRace || live.lastCompleted, model: live });
      renderAll();
    })
    .catch((err) => console.warn('[standings] 实时积分榜不可用：', err.message));

  // 心跳：每秒更新时钟，每 30 秒才重绘状态栏
  onTick((now) => {
    state.now = now;
    const previousRace = state.model.nextRace;
    retime(state.model, now);
    if (previousRace !== state.model.nextRace) {
      mountShell({ race: state.model.nextRace || state.model.lastCompleted, model: state.model });
      renderAll(now);
    }
    renderClocks(state.model?.nextRace || state.model?.lastCompleted, now);
    if (now - state.lastSlowPaint > 30_000) {
      state.lastSlowPaint = now;
      renderStatus(now);
    }
  });

  refreshTimer = setInterval(() => refreshData(false), AUTO_REFRESH_MS);
  window.addEventListener('beforeunload', () => {
    if (refreshTimer) clearInterval(refreshTimer);
  });
}

boot();
