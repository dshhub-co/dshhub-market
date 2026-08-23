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
export interface AppRunState {
    running: boolean;
    pid?: number;
    port?: number;
    url?: string;
    startedAt?: string;
}
/**
 * 运行状态（跨请求重查，防 runtime.json 与真实进程脱节）：
 * 记录在案但进程已死 → 清理记录并回报 stopped。
 */
export declare function appStatus(name: string): AppRunState;
/** 全部已安装应用的运行状态（status 路由用）。 */
export declare function listAppStatus(): Record<string, AppRunState>;
/**
 * 部署：build（首次）→ 随机端口 → spawn start → 登记 runtime.json。
 * 返回浏览器地址 http://127.0.0.1:<port>。
 */
export declare function deployApp(name: string): Promise<{
    url: string;
    pid: number;
    port: number;
    built: boolean;
}>;
/** 停止：killTree（SIGTERM → 5s SIGKILL）并清 runtime.json。 */
export declare function stopApp(name: string): Promise<{
    stopped: boolean;
}>;
