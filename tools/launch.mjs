#!/usr/bin/env node
/**
 * Electron 启动器：清掉 ELECTRON_RUN_AS_NODE 后再拉起应用。
 *
 * 背景：本机（DSH 自身是 Electron 应用）全局设置了 ELECTRON_RUN_AS_NODE=1，
 * 直接 `electron .` 会让 electron.exe 退化成纯 Node 进程 —— 只打印版本号而不开窗口。
 * 用子进程显式删除该变量，可同时兼容 Windows 与 macOS/Linux，不依赖 PowerShell。
 *
 * 用法：node tools/launch.mjs [--dev] [--selftest]
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe = join(
  ROOT,
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
);

if (!existsSync(exe)) {
  console.error(`未找到 Electron 二进制：${exe}`);
  console.error('请先执行：pnpm install && pwsh -File tools/setup-electron.ps1');
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(exe, [ROOT, ...process.argv.slice(2)], { stdio: 'inherit', env, windowsHide: false });
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('启动失败：', err.message);
  process.exit(1);
});
