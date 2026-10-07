'use strict';

/**
 * F1 观赛助手 —— Electron 主进程
 *
 * 职责边界（刻意保守）：
 *   - 窗口生命周期、标题栏覆盖层、明暗主题
 *   - 用户设置持久化（userData/settings.json）
 *   - 系统通知、外部链接、原生「关于」对话框
 * 数据获取与倒计时调度留在渲染层（assets/js/），使同一套代码在浏览器中也能运行。
 */

const { app, BrowserWindow, ipcMain, shell, Notification, nativeTheme, dialog, protocol, net, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const IS_DEV = process.argv.includes('--dev');
const SELFTEST = process.argv.includes('--selftest');
const SHOT_ARG = process.argv.find((a) => a === '--shot' || a.startsWith('--shot='));
const SHOT_PATH = SHOT_ARG ? (SHOT_ARG.split('=')[1] || path.join(ROOT, 'dist', 'shot.png')) : null;
/** `--shot-scroll=900`：截图前先纵向滚动，用于核对首屏以下的内容（新闻块、页脚） */
const SHOT_SCROLL_ARG = process.argv.find((a) => a.startsWith('--shot-scroll='));
const SHOT_SCROLL = SHOT_SCROLL_ARG ? Math.max(0, Number(SHOT_SCROLL_ARG.split('=')[1]) || 0) : 0;

/** `--shot-click=<选择器>`：截图前先点一下（用于切换 tab 之类需要交互才出现的画面） */
const SHOT_CLICK_ARG = process.argv.find((a) => a.startsWith('--shot-click='));
const SHOT_CLICK = SHOT_CLICK_ARG ? SHOT_CLICK_ARG.slice('--shot-click='.length) : null;

/**
 * `--page=pages/standings.html`：启动时加载哪一页（默认 index.html）。
 * 白名单校验，只允许应用自带的这几个页面，避免把窗口导航到任意路径。
 */
const PAGE_ARG = process.argv.find((a) => a.startsWith('--page='));
const ALLOWED_PAGES = new Set([
  'index.html',
  'pages/schedule.html',
  'pages/standings.html',
  'pages/results.html',
  'pages/race.html',
]);
/** 允许带查询串（如 pages/race.html?round=16），白名单只校验路径部分 */
const TARGET_PAGE = (() => {
  const raw = PAGE_ARG ? PAGE_ARG.slice('--page='.length) : '';
  const [pathPart] = raw.split('?');
  return ALLOWED_PAGES.has(pathPart) ? raw : 'index.html';
})();
/** `--selftest-out=<路径>`：把自检结果同时写入文件（打包后的 GUI 程序没有可用 stdout） */
const SELFTEST_OUT_ARG = process.argv.find((a) => a.startsWith('--selftest-out='));
const SELFTEST_OUT = SELFTEST_OUT_ARG ? path.resolve(SELFTEST_OUT_ARG.slice('--selftest-out='.length)) : null;
const BG = '#15151e';
const FG = '#f7f4f1';

/**
 * 自定义协议 app://f1hub/… 代替 file:// 加载页面。
 * 原因：file:// 是不透明源，ES Module 与 fetch 都会被 CORS 拦掉，
 * 而我们需要用 fetch 读取内置快照 assets/data/season.json。
 */
const APP_SCHEME = 'app';
const APP_HOST = 'f1hub';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
]);

/** 允许经主进程代访问的域名（渲染层因此无法把它当开放代理用） */
const ALLOWED_HOSTS = new Set([
  'api.jolpi.ca',
  'api.open-meteo.com',
  'www.formula1.com',
  'www.motorsport.com',
]);

/** 主进程侧响应缓存：url -> { at, status, body } */
const responseCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 80;

/**
 * 交给系统浏览器之前唯一的收敛点。
 * 只放行「绝对 http(s) URL」，并拒绝一切控制字符 —— `\n` / `\t` / `\0` 在 Windows
 * 上经 ShellExecute 传递时是经典的参数截断面，光测 `/^https?:\/\//` 前缀挡不住。
 * 裸相对路径（如 `calc.exe`）也会在这里被 URL 解析拒绝：它会抛 TypeError。
 */
