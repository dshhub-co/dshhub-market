/**
 * fork (dshhub): embedded local HTTP bridge on 127.0.0.1:3750-3754 so the
 * dshhub.co website can one-click install plugins into the running DSH.
 * Ported from the legacy dshhub-market plugin (market-plugin/lib/bridge.js);
 * the install itself now goes through the fork's own engine (registry lookup
 * by dshhubId → zip materialization or standard source → `dsh plugin add`).
 *
 * Contract (kept byte-compatible with the legacy bridge so the website's
 * InstallHarnessButton keeps working):
 *   GET  /health   → { ok, bridge: 'dshhub-market', version, profile }
 *   POST /install  → body { id: <dshhub plugin uuid> } → { ok, message|error }
 *   GET  /dsh-market/publish/scan  → { presets, skills }（本机扫描，供发布页勾选）
 *   POST /dsh-market/publish/upload → body { items, token, accountId, authorName, demoUrl? }
 *        → 打包选中项 → POST 平台 /api/creator/upload（Bearer token 鉴权）
 */
import { createServer } from 'node:http';
import { loadRegistry } from './registry.js';
import { entryNeedsZip, materializeTgz } from './zip-source.js';
import { installTargetFor } from './sources.js';
import { runDshPlugin } from './dsh-cli.js';
import { readOwnVersion } from './self-update.js';
import { installSkill } from './skill-install.js';
import { installPreset } from './preset-install.js';
import { scanPresets, scanSkills } from './preset-scan.js';
import { buildPublishInfo, publishItems } from './publish.js';
import { profileDir } from './profile.js';
export const PORTS = [3750, 3751, 3752, 3753, 3754];
const MAX_BODY = 64 * 1024;
/** 口令插件市场 API 地址（本地调试可 DSHHUB_API_URL=http://localhost:3000） */
const DSHHUB_API = process.env.DSHHUB_API_URL ?? 'https://www.dshhub.co';
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
};
/**
 * Request gate (DNS-rebinding + drive-by install protection):
 * - Host header must be 127.0.0.1 / localhost (optionally with a port) —
 *   a rebound DNS name pointing here would carry a foreign Host.
 * - When Origin is present (browser cross-origin POSTs always send it), it
 *   must be the local DSH app, an opaque/null origin (sandboxed contexts),
 *   or dshhub.co itself (the website's install button).
 */
function requestAllowed(req) {
    const host = String(req.headers.host ?? '');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))
        return false;
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
        try {
            const u = new URL(origin);
            const ok = ['127.0.0.1', 'localhost', 'dshhub.co', 'www.dshhub.co'].includes(u.hostname);
            if (!ok)
                return false;
        }
        catch {
            return false;
        }
    }
    return true;
}
/** Serialize installs: pnpm cannot run concurrently in one profile dir. */
let queueTail = Promise.resolve();
function enqueueInstall(fn) {
    const run = queueTail.then(fn, fn);
    queueTail = run.then(() => { }, () => { });
    return run;
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const parts = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY) {
                reject(new Error('body too large'));
                req.destroy();
                return;
            }
            parts.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(parts)));
        req.on('error', reject);
    });
}
/**
 * Install a catalog entry into the given profile. Two request shapes:
 *  - `{ id, token? }`  — a dshhub-uploaded plugin (uuid lookup); `token` is
 *    the dshhub session access token the website passes for PAID plugins so
 *    the zip download can verify the License (paid-marketplace-design.md §4.3).
 *  - `{ url }` — a curated registry entry (must match the registry allowlist
 *    exactly, same rule as the market's own install route).
 */
