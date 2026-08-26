/**
 * 黑名单纯函数与类型（无任何 import，浏览器 + Node 双侧安全）。
 *
 * 浏览器端（MarketSection 解锁卡「已下架」状态校准）与 Node 端
 * （routes.ts/bridge.ts 安装拦截）共用同一套匹配逻辑；有副作用的部分
 * （fetchBlacklist 拉取 + 缓存）留在 blacklist.ts，浏览器不 import 它——
 * 它依赖 net.ts → undici → node:assert，进浏览器 bundle 会让 DSH 宿主
 * 模块表加载失败。
 */

export interface BlacklistEntry {
  id: string
  manifest_id: string
  name: string
  reason: string | null
  removed_at: string | null
}

/** 从平台 zip 下载 URL（/api/download/<uuid>）提取插件 uuid。 */
export function dshhubIdFromZip(zipUrl: string | undefined | null): string | null {
  if (!zipUrl) return null
  const match =
    /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i.exec(
      zipUrl,
    )
  return match?.[1] ?? null
}

/**
 * 同步判断：给定已拉取的黑名单条目，条目是否命中。匹配键：
 * 1. dshhubId 直接匹配；2. zip URL 提取的 uuid；3. 包名兜底（update 场景）。
 * 空列表（拉取失败 fail-open）恒 false——不误伤正常安装。
 */
export function blacklistHas(
  entries: BlacklistEntry[],
  entry: { dshhubId?: string | null; zip?: string | null; name?: string | null },
): boolean {
  if (entries.length === 0) return false
  const ids = new Set(entries.map((e) => e.id.toLowerCase()))
  const id = entry.dshhubId ?? dshhubIdFromZip(entry.zip)
  if (id !== null && ids.has(id.toLowerCase())) return true
  const names = new Set(entries.map((e) => e.name.toLowerCase()))
  if (typeof entry.name === 'string' && entry.name !== '' && names.has(entry.name.toLowerCase())) {
    return true
  }
  return false
}
