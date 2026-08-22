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
 * Build a manifest.json object for the selected item.
 */
export function buildManifest(item: ScannedItem, accountId: string, authorName: string): Record<string, unknown> {
  const baseName = `com.dshhub.${item.name}`.toLowerCase().replace(/[^a-z0-9.]/g, '-')
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
  return manifest
}

/**
 * Package the selected item(s) into a zip and upload to the platform.
 */
export async function publishItems(
  items: ScannedItem[],
  opts: {
    apiBase: string
    token?: string
    accountId: string
    authorName: string
    demoUrl?: string
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

  // 2) Build manifest and add to the zip under the correct structure
  const manifest = buildManifest(item, opts.accountId, opts.authorName)
  if (opts.demoUrl) manifest.demo = opts.demoUrl

  // Structure:
  //   skills/<name>/...   for skill kind
  //   presets/<name>/...  for preset kind
  //   manifest.json       at root
  const kindDir = item.kind === 'skill' ? 'skills' : 'presets'
  const zipEntries: Zippable = {}
  for (const [relPath, data] of Object.entries(sourceFiles)) {
    zipEntries[`${kindDir}/${item.name}/${relPath}`] = data
  }
  zipEntries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 2))

  const zipped = zipSync(zipEntries, { level: 6 })

  // 3) Upload via multipart/form-data
  try {
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
    if (!response.ok || body.ok !== true) {
      return { ok: false, error: body.error ?? `HTTP ${response.status}` }
    }
    return body
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
