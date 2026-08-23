/**
 * 举报/评分代理路由的 HTTP 契约测试（插件端入口）：
 *   POST /dsh-market/report  → 平台 /api/reports（匿名通道，限速在平台）
 *   POST /dsh-market/ratings → 平台 /api/ratings
 * 复用 install-blacklist.spec.ts 的 stub-host mount 模式，上游用全局
 * stub 的 fetch 模拟：验证字段名转换（camelCase → snake_case）、状态码
 * 与错误文案透传（400/404/429）、本地缺字段校验、非 POST 405。
 * 客户端本地不限速——防刷完全依赖平台（rating:plugin:{id}:{ip} 3/天）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mountMarketRoutes, type MarketHost } from '../src/routes.ts'
import { forgetBlacklist } from '../src/blacklist.ts'

type RouteHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>

const ORIGIN = 'http://127.0.0.1:3080'
const HOST = '127.0.0.1:3080'
const PLUGIN_ID = '3f2c1e8a-0000-4b2a-9c8d-000000000001'

// --- harness（install-blacklist.spec.ts 同款 stub host） -----------------------

function mount(): Map<string, RouteHandler> {
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
  mountMarketRoutes(host, { profile: 'web' })
  return routes
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

function makeRequest(method: string, url: string, body?: unknown): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const request = {
    method,
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
  await handler(makeRequest('POST', path, body), response)
  return captured()
}

// --- 上游 stub ----------------------------------------------------------------

interface Forwarded { url: string; method: string; body: Record<string, unknown> | null }

/** 记录转发请求；响应按用例注入。 */
function stubUpstream(respond: { status: number; body: unknown }): { fn: ReturnType<typeof vi.fn>; forwarded: () => Forwarded[] } {
  const forwarded: Forwarded[] = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    forwarded.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null,
    })
    return new Response(JSON.stringify(respond.body), { status: respond.status })
  })
  vi.stubGlobal('fetch', fn)
  return { fn, forwarded: () => forwarded }
}

let routes: Map<string, RouteHandler>

beforeEach(() => {
  routes = mount()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('/dsh-market/blacklist（浏览器端黑名单代理）', () => {
  beforeEach(() => forgetBlacklist())

  it('返回服务端拉取的黑名单条目（浏览器不直连平台，避开 undici）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { id: PLUGIN_ID, manifest_id: 'com.dshhub.bad', name: 'bad-plugin', reason: '违反平台规则', removed_at: '2026-08-20T10:00:00Z' },
    ]), { status: 200 })))
    const res = await hit(routes, '/dsh-market/blacklist', {})
    expect(res.status).toBe(200)
    const body = res.json() as { entries: { id: string }[] }
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0]!.id).toBe(PLUGIN_ID)
  })

  it('上游失败时返回空条目列表（fail-open）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    const res = await hit(routes, '/dsh-market/blacklist', {})
    expect(res.status).toBe(200)
    expect((res.json() as { entries: unknown[] }).entries).toEqual([])
  })
})

