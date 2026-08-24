// @vitest-environment jsdom
/**
 * DeployFab（商城旁快捷部署入口）组件测试：stub 三个数据接口
 * （/dsh-market/unlocked、/dsh-market/installed、/dsh-market/apps/status）
 * 与三个动作接口（install、apps/deploy、apps/stop）。验证：
 *  - 打开弹窗展平已解锁 kind=app 条目，过滤已下架
 *  - 未安装 → 点「安装并部署」→ install 成功后自动 deploy
 *  - 已安装未运行 → 「部署」→ deploy 成功 → window.open 打开 + 状态翻运行中
 *  - 运行中 → 「打开」/「停止」
 *  - 空列表 → 空状态文案
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeployFab } from '../../src/client/DeployFab.tsx'
import { en } from '../../src/client/locales.ts'

const t = (key: string) => (en as Record<string, string>)[key] ?? key

interface Call { path: string; method: string; body: unknown }
let calls: Call[] = []
const openSpy = vi.fn()

/** kind=app 的解锁条目（overlay-kit 同款字段） */
function appItem(overrides: Record<string, unknown> = {}) {
  return {
    type: 'github',
    pluginId: 'com.overlaykit.app',
    url: 'https://www.dshhub.co/zip/overlay-kit-1.0.0.zip',
    name: 'overlay-kit',
    kind: 'app',
    description: 'browser-local transparent motion generator',
    removed: false,
    start: 'npm run preview',
    build: 'npm run build',
    port: 4173,
    ...overrides,
  }
}

function stubFetch(overrides: Record<string, unknown> = {}) {
  calls = []
  const mock = vi.fn((input: unknown, init?: RequestInit) => {
    const path = String(input).split('?')[0]
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ path, method, body })
    const payload =
      path === '/dsh-market/unlocked' ? { bundles: [] }
      : path === '/dsh-market/installed' ? { installed: {} }
      : path === '/dsh-market/apps/status' ? { apps: {} }
      : path === '/dsh-market/install' ? { ok: true, installed: { 'overlay-kit': '1.0.0' } }
      : path === '/dsh-market/apps/deploy' ? { ok: true, pid: 1234, port: 34567, url: 'http://127.0.0.1:34567', startedAt: 'now' }
      : path === '/dsh-market/apps/stop' ? { ok: true }
      : null
    const merged = overrides[path] ?? payload
    if (merged === null) return Promise.reject(new Error(`unstubbed fetch: ${String(input)}`))
    const result = typeof merged === 'function' ? (merged as () => unknown)() : merged
    return Promise.resolve(new Response(JSON.stringify(result), { status: 200 }))
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  openSpy.mockReset()
})

async function openFab() {
  const view = render(<DeployFab t={t} />)
  fireEvent.click(screen.getByRole('button', { name: en.deployFabTitle }))
  // 等弹窗打开且首轮 refresh 落定（loading 文案消失 = 列表或空态已渲染）
  await waitFor(() => expect(screen.queryByText(en.deployFabTitle)).not.toBeNull())
  await waitFor(() => expect(screen.queryByText(en.deployLoading)).toBeNull())
  return view
}

