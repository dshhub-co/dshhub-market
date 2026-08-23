/**
 * publishUpload (bridge.ts): the per-item 沟通字段 mapping the cloud bridge
 * hands to the real publish flow. The cloud-bridge spec mocks bridge.ts
 * wholesale (payload pass-through), so this spec exercises the REAL
 * publishUpload against a stubbed platform upload endpoint.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { publishUpload } from '../src/bridge.ts'
import { scanPresets } from '../src/preset-scan.ts'

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dshm-upload-'))
  process.env.DSH_HOME = home
  process.env.DSHHUB_API_URL = 'http://platform.test'
})
afterEach(() => {
  delete process.env.DSH_HOME
  delete process.env.DSHHUB_API_URL
  rmSync(home, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

function userPresetRoot(): string {
  return join(home, '.agent-presets')
}

function makePreset(name: string): void {
  const dir = join(userPresetRoot(), name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent.cordis.yml'), `name: ${name}\ntrust: local\n`)
}

/** 捕获上传 zip 的 manifest 并回 200（每次调用记录一个 manifest）。 */
function stubUpload(captured: Array<Record<string, unknown>>): void {
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = init?.body as FormData
    const file = body.get('file') as File
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
    captured.push(JSON.parse(new TextDecoder().decode(entries['manifest.json'])) as Record<string, unknown>)
    return new Response(
      JSON.stringify({ ok: true, pluginId: 'p1', id: 'com.dshhub.x', name: 'x', version: '1.0.0', kind: 'preset' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }))
}

const auth = { token: 'tok', accountId: 'acc', authorName: 'author' }

describe('publishUpload', () => {
  it('binds each item\'s 沟通字段 into its own zip manifest', async () => {
    makePreset('my-mode')
    const captured: Array<Record<string, unknown>> = []
    stubUpload(captured)

    const result = await publishUpload({
      items: [{
        kind: 'preset',
        name: 'my-mode',
        demo: 'https://v.douyin.com/abc',
        teachingLinks: 'https://www.bilibili.com/opus/1',
        gettingStarted: '第一步\n第二步',
        faq: 'Q：怎么装\nA：看视频',
        contact: '微信：w1',
        changelog: 'v1.0.1 修复',
      }],
      ...auth,
    }, 'web')

    expect(result.ok).toBe(true)
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      demo: 'https://v.douyin.com/abc',
      teachingLinks: 'https://www.bilibili.com/opus/1',
      gettingStarted: '第一步\n第二步',
      faq: 'Q：怎么装\nA：看视频',
      contact: '微信：w1',
      changelog: 'v1.0.1 修复',
    })
  })

  it('drops empty info fields; 顶层 demoUrl 只在条目完全没带字段时回落（旧发布页兼容）', async () => {
    makePreset('my-mode')
    const captured: Array<Record<string, unknown>> = []
    stubUpload(captured)

    const result = await publishUpload({
      items: [{ kind: 'preset', name: 'my-mode' }],
      demoUrl: 'https://legacy.example.com/demo',
      ...auth,
    }, 'web')

    expect(result.ok).toBe(true)
    expect(captured[0].demo).toBe('https://legacy.example.com/demo')
    expect(captured[0].teachingLinks).toBeUndefined()
  })

  it('条目带任意自身字段（即使个别字段为空）就不回落顶层 demoUrl', async () => {
    makePreset('my-mode')
    const captured: Array<Record<string, unknown>> = []
    stubUpload(captured)

    const result = await publishUpload({
      items: [{ kind: 'preset', name: 'my-mode', demo: '', teachingLinks: '  ', gettingStarted: '一步' }],
      demoUrl: 'https://legacy.example.com/demo',
      ...auth,
    }, 'web')

    expect(result.ok).toBe(true)
    expect(captured[0]).toMatchObject({ gettingStarted: '一步' })
    expect(captured[0].demo).toBeUndefined() // 空字段丢弃，旧 demoUrl 不混入新页面条目
    expect(captured[0].teachingLinks).toBeUndefined()
  })

  it('item 自带 demo 时顶层 demoUrl 不生效', async () => {
    makePreset('my-mode')
    const captured: Array<Record<string, unknown>> = []
    stubUpload(captured)

    const result = await publishUpload({
      items: [{ kind: 'preset', name: 'my-mode', demo: 'https://v.douyin.com/own' }],
      demoUrl: 'https://legacy.example.com/demo',
      ...auth,
    }, 'web')

    expect(result.ok).toBe(true)
    expect(captured[0].demo).toBe('https://v.douyin.com/own')
  })

  it('逐项打包：两项各发一次 upload，字段互不串扰', async () => {
    makePreset('mode-a')
    makePreset('mode-b')
    const captured: Array<Record<string, unknown>> = []
    stubUpload(captured)

    const result = await publishUpload({
      items: [
        { kind: 'preset', name: 'mode-a', demo: 'https://a' },
        { kind: 'preset', name: 'mode-b', demo: 'https://b', changelog: 'b 的说明' },
      ],
      ...auth,
    }, 'web')

    expect(result.ok).toBe(true)
    expect(result.published).toHaveLength(2)
    expect(captured).toHaveLength(2)
    expect(captured.map(m => m.demo)).toEqual(['https://a', 'https://b'])
    expect(captured[0].changelog).toBeUndefined()
    expect(captured[1].changelog).toBe('b 的说明')
  })

  it('未知条目返回错误且不发出任何上传', async () => {
    makePreset('my-mode')
    const captured: Array<Record<string, unknown>> = []
    stubUpload(captured)

    const result = await publishUpload({
      items: [{ kind: 'preset', name: 'ghost' }],
      ...auth,
    }, 'web')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('未在本机扫描结果中找到')
    expect(captured).toHaveLength(0)
  })
})
