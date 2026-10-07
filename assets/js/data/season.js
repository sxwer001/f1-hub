/**
 * 赛季数据模型。
 *
 * 设计：内置快照（assets/data/season.json）是「基准 + 中文名字典 + 离线回退」，
 * 联网时叠加实时积分榜。分站状态一律在运行时按当前时间重算 ——
 * 快照生成后又有比赛结束时，界面必须自己反应过来，不能沿用快照里的旧 status。
 */

import { ENDPOINTS, SEASON_YEAR } from '../config.js';
import { loadSnapshot, getJson, clearCache } from '../net.js';
import {
  raceNameZh, circuitZh, countryZh, localityZh, nationalityZh,
  driverZh, teamZh, teamColor, flagEmoji, sessionLabel, sessionLabelEn, sessionShort,
} from './maps.js';
import { toDate } from '../utils.js';

const SESSION_ORDER = ['fp1', 'fp2', 'fp3', 'sprintQualifying', 'sprint', 'qualifying', 'race'];

/** 单节时长（用于判断「进行中」），排位与正赛给宽一点 */
const SESSION_DURATION_MS = {
  fp1: 60 * 60 * 1000,
  fp2: 60 * 60 * 1000,
  fp3: 60 * 60 * 1000,
  sprintQualifying: 45 * 60 * 1000,
  sprint: 60 * 60 * 1000,
  qualifying: 75 * 60 * 1000,
  race: 2.5 * 60 * 60 * 1000,
};

/** 某类会话的时长；类型未知时按正赛兜底（完赛判定宁晚勿早） */
function sessionDurationMs(key) {
  return SESSION_DURATION_MS[key] ?? SESSION_DURATION_MS.race;
}

/**
 * 分站「结束时刻」= 最后一节会话的开始时刻 + 该节时长。
 * 完赛判定必须用它，而不是最后一节的开始时刻 —— 详见 normalizeRace 里的说明。
 */
function raceEndTs(race) {
  // 只在**有 ts 的会话**里找最晚那节。缺 utc 的会话 ts=null，而 normalizeRace 用
  // `(a.ts ?? Infinity)` 排序，会把它们排到数组末尾 —— 照旧取末位会让整站恒判 upcoming。
  const timed = (race?.sessions || []).filter((s) => Number.isFinite(s?.ts));
  if (timed.length) {
    const last = timed.reduce((acc, s) => (s.ts > acc.ts ? s : acc), timed[0]);
    return last.ts + sessionDurationMs(last.key);
  }
  // 没有会话时间线时退到正赛时间（快照里偶尔缺 utc），同样按正赛时长算结束
  if (race?.raceUtc) {
    const ts = Date.parse(race.raceUtc);
    if (Number.isFinite(ts)) return ts + sessionDurationMs('race');
  }
  return null;
}

function normalizeSession(raw) {
  const ts = Date.parse(raw.utc);
  return {
    key: raw.key,
    label: raw.label || sessionLabel(raw.key),
    labelEn: raw.labelEn || sessionLabelEn(raw.key),
    short: sessionShort(raw.key),
    utc: raw.utc,
    ts: Number.isFinite(ts) ? ts : null,
  };
}

/** 会话状态：已结束 / 进行中 / 未开始 */
export function sessionState(session, now = Date.now()) {
  if (!session?.ts) return 'unknown';
  const duration = SESSION_DURATION_MS[session.key] ?? 60 * 60 * 1000;
  if (now >= session.ts + duration) return 'done';
  if (now >= session.ts) return 'live';
  return 'upcoming';
}

