/**
 * 共享渲染函数：赛历卡片（`raceCardHtml`/`cardsHtml`，领奖台行由本文件私有的 `podiumHtml` 拼）、
 * 积分榜（`standingsHtml`）、新闻（`newsHtml`）、设置面板（`settingsHtml`）、
 * 状态栏（`statusBarHtml`）、倒计时数字（`countdownOnly`）。
 * 纯渲染函数，数据与状态由 `assets/js/pages/*.js` 传入。
 */

import {
  escapeHtml, safeUrl, safeColor, flagCode, surnameOf, fmtTime, fmtDayLabel,
  relativeTime, tzLabel, humanizeDuration, fmtDateRange,
} from '../utils.js';
import { countdownCells } from '../domain/schedule.js';
import { sessionState } from '../data/season.js';
import { circuitTimeZone } from '../data/maps.js';
import { card, emptyBox, teamStripe, chip, starButton, countdownHtml, posClass, avatar } from './atoms.js';
import { driverPhoto, teamLogo } from '../data/photos.js';

/* ------------------------------------------------------------------ 命名口径 */

/**
 * 专有名词一律用英文（与官网一致）：国家 / 城市 / 赛道 / 车手 / 车队 / 分站名。
 * 界面标签（导航、按钮、面板标题、设置项）保留中文。
 */

/* ------------------------------------------------------------------ 倒计时条 */

/** 只重绘倒计时数字（每秒调用，避免整块重排导致闪烁） */
export function countdownOnly(summary, now) {
  if (!summary?.session?.ts) return '';
  return countdownHtml(countdownCells(summary.session.ts - now));
}

/* ------------------------------------------------------------------ 赛历卡片 */

const POS_LABEL = ['1ST', '2ND', '3RD'];

function podiumHtml(model, race, base = '') {
  const rows = (model.results?.[race.round] || []).slice(0, 3);
  if (!rows.length) return '';
  return `<div class="podium">${rows
    .map((r, i) => {
      const code = (r.code || r.name?.split(' ').pop()?.slice(0, 3) || '—').toUpperCase();
      const color = safeColor(r.teamColor);
      // 小圆头像（对齐 F1 官网卡片：1ST/2ND/3RD 行里带车手脸）
      const face = avatar(driverPhoto(r.driverId, base), { alt: surnameOf(r), size: '18px' });
      return `
        <div class="podium-item" style="border-left:4px solid ${color}">
          <span class="podium-pos">${POS_LABEL[i]}</span>
          <span class="podium-code">${face}${escapeHtml(code)}</span>
          <span class="podium-times">${escapeHtml(r.time || r.status || '—')}</span>
        </div>`;
    })
    .join('')}</div>`;
}

/**
 * 单个赛历卡片。
 * @param {{race:object, model:object, now:number, variant:'next'|'done'|'upcoming', base?:string}} args
 * base：根目录页面传 ''，pages/ 下传 '../'（**必须带结尾斜杠**，base 是直接拼在
 * `pages/race.html` 前面的）—— 否则链接会被解析成 `pages/pages/race.html` 或 `..pages/race.html`。
 */
export function raceCardHtml({ race, model, now, variant, base = '' }) {
  const tz = circuitTimeZone(race.id);
  const firstUtc = race.sessions[0]?.utc ?? race.raceUtc;
  const range = fmtDateRange(firstUtc, race.raceUtc, tz);
  const cls = [
    'race-card',
    variant === 'next' ? 'is-next' : '',
    variant === 'done' ? 'is-done' : '',
  ]
    .filter(Boolean)
    .join(' ');

  let foot;
  if (variant === 'done') {
    foot = `<div class="card-foot">
        <span class="card-when">${escapeHtml(range)}</span>
        <span class="card-hint">查看详情 →</span>
      </div>`;
  } else if (variant === 'next') {
    const pending = race.sessions.find((s) => sessionState(s, now) !== 'done');
    foot = `<div class="card-foot">
        <span class="card-when">${escapeHtml(range)}</span>
        <span class="card-hint">${escapeHtml(pending ? `距 ${pending.label} ${humanizeDuration(pending.ts - now)}` : '进行中')} →</span>
      </div>`;
  } else {
    const start = race.sessions[0]?.ts ?? Date.parse(race.raceUtc);
    foot = `<div class="card-foot">
        <span class="card-when">${escapeHtml(range)}</span>
        <span class="card-hint">${escapeHtml(`${humanizeDuration(start - now)}`)} →</span>
      </div>`;
  }

  // 官网做法：NEXT RACE 卡片右上角是白色胶囊按钮，日期区间放在左下角大字
  const pill = variant === 'next' ? 'NEXT RACE →' : range;

  return `
    <article class="${cls}">
      <a href="${base}pages/race.html?round=${escapeHtml(String(race.round))}" aria-label="${escapeHtml(race.name)}">
        <div class="card-top">
          <span class="card-round">ROUND ${escapeHtml(String(race.round))}</span>
          <span class="card-date-pill">${escapeHtml(pill)}</span>
        </div>
        <h3 class="card-country"><span class="flag-badge">${escapeHtml(flagCode(race.flag) || '--')}</span>${escapeHtml(race.country)}</h3>
        <p class="card-subtitle">FORMULA 1 ${escapeHtml(String(race.name).toUpperCase())} ${escapeHtml(String(model.season))}</p>
        ${variant === 'done' ? podiumHtml(model, race, base) : foot}
      </a>
    </article>`;
}

