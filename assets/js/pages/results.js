/**
 * 成绩页控制器（pages/results.html）。
 *
 * 职责边界：只做「取数 → 交给视图 → 挂事件」。
 * 所有成绩面板一律复用 assets/js/ui/race.js 的现成渲染函数，
 * 本文件不拼任何表格 —— 这样分站详情页与本页永远同源同版式。
 *
 * 站次选择器列出全部已完赛分站（round 倒序），默认选中 model.lastCompleted.round。
 */

import { APP_NAME, AUTO_REFRESH_MS } from '../config.js';
import { loadSeason, refreshLive, raceResults, raceQualifying } from '../data/season.js';
import { clearCache } from '../net.js';
import { circuitTimeZone } from '../data/maps.js';
import { initSettings, subscribeSettings } from '../store.js';
import { onTick } from '../domain/schedule.js';
import {
  navHtml, mountShell, renderClocks, applyTheme, initShellChrome,
  bindShellEvents, favoritesSnapshot,
} from '../ui/shell.js';
import { statusBarHtml } from '../ui/dashboard.js';
import { byId, setHTML, setText, escapeHtml, surnameOf, fmtDateRange, toInt } from '../utils.js';
import { skeleton, errorBox, emptyBox, statRow } from '../ui/atoms.js';
import * as view from '../ui/race.js';

const state = {
  model: null,
  round: null,
  info: null,
  now: Date.now(),
  pickerKey: '',
  lastPaint: 0,
};

/** 站次选择器与红色态等所有成绩面板的挂载点 */
const PANELS = ['result-body', 'qualifying-body', 'pit-body', 'circuit-body', 'winners-body'];

/** 每次刷新自增的序号：await 回来后对不上就丢弃结果，避免旧请求把新模型盖回去 */
let refreshSeq = 0;

/** 刷新闸门：自动刷新撞上手动刷新时跳过本轮，避免同一时刻两条 live 请求 */
let refreshing = false;

const setPanels = (html) => PANELS.forEach((id) => setHTML(byId(id), html));

/** 已完赛分站，按 round 倒序（最新在最前） */
function completedRaces() {
  return (state.model?.races || [])
    .filter((r) => r.status === 'completed')
    .sort((a, b) => b.round - a.round);
}

const currentRace = () => state.model?.byRound.get(state.round) || null;

/* ------------------------------------------------------------------ 站次选择器 */

function renderPicker() {
  const select = byId('round-select');
  if (!select) return;
  const races = completedRaces();

  // 选项集变化时才重建，否则心跳重绘会把用户展开的下拉关掉
  const key = races.map((r) => r.round).join(',');
  if (key !== state.pickerKey) {
    setHTML(
      select,
      races
        .map((r) => `<option value="${escapeHtml(String(r.round))}">${escapeHtml(`R${r.round} · ${r.name}`)}</option>`)
        .join(''),
    );
    state.pickerKey = key;
  }

  select.disabled = races.length === 0;
  const value = state.round == null ? '' : String(state.round);
  if (select.value !== value) select.value = value;
}

/* ------------------------------------------------------------------ 本站概要 */

/** 概要条只放真实字段：没有的字段直接不渲染，不做任何补零或编造。 */
function renderBand() {
  const { model } = state;
  const race = currentRace();

  if (!race) {
    setText(byId('band-title'), '本站数据不可用');
    setText(byId('band-note'), '');
    setHTML(byId('round-stats'), emptyBox('没有可显示的分站。'));
    return;
  }

  const rows = raceResults(model, race.round);
  const winner = rows[0] || null;
  const fastest = rows.find((r) => r.fastestLap) || null;
  const pole = raceQualifying(model, race.round)[0] || null;
  const firstUtc = race.sessions[0]?.utc ?? race.raceUtc;

  // 快照里 status 只有四种取值：Finished / Lapped / Retired / Did not start。
  // 按官方分类口径，Finished 与 Lapped 都算完赛（被套圈仍被分类），因此两者相加。
  const classified = rows.filter((r) => r.status === 'Finished' || r.status === 'Lapped').length;
  const retired = rows.filter((r) => r.status === 'Retired').length;
  // 分母只数真正发过车的：Did not start 既不完赛也不退赛，留在分母里会稀释「完赛 / 发车」
  const started = rows.filter((r) => r.status !== 'Did not start').length;

  setText(byId('band-title'), `R${race.round} · ${race.name}`);
  setText(byId('band-note'), `${race.circuit} · ${race.locality}, ${race.country}`);

  const items = [
    { label: '赛道当地日期', value: fmtDateRange(firstUtc, race.raceUtc, circuitTimeZone(race.id)) },
    winner ? { label: '分站冠军', value: surnameOf(winner) } : null,
    fastest ? { label: '最快圈', value: surnameOf(fastest) } : null,
    pole ? { label: '杆位', value: surnameOf(pole) } : null,
    started ? { label: '完赛 / 发车', value: `${classified} / ${started}` } : null,
    retired ? { label: '退赛', value: String(retired) } : null,
    winner?.laps ? { label: '冠军圈数', value: `${winner.laps} 圈` } : null,
  ].filter(Boolean);

  setHTML(
    byId('round-stats'),
    items.length
      ? `${statRow(items)}<p class="block-note">完赛口径：官方分类成绩（Finished 与 Lapped 均计为完赛）；数据来自 jolpi.ca 赛季快照。</p>`
      : emptyBox('该分站暂无统计数据。'),
  );
  setHTML(byId('podium-body'), view.podiumSpotlightHtml({ model, race, base: '../' }));
}

