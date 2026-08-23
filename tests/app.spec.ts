/**
 * Deployable apps (manifest v2, kind=app): zip install into <dsh-home>/apps/,
 * runtime deploy/stop on 127.0.0.1 random ports, and the HTTP route contract
 * (/dsh-market/install app branch + /dsh-market/apps/{deploy,stop,status}).
 *
 * Spawn tests run a REAL node child (process.execPath) so deploy/stop/liveness
 * exercise the actual process-group kill path — no pnpm, no sockets.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { zipSync } from 'fflate'
import { mountMarketRoutes, type MarketHost } from '../src/routes.ts'
import { forgetBlacklist } from '../src/blacklist.ts'
import { forgetCatalog } from '../src/registry.ts'
import {
  appSpecMap, appsRoot, installApp, isInstalledApp, readInstalledApps, uninstallApp,
} from '../src/app-install.ts'
import { appStatus, deployApp, listAppStatus, stopApp } from '../src/app-runtime.ts'
import type { PluginCommandRuntime } from '../src/dsh-cli.ts'

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dshm-app-'))
  process.env.DSH_HOME = home
  forgetBlacklist()
  forgetCatalog()
})
afterEach(async () => {
  // 测试里的真实子进程必须全部清掉，避免跨用例残留
  for (const [name, state] of Object.entries(listAppStatus())) {
    if (state.running) await stopApp(name).catch(() => {})
  }
  vi.unstubAllGlobals()
  delete process.env.DSH_HOME
  rmSync(home, { recursive: true, force: true })
})

function profileRoot(): string {
  return join(home, 'profiles', 'web')
}

function appRoot(name: string): string {
  return join(appsRoot(), name)
}

/** 一个能真实跑起来的 node 应用 zip：start 读 PORT 起 HTTP 服务。 */
function makeAppZip(overrides: Record<string, unknown> = {}): Uint8Array {
  const serverJs = [
    "const http = require('node:http')",
    "http.createServer((req, res) => { res.setHeader('content-type', 'text/plain'); res.end('app ok') })",
    ".listen(Number(process.env.PORT) || 3000, '127.0.0.1')",
  ].join('\n')
  const buildJs = [
    "const fs = require('node:fs')",
    "fs.appendFileSync('build-count.txt', 'x')",
  ].join('\n')
  return zipSync({
    'manifest.json': new TextEncoder().encode(JSON.stringify({
      manifestVersion: 2,
      id: 'com.dshhub.myapp',
      name: 'myapp',
      version: '1.0.0',
      kind: 'app',
      start: 'node server.js',
      build: 'node build.js',
      port: 8080,
      permissions: [],
      ...overrides,
    }, null, 2)),
    'package.json': new TextEncoder().encode(JSON.stringify({ name: 'myapp', version: '1.0.0' })),
    'server.js': new TextEncoder().encode(serverJs),
    'build.js': new TextEncoder().encode(buildJs),
  })
}

function stubZipFetch(bytes: Uint8Array): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    if (u.includes('/api/blacklist')) return new Response(JSON.stringify([]), { status: 200 })
    // loadRegistry 拒绝空目录：registry 必须至少一条（走 unlocked 兜底命中）
    if (u.includes('/api/registry')) return new Response(JSON.stringify({
      updated: '2026-08-01', count: 1, categories: {},
      plugins: [{ owner: 'dshhub', name: 'dummy', url: 'https://github.com/dshhub/dummy', category: 'tools', description: { en: '', zh: '' }, install: '' }],
    }), { status: 200 })
    return new Response(new Uint8Array(bytes), { status: 200 })
  }))
}

// ---- Part A: installApp（zip 拷贝安装 + 状态记录 + 校验） ----

