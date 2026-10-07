#!/usr/bin/env node
/**
 * 采集真实 F1 数据，生成离线快照 assets/data/season.json
 *
 * 数据源：https://api.jolpi.ca/ergast/f1 （Ergast 镜像，免 API key）
 * 用法：node tools/fetch-data.mjs [season]
 *
 * 输出快照用途：桌面端断网时的回退数据；联网时渲染层会实时拉取同一数据源。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// 中文映射表与车队色由渲染层共用，避免两边漂移
import {
  RACE_ZH,
  CIRCUIT_ZH,
  COUNTRY_ZH,
  LOCALITY_ZH,
  NATIONALITY_ZH,
  DRIVER_ZH,
  TEAM_ZH,
  TEAM_COLOR,
  SESSION_LABEL,
} from '../assets/js/data/maps.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'assets', 'data', 'season.json');

const API = 'https://api.jolpi.ca/ergast/f1';
const SEASON = Number(process.argv[2]) || 2026;

/* ------------------------------------------------------------------ 工具 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'f1-hub-desktop/1.0 (data snapshot builder)' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === tries - 1) {
        console.warn(`  ! ${url} 失败：${err.message}`);
        return null;
      }
      await sleep(700 * (i + 1));
    }
  }
}

/** 带并发上限的 map，保证不把镜像打爆 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const zh = (map, key, fallback) => map[key] || fallback || key;

/** 把 Ergast 的 FirstPractice/Qualifying 等散字段收成有序 sessions 数组 */
function buildSessions(race) {
  const raw = [];
  const push = (key, node) => {
    if (node && node.date) raw.push({ key, date: node.date, time: node.time || '00:00:00Z' });
  };
  push('fp1', race.FirstPractice);
  push('fp2', race.SecondPractice);
  push('fp3', race.ThirdPractice);
  push('sprintQualifying', race.SprintQualifying || race.SprintShootout);
  push('sprint', race.Sprint);
  push('qualifying', race.Qualifying);
  if (race.date) raw.push({ key: 'race', date: race.date, time: race.time || '00:00:00Z' });

  return raw
    .map((s) => {
      const [label, labelEn] = SESSION_LABEL[s.key] || [s.key, s.key];
      const utc = `${s.date}T${String(s.time).replace('Z', '')}Z`;
      return { key: s.key, label, labelEn, utc, timestamp: Date.parse(utc) };
    })
    .filter((s) => Number.isFinite(s.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(({ timestamp, ...rest }) => rest);
}

/* ------------------------------------------------------------------ 主流程 */

async function main() {
  const now = Date.now();
  console.log(`采集 ${SEASON} 赛季真实数据 …`);

  // 读入上一次的快照作为兜底：镜像偶发超时时，不能把已经采到的成绩弄丢
  let previous = null;
  try {
    previous = JSON.parse(await readFile(OUT, 'utf8'));
    console.log(`  已载入上一版快照（${previous.generatedAt}）作为失败兜底`);
  } catch {
    console.log('  未发现上一版快照，将全新采集');
  }

  const racesJson = await getJson(`${API}/${SEASON}/races.json`);
  if (!racesJson) throw new Error('赛历采集失败，无法继续');
  const rawRaces = racesJson.MRData.RaceTable.Races;
  if (!rawRaces?.length) throw new Error('赛历为空');

  const races = rawRaces.map((r) => {
    const sessions = buildSessions(r);
    const raceSession = sessions.find((s) => s.key === 'race');
    const raceTs = raceSession ? Date.parse(raceSession.utc) : Date.parse(`${r.date}T${r.time || '00:00:00Z'}`);
    const cid = r.Circuit.circuitId;
    const country = r.Circuit.Location.country;
    return {
      round: Number(r.round),
      id: cid,
      name: r.raceName,
      nameZh: zh(RACE_ZH, r.raceName),
      circuitId: cid,
      circuit: r.Circuit.circuitName,
      circuitZh: zh(CIRCUIT_ZH, cid),
      locality: r.Circuit.Location.locality,
      localityZh: zh(LOCALITY_ZH, r.Circuit.Location.locality),
      country,
      countryZh: zh(COUNTRY_ZH, country),
      lat: Number(r.Circuit.Location.lat),
      long: Number(r.Circuit.Location.long),
      url: r.url,
      date: r.date,
      raceUtc: raceSession?.utc || null,
      sprint: Boolean(r.Sprint),
      sessions,
      status: raceTs < now ? 'completed' : 'upcoming',
    };
  });

  const completed = races.filter((r) => r.status === 'completed');
  console.log(`  赛历 ${races.length} 站（已完赛 ${completed.length}，待赛 ${races.length - completed.length}）`);

  /* 积分榜 */
  const [dsJson, csJson] = await Promise.all([
    getJson(`${API}/${SEASON}/driverStandings.json`),
    getJson(`${API}/${SEASON}/constructorStandings.json`),
  ]);

  const dsList = dsJson?.MRData?.StandingsTable?.StandingsLists?.[0];
  let drivers = (dsList?.DriverStandings || []).map((d) => {
    const team = d.Constructors?.[d.Constructors.length - 1] || {};
    const family = d.Driver.familyName;
    return {
      pos: Number(d.position),
      driverId: d.Driver.driverId,
      code: d.Driver.code || '',
      given: d.Driver.givenName,
      family,
      name: `${d.Driver.givenName} ${family}`,
      nameZh: DRIVER_ZH[d.Driver.driverId] || family,
      nationality: d.Driver.nationality,
      nationalityZh: zh(NATIONALITY_ZH, d.Driver.nationality),
      team: team.name || '',
      teamZh: zh(TEAM_ZH, team.name || ''),
      teamColor: TEAM_COLOR[team.name] || '#8b8b93',
      points: Number(d.points),
      wins: Number(d.wins),
    };
  });

  const csList = csJson?.MRData?.StandingsTable?.StandingsLists?.[0];
  let constructors = (csList?.ConstructorStandings || []).map((c) => ({
    pos: Number(c.position),
    teamId: c.Constructor.constructorId,
    team: c.Constructor.name,
    teamZh: zh(TEAM_ZH, c.Constructor.name),
    nationality: c.Constructor.nationality,
    nationalityZh: zh(NATIONALITY_ZH, c.Constructor.nationality),
    color: TEAM_COLOR[c.Constructor.name] || '#8b8b93',
    points: Number(c.points),
    wins: Number(c.wins),
  }));

  /* 积分榜兜底：接口抖动时沿用上一版快照。
     这里若直接写空数组，离线端整季积分榜会一片空白 —— 与分站成绩同一套兜底逻辑。 */
  const reusedStandings = [];
  if (!drivers.length && previous?.drivers?.length) {
    drivers = previous.drivers;
    reusedStandings.push(`车手 ${drivers.length} 位`);
  }
  if (!constructors.length && previous?.constructors?.length) {
    constructors = previous.constructors;
    reusedStandings.push(`车队 ${constructors.length} 支`);
  }
  if (reusedStandings.length) {
    console.log(`  ↩ 积分榜本轮采集失败，已沿用上一版快照（${reusedStandings.join('、')}）`);
  }

  /* 新数据为空且上一版也拿不到：宁可保留上一版快照，也不要产出残缺快照 */
  if (!drivers.length || !constructors.length) {
    const missing = [drivers.length ? null : '车手积分榜', constructors.length ? null : '车队积分榜'].filter(Boolean);
    console.error(`\n采集失败：${missing.join(' 与 ')}本轮未取到，上一版快照里也没有可用数据。`);
    console.error(`  为避免写出残缺快照（离线端会整季积分榜空白），本次不写入 ${OUT}`);
    process.exit(1);
  }

  /** 沿用上一版积分榜时，名次截止轮次也必须跟着沿用，否则会显示「截至第 16 站」却给出第 15 站数据 */
  const standingsRound = Number(dsList?.round) || Number(previous?.standingsRound) || completed.length;

  console.log(`  车手 ${drivers.length} 位、车队 ${constructors.length} 支（截至第 ${standingsRound} 站）`);

  /* 已完赛分站的成绩 / 轮胎停站 / 排位 */
  const results = {};
  const pitStops = {};
  const qualifying = {};
  let reused = 0;
  let lost = [];

  await mapLimit(completed, 3, async (r) => {
    const [resJson, pitJson, qJson] = await Promise.all([
      getJson(`${API}/${SEASON}/${r.round}/results.json`),
      getJson(`${API}/${SEASON}/${r.round}/pitstops.json`),
      getJson(`${API}/${SEASON}/${r.round}/qualifying.json`),
    ]);

    const raceNode = resJson?.MRData?.RaceTable?.Races?.[0];
    if (raceNode?.Results?.length) {
      results[r.round] = raceNode.Results.map((x) => ({
        pos: Number(x.position),
        driverId: x.Driver.driverId,
        name: `${x.Driver.givenName} ${x.Driver.familyName}`,
        nameZh: DRIVER_ZH[x.Driver.driverId] || x.Driver.familyName,
        code: x.Driver.code || '',
        team: x.Constructor.name,
        teamZh: zh(TEAM_ZH, x.Constructor.name),
        teamColor: TEAM_COLOR[x.Constructor.name] || '#8b8b93',
        grid: Number(x.grid),
        laps: Number(x.laps),
        status: x.status,
        points: Number(x.points),
        time: x.Time?.time || null,
        fastestLap: x.FastestLap?.rank === '1',
      }));
    }

    const pitNode = pitJson?.MRData?.RaceTable?.Races?.[0];
    if (pitNode?.PitStops?.length) {
      pitStops[r.round] = pitNode.PitStops.map((p) => ({
        driverId: p.driverId,
        lap: Number(p.lap),
        duration: p.duration,
      }));
    }

    const qNode = qJson?.MRData?.RaceTable?.Races?.[0];
    if (qNode?.QualifyingResults?.length) {
      qualifying[r.round] = qNode.QualifyingResults.map((q) => ({
        pos: Number(q.position),
        driverId: q.Driver.driverId,
        name: `${q.Driver.givenName} ${q.Driver.familyName}`,
        nameZh: DRIVER_ZH[q.Driver.driverId] || q.Driver.familyName,
        team: q.Constructor.name,
        teamColor: TEAM_COLOR[q.Constructor.name] || '#8b8b93',
        q1: q.Q1 || null,
        q2: q.Q2 || null,
        q3: q.Q3 || null,
      }));
    }

    process.stdout.write(`  第 ${r.round} 站成绩 ok（${results[r.round]?.length || 0} 名）\n`);
  });

  /* 失败兜底：本轮没拿到的站，沿用上一版快照 */
  for (const r of completed) {
    const key = r.round;
    let fromPrevious = false;
    if (!results[key]?.length && previous?.results?.[key]?.length) {
      results[key] = previous.results[key];
      fromPrevious = true;
    }
    if (!pitStops[key]?.length && previous?.pitStops?.[key]?.length) {
      pitStops[key] = previous.pitStops[key];
      fromPrevious = true;
    }
    if (!qualifying[key]?.length && previous?.qualifying?.[key]?.length) {
      qualifying[key] = previous.qualifying[key];
      fromPrevious = true;
    }
    if (fromPrevious) {
      reused += 1;
      console.log(`  ↩ 第 ${key} 站本轮采集失败，已沿用上一版快照`);
    }
    if (!results[key]?.length) lost.push(key);
  }
  console.log(`  成绩来源：新采 ${completed.length - reused} 站，沿用 ${reused} 站${lost.length ? `，仍缺失 ${lost.join('/')}` : ''}`);

  const nextRace = races.find((r) => r.status === 'upcoming') || null;

  const snapshot = {
    generatedAt: new Date(now).toISOString(),
    source: `${API}/${SEASON}`,
    season: SEASON,
    standingsRound,
    lastCompletedRound: completed.length ? completed[completed.length - 1].round : 0,
    nextRound: nextRace?.round ?? null,
    races,
    drivers,
    constructors,
    results,
    pitStops,
    qualifying,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  const size = JSON.stringify(snapshot).length;
  console.log(`\n已写入 ${OUT}`);
  console.log(`  快照体积 ${(size / 1024).toFixed(1)} KB`);
  console.log(`  下一站：R${nextRace?.round} ${nextRace?.nameZh} ${nextRace?.date} ${nextRace?.raceUtc}`);
}

main().catch((err) => {
  console.error('采集失败：', err);
  process.exit(1);
});
