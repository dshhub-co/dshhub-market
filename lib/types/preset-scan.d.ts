/**
 * Scan the local DSH profile for custom agent presets (agent.cordis.yml files
 * under <profile>/agent-presets/) and skills (SKILL.md under <profile>/skills/)
 * that the creator can publish to the market.
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
 * Scan <profile>/agent-presets/ for preset directories.
 * Each directory containing agent.cordis.yml is a candidate.
 */
export declare function scanPresets(profileDirectory: string): ScannedItem[];
/**
 * Scan <profile>/skills/ for skill directories (containing SKILL.md).
 * Each directory with a valid frontmatter name is a candidate.
 */
export declare function scanSkills(profileDirectory: string): ScannedItem[];
