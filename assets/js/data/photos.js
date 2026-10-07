/**
 * 自动生成，勿手改 —— 改图请跑 `node tools/fetch-images.mjs` 后
 * `node tools/gen-photo-module.mjs` 重新生成本文件。
 *
 * 图片来源：TheSportsDB（唯一实测可达的图源）。F1 官方图床 media.formula1.com
 * 直链 404/不可达，Wikimedia（commons + upload）在本机网络完全不可达，
 * jolpi/Ergast 系不带图。车手图为 500x500 透明 PNG 半身像，车队为透明 PNG 徽标。
 */

/** 本地有半身像的车手 id（= assets/img/drivers/<id>.png） */
export const DRIVER_PHOTO_IDS = new Set(["albon", "alonso", "antonelli", "arvid_lindblad", "bearman", "bortoleto", "bottas", "colapinto", "gasly", "hadjar", "hamilton", "hulkenberg", "lawson", "leclerc", "max_verstappen", "norris", "ocon", "perez", "piastri", "russell", "sainz", "stroll", "tsunoda"]);

/** 本地有徽标的车队 id（= assets/img/teams/<id>.png） */
export const TEAM_LOGO_IDS = new Set(["alpine", "aston_martin", "audi", "cadillac", "ferrari", "haas", "mclaren", "mercedes", "rb", "red_bull", "williams"]);

/** 车手半身像 URL；没有图时返回空串，调用方应回退到纯文字。 */
export function driverPhoto(driverId, base = '') {
  if (!driverId || !DRIVER_PHOTO_IDS.has(driverId)) return '';
  return `${base}assets/img/drivers/${driverId}.png`;
}

/** 车队徽标 URL；没有图时返回空串。 */
export function teamLogo(teamId, base = '') {
  if (!teamId || !TEAM_LOGO_IDS.has(teamId)) return '';
  return `${base}assets/img/teams/${teamId}.png`;
}
