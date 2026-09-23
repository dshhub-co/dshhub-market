/**
 * 桥接实例识别（2026-09-23 修复的回归测试）
 *
 * 背景：机器上可能有多个 DSH 实例共用一个 dshhub-market 桥接端口。
 * 曾经的判断只看品牌名 `bridge === 'dshhub-market'`，于是 e2e 测试残留的
 * 那个进程（DSH_HOME 指向临时目录）被当成「自己的桥接」复用，本实例一个
 * 端口都不绑 —— 发布页的「打开目录」报「目录不存在」，安装插件也会装进
 * 那个临时 home。这里锁死：不同 DSH_HOME 的桥接绝不复用。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { isSameInstance, probeBridge } from '../src/bridge.ts'

const servers: Server[] = []
const savedHome = process.env.DSH_HOME

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))))
  if (savedHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedHome
})

/** 设定本实例的 DSH_HOME（isSameInstance 以此为基准比较） */
function withHome(home: string): void {
  process.env.DSH_HOME = home
}

/** 起一个假桥接，返回它监听的端口 */
async function fakeBridge(health: Record<string, unknown>): Promise<number> {
  const s = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(health))
  })
  servers.push(s)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  return (s.address() as AddressInfo).port
}

describe('probeBridge', () => {
  it('健康的 dshhub-market 桥接返回自述信息', async () => {
    const port = await fakeBridge({ bridge: 'dshhub-market', profile: 'web', home: '/tmp/a' })
    const h = await probeBridge(port)
    expect(h?.bridge).toBe('dshhub-market')
    expect(h?.home).toBe('/tmp/a')
  })

  it('别的服务（品牌名不对）返回 null', async () => {
    const port = await fakeBridge({ bridge: 'something-else' })
    expect(await probeBridge(port)).toBeNull()
  })

  it('端口没人监听返回 null（不抛异常）', async () => {
    expect(await probeBridge(1)).toBeNull()
  })
})

describe('isSameInstance：跨实例复用是严禁的', () => {
  it('同一 DSH_HOME + 同一 profile → 复用（同一用户起两个 DSH 是正常的）', () => {
    withHome('/home/u/.dsh')
    expect(isSameInstance({ profile: 'web', home: '/home/u/.dsh' }, 'web')).toBe(true)
  })

  it('不同 DSH_HOME（测试残留进程）→ 绝不复用', () => {
    withHome('/home/u/.dsh')
    expect(
      isSameInstance({ profile: 'web', home: '/var/folders/x/T/dshm-e2e-home-abc' }, 'web'),
    ).toBe(false)
  })

  it('同一 home 但 profile 不同 → 不复用', () => {
    withHome('/home/u/.dsh')
    expect(isSameInstance({ profile: 'other', home: '/home/u/.dsh' }, 'web')).toBe(false)
  })

  it('同 home 的路径写法差异（尾斜杠 / .. 段）仍算同一个', () => {
    withHome('/home/u/.dsh')
    expect(isSameInstance({ profile: 'web', home: '/home/u/.dsh/' }, 'web')).toBe(true)
    expect(isSameInstance({ profile: 'web', home: '/home/u/x/../.dsh' }, 'web')).toBe(true)
  })

  it('老版本 /health 没有 home：沿用旧语义（同 profile 即复用），避免升级期互相抢端口', () => {
    withHome('/home/u/.dsh')
    expect(isSameInstance({ profile: 'web' }, 'web')).toBe(true)
    expect(isSameInstance({ profile: 'web', home: '' }, 'web')).toBe(true)
  })
})
