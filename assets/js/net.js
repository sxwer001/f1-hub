/**
 * 网络层。
 * 桌面端：所有 https 请求经主进程 IPC 代理（jolpi.ca 没有 CORS 头，渲染层直连会被拦），
 *         主进程带域名白名单与 5 分钟响应缓存。
 * 浏览器端：直接 fetch，便于自动化自检。
 * 内置快照 assets/data/season.json 走本地 fetch，不经过代理。
 */

import { CACHE_TTL, SNAPSHOT_URL } from './config.js';
import { isDesktop } from './platform.js';

const bridge = typeof window !== 'undefined' ? window.f1 : undefined;

/** 文本缓存：url -> { at, text } */
const textCache = new Map();
/** 进行中的请求，避免同一 url 并发重复拉取 */
const inflight = new Map();

function viaBridge(url, bypassCache = false) {
  if (!bridge?.fetch) return Promise.reject(new Error('desktop bridge unavailable'));
  return bridge.fetch(url, { bypassCache }).then((res) => {
    if (!res || !res.ok) throw new Error(res?.error || `HTTP ${res?.status ?? '?'}`);
    return res.body;
  });
}

async function viaFetch(url, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 拉一次文本，失败重试一次。
 * 实测 api.jolpi.ca 会偶发「Connect Timeout」（Cloudflare 连接超时），
 * 重试一次能显著降低误判为「离线」的概率。
 */
async function fetchTextOnce(url, bypassCache = false) {
  const via = isDesktop && bridge?.fetch
    ? () => viaBridge(url, bypassCache)
    : () => viaFetch(url);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await via();
    } catch (err) {
      lastError = err;
      if (attempt === 0) await sleep(700);
    }
  }
  throw lastError;
}

/**
 * 取文本，带 TTL 缓存与并发去重；失败时若有旧缓存则退回旧缓存。
 * @returns {Promise<string>}
 */
export async function getText(url, { ttl = CACHE_TTL.season, force = false } = {}) {
  const key = String(url);
  const hit = textCache.get(key);
  if (!force && hit && Date.now() - hit.at < ttl) return hit.text;
  if (inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    try {
      // force 必须一路透到主进程：它那层还有一份 5 分钟 TTL 的响应缓存，
      // 只清渲染层缓存的话，「刷新数据」拿回来的还是同一份 body。
      const text = await fetchTextOnce(key, force);
      textCache.set(key, { at: Date.now(), text });
      return text;
    } catch (err) {
      if (hit) {
        console.warn(`[net] ${key} 拉取失败，使用缓存：${err.message}`);
        return hit.text;
      }
      throw err;
    } finally {
      // 只在条目还是自己时才删：clearCache() 会清空 inflight，
      // 无条件 delete 会把「清缓存之后新建的同名请求」误删，去重随之失效。
      if (inflight.get(key) === task) inflight.delete(key);
    }
  })();

  inflight.set(key, task);
  return task;
}

/** 取 JSON；解析失败会抛出，调用方负责兜底 */
export async function getJson(url, options) {
  const text = await getText(url, options);
  return JSON.parse(text);
}

/** 内置快照（离线回退数据，同时充当中文名对照表） */
let snapshotCache = null;

export async function loadSnapshot() {
  if (snapshotCache) return snapshotCache;
  const res = await fetch(SNAPSHOT_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`快照读取失败 HTTP ${res.status}`);
  snapshotCache = await res.json();
  return snapshotCache;
}

/** 清掉所有缓存（设置里「刷新数据」时使用） */
export function clearCache() {
  textCache.clear();
  inflight.clear();
  snapshotCache = null;
}
