/**
 * 分站详情视图。
 * 只呈现真实可得的数据：会话时间、正赛成绩、排位成绩、进站统计、赛道坐标。
 * （Ergast 不提供赛道长度/弯数/圈速纪录，因此不再编造这些字段。）
 */

import { escapeHtml, safeUrl, safeColor, surnameOf, fmtDate, fmtTime, fmtDayLabel, tzLabel, humanizeDuration } from '../utils.js';
import { sessionState, raceResults, raceQualifying, racePitStops, tyreInsight } from '../data/season.js';
import { weatherText, forecastForSession, forecastForRaceDay } from '../data/weather.js';
import { teamZh, driverZh, teamColor } from '../data/maps.js';
import { card, emptyBox, teamStripe, chip, statRow, posClass, avatar } from './atoms.js';
import { driverPhoto, teamLogo } from '../data/photos.js';

export function detailHeroHtml({ race, forecast }) {
  const raceDay = forecast ? forecastForRaceDay(forecast, race) : null;
  return `
    <div class="detail-hero">
      <div class="dh-top">
        <a class="back-link" href="../index.html">← 返回</a>
        <span class="dh-round">ROUND ${escapeHtml(String(race.round))}</span>
      </div>
      <h1 class="dh-title">${escapeHtml(race.name)}</h1>
      <p class="dh-sub">${escapeHtml(race.circuit)} · ${escapeHtml(race.locality)}, ${escapeHtml(race.country)}</p>
      <div class="dh-meta">
        ${chip(race.nameZh)}
        ${race.sprint ? chip('冲刺周末', { tone: 'sprint' }) : chip('常规周末')}
        ${chip(`正赛 ${fmtDate(race.raceUtc)}`)}
        ${chip(tzLabel(), { title: '时间按本机时区显示' })}
        ${raceDay ? chip(`${weatherText(raceDay.code)} ${Math.round(raceDay.min)}~${Math.round(raceDay.max)}° 降水 ${raceDay.rainChance ?? 0}%`, { tone: 'weather' }) : ''}
      </div>
    </div>`;
}

/**
 * 会话类型的语义色（F1 计时屏口径）：
 *   race 正赛 → --brand 红 · qualifying 排位赛 → --sector-purple 紫圈
 *   sprint / sprintQualifying 冲刺 → --warning · fp* 练习赛 → --ink-3 中性
 * 只用来给会话名左侧竖条与文字上色（见 main.css 的 .session-name），不给整行铺色。
 * key 是 sessions[].key（fp1/fp2/fp3/qualifying/race/sprint/sprintQualifying）。
 */
export function sessionTypeClass(key) {
  switch (key) {
    case 'race':
      return 'session-race';
    case 'qualifying':
      return 'session-quali';
    case 'sprint':
    case 'sprintQualifying':
      return 'session-sprint';
    default:
      return 'session-practice';
  }
}

export function sessionsPanelHtml({ race, forecast, now }) {
  const rows = race.sessions
    .map((s) => {
      const state = sessionState(s, now);
      const wx = forecast ? forecastForSession(forecast, s) : null;
      // 降水概率 ≥70% 才上语义警告色，不给「小雨 20%」也染黄
      const wet = wx && Number(wx.rainChance ?? 0) >= 70;
      return `
        <tr class="${state === 'live' ? 'is-live' : ''}">
          <td><span class="session-name ${sessionTypeClass(s.key)}">${escapeHtml(s.label)}<i class="cell-sub">${escapeHtml(s.labelEn)}</i></span></td>
          <td>${escapeHtml(fmtDayLabel(s.utc))}</td>
          <td class="mono">${escapeHtml(fmtTime(s.utc))}</td>
          <td>${wx ? `${escapeHtml(weatherText(wx.code))}` : '—'}</td>
          <td class="mono">${wx ? `${escapeHtml(String(Math.round(wx.temp ?? 0)))}°` : '—'}</td>
          <td class="mono${wet ? ' tone-warn' : ''}">${wx ? `${escapeHtml(String(wx.rainChance ?? 0))}%` : '—'}</td>
          <td>${state === 'done' ? '<span class="tag">已结束</span>' : state === 'live' ? '<span class="tag tag-live">进行中</span>' : `<span class="muted">${escapeHtml(humanizeDuration(s.ts - now))}</span>`}</td>
        </tr>`;
    })
    .join('');

  return `
    <table class="table sessions-table">
      <thead><tr><th>会话</th><th>日期</th><th>开始</th><th>天气</th><th>气温</th><th>降水</th><th>状态</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="block-note">时间已换算到本机时区（${escapeHtml(tzLabel())}）；天气来自 Open-Meteo 按赛道坐标的预报。</p>`;
}

