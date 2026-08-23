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
import type { RegistryPlugin } from './registry.ts';
/** Bookkeeping dir inside the apps root. */
export declare const APP_STATE_DIR = ".dshhub";
/** Deployable apps root: <dsh-home>/apps/ (independent of DSH's plugin roots). */
export declare function appsRoot(): string;
/** Shared runtime registry file (see app-runtime.ts) — path defined here so
 * install/uninstall can guard against a running instance without a circular
 * import. */
export declare function runtimeStatePath(): string;
export interface AppAuditSummary {
    /** pass | warn（deny 的条目平台根本不会上架） */
    level?: string;
    /** 给买家的中文安全结论 */
    summary?: string;
    /** 审核模型标识（heuristic = 决定性规则短路，未调 LLM） */
    model?: string;
    /** 审核时间（ISO） */
    audited_at?: string;
    /** 审核绑定的 zip sha256（与买家实际下载的 dist 一一对应） */
    sha256?: string;
}
export interface InstalledApp {
    /** Package (manifest) name, also the installed-map key. */
    name: string;
    version: string;
    /** manifest v2 部署字段（GitHub 导入上架时经平台 AI 审核） */
    start: string;
    build: string | null;
    port: number | null;
    url: string;
    installedAt: string;
    /** AI 审核摘要（随口令核销载荷下发；平台未审核过的旧条目没有） */
    audit?: AppAuditSummary;
    /** build 命令首次部署前执行过且成功（写回状态记录，只构建一次） */
    built?: boolean;
}
/** Installed app packages: package name → record. */
export declare function readInstalledApps(): Record<string, InstalledApp>;
/** Installed-map entries for app packages: name → `app:<url>` spec. */
export declare function appSpecMap(): Record<string, string>;
/** App-installed lookup used by the uninstall guard. */
export declare function isInstalledApp(name: string): boolean;
/**
 * Install a kind=app catalog entry: download → validate → copy every file
 * into <dsh-home>/apps/<name>/. Throws with a Chinese error on failure.
 */
export declare function installApp(entry: RegistryPlugin, opts?: {
    expectedSha256?: string;
}): Promise<InstalledApp>;
/**
 * Remove the app directory a package brought in, then its state record.
 * Refuses while the app is running (deploy must stop it first).
 */
export declare function uninstallApp(name: string): boolean;