function isSafeExternal(raw) {
  const s = String(raw ?? '');
  if (!s || s.length > 2048) return false;
  if (/[\u0000-\u001f\u007f]/.test(s)) return false;
  let parsed;
  try {
    parsed = new URL(s);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' || parsed.protocol === 'http:';
}

/**
 * 代访问的准入判据，首跳与「重定向后的最终地址」共用同一份逻辑。
 * 注意 URL.host 是含端口的（`api.jolpi.ca:8443`），所以端口天然被这条挡住。
 */
function isAllowedRemote(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw ?? ''));
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && ALLOWED_HOSTS.has(parsed.host);
}

/** 主进程代访问超时：连接半开时必须自己收尾，否则 IPC 永不 resolve、渲染层去重表永久卡住 */
const FETCH_TIMEOUT_MS = 15000;

/** 手工跟随重定向的上限 */
const MAX_REDIRECTS = 4;

/**
 * 带白名单校验的代访问。
 *
 * **不要靠 `res.url` 校验最终地址** —— 实测 Electron 38 的 `net.fetch` 返回的
 * Response 里 `url` 恒为空串（200 且 body 正常时也是空的），拿它去跑
 * `isAllowedRemote()` 会把**每一次请求**都判成 `blocked-redirect`，
 * 整个应用直接断网。改为 `redirect: 'manual'`：Chromium 不再自动跟随，
 * 我们拿到真实的 3xx（实测 `status` 与 `headers.get('location')` 都可用、
 * 不是 opaque 响应），解析 Location 并**用同一份白名单**校验下一跳，
 * 仍落在白名单内才继续，最多 MAX_REDIRECTS 跳。
 */
async function fetchRemote(raw) {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await net.fetch(current, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'manual',
      headers: {
        Accept: 'application/json, application/xml, text/xml, text/html;q=0.8, */*;q=0.5',
        'User-Agent': `f1-hub-desktop/${app.getVersion()} (Electron)`,
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return { ok: false, error: 'blocked-redirect' };
      let next;
      try {
        next = new URL(location, current).toString();
      } catch {
        return { ok: false, error: 'blocked-redirect' };
      }
      if (!isAllowedRemote(next)) return { ok: false, error: 'blocked-redirect' };
      current = next;
      continue;
    }

    return { res, body: await res.text(), finalUrl: current };
  }
  return { ok: false, error: 'too-many-redirects' };
}

/** 标题栏覆盖层高度，需与 CSS 里 .topbar-inner 的高度一致，否则会出现颜色断层 */
const TITLEBAR_H = 58;

const DEFAULT_SETTINGS = {
  // 必须与 assets/js/config.js 的 DEFAULT_SETTINGS.theme 一致（官网同款亮色），
  // 否则 readSettings() 的合并会把存储里的 light 覆盖回 system。
  theme: 'light',
  notifyEnabled: true,
  notifyLeadMinutes: 15,
  favoriteDrivers: [],
  favoriteTeams: [],
  lastViewedRound: null,
  // 必须与 assets/js/config.js 的 SETTINGS_VERSION 一致。
  // 全新安装即视为「已是最新版本」，这样用户在设置里显式选「跟随系统」后，
  // 渲染层的旧值迁移不会再把它改回亮色（迁移只针对真正缺这版标记的历史文件）。
  settingsVersion: 3,
};

let win = null;

/* ------------------------------------------------------------------ 设置持久化 */

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf8');
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    // 磁盘上存在、但**没有 settingsVersion 键**的文件 = 更早版本写出来的历史文件。
    // 不能让 DEFAULT_SETTINGS 的当前版本号顶掉「这文件没有版本标记」这件事 ——
    // 否则渲染层的判据 `Number(stored) < SETTINGS_VERSION` 永远不成立，
    // 那次「把旧默认值 'system' 迁到 'light'」的迁移对老用户永远不执行。
    // 报 0 表示「未知版本，请迁移」；而「文件根本不存在」（下面 catch 分支）
    // 才是全新安装，直接给当前版本号，免得用户之后显式选「跟随系统」又被改回亮色。
    if (!parsed || typeof parsed !== 'object' || !Object.prototype.hasOwnProperty.call(parsed, 'settingsVersion')) {
      merged.settingsVersion = 0;
    }
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(patch) {
  const merged = { ...readSettings(), ...(patch && typeof patch === 'object' ? patch : {}) };
  // 任何一次落盘都把版本标记推进到当前版本：readSettings() 可能报 0（历史文件），
  // 不能把那个 0 写回去，否则用户显式选「跟随系统」后下次启动又会被迁移改掉。
  merged.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(merged, null, 2), 'utf8');
  } catch (err) {
    console.error('[settings] 写入失败：', err.message);
  }
  return merged;
}

