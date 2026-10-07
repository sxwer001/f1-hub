/**
 * 天气：按赛道经纬度取 Open-Meteo 真实预报，并对齐到每个会话时刻。
 * 会话时间是 UTC，接口返回的是赛道当地时间的字符串 + utc_offset_seconds，
 * 因此这里用偏移量把二者对齐，避免时区错位。
 */

import { CACHE_TTL, ENDPOINTS } from '../config.js';
import { getJson } from '../net.js';

const WEATHER_CODE_ZH = {
  0: '晴', 1: '大致晴朗', 2: '局部多云', 3: '阴',
  45: '有雾', 48: '雾凇',
  51: '小毛毛雨', 53: '毛毛雨', 55: '强毛毛雨',
  56: '冻毛毛雨', 57: '强冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '阵雨', 81: '中阵雨', 82: '强阵雨',
  85: '阵雪', 86: '强阵雪',
  95: '雷雨', 96: '雷雨伴冰雹', 99: '强雷雨伴冰雹',
};

export function weatherText(code) {
  return WEATHER_CODE_ZH[code] ?? '未知';
}

function localHourKey(utcMs, offsetSeconds) {
  return new Date(utcMs + offsetSeconds * 1000).toISOString().slice(0, 13);
}

/**
 * 拉取赛道所在位置的预报。
 * @param {{lat:number,long:number}} race
 * @returns {Promise<null|{timezone:string, offsetSeconds:number, hourly:Map<string,object>, daily:object[]}>}
 */
export async function getRaceForecast(race) {
  if (!Number.isFinite(race?.lat) || !Number.isFinite(race?.long)) return null;

  const url = new URL(ENDPOINTS.weather);
  url.searchParams.set('latitude', String(race.lat));
  url.searchParams.set('longitude', String(race.long));
  url.searchParams.set('hourly', 'temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m');
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '16');

  const data = await getJson(url.href, { ttl: CACHE_TTL.weather });
  const hourly = new Map();
  const times = data?.hourly?.time || [];
  for (let i = 0; i < times.length; i++) {
    hourly.set(times[i], {
      temp: data.hourly.temperature_2m?.[i],
      feelsLike: data.hourly.apparent_temperature?.[i],
      rainChance: data.hourly.precipitation_probability?.[i],
      code: data.hourly.weather_code?.[i],
      wind: data.hourly.wind_speed_10m?.[i],
    });
  }

  const daily = (data?.daily?.time || []).map((day, i) => ({
    day,
    code: data.daily.weather_code?.[i],
    max: data.daily.temperature_2m_max?.[i],
    min: data.daily.temperature_2m_min?.[i],
    rainChance: data.daily.precipitation_probability_max?.[i],
  }));

  return {
    timezone: data?.timezone || '',
    offsetSeconds: Number(data?.utc_offset_seconds ?? 0),
    hourly,
    daily,
  };
}

/** 把某个会话对齐到最近一小时的预报 */
export function forecastForSession(forecast, session) {
  if (!forecast || !session?.ts) return null;
  const key = localHourKey(session.ts, forecast.offsetSeconds);
  const exact = forecast.hourly.get(`${key}:00`);
  if (exact) return exact;
  // 会话不一定整点，退到当天最近的一格
  const prefix = key.slice(0, 10);
  for (const [time, value] of forecast.hourly) {
    if (time.startsWith(prefix)) return value;
  }
  return null;
}

/** 正赛当天的日概览 */
export function forecastForRaceDay(forecast, race) {
  if (!forecast || !race?.raceUtc) return null;
  const day = localHourKey(Date.parse(race.raceUtc), forecast.offsetSeconds).slice(0, 10);
  return forecast.daily.find((d) => d.day === day) || null;
}
