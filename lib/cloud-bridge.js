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
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { profileDir } from './profile.js';
import { readOwnVersion } from './self-update.js';
import { scanPresets, scanSkills } from './preset-scan.js';
import { publishUpload } from './bridge.js';
/** 口令插件市场 API 地址（本地调试可 DSHHUB_API_URL=http://localhost:3000） */
const DSHHUB_API = process.env.DSHHUB_API_URL ?? 'https://www.dshhub.co';
const POLL_INTERVAL_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function statePath(profile) {
    return join(profileDir(profile), '.dshhub-bridge.json');
}
function readState(profile) {
    const p = statePath(profile);
    if (!existsSync(p))
        return null;
    try {
        const s = JSON.parse(readFileSync(p, 'utf8'));
        if (typeof s.sessionId === 'string' && typeof s.secret === 'string' && s.sessionId !== '' && s.secret !== '') {
            return s;
        }
    }
    catch {
        // corrupted — fall through to re-register
    }
    return null;
}
export async function register(profile, version) {
    const res = await fetch(`${DSHHUB_API}/api/bridge/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, version }),
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok)
        throw new Error(`register HTTP ${res.status}`);
    const d = (await res.json());
    if (typeof d.sessionId !== 'string' || typeof d.secret !== 'string')
        throw new Error('register: bad payload');
    const state = { sessionId: d.sessionId, secret: d.secret, profile };
    mkdirSync(dirname(statePath(profile)), { recursive: true });
    writeFileSync(statePath(profile), JSON.stringify(state));
    return state;
}
async function report(state, taskId, status, result) {
    const res = await fetch(`${DSHHUB_API}/api/bridge/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: state.sessionId, secret: state.secret, taskId, status, result }),
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok)
        throw new Error(`report HTTP ${res.status}`);
}
/** 单轮轮询：取任务并执行。返回 'ok'（正常结束）或 'rejected'（凭据失效，需重注册）。 */
export async function pollOnce(state) {
    const res = await fetch(`${DSHHUB_API}/api/bridge/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: state.sessionId, secret: state.secret }),
        signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 403)
        return 'rejected';
    if (!res.ok)
        throw new Error(`poll HTTP ${res.status}`);
    const d = (await res.json());
    if (d.error)
        return 'rejected';
    const task = d.task;
    if (task === null || task === undefined)
        return 'ok';
    const taskId = String(task.taskId ?? '');
    const type = String(task.type ?? '');
    if (taskId === '')
        return 'ok';
    try {
        if (type === 'scan') {
            const dir = profileDir(state.profile);
            const result = { presets: scanPresets(dir), skills: scanSkills(dir) };
            await report(state, taskId, 'done', result);
        }
        else if (type === 'upload') {
            const result = await publishUpload((task.payload ?? {}), state.profile);
            await report(state, taskId, result.ok ? 'done' : 'failed', result);
        }
        else {
            await report(state, taskId, 'failed', { error: `未知任务类型：${type}` });
        }
    }
    catch (err) {
        // 执行或回传失败都记为 failed，任务在页面侧显示具体错误
        await report(state, taskId, 'failed', { error: err instanceof Error ? err.message : String(err) }).catch(() => { });
    }
    return 'ok';
}
let started = false;
/**
 * 启动云端发布通道：注册 + 无限轮询（随 DSH 进程生命周期运行）。
 * 所有失败（网络抖动 / 平台短时不可用）都静默等待下一轮，不抛错不退出。
 */
export async function startCloudBridge(profile) {
    if (started)
        return;
    started = true;
    let state = readState(profile);
    // 启动日志：便于诊断（DSH 日志里能看到发布通道状态）
    console.log(`[dshhub-market] cloud publish channel starting (profile: ${profile})`);
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            if (state === null) {
                state = await register(profile, readOwnVersion());
            }
            else if ((await pollOnce(state)) === 'rejected') {
                // 凭据被平台废弃（如会话被清理）——重新注册
                state = await register(profile, readOwnVersion());
            }
        }
        catch {
            // 平台不可达：静默，下一轮再试（state 原样保留）
        }
        await sleep(POLL_INTERVAL_MS);
    }
}
