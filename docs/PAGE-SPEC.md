# 页面开发规范（子智能体共用）

> 本文件是所有页面子任务的**唯一约定来源**。开工前通读，不要凭猜测改共享文件。

## 项目背景

本仓库（仓库根目录）是 **F1 观赛助手** —— Electron 桌面应用，渲染层是**零构建的原生 ES Module 前端**（无打包器，浏览器直接跑 `type="module"`）。

数据全部真实：2026 赛季 23 站赛历、23 位车手 / 11 支车队的积分、16 站完赛成绩/排位/进站。数据来自 jolpi.ca（Ergast 镜像），桌面端经主进程 IPC 代理（`net:fetch`）。

## 现状与本次目标

首页目前把倒计时、赛历卡片、周末时间表、上一站成绩、积分榜、新闻、设置**全部堆在一起**。本次要拆成独立页面：

| 页面 | 文件 | 内容 |
|---|---|---|
| 首页 | `index.html` | 下一站倒计时 + 下一站数据与时间 + 相关新闻（**共 3 个 section，不堆全量数据**） |
| 赛历 | `pages/schedule.html` | 23 站卡片（已完成 / 后续） |
| 积分榜 | `pages/standings.html` | 车手 / 车队完整积分榜 + 关注 |
| 成绩 | `pages/results.html` | 上一站正赛/排位/进站 + 本赛季分站冠军 |
| 分站详情 | `pages/race.html` | 已有，单站详情 |

顶栏导航固定 4 项：**赛历 / 积分榜 / 成绩 / 分站**（logo 点击回首页）。

## 硬性约定

1. **语言**：界面标签用中文；**专有名词一律英文**（国家 / 城市 / 赛道 / 车手 / 车队 / 分站名）。车手用姓氏，取 `surnameOf(entry)`。
2. **主题**：亮色 —— `#f3f3f4` 底 + 白卡片 + 黑色顶栏/次栏 + `#e10600` 强调。**不要硬编码颜色**，一律用 `tokens.css` 的变量：`--bg --surface --surface-2 --surface-sunken --ink --ink-2 --ink-3 --ink-4 --line --line-2 --brand --brand-ink --bar --bar-ink --bar-ink-dim --positive --negative --warning --sector-purple`。
3. **字体**：**不要设置 `font-family`**，继承即可（`tokens.css` 已配好 Titillium Web + 阿里巴巴普惠体）。
4. **安全**：所有写入 DOM 的动态文本必须经 `escapeHtml`；所有链接必须经 `safeUrl`；写进内联 `style` 的颜色必须经 `safeColor`。**禁止裸插值**。
5. **不要编辑这些共享文件**（只读参考）：
   `assets/css/main.css`、`assets/css/tokens.css`、
   `assets/js/{config,utils,net,store,platform}.js`、
   `assets/js/data/*`、`assets/js/domain/*`、
   `assets/js/ui/{shell,dashboard,race,atoms}.js`、
   `electron/*`、`package.json`、`tools/check-page.mjs`、`tools/check-pages.mjs`
6. **你只能创建/修改**：你自己的 HTML、`assets/js/pages/<你的控制器>.js`、以及（如需页面专属样式）`assets/css/pages/<name>.css`（只在你的 HTML 里 `<link>`）。需要改共享文件时，写进报告让我来改。
7. **不要用 `alert`/`confirm`/内联事件属性**（CSP 禁止内联脚本）。

## HTML 骨架（class 名不可改，id 不可改）

