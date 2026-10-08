#!/usr/bin/env node
/** Review 问题回归：真实页面 + 可控时钟、网络与桌面桥，完全离线运行。 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { JSDOM } from 'jsdom';

const mode = process.argv[2];
if (!mode) {
  // 页面控制器有模块级状态，每个场景使用独立进程。
  for (const scenario of ['data', 'home', 'race', 'results', 'schedule', 'standings']) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), scenario], {
      stdio: 'inherit', timeout: 30_000,
    });
    if (child.error) throw child.error;
    if (child.status !== 0) process.exit(child.status || 1);
  }
  console.log('Review 回归场景全部通过。');
  process.exit(0);
}

const snapshot = JSON.parse(await readFile(new URL('../assets/data/season.json', import.meta.url), 'utf8'));
const r17 = snapshot.races.find((r) => r.round === 17);
const raceStart = Date.parse(r17.raceUtc);
let clock = raceStart - 10 * 60_000;
Date.now = () => clock;
let offline = false;
let emptyResults = false;
let failPitPage = false;
let newsRequests = 0;
let standingsRequests = 0;
const calls = [];
const driver = { driverId: 'norris', givenName: 'Lando', familyName: 'Norris', code: 'NOR' };
const constructor = { constructorId: 'mclaren', name: 'McLaren' };
const newResult = { position: '1', Driver: driver, Constructor: constructor, grid: '2', laps: '62',
  points: '25', status: 'Finished', Time: { time: '1:35:00.000' }, FastestLap: { rank: '1' } };

function remote(href) {
  calls.push(href);
  if (offline) throw new Error('模拟断网');
  if (href.includes('formula1.com')) {
    newsRequests++;
    return '<rss><channel><item><title>测试新闻</title><link>https://www.formula1.com/test</link></item></channel></rss>';
  }
  if (href.includes('open-meteo.com')) return JSON.stringify({ hourly: { time: [] }, daily: { time: [] } });
  if (href.includes('Standings.json')) {
    standingsRequests++;
    const list = href.includes('driverStandings')
      ? { DriverStandings: [{ position: '1', points: '25', wins: '1', Driver: driver, Constructors: [constructor] }] }
      : { ConstructorStandings: [{ position: '1', points: '25', wins: '1', Constructor: constructor }] };
    return JSON.stringify({ MRData: { StandingsTable: { StandingsLists: [{ round: '17', ...list }] } } });
  }
  const url = new URL(href);
  const round = Number(url.pathname.match(/\/2026\/(\d+)\//)?.[1]);
  const offset = Number(url.searchParams.get('offset') || 0);
  let field, rows;
  if (href.includes('/pitstops.json')) {
    if (failPitPage && offset > 0) throw new Error('模拟分页下载失败');
    field = 'PitStops';
    rows = round === 17 ? Array.from({ length: 101 }, (_, i) => ({ driverId: 'norris', lap: String(i + 1), duration: '22.1' }))
      : (snapshot.pitStops[round] || []);
  } else if (href.includes('/qualifying.json')) {
    field = 'QualifyingResults';
    rows = round === 17 ? [{ position: '1', Driver: driver, Constructor: constructor, Q1: '1:30.0', Q2: '1:29.0', Q3: '1:28.0' }]
      : (snapshot.qualifying[round] || []).map((q) => ({ position: String(q.pos),
        Driver: { ...driver, driverId: q.driverId, familyName: q.name }, Constructor: { ...constructor, name: q.team },
        Q1: q.q1, Q2: q.q2, Q3: q.q3 }));
  } else if (href.includes('/results.json')) {
    field = 'Results';
    rows = emptyResults ? [] : round === 17 ? [newResult] : (snapshot.results[round] || []).map((r) => ({
      ...newResult, position: String(r.pos), Driver: { ...driver, driverId: r.driverId, familyName: r.name },
      Constructor: { ...constructor, name: r.team }, grid: String(r.grid), laps: String(r.laps), points: String(r.points),
      status: r.status === 'Lapped' ? '+1 Lap' : r.status, Time: { time: r.time },
    }));
  } else throw new Error('未预期的 URL：' + href);
  return JSON.stringify({ MRData: { total: String(rows.length), offset: String(offset), limit: '100',
    RaceTable: { Races: [{ round: String(round), [field]: rows.slice(offset, offset + 100) }] } } });
}

globalThis.fetch = async (input) => {
  const href = String(input);
  return new Response(href.startsWith('file:') ? JSON.stringify(snapshot) : remote(href));
};
const check = (label, fn) => { fn(); console.log(`PASS [${mode}] ${label}`); };

if (mode === 'data') {
  const { loadSeason, refreshLive } = await import('../assets/js/data/season.js');
  const { clearCache } = await import('../assets/js/net.js');
  let model = await loadSeason({ now: clock });
  clock = raceStart + 4 * 3600_000;
  model = await refreshLive(model, { now: clock });
  check('联网刷新推进完赛状态和下一站', () => {
    assert.equal(model.lastCompleted.round, 17);
    assert.equal(model.nextRace.round, 18);
  });
  check('补齐新分站成绩、排位、所有进站分页', () => {
    assert.equal(model.results[17][0].driverId, 'norris');
    assert.equal(model.results[17][0].fastestLap, true);
    assert.equal(model.qualifying[17][0].q3, '1:28.0');
    assert.equal(model.pitStops[17].length, 101);
    assert(calls.some((href) => href.includes('pitstops.json?limit=100&offset=100')));
    assert(!snapshot.results[17]);
  });
  clearCache();
  emptyResults = true;
  failPitPage = true;
  const fallback = await refreshLive(model, { now: clock, force: true });
  check('空响应和分页中途失败不覆盖已有成绩', () => {
    assert.deepEqual(fallback.results[17], model.results[17]);
    assert.deepEqual(fallback.pitStops[17], model.pitStops[17]);
  });
  emptyResults = false;
  failPitPage = false;
  newResult.status = 'Disqualified';
  const disqualified = await refreshLive(model, { now: clock, force: true });
  check('在线成绩保留取消资格状态', () => assert.equal(disqualified.results[17][0].status, 'Disqualified'));
  newResult.status = 'Finished';
  clearCache();
  offline = true;
  const stale = await loadSeason({ now: raceStart - 60_000 });
  const failed = await refreshLive(stale, { now: clock, force: true });
  check('断网也推进状态，保留快照并返回失败标记', () => {
    assert.equal(failed, null);
    assert.equal(stale.lastCompleted.round, 17);
    assert.equal(stale.results[16].length, snapshot.results[16].length);
  });
  clearCache();
  offline = false;
  emptyResults = false;
  failPitPage = false;
  clock = Date.parse(r17.sessions.find((s) => s.key === 'qualifying').utc) + 80 * 60_000;
  const saturday = await loadSeason({ now: clock });
  const afterQualifying = await refreshLive(saturday, { now: clock });
  check('正赛未结束也能显示已发布的排位成绩', () => {
    assert.equal(afterQualifying.qualifying[17][0].q3, '1:28.0');
    assert(!afterQualifying.results[17]);
  });
  process.exit(0);
}

const page = mode === 'home' ? 'index.html' : `pages/${mode === 'race' ? 'race' : mode}.html`;
const html = await readFile(new URL('../' + page, import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: `http://localhost/${page}${mode === 'race' ? '?round=17' : ''}`, pretendToBeVisual: true });
for (const key of ['window', 'document', 'location', 'localStorage', 'DOMParser', 'Node', 'HTMLElement', 'MouseEvent']) {
  globalThis[key] = dom.window[key];
}
const timers = new Map();
let timerId = 0;
globalThis.setInterval = (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; };
globalThis.clearInterval = (id) => timers.delete(id);
let settings = { theme: 'light', settingsVersion: 3, notifyEnabled: true, notifyLeadMinutes: 15, favoriteDrivers: [], favoriteTeams: [] };
const notifications = [];
window.f1 = {
  isDesktop: true,
  getSettings: async () => settings,
  saveSettings: async (patch) => (settings = { ...settings, ...patch }),
  getInfo: async () => ({ name: 'F1 观赛助手', version: '1.0.2', titlebarHeight: 58 }),
  setTheme: async (theme) => ({ theme }),
  notify: async (payload) => { notifications.push(payload); return { shown: true }; },
  fetch: async (url) => ({ ok: true, status: 200, body: remote(url) }),
};
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}
function tick(ms) {
  const timer = [...timers.values()].find((entry) => entry.ms === ms);
  assert(timer, `找不到 ${ms}ms 定时器`);
  timer.fn();
}
await import(`../assets/js/pages/${mode === 'race' ? 'race-detail' : mode}.js`);
await settle();
const d = dom.window.document;

if (mode === 'home') {
  check('启动时自动刷新定时器已经注册', () => assert([...timers.values()].some((entry) => entry.ms === 600_000)));
  const before = { news: newsRequests, standings: standingsRequests };
  clock += 600_000;
  tick(600_000);
  await settle();
  const afterFirstRefresh = standingsRequests;
  // 新闻有 15 分钟 TTL；第二轮到期后必须重新请求。
  clock += 600_000;
  tick(600_000);
  await settle();
  check('自动刷新能重新取积分榜和到期新闻', () => {
    assert(afterFirstRefresh > before.standings);
    assert(newsRequests > before.news);
  });
  clock = raceStart + 30_000;
  tick(1000);
  check('正赛进行中标题和数字指向同一会话', () => {
    assert(d.querySelector('.cd-strip-label').textContent.includes('进行中'));
    assert(d.querySelector('.cd-strip-title').textContent.includes(r17.name));
    assert([...d.querySelectorAll('#hero-count-target .cd-cell b')].every((el) => el.textContent === '00'));
  });
  clock = raceStart + 4 * 3600_000;
  tick(1000);
  check('正赛结束后无需联网即可切到下一站', () => assert(d.querySelector('.cd-strip-title').textContent.includes(snapshot.races.find((r) => r.round === 18).name)));
  window.dispatchEvent(new window.Event('beforeunload'));
  check('卸载会清除自动刷新定时器', () => assert(![...timers.values()].some((entry) => entry.ms === 600_000)));
} else if (mode === 'race') {
  d.getElementById('act-settings').click();
  check('分站设置按钮能打开设置面板', () => assert.equal(d.getElementById('settings-pop').hidden, false));
  const theme = d.getElementById('set-theme');
  theme.value = 'dark';
  theme.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  d.getElementById('act-settings').click();
  d.getElementById('act-settings').click();
  check('设置修改即时生效且重新打开后保留', () => {
    assert.equal(d.documentElement.dataset.theme, 'dark');
    assert.equal(d.getElementById('set-theme').value, 'dark');
  });
  check('停在分站页仍发送赛前提醒', () => assert(notifications.some((payload) => payload.title.includes(r17.nameZh))));
  clock = raceStart + 4 * 3600_000;
  tick(600_000);
  await settle();
  check('分站页自动刷新能显示新成绩和排位', () => {
    assert.equal(d.querySelectorAll('#result-body tbody tr').length, 1);
    assert.equal(d.querySelectorAll('#qualifying-body tbody tr').length, 1);
  });
} else if (mode === 'results') {
  clock = raceStart + 4 * 3600_000;
  offline = true;
  tick(1000);
  check('成绩页断网心跳也会增加最新完赛选项', () => assert(d.querySelector('#round-select option[value="17"]')));
  offline = false;
  tick(600_000);
  await settle();
  const picker = d.getElementById('round-select');
  picker.value = '17';
  picker.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('切换新分站显示在线成绩', () => assert.equal(d.querySelectorAll('#result-body tbody tr').length, 1));
} else {
  offline = true;
  clock = raceStart + 4 * 3600_000;
  tick(1000);
  check('断网心跳更新次栏分站', () => assert.equal(d.getElementById('sub-round').textContent, 'R18'));
  if (mode === 'schedule') check('赛历已完成分站卡片增至 17 站', () => assert.equal(d.querySelectorAll('#cards-done .race-card').length, 17));
  else check('积分榜已完成站数随时间更新', () => assert(d.getElementById('overview-note').textContent.includes('17 站')));
}
process.exit(0);
