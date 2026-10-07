/**
 * 从 TheSportsDB 下载 2026 车手 cutout 与车队 logo 到本地，并生成清单。
 * 用法：node tools/fetch-images.mjs [--force]
 *
 * 为什么用它：F1 官方图床 media.formula1.com 的直链 404/不可达，
 * Wikimedia（commons + upload）在本机网络完全不可达，jolpi/Ergast 系不带图。
 * TheSportsDB 是唯一实测可达且带透明 PNG 的源。
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const KEY = '3';
const BASE = `https://www.thesportsdb.com/api/v1/json/${KEY}`;
const TIMEOUT = 30000;
const FORCE = process.argv.includes('--force');

const ROOT = path.resolve('.');
const OUT_DRIVERS = path.join(ROOT, 'assets/img/drivers');
const OUT_TEAMS = path.join(ROOT, 'assets/img/teams');
const MANIFEST = path.join(ROOT, 'assets/data/images.json');

/**
 * TheSportsDB 免费 key 限速约 30 次/分钟，突发就 429。
 * 所有 API 调用统一走这里排队，两次之间至少间隔 PACE_MS。
 */
const PACE_MS = 2600;
let lastCall = 0;
async function getJson(url) {
  const gap = Date.now() - lastCall;
  if (gap < PACE_MS) await new Promise((r) => setTimeout(r, PACE_MS - gap));
  lastCall = Date.now();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'f1-hub/2.1' } });
      if (res.status === 429) {
        const wait = 20000 * attempt;
        console.log(`    · 429 限流，${wait / 1000}s 后重试（第 ${attempt}/3 次）`);
        await new Promise((r) => setTimeout(r, wait));
        lastCall = Date.now();
        continue;
      }
      if (!res.ok) return { __error: `HTTP ${res.status}` };
      return await res.json();
    } catch (e) {
      return { __error: String(e.message || e) };
    } finally { clearTimeout(t); }
  }
  return { __error: '429 持续限流' };
}

async function download(url, dest) {
  if (!FORCE && existsSync(dest)) {
    const s = await stat(dest);
    if (s.size > 500) return { skipped: true, bytes: s.size };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'f1-hub/2.1' } });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 500) return { error: `too small (${buf.byteLength}B)` };
    await writeFile(dest, buf);
    return { bytes: buf.byteLength, type: res.headers.get('content-type') || '?' };
  } catch (e) {
    return { error: String(e.message || e) };
  } finally { clearTimeout(t); }
}

await mkdir(OUT_DRIVERS, { recursive: true });
await mkdir(OUT_TEAMS, { recursive: true });

const snap = JSON.parse(await readFile('assets/data/season.json', 'utf8'));
const drivers = snap.drivers || [];
const constructors = snap.constructors || [];

const manifest = { source: 'TheSportsDB', license: '见 thesportsdb.com 条款；仅本地展示用', fetchedAt: new Date().toISOString(), drivers: {}, teams: {} };
let okD = 0, failD = 0, skipD = 0;

console.log('=== 车手 cutout ===');
for (const d of drivers) {
  const given = d.givenName || d.given || '';
  const family = d.familyName || d.family || '';
  const full = `${given} ${family}`.trim();
  const r = await getJson(`${BASE}/searchplayers.php?p=${encodeURIComponent(full)}`);
  const p = r && r.player && r.player[0];
  const url = p && (p.strCutout || p.strThumb);
  if (!url) { console.log(`  ✗ ${full.padEnd(26)} ${r.__error || '无图'}`); failD++; continue; }
  const file = `${d.driverId}.png`;
  const res = await download(url, path.join(OUT_DRIVERS, file));
  if (res.error) { console.log(`  ✗ ${full.padEnd(26)} ${res.error}`); failD++; continue; }
  manifest.drivers[d.driverId] = {
    name: full, code: d.code || '', number: d.permanentNumber || '',
    team: d.team || '', teamZh: d.teamZh || '', teamColor: d.teamColor || '',
    file: `assets/img/drivers/${file}`,
    source: url, idPlayer: p.idPlayer,
  };
  if (res.skipped) { skipD++; console.log(`  = ${full.padEnd(26)} 已存在 ${res.bytes}B`); }
  else { okD++; console.log(`  ✓ ${full.padEnd(26)} ${(res.bytes / 1024).toFixed(0)}KB`); }
}

