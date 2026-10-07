/**
 * 分站详情控制器。
 * 路由：pages/race.html?round=<1..23>（缺省取下一站）
 */

import { APP_NAME, AUTO_REFRESH_MS } from '../config.js';
import { loadSeason } from '../data/season.js';
import { getRaceForecast } from '../data/weather.js';
import { initSettings, subscribeSettings, getSettingsSnapshot, favoriteDrivers, favoriteTeams } from '../store.js';
import { onTick } from '../domain/schedule.js';
import { getAppInfo, openExternal, windowControls, isDesktop } from '../platform.js';
import { byId, setHTML, toInt } from '../utils.js';
import { skeleton, errorBox, emptyBox } from '../ui/atoms.js';
import { renderSubbar, renderClocks, setDataSource } from '../ui/shell.js';
import * as view from '../ui/race.js';

const state = { model: null, race: null, forecast: null, forecastRaceId: null, lastPaint: 0 };

const favoritesSnapshot = () => ({
  drivers: favoriteDrivers(),
  teams: favoriteTeams(),
});

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
  renderSubbar(race);
  setDataSource(model);
  renderClocks(race, now);
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
 * 后台刷新：重读快照推进分站状态，**并把当前站的天气一起重取**。
 * 只放在启动时取一次的话，页面挂着不关就永远显示几小时前的预报。
 * @returns {Promise<boolean>} 是否刷新成功（当前站仍在快照里）
 */
async function refreshAll({ force = false } = {}) {
  const model = await loadSeason({ now: Date.now(), force });
  // 取不到就保持原状：把 state.race 赋成 undefined 会让下一次 tick 读 state.race.round 抛
  // TypeError，自动刷新会就此永久失效
  const next = state.race ? model.byRound.get(state.race.round) : null;
  if (!next) return false;
  state.model = model;
  state.race = next;
  render();
  // 模型写回之后再取天气；内部自带「目标站是否仍是当前站」校验，失败只 warn
  loadForecast(next).catch((err) => console.warn('[race] 天气不可用：', err.message));
  return true;
}

function bindEvents() {
  if (windowControls.available) {
    byId('win-min')?.addEventListener('click', () => windowControls.minimize());
    byId('win-max')?.addEventListener('click', () => windowControls.toggleMaximize());
    byId('win-close')?.addEventListener('click', () => windowControls.close());
  }

  document.addEventListener('click', async (event) => {
    const external = event.target.closest('[data-external]');
    if (!external) return;
    event.preventDefault();
    const url = external.getAttribute('href');
    if (url) await openExternal(url);
  });
}

async function boot() {
  setHTML(byId('sessions-body'), skeleton());
  setHTML(byId('result-body'), skeleton());
  setHTML(byId('qualifying-body'), skeleton());
  setHTML(byId('pit-body'), skeleton());
  setHTML(byId('circuit-body'), skeleton());
  setHTML(byId('winners-body'), skeleton());

  await initSettings();
  const info = await getAppInfo();
  document.documentElement.style.setProperty('--titlebar-h', `${info.titlebarHeight || 44}px`);
  document.body.classList.toggle('is-desktop', isDesktop);
  document.documentElement.dataset.theme = getSettingsSnapshot().theme || 'light';

  bindEvents();

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

  // 首次天气：失败只 warn，不阻塞已经渲染好的页面
  loadForecast(state.race).catch((err) => console.warn('[race] 天气不可用：', err.message));

  onTick(() => {
    // 会话状态与倒计时随心跳更新（每 30 秒才真正重绘一次，避免闪烁）
    const now = Date.now();
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