/* ------------------------------------------------------------------ 渲染 */

function render() {
  const { model } = state;
  if (!model) return;
  state.now = Date.now();

  const race = currentRace();

  renderPicker();
  // 黑次栏与数据源徽标跟着「选中的站」走，切站时用户能看到上方信息同步变化
  mountShell({ race: race || model.lastCompleted || null, model });
  setHTML(byId('status-bar'), statusBarHtml({ model, info: state.info, now: state.now }));
  renderBand();

  if (!race) {
    setPanels(emptyBox('该分站不可用。'));
    setText(byId('result-caption'), '');
    setText(byId('winners-caption'), '');
    return;
  }

  // 全部复用 ui/race.js：本页不重复实现任何表格
  setHTML(byId('result-body'), view.resultPanelHtml({ model, race, favorites: favoritesSnapshot(), base: '../' }));
  setHTML(byId('qualifying-body'), view.qualifyingPanelHtml({ model, race, base: '../' }));
  setHTML(byId('pit-body'), view.pitPanelHtml({ model, race }));
  setHTML(byId('circuit-body'), view.circuitPanelHtml({ race }));
  setHTML(byId('winners-body'), view.seasonWinnersHtml({ model, base: '../' }));

  setText(byId('result-caption'), `${race.nameZh} · R${race.round}`);
  setText(byId('winners-caption'), `共 ${model.races.filter((r) => r.status === 'completed').length} 站已完赛`);
}

/* ------------------------------------------------------------------ 事件 */

function bindEvents() {
  byId('round-select')?.addEventListener('change', (event) => {
    const next = toInt(event.target.value, NaN);
    if (!Number.isFinite(next) || next === state.round) return;
    state.round = next;
    render();
  });
}

/* ------------------------------------------------------------------ 取数 */

/**
 * 后台刷新：**只**重取实时积分榜，成功才原地重绘。
 *
 * 刻意不再走 loadSeason()：成绩/排位/停站本来就来自快照，重读快照只会把已经切到
 * 实时数据的 state.model 先降级成快照再升回来 —— 表格与状态条会闪一下旧数据。
 * force=true（手动刷新）清掉渲染层缓存，并把 force 一路透到 net.js（主进程那层
 * 5 分钟缓存也靠它绕过）。
 */
async function refreshData(force = false) {
  if (!state.model) return;
  if (refreshing) return; // 闸门：正在刷新时不再重入
  refreshing = true;
  const seq = ++refreshSeq; // 让在途的旧刷新 / 启动时的后台补齐作废
  if (force) clearCache();
  try {
    const live = await refreshLive(state.model, { force });
    if (seq !== refreshSeq) return; // 期间已有更新的刷新 → 丢弃本次结果，不写回不重绘
    if (!live) return; // 取不到实时数据：保留当前模型（可能仍是快照），等下一轮或手动刷新
    state.model = live;
    render();
  } catch (err) {
    console.warn('[results] 自动刷新失败：', err.message);
  } finally {
    refreshing = false;
  }
}

async function boot() {
  // 1) 先把导航注入静态骨架
  setHTML(byId('topnav'), navHtml('results', '../'));

  // 2) 外壳与主题
  await initSettings();
  applyTheme();
  state.info = await initShellChrome();

  // 3) 先注册事件，再做任何网络请求（否则交互没有反馈）
  bindShellEvents({
    onFavoritesChanged: () => render(),
    // #act-refresh：手动刷新走 force，绕过渲染层与主进程两层缓存
    onRefresh: () => refreshData(true),
  });
  document.title = `成绩 · ${APP_NAME}`;

  setPanels(skeleton());
  setHTML(byId('round-stats'), skeleton('本站概要加载中…'));
  bindEvents();

  // 4) 内置快照立刻出画面（毫秒级）
  try {
    state.model = await loadSeason({});
  } catch (err) {
    console.error('[results] 赛季数据加载失败：', err);
    setText(byId('band-title'), '数据加载失败');
    setHTML(byId('round-stats'), errorBox('数据加载失败。', '请检查 assets/data/season.json 是否存在。'));
    setPanels(errorBox('数据加载失败。', '请检查 assets/data/season.json 是否存在。'));
    return;
  }

  const completed = completedRaces();
  state.round = state.model.lastCompleted?.round ?? completed[0]?.round ?? null;
  render();

  // 5) 实时积分榜后台补齐
  const liveSeq = ++refreshSeq;
  const captured = state.model;
  refreshLive(captured)
    .then((live) => {
      if (!live) return;
      // await 期间用户切了站 / 定时刷新已写入更新的模型 → 丢弃这次结果，不写回不重绘
      if (liveSeq !== refreshSeq || state.model !== captured) return;
      state.model = live;
      render();
    })
    .catch((err) => console.warn('[results] 实时积分榜不可用：', err.message));

  // 6) 心跳：每秒只更新时钟；每 30 秒才重绘较重区块
  onTick((now) => {
    state.now = now;
    renderClocks(currentRace() || state.model?.lastCompleted, now);
    if (now - state.lastPaint > 30_000) {
      state.lastPaint = now;
      render();
    }
  });

  subscribeSettings(() => render());

  // 7) 低频自刷新：后台重取实时积分榜，拿到才原地重绘（不再用快照覆盖已显示的数据）
  setInterval(() => refreshData(false), AUTO_REFRESH_MS);
}

boot();
