/**
 * fork (dshhub): self-update over the dshhub.co tarball channel instead of
 * npm. `dshhub-market` is never published to npm, so the market updates
 * itself by polling the site's version endpoint and reinstalling from the
 * published tarball — the same channel the legacy plugin used, so existing
 * installs upgrade in place.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDshPlugin } from './dsh-cli.js';
/** The fork's own package name (its profile manifest key). */
export const FORK_SELF_NAME = 'dshhub-market';
/**
 * Self-contained semver-ish compare (the legacy plugin's cmpVersion):
 * '0.10.0' > '0.9.3', '1.0.0-rc1' < '1.0.0'. Kept local so this module does
 * not import from updates.ts (which imports this module — no cycle).
 */
function ownIsUpgrade(installed, latest) {
    const strip = (v) => v.replace(/-.*$/, '');
    const pa = strip(installed).split('.').map(n => parseInt(n, 10) || 0);
    const pb = strip(latest).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) !== (pb[i] || 0))
            return (pb[i] || 0) > (pa[i] || 0);
    }
    return /-/.test(installed) && !/-/.test(latest); // prerelease sorts lower
}
export function updateBase() {
    return process.env.DSHHUB_UPDATE_BASE ?? 'https://www.dshhub.co';
}
/**
 * The published tarball for the current channel (v1: one public channel).
 * 版本化 URL 是必须的：profile 里的依赖 spec 若不变化（同一个 tgz 地址），
 * pnpm 会判定 "Already up to date" 而不重新下载——「更新命令执行完成，但
 * 版本没有变化」就是这么来的。带上版本号后每次更新都是新 spec，必然重装。
 * 无版本的裸地址仍留给安装向导使用（/dshhub-market.tgz）。
 */
export function selfUpdateTarget(base = updateBase(), version = '') {
    return version !== '' ? `${base}/dshhub-market-${version}.tgz` : `${base}/dshhub-market.tgz`;
}
/** This package's own version, read from its installed package.json. */
export function readOwnVersion() {
    try {
        const pkg = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
        if (!existsSync(pkg))
            return '0.0.0';
        return JSON.parse(readFileSync(pkg, 'utf8')).version ?? '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
/** Latest published version per the site's version endpoint, or null. */
export async function fetchOwnVersion(base = updateBase()) {
    try {
        const res = await fetch(`${base}/api/market/version?t=${Date.now()}`, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok)
            return null;
        const body = (await res.json());
        return typeof body.version === 'string' ? body.version : null;
    }
    catch {
        return null;
    }
}
/**
 * Poll the version endpoint; when a newer release is published, reinstall
 * this package from the tarball (the DSH CLI replaces the same-name dep in
 * the profile manifest). Opt-out: DSHHUB_DISABLE_AUTOUPDATE=1.
 */
export function scheduleSelfUpdate(profile) {
    if (process.env.DSHHUB_DISABLE_AUTOUPDATE === '1')
        return;
    let checking = false;
    const tick = async () => {
        if (checking)
            return;
        checking = true;
        try {
            const remote = await fetchOwnVersion();
            const installed = readOwnVersion();
            if (remote === null || installed === '0.0.0')
                return;
            if (!ownIsUpgrade(installed, remote))
                return;
            const result = await runDshPlugin(profile, ['add', selfUpdateTarget(updateBase(), remote)]);
            if (result.exitCode !== 0) {
                console.warn(`[dshhub-market] self-update to ${remote} failed: ${result.stderr.slice(-300)}`);
            }
        }
        catch (error) {
            console.warn(`[dshhub-market] self-update check failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            checking = false;
        }
    };
    setTimeout(() => { void tick(); }, 3000);
    setInterval(() => { void tick(); }, 6 * 60 * 60 * 1000);
}