function normalizeRace(raw, now) {
  const sessions = (raw.sessions || [])
    .map(normalizeSession)
    .sort((a, b) => (a.ts ?? Infinity) - (b.ts ?? Infinity));
  const raceSession = sessions.find((s) => s.key === 'race') || null;
  const raceTs = raceSession?.ts ?? (raw.raceUtc ? Date.parse(raw.raceUtc) : null);
  const lastEndTs = raceEndTs({ sessions, raceUtc: raw.raceUtc });

  return {
    round: Number(raw.round),
    id: raw.id,
    name: raw.name,
    nameZh: raw.nameZh || raceNameZh(raw.name),
    circuit: raw.circuit,
    circuitZh: raw.circuitZh || circuitZh(raw.id),
    locality: raw.locality,
    localityZh: raw.localityZh || localityZh(raw.locality),
    country: raw.country,
    countryZh: raw.countryZh || countryZh(raw.country),
    flag: flagEmoji(raw.country),
    lat: Number(raw.lat),
    long: Number(raw.long),
    url: raw.url,
    date: raw.date,
    raceUtc: raceSession?.utc ?? raw.raceUtc ?? null,
    sprint: Boolean(raw.sprint),
    sessions,
    // 用结束时刻而不是开始时刻：正赛灯灭那一刻不能就算「已完成」，
    // 否则 nextRace 会提前跳站、首页不再显示正在直播的这场、成绩页切到空表。
    status: lastEndTs && now > lastEndTs ? 'completed' : 'upcoming',
  };
}

function normalizeDriver(raw, fallback) {
  const driverId = raw.driverId;
  const family = raw.family || fallback?.family || '';
  const team = raw.team || fallback?.team || '';
  return {
    pos: Number(raw.pos ?? 0),
    driverId,
    code: raw.code || fallback?.code || '',
    given: raw.given || fallback?.given || '',
    family,
    name: raw.name || fallback?.name || `${raw.given || ''} ${family}`.trim(),
    nameZh: fallback?.nameZh || driverZh(driverId, family),
    nationality: raw.nationality || fallback?.nationality || '',
    nationalityZh: nationalityZh(raw.nationality || fallback?.nationality, fallback?.nationalityZh),
    team,
    teamZh: teamZh(team, fallback?.teamZh),
    teamColor: teamColor(team),
    points: Number(raw.points ?? 0),
    wins: Number(raw.wins ?? 0),
  };
}

function normalizeConstructor(raw, fallback) {
  const team = raw.team || fallback?.team || '';
  return {
    pos: Number(raw.pos ?? 0),
    teamId: raw.teamId || fallback?.teamId || '',
    team,
    teamZh: teamZh(team, fallback?.teamZh),
    nationality: raw.nationality || fallback?.nationality || '',
    nationalityZh: nationalityZh(raw.nationality || fallback?.nationality, fallback?.nationalityZh),
    color: teamColor(team),
    points: Number(raw.points ?? 0),
    wins: Number(raw.wins ?? 0),
  };
}

/* ------------------------------------------------------------------ 实时积分榜 */

async function fetchLiveStandings(force = false) {
  const base = `${ENDPOINTS.season}/${SEASON_YEAR}`;
  const [ds, cs] = await Promise.all([
    getJson(`${base}/driverStandings.json`, { force }),
    getJson(`${base}/constructorStandings.json`, { force }),
  ]);

  const dsList = ds?.MRData?.StandingsTable?.StandingsLists?.[0];
  const csList = cs?.MRData?.StandingsTable?.StandingsLists?.[0];
  if (!dsList?.DriverStandings?.length || !csList?.ConstructorStandings?.length) {
    throw new Error('实时积分榜结构异常');
  }

  const drivers = dsList.DriverStandings.map((d) => ({
    pos: Number(d.position),
    driverId: d.Driver.driverId,
    code: d.Driver.code || '',
    given: d.Driver.givenName,
    family: d.Driver.familyName,
    name: `${d.Driver.givenName} ${d.Driver.familyName}`,
    nationality: d.Driver.nationality,
    team: d.Constructors?.[d.Constructors.length - 1]?.name || '',
    points: Number(d.points),
    wins: Number(d.wins),
  }));

  const constructors = csList.ConstructorStandings.map((c) => ({
    pos: Number(c.position),
    teamId: c.Constructor.constructorId,
    team: c.Constructor.name,
    nationality: c.Constructor.nationality,
    points: Number(c.points),
    wins: Number(c.wins),
  }));

  return { round: Number(dsList.round) || 0, drivers, constructors };
}