根目录页面：`base = ''`，资源路径不带 `../`；`pages/` 下页面：`base = '../'`，资源路径带 `../`。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.jolpi.ca https://api.open-meteo.com https://www.formula1.com https://www.motorsport.com; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>… · F1 观赛助手</title>
  <link rel="stylesheet" href="../assets/css/tokens.css">
  <link rel="stylesheet" href="../assets/css/main.css">
  <!-- 如需页面专属样式：<link rel="stylesheet" href="../assets/css/pages/<name>.css"> -->
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <a class="f1-logo" href="../index.html" aria-label="F1"><b>F1</b></a>
      <nav class="topnav" id="topnav"><!-- 由 navHtml(active, base) 注入 --></nav>
      <div class="topbar-right"><span class="topbar-chip" id="data-source">数据加载中</span></div>
    </div>
    <div class="topbar-cuts" aria-hidden="true"></div>
  </header>

  <div class="subbar">
    <div class="subbar-inner">
      <div class="subbar-race">
        <span class="sub-round" id="sub-round">R--</span>
        <span class="sub-date" id="sub-date">-- – -- ---</span>
        <span class="sub-name"><span class="flag-badge" id="sub-flag">--</span><span id="sub-name">载入中</span></span>
      </div>
      <div class="clocks">
        <div class="clock"><span class="clock-dot" aria-hidden="true"></span>
          <span class="clock-label">MY TIME</span><span class="clock-time" id="clock-local">--:--</span></div>
        <div class="clock"><span class="clock-label">TRACK TIME</span><span class="clock-time" id="clock-track">--:--</span></div>
      </div>
    </div>
  </div>

  <main class="page">
    <div class="page-head">
      <h1 class="display">页面大标题</h1>
      <div class="page-head-actions"><!-- 可选按钮 --></div>
    </div>
    <!-- 内容区：用 .band / .cards / .card / .split 组织 -->
  </main>

  <footer class="app-footer"><div class="status-bar" id="status-bar"></div></footer>
  <script type="module" src="../assets/js/pages/<name>.js"></script>
</body>
</html>
```

## 控制器标准写法

```js
import { APP_NAME } from '../config.js';
import { loadSeason, refreshLive } from '../data/season.js';
import { initSettings } from '../store.js';
import { onTick } from '../domain/schedule.js';
import {
  navHtml, mountShell, renderClocks, applyTheme, initShellChrome,
  bindShellEvents, favoritesSnapshot,
} from '../ui/shell.js';
import { byId, setHTML } from '../utils.js';
import { skeleton, errorBox } from '../ui/atoms.js';

const state = { model: null, now: Date.now() };

async function boot() {
  // 1) 先把导航注入静态骨架
  setHTML(byId('topnav'), navHtml('schedule', '../'));   // ← 改成你的 active key 与 base

  // 2) 外壳与主题
  await initSettings();
  applyTheme();
  const info = await initShellChrome();

  // 3) 先注册事件，再做任何网络请求（否则交互没有反馈）
  bindShellEvents({ onFavoritesChanged: () => render() });

  // 4) 内置快照立刻出画面（毫秒级）
  try {
    state.model = await loadSeason({});
  } catch (err) {
    setHTML(byId('some-body'), errorBox('数据加载失败。', '请检查 assets/data/season.json 是否存在。'));
    return;
  }
  mountShell({ race: state.model.nextRace || state.model.lastCompleted, model: state.model });
  render();

  // 5) 实时积分榜后台补齐
  refreshLive(state.model)
    .then((live) => { if (live) { state.model = live; render(); mountShell({ race: state.model.nextRace, model: live }); } })
    .catch((err) => console.warn(err));

  // 6) 心跳：每秒只更新时钟与倒计时数字，避免整页重排
  onTick((now) => {
    state.now = now;
    renderClocks(state.model?.nextRace || state.model?.lastCompleted, now);
    // 每 30 秒才重绘较重区块
    if (now - (state.lastPaint || 0) > 30_000) { state.lastPaint = now; render(); }
  });
}

boot();
```

## 共享 API（只读使用）

### `assets/js/ui/shell.js`
- `NAV` —— 4 项导航定义（`{key,label,file}`，key 为 `schedule|standings|results|race`）
- `navHtml(active, base)` → 顶栏导航项 HTML（`active` 匹配时加 `.is-active`）
- `mountShell({ race, model })` → 填数据源徽标、黑次栏、双时钟
- `renderClocks(race, now)`
- `applyTheme()` / `initShellChrome()` → 后者返回 appInfo（含 `titlebarHeight`）
- `favoritesSnapshot()` → `{drivers:[], teams:[]}`
- `bindShellEvents({ onFavoritesChanged, onRefresh, onStandingsTab })` → 绑定关注星标、`data-external`（外链交给系统浏览器）、设置面板（`#act-settings` 开关 + `#settings-pop` 内的 change）、`#act-refresh/#act-test-notify/#act-about`、`.seg-btn`、窗口按钮。**赛前提醒引擎与设置面板都在这一层**，五个页面行为一致
- `LEAD_MINUTES_CHOICES`