/** 一组卡片；races 为空时给出空态。base 见 raceCardHtml */
export function cardsHtml({ races, model, now, variant, base = '' }) {
  if (!races?.length) return emptyBox(variant === 'done' ? '本赛季尚无完赛分站。' : '暂无分站。');
  return races
    .map((race) => raceCardHtml({ race, model, now, variant, base }))
    .join('');
}

/* ------------------------------------------------------------------ 积分榜 */

export function standingsHtml({ rows, type, favorites, limit, base = '' }) {
  if (!rows?.length) return emptyBox('积分榜暂无数据。');
  const visible = typeof limit === 'number' ? rows.slice(0, limit) : rows;
  const body = visible
    .map((r) => {
      const isDriver = type === 'driver';
      const name = isDriver ? surnameOf(r) : r.team;
      const sub = isDriver ? r.team : r.nationality;
      const favId = isDriver ? r.driverId : r.team;
      const fav = isDriver ? favorites.drivers.includes(r.driverId) : favorites.teams.includes(r.team);
      // 车手用半身像、车队用徽标；两者都可能缺图，avatar() 会返回空串
      const photo = isDriver ? driverPhoto(r.driverId, base) : teamLogo(r.teamId, base);
      return `
        <tr class="${fav ? 'is-fav' : ''}">
          <td class="pos${posClass(r.pos)}">${escapeHtml(String(r.pos))}</td>
          <td class="team-cell">${teamStripe(r.teamColor || r.color)}
            ${avatar(photo, { kind: isDriver ? 'driver' : 'team', alt: name })}
            <span class="cell-name">${escapeHtml(name)}</span>
            <span class="cell-sub">${escapeHtml(sub)}</span>
          </td>
          <td class="pts">${escapeHtml(String(r.points))}</td>
          <td class="fav-cell">${starButton(isDriver ? 'driver' : 'team', favId, fav, fav ? '取消关注' : '关注')}</td>
        </tr>`;
    })
    .join('');
  return `
    <table class="table standings">
      <thead><tr><th>#</th><th>${type === 'driver' ? '车手' : '车队'}</th><th class="pts">积分</th><th></th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

/* ------------------------------------------------------------------ 新闻 */

export function newsHtml(items) {
  if (!items?.length) return emptyBox('暂无新闻。');
  return `<ul class="news-list">${items
    .map(
      (n) => `
      <li>
        <a href="${safeUrl(n.link)}" data-external>${escapeHtml(n.title)}</a>
        <span class="news-meta">
          <span class="chip chip-meta">${escapeHtml(n.author || 'Formula 1')}</span>
          ${n.publishedAt ? `<span class="chip chip-meta">${escapeHtml(relativeTime(n.publishedAt))}</span>` : ''}
        </span>
      </li>`,
    )
    .join('')}</ul>`;
}

/* ------------------------------------------------------------------ 设置面板 */

/**
 * 顶栏「设置」下拉面板的内容（由 ui/shell.js 渲染进 #settings-pop）。
 * 三个控件分别对应 store 的 notifyEnabled / notifyLeadMinutes / theme。
 */
export function settingsHtml({ settings, info, leadChoices, reminderCount }) {
  const lead = Number(settings.notifyLeadMinutes ?? 15);
  const THEME_LABEL = { light: '亮色（官网同款）', dark: '深色', system: '跟随系统' };
  return `
    <div class="settings">
      <p class="settings-title">设置</p>
      <div class="setting-row">
        <label for="set-notify">赛前提醒</label>
        <input type="checkbox" id="set-notify" ${settings.notifyEnabled ? 'checked' : ''}>
      </div>
      <div class="setting-row">
        <label for="set-lead">提前量</label>
        <select id="set-lead">
          ${leadChoices.map((m) => `<option value="${m}"${m === lead ? ' selected' : ''}>${m} 分钟</option>`).join('')}
        </select>
      </div>
      <div class="setting-row">
        <label for="set-theme">外观</label>
        <select id="set-theme">
          ${['light', 'dark', 'system']
            .map((t) => `<option value="${t}"${settings.theme === t ? ' selected' : ''}>${THEME_LABEL[t]}</option>`)
            .join('')}
        </select>
      </div>
      <div class="setting-actions">
        <button class="pill-btn pill-btn-ghost" id="act-test-notify">测试通知</button>
        <button class="pill-btn pill-btn-ghost" id="act-about">关于</button>
      </div>
      <p class="setting-note">
        已记录 ${escapeHtml(String(reminderCount ?? 0))} 条提醒 · ${escapeHtml(info?.name || 'F1 观赛助手')} v${escapeHtml(info?.version || '')}
        ${info?.electron ? ` · Electron ${escapeHtml(info.electron)}` : ' · 浏览器模式'}
      </p>
    </div>`;
}

/* ------------------------------------------------------------------ 状态栏 */

export function statusBarHtml({ model, info, now }) {
  const next = model.upcomingSessions?.[0];
  return `
    <span class="status-item">
      <b>${model.source === 'live' ? '实时数据' : '离线快照'}</b>
      ${model.source === 'live' ? `积分榜截至第 ${escapeHtml(String(model.standingsRound))} 站` : '实时积分榜不可用'}
    </span>
    ${
      next
        ? `<span class="status-item">下一节 <b>${escapeHtml(next.session.label)}</b> ${escapeHtml(fmtDayLabel(next.session.utc))} ${escapeHtml(fmtTime(next.session.utc))}</span>`
        : ''
    }
    <span class="status-item muted">本机时区 ${escapeHtml(tzLabel())}</span>
    <span class="status-item muted">更新于 ${escapeHtml(relativeTime(model.loadedAt || Date.now(), now))}</span>`;
}
