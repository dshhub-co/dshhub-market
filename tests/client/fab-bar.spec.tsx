// @vitest-environment jsdom
/**
 * FabBar（单行轻量胶囊：商城 + 快捷部署）组件测试。验证：
 *  - 两个入口图标在同一胶囊内渲染（购物车 + 火箭）
 *  - 点购物车 → 内嵌市场面板（MarketSection 挂载）
 *  - 点火箭 → 快捷部署弹窗（DeployPanel）
 *  - 关闭弹窗后胶囊仍在（可再次打开）
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FabBar } from '../../src/client/FabBar.tsx'
import { en } from '../../src/client/locales.ts'

const t = (key: string) => (en as Record<string, string>)[key] ?? key

function stubFetch(overrides: Record<string, unknown> = {}) {
  const mock = vi.fn((input: unknown, init?: RequestInit) => {
    const path = String(input).split('?')[0]
    const payload =
      path === '/dsh-market/registry' ? { bundles: [], entries: [], groups: [] }
      : path === '/dsh-market/installed' ? { installed: {} }
      : path === '/dsh-market/updates' ? { updates: [] }
      : path === '/dsh-market/toggle' ? { ok: true }
      : path === '/dsh-market/groups' ? { groups: [] }
      : path === '/dsh-market/blacklist' ? { blacklist: [] }
      : path === '/dsh-market/unlocked' ? { bundles: [] }
      : path === '/dsh-market/apps/status' ? { apps: {} }
      : null
    const merged = overrides[path] ?? payload
    if (merged === null) return Promise.reject(new Error(`unstubbed fetch: ${String(input)}`))
    return Promise.resolve(new Response(JSON.stringify(merged), { status: 200 }))
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

// useSyncExternalStore 要求 getSnapshot 返回稳定引用（每次新对象会无限重渲染）
const LOCALE_SNAP = { active: 'en' }
const locale = {
  register: vi.fn(),
  bind: () => t,
  subscribe: () => () => {},
  getSnapshot: () => LOCALE_SNAP,
}
const market = {
  locale,
  theme: { getTheme: () => null, setTheme: vi.fn() },
  themeStore: { subscribe: () => () => {}, getSnapshot: () => null },
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('FabBar', () => {
  it('renders both entry icons inside one capsule', () => {
    stubFetch()
    render(<FabBar t={t} market={market} />)
    // 购物车（插件市场）与火箭（快捷部署）两个按钮都在
    const shop = screen.getByRole('button', { name: en.fabTitle })
    const deploy = screen.getByRole('button', { name: en.deployFabTitle })
    expect(shop).toBeTruthy()
    expect(deploy).toBeTruthy()
    // 同一胶囊容器（兄弟关系）：两个按钮紧邻，中间是发丝分割线
    expect(shop.parentElement).toBe(deploy.parentElement)
  })

  it('opens the market panel on cart click', async () => {
    stubFetch()
    render(<FabBar t={t} market={market} />)
    fireEvent.click(screen.getByRole('button', { name: en.fabTitle }))
    await waitFor(() => expect(screen.getByText(en.fabModalTitle)).toBeTruthy())
  })

  it('opens the deploy panel on rocket click', async () => {
    stubFetch({
      '/dsh-market/unlocked': { bundles: [{ id: 'b1', bundleId: 'b1', name: 'Demo', description: '', teachingLinks: '', originalAuthors: '', sellerNote: '', tutorialVideo: '', gettingStarted: '', faq: '', supportHours: '', updateNote: '', contact: '', creatorName: '', bundleUpdatedAt: '', redeemedAt: '', items: [{ type: 'github', pluginId: 'com.overlaykit.app', url: 'https://www.dshhub.co/zip/overlay-kit-1.0.1.zip', name: 'overlay-kit', kind: 'app', description: '', removed: false, start: 'npm run preview', build: 'npm run build', port: 4173 }] }] },
    })
    render(<FabBar t={t} market={market} />)
    fireEvent.click(screen.getByRole('button', { name: en.deployFabTitle }))
    await waitFor(() => expect(screen.getByText(/overlay-kit/)).toBeTruthy())
    // 部署弹窗标题 + 条目状态
    expect(screen.getByText(en.deployNotInstalled)).toBeTruthy()
  })

  it('keeps the capsule after closing a panel, and switching works', async () => {
    stubFetch()
    render(<FabBar t={t} market={market} />)
    fireEvent.click(screen.getByRole('button', { name: en.deployFabTitle }))
    await waitFor(() => expect(screen.getByText(en.deployEmpty)).toBeTruthy())
    // 关闭部署弹窗（关闭按钮 aria-label = 关闭）
    fireEvent.click(screen.getByRole('button', { name: en.deployClose }))
    await waitFor(() => expect(screen.queryByText(en.deployEmpty)).toBeNull())
    // 胶囊还在，可打开市场
    fireEvent.click(screen.getByRole('button', { name: en.fabTitle }))
    await waitFor(() => expect(screen.getByText(en.fabModalTitle)).toBeTruthy())
  })
})
