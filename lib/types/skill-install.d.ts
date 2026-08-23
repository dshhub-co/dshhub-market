/**
 * Skill-bundle install path (manifest v2, kind=skill): skills are Codex-style
 * directories (SKILL.md + agents/ + scripts/ + assets/) that the agent
 * consumes directly — they are NOT npm packages, so they never go through
 * pnpm. This module downloads the entry's zip, validates the skill structure,
 * and copies each skill directory into the DSH user skills root
 * ~/.dsh/skills/<skill-name>/ — DSH only loads skills from that root;
 * the profile-level <profile>/skills/ is not scanned (user-verified).
 *
 * Installed state is recorded under ~/.dsh/skills/.dshhub/<package>.json
 * so uninstall can remove exactly the directories one package brought in.
 */
import type { RegistryPlugin } from './registry.ts';
/** Bookkeeping dir inside the skills root (hidden from the agent's skill scan). */
export declare const SKILL_STATE_DIR = ".dshhub";
export interface InstalledSkill {
    /** Package (manifest) name, also the installed-map key. */
    name: string;
    version: string;
    /** Skill dir names copied into the user skills root. */
    skills: string[];
    /** Frontmatter names from each SKILL.md. */
    skillNames: string[];
    url: string;
    installedAt: string;
}
/** DSH user skills root ~/.dsh/skills (may not exist yet). */
export declare function skillsRoot(_profileDirectory: string): string;
/** Installed skill packages: package name → record. */
export declare function readInstalledSkills(_profileDirectory: string): Record<string, InstalledSkill>;
/** Installed-map entries for skill packages: name → `skill:<url>` spec. */
export declare function skillSpecMap(profileDirectory: string): Record<string, string>;
/** Parse the `name:` line of a SKILL.md frontmatter (minimal key: value). */
export declare function skillFrontmatterName(md: string): string;
/**
 * Install a kind=skill catalog entry: download → validate → copy skill dirs
 * into the profile skills root. Throws with a Chinese error on failure.
 */
export declare function installSkill(_profileDirectory: string, entry: RegistryPlugin): Promise<InstalledSkill>;
/** Remove every skill dir a package brought in, then its state record. */
export declare function uninstallSkill(_profileDirectory: string, name: string): boolean;
/** Skill-installed lookup used by the uninstall guard. */
export declare function isInstalledSkill(profileDirectory: string, name: string): boolean;
