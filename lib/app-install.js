/**
 * Deployable app install path (manifest v2, kind=app): apps are standalone
 * projects the buyer runs as a LOCAL process — the zip installs by plain copy
 * into <dsh-home>/apps/<name>/ (NOT a pnpm package, never mounted into DSH),
 * then the deploy route spawns the manifest `start` command on a random
 * 127.0.0.1 port.
 *
 * kind=app is GitHub-only on the platform (creator upload rejects it), so the
 * zip always arrives through the import-github dist pipeline, which already
 * ran the AI security audit on these exact bytes. The client re-validates the
 * deploy fields locally as defense in depth — the audit badge and its bound
 * sha256 ride along in the entry so the UI can show what was approved.
 *
 * Installed state is recorded under <root>/.dshhub/<package>.json — same
 * bookkeeping pattern as presets (preset-install.ts) — so uninstall can
 * remove exactly the directory one package brought in.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';
import { marketFetch } from './net.js';
/** Bookkeeping dir inside the apps root. */
export const APP_STATE_DIR = '.dshhub';
/** Deployable apps root: <dsh-home>/apps/ (independent of DSH's plugin roots). */
export function appsRoot() {
    return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'apps');
}
/** Shared runtime registry file (see app-runtime.ts) — path defined here so
 * install/uninstall can guard against a running instance without a circular
 * import. */
export function runtimeStatePath() {
    return join(appsRoot(), APP_STATE_DIR, 'runtime.json');
}
/** Locate manifest.json at the zip root or under a single wrapper dir. */
function locateManifest(entries) {
    const atRoot = entries['manifest.json'];
    if (atRoot !== undefined) {
        return { manifest: JSON.parse(new TextDecoder().decode(atRoot)), rooted: entries };
    }
    const topDirs = new Set();
    for (const name of Object.keys(entries)) {
        if (name.includes('/'))
            topDirs.add(name.split('/')[0]);
    }
    if (topDirs.size === 1) {
        const dir = [...topDirs][0];
        const mf = entries[`${dir}/manifest.json`];
        if (mf !== undefined) {
            const rooted = {};
            for (const [name, data] of Object.entries(entries)) {
                if (name.startsWith(`${dir}/`) && name.length > dir.length + 1) {
                    rooted[name.slice(dir.length + 1)] = data;
                }
            }
            return { manifest: JSON.parse(new TextDecoder().decode(mf)), rooted };
        }
    }
    throw new Error('压缩包缺少根目录 manifest.json');
}
function assertSafePath(name) {
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
        throw new Error(`压缩包含非法路径：${name}`);
    }
}
function safeName(value) {
    return value.replace(/[^A-Za-z0-9._-]/g, '-');
}
function statePathAt(name) {
    return join(appsRoot(), APP_STATE_DIR, `${name}.json`);
}
/** Installed app packages: package name → record. */
export function readInstalledApps() {
    const dir = join(appsRoot(), APP_STATE_DIR);
    if (!existsSync(dir))
        return {};
    const out = {};
    for (const file of readdirSync(dir)) {
        if (file === 'runtime.json' || !file.endsWith('.json'))
            continue;
        try {
            const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'));
            if (typeof parsed.name === 'string' && parsed.name !== '')
                out[parsed.name] = parsed;
        }
        catch {
            // corrupted record — ignore
        }
    }
    return out;
}
/** Installed-map entries for app packages: name → `app:<url>` spec. */
export function appSpecMap() {
    const out = {};
    for (const [name, app] of Object.entries(readInstalledApps())) {
        out[name] = `app:${app.url}`;
    }
    return out;
}
/** App-installed lookup used by the uninstall guard. */
export function isInstalledApp(name) {
    return readInstalledApps()[name] !== undefined;
}
/**
 * Install a kind=app catalog entry: download → validate → copy every file
 * into <dsh-home>/apps/<name>/. Throws with a Chinese error on failure.
 */
