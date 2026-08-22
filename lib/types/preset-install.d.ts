/**
 * Preset install path (manifest v2, kind=preset): presets are DSH agent mode
 * directories (agent.cordis.yml) that define a complete persona + tool combo.
 * This module downloads the entry's zip, validates the preset structure, and
 * copies each preset directory into <profile>/agent-presets/<preset-name>/.
 *
 * Installed state is recorded under <profile>/agent-presets/.dshhub/<package>.json
 * so uninstall can remove exactly the directories one package brought in.
 */
import type { RegistryPlugin } from './registry.ts';
/** Bookkeeping dir inside the presets root (hidden from DSH's own scan). */
export declare const PRESET_STATE_DIR = ".dshhub";
export interface InstalledPreset {
    /** Package (manifest) name, also the installed-map key. */
    name: string;
    version: string;
    /** Preset dir names copied into the profile agent-presets root. */
    presets: string[];
    url: string;
    installedAt: string;
}
/** Profile agent-presets root (may not exist yet). */
export declare function presetsRoot(profileDirectory: string): string;
/** Installed preset packages: package name → record. */
export declare function readInstalledPresets(profileDirectory: string): Record<string, InstalledPreset>;
/** Installed-map entries for preset packages: name → `preset:<url>` spec. */
export declare function presetSpecMap(profileDirectory: string): Record<string, string>;
/**
 * Install a kind=preset catalog entry: download → validate → copy preset dirs
 * into <profile>/agent-presets/. Throws with a Chinese error on failure.
 */
export declare function installPreset(profileDirectory: string, entry: RegistryPlugin): Promise<InstalledPreset>;
/** Remove every preset dir a package brought in, then its state record. */
export declare function uninstallPreset(profileDirectory: string, name: string): boolean;
/** Preset-installed lookup used by the uninstall guard. */
export declare function isInstalledPreset(profileDirectory: string, name: string): boolean;
