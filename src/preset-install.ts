/**
 * Preset install path (manifest v2, kind=preset): presets are DSH agent mode
 * directories (agent.cordis.yml) that define a complete persona + tool combo.
 * This module downloads the entry's zip, validates the preset structure, and
 * copies each preset directory into <profile>/agent-presets/<preset-name>/.
 *
 * Installed state is recorded under <profile>/agent-presets/.dshhub/<package>.json
 * so uninstall can remove exactly the directories one package brought in.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { unzipSync } from 'fflate'
import { marketFetch } from './net.ts'
import type { RegistryPlugin } from './registry.ts'

/** Bookkeeping dir inside the presets root (hidden from DSH's own scan). */
export const PRESET_STATE_DIR = '.dshhub'

export interface InstalledPreset {
  /** Package (manifest) name, also the installed-map key. */
  name: string
  version: string
  /** Preset dir names copied into the profile agent-presets root. */
  presets: string[]
  url: string
  installedAt: string
}

/** Profile agent-presets root (may not exist yet). */
export function presetsRoot(profileDirectory: string): string {
  return join(profileDirectory, 'agent-presets')
}

function statePath(profileDirectory: string, name: string): string {
  return join(profileDirectory, 'agent-presets', PRESET_STATE_DIR, `${name}.json`)
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '-')
}

/** Installed preset packages: package name → record. */
export function readInstalledPresets(profileDirectory: string): Record<string, InstalledPreset> {
  const dir = join(profileDirectory, 'agent-presets', PRESET_STATE_DIR)
  if (!existsSync(dir)) return {}
  const out: Record<string, InstalledPreset> = {}
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8')) as InstalledPreset
      if (typeof parsed.name === 'string' && parsed.name !== '') out[parsed.name] = parsed
    } catch {
      // corrupted record — ignore
    }
  }
  return out
}

/** Installed-map entries for preset packages: name → `preset:<url>` spec. */
export function presetSpecMap(profileDirectory: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, preset] of Object.entries(readInstalledPresets(profileDirectory))) {
    out[name] = `preset:${preset.url}`
  }
  return out
}

interface PresetManifestLike {
  id?: unknown
  name?: unknown
  version?: unknown
  kind?: unknown
  presets?: unknown
}

/** Locate manifest.json at the zip root or under a single wrapper dir. */
function locateManifest(entries: Record<string, Uint8Array>): {
  manifest: PresetManifestLike
  rooted: Record<string, Uint8Array>
} {
  const atRoot = entries['manifest.json']
  if (atRoot !== undefined) {
    return { manifest: JSON.parse(new TextDecoder().decode(atRoot)) as PresetManifestLike, rooted: entries }
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
      return { manifest: JSON.parse(new TextDecoder().decode(mf)) as PresetManifestLike, rooted }
    }
  }
  throw new Error('压缩包缺少根目录 manifest.json')
}

function assertSafePath(name: string): void {
  if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
    throw new Error(`压缩包含非法路径：${name}`)
  }
}

/**
 * Install a kind=preset catalog entry: download → validate → copy preset dirs
 * into <profile>/agent-presets/. Throws with a Chinese error on failure.
 */
export async function installPreset(profileDirectory: string, entry: RegistryPlugin): Promise<InstalledPreset> {
  if (typeof entry.zip !== 'string' || entry.zip === '') {
    throw new Error('该预设包没有可下载的 zip 源')
  }
  let zipBytes: Buffer
  try {
    const response = await marketFetch(entry.zip, { signal: AbortSignal.timeout(180_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    zipBytes = Buffer.from(await response.arrayBuffer())
  } catch (error) {
    throw new Error(`下载预设包失败（${entry.zip}）：${error instanceof Error ? error.message : String(error)}`)
  }
  if (zipBytes.byteLength < 22) throw new Error('预设包无效（空文件）')

  const entries = unzipSync(new Uint8Array(zipBytes))
  const { manifest, rooted } = locateManifest(entries)
  if (manifest.kind !== 'preset') {
    throw new Error(`该包 kind=${String(manifest.kind ?? '')}，不是预设包（preset）`)
  }
  if (typeof manifest.name !== 'string' || manifest.name === '') throw new Error('manifest.json 缺少 name')

  const presetDirs = Array.isArray(manifest.presets)
    ? manifest.presets.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map(s => s.replace(/^\.?\//, '').replace(/\/+$/, ''))
    : ['presets']

  const copied: string[] = []
  for (const dir of presetDirs) {
    const ymlData = rooted[`${dir}/agent.cordis.yml`]
    if (ymlData === undefined) throw new Error(`预设目录缺少 agent.cordis.yml：${dir}`)

    // Use the directory basename as the installed preset name (matches DSH convention).
    const presetName = dir.split('/').pop() ?? dir
    const dest = join(profileDirectory, 'agent-presets', presetName)
    rmSync(dest, { recursive: true, force: true })
    let count = 0
    for (const [name, data] of Object.entries(rooted)) {
      if (name === dir || !name.startsWith(`${dir}/`)) continue
      if (name.endsWith('/')) continue // directory entry
      const base = name.split('/').pop() ?? ''
      if (name.startsWith('__MACOSX/') || base === '.DS_Store' || base.startsWith('._')) continue
      const rel = name.slice(dir.length + 1)
      assertSafePath(rel)
      const target = join(dest, rel)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, data)
      count++
    }
    if (count === 0) throw new Error(`预设目录为空：${dir}`)
    copied.push(presetName)
  }

  // Record installed state for uninstall / listing.
  const record: InstalledPreset = {
    name: safeName(manifest.name),
    version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
    presets: copied,
    url: entry.url,
    installedAt: new Date().toISOString(),
  }
  mkdirSync(join(profileDirectory, 'agent-presets', PRESET_STATE_DIR), { recursive: true })
  writeFileSync(statePath(profileDirectory, record.name), JSON.stringify(record, null, 2))
  return record
}

/** Remove every preset dir a package brought in, then its state record. */
export function uninstallPreset(profileDirectory: string, name: string): boolean {
  const record = readInstalledPresets(profileDirectory)[name]
  if (record === undefined) return false
  for (const dir of record.presets) {
    rmSync(join(profileDirectory, 'agent-presets', dir), { recursive: true, force: true })
  }
  rmSync(statePath(profileDirectory, name), { force: true })
  return true
}

/** Preset-installed lookup used by the uninstall guard. */
export function isInstalledPreset(profileDirectory: string, name: string): boolean {
  return readInstalledPresets(profileDirectory)[name] !== undefined
}