async function installEntry(body, profile) {
    const id = body?.id;
    const url = body?.url;
    const token = typeof body?.token === 'string' && body.token !== '' ? body.token : undefined;
    const registry = await loadRegistry();
    let entry = undefined;
    if (typeof id === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(id)) {
        entry = registry.plugins.find(p => p.dshhubId === id);
        if (entry === undefined)
            return { ok: false, error: '插件不在目录中（未上架或尚未审核通过）' };
    }
    else if (typeof url === 'string' && url !== '') {
        entry = registry.plugins.find(p => p.url.toLowerCase() === url.toLowerCase());
        if (entry === undefined)
            return { ok: false, error: '插件不在精选目录中' };
    }
    else {
        return { ok: false, error: '无效的插件 id' };
    }
    if (entry.paid === true && !token) {
        return { ok: false, error: '付费插件需要 dshhub.co 登录态：请先在网站上购买，再点「一键安装」' };
    }
    // manifest v2: skill packages copy into the profile skills dir, no pnpm.
    if (entry.kind === 'skill') {
        try {
            const record = await installSkill(profileDir(profile), entry);
            return { ok: true, message: `已安装技能包 ${entry.name}（${record.skills.join('、')} → profile skills 目录）` };
        }
        catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    }
    // manifest v2: preset packages copy into DSH's user preset root
    // (<dsh-home>/.agent-presets/, the only root DSH's Agent picker scans), no pnpm.
    if (entry.kind === 'preset') {
        try {
            const record = await installPreset(profileDir(profile), entry);
            return { ok: true, message: `已安装预设包 ${entry.name}（${record.presets.join('、')} → DSH 全局预设库 .agent-presets）` };
        }
        catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    }
    const target = entryNeedsZip(entry) ? await materializeTgz(entry, { token }) : installTargetFor(entry);
    if (target === null) {
        return { ok: false, error: '不支持的来源' };
    }
    const result = await runDshPlugin(profile, ['add', target]);
    if (result.exitCode !== 0) {
        return { ok: false, error: `安装失败：${result.stderr.split('\n').filter(Boolean).slice(-1).join(' ').slice(0, 300)}` };
    }
    return { ok: true, message: `已安装 ${entry.name}，重启 DSH 后生效` };
}
function send(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify(body));
}
export function createBridgeServer(opts) {
    const { profile } = opts;
    return createServer((req, res) => {
        req.socket.unref?.(); // never keep the DSH process alive for the bridge
        if (!requestAllowed(req)) {
            send(res, 403, { ok: false, error: 'forbidden' });
            return;
        }
        const url = (req.url ?? '/').split('?')[0];
        if (req.method === 'OPTIONS') {
            res.writeHead(204, CORS_HEADERS);
            res.end();
            return;
        }
        if (req.method === 'GET' && url === '/health') {
            send(res, 200, {
                ok: true,
                bridge: 'dshhub-market',
                version: readOwnVersion(),
                profile,
            });
            return;
        }
        if (req.method === 'POST' && url === '/install') {
            readBody(req)
                .then((buf) => {
                let body = {};
                try {
                    body = JSON.parse(buf.toString('utf8') || '{}');
                }
                catch { /* empty body */ }
                return enqueueInstall(() => installEntry(body, profile));
            })
                .then((result) => send(res, result.ok ? 200 : 400, result))
                .catch(() => send(res, 400, { ok: false, error: '请求无效' }));
            return;
        }
        if (req.method === 'GET' && url === '/dsh-market/publish/scan') {
            try {
                const dir = profileDir(profile);
                send(res, 200, { presets: scanPresets(dir), skills: scanSkills(dir) });
            }
            catch (error) {
                send(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
            }
            return;
        }
        if (req.method === 'POST' && url === '/dsh-market/publish/upload') {
            readBody(req)
                .then((buf) => {
                let body = {};
                try {
                    body = JSON.parse(buf.toString('utf8') || '{}');
                }
                catch { /* empty body */ }
                return enqueueInstall(() => publishUpload(body, profile));
            })
                .then((result) => send(res, result.ok ? 200 : 400, result))
                .catch(() => send(res, 400, { ok: false, error: '请求无效' }));
            return;
        }
        send(res, 404, { ok: false, error: 'not found' });
    });
}
/**
 * 打包发布：重扫本机 profile，把 body.items 里 kind+name 匹配到的项
 * 交给 publishItems（客户端打包 zip → 上传平台 /api/creator/upload）。
 * 每项附带的开发者↔买家沟通字段（demo/teachingLinks/gettingStarted/faq/
 * contact/changelog）绑定到对应 ScannedItem 旁逐项传入；旧版发布页只发顶层
 * demoUrl 时回落为 { demo: demoUrl }。
 */
export async function publishUpload(body, profile) {
    if (!Array.isArray(body.items) || body.items.length === 0) {
        return { ok: false, error: '请先选择要发布的内容' };
    }
    if (typeof body.accountId !== 'string' || body.accountId === '') {
        return { ok: false, error: '缺少账号信息：请先在 dshhub.co 登录' };
    }
    const dir = profileDir(profile);
    const allScanned = [...scanPresets(dir), ...scanSkills(dir)];
    const legacyDemo = typeof body.demoUrl === 'string' && body.demoUrl.trim() !== '' ? { demo: body.demoUrl.trim() } : undefined;
    const selected = [];
    for (const raw of body.items) {
        if (typeof raw.kind !== 'string' || typeof raw.name !== 'string')
            continue;
        const match = allScanned.find((s) => s.kind === raw.kind && s.name === raw.name);
        if (match !== undefined && !selected.some((s) => s.item.kind === match.kind && s.item.name === match.name)) {
            selected.push({ item: match, info: buildPublishInfo(raw) });
        }
    }
    if (selected.length === 0) {
        return { ok: false, error: '选中的内容未在本机扫描结果中找到，请先重新扫描' };
    }
    // 每个条目独立打包发布（一次一个 zip/plugin）；任一失败立即返回该错误。
    const published = [];
    for (const { item, info } of selected) {
        const result = await publishItems([item], {
            apiBase: DSHHUB_API,
            token: typeof body.token === 'string' && body.token !== '' ? body.token : undefined,
            accountId: body.accountId,
            authorName: typeof body.authorName === 'string' ? body.authorName : '',
            info: info && Object.keys(info).length > 0 ? info : legacyDemo,
        });
        if (!result.ok)
            return result;
        if (result.name !== undefined && result.id !== undefined) {
            published.push({
                name: result.name,
                id: result.id,
                kind: result.kind ?? item.kind,
                version: result.version ?? '0.0.0',
            });
        }
    }
    return { ok: true, published };
}
async function probeBridge(port) {
    try {
        const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) });
        if (!r.ok)
            return false;
        const d = (await r.json().catch(() => ({})));
        return d?.bridge === 'dshhub-market';
    }
    catch {
        return false;
    }
}
function listen(server, port) {
    return new Promise((resolve, reject) => {
        const onError = (e) => { server.off('listening', onListen); reject(e); };
        const onListen = () => { server.off('error', onError); resolve(port); };
        server.once('error', onError);
        server.once('listening', onListen);
        server.listen(port, '127.0.0.1');
    });
}
let started = false;
/**
 * Start the bridge on the first free port (3750-3754). When another DSH
 * instance already runs one, reuse it silently. Idempotent per process.
 */
export async function startBridge(profile) {
    if (started)
        return { ok: true, reused: true };
    started = true;
    const server = createBridgeServer({ profile });
    for (const port of PORTS) {
        if (await probeBridge(port)) {
            console.log(`[dshhub-market] bridge already running on 127.0.0.1:${port} — reusing (profile: ${profile})`);
            return { ok: true, port, reused: true };
        }
        try {
            await listen(server, port);
        }
        catch (e) {
            if (e?.code !== 'EADDRINUSE') {
                console.warn(`[dshhub-market] bridge failed to start: ${e instanceof Error ? e.message : String(e)}`);
                return { ok: false };
            }
            continue; // occupied by something else — try the next port
        }
        server.unref?.();
        console.log(`[dshhub-market] bridge listening on 127.0.0.1:${port} (profile: ${profile})`);
        return { ok: true, port };
    }
    console.warn('[dshhub-market] bridge: no free port among 3750-3754 — website install buttons will fall back to offline');
    return { ok: false };
}
