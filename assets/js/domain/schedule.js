/**
 * 调度层：全局心跳 + 赛前提醒。
 *
 * 全局只跑一个 setInterval，所有倒计时订阅它 ——
 * 避免旧实现里「每次渲染焦点模块就多一个定时器且从不清理」的泄漏。
 */

import { TICK_MS } from '../config.js';
import { getSettingsSnapshot } from '../store.js';
import { notify } from '../platform.js';
import { countdownParts, humanizeDuration } from '../utils.js';

const tickers = new Set();
let handle = null;

function loop() {
  const now = Date.now();
  for (const fn of [...tickers]) {
    try {
      fn(now);
    } catch (err) {
      console.error('[schedule] tick 回调出错：', err);
    }
  }
}

/** 订阅每秒心跳，返回取消函数 */
export function onTick(fn) {
  if (typeof fn !== 'function') return () => {};
  tickers.add(fn);
  if (handle === null) handle = setInterval(loop, TICK_MS);
  fn(Date.now());
  return () => {
    tickers.delete(fn);
    if (tickers.size === 0 && handle !== null) {
      clearInterval(handle);
      handle = null;
    }
  };
}

/** 倒计时四段文本，供视图直接渲染 */
export function countdownCells(ms) {
  const parts = countdownParts(ms);
  return [
    { value: parts.days, unit: '天' },
    { value: parts.hours, unit: '时' },
    { value: parts.minutes, unit: '分' },
    { value: parts.seconds, unit: '秒' },
  ];
}

/* ------------------------------------------------------------- 赛前提醒 */

const FIRED_KEY = 'f1hub.firedReminders';

function loadFired() {
  try {
    const raw = JSON.parse(localStorage.getItem(FIRED_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function saveFired(set) {
  try {
    // 只保留最近 200 条，避免无限增长
    localStorage.setItem(FIRED_KEY, JSON.stringify([...set].slice(-200)));
  } catch {
    /* 忽略 */
  }
}

/**
 * 提醒引擎：每分钟检查一次「是否进入某个会话的提前提醒窗口」。
 * 用轮询而不是长 setTimeout —— 睡眠唤醒、时钟跳变都不会漏掉提醒。
 */
export function createReminderEngine(getModel) {
  const fired = loadFired();

  return {
    /** @param {number} now */
    check(now = Date.now()) {
      const settings = getSettingsSnapshot();
      if (!settings.notifyEnabled) return;
      const leadMs = Number(settings.notifyLeadMinutes ?? 15) * 60_000;
      const model = getModel();
      if (!model) return;

      for (const entry of model.upcomingSessions) {
        const { race, session } = entry;
        const key = `${race.round}:${session.key}`;
        if (fired.has(key)) continue;
        const fireAt = session.ts - leadMs;
        if (now < fireAt) continue;
        if (now >= session.ts) {
          // 已经开赛，补记一次，避免之后重复提醒
          fired.add(key);
          saveFired(fired);
          continue;
        }
        fired.add(key);
        saveFired(fired);
        const mins = Math.round((session.ts - now) / 60_000);
        notify({
          title: `${race.nameZh} · ${session.label}`,
          body: `${race.circuitZh} — 约 ${mins} 分钟后开始（${race.countryZh}当地 ${session.label}）`,
        });
      }
    },

    /** 手动测试通知（设置面板的「测试通知」按钮用） */
    async test() {
      return notify({
        title: 'F1 观赛助手 · 通知测试',
        body: '如果你看到这条通知，说明赛前提醒可以正常工作。',
      });
    },

    /** 已发出的提醒条数（设置面板展示用） */
    firedCount() {
      return fired.size;
    },
  };
}

/** 距下一节会话的可读描述 */
export function nextSessionSummary(model, now = Date.now()) {
  const next = model?.upcomingSessions?.[0];
  if (!next) return null;
  return {
    race: next.race,
    session: next.session,
    ms: next.session.ts - now,
    text: humanizeDuration(next.session.ts - now),
  };
}
