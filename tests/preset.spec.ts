/**
 * Preset distribution (manifest v2, kind=preset): local scan, zip install,
 * installed-state bookkeeping, the legacy-root migration, and the publish
 * manifest shape. The install root is DSH's user preset root
 * <dsh-home>/.agent-presets/ — the only local root DSH's picker scans.
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
import { buildManifest, buildPublishInfo, publishItems } from '../src/publish.ts'

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

/** The DSH user preset root — where installs and authored modes live. */
function userPresetRoot(): string {
  return join(home, '.agent-presets')
}

function makePreset(name: string, yml: string): string {
  const dir = join(userPresetRoot(), name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent.cordis.yml'), yml)
  return dir
}

/** The legacy profile-local root (≤0.8.13) — read only for residue/migration. */
function legacyPresetRoot(): string {
  return join(profileRoot(), 'agent-presets')
}

function makeLegacyPreset(name: string, yml: string): string {
  const dir = join(legacyPresetRoot(), name)
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
  it('finds presets in the DSH user root with agent.cordis.yml and reads name/description', () => {
    makePreset('my-mode', [
      'name: 我的模式',
      'description: 一个测试模式',
      'trust: local',
    ].join('\n'))
    makePreset('hidden', 'name: hidden') // 无 yml 的目录不进
    rmSync(join(userPresetRoot(), 'hidden'), { recursive: true, force: true })
    mkdirSync(join(userPresetRoot(), 'no-yml'), { recursive: true })

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

  it('reads preset.yml metadata in preference to agent.cordis.yml', () => {
    makePreset('my-lib-mode', 'name: 库内名\n')
    writeFileSync(join(userPresetRoot(), 'my-lib-mode', 'preset.yml'), 'name: 库模式\ndescription: 库描述\n')

    const items = scanPresets(profileRoot())
    const m = items.find((i) => i.name === 'my-lib-mode')
    expect(m).toMatchObject({
      kind: 'preset',
      displayName: '库模式', // preset.yml 优先于 agent.cordis.yml 的 name
      description: '库描述',
      dir: 'presets/my-lib-mode',
    })
  })

  it('still finds pre-migration residue in the legacy profile-local root', () => {
    makeLegacyPreset('old-mode', 'name: 旧安装\n')

    const items = scanPresets(profileRoot())
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ name: 'old-mode', displayName: '旧安装' })
  })

  it('dedupes by name: the user root wins over legacy profile-root residue', () => {
    // 库根（真实位置）同名
    makePreset('same-mode', 'name: 库版本\ndescription: 库里的\n')
    writeFileSync(join(userPresetRoot(), 'same-mode', 'preset.yml'), 'name: 库版本\ndescription: 库里的\n')
    // 遗留 profile 根同名
    makeLegacyPreset('same-mode', 'name: 本地版本\ndescription: 本地安装的\n')

    const items = scanPresets(profileRoot())
    const matches = items.filter((i) => i.name === 'same-mode')
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ displayName: '库版本', description: '库里的' })
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

  it('downloads, copies preset dirs into the DSH user root, records state, and uninstalls exactly those dirs', async () => {
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
    // Installs land in <dsh-home>/.agent-presets/ — the root DSH's picker reads.
    expect(readFileSync(join(userPresetRoot(), 'my-mode', 'agent.cordis.yml'), 'utf8')).toContain('我的模式')
    expect(readFileSync(join(userPresetRoot(), 'other-mode', 'agent.cordis.yml'), 'utf8')).toContain('另一个')
    expect(existsSync(join(userPresetRoot(), '.dshhub', 'mymode.json'))).toBe(true)
    expect(isInstalledPreset(profileRoot(), 'mymode')).toBe(true)
    expect(presetSpecMap(profileRoot())).toEqual({ mymode: 'preset:https://www.dshhub.co/entry' })

    // 刚装好的 preset 能被 scan 发现（安装 → 可再次发布链路）
    const scanned = scanPresets(profileRoot()).map((s) => s.name).sort()
    expect(scanned).toEqual(['my-mode', 'other-mode'])

    expect(uninstallPreset(profileRoot(), 'mymode')).toBe(true)
    expect(existsSync(join(userPresetRoot(), 'my-mode'))).toBe(false)
    expect(existsSync(join(userPresetRoot(), 'other-mode'))).toBe(false)
    expect(existsSync(join(userPresetRoot(), '.dshhub', 'mymode.json'))).toBe(false)
    expect(isInstalledPreset(profileRoot(), 'mymode')).toBe(false)
  })

  it('migrates legacy profile-root installs (≤0.8.13) into the DSH user root on first read', async () => {
    // 旧版把预设装进 <profile>/agent-presets/，DSH 从不扫那个目录。
    const dir = makeLegacyPreset('erduo-broll', 'name: 旧安装\n')
    writeFileSync(join(dir, 'preset.yml'), 'name: 旧预设\ndescription: 迁移测试\n')
    mkdirSync(join(legacyPresetRoot(), '.dshhub'), { recursive: true })
    writeFileSync(join(legacyPresetRoot(), '.dshhub', 'dshhub-erduo-broll.json'), JSON.stringify({
      name: 'dshhub-erduo-broll',
      version: '1.0.0',
      presets: ['erduo-broll'],
      url: 'https://www.dshhub.co/entry',
      installedAt: '2026-08-22T21:22:29Z',
    }))

    // 迁移在第一次读时触发：目录 + 状态移到库根，遗留根清空。
    expect(readInstalledPresets(profileRoot())).toMatchObject({
      'dshhub-erduo-broll': { presets: ['erduo-broll'], url: 'https://www.dshhub.co/entry' },
    })
    expect(readFileSync(join(userPresetRoot(), 'erduo-broll', 'agent.cordis.yml'), 'utf8')).toContain('旧安装')
    expect(existsSync(join(userPresetRoot(), '.dshhub', 'dshhub-erduo-broll.json'))).toBe(true)
    expect(existsSync(join(legacyPresetRoot(), 'erduo-broll'))).toBe(false)
    expect(existsSync(join(legacyPresetRoot(), '.dshhub'))).toBe(false)
    // 迁移后卸载从库根删除。
    expect(uninstallPreset(profileRoot(), 'dshhub-erduo-broll')).toBe(true)
    expect(existsSync(join(userPresetRoot(), 'erduo-broll'))).toBe(false)
    expect(isInstalledPreset(profileRoot(), 'dshhub-erduo-broll')).toBe(false)
  })

  it('does not run migration twice, and leaves untracked legacy files alone', async () => {
    const dir = makeLegacyPreset('tracked', 'name: 跟踪\n')
    mkdirSync(join(legacyPresetRoot(), '.dshhub'), { recursive: true })
    writeFileSync(join(legacyPresetRoot(), '.dshhub', 'pkg.json'), JSON.stringify({
      name: 'pkg', version: '1.0.0', presets: ['tracked'], url: 'u', installedAt: '2026-08-22T21:22:29Z',
    }))
    // 未跟踪的目录（无状态记录）必须原样保留。
    mkdirSync(join(legacyPresetRoot(), 'untracked'), { recursive: true })
    writeFileSync(join(legacyPresetRoot(), 'untracked', 'agent.cordis.yml'), 'name: 未跟踪\n')

    const first = readInstalledPresets(profileRoot())
    const second = readInstalledPresets(profileRoot())
    expect(second).toEqual(first)
    expect(existsSync(join(userPresetRoot(), 'tracked', 'agent.cordis.yml'))).toBe(true)
    expect(existsSync(join(legacyPresetRoot(), 'untracked', 'agent.cordis.yml'))).toBe(true)
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
      info: { demo: 'https://example.com/demo' },
    })
    expect(result.ok).toBe(true)
    expect(result.id).toBe('com.dshhub.my-mode')
    expect(uploadedUrl).toBe('https://www.dshhub.co/api/creator/upload')
    expect(authHeader).toBe('Bearer access-token-1')
  })

  it('buildManifest writes only non-empty info fields (demo/teachingLinks/…/changelog)', () => {
    const item = {
      kind: 'skill' as const,
      dir: 'skills/kbcut',
      name: 'kbcut',
      displayName: '剪片',
      description: 'desc',
      path: '/x',
    }
    const manifest = buildManifest(item, 'u', 'n', {
      demo: '  https://v.douyin.com/abc  ',
      teachingLinks: '',
      gettingStarted: '第一步\n第二步',
      faq: 'Q：怎么用？\nA：看视频',
      contact: '微信：abc',
      changelog: '修了 bug',
    })
    expect(manifest.demo).toBe('https://v.douyin.com/abc') // trim 后写入
    expect(manifest.teachingLinks).toBeUndefined() // 空字符串整字段丢弃
    expect(manifest.gettingStarted).toBe('第一步\n第二步')
    expect(manifest.faq).toBe('Q：怎么用？\nA：看视频')
    expect(manifest.contact).toBe('微信：abc')
    expect(manifest.changelog).toBe('修了 bug')
  })

  it('buildPublishInfo extracts the six fields from a raw payload (empty values dropped)', () => {
    const raw = {
      kind: 'preset',
      name: 'my-mode',
      demo: 'https://www.bilibili.com/video/BV1xx',
      teachingLinks: '  ',
      gettingStarted: '1. 装好\n2. 打开',
      faq: '',
      contact: undefined,
      changelog: 'v1.0.1 修复',
    }
    expect(buildPublishInfo(raw)).toEqual({
      demo: 'https://www.bilibili.com/video/BV1xx',
      gettingStarted: '1. 装好\n2. 打开',
      changelog: 'v1.0.1 修复',
    })
    expect(buildPublishInfo({})).toEqual({})
  })

  it('publishes all info fields into the zip manifest.json', async () => {
    makePreset('my-mode', 'name: 我的模式\ndescription: 测试模式\n')
    const items = scanPresets(profileRoot())
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = init?.body as FormData
      const file = body.get('file') as File
      const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
      const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json'])) as Record<string, unknown>
      expect(manifest.demo).toBe('https://v.douyin.com/abc')
      expect(manifest.teachingLinks).toBe('https://www.bilibili.com/opus/1\nhttps://www.bilibili.com/opus/2')
      expect(manifest.gettingStarted).toBe('第一步\n第二步')
      expect(manifest.faq).toBe('Q：a\nA：b')
      expect(manifest.contact).toBe('微信：w1')
      expect(manifest.changelog).toBe('更新说明')
      return new Response(
        JSON.stringify({ ok: true, pluginId: 'p1', id: 'com.dshhub.my-mode', name: 'x', version: '1.0.0', kind: 'preset' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }))

    const result = await publishItems(items, {
      apiBase: 'https://www.dshhub.co',
      accountId: 'u1',
      authorName: '作者',
      info: {
        demo: 'https://v.douyin.com/abc',
        teachingLinks: 'https://www.bilibili.com/opus/1\nhttps://www.bilibili.com/opus/2',
        gettingStarted: '第一步\n第二步',
        faq: 'Q：a\nA：b',
        contact: '微信：w1',
        changelog: '更新说明',
      },
    })
    expect(result.ok).toBe(true)
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
