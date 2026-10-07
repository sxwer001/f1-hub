/**
 * 运行期配置。
 * 数据源说明：
 *   - season : jolpi.ca 的 Ergast 镜像，免 API key，提供赛历/积分/成绩/排位
 *   - weather: Open-Meteo，免 key，按赛道经纬度取真实预报
 *   - news   : Formula 1 官方 RSS
 * 所有请求在桌面端由主进程代理（规避 CORS 并统一缓存），浏览器端直连。
 */

export const APP_NAME = 'F1 观赛助手';

export const SEASON_YEAR = 2026;

export const ENDPOINTS = {
  season: 'https://api.jolpi.ca/ergast/f1',
  weather: 'https://api.open-meteo.com/v1/forecast',
  news: 'https://www.formula1.com/en/latest/all.xml',
};

/** 允许主进程代访问的域名白名单（渲染层无法用它当开放代理） */
export const ALLOWED_HOSTS = [
  'api.jolpi.ca',
  'api.open-meteo.com',
  'www.formula1.com',
  'www.motorsport.com',
];

export const CACHE_TTL = {
  season: 10 * 60 * 1000, // 赛历与积分：10 分钟
  weather: 30 * 60 * 1000, // 天气预报：30 分钟
  news: 15 * 60 * 1000, // 新闻：15 分钟
  raceDetail: 30 * 60 * 1000,
};

/** 倒计时刷新频率（毫秒） */
export const TICK_MS = 1000;

/** 页面数据自动刷新频率 */
export const AUTO_REFRESH_MS = 10 * 60 * 1000;

/** 赛前提醒的检查频率（提醒引擎跑在外壳里，五个页面都生效） */
export const REMINDER_CHECK_MS = 60 * 1000;

export const DEFAULT_SETTINGS = {
  // 默认亮色：formula1.com 的实际默认呈现就是亮色（#f3f3f4 底 + 白卡片 + 黑导航）
  theme: 'light',
  notifyEnabled: true,
  notifyLeadMinutes: 15,
  favoriteDrivers: [],
  favoriteTeams: [],
  lastViewedRound: null,
};

/** 快照文件位置（相对本模块解析，因此 pages/ 下的页面也能拿到同一份） */
export const SNAPSHOT_URL = new URL('../data/season.json', import.meta.url).href;

/** 提醒可选的提前量（分钟） */
export const LEAD_MINUTES_CHOICES = [5, 10, 15, 30, 60];

/**
 * 设置结构版本。用于一次性迁移：
 * v2.0 早期默认主题是 'system'（并非用户显式选择），而 formula1.com 的实际呈现是亮色，
 * 因此把未显式选择过主题的旧设置迁移到 'light'，避免暗色系统偏好顶掉官网观感。
 *
 * v3：v2 时代已经把 theme:'system' + settingsVersion:2 写进过 settings.json，
 * 于是 `settingsVersion < SETTINGS_VERSION` 永远为 false、迁移再也不执行，旧值被永久固化
 * （实测首页 data-theme 一直是 system）。把版本提到 3 让这条历史记录重跑一次迁移；
 * 迁移后 settingsVersion 已是最新，用户在设置里显式选「跟随系统」不会再被改回亮色。
 * 注意：必须与 electron/main.js 的 DEFAULT_SETTINGS.settingsVersion 保持一致。
 */
export const SETTINGS_VERSION = 3;
