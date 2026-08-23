/**
 * Deployable app runtime (kind=app): picks a random free 127.0.0.1 port,
 * runs the manifest `build` once per installed version, spawns the `start`
 * command as a detached process group, and tracks liveness in
 * <apps-root>/.dshhub/runtime.json.
 *
 * Spawn discipline mirrors dsh-cli.ts (the market's first spawn point):
 * detached process group → killTree (SIGTERM → 5s SIGKILL; Windows
 * taskkill /T /F). Apps never run with elevated rights, never outside
 * their own <apps-root>/<name>/ directory, and only listen on 127.0.0.1.
 *
 * Security notes:
 *  - The `start`/`build` commands come from a platform AI-audited manifest
 *    (import-github runs the audit on the exact dist the buyer downloads).
 *    As defense in depth the command is re-checked here against the same
 *    forbidden-pattern list the platform rejects at import time — a tampered
 *    zip that slipped past the hash check would fail at deploy, not after.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { nodeBinDir, cmdCommandLine } from './dsh-cli.ts'
import { logEvent } from './log.ts'
import { appsRoot, readInstalledApps, runtimeStatePath, type InstalledApp } from './app-install.ts'

/** 与平台 lib/manifest.ts FORBIDDEN_CMD_PATTERNS 同步的部署命令红线（防御纵深：
 * 平台审核是主防线，这里兜住一切绕过哈希校验的意外）。 */
const FORBIDDEN_DEPLOY_PATTERNS: RegExp[] = [
  /\b(sudo|su)\s/,
  /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*)/,
  /\b(mkfs|fdisk|dd)\s/,
  /\b(shutdown|reboot|poweroff)\b/,
  /\bchmod\s+-R?\s*777\b/,
  /:\(\)\s*\{/,
  /\b(curl|wget|fetch|aria2c)\b[^|;&\n]*\|/,
  /\beval\s*\(/,
  /\b(base64\s+-d|atob\s*\()/,
]

export interface AppRunState {
  running: boolean
  pid?: number
  port?: number
  url?: string
  startedAt?: string
}

interface RuntimeRecord {
  pid: number
  port: number
  url: string
  startedAt: string
  command: string
  cwd: string
}

/** 运行中的应用：name → 记录（runtime.json 持久化，跨请求/重启可见）。 */
type RuntimeMap = Record<string, RuntimeRecord>

/** 活跃子进程句柄（宿主进程内，用于 exit 事件自动清理）。 */
const children = new Map<string, ChildProcess>()

function readRuntime(): RuntimeMap {
  try {
    const parsed = JSON.parse(readFileSync(runtimeStatePath(), 'utf8')) as RuntimeMap
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function writeRuntime(map: RuntimeMap): void {
  mkdirSync(dirname(runtimeStatePath()), { recursive: true })
  writeFileSync(runtimeStatePath(), JSON.stringify(map))
}

/** liveness 探测：kill(pid, 0) 不杀进程，只查是否存在（ESRCH = 已退出）。 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * 运行状态（跨请求重查，防 runtime.json 与真实进程脱节）：
 * 记录在案但进程已死 → 清理记录并回报 stopped。
 */
export function appStatus(name: string): AppRunState {
  const record = readRuntime()[name]
  if (record === undefined) return { running: false }
  if (!alive(record.pid)) {
    const map = readRuntime()
    delete map[name]
    writeRuntime(map)
    children.delete(name)
    return { running: false }
  }
  return { running: true, pid: record.pid, port: record.port, url: record.url, startedAt: record.startedAt }
}

/** 全部已安装应用的运行状态（status 路由用）。 */
export function listAppStatus(): Record<string, AppRunState> {
  const out: Record<string, AppRunState> = {}
  for (const name of Object.keys(readInstalledApps())) out[name] = appStatus(name)
  return out
}

// ---- 命令解析与运行时探测 ----

/** 命令字符串 → { file, args }（支持引号包裹的 token）。 */
function parseCommand(cmd: string): { file: string; args: string[] } {
  const tokens = cmd.match(/"([^"]*)"|'([^']*)'|[^\s]+/g) ?? []
  const normalized = tokens.map((t) => {
    if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) return t.slice(1, -1)
    if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) return t.slice(1, -1)
    return t
  }).filter((t) => t !== '')
  if (normalized.length === 0) throw new Error('start 命令为空')
  return { file: normalized[0]!, args: normalized.slice(1) }
}

const WIN_EXTS = ['.cmd', '.bat', '.exe', '.com', '.ps1']

/** PATH 上查找可执行文件（win32 补扩展名）；找不到返回 null。 */
function resolveOnPath(file: string): string | null {
  if (file.includes('/') || file.includes('\\')) {
    return isAbsolute(file) ? (existsSync(file) ? file : null) : null
  }
  const separator = process.platform === 'win32' ? ';' : ':'
  const parts = (process.env.PATH ?? '').split(separator).filter((p) => p !== '')
  if (!parts.includes(nodeBinDir)) parts.unshift(nodeBinDir)
  for (const dir of parts) {
    const candidates = process.platform === 'win32'
      ? WIN_EXTS.map((ext) => join(dir, `${file}${ext}`))
      : [join(dir, file)]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/** 运行时检测：start 命令的首个 token 必须可解析（PATH 上或 app 目录内）。 */
function resolveRuntimeFile(file: string, cwd: string): { file: string; viaShell: boolean } {
  const withPath = file.includes('/') || file.includes('\\') || file.startsWith('.')
  if (withPath) {
    const abs = isAbsolute(file) ? file : resolve(cwd, file)
    if (existsSync(abs)) return { file: abs, viaShell: false }
    throw new Error(`启动文件不存在：${file}（请检查 manifest 的 start 命令）`)
  }
  const found = resolveOnPath(file)
  if (found === null) {
    const hint = /^node(\.exe)?$/i.test(file)
      ? '请先安装 Node.js（https://nodejs.org）'
      : /^python(\d)?(\.exe)?$/i.test(file)
        ? '请先安装 Python'
        : `请先安装 ${file} 并确认它在 PATH 中`
    throw new Error(`未检测到运行时：${file}（${hint}）`)
  }
  // Windows npm/npx 等是 .cmd shim，shell 之外无法直接 spawn
  const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(found)
  return { file: found, viaShell }
}

// ---- 端口分配 ----

/** 在 127.0.0.1 上找一个随机空闲端口（20000–50000）。 */
async function allocPort(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = 20_000 + Math.floor(Math.random() * 30_000)
    const free = await new Promise<boolean>((resolveFree) => {
      const server = createServer()
      server.once('error', () => resolveFree(false))
      server.listen(port, '127.0.0.1', () => server.close(() => resolveFree(true)))
    })
    if (free) return port
  }
  throw new Error('未找到空闲端口，请稍后重试')
}

// ---- 进程生命周期 ----

/** 杀进程树：Windows taskkill /T /F；POSIX 进程组 SIGTERM → 5s SIGKILL。 */
function killTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid !== undefined) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
      return
    } catch { /* fall through */ }
  }
  const signalTree = (signal: NodeJS.Signals): void => {
    if (child.pid === undefined) return
    try { process.kill(-child.pid, signal) } catch {
      try { child.kill(signal) } catch { /* already gone */ }
    }
  }
  signalTree('SIGTERM')
  const escalate = setTimeout(() => signalTree('SIGKILL'), 5000)
  escalate.unref?.()
}