/* ------------------------------------------------------------------ 窗口 */

/**
 * 覆盖层配色固定为「黑底白字」。
 * 顶栏在明暗两套主题里都是 #15151e，所以这里**不能跟随系统主题** ——
 * 之前跟随 nativeTheme，亮色系统下画成白底，与黑色顶栏割裂。
 */
function overlayColors() {
  return { color: BG, symbolColor: FG };
}

function applyTitleBarOverlay() {
  if (!win || win.isDestroyed()) return;
  if (typeof win.setTitleBarOverlay !== 'function') return;
  try {
    win.setTitleBarOverlay({ ...overlayColors(), height: TITLEBAR_H });
  } catch {
    /* 平台不支持时忽略 */
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: BG,
    autoHideMenuBar: true,
    title: 'F1 观赛助手',
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...overlayColors(), height: TITLEBAR_H },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  // loadURL 失败必须接住：否则是主进程未处理拒绝，窗口会停在白屏且没有任何日志。
  win.loadURL(`${APP_ORIGIN}/${TARGET_PAGE}`).catch((err) => {
    console.error('[f1-hub] 页面加载失败：', TARGET_PAGE, err);
  });

  win.once('ready-to-show', () => {
    win.show();
    if (IS_DEV) win.webContents.openDevTools({ mode: 'detach' });
  });

  if (SELFTEST) runSelfTest(win);
  if (SHOT_PATH) runShot(win, SHOT_PATH);

  // 站外链接一律交给系统浏览器，避免把应用窗口导航走
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // 只认 app://f1hub/ 这一种「内部导航」。绝不要把 file:// 也算进来：
  // 主 preload（net:fetch / openExternal / settings）会挂到任何被导航到的文档上，
  // 一旦放行 file://，本地任意 HTML 就能在应用窗口里拿到这个桥。
  win.webContents.on('will-navigate', (event, url) => {
    const internal = url.startsWith(`${APP_ORIGIN}/`);
    if (!internal) {
      event.preventDefault();
      if (isSafeExternal(url)) shell.openExternal(url);
    }
  });

  win.on('closed', () => {
    win = null;
  });

  const pushState = () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('win:state', { maximized: win.isMaximized() });
  };
  win.on('maximize', pushState);
  win.on('unmaximize', pushState);
  win.on('enter-full-screen', pushState);
  win.on('leave-full-screen', pushState);
}

/* ------------------------------------------------------------------ 自检模式 */

/**
 * `electron . --selftest`：加载真实窗口后，在渲染进程里跑一段断言并把结果打到
 * stdout，然后退出。用于验证 jsdom 覆盖不到的部分 —— app:// 协议、preload 桥、
 * 经主进程代理的网络请求、字体加载。
 */
