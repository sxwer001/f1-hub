/**
 * 分站详情控制器。
 * 路由：pages/race.html?round=<1..23>（缺省取下一站）
 */

import { APP_NAME, AUTO_REFRESH_MS } from '../config.js';
import { loadSeason, refreshLive, retime } from '../data/season.js';
import { clearCache } from '../net.js';
import { getRaceForecast } from '../data/weather.js';
import { initSettings, subscribeSettings } from '../store.js';
import { onTick } from '../domain/schedule.js';
import { byId, setHTML, toInt } from '../utils.js';
import { skeleton, errorBox, emptyBox } from '../ui/atoms.js';
import {
  mountShell, renderClocks, applyTheme, initShellChrome, bindShellEvents, favoritesSnapshot,
} from '../ui/shell.js';
import * as view from '../ui/race.js';

const state = { model: null, race: null, forecast: null, forecastRaceId: null, lastPaint: 0 };

let refreshing = false;

function resolveRound(params, model) {
  const raw = params.get('round');
  const round = raw === null ? null : toInt(raw, NaN);
  if (Number.isFinite(round) && model.byRound.has(round)) return round;
  return model.nextRace?.round ?? model.races[model.races.length - 1]?.round ?? null;
}

function render() {
  const { race, model } = state;
  if (!race) return;
  const now = Date.now();
  // 预报只对「取它时的那一站」有效：站换了就当作没有天气，别把旧站的预报画到新站上
  const forecast = state.forecastRaceId === race.id ? state.forecast : null;

  document.title = `${race.nameZh} · ${APP_NAME}`;

  setHTML(byId('detail-hero'), view.detailHeroHtml({ race, forecast }));
  setHTML(byId('podium-body'), view.podiumSpotlightHtml({ model, race, base: '../' }));
  setHTML(byId('sessions-body'), view.sessionsPanelHtml({ race, forecast, now }));
  setHTML(byId('result-body'), view.resultPanelHtml({ model, race, favorites: favoritesSnapshot(), base: '../' }));
  setHTML(byId('qualifying-body'), view.qualifyingPanelHtml({ model, race, base: '../' }));
  setHTML(byId('pit-body'), view.pitPanelHtml({ model, race }));
  setHTML(byId('circuit-body'), view.circuitPanelHtml({ race }));
  setHTML(byId('winners-body'), view.seasonWinnersHtml({ model, base: '../' }));

  // 黑次栏 / 双时钟 / 数据源徽标一律复用共享外壳（ui/shell.js），
  // 页面之间只有这一份实现，不会再各自漂移
  mountShell({ race, model });
}

/**
 * 取当前分站的天气预报。
 * 结果回来时目标站必须仍是当前站（对象身份一致），否则丢弃：自动刷新期间
 * state.race 可能已被更新，晚到的旧预报不许覆盖新站的数据。
 */
async function loadForecast(target = state.race) {
  if (!target) return;
  const forecast = await getRaceForecast(target);
  if (state.race !== target) return;
  state.forecast = forecast;
  state.forecastRaceId = target.id;
  render();
}

/**
 * 后台更新积分榜、分站记录与天气，失败保留当前模型。
 * @returns {Promise<boolean>} 是否刷新成功（当前站仍在快照里）
 */
async function refreshAll({ force = false } = {}) {
  if (refreshing || !state.model || !state.race) return false;
  refreshing = true;
  const model = state.model;
  const round = state.race.round;
  try {
    if (force) clearCache();
    retime(model);
    render();
    loadForecast().catch((err) => console.warn('[race] 天气不可用：', err.message));
    const live = await refreshLive(model, { force, rounds: [round] });
    if (!live || state.model !== model) return false;
    state.model = live;
    state.race = live.byRound.get(round);
    render();
    return true;
  } finally {
    refreshing = false;
  }
}

async function boot() {
  setHTML(byId('sessions-body'), skeleton());
  setHTML(byId('result-body'), skeleton());
  setHTML(byId('qualifying-body'), skeleton());
  setHTML(byId('pit-body'), skeleton());
  setHTML(byId('circuit-body'), skeleton());
  setHTML(byId('winners-body'), skeleton());

  await initSettings();
  applyTheme();
  await initShellChrome();
  bindShellEvents({
    onFavoritesChanged: () => render(),
    onRefresh: () => refreshAll({ force: true }).catch((err) => console.warn('[race] 刷新失败：', err.message)),
  });

  try {
    state.model = await loadSeason({});
  } catch (err) {
    console.error('[race] 赛季数据加载失败：', err);
    setHTML(byId('detail-hero'), errorBox('数据加载失败。', '请检查网络，或确认 assets/data/season.json 存在。'));
    ['sessions-body', 'result-body', 'qualifying-body', 'pit-body', 'circuit-body', 'winners-body'].forEach((id) =>
      setHTML(byId(id), emptyBox('不可用')),
    );
    return;
  }

  const round = resolveRound(new URLSearchParams(location.search), state.model);
  state.race = state.model.byRound.get(round);
  if (!state.race) {
    setHTML(byId('detail-hero'), emptyBox('未找到该分站。'));
    return;
  }

  render();

  refreshAll().catch((err) => console.warn('[race] 刷新失败：', err.message));

  onTick((now) => {
    // 会话状态与倒计时随心跳更新（每 30 秒才真正重绘一次，避免闪烁）
    retime(state.model, now);
    renderClocks(state.race, now);
    if (now - (state.lastPaint || 0) < 30_000) return;
    state.lastPaint = now;
    render();
  });

  subscribeSettings(() => render());

  // 自动刷新：分站状态 + 当前站天气（天气本身另有 30 分钟 TTL，不会被这里打爆）
  setInterval(() => {
    refreshAll().catch((err) => console.warn('[race] 自动刷新失败：', err.message));
  }, AUTO_REFRESH_MS);
}

boot();
