/**
 * Cloud bridge: the publish channel that goes through the dshhub.co platform
 * instead of a browser-to-localhost HTTP socket.
 *
 * Why: browsers block https-page → http://127.0.0.1 fetches (Safari local
 * network policy, Chrome Private Network Access preflight). The publish page
 * used to probe http://127.0.0.1:3750 directly; creators would have had to
 * change browser security settings — unacceptable. Instead this bridge
 * registers with the platform on startup (getting a per-session secret),
 * then polls an HTTPS task queue. The website creates tasks (scan / upload)
 * and polls their results. Zero browser-to-localhost traffic.
 *
 * The local HTTP bridge (bridge.ts) stays for in-DSH install / update flows,
 * which are process-internal and unaffected by browser policies.
 *
 * Lifecycle: register → poll loop (each poll doubles as heartbeat; the
 * platform marks a session offline after 15 min without one) → execute
 * tasks → report results. On 403 (secret invalidated) re-register.
 */

import { dirname, join } from 'node:path'
import { existsSync, statSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { hostname as osHostname, homedir } from 'node:os'
import { profileDir } from './profile.ts'
import { readOwnVersion } from './self-update.ts'

/** 简单语义化版本比较：'a.b.c' < 'x.y.z' 返回 true（用于升级门禁判断）。 */
function isOlderVersion(v: string, min: string): boolean {
  const a = v.split('.').map((n) => parseInt(n, 10) || 0)
  const b = min.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0)
  }
  return false
}
import { scanPresets, scanSkills } from './preset-scan.ts'
import { publishUpload, type PublishUploadBody } from './bridge.ts'

/**
 * 把本机桥接会话绑定到 dshhub 账号（配对码方案，0.8.47）：
 * 遍历本机各 profile 的桥接状态文件，用网页端生成的 6 位配对码调用
 * /api/bridge/bind 绑定。一次绑定永久生效——之后会话列表/任务派发按账号
 * 隔离，不再依赖 IP（代理/VPN 无影响）。
 */
