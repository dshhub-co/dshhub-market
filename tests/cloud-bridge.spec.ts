/**
 * Cloud bridge (平台中转发布通道): register → poll → dispatch → report
 * lifecycle against a stubbed platform API and a stubbed upload path.
 * The infinite startCloudBridge loop is not exercised here; register and
 * pollOnce are the state-machine pieces it drives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { register, pollOnce } from '../src/cloud-bridge.ts'
import { publishUpload } from '../src/bridge.ts'

vi.mock('../src/bridge.ts', () => ({
  publishUpload: vi.fn(async (body: Record<string, unknown>) => ({
    ok: true,
    published: [{ name: body?.items?.[0]?.name ?? 'x', kind: 'preset', version: '1.0.0' }],
  })),
}))

const mockedUpload = vi.mocked(publishUpload)

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dshm-cloud-'))
  process.env.DSH_HOME = home
})
afterEach(() => {
  delete process.env.DSH_HOME
  rmSync(home, { recursive: true, force: true })
  vi.unstubAllGlobals()
  mockedUpload.mockClear()
})

function profileRoot(): string {
  return join(home, 'profiles', 'web')
}

function makePreset(name: string): void {
  // DSH user preset root — the location presets live in (market installs and
  // authored modes); the legacy profile-local root is only migration residue.
  const dir = join(home, '.agent-presets', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent.cordis.yml'), `name: ${name}\ntrust: local\n`)
}

function makeSkill(name: string): void {
  const dir = join(profileRoot(), 'skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `# ${name}\n\n技能描述\n`)
}

interface SeenCall {
  path: string
  body: unknown
}

/** 按路径路由的 fetch 替身：收集调用记录并返回对应响应。 */
function stubPlatform(routes: Record<string, (body: unknown) => Response | Promise<Response>>, seen: SeenCall[]): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url))
    let body: unknown = null
    try {
      body = JSON.parse(String(init?.body ?? '{}'))
    } catch {
      /* not json */
    }
    seen.push({ path: u.pathname, body })
    const route = routes[u.pathname]
    if (!route) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    return route(body)
  }))
}

const state = (profile: string) => ({ sessionId: 's1', secret: 'sec1', profile })

describe('register', () => {
  it('持久化 sessionId/secret 到 profile 目录，并带上客户端版本', async () => {
    const seen: SeenCall[] = []
    stubPlatform({
      '/api/bridge/register': () => new Response(JSON.stringify({ sessionId: 'abc123', secret: 'xyz' })),
    }, seen)

    const s = await register('web', '0.8.6')
    expect(s).toEqual({ sessionId: 'abc123', secret: 'xyz', profile: 'web' })

    expect(seen[0]?.path).toBe('/api/bridge/register')
    expect(seen[0]?.body).toMatchObject({ profile: 'web', version: '0.8.6' })

    const saved = JSON.parse(readFileSync(join(profileRoot(), '.dshhub-bridge.json'), 'utf8'))
    expect(saved).toEqual({ sessionId: 'abc123', secret: 'xyz', profile: 'web' })
  })

  it('平台非 200 时抛错（调用方静默重试）', async () => {
    stubPlatform({
      '/api/bridge/register': () => new Response(JSON.stringify({ error: 'SQL 未部署' }), { status: 500 }),
    }, [])
    await expect(register('web', '0.8.6')).rejects.toThrow('register HTTP 500')
  })
})