export async function installApp(entry, opts) {
    if (typeof entry.zip !== 'string' || entry.zip === '') {
        throw new Error('该应用没有可下载的 zip 源');
    }
    let zipBytes;
    try {
        const response = await marketFetch(entry.zip, { signal: AbortSignal.timeout(180_000) });
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        zipBytes = Buffer.from(await response.arrayBuffer());
    }
    catch (error) {
        throw new Error(`下载应用包失败（${entry.zip}）：${error instanceof Error ? error.message : String(error)}`);
    }
    if (zipBytes.byteLength < 22)
        throw new Error('应用包无效（空文件）');
    // 哈希存证：平台直传/导入条目在核销载荷携带 sha256（audit.sha256），比对不一致
    // 即拒绝安装——买家拿到的必须就是平台审核过的那份字节。
    const zipSha256 = createHash('sha256').update(zipBytes).digest('hex');
    if (opts?.expectedSha256 && zipSha256 !== opts.expectedSha256) {
        throw new Error('应用包内容校验失败（哈希不符），可能下载被篡改，已拒绝安装');
    }
    const entries = unzipSync(new Uint8Array(zipBytes));
    const { manifest, rooted } = locateManifest(entries);
    if (manifest.kind !== 'app') {
        throw new Error(`该包 kind=${String(manifest.kind ?? '')}，不是可部署应用（app）`);
    }
    if (typeof manifest.name !== 'string' || manifest.name === '')
        throw new Error('manifest.json 缺少 name');
    const start = typeof manifest.start === 'string' ? manifest.start.trim() : '';
    if (start === '')
        throw new Error('manifest.json 缺少 start（部署启动命令）');
    if (start.length > 500)
        throw new Error('manifest.json 的 start 命令过长（≤500 字符）');
    const build = typeof manifest.build === 'string' && manifest.build.trim() !== '' ? manifest.build.trim() : null;
    if (build !== null && build.length > 500)
        throw new Error('manifest.json 的 build 命令过长（≤500 字符）');
    const port = typeof manifest.port === 'number' && Number.isInteger(manifest.port) && manifest.port >= 1 && manifest.port <= 65535
        ? manifest.port
        : null;
    const appName = safeName(manifest.name);
    const dest = join(appsRoot(), appName);
    rmSync(dest, { recursive: true, force: true });
    let count = 0;
    for (const [name, data] of Object.entries(rooted)) {
        if (name.endsWith('/'))
            continue; // directory entry
        const base = name.split('/').pop() ?? '';
        if (name.startsWith('__MACOSX/') || base === '.DS_Store' || base.startsWith('._'))
            continue;
        assertSafePath(name);
        const target = join(dest, name);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, data);
        count++;
    }
    if (count === 0)
        throw new Error('应用包为空');
    const record = {
        name: appName,
        version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
        start,
        build,
        port,
        url: entry.url,
        installedAt: new Date().toISOString(),
    };
    mkdirSync(join(appsRoot(), APP_STATE_DIR), { recursive: true });
    writeFileSync(statePathAt(appName), JSON.stringify(record, null, 2));
    return record;
}
/**
 * Remove the app directory a package brought in, then its state record.
 * Refuses while the app is running (deploy must stop it first).
 */
export function uninstallApp(name) {
    const record = readInstalledApps()[name];
    if (record === undefined)
        return false;
    // runtime.json: running instance pid/port (path shared with app-runtime.ts).
    try {
        const runtime = JSON.parse(readFileSync(runtimeStatePath(), 'utf8'));
        if (runtime[name] !== undefined) {
            throw new Error(`应用「${record.name}」正在运行，请先停止再卸载`);
        }
    }
    catch (error) {
        if (error instanceof Error && error.message.includes('正在运行'))
            throw error;
        // runtime.json 缺失/损坏：当作未运行
    }
    rmSync(join(appsRoot(), name), { recursive: true, force: true });
    rmSync(statePathAt(name), { force: true });
    return true;
}