describe('installApp', () => {
  const entry = {
    name: 'myapp',
    url: 'https://www.dshhub.co/entry',
    zip: 'https://www.dshhub.co/zip/myapp',
  } as never

  it('downloads, copies files into <dsh-home>/apps/<name>/, records state, and uninstalls exactly that dir', async () => {
    stubZipFetch(makeAppZip())
    const record = await installApp(entry)

    expect(record).toMatchObject({
      name: 'myapp',
      version: '1.0.0',
      start: 'node server.js',
      build: 'node build.js',
      port: 8080,
      url: 'https://www.dshhub.co/entry',
    })
    expect(readFileSync(join(appRoot('myapp'), 'server.js'), 'utf8')).toContain('createServer')
    expect(readFileSync(join(appRoot('myapp'), 'manifest.json'), 'utf8')).toContain('"kind": "app"')
    expect(existsSync(join(appRoot('myapp'), '.dshhub'))).toBe(false) // 状态目录在 apps 根，不在应用内
    expect(existsSync(join(appsRoot(), '.dshhub', 'myapp.json'))).toBe(true)
    expect(isInstalledApp('myapp')).toBe(true)
    expect(appSpecMap()).toEqual({ myapp: 'app:https://www.dshhub.co/entry' })
    expect(readInstalledApps().myapp).toMatchObject({ start: 'node server.js' })

    expect(uninstallApp('myapp')).toBe(true)
    expect(existsSync(appRoot('myapp'))).toBe(false)
    expect(existsSync(join(appsRoot(), '.dshhub', 'myapp.json'))).toBe(false)
    expect(isInstalledApp('myapp')).toBe(false)
  })

  it('rejects a zip whose kind is not app', async () => {
    stubZipFetch(makeAppZip({ kind: 'skill' }))
    await expect(installApp(entry)).rejects.toThrow(/不是可部署应用/)
  })

  it('rejects a zip without a start command', async () => {
    stubZipFetch(makeAppZip({ start: undefined }))
    await expect(installApp(entry)).rejects.toThrow(/缺少 start/)
  })

  it('keeps an integer port, normalizes an invalid one to null', async () => {
    stubZipFetch(makeAppZip({ port: 99999 }))
    expect((await installApp(entry)).port).toBeNull()
    await uninstallApp('myapp')
    stubZipFetch(makeAppZip({ port: '8080' }))
    expect((await installApp(entry)).port).toBeNull()
  })

  it('rejects a sha256 mismatch (audit-bound hash re-verification)', async () => {
    stubZipFetch(makeAppZip())
    await expect(
      installApp(entry, { expectedSha256: '0'.repeat(64) }),
    ).rejects.toThrow(/哈希不符/)
  })

  it('installs GitHub-style wrapper-dir zips (single top-level directory)', async () => {
    const bytes = zipSync({
      'myapp-main/manifest.json': new TextEncoder().encode(JSON.stringify({
        manifestVersion: 2, id: 'com.dshhub.myapp', name: 'myapp', version: '1.0.0', kind: 'app', start: 'node server.js',
      })),
      'myapp-main/server.js': new TextEncoder().encode('console.log("hi")'),
    })
    stubZipFetch(bytes)
    const record = await installApp(entry)
    expect(record.name).toBe('myapp')
    expect(readFileSync(join(appRoot('myapp'), 'server.js'), 'utf8')).toBe('console.log("hi")')
  })

  it('rejects unsafe paths (.. traversal) in the zip', async () => {
    const bytes = zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify({
        manifestVersion: 2, id: 'com.dshhub.myapp', name: 'myapp', version: '1.0.0', kind: 'app', start: 'node server.js',
      })),
      '../evil.txt': new TextEncoder().encode('boom'),
    })
    stubZipFetch(bytes)
    await expect(installApp(entry)).rejects.toThrow(/非法路径/)
  })

  it('refuses to uninstall while the app is running (runtime.json guard)', async () => {
    stubZipFetch(makeAppZip())
    await installApp(entry)
    mkdirSync(join(appsRoot(), '.dshhub'), { recursive: true })
    writeFileSync(join(appsRoot(), '.dshhub', 'runtime.json'), JSON.stringify({ myapp: { pid: 999999, port: 1 } }))
    expect(() => uninstallApp('myapp')).toThrow(/正在运行/)
    expect(existsSync(appRoot('myapp'))).toBe(true)
  })
})

