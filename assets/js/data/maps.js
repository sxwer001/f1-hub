/**
 * 中英映射表与车队识别色。
 * 采集器（tools/fetch-data.mjs）与渲染层共用这一份，避免两边漂移。
 */

export const RACE_ZH = {
  'Australian Grand Prix': '澳大利亚大奖赛',
  'Chinese Grand Prix': '中国大奖赛',
  'Japanese Grand Prix': '日本大奖赛',
  'Miami Grand Prix': '迈阿密大奖赛',
  'Canadian Grand Prix': '加拿大大奖赛',
  'Monaco Grand Prix': '摩纳哥大奖赛',
  'Barcelona Grand Prix': '巴塞罗那大奖赛',
  'Austrian Grand Prix': '奥地利大奖赛',
  'British Grand Prix': '英国大奖赛',
  'Belgian Grand Prix': '比利时大奖赛',
  'Hungarian Grand Prix': '匈牙利大奖赛',
  'Dutch Grand Prix': '荷兰大奖赛',
  'Italian Grand Prix': '意大利大奖赛',
  'Spanish Grand Prix': '西班牙大奖赛',
  'Azerbaijan Grand Prix': '阿塞拜疆大奖赛',
  'Bahrain Grand Prix in Malaysia': '马来西亚大奖赛',
  'Singapore Grand Prix': '新加坡大奖赛',
  'United States Grand Prix': '美国大奖赛',
  'Mexico City Grand Prix': '墨西哥城大奖赛',
  'Brazilian Grand Prix': '巴西大奖赛',
  'Las Vegas Grand Prix': '拉斯维加斯大奖赛',
  'Qatar Grand Prix': '卡塔尔大奖赛',
  'Abu Dhabi Grand Prix': '阿布扎比大奖赛',
  'São Paulo Grand Prix': '圣保罗大奖赛',
  'Sao Paulo Grand Prix': '圣保罗大奖赛',
  'Emilia Romagna Grand Prix': '艾米利亚-罗马涅大奖赛',
  'Saudi Arabian Grand Prix': '沙特阿拉伯大奖赛',
};

export const CIRCUIT_ZH = {
  albert_park: '阿尔伯特公园赛道',
  shanghai: '上海国际赛车场',
  suzuka: '铃鹿赛道',
  miami: '迈阿密国际赛道',
  villeneuve: '吉勒·维伦纽夫赛道',
  monaco: '摩纳哥赛道',
  catalunya: '加泰罗尼亚赛道',
  red_bull_ring: '红牛环',
  silverstone: '银石赛道',
  spa: '斯帕-弗朗科尔尚赛道',
  hungaroring: '匈牙利赛道',
  zandvoort: '赞德福特赛道',
  monza: '蒙扎赛道',
  madring: '马德里赛道',
  baku: '巴库城市赛道',
  sepang: '雪邦国际赛道',
  marina_bay: '滨海湾街道赛道',
  americas: '美洲赛道',
  rodriguez: '罗德里格斯兄弟赛道',
  interlagos: '因特拉戈斯赛道',
  vegas: '拉斯维加斯街道赛道',
  losail: '卢赛尔国际赛道',
  yas_marina: '亚斯码头赛道',
  imola: '恩佐与迪诺·法拉利赛道',
  jeddah: '吉达滨海赛道',
};

export const COUNTRY_ZH = {
  Australia: '澳大利亚', China: '中国', Japan: '日本', USA: '美国', 'United States': '美国',
  Canada: '加拿大', Monaco: '摩纳哥', Spain: '西班牙', Austria: '奥地利', UK: '英国',
  'United Kingdom': '英国', Belgium: '比利时', Hungary: '匈牙利', Netherlands: '荷兰',
  Italy: '意大利', Azerbaijan: '阿塞拜疆', Malaysia: '马来西亚', Singapore: '新加坡',
  Mexico: '墨西哥', Brazil: '巴西', Qatar: '卡塔尔', UAE: '阿联酋',
  'United Arab Emirates': '阿联酋', 'Saudi Arabia': '沙特阿拉伯',
};