describe('/dsh-market/report（举报代理）', () => {
  it('转发字段转换（pluginId→plugin_id）并透传成功', async () => {
    const { forwarded } = stubUpstream({ status: 200, body: { ok: true } })
    const res = await hit(routes, '/dsh-market/report', {
      pluginId: PLUGIN_ID,
      category: 'infringement',
      description: '这个插件抄袭了知名开源项目，证据充分。',
      contact: 'wx: test',
    })
    expect(res.status).toBe(200)
    expect((res.json() as { ok: boolean }).ok).toBe(true)
    expect(forwarded()).toHaveLength(1)
    expect(forwarded()[0]!.url).toContain('/api/reports')
    expect(forwarded()[0]!.body).toEqual({
      plugin_id: PLUGIN_ID,
      category: 'infringement',
      description: '这个插件抄袭了知名开源项目，证据充分。',
      contact: 'wx: test',
    })
  })

  it('空联系方式转为 null 不上送', async () => {
    const { forwarded } = stubUpstream({ status: 200, body: { ok: true } })
    await hit(routes, '/dsh-market/report', {
      pluginId: PLUGIN_ID,
      category: 'other',
      description: '这个插件存在严重的问题，需要平台介入。',
    })
    expect(forwarded()[0]!.body!.contact).toBeNull()
  })

  it('平台 429 限速原样透传（含中文文案）', async () => {
    const { forwarded } = stubUpstream({ status: 429, body: { error: '提交过于频繁，请稍后再试' } })
    const res = await hit(routes, '/dsh-market/report', {
      pluginId: PLUGIN_ID,
      category: 'other',
      description: '这个插件存在严重的问题，需要平台介入。',
    })
    expect(res.status).toBe(429)
    expect((res.json() as { error: string }).error).toBe('提交过于频繁，请稍后再试')
    expect(forwarded()).toHaveLength(1)
  })

  it('平台 400（描述过短）原样透传', async () => {
    stubUpstream({ status: 400, body: { error: '请填写至少 10 字的举报描述' } })
    const res = await hit(routes, '/dsh-market/report', {
      pluginId: PLUGIN_ID,
      category: 'other',
      description: '太短了',
    })
    expect(res.status).toBe(400)
    expect((res.json() as { error: string }).error).toBe('请填写至少 10 字的举报描述')
  })

  it('缺必填字段 → 400，不请求上游', async () => {
    const { fn } = stubUpstream({ status: 200, body: { ok: true } })
    const res = await hit(routes, '/dsh-market/report', { pluginId: PLUGIN_ID, category: '' })
    expect(res.status).toBe(400)
    expect(fn).not.toHaveBeenCalled()
  })

  it('非 POST → 405', async () => {
    stubUpstream({ status: 200, body: { ok: true } })
    const handler = routes.get('/dsh-market/report')!
    const { response, captured } = makeResponse()
    await handler(makeRequest('GET', '/dsh-market/report'), response)
    expect(captured().status).toBe(405)
  })
})

describe('/dsh-market/ratings（评分代理）', () => {
  it('转发字段转换（pluginId→plugin_id, score 原样）并透传成功', async () => {
    const { forwarded } = stubUpstream({ status: 200, body: { ok: true } })
    const res = await hit(routes, '/dsh-market/ratings', {
      pluginId: PLUGIN_ID,
      score: 5,
      comment: '好用，推荐！',
    })
    expect(res.status).toBe(200)
    expect((res.json() as { ok: boolean }).ok).toBe(true)
    expect(forwarded()).toHaveLength(1)
    expect(forwarded()[0]!.url).toContain('/api/ratings')
    expect(forwarded()[0]!.body).toEqual({
      plugin_id: PLUGIN_ID,
      score: 5,
      comment: '好用，推荐！',
    })
  })

  it('本地校验分数（1-5 整数）→ 400，不请求上游', async () => {
    const { fn } = stubUpstream({ status: 200, body: { ok: true } })
    const res = await hit(routes, '/dsh-market/ratings', { pluginId: PLUGIN_ID, score: 7 })
    expect(res.status).toBe(400)
    expect(fn).not.toHaveBeenCalled()
  })

  it('平台 429（每插件每天 3 次）原样透传', async () => {
    stubUpstream({ status: 429, body: { error: '提交过于频繁，请稍后再试' } })
    const res = await hit(routes, '/dsh-market/ratings', { pluginId: PLUGIN_ID, score: 4 })
    expect(res.status).toBe(429)
  })

  it('平台 404（插件不存在）原样透传', async () => {
    stubUpstream({ status: 404, body: { error: '插件不存在' } })
    const res = await hit(routes, '/dsh-market/ratings', { pluginId: PLUGIN_ID, score: 3 })
    expect(res.status).toBe(404)
    expect((res.json() as { error: string }).error).toBe('插件不存在')
  })
})
