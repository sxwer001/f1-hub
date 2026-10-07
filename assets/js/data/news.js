/**
 * 新闻：Formula 1 官方 RSS。
 * 优先用 DOMParser 解析（浏览器 / jsdom 都有），没有时退回正则解析。
 */

import { CACHE_TTL, ENDPOINTS } from '../config.js';
import { getText } from '../net.js';

function textOf(node, tag) {
  const el = node.querySelector?.(tag);
  return el?.textContent?.trim() || '';
}

function parseWithDom(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('RSS 解析失败');
  return Array.from(doc.querySelectorAll('item')).map((item) => ({
    title: textOf(item, 'title'),
    link: textOf(item, 'link'),
    summary: textOf(item, 'description'),
    author: textOf(item, 'dc\\:creator') || textOf(item, 'creator'),
    publishedAt: textOf(item, 'pubDate') || null,
  }));
}

function parseWithRegex(xml) {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const pick = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    if (!m) return '';
    return m[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .trim();
  };
  return items.map((block) => ({
    title: pick(block, 'title'),
    link: pick(block, 'link'),
    summary: pick(block, 'description'),
    author: pick(block, 'dc:creator'),
    publishedAt: pick(block, 'pubDate') || null,
  }));
}

/**
 * @param {number} limit
 * @returns {Promise<{title:string, link:string, summary:string, author:string, publishedAt:string|null}[]>}
 */
export async function getNews(limit = 8) {
  const xml = await getText(ENDPOINTS.news, { ttl: CACHE_TTL.news });
  const hasDom = typeof DOMParser !== 'undefined';
  let items;
  try {
    items = hasDom ? parseWithDom(xml) : parseWithRegex(xml);
  } catch {
    items = parseWithRegex(xml);
  }
  return items
    .filter((n) => n.title && n.link)
    .slice(0, limit);
}
