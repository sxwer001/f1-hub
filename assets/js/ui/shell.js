/**
 * 页面外壳：顶栏导航、黑次栏、双时钟、设置面板、赛前提醒，以及全局事件绑定。
 * 五个页面（首页 / 赛历 / 积分榜 / 成绩 / 分站）共用这一份，避免各写一遍。
 *
 * 提醒引擎刻意放在外壳而不是首页：赛前通知是「应用级」能力，
 * 若挂在首页，用户切到赛历/积分榜页就收不到提醒了。
 */

import { LEAD_MINUTES_CHOICES, REMINDER_CHECK_MS } from '../config.js';
import {
  openExternal, setTheme, showAbout, windowControls,
  onThemeChange, isDesktop, getAppInfo,
} from '../platform.js';
import {
  getSettingsSnapshot, updateSettings,
  favoriteDrivers, favoriteTeams, toggleFavoriteDriver, toggleFavoriteTeam,
} from '../store.js';
import { byId, setText, setHTML, fmtTime, fmtDateRange, flagCode } from '../utils.js';
import { circuitTimeZone } from '../data/maps.js';
import { createReminderEngine } from '../domain/schedule.js';
import { settingsHtml } from './dashboard.js';

/** 导航项：用户要求这 4 项各自独立成页，不再堆在首页 */
export const NAV = [
  { key: 'schedule', label: '赛历', file: 'pages/schedule.html' },
  { key: 'standings', label: '积分榜', file: 'pages/standings.html' },
  { key: 'results', label: '成绩', file: 'pages/results.html' },
  { key: 'race', label: '分站', file: 'pages/race.html' },
];

/** base：根目录页面传 ''，pages/ 下的页面传 '../' */
export function navHtml(active, base) {
  return NAV.map((item) => {
    const href = `${base}${item.file}`;
    return `<a class="topnav-item${item.key === active ? ' is-active' : ''}" href="${href}">${item.label}</a>`;
  }).join('');
}

/** 顶栏右侧的数据源徽标 */
export function setDataSource(model) {
  setText(
    byId('data-source'),
    model ? (model.source === 'live' ? `实时数据 · 截至 R${model.standingsRound}` : '离线快照') : '数据加载中',
  );
}

/** 黑次栏：当前分站 + 双时钟 */
export function renderSubbar(race) {
  if (!race) return;
  const tz = circuitTimeZone(race.id);
  setText(byId('sub-round'), `R${race.round}`);
  setText(byId('sub-date'), fmtDateRange(race.sessions[0]?.utc ?? race.raceUtc, race.raceUtc, tz));
  setText(byId('sub-flag'), flagCode(race.flag) || '--');
  setText(byId('sub-name'), race.country);
}