export const LOCALITY_ZH = {
  Melbourne: '墨尔本', Shanghai: '上海', Suzuka: '铃鹿', Miami: '迈阿密', Montreal: '蒙特利尔',
  'Monte Carlo': '蒙特卡洛', Barcelona: '巴塞罗那', Spielberg: '施皮尔贝格',
  Silverstone: '银石', Spa: '斯帕', Budapest: '布达佩斯', Zandvoort: '赞德福特',
  Monza: '蒙扎', Madrid: '马德里', Baku: '巴库', 'Kuala Lumpur': '吉隆坡',
  'Marina Bay': '滨海湾', Austin: '奥斯汀', 'Mexico City': '墨西哥城', 'São Paulo': '圣保罗',
  'Sao Paulo': '圣保罗', 'Las Vegas': '拉斯维加斯', Lusail: '卢赛尔', 'Abu Dhabi': '阿布扎比',
  Imola: '伊莫拉', Jeddah: '吉达',
};

export const NATIONALITY_ZH = {
  Italian: '意大利', British: '英国', Monegasque: '摩纳哥', Dutch: '荷兰', Australian: '澳大利亚',
  French: '法国', 'New Zealander': '新西兰', Argentine: '阿根廷', Brazilian: '巴西', German: '德国',
  Spanish: '西班牙', Thai: '泰国', Japanese: '日本', Canadian: '加拿大', Finnish: '芬兰',
  Mexican: '墨西哥', American: '美国', Austrian: '奥地利', Swiss: '瑞士', Danish: '丹麦',
  Swedish: '瑞典', Belgian: '比利时', 'South African': '南非',
};

/**
 * 车手中文名。键必须是 Ergast 的 driverId ——
 * 注意 2026 赛季的实际 id 是 max_verstappen / arvid_lindblad，
 * 与直觉上的姓氏不同，写错会静默回退成英文姓。
 */
export const DRIVER_ZH = {
  antonelli: '安东内利', russell: '拉塞尔', hamilton: '汉密尔顿', leclerc: '勒克莱尔',
  norris: '诺里斯', max_verstappen: '维斯塔潘', verstappen: '维斯塔潘',
  piastri: '皮亚斯特里', hadjar: '哈贾尔',
  lawson: '劳森', gasly: '加斯利', arvid_lindblad: '林德布拉德', lindblad: '林德布拉德',
  colapinto: '科拉平托',
  bearman: '贝尔曼', bortoleto: '博尔托莱托', hulkenberg: '霍肯伯格', ocon: '奥康',
  alonso: '阿隆索', sainz: '塞恩斯', albon: '阿尔本', tsunoda: '角田裕毅',
  stroll: '斯托尔', bottas: '博塔斯', perez: '佩雷斯', doohan: '杜汉',
};

export const TEAM_ZH = {
  Mercedes: '梅赛德斯', Ferrari: '法拉利', McLaren: '迈凯伦', 'Red Bull': '红牛',
  'RB F1 Team': '红牛二队', 'Alpine F1 Team': 'Alpine', 'Haas F1 Team': '哈斯',
  Audi: '奥迪', Williams: '威廉姆斯', 'Aston Martin': '阿斯顿·马丁',
  'Cadillac F1 Team': '凯迪拉克', Alpine: 'Alpine', Haas: '哈斯', Sauber: '索伯',
  'Racing Bulls': '红牛二队', RB: '红牛二队',
};

/** 2026 车队识别色 */
export const TEAM_COLOR = {
  Mercedes: '#27f4d2',
  Ferrari: '#e8002d',
  McLaren: '#ff8000',
  'Red Bull': '#3671c6',
  'RB F1 Team': '#6692ff',
  'Alpine F1 Team': '#ff87bc',
  'Haas F1 Team': '#b6babd',
  Audi: '#52e252',
  Williams: '#1868db',
  'Aston Martin': '#229971',
  'Cadillac F1 Team': '#d4af37',
};

export const TEAM_COLOR_FALLBACK = '#8b8b93';

/**
 * 赛道所在时区（IANA）。用于「TRACK TIME」赛道当地时间与卡片日期区间 ——
 * 官网按赛道当地日期显示，若用用户本机时区会导致错日。
 * 本地表比依赖网络接口更可靠，因此天气取到的 utc_offset_seconds 只作旁证。
 */