// ---- Part B: app-runtime（真实 node 子进程的部署/停止/状态） ----

describe('app-runtime', () => {
  const entry = {
    name: 'myapp',
    url: 'https://www.dshhub.co/entry',
    zip: 'https://www.dshhub.co/zip/myapp',
  } as never

  it('deploys on a random 127.0.0.1 port, reports running, and stops cleanly', async () => {
    stubZipFetch(makeAppZip())
    await installApp(entry)

    const deployed = await deployApp('myapp')
    expect(deployed.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(deployed.port).toBeGreaterThanOrEqual(20_000)
    expect(deployed.built).toBe(true) // 首次部署执行了 build

    const state = appStatus('myapp')
    expect(state.running).toBe(true)
    expect(state.port).toBe(deployed.port)
    expect(state.url).toBe(deployed.url)

    const stopped = await stopApp('myapp')
    expect(stopped.stopped).toBe(true)
    // killTree 生效：进程组被杀，liveness 探测不再存活
    expect(appStatus('myapp').running).toBe(false)
    expect(stopApp('myapp')).resolves.toEqual({ stopped: false }) // 幂等
  })

  it('runs build only once per installed version (record.built flag)', async () => {
    stubZipFetch(makeAppZip())
    await installApp(entry)
    await deployApp('myapp')
    await stopApp('myapp')
    await deployApp('myapp')
    await stopApp('myapp')
    const marker = readFileSync(join(appRoot('myapp'), 'build-count.txt'), 'utf8')
    expect(marker).toBe('x') // 只构建了一次
  })

  it('refuses to deploy an app that is already running', async () => {
    stubZipFetch(makeAppZip())
    await installApp(entry)
    await deployApp('myapp')
    await expect(deployApp('myapp')).rejects.toThrow(/已在运行/)
  })

  it('refuses to deploy an app that is not installed', async () => {
    await expect(deployApp('ghost')).rejects.toThrow(/未安装/)
  })

  it('rejects deploy commands hitting the forbidden-pattern red line (defense in depth)', async () => {
    stubZipFetch(makeAppZip({ start: 'sudo node server.js' }))
    await installApp(entry)
    await expect(deployApp('myapp')).rejects.toThrow(/危险操作/)
  })

  it('reports a missing runtime with an actionable hint', async () => {
    stubZipFetch(makeAppZip({ start: 'definitely-not-a-runtime-xyz server.js' }))
    await installApp(entry)
    await expect(deployApp('myapp')).rejects.toThrow(/未检测到运行时/)
  })

  it('auto-cleans the runtime record when the app exits by itself', async () => {
    const bytes = zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify({
        manifestVersion: 2, id: 'com.dshhub.short', name: 'short', version: '1.0.0', kind: 'app', start: 'node exit.js',
      })),
      'exit.js': new TextEncoder().encode('setTimeout(() => process.exit(0), 150)'),
    })
    stubZipFetch(bytes)
    await installApp({ name: 'short', url: 'u', zip: 'z' } as never)
    await deployApp('short')
    expect(appStatus('short').running).toBe(true)
    // 等它自己退出 → 记录被 exit 处理器清理
    await new Promise((r) => setTimeout(r, 500))
    expect(appStatus('short').running).toBe(false)
    expect(appStatus('short').pid).toBeUndefined()
  })
})

// ---- Part C: HTTP 路由契约（stub host mount，复用 install-blacklist 的 harness） ----

type RouteHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>

