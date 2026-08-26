/**
 * 哈希存证校验（src/zip-source.ts materializeTgz 的 expectedSha256）：
 * 平台直传条目在 registry 携带 file_sha256（checksum），下载字节比对不一致
 * 即拒绝安装（防下载被篡改）；GitHub 导入条目字节实时重建不稳定、不携带
 * （undefined）→ 跳过校验。校验与缓存命名共用一次 sha256 计算。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { materializeTgz } from '../src/zip-source.ts'
import type { RegistryPlugin } from '../src/registry.ts'

const ZIP_URL = 'https://www.dshhub.co/api/download/3f2c1e8a-0000-4b2a-9c8d-000000000001'

function zipBytes(): Uint8Array {
  return zipSync({
    'manifest.json': new TextEncoder().encode(JSON.stringify({
      id: 'com.dshhub.sha',
      name: 'sha-plugin',
      version: '1.0.0',
      kind: 'tool',
    }, null, 2)),
    'index.js': new TextEncoder().encode('module.exports = {}'),
  })
}

function entry(): RegistryPlugin {
  return {
    name: 'sha-plugin',
    owner: 'dshhub',
    url: ZIP_URL,
    category: 'tools',
    description: { en: '', zh: '' },
    install: '',
    zip: ZIP_URL,
  }
}

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dshm-sha-'))
  // materializeTgz 的缓存目录在 homedir()/.dshhub-market/cache — 指到临时目录
  process.env.HOME = home
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.HOME
  rmSync(home, { recursive: true, force: true })
})

describe('materializeTgz expectedSha256', () => {
  it('sha256 匹配 → 校验通过，生成缓存 tarball', async () => {
    const bytes = zipBytes()
    const sha = createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200 })))

    const tgzPath = await materializeTgz(entry(), { expectedSha256: sha })
    expect(typeof tgzPath).toBe('string')
    expect(existsSync(tgzPath)).toBe(true)
  })

  it('sha256 不匹配 → 拒绝安装（防篡改）', async () => {
    const bytes = zipBytes()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200 })))

    await expect(
      materializeTgz(entry(), { expectedSha256: 'f'.repeat(64) }),
    ).rejects.toThrow('内容校验失败')
  })

  it('expectedSha256 为 undefined（GitHub 导入条目）→ 跳过校验，正常安装', async () => {
    const bytes = zipBytes()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200 })))

    const tgzPath = await materializeTgz(entry(), {})
    expect(existsSync(tgzPath)).toBe(true)
  })

  it('下载失败仍报下载错误（校验不掩盖网络失败）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 404 })))

    await expect(
      materializeTgz(entry(), { expectedSha256: 'f'.repeat(64) }),
    ).rejects.toThrow('下载插件包失败')
  })
})