### `assets/js/data/season.js`
`loadSeason({now})`、`refreshLive(model)`、`sessionState(session,now)`、`raceResults(model,round)`、`raceQualifying(model,round)`、`racePitStops(model,round)`、`tyreInsight(model,round)`、`nextSessionOf(race,now)`、`raceDate(race)`、`nextRace(races,now)`、`upcomingSessions(races,now,limit)`

**model 字段**：`source`(`'live'|'snapshot'`)、`season`、`standingsRound`、`races[]`、`byRound`(Map)、`byId`(Map)、`drivers[]`、`constructors[]`、`results{round:[]}`、`pitStops`、`qualifying`、`nextRace`、`lastCompleted`、`upcomingSessions[]`

**race 字段**：`round`、`id`、`name`(英文)、`nameZh`、`circuit`、`circuitZh`、`locality`、`country`、`countryZh`、`flag`、`lat`、`long`、`url`、`date`、`raceUtc`、`sprint`、`sessions[{key,label,labelEn,short,utc,ts}]`、`status`(`'completed'|'upcoming'`)

**driver 字段**：`pos`、`driverId`、`code`、`given`、`family`、`name`、`nameZh`、`nationality`、`team`、`teamZh`、`teamColor`、`points`、`wins`
**constructor 字段**：`pos`、`teamId`、`team`、`teamZh`、`nationality`、`color`、`points`、`wins`

### `assets/js/utils.js`
`escapeHtml`、`safeUrl`、`safeColor`、`surnameOf`、`flagCode`、`byId`、`$`、`$$`、`setHTML`、`setText`、`cls`、`toInt`、`fmtDate`、`fmtTime`、`fmtDateTime`、`fmtDayLabel`、`fmtDateRange(startIso,endIso,tz)`、`fmtZoneDateTime`、`relativeTime`、`humanizeDuration`、`countdownParts`、`tzLabel`、`zoneTime`、`MONTH_EN`

### `assets/js/data/maps.js`
`circuitTimeZone(circuitId)`（IANA 时区名，用于赛道当地日期/时间）、`teamColor(team)`、`sessionLabel/sessionLabelEn/sessionShort`

### `assets/js/ui/atoms.js`
`card(titleHtml, bodyHtml, {className, actions, id})`、`skeleton(text)`、`emptyBox(text)`、`errorBox(text, hint)`、`teamStripe(color)`、`chip(text,{tone,title})`、`starButton(kind, id, active, label)`、`countdownHtml(cells)`、`statRow([{label,value}])`、`posClass(pos)`

### `assets/js/ui/dashboard.js`
`heroStripHtml({model,now})`、`countdownOnly(summary,now)`、`raceCardHtml({race,model,now,variant:'next'|'done'|'upcoming'})`、`cardsHtml({races,model,now,variant})`、`standingsHtml({rows,type:'driver'|'constructor',favorites,limit})`、`lastResultHtml({model,favorites})`、`newsHtml(items)`、`settingsHtml({settings,info,leadChoices,reminderCount})`、`statusBarHtml({model,info,now})`

### `assets/js/ui/race.js`
`detailHeroHtml({race,forecast})`、`sessionsPanelHtml({race,forecast,now})`、`resultPanelHtml({model,race,favorites})`、`qualifyingPanelHtml({model,race})`、`pitPanelHtml({model,race})`、`circuitPanelHtml({race})`、`seasonWinnersHtml({model})`

### `assets/js/data/news.js`
`getNews(limit)` → `[{title, link, summary, author, publishedAt}]`（点击经 `data-external` 交给系统浏览器）

### `assets/js/data/weather.js`
`getRaceForecast(race)`、`forecastForSession(forecast, session)`、`forecastForRaceDay(forecast, race)`、`weatherText(code)`

### `assets/js/domain/schedule.js`
`onTick(fn)` → 退订函数、`countdownCells(ms)`、`createReminderEngine(getModel)`、`nextSessionSummary(model, now)`

## 可用的 CSS 类（已在 `main.css`）