function runSelfTest(target) {
  // 打包后的 Windows GUI 程序没有可用的 stdout（console.log 会被直接丢弃），
  // 所以额外支持 `--selftest-out=<路径>`：把同一份结果落盘，便于对安装包做复验。
  // 用法：& "dist\win-unpacked\F1 Hub.exe" --selftest --selftest-out=dist\selftest-packaged.json
  const report = (line) => {
    console.log(line);
    if (!SELFTEST_OUT) return;
    try {
      fs.mkdirSync(path.dirname(SELFTEST_OUT), { recursive: true });
      fs.appendFileSync(SELFTEST_OUT, line + '\n', 'utf8');
    } catch (err) {
      console.log(`SELFTEST_OUT_ERROR ${err.message}`);
    }
  };

  target.webContents.on('console-message', (...args) => {
    const first = args[0];
    const level = first && typeof first === 'object' && first.level !== undefined ? first.level : args[1];
    const message = first && typeof first === 'object' && first.message !== undefined ? first.message : args[2];
    console.log(`[renderer:${level}] ${message}`);
  });

  target.webContents.on('did-fail-load', (_e, code, desc, url) => {
    report(`SELFTEST_ERROR 加载失败 ${code} ${desc} ${url}`);
    app.exit(1);
  });

  const script = `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (document.querySelector('#hero .cd-strip-title')?.textContent?.trim()) break;
      await sleep(200);
    }
    // 给天气与新闻的网络请求留时间（新闻失败时会按 8s/16s 退避补两次，这里等够）
    for (let i = 0; i < 120; i++) {
      if (document.querySelectorAll('#news-body .news-list li').length > 0) break;
      await sleep(250);
    }
    const q = (sel) => document.querySelectorAll(sel).length;
    const t = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
    return {
      protocol: location.protocol,
      origin: location.origin,
      desktopBridge: typeof window.f1 === 'object',
      bodyIsDesktop: document.body.classList.contains('is-desktop'),
      theme: document.documentElement.dataset.theme,
      themeResolved: document.documentElement.dataset.themeResolved ?? null,
      titlebarVar: getComputedStyle(document.documentElement).getPropertyValue('--titlebar-h').trim(),
      titilliumLoaded: document.fonts ? document.fonts.check('400 14px "Titillium Web"') : null,
      // 官网同款外观：黑顶栏 + 大标题 + 卡片 + 领奖台
      topbarBg: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
      displayText: t('.display'),
      subRound: t('#sub-round'),
      subDate: t('#sub-date'),
      subName: t('#sub-name'),
      clockLocal: t('#clock-local'),
      clockTrack: t('#clock-track'),
      // —— 跨页通用：--page= 可指向任意页，以下字段在五页上都有意义 ——
      navLinks: q('#topnav a'),
      activeNav: t('#topnav a.is-active'),
      raceCards: q('.race-card'),
      podiumRows: q('.podium-item'),
      avatars: q('.avatar img'),
      tableRows: q('main.page tbody tr'),
      errorStates: q('.state-error'),
      // —— 首页（三块内容）专项 ——
      countdownTitle: t('#hero .cd-strip-title'),
      countdownCells: q('#hero .cd-cell'),
      homeSectionCount: q('main.page > section'),
      statCells: q('#race-body .stat-row .stat'),
      schedRows: q('#race-body .sessions-table tbody tr'),
      newsRows: q('#news-body .news-list li'),
      newsBodyHtml: (document.querySelector('#news-body')?.innerHTML ?? '').replace(/\s+/g, ' ').trim().slice(0, 220),
      raceCaption: t('#race-caption'),
      dataSource: t('#data-source'),
      footerActions: q('.app-footer #act-test-notify') + q('.app-footer #act-about'),
      statusBar: q('.status-bar'),
      // 设置面板（顶栏「设置」按钮 + #settings-pop 内的三个控件）
      settingsTrigger: q('#act-settings'),
      settingsPanel: q('#settings-pop'),
      settingsControls:
        q('#settings-pop #set-notify') + q('#settings-pop #set-lead') + q('#settings-pop #set-theme'),
      // 旧首页结构必须彻底消失（.home-hero / .home-entry / #cards-* 全项目零节点）
      oldHomeNodes: q('.home-hero') + q('.home-entry') + q('#cards-next') + q('#cards-done') + q('#cards-upcoming'),
    };
  })()`;

  target.webContents.once('did-finish-load', async () => {
    try {
      const result = await target.webContents.executeJavaScript(script, true);
      report('SELFTEST_RESULT ' + JSON.stringify(result, null, 2));
      app.exit(0);
    } catch (err) {
      report(`SELFTEST_ERROR ${err.message}`);
      app.exit(1);
    }
  });
}

/* ------------------------------------------------------------------ 截图模式 */