describe('DeployFab', () => {
  it('lists unlocked kind=app items and filters removed ones', async () => {
    stubFetch({
      '/dsh-market/unlocked': {
        bundles: [
          {
            id: 'b1', bundleId: 'bundle-1', name: 'Demo', description: '', teachingLinks: '',
            originalAuthors: '', sellerNote: '', tutorialVideo: '', gettingStarted: '', faq: '',
            supportHours: '', updateNote: '', contact: '', creatorName: '', bundleUpdatedAt: '',
            redeemedAt: '', items: [
              appItem(),
              appItem({ name: 'removed-app', removed: true }),
              { type: 'local', url: 'x', name: 'not-an-app', kind: 'theme' },
            ],
          },
        ],
      },
    })
    await openFab()
    expect(screen.getByText(/overlay-kit/)).toBeTruthy()
    // kind=app 徽章 + 「未安装」状态
    expect(screen.getByText(en.kindApp)).toBeTruthy()
    expect(screen.getByText(en.deployNotInstalled)).toBeTruthy()
    // 已下架的 app 不出现、非 app 条目不出现
    expect(screen.queryByText(/removed-app/)).toBeNull()
    expect(screen.queryByText(/not-an-app/)).toBeNull()
    // 空状态不显示
    expect(screen.queryByText(en.deployEmpty)).toBeNull()
  })

  it('shows the empty state when no app items are unlocked', async () => {
    stubFetch()
    await openFab()
    expect(screen.getByText(en.deployEmpty)).toBeTruthy()
  })

  it('installs then auto-deploys when the app is not installed', async () => {
    vi.stubGlobal('open', openSpy)
    stubFetch({
      '/dsh-market/unlocked': { bundles: [{ id: 'b1', bundleId: 'b1', name: 'Demo', description: '', teachingLinks: '', originalAuthors: '', sellerNote: '', tutorialVideo: '', gettingStarted: '', faq: '', supportHours: '', updateNote: '', contact: '', creatorName: '', bundleUpdatedAt: '', redeemedAt: '', items: [appItem()] }] },
    })
    await openFab()
    fireEvent.click(screen.getByText(en.deployInstallBtn))
    await waitFor(() => {
      const installs = calls.filter(c => c.path === '/dsh-market/install')
      expect(installs.length).toBe(1)
      expect(installs[0].body).toEqual({ url: 'https://www.dshhub.co/zip/overlay-kit-1.0.0.zip' })
    })
    // install 成功后自动 deploy + window.open
    await waitFor(() => {
      const deploys = calls.filter(c => c.path === '/dsh-market/apps/deploy')
      expect(deploys.length).toBe(1)
      expect(deploys[0].body).toEqual({ name: 'overlay-kit' })
    })
    // deploy 成功 → 浏览器新标签打开 + 状态翻运行中 → 「打开」按钮出现
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('http://127.0.0.1:34567', '_blank', 'noopener'))
    await waitFor(() => expect(screen.getByText(en.appOpen)).toBeTruthy())
  })

  it('deploys an installed but stopped app and opens the browser tab', async () => {
    vi.stubGlobal('open', openSpy)
    stubFetch({
      '/dsh-market/unlocked': { bundles: [{ id: 'b1', bundleId: 'b1', name: 'Demo', description: '', teachingLinks: '', originalAuthors: '', sellerNote: '', tutorialVideo: '', gettingStarted: '', faq: '', supportHours: '', updateNote: '', contact: '', creatorName: '', bundleUpdatedAt: '', redeemedAt: '', items: [appItem()] }] },
      '/dsh-market/installed': { installed: { 'overlay-kit': '1.0.0' } },
    })
    await openFab()
    expect(screen.getByText(en.deployInstalled)).toBeTruthy()
    fireEvent.click(screen.getByText(en.appDeploy))
    await waitFor(() => {
      const deploys = calls.filter(c => c.path === '/dsh-market/apps/deploy')
      expect(deploys.length).toBe(1)
      expect(deploys[0].body).toEqual({ name: 'overlay-kit' })
    })
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('http://127.0.0.1:34567', '_blank', 'noopener'))
    await waitFor(() => expect(screen.getByText(en.appOpen)).toBeTruthy())
  })

  it('offers stop/open while running and stops the process', async () => {
    vi.stubGlobal('open', openSpy)
    stubFetch({
      '/dsh-market/unlocked': { bundles: [{ id: 'b1', bundleId: 'b1', name: 'Demo', description: '', teachingLinks: '', originalAuthors: '', sellerNote: '', tutorialVideo: '', gettingStarted: '', faq: '', supportHours: '', updateNote: '', contact: '', creatorName: '', bundleUpdatedAt: '', redeemedAt: '', items: [appItem()] }] },
      '/dsh-market/installed': { installed: { 'overlay-kit': '1.0.0' } },
      '/dsh-market/apps/status': { apps: { 'overlay-kit': { running: true, pid: 1, port: 34567, url: 'http://127.0.0.1:34567', startedAt: 'now' } } },
    })
    await openFab()
    expect(screen.getByText(en.appRunning.replace('{0}', '34567'))).toBeTruthy()
    fireEvent.click(screen.getByText(en.appStop))
    await waitFor(() => {
      const stops = calls.filter(c => c.path === '/dsh-market/apps/stop')
      expect(stops.length).toBe(1)
      expect(stops[0].body).toEqual({ name: 'overlay-kit' })
    })
    // 停止后按钮回「部署」态
    await waitFor(() => expect(screen.getByText(en.appDeploy)).toBeTruthy())
  })
})