describe('pollOnce', () => {
  it('无任务时返回 ok 且不触发任何执行', async () => {
    const seen: SeenCall[] = []
    stubPlatform({ '/api/bridge/poll': () => new Response(JSON.stringify({ task: null })) }, seen)
    expect(await pollOnce(state('web'))).toBe('ok')
    expect(seen).toHaveLength(1)
    expect(mockedUpload).not.toHaveBeenCalled()
  })

  it('凭据失效（403）返回 rejected 以便上层重新注册', async () => {
    stubPlatform({ '/api/bridge/poll': () => new Response(JSON.stringify({ error: 'bad credentials' }), { status: 403 }) }, [])
    expect(await pollOnce(state('web'))).toBe('rejected')
  })

  it('scan 任务：扫描本机 presets/skills 并以 done 回传', async () => {
    makePreset('my-mode')
    makeSkill('my-skill')
    const seen: SeenCall[] = []
    stubPlatform({
      '/api/bridge/poll': () => new Response(JSON.stringify({
        task: { taskId: 't1', type: 'scan', payload: {} },
      })),
      '/api/bridge/report': () => new Response(JSON.stringify({ ok: true })),
    }, seen)

    expect(await pollOnce(state('web'))).toBe('ok')

    const report = seen.find((c) => c.path === '/api/bridge/report')
    expect(report?.body).toMatchObject({ sessionId: 's1', secret: 'sec1', taskId: 't1', status: 'done' })
    const result = (report?.body as { result: { presets: Array<{ kind: string; name: string }>; skills: Array<{ kind: string; name: string }> } }).result
    expect(result.presets).toHaveLength(1)
    expect(result.presets[0]).toMatchObject({ kind: 'preset', name: 'my-mode' })
    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]).toMatchObject({ kind: 'skill', name: 'my-skill' })
    expect(mockedUpload).not.toHaveBeenCalled()
  })

  it('upload 任务：把 payload 交给 publishUpload，成功结果以 done 回传', async () => {
    const payload = {
      items: [{ kind: 'preset', name: 'my-mode' }],
      token: 'tok',
      accountId: 'acc',
      authorName: 'author',
      demoUrl: 'https://demo',
    }
    const seen: SeenCall[] = []
    stubPlatform({
      '/api/bridge/poll': () => new Response(JSON.stringify({ task: { taskId: 't2', type: 'upload', payload } })),
      '/api/bridge/report': () => new Response(JSON.stringify({ ok: true })),
    }, seen)

    expect(await pollOnce(state('web'))).toBe('ok')
    expect(mockedUpload).toHaveBeenCalledTimes(1)
    expect(mockedUpload.mock.calls[0]?.[0]).toEqual(payload)
    expect(mockedUpload.mock.calls[0]?.[1]).toBe('web')

    const report = seen.find((c) => c.path === '/api/bridge/report')
    expect(report?.body).toMatchObject({ taskId: 't2', status: 'done' })
  })

  it('upload 执行抛错时以 failed 回传错误信息', async () => {
    mockedUpload.mockRejectedValueOnce(new Error('boom'))
    const seen: SeenCall[] = []
    stubPlatform({
      '/api/bridge/poll': () => new Response(JSON.stringify({
        task: { taskId: 't3', type: 'upload', payload: { items: [] } },
      })),
      '/api/bridge/report': () => new Response(JSON.stringify({ ok: true })),
    }, seen)

    expect(await pollOnce(state('web'))).toBe('ok')
    const report = seen.find((c) => c.path === '/api/bridge/report')
    expect(report?.body).toMatchObject({ taskId: 't3', status: 'failed', result: { error: 'boom' } })
  })

  it('publishUpload 返回 ok:false 时以 failed 回传其错误', async () => {
    mockedUpload.mockResolvedValueOnce({ ok: false, error: '该版本已存在' })
    const seen: SeenCall[] = []
    stubPlatform({
      '/api/bridge/poll': () => new Response(JSON.stringify({
        task: { taskId: 't4', type: 'upload', payload: { items: [] } },
      })),
      '/api/bridge/report': () => new Response(JSON.stringify({ ok: true })),
    }, seen)

    expect(await pollOnce(state('web'))).toBe('ok')
    const report = seen.find((c) => c.path === '/api/bridge/report')
    expect(report?.body).toMatchObject({ taskId: 't4', status: 'failed', result: { ok: false, error: '该版本已存在' } })
  })

  it('未知任务类型也回传 failed 而非卡死', async () => {
    const seen: SeenCall[] = []
    stubPlatform({
      '/api/bridge/poll': () => new Response(JSON.stringify({
        task: { taskId: 't5', type: 'explode', payload: {} },
      })),
      '/api/bridge/report': () => new Response(JSON.stringify({ ok: true })),
    }, seen)

    expect(await pollOnce(state('web'))).toBe('ok')
    const report = seen.find((c) => c.path === '/api/bridge/report')
    expect(report?.body).toMatchObject({ taskId: 't5', status: 'failed', result: { error: expect.stringContaining('未知任务类型') } })
  })
})
