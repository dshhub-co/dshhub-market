/**
 * Preset install path (manifest v2, kind=preset): presets are DSH agent mode
 * directories (agent.cordis.yml) that define a complete persona + tool combo.
 * This module downloads the entry's zip, validates the preset structure, and
 * copies each preset directory into DSH's user preset root:
 * <dsh-home>/.agent-presets/<preset-name>/.
 *
 * That home root — NOT <profile>/agent-presets/ — is the only local root DSH's
 * Agent preset picker scans (dsh's profile-boot overrides the agent-presets
 * roots to the shipped system presets plus dshHomePath(".agent-presets")).
 * Clients before 0.8.14 installed into <profile>/agent-presets/, a location
 * DSH never read: installs "succeeded" yet never appeared in the picker.
 * migrateLegacyPresets() moves those old installs over on first read.
 *
 * Installed state is recorded under <root>/.dshhub/<package>.json (the .dshhub
 * dir name never matches DSH's PRESET_ID /^[a-z0-9][a-z0-9-]*$/, so the scan
 * skips it) so uninstall can remove exactly the directories one package
 * brought in.
 */
import type { RegistryPlugin } from './registry.ts';
/** Bookkeeping dir inside the presets root (hidden from DSH's own scan). */
export declare const PRESET_STATE_DIR = ".dshhub";
export interface InstalledPreset {
    /** Package (manifest) name, also the installed-map key. */
    name: string;
    version: string;
    /** Preset dir names copied into the DSH user preset root. */
    presets: string[];
    url: string;
    installedAt: string;
}
/** DSH home: the root DSH resolves preset dirs against (mirrors profile.ts). */
export declare function dshHome(): string;
/**
 * DSH user preset root — the directory DSH's Agent preset picker scans for
 * user-authored presets (dshHomePath(".agent-presets")). May not exist yet.
 */
export declare function presetsRoot(_profileDirectory: string): string;
/** Installed preset packages: package name → record (new root, post-migration). */
export declare function readInstalledPresets(profileDirectory: string): Record<string, InstalledPreset>;
/** Installed-map entries for preset packages: name → `preset:<url>` spec. */
export declare function presetSpecMap(profileDirectory: string): Record<string, string>;
/**
 * Install a kind=preset catalog entry: download → validate → copy preset dirs
 * into <dsh-home>/.agent-presets/. Throws with a Chinese error on failure.
 */
export declare function installPreset(profileDirectory: string, entry: RegistryPlugin): Promise<InstalledPreset>;
/** Remove every preset dir a package brought in, then its state record. */
export declare function uninstallPreset(profileDirectory: string, name: string): boolean;
/** Preset-installed lookup used by the uninstall guard. */
export declare function isInstalledPreset(profileDirectory: string, name: string): boolean;