export function renderClocks(race, now = Date.now()) {
  setText(byId('clock-local'), fmtTime(now));
  if (!race) return;
  try {
    setText(
      byId('clock-track'),
      new Intl.DateTimeFormat('en-GB', {
        timeZone: circuitTimeZone(race.id),
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(now)),
    );
  } catch {
    setText(byId('clock-track'), '--:--');
  }
}

/** 首屏把外壳填好（导航由静态 HTML 提供，这里只补数据相关部分） */
export function mountShell({ race, model }) {
  currentModel = model;
  setDataSource(model);
  renderSubbar(race);
  renderClocks(race);
  ensureReminders();
}

/* ------------------------------------------------------------------ 赛前提醒 */

let currentModel = null;
let shellInfo = null;
let reminders = null;
let reminderTimer = null;

/** 提醒引擎只建一次；模型通过 currentModel 间接读取，因此换页/刷新都不影响它 */
function reminderEngine() {
  if (!reminders) reminders = createReminderEngine(() => currentModel);
  return reminders;
}

/** 由 mountShell 调用：模型一到手就启动（或沿用）全局提醒心跳 */
function ensureReminders() {
  const engine = reminderEngine();
  if (reminderTimer !== null) return;
  engine.check(Date.now());
  reminderTimer = setInterval(() => engine.check(Date.now()), REMINDER_CHECK_MS);
}

/* ------------------------------------------------------------------ 设置面板 */

function renderSettingsPanel() {
  const host = byId('settings-pop');
  if (!host) return;
  setHTML(
    host,
    settingsHtml({
      settings: getSettingsSnapshot(),
      info: shellInfo || {},
      leadChoices: LEAD_MINUTES_CHOICES,
      reminderCount: reminderEngine().firedCount(),
    }),
  );
}

function toggleSettingsPanel(force) {
  const host = byId('settings-pop');
  const trigger = byId('act-settings');
  if (!host || !trigger) return;
  const open = typeof force === 'boolean' ? force : host.hidden;
  if (open) {
    renderSettingsPanel();
    // 面板是 position: fixed，位置按触发键的实时 rect 算 —— 滚动、吸顶、桌面端
    // 标题栏覆盖层（.topbar-inner 的 padding-right）都不会让它错位。
    const rect = trigger.getBoundingClientRect();
    host.style.top = `${Math.round(rect.bottom + 8)}px`;
    host.style.right = `${Math.round(window.innerWidth - rect.right)}px`;
  }
  host.hidden = !open;
  trigger.setAttribute('aria-expanded', String(open));
}

/** 主题：把设置里的主题写到 <html data-theme> */
export function applyTheme() {
  document.documentElement.dataset.theme = getSettingsSnapshot().theme || 'light';
  document.body.classList.toggle('is-desktop', isDesktop);
}

export async function initShellChrome() {
  const info = await getAppInfo();
  shellInfo = info;
  document.documentElement.style.setProperty('--titlebar-h', `${info.titlebarHeight || 58}px`);
  return info;
}

export const favoritesSnapshot = () => ({ drivers: favoriteDrivers(), teams: favoriteTeams() });

/**
 * 全局事件：关注星标、外链、设置面板、分段控件、窗口按钮。
 * 设置面板与赛前提醒都在这一层，因此五个页面的行为完全一致。
 */
export function bindShellEvents({ onFavoritesChanged, onRefresh, onStandingsTab } = {}) {
  if (windowControls.available) {
    byId('win-min')?.addEventListener('click', () => windowControls.minimize());
    byId('win-max')?.addEventListener('click', () => windowControls.toggleMaximize());
    byId('win-close')?.addEventListener('click', () => windowControls.close());
  }

  document.addEventListener('click', async (event) => {
    const star = event.target.closest('[data-fav-kind]');
    if (star) {
      event.preventDefault();
      const { favKind, favId } = star.dataset;
      if (favKind === 'driver') await toggleFavoriteDriver(favId);
      else await toggleFavoriteTeam(favId);
      onFavoritesChanged?.();
      return;
    }

    // 设置面板：点触发键开关，点面板外任意处关闭
    if (event.target.closest('#act-settings')) {
      toggleSettingsPanel();
      return;
    }
    if (!event.target.closest('#settings-pop')) toggleSettingsPanel(false);

    const external = event.target.closest('[data-external]');
    if (external) {
      event.preventDefault();
      const url = external.getAttribute('href');
      if (url && url !== '#') await openExternal(url);
      return;
    }

    const action = event.target.closest('#act-test-notify, #act-refresh, #act-about');
    if (action) {
      if (action.id === 'act-about') await showAbout();
      else if (action.id === 'act-test-notify') {
        const res = await reminderEngine().test();
        if (!res || !res.shown) console.warn('[shell] 测试通知未显示：', res?.reason ?? '未知原因');
      } else onRefresh?.(action.id);
      return;
    }

    const seg = event.target.closest('.seg-btn');
    if (seg) {
      seg.parentElement.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('is-active'));
      seg.classList.add('is-active');
      onStandingsTab?.(seg.dataset.tab);
    }
  });

  document.addEventListener('change', async (event) => {
    const el = event.target;
    if (el.id === 'set-notify') await updateSettings({ notifyEnabled: Boolean(el.checked) });
    else if (el.id === 'set-lead') await updateSettings({ notifyLeadMinutes: Number(el.value) });
    else if (el.id === 'set-theme') await setTheme(el.value);
    else return;
    // 设置变了，面板里的「已记录 N 条提醒」等文案要跟着刷新
    renderSettingsPanel();
    onFavoritesChanged?.();
  });

  onThemeChange(({ dark }) => {
    if (getSettingsSnapshot().theme === 'system') {
      document.documentElement.dataset.themeResolved = dark ? 'dark' : 'light';
    }
  });
}