/* ------------------------------------------------------------------ 对外接口 */

export const SOURCE = { LIVE: 'live', SNAPSHOT: 'snapshot' };

/**
 * 载入赛季模型（**只用内置快照，不等待网络**）。
 * 快照先渲染，实时积分榜由 refreshLive() 在后台补齐 ——
 * 这样断网时首屏也是毫秒级出现，而不是先卡住几十秒等超时。
 * @param {{now?: number, force?: boolean}} options force=true 会先清掉 net.js 的渲染层缓存
 *   （快照缓存也在里面），手动刷新时用来绕过 TTL 拿最新数据。
 * @returns {Promise<object>} 赛季模型
 */
export async function loadSeason({ now = Date.now(), force = false } = {}) {
  // net.js 的 loadSnapshot() 自带模块级缓存且不接受参数，只能整层清掉才能拿到新快照
  if (force) clearCache();
  const snapshot = await loadSnapshot();

  const races = (snapshot.races || []).map((r) => normalizeRace(r, now));
  const byRound = new Map(races.map((r) => [r.round, r]));
  const byId = new Map(races.map((r) => [r.id, r]));

  const snapshotDrivers = new Map((snapshot.drivers || []).map((d) => [d.driverId, d]));
  const snapshotTeams = new Map((snapshot.constructors || []).map((c) => [c.team, c]));

  const model = {
    source: SOURCE.SNAPSHOT,
    season: snapshot.season ?? SEASON_YEAR,
    generatedAt: snapshot.generatedAt ?? null,
    loadedAt: new Date(now).toISOString(),
    standingsRound: snapshot.standingsRound ?? 0,
    races,
    byRound,
    byId,
    drivers: (snapshot.drivers || []).map((d) => normalizeDriver(d, snapshotDrivers.get(d.driverId))),
    constructors: (snapshot.constructors || []).map((c) => normalizeConstructor(c, snapshotTeams.get(c.team))),
    results: snapshot.results || {},
    pitStops: snapshot.pitStops || {},
    qualifying: snapshot.qualifying || {},
    nextRace: null,
    lastCompleted: null,
    upcomingSessions: [],
  };

  derive(model, now);
  return model;
}

/** 重算所有依赖「当前时间」的派生字段 */
function derive(model, now) {
  model.nextRace = nextRace(model.races, now);
  model.lastCompleted = [...model.races].reverse().find((r) => r.status === 'completed') || null;
  model.upcomingSessions = upcomingSessions(model.races, now, 6);
  return model;
}

/**
 * 用实时积分榜覆盖快照里的名次。失败时返回 null，调用方沿用快照即可。
 * @param {{now?: number, force?: boolean}} options force=true 绕过 net.js 的 TTL 直连接口
 * @returns {Promise<object|null>}
 */
export async function refreshLive(model, { now = Date.now(), force = false } = {}) {
  let live;
  try {
    live = await fetchLiveStandings(force);
  } catch (err) {
    console.warn('[season] 实时积分榜不可用，使用内置快照：', err.message);
    return null;
  }

  const snapshotDrivers = new Map(model.drivers.map((d) => [d.driverId, d]));
  const snapshotTeams = new Map(model.constructors.map((c) => [c.team, c]));

  const next = {
    ...model,
    source: SOURCE.LIVE,
    loadedAt: new Date(now).toISOString(),
    standingsRound: live.round,
    drivers: live.drivers.map((d) => normalizeDriver(d, snapshotDrivers.get(d.driverId))),
    constructors: live.constructors.map((c) => normalizeConstructor(c, snapshotTeams.get(c.team))),
  };
  return derive(next, now);
}

/** 分站状态随时间变化时，刷新现有模型（不重新读快照） */
export function retime(model, now = Date.now()) {
  model.races.forEach((race) => {
    // 与 normalizeRace 保持同一判据，否则运行时重算会把状态改回「灯灭即完赛」
    const end = raceEndTs(race);
    race.status = end && now > end ? 'completed' : 'upcoming';
  });
  return derive(model, now);
}


