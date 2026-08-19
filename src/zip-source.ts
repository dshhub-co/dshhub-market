/**
 * Zip-hosted install path (fork, dshhub): catalog entries without an npm or
 * GitHub source carry a `zip` URL pointing at the hosted plugin zip. This
 * module downloads the zip, validates its manifest.json, and materializes a
 * gzipped ustar tarball into a content-addressed cache so the standard
 * `dsh plugin add <tgz>` spawn layer (dsh-cli.ts) can install it like any
 * other package. Ported from the legacy dshhub-market bridge
 * (market-plugin/lib/bridge.js), minus the HTTP server.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { gzipSync, unzipSync } from 'fflate'
import { marketFetch } from './net.ts'
import type { RegistryPlugin } from './registry.ts'

/** Cache dir shared with the legacy bridge (sha-addressed, so artifacts are
 * reusable across the old and new plugin). */
const CACHE_DIR = join(homedir(), '.dshhub-market', 'cache')

export function entryNeedsZip(entry: RegistryPlugin): boolean {
  return typeof entry.zip === 'string' && entry.zip !== ''
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, '0') + '\0'
}

/** ustar header with the legacy bridge's long-name prefix split. */
function tarHeader(name: string, size: number): Buffer {
  const h = Buffer.alloc(512)
  let n = name
  let prefix = ''
  if (n.length > 100) {
    // ustar prefix/name split at a '/' boundary
    const i = n.slice(0, 100).lastIndexOf('/')
    if (i <= 0 || n.length - i - 1 > 100 || i > 155) {
      throw new Error(`路径过长，无法打包：${name}`)
    }
    prefix = n.slice(0, i)
    n = n.slice(i + 1)
  }
  h.write(n, 0, 100, 'utf8')
  h.write(octal(0o644, 8), 100, 8) // mode
  h.write(octal(0, 8), 108, 8) // uid
  h.write(octal(0, 8), 116, 8) // gid
  h.write(octal(size, 12), 124, 12) // size
  h.write(octal(0, 12), 136, 12) // mtime (fixed → deterministic output)
  h.write('        ', 148, 8) // chksum placeholder (spaces)
  h.write('0', 156, 1) // typeflag: regular file
  h.write('ustar\0', 257, 6)
  h.write('00', 263, 2)
  let sum = 0
  for (const b of h) sum += b
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  if (prefix) h.write(prefix, 345, 155, 'utf8')
  return h
}

/**
 * Convert unzipped entries ({ path → Uint8Array }) to a gzipped ustar buffer.
 * Skips directories, __MACOSX cruft and .DS_Store; rejects unsafe paths.
 */
function entriesToTgz(entries: Record<string, Uint8Array>): Uint8Array<ArrayBuffer> {
  const chunks: Buffer[] = []
  let count = 0
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/') || name.endsWith('\\')) continue // directory entry
    const base = name.split('/').pop() ?? ''
    if (name.startsWith('__MACOSX/') || base === '.DS_Store' || base.startsWith('._')) continue
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
      throw new Error(`压缩包含非法路径：${name}`)
    }
    const size = data.byteLength
    chunks.push(tarHeader(name, size), Buffer.from(data))
    const pad = (512 - (size % 512)) % 512
    if (pad) chunks.push(Buffer.alloc(pad))
    count++
  }
  if (count === 0) throw new Error('压缩包为空')
  chunks.push(Buffer.alloc(1024)) // two zero blocks terminate the archive
  return gzipSync(new Uint8Array(Buffer.concat(chunks)), { level: 9 })
}

interface ManifestLike {
  id?: unknown
  name?: unknown
  version?: unknown
}

/**
 * Locate the manifest at the zip root — or under exactly one top-level
 * directory (GitHub-style wrapper layouts). Returns the manifest plus the
 * entries re-rooted to the zip root when a wrapper dir was stripped.
 */
function locateManifest(entries: Record<string, Uint8Array>): {
  manifest: ManifestLike
  rooted: Record<string, Uint8Array>
} {
  const atRoot = entries['manifest.json']
  if (atRoot !== undefined) {
    return {
      manifest: JSON.parse(new TextDecoder().decode(atRoot)) as ManifestLike,
      rooted: entries,
    }
  }
  const topDirs = new Set<string>()
  for (const name of Object.keys(entries)) {
    if (name.includes('/')) topDirs.add(name.split('/')[0])
  }
  if (topDirs.size === 1) {
    const dir = [...topDirs][0]
    const mf = entries[`${dir}/manifest.json`]
    if (mf !== undefined) {
      const rooted: Record<string, Uint8Array> = {}
      for (const [name, data] of Object.entries(entries)) {
        if (name.startsWith(`${dir}/`) && name.length > dir.length + 1) {
          rooted[name.slice(dir.length + 1)] = data
        }
      }
      return { manifest: JSON.parse(new TextDecoder().decode(mf)) as ManifestLike, rooted }
    }
  }
  throw new Error('压缩包缺少根目录 manifest.json')
}

/**
 * pnpm's tarball install requires a valid package.json (name + version) at
 * the archive root. Zips that shipped one keep it; the rest get a minimal
 * synthesis from the manifest — a package without `dsh.bundle` then gets the
 * honest "installed as plain dependency" verdict from the CLI and the
 * post-install validation, instead of a pnpm parse failure.
 */
function ensurePackageJson(rooted: Record<string, Uint8Array>, manifest: ManifestLike): Record<string, Uint8Array> {
  if (rooted['package.json'] !== undefined) return rooted
  if (typeof manifest.name !== 'string' || manifest.name === '' || typeof manifest.version !== 'string') {
    throw new Error('manifest.json 缺少 name / version，无法合成 package.json')
  }
  rooted = { ...rooted }
  rooted['package.json'] = new TextEncoder().encode(JSON.stringify({
    name: manifest.name,
    version: manifest.version,
  }, null, 2))
  return rooted
}

/**
 * Materialize the entry's zip into a cached tarball path for `dsh plugin add`.
 * Content-addressed: the same zip maps to the same file, a new version maps
 * to a new one (which cleanly replaces the old file: spec in the profile).
 */
export async function materializeTgz(entry: RegistryPlugin): Promise<string> {
  const zipUrl = entry.zip as string
  let zipBytes: Buffer
  try {
    const response = await marketFetch(zipUrl, { signal: AbortSignal.timeout(180_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    zipBytes = Buffer.from(await response.arrayBuffer())
  } catch (error) {
    throw new Error(`下载插件包失败（${zipUrl}）：${error instanceof Error ? error.message : String(error)}`)
  }
  if (zipBytes.byteLength < 22) throw new Error('插件包无效（空文件）')

  const entries = unzipSync(new Uint8Array(zipBytes))
  const { manifest, rooted } = locateManifest(entries)
  if (typeof manifest.id !== 'string' || manifest.id === '' || typeof manifest.name !== 'string' || manifest.name === '' || typeof manifest.version !== 'string') {
    throw new Error('manifest.json 缺少 id / name / version')
  }
  const withPkg = ensurePackageJson(rooted, manifest)
  const tgz = entriesToTgz(withPkg)

  const safeId = manifest.id.replace(/[^a-zA-Z0-9._-]/g, '-')
  const hash = createHash('sha256').update(zipBytes).digest('hex').slice(0, 8)
  mkdirSync(CACHE_DIR, { recursive: true })
  const tgzPath = join(CACHE_DIR, `${safeId}-${hash}.tgz`)
  if (!existsSync(tgzPath)) writeFileSync(tgzPath, tgz)
  return tgzPath
}
