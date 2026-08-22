/**
 * Preset distribution (manifest v2, kind=preset): local scan, zip install,
 * installed-state bookkeeping, and the publish manifest shape.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, zipSync } from 'fflate'
import { scanPresets, scanSkills } from '../src/preset-scan.ts'
import {
  installPreset, isInstalledPreset, presetSpecMap, readInstalledPresets, uninstallPreset,
} from '../src/preset-install.ts'
import { buildManifest, publishItems } from '../src/publish.ts'

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dshm-preset-'))
  process.env.DSH_HOME = home
})
afterEach(() => {
  delete process.env.DSH_HOME
  rmSync(home, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

function profileRoot(): string {
  return join(home, 'profiles', 'web')
}

function makePreset(name: string, yml: string): string {
  const dir = join(profileRoot(), 'agent-presets', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent.cordis.yml'), yml)
  return dir
}

function makeSkill(name: string, md: string): string {
  const dir = join(profileRoot(), 'skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), md)
  return dir
}

describe('scanPresets / scanSkills', () => {
  it('finds presets with agent.cordis.yml and reads name/description', () => {
    makePreset('my-mode', [
      'name: 我的模式',
      'description: 一个测试模式',
      'trust: local',
    ].join('\n'))
    makePreset('hidden', 'name: hidden') // 无 yml 的目录不进
    rmSync(join(profileRoot(), 'agent-presets', 'hidden'), { recursive: true, force: true })
    mkdirSync(join(profileRoot(), 'agent-presets', 'no-yml'), { recursive: true })

    const items = scanPresets(profileRoot())
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'preset',
      name: 'my-mode',
      displayName: '我的模式',
      description: '一个测试模式',
      dir: 'presets/my-mode',
    })
  })

  it('skips bookkeeping dirs and finds skills with frontmatter', () => {
    makeSkill('kbcut', '---\nname: 剪片\n---\n技能正文')
    makeSkill('plain', '没有 frontmatter 的 md')
    mkdirSync(join(profileRoot(), 'skills', '.dshhub'), { recursive: true })

    const items = scanSkills(profileRoot())
    const names = items.map((i) => i.name).sort()
    expect(names).toEqual(['kbcut', 'plain'])
    expect(items.find((i) => i.name === 'kbcut')).toMatchObject({ displayName: '剪片', dir: 'skills/kbcut' })
  })

  it('finds creator presets from the DSH-wide library (.agent-presets)', () => {
    const lib = join(home, '.agent-presets', 'my-lib-mode')
    mkdirSync(lib, { recursive: true })
    writeFileSync(join(lib, 'agent.cordis.yml'), 'name: 库内名\n')
    writeFileSync(join(lib, 'preset.yml'), 'name: 库模式\ndescription: 库描述\n')

    const items = scanPresets(profileRoot())
    const m = items.find((i) => i.name === 'my-lib-mode')
    expect(m).toMatchObject({
      kind: 'preset',
      displayName: '库模式', // preset.yml 优先于 agent.cordis.yml 的 name
      description: '库描述',
      dir: 'presets/my-lib-mode',
    })
  })

  it('dedupes by name: profile-local preset wins over the library copy', () => {
    // 全局库同名
    const lib = join(home, '.agent-presets', 'same-mode')
    mkdirSync(lib, { recursive: true })
    writeFileSync(join(lib, 'agent.cordis.yml'), 'name: 库版本\n')
    writeFileSync(join(lib, 'preset.yml'), 'name: 库版本\ndescription: 库里的\n')
    // profile 本地同名
    makePreset('same-mode', 'name: 本地版本\ndescription: 本地安装的\n')

    const items = scanPresets(profileRoot())
    const matches = items.filter((i) => i.name === 'same-mode')
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ displayName: '本地版本', description: '本地安装的' })
  })
})

describe('installPreset', () => {
  function zipBytes(manifest: Record<string, unknown>): Uint8Array {
    return zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
      'presets/my-mode/agent.cordis.yml': new TextEncoder().encode('name: 我的模式\n'),
      'presets/my-mode/tools/helper.txt': new TextEncoder().encode('helper'),
      'presets/other-mode/agent.cordis.yml': new TextEncoder().encode('name: 另一个\n'),
    })
  }

  function stubZipFetch(bytes: Uint8Array): void {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200 })))
  }

  it('downloads, copies preset dirs, records state, and uninstalls exactly those dirs', async () => {
    const bytes = zipBytes({
      manifestVersion: 2,
      id: 'com.dshhub.mymode',
      name: 'mymode',
      version: '1.0.0',
      kind: 'preset',
      presets: ['presets/my-mode', 'presets/other-mode'],
      permissions: ['llm.call'],
    })
    stubZipFetch(bytes)

    const record = await installPreset(profileRoot(), {
      name: 'mymode',
      url: 'https://www.dshhub.co/entry',
      zip: 'https://www.dshhub.co/zip/mymode',
    } as never)

    expect(record.name).toBe('mymode')
    expect(record.presets).toEqual(['my-mode', 'other-mode'])
    expect(readFileSync(join(profileRoot(), 'agent-presets', 'my-mode', 'agent.cordis.yml'), 'utf8')).toContain('我的模式')
    expect(readFileSync(join(profileRoot(), 'agent-presets', 'other-mode', 'agent.cordis.yml'), 'utf8')).toContain('另一个')
    expect(isInstalledPreset(profileRoot(), 'mymode')).toBe(true)
    expect(presetSpecMap(profileRoot())).toEqual({ mymode: 'preset:https://www.dshhub.co/entry' })

    // 刚装好的 preset 能被 scan 发现（安装 → 可再次发布链路）
    const scanned = scanPresets(profileRoot()).map((s) => s.name).sort()
    expect(scanned).toEqual(['my-mode', 'other-mode'])

    expect(uninstallPreset(profileRoot(), 'mymode')).toBe(true)
    expect(existsSync(join(profileRoot(), 'agent-presets', 'my-mode'))).toBe(false)
    expect(existsSync(join(profileRoot(), 'agent-presets', 'other-mode'))).toBe(false)
    expect(isInstalledPreset(profileRoot(), 'mymode')).toBe(false)
  })

  it('rejects a zip whose kind is not preset', async () => {
    stubZipFetch(zipBytes({ manifestVersion: 2, id: 'com.x.y', name: 'x', version: '0.1.0', kind: 'skill' }))
    await expect(
      installPreset(profileRoot(), { name: 'x', url: 'u', zip: 'z' } as never),
    ).rejects.toThrow(/不是预设包/)
  })

  it('rejects missing agent.cordis.yml inside a declared preset dir', async () => {
    const bytes = zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify({
        manifestVersion: 2, id: 'com.x.y', name: 'x', version: '0.1.0', kind: 'preset', presets: ['presets/empty'],
      })),
    })
    stubZipFetch(bytes)
    await expect(
      installPreset(profileRoot(), { name: 'x', url: 'u', zip: 'z' } as never),
    ).rejects.toThrow(/缺少 agent.cordis.yml/)
  })
})

describe('publish manifest', () => {
  it('builds a manifest v2 preset entry with platform-defined fields', () => {
    const item = {
      kind: 'preset' as const,
      dir: 'presets/my-mode',
      name: 'my-mode',
      displayName: '我的模式',
      description: 'desc',
      path: '/x',
    }
    const manifest = buildManifest(item, 'uuid-1', '创作者')
    expect(manifest).toMatchObject({
      manifestVersion: 2,
      id: 'com.dshhub.my-mode',
      name: 'dshhub-my-mode',
      version: '1.0.0',
      kind: 'preset',
      presets: ['presets/my-mode'],
      permissions: ['llm.call'],
      license: 'MIT',
      author: { accountId: 'uuid-1', name: '创作者' },
    })
  })

  it('builds valid reverse-domain ids from hyphenated and non-ASCII names', () => {
    const base = { dir: 'presets/x', displayName: '', description: '', path: '/x' } as const
    const hyphen = buildManifest({ ...base, kind: 'preset', name: 'erduo-broll' }, 'u', 'n')
    expect(hyphen.id).toBe('com.dshhub.erduo-broll') // 平台正则允许连字符标签段

    const chinese = buildManifest({ ...base, kind: 'skill', name: '剪片' }, 'u', 'n')
    expect(chinese.id).toMatch(/^com\.dshhub\.preset-[a-z0-9]+$/)
    // 确定性：同名两次生成相同 id（更新路径依赖同一 id）
    const again = buildManifest({ ...base, kind: 'skill', name: '剪片' }, 'u', 'n')
    expect(again.id).toBe(chinese.id)
  })

  it('reports an error for an empty item list without hitting the network', async () => {
    const result = await publishItems([], { apiBase: 'http://127.0.0.1:1', accountId: 'u', authorName: 'n' })
    expect(result.ok).toBe(false)
  })

  it('publishes a scanned preset as a valid manifest v2 zip with bearer auth', async () => {
    makePreset('my-mode', 'name: 我的模式\ndescription: 测试模式\n')
    const items = scanPresets(profileRoot())
    expect(items).toHaveLength(1)

    let uploadedUrl = ''
    let authHeader: string | null = null
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      uploadedUrl = String(url)
      const rawHeaders = init?.headers as Record<string, string> | Headers | undefined
      authHeader =
        rawHeaders instanceof Headers
          ? rawHeaders.get('authorization')
          : (rawHeaders?.authorization ?? null)
      const body = init?.body as FormData
      const file = body.get('file') as File
      const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
      const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json'])) as Record<string, unknown>
      expect(manifest.kind).toBe('preset')
      expect(manifest.presets).toEqual(['presets/my-mode'])
      expect(entries['presets/my-mode/agent.cordis.yml']).toBeDefined()
      return new Response(
        JSON.stringify({
          ok: true,
          pluginId: 'p1',
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          kind: manifest.kind,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }))

    const result = await publishItems(items, {
      apiBase: 'https://www.dshhub.co',
      token: 'access-token-1',
      accountId: 'u1',
      authorName: '作者',
      demoUrl: 'https://example.com/demo',
    })
    expect(result.ok).toBe(true)
    expect(result.id).toBe('com.dshhub.my-mode')
    expect(uploadedUrl).toBe('https://www.dshhub.co/api/creator/upload')
    expect(authHeader).toBe('Bearer access-token-1')
  })

  it('auto-bumps the patch version and retries when the platform rejects with 409', async () => {
    makePreset('my-mode', 'name: 我的模式\ndescription: 测试模式\n')
    const items = scanPresets(profileRoot())
    const attempts: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      const body = init?.body as FormData
      const file = body.get('file') as File
      const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
      const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json'])) as { version: string }
      attempts.push(manifest.version)
      if (attempts.length === 1) {
        return new Response(
          JSON.stringify({ ok: false, error: '该版本已存在：dshhub-my-mode v1.0.0（发布新版本请修改 manifest 的 version）' }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({ ok: true, pluginId: 'p1', id: 'com.dshhub.my-mode', name: 'x', version: manifest.version, kind: 'preset' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }))

    const result = await publishItems(items, { apiBase: 'https://www.dshhub.co', accountId: 'u1', authorName: '作者' })
    expect(attempts).toEqual(['1.0.0', '1.0.1'])
    expect(result.ok).toBe(true)
    expect(result.version).toBe('1.0.1')
  })
})
