/**
 * Scan the local DSH for custom agent presets and skills that the creator
 * can publish to the market:
 *   - presets: <profile>/agent-presets/ (market-installed) AND the DSH-wide
 *     library <dsh-home>/.agent-presets/ (creator-authored modes — "已调好的
 *     模式"), each candidate dir containing agent.cordis.yml
 *   - skills: SKILL.md under <profile>/skills/
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
 * Scan <profile>/skills/ for skill directories (containing SKILL.md).
 * Each directory with a valid frontmatter name is a candidate.
 */
export declare function scanSkills(profileDirectory: string): ScannedItem[];
