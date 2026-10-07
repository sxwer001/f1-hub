/**
 * 基础渲染片段（纯函数，返回 HTML 字符串）。
 * 全部动态文本都经过 escapeHtml / safeUrl，禁止裸插值。
 */

import { escapeHtml, safeColor } from '../utils.js';

export const posClass = (pos) => (pos <= 3 ? ` pos-${pos}` : '');

export function card(titleHtml, bodyHtml, { className = '', actions = '', id = '' } = {}) {
  return `
    <section class="card ${className}"${id ? ` id="${escapeHtml(id)}"` : ''}>
      ${titleHtml ? `<header class="card-head"><h2 class="card-title">${titleHtml}</h2>${actions}</header>` : ''}
      <div class="card-body">${bodyHtml}</div>
    </section>`;
}

export const skeleton = (text = '加载中…') => `<p class="state state-loading">${escapeHtml(text)}</p>`;
export const emptyBox = (text = '暂无数据。') => `<p class="state state-empty">${escapeHtml(text)}</p>`;
export const errorBox = (text = '数据加载失败。', hint = '') =>
  `<p class="state state-error">${escapeHtml(text)}${hint ? `<span class="state-hint">${escapeHtml(hint)}</span>` : ''}</p>`;

export function teamStripe(color) {
  return `<span class="team-stripe" style="background:${safeColor(color)}"></span>`;
}

/**
 * 车手半身像 / 车队徽标。
 * src 为空串时**返回空串**（调用方回退纯文字）—— 图源只有 TheSportsDB 一家，
 * 缺图必须优雅降级，不能出现破图。
 * kind 决定外框形状：driver 圆形头像 · team 圆角矩形徽标。
 */
export function avatar(src, { kind = 'driver', alt = '', size = '' } = {}) {
  if (!src) return '';
  // size 会进内联 style，必须严格白名单（escapeHtml 挡不住 CSS 注入）
  const safeSize = /^\d{1,3}px$/.test(String(size)) ? String(size) : '';
  const style = safeSize ? ` style="--avatar-size:${safeSize}"` : '';
  return `<span class="avatar avatar-${kind}"${style}><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async"></span>`;
}

export function chip(text, { tone = '', title = '' } = {}) {
  return `<span class="chip${tone ? ` chip-${tone}` : ''}"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(text)}</span>`;
}

export function starButton(kind, id, active, label) {
  return `<button class="star${active ? ' is-on' : ''}" data-fav-kind="${escapeHtml(kind)}" data-fav-id="${escapeHtml(id)}"
    aria-pressed="${active ? 'true' : 'false'}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">★</button>`;
}

/** 大倒计时：四格数字 */
export function countdownHtml(cells) {
  return `<div class="countdown">${cells
    .map(({ value, unit }) => `<span class="cd-cell"><b>${escapeHtml(String(value).padStart(2, '0'))}</b><i>${escapeHtml(unit)}</i></span>`)
    .join('')}</div>`;
}

/**
 * 硬数据统计格。
 * tone 可选项 —— 只给真实字段上语义色（见 main.css 的 .stat.tone-*）：
 *   ''/'muted' 中性（默认）· 'strong' 主体值（日期 / 赛道名，用 --ink 提重）
 *   其余值（如 'warn'）直接映射成 `tone-<值>` 类，供页面按语义着色。
 */
export function statRow(items) {
  return `<div class="stat-row">${items
    .map(({ label, value, tone = '' }) => {
      const cls = tone && tone !== 'muted' ? ` tone-${tone === 'strong' ? 'ink' : tone}` : '';
      return `<div class="stat${cls}"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`;
    })
    .join('')}</div>`;
}
