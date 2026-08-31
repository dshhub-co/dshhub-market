// @vitest-environment jsdom
/**
 * FabBar（单行轻量胶囊：商城入口）组件测试。验证：
 *  - 购物车入口图标渲染
 *  - 点购物车 → 内嵌市场面板（MarketSection 挂载）
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
  it('renders the market entry icon inside one capsule', () => {
    stubFetch()
    render(<FabBar t={t} market={market} />)
    const shop = screen.getByRole('button', { name: en.fabTitle })
    expect(shop).toBeTruthy()
  })

  it('opens the market panel on cart click', async () => {
    stubFetch()
    render(<FabBar t={t} market={market} />)
    fireEvent.click(screen.getByRole('button', { name: en.fabTitle }))
    await waitFor(() => expect(screen.getByText(en.fabModalTitle)).toBeTruthy())
  })

  it('keeps the capsule after closing a panel', async () => {
    stubFetch()
    render(<FabBar t={t} market={market} />)
    fireEvent.click(screen.getByRole('button', { name: en.fabTitle }))
    await waitFor(() => expect(screen.getByText(en.fabModalTitle)).toBeTruthy())
    // 关闭市场弹窗（关闭按钮 aria-label = fabModalTitle）
    fireEvent.click(screen.getByRole('button', { name: en.fabModalTitle }))
    await waitFor(() => expect(screen.queryByText(en.fabModalTitle)).toBeNull())
    // 胶囊还在，可再次打开
    fireEvent.click(screen.getByRole('button', { name: en.fabTitle }))
    await waitFor(() => expect(screen.getByText(en.fabModalTitle)).toBeTruthy())
  })
})