```
.topbar/.topbar-inner/.f1-logo/.topnav/.topnav-item(.is-active)/.topbar-right/.topbar-chip/.topbar-cuts
.subbar/.subbar-inner/.subbar-race/.sub-round/.sub-date/.sub-name/.flag-badge/.clocks/.clock/.clock-label/.clock-time/.clock-dot
.page/.page-head/.display/.page-head-actions
.pill-btn/.pill-btn-red/.pill-btn-white/.pill-btn-ghost
.countdown-strip/.cd-strip-label/.cd-strip-title/.cd-strip-note/.countdown/.cd-cell
.band/.band-head/.band-title/.band-note/.cards/.cards-featured
.race-card(.is-next/.is-done)/.card-top/.card-round/.card-date-pill/.card-country/.card-subtitle/.card-foot/.card-when/.card-hint
.podium/.podium-item/.podium-pos/.podium-code/.podium-times
.split/.split-main/.split-rail/.card/.card-head/.card-title/.card-caption/.card-body/.block-note/.panel-actions
.table/.pos/.pos-1/.pos-2/.pos-3/.team-cell/.team-stripe/.cell-name/.cell-sub/.pts/.mono/.up/.down/.tag/.tag-live/.is-fav
.seg/.seg-btn(.is-active)/.star(.is-on)/.fav-cell
.stat-row/.stat/.chip/.chip-sprint/.chip-weather
.sched-list/.sched-row(.is-race/.is-live)/.sched-day/.sched-time/.sched-name/.sched-wx/.sched-state
.news-list/.news-meta/.settings/.setting-row/.setting-actions/.setting-note
.state/.state-loading/.state-empty/.state-error/.state-hint/.muted
.app-footer/.status-bar/.status-item
```

**图片素材**：本项目最终采用的图片是车手半身像与车队徽标，落在 `assets/img/drivers/<driverId>.png` 与
`assets/img/teams/<teamId>.png`（来源 TheSportsDB，采集脚本 `tools/fetch-images.mjs`，清单 `assets/data/images.json`）。
渲染层通过 `assets/js/data/photos.js` 的 `driverPhoto(id, base)` / `teamLogo(id, base)` 取路径，**缺图返回空串**，
再交给 `assets/js/ui/atoms.js` 的 `avatar()` 优雅降级 —— 不要手写 `<img src>`，也不要假设图一定存在。
（早期计划里的 `assets/img/photos/*.jpg` 场景照方案未落地，该目录已删除。）

## 验证（必须做，并在报告里贴真实输出）

```powershell
pnpm install --frozen-lockfile
pnpm check
# 自定义脚本默认使用项目内的 jsdom，无需设置 F1_JSDOM_ROOT。
# 如需使用其他工作区的 jsdom，可选设置：
# $env:F1_JSDOM_ROOT = '<含 node_modules\jsdom 的目录>'
node <你的临时冒烟脚本>
```

冒烟脚本要点（**照 `tools/check-page.mjs` 的写法，但只读参考、不要改它**）：
1. `readFile` 读你的 HTML，`new JSDOM(html, { url: 'http://localhost/<你的路径>', pretendToBeVisual: true })`
2. 把 `globalThis.window/document/location/localStorage/DOMParser/Node/HTMLElement/MouseEvent` 指向 jsdom
3. 把 `fetch` 包装一层：`file:` 开头的 URL 用 `readFile(fileURLToPath(href))` 返回 `new Response(text,{status:200})`，其余交给原生 fetch
4. `await import(new URL('../assets/js/pages/<你的控制器>.js', import.meta.url).href)`
5. 轮询等待关键区块渲染完成（**不要用固定 sleep**）
6. 断言：关键表格/卡片行数 > 0、无 `.state-error`、渲染容器内无 `<script>` 注入
7. 断言失败时 `process.exit(1)`、全部通过才 `process.exit(0)` —— 不要写成恒 0 的「假绿灯」

临时脚本放 `tools/_smoke-<name>.mjs`，报告里贴出输出。

## 交付报告格式

1. 创建/修改的文件清单（路径 + 一句话作用）
2. jsdom 冒烟测试的**真实输出**
3. 用到的 CSS 类；若新增了 `assets/css/pages/<name>.css`，列出新增类名
4. 需要我改共享文件的地方（如果有）
5. 未完成或有疑虑的点

不要贴大段源码。
