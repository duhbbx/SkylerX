#!/usr/bin/env node
/**
 * IndexNow 提交脚本
 *
 * 一次性把 sitemap 里所有 URL 推送到 IndexNow 协议端点,
 * 由 indexnow.org 转发到 Bing / Yandex / Naver / Seznam 等参与方。
 *
 * Google 不参与 IndexNow,必须走 Search Console 手动 / API 提交。
 * 百度有自己的"主动推送" API,见 scripts/baidu-push.mjs(待用户提供 token 后启用)。
 *
 * 用法:
 *   node scripts/indexnow.mjs                            # 推全部 sitemap URL
 *   node scripts/indexnow.mjs https://.../docs/grid     # 只推单页
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HOST = 'skylerx.skyler.uno'
const KEY = 'cc90090ea7a94c2b8f5c9deba23f53aa'
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`
const SITEMAP_URL = `https://${HOST}/sitemap.xml`

async function readSitemapUrls() {
  const res = await fetch(SITEMAP_URL)
  if (!res.ok) throw new Error(`sitemap fetch ${res.status}`)
  const xml = await res.text()
  // 简单 <loc>...</loc> 提取,不引 XML 解析器
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
}

async function submit(urls) {
  // IndexNow 协议:POST 一次最多 10000 URL 给单一端点,会转发给所有参与引擎
  const payload = {
    host: HOST,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList: urls,
  }
  const res = await fetch('https://api.indexnow.org/IndexNow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  })
  return { status: res.status, body: await res.text() }
}

async function main() {
  const explicit = process.argv.slice(2).filter((a) => a.startsWith('http'))
  const urls = explicit.length ? explicit : await readSitemapUrls()
  if (!urls.length) {
    console.error('❌ 无 URL 可推')
    process.exit(1)
  }
  console.log(`▶ 准备推送 ${urls.length} 个 URL 到 IndexNow ...`)
  const r = await submit(urls)
  // 200 / 202 都算成功(202 = 已接受异步处理)
  if (r.status === 200 || r.status === 202) {
    console.log(`✅ IndexNow 已接受(HTTP ${r.status})`)
  } else {
    console.error(`❌ IndexNow 返回 HTTP ${r.status}`)
    console.error(r.body.slice(0, 500))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('❌ IndexNow 提交失败:', e)
  process.exit(1)
})
