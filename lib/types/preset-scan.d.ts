/**
 * Scan the local DSH for custom agent presets and skills that the creator
 * can publish to the market:
 *   - presets: DSH's user preset root <dsh-home>/.agent-presets/ — the ONLY
 *     local root DSH's Agent picker scans. The market installs there too
 *     (installPreset); clients ≤0.8.13 used <profile>/agent-presets/, which
 *     DSH never read — migrateLegacyPresets() moved those over. The legacy
 *     profile root is still scanned below for profiles that predate the
 *     migration, then dropped once it is gone.
 *   - skills: SKILL.md under <dsh-home>/skills (DSH's user-level skill root,
 *     the official home for personal skills — visible to any session) plus
 *     <profile>/skills/ (the market's kind=skill install location).
 */
export interface ScannedItem {
    kind: 'preset' | 'skill';
    dir: string;
    name: string;
    displayName: string;
    description: string;
    path: string;
}
/**
 * Scan preset roots for preset directories (each containing agent.cordis.yml).
 * 元数据：preset.yml（DSH 原生作者元数据）优先，其次 agent.cordis.yml 顶层
 * name/description，最后回退目录名——创作者不需要为发布额外写任何文件。
 */
export declare function scanPresets(profileDirectory: string): ScannedItem[];
/**
 * Scan both skill roots for skill directories (containing SKILL.md).
 * Each directory with a valid frontmatter name is a candidate.
 */
export declare function scanSkills(profileDirectory: string): ScannedItem[];