const ORIGIN = 'http://127.0.0.1:3080'
const HOST = '127.0.0.1:3080'

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
  mountMarketRoutes(host, { profile: 'web' }, undefined as unknown as PluginCommandRuntime)
  return routes
}

function makeRequest(url: string, body: unknown, method = 'POST'): IncomingMessage {
  const chunks = [Buffer.from(JSON.stringify(body))]
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

async function hit(routes: Map<string, RouteHandler>, path: string, body: unknown, method = 'POST'): Promise<{ status: number; json(): unknown }> {
  const handler = routes.get(path)
  if (handler === undefined) throw new Error(`route not mounted: ${path}`)
  let status = 0
  let payload = ''
  const response = {
    writeHead(s: number): unknown { status = s; return response },
    end(chunk?: unknown): void { if (typeof chunk === 'string') payload = chunk },
  }
  await handler(makeRequest(path, body, method), response as unknown as ServerResponse)
  return { status, json: () => (payload === '' ? undefined : JSON.parse(payload) as unknown) }
}

/** 预写一条 kind=app 的解锁记录（install 路由从 unlocked.json 找本地条目）。 */
function seedUnlockedApp(zipUrl: string, opts: { sha256?: string } = {}): void {
  const dir = join(profileRoot(), '.dshhub-market')
  mkdirSync(dir, { recursive: true })
  const audit = opts.sha256 !== undefined
    ? { level: 'pass', summary: '未发现风险', sha256: opts.sha256 }
    : undefined
  writeFileSync(join(dir, 'unlocked.json'), JSON.stringify({
    profileKey: 'p1',
    bundles: [{
      id: 'b1', bundleId: 'pkg-1', name: '测试口令包', description: '', teachingLinks: '',
      originalAuthors: '', sellerNote: '', tutorialVideo: '', gettingStarted: '', faq: '',
      supportHours: '', updateNote: '', contact: '', creatorName: '', bundleUpdatedAt: '',
      redeemedAt: '2026-08-24T00:00:00Z',
      items: [{
        type: 'local', pluginId: 'p-1', name: 'myapp', kind: 'app', tier: 'utility',
        zip: zipUrl, start: 'node server.js', build: 'node build.js', port: 8080,
        audit,
      }],
    }],
  }))
}

describe('/dsh-market/install app 分支', () => {
  const ZIP = 'https://www.dshhub.co/api/download/p-1'

  it('installs an unlocked kind=app entry (audit sha re-verified), returns app + installed map', async () => {
    const bytes = makeAppZip()
    // 核销载荷携带的 sha256 必须与买家实际下载的字节一致——测试用真哈希
    seedUnlockedApp(ZIP, { sha256: createHash('sha256').update(bytes).digest('hex') })
    stubZipFetch(bytes)
    const routes = mount()

    const res = await hit(routes, '/dsh-market/install', { url: ZIP })
    expect(res.status).toBe(200)
    const body = res.json() as { ok: boolean; app: { name: string; start: string }; installed: Record<string, string> }
    expect(body.ok).toBe(true)
    expect(body.app).toMatchObject({ name: 'myapp', start: 'node server.js' })
    // 路由把解锁条目归一成平台规范 url（/plugin/unknown），spec 以它为背书
    expect(body.installed.myapp).toBe(`app:${process.env.DSHHUB_API_URL ?? 'https://www.dshhub.co'}/plugin/unknown`)
    expect(isInstalledApp('myapp')).toBe(true)
  })

  it('fails the install when the downloaded zip is not kind=app', async () => {
    // 无 sha256 的旧解锁记录：跳过哈希比对，由 kind 校验兜底拒绝
    seedUnlockedApp(ZIP)
    stubZipFetch(makeAppZip({ kind: 'plugin' }))
    const routes = mount()
    const res = await hit(routes, '/dsh-market/install', { url: ZIP })
    expect(res.status).toBe(502)
    expect((res.json() as { error: string }).error).toContain('不是可部署应用')
  })

  it('rejects install of a removed unlocked entry', async () => {
    const dir = join(profileRoot(), '.dshhub-market')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'unlocked.json'), JSON.stringify({
      profileKey: 'p1',
      bundles: [{
        id: 'b1', bundleId: 'pkg-1', name: '包', description: '', teachingLinks: '', originalAuthors: '',
        sellerNote: '', tutorialVideo: '', gettingStarted: '', faq: '', supportHours: '', updateNote: '',
        contact: '', creatorName: '', bundleUpdatedAt: '', redeemedAt: '2026-08-24T00:00:00Z',
        items: [{ type: 'local', pluginId: 'p-1', name: 'myapp', kind: 'app', zip: ZIP, removed: true, removedReason: '违规' }],
      }],
    }))
    stubZipFetch(makeAppZip())
    const routes = mount()
    const res = await hit(routes, '/dsh-market/install', { url: ZIP })
    expect(res.status).toBe(400)
    expect((res.json() as { error: string }).error).toContain('该条目已被平台下架')
  })

  it('reports the installed map with app: specs and kinds.app in /dsh-market/installed', async () => {
    stubZipFetch(makeAppZip())
    await installApp({ name: 'myapp', url: 'https://www.dshhub.co/entry', zip: ZIP } as never)
    const routes = mount()
    const res = await hit(routes, '/dsh-market/installed', {}, 'GET')
    expect(res.status).toBe(200)
    const body = res.json() as { installed: Record<string, string>; kinds: Record<string, string>; present: string[]; activation: Record<string, unknown> }
    expect(body.installed.myapp).toBe('app:https://www.dshhub.co/entry')
    expect(body.kinds.myapp).toBe('app')
    expect(body.present).toContain('myapp')
    expect(body.activation.myapp).toMatchObject({ state: 'inert' })
  })
})