console.log('\n=== 车队 logo ===');
let okT = 0, failT = 0, skipT = 0;
// 免费 key 对突发请求会返回 503，退避重试
async function getTeamsWithRetry(attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    const r = await getJson(`${BASE}/search_all_teams.php?l=Formula%201`);
    if (r && r.teams && r.teams.length) return r;
    const wait = 3000 * i;
    console.log(`  第 ${i} 次整表拉取失败（${r.__error || '空'}），${wait / 1000}s 后重试…`);
    await new Promise((res) => setTimeout(res, wait));
  }
  return { teams: [] };
}
const allTeams = await getTeamsWithRetry();
const teamList = (allTeams && allTeams.teams) || [];
if (!teamList.length) console.log('  整表拉取最终失败，将逐个 searchteams 兜底');

/**
 * 短名（"RB F1 Team"、"Audi"…）按词打分不可靠 —— "RB F1 Team" 里只有 "team"
 * 一个长词，而每支车队名都含 "team"，于是会被打到列表里第一支（实测错配成
 * Aston Martin）。这里逐个钉死 TheSportsDB 的 strTeam 关键字。
 */
const TEAM_OVERRIDE = {
  rb: 'Racing Bulls',
  red_bull: 'Red Bull Racing',
  aston_martin: 'Aston Martin',
  haas: 'Haas',
  audi: 'Audi',
  alpine: 'Alpine',
  williams: 'Williams',
  cadillac: 'Cadillac',
  mercedes: 'Mercedes',
  ferrari: 'Ferrari',
  mclaren: 'McLaren',
};

function matchTeam(c) {
  const key = TEAM_OVERRIDE[c.teamId];
  if (key) {
    const hit = teamList.find((t) => (t.strTeam || '').toLowerCase().includes(key.toLowerCase()));
    if (hit) return hit;
  }
  const want = (c.team || '').toLowerCase();
  const words = want.split(/\s+/).filter((w) => w.length > 3);
  let best = null, bestScore = 0;
  for (const t of teamList) {
    const hay = `${t.strTeam} ${t.strTeamShort || ''} ${t.strAlternate || ''}`.toLowerCase();
    const score = words.filter((w) => hay.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return bestScore >= 1 ? best : null;
}

for (const c of constructors) {
  const label = c.team || c.teamId || '?';
  let t = matchTeam(c);
  if (!t) {
    const r = await getJson(`${BASE}/searchteams.php?t=${encodeURIComponent(label)}`);
    t = (r && r.teams && r.teams[0]) || null;
    await new Promise((res) => setTimeout(res, 800));
  }
  const url = t && (t.strLogo || t.strTeamBadge || t.strBadge);
  if (!url) { console.log(`  ✗ ${label.padEnd(34)} 无 logo`); failT++; continue; }
  const file = `${c.teamId}.png`;
  const res = await download(url, path.join(OUT_TEAMS, file));
  if (res.error) { console.log(`  ✗ ${label.padEnd(34)} ${res.error}`); failT++; continue; }
  manifest.teams[c.teamId] = {
    name: label, nameZh: c.teamZh || '', nationality: c.nationality || '',
    file: `assets/img/teams/${file}`, source: url, matchedTeam: t.strTeam || '',
  };
  if (res.skipped) { skipT++; console.log(`  = ${label.padEnd(34)} 已存在 ${res.bytes}B`); }
  else { okT++; console.log(`  ✓ ${label.padEnd(34)} ${(res.bytes / 1024).toFixed(0)}KB  ← ${t.strTeam}`); }
}

await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`\n车手：新下 ${okD} / 已有 ${skipD} / 失败 ${failD}（共 ${drivers.length}）`);
console.log(`车队：新下 ${okT} / 已有 ${skipT} / 失败 ${failT}（共 ${constructors.length}）`);
console.log(`清单：assets/data/images.json`);

// 车队徽标必须再过一道归一化，否则渲染层会出问题（都是实测踩过的）：
//   · TheSportsDB 的 strLogo 统一 800x310 画布，但墨迹占比从 41% 到 92% 不等 ——
//     contain 适配的是画布，墨迹小的几家会显得又小又虚；
//   · aston_martin / cadillac / mercedes / mclaren 四家给的是**深色底用的白色版**，
//     放在本项目的亮色卡片上直接看不见。
// tools/normalize-logos.py 负责裁掉透明留白 + 把这四家重映射成深色墨。
const { spawnSync } = await import('node:child_process');
const py = process.env.F1_PYTHON || 'python';
const norm = spawnSync(py, ['tools/normalize-logos.py'], { stdio: 'inherit' });
if (norm.status !== 0) {
  console.error(`\n⚠️  徽标归一化未执行（${py} tools/normalize-logos.py 退出码 ${norm.status}）。`);
  console.error('    车队徽标会退回「白底白字 + 大小不一」的坏状态，请手动补跑：');
  console.error('    python tools/normalize-logos.py');
} else {
  console.log('徽标归一化：tools/normalize-logos.py 已完成（裁留白 + 白色版转深色）。');
}
