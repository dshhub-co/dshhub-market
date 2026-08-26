/**
 * 平台黑名单（下架插件）查询：安装/更新前拦截已被平台下架的条目。
 *
 * 数据来自平台公开端点 GET /api/blacklist（removed 插件列表，CDN 60s 缓存）。
 * **fail-open**：拉取失败返回空列表不抛——黑名单是增强防御，主防线是平台
 * 下载路由对 removed 插件 404 与 registry 不再返回条目，避免网络抖动误伤
 * 正常安装。缓存 TTL 60s：下架后约 1 分钟内客户端拦截生效。
 *
 * Node 侧专用（依赖 net.ts → undici）：浏览器侧不要 import 本模块，
 * 走 /dsh-market/blacklist 本地代理路由 + blacklist-util.ts 纯函数。
 */

import { marketFetch } from './net.ts'
import { blacklistHas, type BlacklistEntry } from './blacklist-util.ts'

export type { BlacklistEntry } from './blacklist-util.ts'
export { blacklistHas, dshhubIdFromZip } from './blacklist-util.ts'

/** 可被环境变量覆盖（测试/e2e 指向本地 fixture）；默认平台生产端点。 */
export const BLACKLIST_URL =
  process.env.DSHM_BLACKLIST_URL ?? 'https://www.dshhub.co/api/blacklist'

const TTL_MS = 60_000
let cached: { at: number; entries: BlacklistEntry[] } | null = null

/** 拉取黑名单（带内存缓存）；失败时返回旧缓存或空列表，绝不抛。 */
export async function fetchBlacklist(force = false): Promise<BlacklistEntry[]> {
  const now = Date.now()
  if (!force && cached !== null && now - cached.at < TTL_MS) return cached.entries
  try {
    const response = await marketFetch(BLACKLIST_URL, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return cached?.entries ?? []
    const data = (await response.json()) as unknown
    const entries = Array.isArray(data) ? (data as BlacklistEntry[]) : []
    cached = { at: now, entries }
    return entries
  } catch {
    return cached?.entries ?? []
  }
}

/** 测试用：清空缓存，强制下次重新拉取。 */
export function forgetBlacklist(): void {
  cached = null
}

/** 异步版（拉取最新黑名单再判断）——安装/更新拦截用。 */
export async function isBlacklisted(entry: {
  dshhubId?: string | null
  zip?: string | null
  name?: string | null
}): Promise<boolean> {
  return blacklistHas(await fetchBlacklist(), entry)
}

/** 按包名判断（/dsh-market/update 按已安装包名工作，无 entry 上下文）。 */
export async function blacklistHasName(name: string): Promise<boolean> {
  const entries = await fetchBlacklist()
  if (entries.length === 0) return false
  const names = new Set(entries.map((e) => e.name.toLowerCase()))
  return names.has(name.toLowerCase())
}