function augmentedEnv(): NodeJS.ProcessEnv {
  const separator = process.platform === 'win32' ? ';' : ':'
  const parts = (process.env.PATH ?? '').split(separator).filter((p) => p !== '')
  if (!parts.includes(nodeBinDir)) parts.unshift(nodeBinDir)
  return { ...process.env, PATH: parts.join(separator) }
}

function spawnEnv(port: number): NodeJS.ProcessEnv {
  return {
    ...augmentedEnv(),
    // 端口契约：应用读 PORT 即可拿到分配到的 127.0.0.1 端口
    PORT: String(port),
    DSH_APP_PORT: String(port),
  }
}

/** 运行一条命令（build）并等待结束；超时 killTree。失败抛出 stderr 尾部。 */
function runCommand(record: InstalledApp, command: string, timeoutMs: number): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const cwd = join(appsRoot(), record.name)
    let child: ChildProcess
    try {
      const { file, args } = parseCommand(command)
      const { file: resolved, viaShell } = resolveRuntimeFile(file, cwd)
      child = viaShell
        ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${cmdCommandLine([resolved, ...args])}"`], {
            cwd, env: augmentedEnv(), stdio: ['ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32', shell: false, windowsVerbatimArguments: true,
          })
        : spawn(resolved, args, {
            cwd, env: augmentedEnv(), stdio: ['ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32', shell: false,
          })
    } catch (error) {
      rejectPromise(error instanceof Error ? error : new Error(String(error)))
      return
    }
    let out = ''
    let err = ''
    const timeout = setTimeout(() => {
      logEvent('warn', 'app-build-timeout', `${record.name} exceeded ${Math.round(timeoutMs / 60000)}min`)
      killTree(child)
    }, timeoutMs)
    timeout.unref?.()
    child.stdout?.on('data', (d) => { out += String(d) })
    child.stderr?.on('data', (d) => { err += String(d) })
    child.on('error', (error) => {
      clearTimeout(timeout)
      rejectPromise(new Error(`启动失败：${error.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolvePromise()
      else {
        const tail = (err.trim() || out.trim()).slice(-800)
        rejectPromise(new Error(`命令执行失败（退出码 ${code ?? '?'}）：${tail}`))
      }
    })
  })
}

/**
 * 部署：build（首次）→ 随机端口 → spawn start → 登记 runtime.json。
 * 返回浏览器地址 http://127.0.0.1:<port>。
 */
export async function deployApp(name: string): Promise<{ url: string; pid: number; port: number; built: boolean }> {
  const app = readInstalledApps()[name]
  if (app === undefined) throw new Error(`应用未安装：${name}（请先在解锁卡点「安装」）`)
  const running = appStatus(name)
  if (running.running) {
    throw new Error(`应用「${app.name}」已在运行（端口 ${running.port}）`)
  }

  // 平台侧红线复核（纵深防御）：start/build 命中即拒部署
  for (const cmd of [app.start, app.build]) {
    if (cmd !== null && FORBIDDEN_DEPLOY_PATTERNS.some((re) => re.test(cmd))) {
      throw new Error(`应用「${app.name}」的启动命令包含平台禁止的危险操作，已拒绝部署`)
    }
  }

  // build：每个安装版本只构建一次（build 成功写回状态记录）
  let built = false
  const record = { ...app }
  if (record.build !== null && record.built !== true) {
    await runCommand(record, record.build, 10 * 60 * 1000)
    record.built = true
    writeFileSync(join(appsRoot(), '.dshhub', `${name}.json`), JSON.stringify(record, null, 2))
    built = true
  }

  const port = await allocPort()
  const cwd = join(appsRoot(), name)
  const { file, args } = parseCommand(record.start)
  const { file: resolved, viaShell } = resolveRuntimeFile(file, cwd)

  const child = viaShell
    ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${cmdCommandLine([resolved, ...args])}"`], {
        cwd, env: spawnEnv(port), stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32', shell: false, windowsVerbatimArguments: true,
      })
    : spawn(resolved, args, {
        cwd, env: spawnEnv(port), stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32', shell: false,
      })

  const pid = child.pid
  if (pid === undefined) {
    child.kill()
    throw new Error('启动应用失败：无法获取进程号')
  }

  const url = `http://127.0.0.1:${port}`
  const map = readRuntime()
  map[name] = { pid, port, url, startedAt: new Date().toISOString(), command: record.start, cwd }
  writeRuntime(map)
  children.set(name, child)

  let stderrTail = ''
  child.stderr?.on('data', (d) => {
    stderrTail = String(d).slice(-400)
  })
  child.on('error', (error) => {
    logEvent('error', 'app-spawn-error', `${name}: ${error.message}`)
    const map2 = readRuntime()
    delete map2[name]
    writeRuntime(map2)
    children.delete(name)
  })
  child.on('exit', (code, signal) => {
    if (code !== 0 && stderrTail !== '') {
      logEvent('warn', 'app-exit', `${name} code=${code} signal=${signal}: ${stderrTail}`)
    }
    const map2 = readRuntime()
    if (map2[name]?.pid === pid) {
      delete map2[name]
      writeRuntime(map2)
    }
    children.delete(name)
  })

  logEvent('info', 'app-deploy', `${name} → ${url} (pid ${pid})`)
  return { url, pid, port, built }
}

/** 停止：killTree（SIGTERM → 5s SIGKILL）并清 runtime.json。 */
export async function stopApp(name: string): Promise<{ stopped: boolean }> {
  const state = appStatus(name)
  if (!state.running) return { stopped: false }
  const child = children.get(name)
  if (child !== undefined && child.pid !== undefined) killTree(child)
  else if (state.pid !== undefined) {
    // 宿主重启后无句柄：按记录的 pid 定向清理（尽力而为）
    try { process.kill(state.pid, 'SIGTERM') } catch { /* already gone */ }
    setTimeout(() => {
      try { process.kill(state.pid!, 'SIGKILL') } catch { /* already gone */ }
    }, 5000).unref?.()
  }
  const map = readRuntime()
  delete map[name]
  writeRuntime(map)
  children.delete(name)
  logEvent('info', 'app-stop', name)
  return { stopped: true }
}