/**
 * 领奖台聚焦：P1/P2/P3 三位车手的大图，底色用各自车队色（对齐 F1 官方海报口径）。
 * 只渲染真实拿到的名次；缺图的车手照片位留空但不塌陷（.podium-hero-photo 有固定高度）。
 * 类名一律 podium-hero-*：赛历卡片里的领奖台行用的是 .podium 家族
 * （.podium / .podium-item / .podium-pos / .podium-code / .podium-times），两套类互不复用。
 */
export function podiumSpotlightHtml({ model, race, base = '' }) {
  const rows = raceResults(model, race.round).slice(0, 3);
  if (!rows.length) return '';
  return `
    <div class="podium-hero">
      ${rows
        .map((r) => {
          const photo = driverPhoto(r.driverId, base);
          return `
        <article class="podium-hero-card podium-hero-${escapeHtml(String(r.pos))}" style="--team:${safeColor(r.teamColor)}">
          <span class="podium-hero-rank" aria-hidden="true">${escapeHtml(String(r.pos))}</span>
          <span class="podium-hero-photo">${photo ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(surnameOf(r))}" loading="lazy" decoding="async">` : ''}</span>
          <span class="podium-hero-meta">
            <b class="podium-hero-name">${escapeHtml(surnameOf(r))}</b>
            <i class="podium-hero-team">${escapeHtml(r.team)}</i>
          </span>
          <span class="podium-hero-time mono">${escapeHtml(r.time || r.status || '—')}</span>
        </article>`;
        })
        .join('')}
    </div>`;
}

