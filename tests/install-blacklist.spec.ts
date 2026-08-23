/**
 * 下架拦截的 HTTP 契约测试：安装/更新路由在黑名单命中时拒绝，黑名单
 * 拉取失败时 fail-open（不阻断安装）。复用 routes.spec.ts 的 stub-host
 * mount 模式：不建 socket、不跑 pnpm——registry 与黑名单都由 stub 的全局
 * fetch 提供，命中即验 409，未命中（fail-open）验证请求越过黑名单关卡。
 *
 * 关卡顺序（src/routes.ts）：install = 条目解析 → isBlacklisted → skill/
 * preset 分支 → paid → 下载；update = 已安装 spec → 本地路径 → blacklistHasName。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mountMarketRoutes, type MarketHost } from '../src/routes.ts'
import { forgetBlacklist } from '../src/blacklist.ts'
import { forgetCatalog } from '../src/registry.ts'
import type { PluginCommandRuntime } from '../src/dsh-cli.ts'

type RouteHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>

const ORIGIN = 'http://127.0.0.1:3080'
const HOST = '127.0.0.1:3080'

const OK_RESULT = { exitCode: 0, timedOut: false, stdout: '', stderr: '', cancelled: false }

// --- harness（routes.spec.ts 同款 stub host） ----------------------------------

function mount(commandRuntime?: PluginCommandRuntime): { routes: Map<string, RouteHandler> } {
  const routes = new Map<string, RouteHandler>()
  const host: MarketHost = {
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => { routes.delete(route.path) }
      },
    },
    loader: { entries: () => [] },
    plugin: () => ({ await: async () => undefined, dispose: async () => undefined }),
  }
  mountMarketRoutes(host, { profile: 'web' }, commandRuntime)
  return { routes }
}

/** runPlugin 立即成功：fail-open 对照测试在越过黑名单关卡后不用真跑 pnpm。 */
const fakeRuntime: PluginCommandRuntime = {
  runPlugin: async () => OK_RESULT,
  probePnpm: async () => ({ available: true }),
  provisionPnpm: async () => ({ ok: true }),
  cancelActive: () => true,
}

interface Captured { status: number; body: string; json(): unknown }

function makeResponse(): { response: ServerResponse; captured: () => Captured } {
  let status = 0
  let body = ''
  const response = {
    writeHead(s: number): unknown {
      status = s
      return response
    },
    end(chunk?: unknown): void {
      if (typeof chunk === 'string') body = chunk
    },
  }
  return {
    response: response as unknown as ServerResponse,
    captured: () => ({
      status,
      body,
      json: () => (body === '' ? undefined : JSON.parse(body) as unknown),
    }),
  }
}

function makeRequest(url: string, body: unknown): IncomingMessage {
  const chunks = [Buffer.from(JSON.stringify(body))]
  const request = {
    method: 'POST',
    url,
    headers: { origin: ORIGIN, host: HOST },
    [Symbol.asyncIterator]() {
      let i = 0
      return {
        next: async (): Promise<IteratorResult<Buffer>> =>
          i < chunks.length ? { done: false, value: chunks[i++]! } : { done: true, value: undefined },
      }
    },
  } as unknown as IncomingMessage
  return request
}

async function hit(routes: Map<string, RouteHandler>, path: string, body: unknown): Promise<Captured> {
  const handler = routes.get(path)
  if (handler === undefined) throw new Error(`route not mounted: ${path}`)
  const { response, captured } = makeResponse()
  await handler(makeRequest(path, body), response)
  return captured()
}

// --- fixtures ----------------------------------------------------------------

const UUID_A = '3f2c1e8a-0000-4b2a-9c8d-000000000001'
const UUID_B = '3f2c1e8a-0000-4b2a-9c8d-000000000002'
const BASE = {
  owner: 'dshhub',
  category: 'tools',
  description: { en: '', zh: '' },
  install: '',
  added: '2026-01-01',
}
const REGISTRY = {
  updated: '2026-08-01',
  count: 3,
  categories: {},
  plugins: [
    { ...BASE, name: 'plain-plugin', url: 'https://github.com/dshhub/plain-plugin', dshhubId: UUID_A },
    // zip 条目不带 dshhubId：命中靠 zip URL 提取 uuid（黑名单匹配键 2）
    { ...BASE, name: 'zip-plugin', url: `https://www.dshhub.co/api/download/${UUID_B}`, zip: `https://www.dshhub.co/api/download/${UUID_B}` },
    // 付费条目：fail-open 测试用它验证请求越过了黑名单关卡（黑名单在
    // paid 检查之前，命中 → 409；拉取失败 → 继续走到 paid → 402）
    { ...BASE, name: 'paid-plugin', url: 'https://github.com/dshhub/paid-plugin', paid: true },
  ],
}