describe('/dsh-market/apps/{deploy,stop,status}', () => {
  const ZIP = 'https://www.dshhub.co/api/download/p-1'

  it('deploys a real child over HTTP, status reports running, stop stops it', async () => {
    stubZipFetch(makeAppZip())
    await installApp({ name: 'myapp', url: 'https://www.dshhub.co/entry', zip: ZIP } as never)
    const routes = mount()

    const deploy = await hit(routes, '/dsh-market/apps/deploy', { name: 'myapp' })
    expect(deploy.status).toBe(200)
    const body = deploy.json() as { ok: boolean; url: string; port: number }
    expect(body.ok).toBe(true)
    expect(body.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

    const status = await hit(routes, '/dsh-market/apps/status', {}, 'GET')
    expect(status.status).toBe(200)
    const apps = (status.json() as { apps: Record<string, { running: boolean; port?: number }> }).apps
    expect(apps.myapp?.running).toBe(true)
    expect(apps.myapp?.port).toBe(body.port)

    const stop = await hit(routes, '/dsh-market/apps/stop', { name: 'myapp' })
    expect(stop.status).toBe(200)
    expect((stop.json() as { ok: boolean }).ok).toBe(true)
    const after = await hit(routes, '/dsh-market/apps/status', {}, 'GET')
    expect((after.json() as { apps: Record<string, { running: boolean }> }).apps.myapp?.running).toBe(false)
  })

  it('returns 502 with an actionable error when the app is not installed', async () => {
    const routes = mount()
    const res = await hit(routes, '/dsh-market/apps/deploy', { name: 'ghost' })
    expect(res.status).toBe(502)
    expect((res.json() as { error: string }).error).toContain('未安装')
  })

  it('returns 400 for a missing name and 405 for non-POST methods', async () => {
    const routes = mount()
    const bad = await hit(routes, '/dsh-market/apps/deploy', {})
    expect(bad.status).toBe(400)
    const method = await hit(routes, '/dsh-market/apps/deploy', {}, 'GET')
    expect(method.status).toBe(405)
  })
})