/** `electron . --shot[=路径]`：等首屏渲染完，把窗口内容截成 PNG 后退出（用于视觉核对） */
function runShot(target, outPath) {
  target.webContents.once('did-finish-load', async () => {
    try {
      // 页面无关的就绪判定：外壳挂上了 + 主体出了卡片 + 没有残留的加载态。
      // （旧版判据写死首页的 .display / #hero-count-target / .news-list，
      //   在赛历/积分榜/成绩页永远等满 35 秒。）
      const wait = `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 120; i++) {
          const nav = document.querySelector('#topnav .nav-link, #topnav a');
          const body = document.querySelector('main.page .card, main.page .race-card, main.page .countdown-strip, main.page table');
          const loading = document.querySelectorAll('.state-loading').length;
          if (nav && body && loading === 0) break;
          await sleep(150);
        }
        await sleep(500);
        return true;
      })()`;
      await target.webContents.executeJavaScript(wait, true);
      if (SHOT_CLICK) {
        const clicked = await target.webContents.executeJavaScript(
          `(async () => {
            const el = document.querySelector(${JSON.stringify(SHOT_CLICK)});
            if (!el) return false;
            el.click();
            await new Promise((r) => setTimeout(r, 700));
            return true;
          })()`,
          true,
        );
        if (!clicked) console.log(`SHOT_CLICK_MISS ${SHOT_CLICK}`);
      }
      await target.webContents.executeJavaScript(wait, true);
      if (SHOT_SCROLL > 0) {
        await target.webContents.executeJavaScript(
          `(async () => { window.scrollTo(0, ${SHOT_SCROLL}); await new Promise((r) => setTimeout(r, 500)); return window.scrollY; })()`,
          true,
        );
      }
      const image = await target.webContents.capturePage();
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, image.toPNG());
      console.log(`SHOT_OK ${outPath}`);
      app.exit(0);
    } catch (err) {
      console.log(`SHOT_ERROR ${err.message}`);
      app.exit(1);
    }
  });
}