/** marketFetch 无代理时走全局 fetch：按 URL 分发黑名单与 registry。 */
function stubFetch(blacklist: unknown[], blacklistFails = false): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes('/api/blacklist')) {
      if (blacklistFails) throw new TypeError('network down')
      return new Response(JSON.stringify(blacklist), { status: 200 })
    }
    return new Response(JSON.stringify(REGISTRY), { status: 200 })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const blacklisted = (id: string, name: string) => [
  { id, manifest_id: `com.dshhub.${name}`, name, reason: '违反平台规则', removed_at: '2026-08-20T10:00:00Z' },
]

let tmp: string
let dir: string
let routes: Map<string, RouteHandler>

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dshm-blacklist-'))
  process.env.DSH_HOME = tmp
  dir = join(tmp, 'profiles', 'web')
  mkdirSync(dir, { recursive: true })
  routes = mount().routes
  forgetBlacklist()
  forgetCatalog()
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.DSH_HOME
  rmSync(tmp, { recursive: true, force: true })
})

describe('/dsh-market/install 黑名单拦截', () => {
  it('registry 条目 dshhubId 命中黑名单 → 409 已下架', async () => {
    stubFetch(blacklisted(UUID_A, 'plain-plugin'))
    const res = await hit(routes, '/dsh-market/install', { url: 'https://github.com/dshhub/plain-plugin' })
    expect(res.status).toBe(409)
    expect((res.json() as { error: string }).error).toContain('该插件已被平台下架')
  })

  it('zip 条目按 zip URL 提取 uuid 命中 → 409（无 dshhubId 的旧条目）', async () => {
    stubFetch(blacklisted(UUID_B, 'zip-plugin'))
    const res = await hit(routes, '/dsh-market/install', { url: `https://www.dshhub.co/api/download/${UUID_B}` })
    expect(res.status).toBe(409)
    expect((res.json() as { error: string }).error).toContain('该插件已被平台下架')
  })

  it('黑名单拉取失败 fail-open：请求越过黑名单关卡继续执行', async () => {
    stubFetch([], true)
    const res = await hit(routes, '/dsh-market/install', { url: 'https://github.com/dshhub/paid-plugin' })
    // 不是 409（黑名单关卡放行），而是走到了 paid 检查之后的 402——
    // 证明拉取失败没有误伤安装流程。
    expect(res.status).toBe(402)
    expect((res.json() as { error: string }).error).toContain('付费插件')
  })

  it('对照：黑名单可用且命中时，同样的付费条目在 paid 检查前被 409 拦截', async () => {
    stubFetch(blacklisted(UUID_A, 'paid-plugin'))
    const res = await hit(routes, '/dsh-market/install', { url: 'https://github.com/dshhub/paid-plugin' })
    expect(res.status).toBe(409)
  })
})

describe('/dsh-market/update 黑名单拦截', () => {
  it('已安装包名命中黑名单 → 409 无法更新', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'bad-plugin': '1.2.3' } }))
    stubFetch(blacklisted(UUID_A, 'bad-plugin'))
    const res = await hit(routes, '/dsh-market/update', { name: 'bad-plugin' })
    expect(res.status).toBe(409)
    expect((res.json() as { error: string }).error).toContain('无法更新')
  })

  it('未命中黑名单的已安装包 → 请求越过黑名单关卡（非 409）', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'good-plugin': '1.2.3' } }))
    stubFetch(blacklisted(UUID_A, 'bad-plugin'))
    const res = await hit(mount(fakeRuntime).routes, '/dsh-market/update', { name: 'good-plugin' })
    // 不是 409：请求越过了黑名单关卡进入更新流程。fake runPlugin 不模拟
    // 磁盘效果，后续校验报 502（nothing installable）是预期产物——409 才是
    // 下架拒绝，其余任何结果都证明关卡已放行。
    expect(res.status).not.toBe(409)
  })
})
