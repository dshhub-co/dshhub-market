/**
 * Restart-free installs: mount a freshly installed plugin into the running
 * composition through a market-owned Include subtree.
 *
 * Durable state stays with the profile's `dsh.profile.bundles` (reconciled by
 * the dsh CLI at install time), so the next boot loads the plugin through the
 * normal bundle layer. The subtree here exists only for the current process:
 * its input files live under `<profile>/.dsh-market/` and are wiped on every
 * boot, so a crash can never leave a file that collides with the bundle layer
 * (inserting an id the bundle layer also inserts is a hard boot failure).
 * `state.json` in the same directory is the market's own durable state
 * (disable list + custom groups) and deliberately survives the wipe.
 *
 * The Include subclass suppresses `write()` — the loader otherwise persists
 * tree changes back to the file it read (see dsh's agent-presets PresetTree
 * for the in-tree precedent).
 */
import { type Channel } from './channels.ts';
interface HotRow {
    id: string;
    name: string;
}
interface PluginHandle {
    await(): Promise<unknown>;
    dispose(): Promise<unknown> | void;
}
interface HotContext {
    plugin(plugin: unknown, config: unknown): PluginHandle;
    logger?: {
        info?(message: string): void;
        warn(message: string): void;
    };
}
/**
 * Insert rows of a plugin's bundle patch, or null when the patch contains
 * anything beyond plain `id`/`name` insert rows (config blocks, disables,
 * expressions) — those compositions fall back to restart activation.
 */
export declare function parseSimplePatch(patchText: string): HotRow[] | null;
/**
 * Wipe leftover hot-mount inputs; call once when the market host starts.
 * `state.json` (disable choices + groups) deliberately survives.
 */
export declare function cleanHotDir(profileDir: string): void;
/** Persisted market state: the generic disable list plus custom groups. */
export interface MarketState {
    /** Plugins the user switched off; replayed at every boot. */
    disabled: Set<string>;
    /** User-defined plugin groups: group name → member package names. */
    groups: Record<string, string[]>;
    /** Display order of group names; "ungrouped" is implicit and never listed. */
    groupOrder: string[];
    /**
     * The release channel the user PICKED, absent until they pick one.
     *
     * Absent is not the same as 'stable': with no choice on record the channel
     * is derived from the running build, so installing a prerelease by hand
     * puts you on the beta channel without a second step. Once chosen, the
     * choice is the answer — including "stable" while a beta is running, which
     * is how someone gets back off the channel.
     */
    channel?: Channel;
}
/**
 * Read the whole market state. Legacy `disabledSkins` (the pre-#60
 * theme-only key) still loads; every new write uses the generic `disabled`
 * key (#60).
 */
export declare function readMarketState(profileDir: string): MarketState;
/** Persist the whole market state; `disabled` is the single written key. */
export declare function writeMarketState(profileDir: string, state: MarketState): void;
export interface UnlockedBundleItem {
    type: 'local' | 'github';
    pluginId?: string;
    url?: string;
    name?: string;
    kind?: string;
    tier?: string;
    /** 摘要（平台核销时返回，本地插件才有；github 条目走 registry 兜底） */
    description?: string;
    zip?: string;
}
export interface UnlockedBundleRecord {
    id: string;
    bundleId: string;
    name: string;
    description: string;
    teachingLinks: string;
    originalAuthors: string;
    sellerNote: string;
    tutorialVideo: string;
    gettingStarted: string;
    faq: string;
    supportHours: string;
    updateNote: string;
    contact: string;
    creatorName: string;
    bundleUpdatedAt: string;
    items: UnlockedBundleItem[];
    redeemedAt: string;
}
export interface UnlockedState {
    profileKey: string;
    bundles: UnlockedBundleRecord[];
}
export declare function readUnlockedState(profileDir: string): UnlockedState;
export declare function writeUnlockedState(profileDir: string, state: UnlockedState): void;
/**
 * 删除一条口令解锁记录（买家侧）：只移走卡片，已安装的插件不受影响。
 * 找不到该记录时返回 false 且不写盘（幂等）。
 */
export declare function removeUnlockedRecord(profileDir: string, id: string): boolean;
/**
 * 无感绑定：每个 profile 一次性生成的口令身份。
 * 不注册、不填手机号、不绑机器码——买家只输码，这个 key 全程自动。
 * 存于 profile 目录，重装市场 / 重启 DSH 不变。
 */
export declare function getOrCreateProfileKey(profileDir: string): string;
/** Plugins the user switched off; skipped by the boot re-mount. */
export declare function readDisabled(profileDir: string): Set<string>;
/** Persist just the disable list, preserving groups and order. */
export declare function writeDisabled(profileDir: string, disabled: Set<string>): void;
/** @deprecated theme-specific alias — kept for pre-#60 callers. */
export declare function readDisabledThemes(profileDir: string): Set<string>;
/** @deprecated theme-specific alias — kept for pre-#60 callers. */
export declare function writeDisabledThemes(profileDir: string, disabled: Set<string>): void;
/** Package names currently live through a market hot mount (patch or shim). */
export declare function listHotMounts(): string[];
/** Outcome of one hot-mount attempt; `reason` explains non-`ok` results. */
export interface HotMountResult {
    ok: boolean;
    /** Bilingual reason shown to the user instead of a bare restart banner. */
    reason: string | null;
}
/**
 * Dispose a plugin hot-mounted earlier in this session, removing it from the
 * running composition immediately.
 * @param packageName - package to unmount.
 * @returns true when a live hot mount was found and disposed.
 */
export declare function hotUnmount(packageName: string): Promise<boolean>;
/**
 * Mount `packageName` (just installed into the profile) into the running
 * composition.
 * @param ctx - market host context; the subtree unwinds with the market's fiber.
 * @param profileDir - profile the package was installed into.
 * @param packageName - installed package to activate.
 * @returns whether the plugin is live without a restart, plus the reason
 * when it is not (P0-2: the UI must distinguish "restart will fix it" from
 * "this package can never hot-mount").
 */
export declare function hotMount(ctx: HotContext, profileDir: string, packageName: string): Promise<HotMountResult>;
/**
 * Mount every installed client-only package (`dsh.client` without
 * `dsh.bundle`) at market startup. The bundle reconcile skips these packages
 * entirely, so without the market's shim their client bundles are unreachable
 * in every boot — this is what makes them behave like normal plugins.
 * @returns names that were mounted.
 */
export declare function mountClientOnlyDeps(ctx: HotContext, profileDir: string): Promise<string[]>;
/**
 * Row ids and package names the user's own patch layer (cordis.patch.yml)
 * already contains. Line-wise scan on purpose: the file may hold structures
 * the market's strict patch parser rejects, but any mention of a row id or
 * package name is enough to know the user manages it (#58).
 */
export declare function readUserPatchControls(profileDir: string): {
    ids: Set<string>;
    names: Set<string>;
};
/**
 * Whether the user patch layer manages `name` — matched by exact package
 * name or by the plugin-manager row-id convention (strip the leading @,
 * non-alphanumerics to '-', lowercase).
 */
export declare function patchLayerManages(controls: {
    ids: Set<string>;
    names: Set<string>;
}, name: string): boolean;
/**
 * Delete the market's own state directory.
 *
 * `cleanHotDir` wipes the ephemeral hot-mount inputs on every boot but
 * deliberately preserves `state.json` — the disable list and custom groups
 * are the user's durable choices. Uninstalling the market is the one moment
 * where removing them is the right thing, and only when the user asked.
 * @returns true when a directory was there to remove.
 */
export declare function purgeMarketState(profileDir: string): boolean;
export {};
