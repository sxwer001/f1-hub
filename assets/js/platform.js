/**
 * 平台适配层：把「桌面端能力」和「浏览器降级实现」收敛成同一接口。
 * 页面代码只依赖这里，不直接触碰 window.f1，因此同一套前端在
 * Electron 与普通浏览器里都能运行（后者便于自动化自检）。
 */

import { DEFAULT_SETTINGS } from './config.js';

const bridge = typeof window !== 'undefined' ? window.f1 : undefined;

export const isDesktop = Boolean(bridge?.isDesktop);

const SETTINGS_KEY = 'f1hub.settings';

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeLocal(patch) {
  const merged = { ...DEFAULT_SETTINGS, ...readLocal(), ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  } catch {
    /* 隐私模式下忽略 */
  }
  return merged;
}

/* ------------------------------------------------------------------ 设置 */

export async function getSettings() {
  if (isDesktop) {
    try {
      return { ...DEFAULT_SETTINGS, ...(await bridge.getSettings()) };
    } catch {
      return { ...DEFAULT_SETTINGS, ...readLocal() };
    }
  }
  return { ...DEFAULT_SETTINGS, ...readLocal() };
}

export async function saveSettings(patch) {
  if (isDesktop) {
    try {
      return { ...DEFAULT_SETTINGS, ...(await bridge.saveSettings(patch)) };
    } catch {
      return writeLocal(patch);
    }
  }
  return writeLocal(patch);
}

/* ------------------------------------------------------------------ 通知 */

export async function notify(payload) {
  if (isDesktop) {
    try {
      return await bridge.notify(payload);
    } catch {
      return { shown: false, reason: 'error' };
    }
  }
  try {
    if (typeof Notification === 'undefined') return { shown: false, reason: 'unsupported' };
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted') return { shown: false, reason: 'denied' };
    new Notification(payload.title || 'F1 观赛助手', { body: payload.body || '' });
    return { shown: true };
  } catch {
    return { shown: false, reason: 'error' };
  }
}

/* ------------------------------------------------------------------ 外壳能力 */

export async function openExternal(url) {
  if (isDesktop) return bridge.openExternal(url);
  window.open(url, '_blank', 'noopener,noreferrer');
  return { ok: true };
}

export async function setTheme(theme) {
  const next = ['system', 'light', 'dark'].includes(theme) ? theme : 'light';
  // 始终写入字面值：tokens.css 用 :root[data-theme='system'] 承载「跟随系统」，
  // 若清空属性会退回 :root 的亮色，导致「跟随系统」失效。
  document.documentElement.dataset.theme = next;
  if (isDesktop) {
    try {
      return await bridge.setTheme(next);
    } catch {
      /* 忽略 */
    }
  }
  return { theme: next };
}

export async function showAbout() {
  if (isDesktop) return bridge.showAbout();
  return { ok: false, reason: 'web' };
}

export async function getAppInfo() {
  if (isDesktop) {
    try {
      return await bridge.getInfo();
    } catch {
      /* 回落到默认值 */
    }
  }
  return { version: '1.0.2', name: 'F1 观赛助手', platform: 'web', titlebarHeight: 0 };
}

/* ------------------------------------------------------------------ 窗口控制 */

export const windowControls = {
  available: isDesktop,
  minimize: () => isDesktop && bridge.minimize(),
  toggleMaximize: () => isDesktop && bridge.toggleMaximize(),
  close: () => isDesktop && bridge.close(),
};

/* ------------------------------------------------------------------ 订阅 */

export function onThemeChange(fn) {
  if (isDesktop && bridge.onThemeChange) return bridge.onThemeChange(fn);
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq) return () => {};
  const handler = (e) => fn({ dark: e.matches });
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

export function onWindowState(fn) {
  if (isDesktop && bridge.onWindowState) return bridge.onWindowState(fn);
  return () => {};
}