export function resultPanelHtml({ model, race, favorites, base = '' }) {
  const rows = raceResults(model, race.round);
  if (!rows.length) return emptyBox('该分站成绩尚未产生。');
  const body = rows
    .map((r) => {
      const fav = favorites.drivers.includes(r.driverId);
      const gained = r.grid > 0 ? r.grid - r.pos : 0;
      return `
        <tr class="${fav ? 'is-fav' : ''}">
          <td class="pos${posClass(r.pos)}">${escapeHtml(String(r.pos))}</td>
          <td class="team-cell">${teamStripe(r.teamColor)}
            ${avatar(driverPhoto(r.driverId, base), { alt: surnameOf(r) })}
            <span class="cell-name">${escapeHtml(surnameOf(r))}</span>
            <span class="cell-sub">${escapeHtml(r.team)}</span>
          </td>
          <td class="mono">${escapeHtml(r.grid > 0 ? String(r.grid) : '—')}</td>
          <td class="mono">${escapeHtml(String(r.laps))}</td>
          <td class="mono">${escapeHtml(r.time || r.status || '—')}</td>
          <td class="mono ${gained > 0 ? 'up' : gained < 0 ? 'down' : ''}">${r.grid > 0 ? escapeHtml(`${gained > 0 ? '+' : ''}${gained}`) : '—'}</td>
          <td class="pts">${escapeHtml(String(r.points))}</td>
        </tr>`;
    })
    .join('');
  return `
    <table class="table">
      <thead><tr><th>#</th><th>车手</th><th>发车</th><th>圈数</th><th>时间/状态</th><th>变化</th><th class="pts">分</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

export function qualifyingPanelHtml({ model, race, base = '' }) {
  const rows = raceQualifying(model, race.round);
  if (!rows.length) return emptyBox('排位赛成绩尚未产生。');
  const body = rows
    .map(
      (q) => `
      <tr>
        <td class="pos${posClass(q.pos)}">${escapeHtml(String(q.pos))}</td>
        <td class="team-cell">${teamStripe(q.teamColor)}
          ${avatar(driverPhoto(q.driverId, base), { alt: surnameOf(q) })}
          <span class="cell-name">${escapeHtml(surnameOf(q))}</span>
          <span class="cell-sub">${escapeHtml(q.team)}</span>
        </td>
        <td class="mono">${escapeHtml(q.q1 || '—')}</td>
        <td class="mono">${escapeHtml(q.q2 || '—')}</td>
        <td class="mono">${escapeHtml(q.q3 || '—')}</td>
      </tr>`,
    )
    .join('');
  return `
    <table class="table">
      <thead><tr><th>#</th><th>车手</th><th>Q1</th><th>Q2</th><th>Q3</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

export function pitPanelHtml({ model, race }) {
  const insight = tyreInsight(model, race.round);
  if (!insight) return emptyBox('该分站暂无进站记录。');

  // 进站记录只有 driverId，用赛季车手表补出姓氏
  const nameById = new Map((model.drivers || []).map((d) => [d.driverId, surnameOf(d)]));

  const rows = insight.windows
    .slice(0, 14)
    .map(
      (w) => `
      <tr>
        <td class="team-cell"><span class="cell-name">${escapeHtml(nameById.get(w.driverId) || w.driverId)}</span></td>
        <td class="mono">${escapeHtml(String(w.count))}</td>
        <td class="mono">${escapeHtml(w.laps.join(' · '))}</td>
        <td class="mono">${escapeHtml(w.fastest || '—')}</td>
      </tr>`,
    )
    .join('');

  return `
    ${statRow([
      { label: '总进站次数', value: String(insight.totalStops) },
      { label: '进站车手', value: String(insight.driversWithStops) },
      { label: '人均进站', value: insight.averageStops.toFixed(2) },
      { label: '最常见', value: `${insight.histogram.sort((a, b) => b.drivers - a.drivers)[0]?.stops ?? 0} 停` },
    ])}
    <table class="table">
      <thead><tr><th>车手</th><th>停站</th><th>圈数</th><th>最快停站</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

export function circuitPanelHtml({ race }) {
  const mapsUrl = `https://www.openstreetmap.org/?mlat=${race.lat}&mlon=${race.long}#map=14/${race.lat}/${race.long}`;
  return `
    ${statRow([
      { label: '纬度', value: race.lat.toFixed(4) },
      { label: '经度', value: race.long.toFixed(4) },
      { label: '赛历轮次', value: `R${race.round}` },
      { label: '周末形式', value: race.sprint ? '冲刺' : '常规' },
    ])}
    <p class="block-note">
      赛道标识 <code>${escapeHtml(race.id)}</code> · 城市 ${escapeHtml(race.localityZh)}
    </p>
    <div class="panel-actions">
      <a class="btn btn-ghost" href="${safeUrl(mapsUrl)}" data-external>在地图上查看</a>
      ${race.url ? `<a class="btn btn-ghost" href="${safeUrl(race.url)}" data-external>赛道百科</a>` : ''}
    </div>`;
}

/** 本赛季各站冠军（真实成绩汇总） */
export function seasonWinnersHtml({ model, base = '' }) {
  const rows = model.races
    .filter((r) => r.status === 'completed')
    .map((r) => {
      const winner = model.results?.[r.round]?.[0];
      if (!winner) return null;
      return `
        <tr>
          <td class="mono">R${escapeHtml(String(r.round))}</td>
          <td>${escapeHtml(r.flag)} ${escapeHtml(r.nameZh)}</td>
          <td class="team-cell">${teamStripe(winner.teamColor)}
            ${avatar(driverPhoto(winner.driverId, base), { alt: surnameOf(winner) })}
            <span class="cell-name">${escapeHtml(surnameOf(winner))}</span>
            <span class="cell-sub">${escapeHtml(winner.team)}</span>
          </td>
          <td class="mono">${escapeHtml(winner.time || '—')}</td>
        </tr>`;
    })
    .filter(Boolean)
    .reverse()
    .join('');
  if (!rows) return emptyBox('本赛季尚无完赛记录。');
  return `
    <table class="table">
      <thead><tr><th>站</th><th>分站</th><th>冠军</th><th>完赛时间</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

export { card, emptyBox };
