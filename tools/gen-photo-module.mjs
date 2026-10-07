/**
 * 由 assets/data/images.json 生成 assets/js/data/photos.js。
 * 渲染层是零构建原生 ESM，不能直接 import JSON（要么 fetch 异步、要么 import assertion
 * 在 Chromium 版本间有兼容风险），所以这里把「有哪些图」编译成一个同步模块。
 * 用法：node tools/gen-photo-module.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';

const man = JSON.parse(await readFile('assets/data/images.json', 'utf8'));

const drivers = Object.keys(man.drivers).sort();
const teams = Object.keys(man.teams).sort();

const out = `/**
 * 自动生成，勿手改 —— 改图请跑 \`node tools/fetch-images.mjs\` 后
 * \`node tools/gen-photo-module.mjs\` 重新生成本文件。
 *
 * 图片来源：TheSportsDB（唯一实测可达的图源）。F1 官方图床 media.formula1.com
 * 直链 404/不可达，Wikimedia（commons + upload）在本机网络完全不可达，
 * jolpi/Ergast 系不带图。车手图为 500x500 透明 PNG 半身像，车队为透明 PNG 徽标。
 */

/** 本地有半身像的车手 id（= assets/img/drivers/<id>.png） */
export const DRIVER_PHOTO_IDS = new Set(${JSON.stringify(drivers, null, 0).replace(/","/g, '", "')});

/** 本地有徽标的车队 id（= assets/img/teams/<id>.png） */
export const TEAM_LOGO_IDS = new Set(${JSON.stringify(teams, null, 0).replace(/","/g, '", "')});

/** 车手半身像 URL；没有图时返回空串，调用方应回退到纯文字。 */
export function driverPhoto(driverId, base = '') {
  if (!driverId || !DRIVER_PHOTO_IDS.has(driverId)) return '';
  return \`\${base}assets/img/drivers/\${driverId}.png\`;
}

/** 车队徽标 URL；没有图时返回空串。 */
export function teamLogo(teamId, base = '') {
  if (!teamId || !TEAM_LOGO_IDS.has(teamId)) return '';
  return \`\${base}assets/img/teams/\${teamId}.png\`;
}
`;

await writeFile('assets/js/data/photos.js', out);
console.log(`已生成 assets/js/data/photos.js`);
console.log(`  车手 ${drivers.length}：${drivers.join(', ')}`);
console.log(`  车队 ${teams.length}：${teams.join(', ')}`);