export async function bindToAccount(code: string): Promise<{ ok: boolean; error?: string }> {
  const c = typeof code === 'string' ? code.trim() : ''
  if (!/^\d{6}$/.test(c)) return { ok: false, error: '配对码为 6 位数字' }
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const candidates: string[] = []
  try {
    candidates.push(...readdirSync(join(home, 'profiles')).filter((p) => !p.startsWith('.') && p !== 'node_modules'))
  } catch {
    /* profiles 目录不存在 */
  }
  if (!candidates.includes('web')) candidates.unshift('web')

  for (const profile of candidates) {
    const state = readState(profile)
    if (!state) continue
    try {
      const res = await fetch(`${DSHHUB_API}/api/bridge/bind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: state.sessionId, secret: state.secret, code: c }),
        signal: AbortSignal.timeout(10_000),
      })
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (res.ok && d.ok) return { ok: true }
      return { ok: false, error: d.error ?? `HTTP ${res.status}` }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  return { ok: false, error: '未找到本机桥接会话（请确认本机 DSH 已启动并含市场插件）' }
}

/** 在系统文件管理器中打开目录（「打开文件夹」任务；安全：只允许存在的目录，无提权） */
function openInFileManager(dir: string): { ok: boolean; error?: string } {
  try {
    if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
      return { ok: false, error: '目录不存在或不可访问' }
    }
    const [cmd, ...args] =
      process.platform === 'darwin' ? ['open', dir]
      : process.platform === 'win32' ? ['explorer', dir]
      : ['xdg-open', dir]
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 口令插件市场 API 地址（本地调试可 DSHHUB_API_URL=http://localhost:3000） */
const DSHHUB_API = process.env.DSHHUB_API_URL ?? 'https://www.dshhub.co'

/**
 * 轮询节奏（2026-08-31 退避策略，替代固定 1.5s）：
 *   * 基础间隔 10s，可用环境变量 DSHHUB_POLL_INTERVAL_MS 覆盖；
 *   * 空闲（无任务）时指数退避：10s → 20s → 40s → 60s 封顶；
 *   * 一旦有任务（或重新注册）立即复位到基础间隔，保证发布响应速度；
 *   * 心跳安全：即使退避到 60s 封顶，也远小于平台会话 TTL（15 分钟）。
 * 背景：固定 1.5s 无限轮询曾导致全平台 18 次/秒，Vercel 函数调用
 * 40 倍于 Hobby 免费额度、Supabase 出口几天 2GB+。退避后 20 个客户端
 * 空闲态仅 20 次/分钟 ≈ 2.9 万次/天，月耗远低于 100 万次免费额度。
 */
const POLL_INTERVAL_MS = Number(process.env.DSHHUB_POLL_INTERVAL_MS) || 10_000
// 空闲退避上限 120s（0.8.55 起）：请求量减半，为百万级承载留余量。
// 基础 10s 保证任务响应速度；空闲才退避，有任务立即复位。
const POLL_BACKOFF_MAX_MS = 120_000

interface BridgeState {
  sessionId: string
  secret: string
  profile: string
}

type PollOutcome = 'ok' | 'task' | 'rejected' | 'upgrade-required'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function statePath(profile: string): string {
  return join(profileDir(profile), '.dshhub-bridge.json')
}

function readState(profile: string): BridgeState | null {
  const p = statePath(profile)
  if (!existsSync(p)) return null
  try {
    const s = JSON.parse(readFileSync(p, 'utf8')) as BridgeState
    if (typeof s.sessionId === 'string' && typeof s.secret === 'string' && s.sessionId !== '' && s.secret !== '') {
      return s
    }
  } catch {
    // corrupted — fall through to re-register
  }
  return null
}

export async function register(profile: string, version: string): Promise<BridgeState> {
  const res = await fetch(`${DSHHUB_API}/api/bridge/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 上报主机名：多台 DSH 在线时网页端可区分「这台是谁」
    body: JSON.stringify({ profile, version, hostname: osHostname() }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`register HTTP ${res.status}`)
  const d = (await res.json()) as { sessionId?: unknown; secret?: unknown }
  if (typeof d.sessionId !== 'string' || typeof d.secret !== 'string') throw new Error('register: bad payload')
  const state: BridgeState = { sessionId: d.sessionId, secret: d.secret, profile }
  mkdirSync(dirname(statePath(profile)), { recursive: true })
  writeFileSync(statePath(profile), JSON.stringify(state))
  return state
}

async function report(
  state: BridgeState,
  taskId: string,
  status: 'done' | 'failed',
  result: unknown,
): Promise<void> {
  const res = await fetch(`${DSHHUB_API}/api/bridge/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: state.sessionId, secret: state.secret, taskId, status, result }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`report HTTP ${res.status}`)
}

/** 单轮轮询：取任务并执行。返回 'task'（执行了任务）/ 'ok'（空轮询）/ 'rejected'（凭据失效）。 */
export async function pollOnce(state: BridgeState): Promise<PollOutcome> {
  const res = await fetch(`${DSHHUB_API}/api/bridge/poll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: state.sessionId,
      secret: state.secret,
      clientVersion: readOwnVersion(), // 上报版本，服务端据此做强制升级门禁
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (res.status === 403) return 'rejected'
  if (!res.ok) throw new Error(`poll HTTP ${res.status}`)
  const d = (await res.json()) as {
    task?: { taskId?: unknown; type?: unknown; payload?: Record<string, unknown> } | null
    error?: unknown
    minVersion?: unknown
  }
  if (d.error) return 'rejected'

  // 强制升级门禁（2026-09-01）：服务端声明最低版本，低于即停止轮询并触发升级
  const min = typeof d.minVersion === 'string' ? d.minVersion : ''
  if (min !== '' && isOlderVersion(readOwnVersion(), min)) {
    console.warn(
      `[dshhub-market] 本插件 v${readOwnVersion()} 低于要求的最低版本 v${min}，` +
      `已停止轮询以保护平台资源，请升级到最新版（dsh plugin --profile ${state.profile} update dshhub-market）。`,
    )
    return 'upgrade-required'
  }

  const task = d.task
  if (task === null || task === undefined) return 'ok'
  const taskId = String(task.taskId ?? '')
  const type = String(task.type ?? '')
  if (taskId === '') return 'ok'

  try {
    if (type === 'scan') {
      const dir = profileDir(state.profile)
      const result = { presets: scanPresets(dir), skills: scanSkills(dir) }
      await report(state, taskId, 'done', result)
    } else if (type === 'upload') {
      const result = await publishUpload((task.payload ?? {}) as PublishUploadBody, state.profile)
      await report(state, taskId, result.ok ? 'done' : 'failed', result)
    } else if (type === 'open') {
      // 「打开文件夹」：在系统文件管理器中打开指定目录（来源=扫描结果，路径校验后执行）
      const payload = (task.payload ?? {}) as { path?: unknown }
      const dir = typeof payload.path === 'string' ? payload.path : ''
      const opened = openInFileManager(dir)
      await report(state, taskId, opened.ok ? 'done' : 'failed', opened)
    } else {
      await report(state, taskId, 'failed', { error: `未知任务类型：${type}` })
    }
  } catch (err) {
    // 执行或回传失败都记为 failed，任务在页面侧显示具体错误
    await report(state, taskId, 'failed', { error: err instanceof Error ? err.message : String(err) }).catch(() => {})
  }
  return 'task'
}

let bridgeRunning = false
let bridgeStopRequested = false

/**
 * 停止云端发布通道（2026-09-02，0.8.56）：市场界面关闭即停止轮询——
 * 不打开市场界面 = 0 轮询、0 平台请求（极致资源优化）。再次 startCloudBridge
 * 会重新启动（界面重新打开时）。
 */
export function stopCloudBridge(): void {
  bridgeStopRequested = true
}

/**
 * 启动云端发布通道：注册 + 自适应退避轮询（随市场界面生命周期运行）。
 * 所有失败（网络抖动 / 平台短时不可用）都静默等待下一轮，不抛错不退出。
 *
 * 退避逻辑：work（有任务/重新注册）→ 间隔复位到基础值；
 * 空闲 → 间隔 ×2 递增，封顶 120s。
 */
export async function startCloudBridge(profile: string): Promise<void> {
  if (bridgeRunning) return
  bridgeRunning = true
  bridgeStopRequested = false
  let state = readState(profile)
  let delay = POLL_INTERVAL_MS

  // 启动日志：便于诊断（DSH 日志里能看到发布通道状态）
  console.log(`[dshhub-market] cloud publish channel starting (profile: ${profile})`)

  while (!bridgeStopRequested) {
    let worked = false
    try {
      if (state === null) {
        state = await register(profile, readOwnVersion())
        worked = true
      } else {
        const outcome = await pollOnce(state)
        if (outcome === 'upgrade-required') {
          // 版本过旧被平台拒绝：停止轮询（不再消耗平台资源），等待用户升级
          return
        } else if (outcome === 'rejected') {
          // 凭据被平台废弃（如会话被清理）——重新注册
          state = await register(profile, readOwnVersion())
          worked = true
        } else if (outcome === 'task') {
          worked = true
        }
      }
    } catch {
      // 平台不可达：静默，下一轮再试（state 原样保留，间隔照常退避）
    }
    delay = worked ? POLL_INTERVAL_MS : Math.min(delay * 2, POLL_BACKOFF_MAX_MS)
    await sleep(delay)
  }
  bridgeRunning = false
  console.log(`[dshhub-market] cloud publish channel stopped (profile: ${profile})`)
}
