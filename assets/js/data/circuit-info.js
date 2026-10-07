/**
 * 赛道规格表（真实数据，逐条带来源）。
 *
 * 为什么单独建这张表：`api.jolpi.ca/ergast/f1/2026/...` **不提供**赛道长度 / 弯数 /
 * 正赛圈数 / 圈速纪录，项目自 v2.0 起明确「不再编造这些字段」。于是这里只手写可核实的
 * 公开规格，取不到的字段一律**省略**（不写、不猜），渲染端也只显示确实存在的字段。
 *
 * 字段与来源（抓取日期 2026-10-06）：
 *   · lengthKm   赛道单圈长度（km）
 *   · laps       正赛圈数
 *   · firstHeld  该赛道**首次举办 F1 世界锦标赛分站**的年份
 *       → 三者均取自 F1.com 2026 官方赛历页 https://www.formula1.com/en/racing/2026/<slug>
 *         页面字段：Circuit Length / Number of Laps / First Grand Prix
 *   · turns      弯数
 *       → 取自 F1.com「circuit-guide」赛道指南文章，
 *         或 Wikipedia 赛道条目信息框（少数取 Wikipedia 汇总表格，已在记录里注明）
 *
 * 键 = `assets/data/season.json` 里的 circuitId（与 race.id 同值，23 站一一对应）。
 * 参考：F1.com 旧版 /en/information/ 页面数据陈旧（例如 Singapore 仍写 5.063 km / 61 圈），
 * 本表一律以 /en/racing/2026/* 为准，并用 Wikipedia / 赛道官方稿件交叉核对。
 */

/** F1.com 2026 官方赛历页（长度 · 圈数 · 首办年） */
const F1 = (slug) => `formula1.com/en/racing/2026/${slug}`;
/** Wikipedia 条目 */
const WIKI = (title) => `en.wikipedia.org/wiki/${title}`;
/** F1.com circuit-guide 赛道指南文章（长度 · 弯数 · 圈数） */
const GUIDE = 'formula1.com circuit-guide 赛道指南文章';

