/**
 * 平台黑名单模块（src/blacklist.ts）单测：解析、失败降级（fail-open）、
 * 60s 缓存 TTL、三种匹配键（dshhubId / zip URL 提取的 uuid / 包名兜底）。
 * 黑名单是增强防御：拉取失败必须返回空列表而不抛，否则网络抖动会误伤
 * 正常安装——主防线是平台下载 404 与 registry 不再返回条目。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  blacklistHas, blacklistHasName, dshhubIdFromZip, fetchBlacklist, forgetBlacklist, isBlacklisted,
} from '../src/blacklist.ts'

const ENTRY = {
  id: '3f2c1e8a-0000-4b2a-9c8d-000000000001',
  manifest_id: 'com.dshhub.badplugin',
  name: 'bad-plugin',
  reason: '违反平台规则',
  removed_at: '2026-08-20T10:00:00Z',
}

/** 让 marketFetch 走全局 fetch（无代理时即此路径），返回固定 JSON。 */
function stubFetch(json: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify(json), { status: 200 }))
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => forgetBlacklist())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('fetchBlacklist', () => {
  it('解析平台返回的条目列表', async () => {
    stubFetch([ENTRY])
    await expect(fetchBlacklist()).resolves.toEqual([ENTRY])
  })

  it('非数组响应视为空列表（不抛）', async () => {
    stubFetch({ not: 'a list' })
    await expect(fetchBlacklist()).resolves.toEqual([])
  })

  it('网络失败降级为空列表（fail-open，不抛）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    await expect(fetchBlacklist()).resolves.toEqual([])
  })

  it('HTTP 错误降级为空列表', async () => {
    stubFetch([ENTRY]).mockImplementation(async () => new Response('boom', { status: 500 }))
    await expect(fetchBlacklist()).resolves.toEqual([])
  })

  it('TTL 内命中缓存，不再发请求', async () => {
    const fn = stubFetch([ENTRY])
    await fetchBlacklist()
    await fetchBlacklist()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('force=true 绕过 TTL 强制重新拉取', async () => {
    const fn = stubFetch([ENTRY])
    await fetchBlacklist()
    await fetchBlacklist(true)
    await fetchBlacklist(true)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('TTL 过期后重新拉取；拉取失败时回落旧缓存', async () => {
    vi.useFakeTimers()
    const fn = stubFetch([ENTRY])
    await fetchBlacklist()
    vi.advanceTimersByTime(60_001)
    fn.mockImplementation(async () => { throw new TypeError('network down') })
    await expect(fetchBlacklist()).resolves.toEqual([ENTRY]) // 旧缓存
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('isBlacklisted 匹配键', () => {
  it('dshhubId 直接命中', async () => {
    stubFetch([ENTRY])
    await expect(isBlacklisted({ dshhubId: ENTRY.id })).resolves.toBe(true)
  })

  it('zip URL 提取的 uuid 命中（无 dshhubId 的旧条目）', async () => {
    stubFetch([ENTRY])
    await expect(isBlacklisted({
      zip: `https://www.dshhub.co/api/download/${ENTRY.id}`,
    })).resolves.toBe(true)
  })

  it('无 id/zip 时按包名兜底（大小写不敏感）', async () => {
    stubFetch([ENTRY])
    await expect(isBlacklisted({ name: 'Bad-Plugin' })).resolves.toBe(true)
  })

  it('未命中返回 false', async () => {
    stubFetch([ENTRY])
    await expect(isBlacklisted({ dshhubId: '11111111-2222-3333-4444-555555555555' })).resolves.toBe(false)
    await expect(isBlacklisted({ name: 'good-plugin' })).resolves.toBe(false)
  })
})

describe('blacklistHasName（update 按包名工作）', () => {
  it('命中返回 true，未命中 false', async () => {
    stubFetch([ENTRY])
    await expect(blacklistHasName('bad-plugin')).resolves.toBe(true)
    await expect(blacklistHasName('good-plugin')).resolves.toBe(false)
  })

  it('拉取失败时返回 false（fail-open，不阻断更新）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    await expect(blacklistHasName('bad-plugin')).resolves.toBe(false)
  })
})

describe('blacklistHas（同步判断，解锁卡「已下架」状态实时校准用）', () => {
  it('命中 dshhubId', () => {
    expect(blacklistHas([ENTRY], { dshhubId: ENTRY.id })).toBe(true)
  })

  it('命中 zip URL 提取的 uuid', () => {
    expect(blacklistHas([ENTRY], {
      zip: `https://www.dshhub.co/api/download/${ENTRY.id}`,
    })).toBe(true)
  })

  it('包名兜底命中（大小写不敏感）', () => {
    expect(blacklistHas([ENTRY], { name: 'Bad-Plugin' })).toBe(true)
  })

  it('未命中 / 空列表（fail-open）/ 空字段均 false', () => {
    expect(blacklistHas([ENTRY], { dshhubId: '11111111-2222-3333-4444-555555555555' })).toBe(false)
    expect(blacklistHas([], { dshhubId: ENTRY.id })).toBe(false)
    expect(blacklistHas([ENTRY], {})).toBe(false)
    expect(blacklistHas([ENTRY], { dshhubId: null, zip: null, name: null })).toBe(false)
  })
})

describe('dshhubIdFromZip', () => {
  it('提取 /api/download/<uuid> 中的 uuid', () => {
    expect(dshhubIdFromZip(`https://www.dshhub.co/api/download/${ENTRY.id}`)).toBe(ENTRY.id)
  })

  it('非下载 URL / 空值返回 null', () => {
    expect(dshhubIdFromZip('https://github.com/o/r')).toBeNull()
    expect(dshhubIdFromZip(undefined)).toBeNull()
    expect(dshhubIdFromZip(null)).toBeNull()
    expect(dshhubIdFromZip('')).toBeNull()
  })
})