/* ------------------------------------------------------------------ 自定义协议 */
/** 把 app://f1hub/<相对路径> 映射到工程目录内的真实文件 */
function registerProtocol() {
  const rootPrefix = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;

  protocol.handle(APP_SCHEME, async (request) => {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('bad request', { status: 400 });
    }
    if (url.host !== APP_HOST) return new Response('not found', { status: 404 });

    // 注意：这里必须做目录穿越检查，否则 app://f1hub/../../ 能读到工程外的文件。
    // decodeURIComponent 必须在 try 内：畸形转义（如 app://f1hub/%zz）会抛 URIError，
    // 而 async 的 protocol.handle 里抛出去就是一条主进程未处理拒绝。
    let target;
    try {
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      target = path.normalize(path.join(ROOT, relative));
    } catch {
      return new Response('bad request', { status: 400 });
    }
    if (!target.startsWith(rootPrefix) && target !== ROOT) {
      return new Response('forbidden', { status: 403 });
    }

    // net.fetch 对不存在的文件会 reject（ERR_FILE_NOT_FOUND）。
    // 必须自己接住并返回 404 —— 否则会变成主进程的未处理拒绝，
    // 任何缺资源请求（拼错的路径、尚未落地的图片）都会往日志里丢一条 Error。
    try {
      return await net.fetch(pathToFileURL(target).toString());
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

/* ------------------------------------------------------------------ 权限 */

/**
 * 全进程拒绝一切网页权限请求（摄像头/麦克风/定位/通知/剪贴板读/MIDI/串口…）。
 * 本项目是纯展示型观赛助手，没有任何一处需要这些能力；不注册的话 Electron 会按
 * 默认策略走 —— 显式拒绝比依赖默认值更可控，也让「应用从不要权限」成为可审计的事实。
 */
function registerPermissions() {
  const target = session.defaultSession;
  target.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  target.setPermissionCheckHandler(() => false);
}

/* ------------------------------------------------------------------ IPC */

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    name: app.getName(),
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    titlebarHeight: TITLEBAR_H,
  }));

  ipcMain.handle('settings:get', () => readSettings());
  ipcMain.handle('settings:set', (_e, patch) => writeSettings(patch));

  ipcMain.handle('app:notify', (_e, payload) => {
    const settings = readSettings();
    if (!settings.notifyEnabled) return { shown: false, reason: 'disabled' };
    if (!Notification.isSupported()) return { shown: false, reason: 'unsupported' };

    const title = String(payload?.title ?? 'F1 观赛助手').slice(0, 120);
    const body = String(payload?.body ?? '').slice(0, 300);
    const notification = new Notification({
      title,
      body,
      silent: Boolean(payload?.silent),
      timeoutType: 'default',
    });
    notification.on('click', () => {
      if (!win || win.isDestroyed()) {
        createWindow();
        return;
      }
      if (win.isMinimized()) win.restore();
      win.focus();
    });
    notification.show();
    return { shown: true };
  });

  /**
   * 网络代理：渲染层不直连外网，统一走这里。
   * 好处：绕开 jolpi.ca 缺失的 CORS 头、集中缓存、域名白名单可控。
   */
  ipcMain.handle('net:fetch', async (_e, url, opts) => {
    const raw = String(url ?? '');
    if (!isAllowedRemote(raw)) {
      let reason = 'blocked-host';
      try {
        if (new URL(raw).protocol !== 'https:') reason = 'blocked-scheme';
      } catch {
        reason = 'bad-url';
      }
      return { ok: false, error: reason };
    }

    const bypass = Boolean(opts?.bypassCache);
    const hit = responseCache.get(raw);
    if (!bypass && hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return { ok: true, status: hit.status, body: hit.body, cached: true };
    }

    try {
      const result = await fetchRemote(raw);
      if (!result.res) return { ok: false, error: result.error };
      const { res, body } = result;
      if (res.ok) {
        if (responseCache.size >= CACHE_MAX_ENTRIES) {
          const oldest = [...responseCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
          if (oldest) responseCache.delete(oldest[0]);
        }
        responseCache.set(raw, { at: Date.now(), status: res.status, body });
      }
      return { ok: res.ok, status: res.status, body };
    } catch (err) {
      // 断网时退回上一次成功的缓存，实在没有才报错
      if (hit) return { ok: true, status: hit.status, body: hit.body, cached: true, stale: true };
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('app:open-external', (_e, url) => {
    const raw = String(url ?? '');
    if (!isSafeExternal(raw)) return { ok: false, reason: 'blocked-scheme' };
    shell.openExternal(raw);
    return { ok: true };
  });

  ipcMain.handle('app:set-theme', (_e, theme) => {
    const next = ['system', 'light', 'dark'].includes(theme) ? theme : 'system';
    nativeTheme.themeSource = next;
    writeSettings({ theme: next });
    applyTitleBarOverlay();
    return { theme: next, dark: nativeTheme.shouldUseDarkColors };
  });

  ipcMain.handle('app:about', () => {
    const options = {
      type: 'info',
      title: '关于 F1 观赛助手',
      message: 'F1 观赛助手',
      detail: [
        `版本 ${app.getVersion()}`,
        `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
        '',
        '赛历与成绩数据来源：jolpi.ca Ergast 镜像（免密钥）',
        '天气：Open-Meteo · 新闻：Formula 1 官网 RSS',
        '车手半身像与车队徽标：TheSportsDB（仅本地展示用）',
        '正文字体：Titillium Web（SIL Open Font License 1.1）',
        '中文字体：阿里巴巴普惠体（免费商用授权）',
        '本项目为非官方粉丝作品，与 Formula 1 无隶属关系。',
      ].join('\n'),
      buttons: ['知道了'],
      noLink: true,
    };
    if (win && !win.isDestroyed()) dialog.showMessageBox(win, options);
    else dialog.showMessageBox(options);
    return { ok: true };
  });

  ipcMain.on('win:minimize', () => win?.minimize());
  ipcMain.on('win:toggle-maximize', () => {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('win:close', () => win?.close());
}

/* ------------------------------------------------------------------ 生命周期 */

app.setAppUserModelId('com.f1hub.desktop');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) {
      createWindow();
      return;
    }
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    const settings = readSettings();
    nativeTheme.themeSource = ['system', 'light', 'dark'].includes(settings.theme) ? settings.theme : 'system';

    registerProtocol();
    registerPermissions();
    registerIpc();
    createWindow();

    nativeTheme.on('updated', () => {
      applyTitleBarOverlay();
      if (win && !win.isDestroyed()) {
        win.webContents.send('app:theme-changed', { dark: nativeTheme.shouldUseDarkColors });
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
