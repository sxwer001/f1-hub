/**
 * 通用工具：转义、URL 白名单、DOM 查询、时间与倒计时格式化。
 * 全站渲染一律经过这里，避免此前「HTML 拼接零转义」的问题。
 */

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  // 反引号不是 HTML 特殊字符，但模板字符串里有人拿它拼属性时会变成注入面，
  // 顺手一起转掉：成本为零，省得将来有人改用反引号包属性。
  '`': '&#96;',
};

/** 转义为可安全插入 HTML 文本/属性的字符串 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"'`]/g, (ch) => ESCAPE_MAP[ch]);
}

/**
 * URL 白名单：只放行 http/https/mailto 与站内相对地址、锚点。
 * 其余（javascript:、data:、vbscript: 等）一律降级为 '#'。
 *
 * 站内相对地址必须支持**子目录**（`pages/schedule.html`、`assets/img/a.png`）：
 * 早期实现只放行 `^\.{0,2}\/` 与裸 `x.html`，会把 `pages/schedule.html`
 * 误判为非法而返回 '#'，站内链接会静默失效。
 */
export function safeUrl(raw) {
  if (raw === null || raw === undefined) return '#';
  const value = String(raw).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!value) return '#';

  if (value.startsWith('#')) return escapeHtml(value);
  if (/^https?:\/\//i.test(value)) return escapeHtml(value);
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(value)) return escapeHtml(value);

  // 任何带协议头的（javascript:、data:、vbscript:…）与协议相对地址（//host）一律拒绝
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return '#';
  if (value.startsWith('//')) return '#';

  // 其余视为站内相对路径，但必须「看起来像应用内资源」：
  // 带路径分隔符、或已知静态资源扩展名。裸文件名（`calc.exe`）在这里被拦掉 ——
  // 桌面端 shell.openExternal 对相对路径是按主进程 CWD 解析的，
  // 放行等于「打开安装目录里的可执行文件」，光靠协议前缀判据挡不住。
  if (!/^[\w.\-/]+(?:[?#][^\s]*)?$/.test(value)) return '#';
  const looksInternal =
    value.includes('/') ||
    /\.(?:html?|png|jpe?g|webp|svg|gif|ico|json|css|js|xml|woff2?)(?:[?#]|$)/i.test(value);
  return looksInternal ? escapeHtml(value) : '#';
}

/**
 * 净化颜色值：只接受 #rgb / #rrggbb / #rrggbbaa。
 * 颜色会被写进内联 style，而 escapeHtml 挡不住 `;`（CSS 里合法的声明分隔符），
 * 因此这里必须做严格白名单，而不是转义。
 */
export function safeColor(value, fallback = '#8b8b93') {
  const raw = String(value ?? '').trim();
  return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?$/i.test(raw) ? raw : fallback;
}

export function byId(id, root = document) {
  return root.getElementById ? root.getElementById(id) : root.querySelector(`#${id}`);
}

/** 设置元素 HTML；元素不存在时静默跳过（模板里可选的挂载点很多） */
export function setHTML(el, html) {
  if (el) el.innerHTML = html;
}

export function setText(el, text) {
  if (el) el.textContent = text;
}

export function cls(...parts) {
  return parts.filter(Boolean).join(' ');
}

export function toInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function pad2(n) {
  return String(Math.abs(toInt(n, 0))).padStart(2, '0');
}

/* ------------------------------------------------------------------ 时间 */

export const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function toDate(iso) {
  if (iso instanceof Date) return Number.isNaN(iso.getTime()) ? null : iso;
  if (typeof iso === 'number') return new Date(iso);
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** M月D日 */
export function fmtDate(iso) {
  const d = toDate(iso);
  if (!d) return '时间待定';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** HH:mm（本机时区） */
export function fmtTime(iso) {
  const d = toDate(iso);
  if (!d) return '--:--';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** M月D日 HH:mm（本机时区） */
export function fmtDateTime(iso) {
  const d = toDate(iso);
  if (!d) return '时间待定';
  return `${fmtDate(d)} ${fmtTime(d)}`;
}

/** 周五 10月9日 */
export function fmtDayLabel(iso) {
  const d = toDate(iso);
  if (!d) return '时间待定';
  return `${WEEKDAY_ZH[d.getDay()]} ${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 取本机时区缩写，例如 GMT+8 */
export function tzLabel(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('zh-CN', { timeZoneName: 'shortOffset' }).formatToParts(date);
    const tz = parts.find((p) => p.type === 'timeZoneName');
    return tz ? tz.value.replace('GMT', 'UTC') : '';
  } catch {
    const offset = -date.getTimezoneOffset() / 60;
    const sign = offset >= 0 ? '+' : '-';
    return `UTC${sign}${Math.abs(offset)}`;
  }
}

export function relativeTime(iso, now = Date.now()) {
  const d = toDate(iso);
  if (!d) return '时间未知';
  const diff = now - d.getTime();
  if (diff < -60_000) return '即将开始';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return fmtDate(d);
}

/** 把毫秒差拆成倒计时各段 */
export function countdownParts(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    total,
  };
}

/** 距开赛的自然语言描述，例如「2 天 5 小时后」 */
export function humanizeDuration(ms) {
  const { days, hours, minutes } = countdownParts(ms);
  if (days > 0) return `${days} 天 ${hours} 小时后`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟后`;
  if (minutes > 0) return `${minutes} 分钟后`;
  return '不到 1 分钟';
}

/**
 * 车手姓氏。快照里的名次数据只有全名，积分榜数据带 family，因此两者都兼容。
 * 专有名词统一用英文（与官网一致），所以这里不再走中文映射。
 */
export function surnameOf(entry) {
  return entry?.family || String(entry?.name || '').split(' ').pop() || '—';
}

/**
 * 从国旗 emoji 取出两位国家代码（区域指示符 U+1F1E6..U+1F1FF → A..Z）。
 *
 * 为什么不用 emoji 本身：Windows 不含彩色旗帜字体，🇸🇬 会退化成「SG」两个字母，
 * 看起来像渲染失败。这里干脆把它做成有意的代码徽标，跨平台一致。
 */
export function flagCode(flagEmoji) {
  const text = String(flagEmoji ?? '');
  const letters = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) letters.push(String.fromCharCode(cp - 0x1f1e6 + 65));
  }
  return letters.length === 2 ? letters.join('') : '';
}

/* ------------------------------------------------------------ 指定时区格式化 */

/** 某时刻在指定时区的 HH:mm（用于「TRACK TIME」赛道当地时间） */
export function zoneTime(date, timeZone) {
  const d = toDate(date);
  if (!d || !timeZone) return '--:--';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return fmtTime(d);
  }
}

/** 某时刻在指定时区的 { day, month, year }，month 为大写英文缩写 */
export function zoneDateParts(iso, timeZone) {
  const d = toDate(iso);
  if (!d) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).formatToParts(d);
    const bag = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return { day: bag.day, month: String(bag.month || '').toUpperCase(), year: bag.year };
  } catch {
    return { day: pad2(d.getDate()), month: MONTH_EN[d.getMonth()], year: String(d.getFullYear()) };
  }
}

export const MONTH_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * 赛历卡片的日期区间，形如 `09 – 11 OCT`（跨月则为 `30 OCT – 01 NOV`）。
 * 按赛道当地日期计算 —— 与官网一致，避免用户时区导致的错日。
 */
export function fmtDateRange(startIso, endIso, timeZone) {
  const a = zoneDateParts(startIso, timeZone);
  const b = zoneDateParts(endIso, timeZone);
  if (!a || !b) return '日期待定';
  if (a.month === b.month) return `${a.day} – ${b.day} ${b.month}`;
  return `${a.day} ${a.month} – ${b.day} ${b.month}`;
}

/** 赛道当地日期 + 时间，例如 `11 OCT 20:00` */
export function fmtZoneDateTime(iso, timeZone) {
  const p = zoneDateParts(iso, timeZone);
  if (!p) return '时间待定';
  return `${p.day} ${p.month} ${zoneTime(iso, timeZone)}`;
}
