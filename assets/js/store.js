/**
 * 用户设置与「关注」状态的单一入口。
 * 持久化交给 platform.js（桌面 → userData/settings.json，浏览器 → localStorage），
 * 这里加一层内存缓存与订阅通知，避免每个视图各自去读盘。
 */

import { DEFAULT_SETTINGS, SETTINGS_VERSION } from './config.js';
import { getSettings, saveSettings } from './platform.js';

let cache = { ...DEFAULT_SETTINGS };
const listeners = new Set();

function emit() {
  const snapshot = { ...cache };
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch (err) {
      console.error('[store] 订阅回调出错：', err);
    }
  });
}

export async function initSettings() {
  cache = { ...(await getSettings()) };

  // 一次性迁移：旧默认值 'system' 不是用户的显式选择，统一改为亮色（官网同款）。
  // 注意：迁移后必须把 settingsVersion 写成当前版本，否则下一次启动会重复迁移，
  // 用户在设置里显式选的「跟随系统」也会被反复改回亮色。
  if (Number(cache.settingsVersion ?? 0) < SETTINGS_VERSION) {
    const theme = cache.theme === 'system' ? 'light' : cache.theme || 'light';
    cache = { ...cache, theme, settingsVersion: SETTINGS_VERSION };
    await saveSettings({ theme, settingsVersion: SETTINGS_VERSION });
  }

  emit();
  return { ...cache };
}

export function getSettingsSnapshot() {
  return { ...cache };
}

export async function updateSettings(patch) {
  cache = { ...cache, ...(await saveSettings(patch)) };
  emit();
  return { ...cache };
}

export function subscribeSettings(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ------------------------------------------------------------- 关注列表 */

export function favoriteDrivers() {
  return Array.isArray(cache.favoriteDrivers) ? cache.favoriteDrivers : [];
}

export function favoriteTeams() {
  return Array.isArray(cache.favoriteTeams) ? cache.favoriteTeams : [];
}

function toggled(list, value) {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

export function toggleFavoriteDriver(driverId) {
  if (!driverId) return Promise.resolve({ ...cache });
  return updateSettings({ favoriteDrivers: toggled(favoriteDrivers(), driverId) });
}

export function toggleFavoriteTeam(team) {
  if (!team) return Promise.resolve({ ...cache });
  return updateSettings({ favoriteTeams: toggled(favoriteTeams(), team) });
}

/**
 * 关注的排序权重：关注的车手 / 车队排前面，其余保持原有名次顺序。
 * 用于积分榜与成绩列表的「置顶」。
 */
export function favoriteRank(entry) {
  const drivers = favoriteDrivers();
  const teams = favoriteTeams();
  const driverHit = entry?.driverId && drivers.includes(entry.driverId);
  const teamHit = entry?.team && teams.includes(entry.team);
  if (driverHit && teamHit) return 0;
  if (driverHit) return 1;
  if (teamHit) return 2;
  return 3;
}
