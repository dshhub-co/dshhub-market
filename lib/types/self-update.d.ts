/**
 * fork (dshhub): self-update over the dshhub.co tarball channel instead of
 * npm. `dshhub-market` is never published to npm, so the market updates
 * itself by polling the site's version endpoint and reinstalling from the
 * published tarball — the same channel the legacy plugin used, so existing
 * installs upgrade in place.
 */
/** The fork's own package name (its profile manifest key). */
export declare const FORK_SELF_NAME = "dshhub-market";
export declare function updateBase(): string;
/**
 * The published tarball for the current channel (v1: one public channel).
 * 版本化 URL 是必须的：profile 里的依赖 spec 若不变化（同一个 tgz 地址），
 * pnpm 会判定 "Already up to date" 而不重新下载——「更新命令执行完成，但
 * 版本没有变化」就是这么来的。带上版本号后每次更新都是新 spec，必然重装。
 * 无版本的裸地址仍留给安装向导使用（/dshhub-market.tgz）。
 */
export declare function selfUpdateTarget(base?: string, version?: string): string;
/** This package's own version, read from its installed package.json. */
export declare function readOwnVersion(): string;
/** Latest published version per the site's version endpoint, or null. */
export declare function fetchOwnVersion(base?: string): Promise<string | null>;
/**
 * Poll the version endpoint; when a newer release is published, reinstall
 * this package from the tarball (the DSH CLI replaces the same-name dep in
 * the profile manifest). Opt-out: DSHHUB_DISABLE_AUTOUPDATE=1.
 */
export declare function scheduleSelfUpdate(profile: string): void;
