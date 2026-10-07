'use strict';

/**
 * 预加载脚本：把主进程能力收敛成一个小而明确的 window.f1 接口。
 * 渲染层通过 assets/js/platform.js 访问，浏览器环境下有等价降级实现，
 * 因此页面代码不直接依赖 Electron。
 */

const { contextBridge, ipcRenderer } = require('electron');

const handlers = { theme: [], state: [] };

ipcRenderer.on('app:theme-changed', (_event, payload) => {
  handlers.theme.forEach((fn) => fn(payload));
});
ipcRenderer.on('win:state', (_event, payload) => {
  handlers.state.forEach((fn) => fn(payload));
});

function subscribe(key, fn) {
  if (typeof fn !== 'function') return () => {};
  handlers[key].push(fn);
  return () => {
    const i = handlers[key].indexOf(fn);
    if (i >= 0) handlers[key].splice(i, 1);
  };
}

contextBridge.exposeInMainWorld('f1', {
  isDesktop: true,
  platform: process.platform,

  getInfo: () => ipcRenderer.invoke('app:info'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  notify: (payload) => ipcRenderer.invoke('app:notify', payload),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  setTheme: (theme) => ipcRenderer.invoke('app:set-theme', theme),
  showAbout: () => ipcRenderer.invoke('app:about'),

  /**
   * 网络经主进程代理（绕开 CORS + 统一缓存 + 域名白名单）。
   * opts.bypassCache 用于「刷新数据」：主进程那层缓存有 5 分钟 TTL，
   * 不带这个标记的话，用户点刷新拿回来的还是同一份 body。
   */
  fetch: (url, opts) => ipcRenderer.invoke('net:fetch', url, { bypassCache: Boolean(opts?.bypassCache) }),

  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
  close: () => ipcRenderer.send('win:close'),

  onThemeChange: (fn) => subscribe('theme', fn),
  onWindowState: (fn) => subscribe('state', fn),
});