export const CIRCUIT_INFO = {
  albert_park: {
    lengthKm: 5.278,
    turns: 14,
    laps: 58,
    firstHeld: 1996,
    source: `${F1('australia')}（长度·圈数·首办年） + ${GUIDE}（弯数）`,
  },
  shanghai: {
    lengthKm: 5.451,
    turns: 16,
    laps: 56,
    firstHeld: 2004,
    source: `${F1('china')}（长度·圈数·首办年） + ${WIKI('Shanghai_International_Circuit')}（弯数）`,
  },
  suzuka: {
    lengthKm: 5.807,
    turns: 18,
    laps: 53,
    firstHeld: 1987,
    source: `${F1('japan')}（长度·圈数·首办年） + ${GUIDE}（弯数）`,
  },
  miami: {
    lengthKm: 5.412,
    turns: 19,
    laps: 57,
    firstHeld: 2022,
    source: `${F1('miami')}（长度·圈数·首办年） + ${WIKI('Miami_International_Autodrome')}（弯数）`,
  },
  villeneuve: {
    lengthKm: 4.361,
    turns: 14,
    laps: 70,
    firstHeld: 1978,
    source: `${F1('canada')}（长度·圈数·首办年） + ${GUIDE}（弯数）`,
  },
  monaco: {
    lengthKm: 3.337,
    turns: 19,
    laps: 78,
    firstHeld: 1950,
    source: `${F1('monaco')}（长度·圈数·首办年） + ${GUIDE}（弯数）`,
  },
  catalunya: {
    lengthKm: 4.657,
    turns: 14,
    laps: 66,
    firstHeld: 1991,
    source: `${F1('barcelona-catalunya')}（长度·圈数·首办年） + ${GUIDE}（弯数）`,
  },
  red_bull_ring: {
    lengthKm: 4.326, // F1.com 2026 值；Wikipedia 的 2016–2024 布局写作 4.318 km，以官方页为准
    turns: 10,
    laps: 71,
    firstHeld: 1970,
    source: `${F1('austria')}（长度·圈数·首办年） + ${GUIDE}（弯数）`,
  },
  silverstone: {
    lengthKm: 5.891,
    turns: 18,
    laps: 52,
    firstHeld: 1950,
    source: `${F1('great-britain')}（长度·圈数·首办年） + ${WIKI('Silverstone_Circuit')}（弯数）`,
  },
  spa: {
    lengthKm: 7.004,
    turns: 19,
    laps: 44,
    firstHeld: 1950,
    source: `${F1('belgium')}（长度·圈数·首办年） + ${WIKI('Circuit_de_Spa-Francorchamps')}（弯数）`,
  },
  hungaroring: {
    lengthKm: 4.381,
    turns: 14,
    laps: 70,
    firstHeld: 1986,
    source: `${F1('hungary')}（长度·圈数·首办年） + ${WIKI('Hungaroring')}（弯数）`,
  },
  zandvoort: {
    lengthKm: 4.259,
    turns: 14,
    laps: 72,
    firstHeld: 1952,
    source: `${F1('netherlands')}（长度·圈数·首办年） + ${WIKI('Circuit_Zandvoort')}（弯数）`,
  },
  monza: {
    lengthKm: 5.793,
    turns: 11,
    laps: 53,
    firstHeld: 1950,
    source: `${F1('italy')}（长度·圈数·首办年） + ${WIKI('Monza_Circuit')}（弯数）`,
  },
  madring: {
    lengthKm: 5.414,
    turns: 22,
    laps: 57,
    firstHeld: 2026, // 2026 首办 F1 分站
    source: `${F1('spain')}（长度·圈数·首办年） + ${GUIDE}（弯数）`,
  },
  baku: {
    lengthKm: 6.003,
    turns: 20,
    laps: 51,
    firstHeld: 2016,
    source: `${F1('azerbaijan')}（长度·圈数·首办年） + ${GUIDE}（弯数）`,
  },
  sepang: {
    lengthKm: 5.543,
    turns: 15,
    laps: 56,
    firstHeld: 1999,
    source: `${F1('bahrain')}（长度·圈数·首办年） + ${GUIDE}（弯数）`,
  },
  marina_bay: {
    lengthKm: 4.927,
    turns: 19,
    laps: 62,
    firstHeld: 2008,
    // 弯数三处一致：Wikipedia 2025 版布局 19 弯；singaporegp.sg 官方新闻稿 19 弯（其长度 4.928 km / 63 圈为 2022 年版本）
    source: `${F1('singapore')}（长度·圈数·首办年） + ${WIKI('Marina_Bay_Street_Circuit')} 与 singaporegp.sg 官方新闻稿（弯数）`,
  },
  americas: {
    lengthKm: 5.513,
    turns: 20,
    laps: 56,
    firstHeld: 2012,
    source: `${F1('united-states')}（长度·圈数·首办年） + ${WIKI('Circuit_of_the_Americas')}（弯数）`,
  },
  rodriguez: {
    lengthKm: 4.304,
    turns: 17,
    laps: 71,
    firstHeld: 1963,
    source: `${F1('mexico')}（长度·圈数·首办年） + ${WIKI('Autódromo_Hermanos_Rodríguez')}（弯数）`,
  },
  interlagos: {
    lengthKm: 4.309,
    turns: 15,
    laps: 71,
    firstHeld: 1973,
    source: `${F1('brazil')}（长度·圈数·首办年） + ${WIKI('Interlagos_Circuit')}（弯数）`,
  },
  vegas: {
    lengthKm: 6.201,
    turns: 17,
    laps: 50,
    firstHeld: 2023,
    source: `${F1('las-vegas')}（长度·圈数·首办年） + ${WIKI('List_of_Formula_One_circuits')} 表格（6.201 km / 17 弯）`,
  },
  losail: {
    lengthKm: 5.419,
    turns: 16,
    laps: 57,
    firstHeld: 2021,
    source: `${F1('qatar')}（长度·圈数·首办年） + ${WIKI('Lusail_International_Circuit')}（弯数）`,
  },
  yas_marina: {
    lengthKm: 5.281,
    turns: 16,
    laps: 58,
    firstHeld: 2009,
    source: `${F1('united-arab-emirates')}（长度·圈数·首办年） + ${WIKI('Yas_Marina_Circuit')}（弯数）`,
  },
};

/**
 * 取某条赛道的真实规格；没有收录 / 未核实的字段不会出现在返回值里。
 * @param {string} circuitId season.json 的 circuitId（与 race.id 同值）
 * @returns {{lengthKm?:number,turns?:number,laps?:number,firstHeld?:number,source?:string}|null}
 */
export function getCircuitInfo(circuitId) {
  if (!circuitId) return null;
  return CIRCUIT_INFO[circuitId] ?? null;
}