/** 下一场未结束的分站（按正赛时间） */
export function nextRace(races, now = Date.now()) {
  return races.find((r) => r.status === 'upcoming') || null;
}

/** 把未来若干节会话拉平成一条时间线 */
export function upcomingSessions(races, now = Date.now(), limit = 6) {
  const list = [];
  for (const race of races) {
    for (const session of race.sessions) {
      if (session.ts && session.ts > now) {
        list.push({ race, session, ts: session.ts, state: sessionState(session, now) });
      }
    }
  }
  list.sort((a, b) => a.ts - b.ts);
  return list.slice(0, limit);
}

/** 某站下一节会话（正在进行或即将开始） */
export function nextSessionOf(race, now = Date.now()) {
  if (!race?.sessions?.length) return null;
  const pending = race.sessions.find((s) => sessionState(s, now) !== 'done');
  return pending || race.sessions[race.sessions.length - 1];
}

/** 当前正在进行的分站（周末已开始但正赛未结束） */
export function activeRace(races, now = Date.now()) {
  return races.find((r) => {
    if (!r.sessions.length) return false;
    const first = r.sessions[0];
    const end = raceEndTs(r);
    return first.ts && first.ts <= now && end && now <= end;
  }) || null;
}

/** 某站成绩（含名次、车队色、是否最快圈） */
export function raceResults(model, round) {
  const rows = model.results?.[round] || [];
  return rows.map((r) => ({
    ...r,
    nameZh: r.nameZh || driverZh(r.driverId, r.name),
    teamZh: teamZh(r.team, r.teamZh),
    teamColor: teamColor(r.team),
  }));
}

export function racePitStops(model, round) {
  return model.pitStops?.[round] || [];
}

export function raceQualifying(model, round) {
  return (model.qualifying?.[round] || []).map((q) => ({
    ...q,
    nameZh: q.nameZh || driverZh(q.driverId, q.name),
    teamColor: teamColor(q.team),
  }));
}

/**
 * 轮胎策略推断：用真实停站数据推「进站次数」与各车手停站圈数分布。
 * 不再使用编造的预期值，全部来自实际比赛记录。
 */
export function tyreInsight(model, round) {
  const stops = racePitStops(model, round);
  if (!stops.length) return null;
  const perDriver = new Map();
  for (const s of stops) {
    if (!perDriver.has(s.driverId)) perDriver.set(s.driverId, []);
    perDriver.get(s.driverId).push(s);
  }
  const counts = [...perDriver.values()].map((v) => v.length);
  const total = counts.length || 1;
  const avg = counts.reduce((a, b) => a + b, 0) / total;
  const histogram = new Map();
  counts.forEach((c) => histogram.set(c, (histogram.get(c) || 0) + 1));

  const windows = [...perDriver.entries()]
    .map(([driverId, list]) => ({
      driverId,
      laps: list.map((x) => x.lap).sort((a, b) => a - b),
      count: list.length,
      fastest: list.reduce((best, x) => (best === null || secondsOf(x.duration) < secondsOf(best) ? x.duration : best), null),
    }))
    .sort((a, b) => a.count - b.count || a.laps[0] - b.laps[0]);

  return {
    totalStops: stops.length,
    driversWithStops: perDriver.size,
    averageStops: Number(avg.toFixed(2)),
    histogram: [...histogram.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([stopCount, driverCount]) => ({ stops: stopCount, drivers: driverCount })),
    windows,
  };
}

/** '1:21.474' 或 '38.032' -> 秒 */
export function secondsOf(duration) {
  if (!duration) return Number.POSITIVE_INFINITY;
  const text = String(duration);
  if (text.includes(':')) {
    const [m, s] = text.split(':');
    return Number(m) * 60 + Number(s);
  }
  return Number(text);
}

/** 使用的会话顺序（导出给视图用） */
export const SESSION_KEYS = SESSION_ORDER;

/** 日期对象化（给日历用） */
export function raceDate(race) {
  return toDate(race?.raceUtc || race?.date);
}