export const CIRCUIT_TZ = {
  albert_park: 'Australia/Melbourne',
  shanghai: 'Asia/Shanghai',
  suzuka: 'Asia/Tokyo',
  miami: 'America/New_York',
  villeneuve: 'America/Toronto',
  monaco: 'Europe/Monaco',
  catalunya: 'Europe/Madrid',
  red_bull_ring: 'Europe/Vienna',
  silverstone: 'Europe/London',
  spa: 'Europe/Brussels',
  hungaroring: 'Europe/Budapest',
  zandvoort: 'Europe/Amsterdam',
  monza: 'Europe/Rome',
  madring: 'Europe/Madrid',
  baku: 'Asia/Baku',
  sepang: 'Asia/Kuala_Lumpur',
  marina_bay: 'Asia/Singapore',
  americas: 'America/Chicago',
  rodriguez: 'America/Mexico_City',
  interlagos: 'America/Sao_Paulo',
  vegas: 'America/Los_Angeles',
  losail: 'Asia/Qatar',
  yas_marina: 'Asia/Dubai',
  imola: 'Europe/Rome',
  jeddah: 'Asia/Riyadh',
};

export const circuitTimeZone = (circuitId) => CIRCUIT_TZ[circuitId] || 'UTC';

export const SESSION_LABEL = {
  fp1: ['第一节练习', 'Practice 1', 'FP1'],
  fp2: ['第二节练习', 'Practice 2', 'FP2'],
  fp3: ['第三节练习', 'Practice 3', 'FP3'],
  sprintQualifying: ['冲刺排位赛', 'Sprint Qualifying', 'SQ'],
  sprint: ['冲刺赛', 'Sprint', 'SPR'],
  qualifying: ['排位赛', 'Qualifying', 'Q'],
  race: ['正赛', 'Race', 'RACE'],
};

export const FLAG_EMOJI = {
  Australia: '🇦🇺', China: '🇨🇳', Japan: '🇯🇵', USA: '🇺🇸', 'United States': '🇺🇸',
  Canada: '🇨🇦', Monaco: '🇲🇨', Spain: '🇪🇸', Austria: '🇦🇹', UK: '🇬🇧',
  'United Kingdom': '🇬🇧', Belgium: '🇧🇪', Hungary: '🇭🇺', Netherlands: '🇳🇱',
  Italy: '🇮🇹', Azerbaijan: '🇦🇿', Malaysia: '🇲🇾', Singapore: '🇸🇬',
  Mexico: '🇲🇽', Brazil: '🇧🇷', Qatar: '🇶🇦', UAE: '🇦🇪',
  'United Arab Emirates': '🇦🇪', 'Saudi Arabia': '🇸🇦',
};

/* ------------------------------------------------------------- 查询助手 */

export function pick(map, key, fallback) {
  if (key && map[key]) return map[key];
  return fallback ?? key ?? '';
}

export const raceNameZh = (name, fallback) => pick(RACE_ZH, name, fallback);
export const circuitZh = (circuitId, fallback) => pick(CIRCUIT_ZH, circuitId, fallback);
export const countryZh = (country, fallback) => pick(COUNTRY_ZH, country, fallback);
export const localityZh = (locality, fallback) => pick(LOCALITY_ZH, locality, fallback);
export const nationalityZh = (nat, fallback) => pick(NATIONALITY_ZH, nat, fallback);
export const driverZh = (driverId, fallback) => pick(DRIVER_ZH, driverId, fallback);
export const teamZh = (team, fallback) => pick(TEAM_ZH, team, fallback);
export const teamColor = (team) => TEAM_COLOR[team] || TEAM_COLOR_FALLBACK;
export const flagEmoji = (country) => FLAG_EMOJI[country] || '🏁';

export function sessionLabel(key) {
  const entry = SESSION_LABEL[key];
  return entry ? entry[0] : key;
}

export function sessionLabelEn(key) {
  const entry = SESSION_LABEL[key];
  return entry ? entry[1] : key;
}

export function sessionShort(key) {
  const entry = SESSION_LABEL[key];
  return entry ? entry[2] : key.toUpperCase();
}
