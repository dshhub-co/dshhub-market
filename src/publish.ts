/**
 * Publish flow: scan local profile for publishable items (presets/skills),
 * package them into a manifest v2 zip, and upload to dshhub.co.
 *
 * The creator picks items from the scan result, the client generates a thin
 * manifest.json (kind=preset or kind=skill), zips everything, and POSTs it
 * to the platform's /api/creator/upload endpoint.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zipSync, type Zippable } from 'fflate'
import type { ScannedItem } from './preset-scan.ts'

export interface PublishResult {
  ok: boolean
  pluginId?: string
  id?: string
  name?: string
  version?: string
  kind?: string
  error?: string
  /** 一次发布多项时，每项的成功结果（bridge 逐项调用后汇总） */
  published?: Array<{ name: string; id: string; kind: string; version: string }>
}

/**
 * 开发者→买家沟通字段（manifest v2，全部可选；非空才写入 zip 的 manifest.json）。
 * 多行字段统一用换行分隔字符串，与口令卡（bundles 表、解锁卡渲染）的既有约定一致。
 */
export interface PublishItemInfo {
  /** 教程/演示视频链接（preset/skill 平台硬必填，抖音/B站/YouTube 均可） */
  demo?: string
  /** 使用指南链接，每行一条 */
  teachingLinks?: string
  /** 上手步骤，每行一步 */
  gettingStarted?: string
  /** 常见问题，每行一条 Q：/A： */
  faq?: string
  /** 联系方式，每行一条（微信/群/邮箱） */
  contact?: string
  /** 更新说明 */
  changelog?: string
}

/** 从任意原始条目提取六个沟通字段（空值丢弃；供 bridge/routes 复用）。 */
export function buildPublishInfo(raw: Record<string, unknown>): PublishItemInfo {
  const info: PublishItemInfo = {}
  for (const key of ['demo', 'teachingLinks', 'gettingStarted', 'faq', 'contact', 'changelog'] as const) {
    const value = raw[key]
    if (typeof value === 'string' && value.trim() !== '') info[key] = value.trim()
  }
  return info
}

/** Collect all files under a directory recursively into a flat map. */
function collectFiles(
  rootDir: string,
  dir: string,
  prefix = '',
): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {}
  const entries = readdirSync(dir)
  for (const entry of entries) {
    if (entry === '.DS_Store' || entry.startsWith('._')) continue
    const fullPath = join(dir, entry)
    const relKey = prefix ? `${prefix}/${entry}` : entry
    if (statSync(fullPath).isDirectory()) {
      Object.assign(out, collectFiles(rootDir, fullPath, relKey))
    } else {
      out[relKey] = new Uint8Array(readFileSync(fullPath))
    }
  }
  return out
}

/**
 * 反域名 id：标签段只留小写字母/数字/连字符；全非 ASCII 目录名（如中文技能名）
 * 用确定性哈希兜底，保证任意名字都能发布。
 * 平台校验：/^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/
 */
function reverseDomainId(name: string): string {
  const label = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^[-]+|[-]+$/g, '')
    .replace(/-{2,}/g, '-')
  if (label === '') {
    let h = 0
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
    return `com.dshhub.preset-${h.toString(36)}`
  }
  return `com.dshhub.${label}`
}

/**
 * Build a manifest.json object for the selected item.
 * @param info - 开发者→买家沟通字段，非空字符串才写入（空值整字段丢弃）。
 */
export function buildManifest(
  item: ScannedItem,
  accountId: string,
  authorName: string,
  info?: PublishItemInfo,
): Record<string, unknown> {
  const baseName = reverseDomainId(item.name)
  const manifest: Record<string, unknown> = {
    manifestVersion: 2,
    id: baseName,
    name: `dshhub-${item.name}`,
    version: '1.0.0',
    displayName: item.displayName,
    description: item.description,
    author: { accountId, name: authorName },
    kind: item.kind,
    permissions: item.kind === 'preset' ? ['llm.call'] : [],
    license: 'MIT',
  }
  if (item.kind === 'preset') {
    manifest.presets = [item.dir]
  } else if (item.kind === 'skill') {
    manifest.skills = [item.dir]
  }
  if (info !== undefined) {
    for (const [key, value] of Object.entries(info)) {
      if (typeof value === 'string' && value.trim() !== '') manifest[key] = value.trim()
    }
  }
  return manifest
}

/**
 * Package the selected item(s) into a zip and upload to the platform.
 * 同一内容重复发布时平台会 409「该版本已存在」：自动把补丁版本号 +1 重试
 * 一次（如 1.0.0 → 1.0.1），让「修复后重新发布」不要求用户改任何文件。
 */
export async function publishItems(
  items: ScannedItem[],
  opts: {
    apiBase: string
    token?: string
    accountId: string
    authorName: string
    /** 开发者→买家沟通字段（demo 并入此对象；旧接口的顶层 demoUrl 由调用方转成 { demo }） */
    info?: PublishItemInfo
  },
): Promise<PublishResult> {
  if (items.length === 0) {
    return { ok: false, error: '没有选中要发布的内容' }
  }
  // For now each item is published as its own zip/plugin.
  // TODO: support bundling multiple items into one package later.
  const item = items[0]

  // 1) Gather files from the source directory
  const sourceFiles = collectFiles(item.path, item.path)

  const baseManifest = buildManifest(item, opts.accountId, opts.authorName, opts.info)

  // Structure:
  //   skills/<name>/...   for skill kind
  //   presets/<name>/...  for preset kind
  //   manifest.json       at root
  const kindDir = item.kind === 'skill' ? 'skills' : 'presets'

  /** 用指定版本号打包一次并上传（多版本共享源文件，zip 内容仅 manifest 不同）。 */
  async function attempt(version: string): Promise<{ status: number; body: PublishResult }> {
    const zipEntries: Zippable = {}
    for (const [relPath, data] of Object.entries(sourceFiles)) {
      zipEntries[`${kindDir}/${item.name}/${relPath}`] = data
    }
    const manifest = { ...baseManifest, version }
    zipEntries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 2))
    const zipped = zipSync(zipEntries, { level: 6 })

    const formData = new FormData()
    formData.append('file', new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' }), `${item.name}.zip`)

    const headers: Record<string, string> = {}
    if (opts.token) headers['authorization'] = `Bearer ${opts.token}`

    const response = await fetch(`${opts.apiBase}/api/creator/upload`, {
      method: 'POST' as const,
      body: formData as never,
      headers,
      signal: AbortSignal.timeout(60_000),
    })
    const body = await response.json() as PublishResult
    return { status: response.status, body }
  }

  try {
    let { status, body } = await attempt(baseManifest.version as string)
    if (status === 409 && !body.ok) {
      // 该版本已存在 → 补丁号 +1 重试一次（1.0.0 → 1.0.1）
      const next = bumpPatch(baseManifest.version as string)
      ;({ status, body } = await attempt(next))
    }
    if (status !== 200 || body.ok !== true) {
      return { ok: false, error: body.error ?? `HTTP ${status}` }
    }
    return body
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 补丁版本号 +1：1.0.0 → 1.0.1；非标准格式时追加 .1 兜底。 */
export function bumpPatch(version: string): string {
  const parts = version.split('.')
  if (parts.length >= 2) {
    const last = Number(parts[parts.length - 1])
    if (Number.isFinite(last)) {
      parts[parts.length - 1] = String(last + 1)
      return parts.join('.')
    }
  }
  return `${version}.1`
}
