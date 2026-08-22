/**
 * Scan the local DSH profile for custom agent presets (agent.cordis.yml files
 * under <profile>/agent-presets/) and skills (SKILL.md under <profile>/skills/)
 * that the creator can publish to the market.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const PRESET_YML = 'agent.cordis.yml';
const SKILL_MD = 'SKILL.md';
/** Hidden state dirs that should never be scanned as publishable content. */
const SKIP_DIRS = new Set(['.dshhub', '.git', 'node_modules', '__MACOSX']);
function isDir(path) {
    try {
        return statSync(path).isDirectory();
    }
    catch {
        return false;
    }
}
/**
 * Scan <profile>/agent-presets/ for preset directories.
 * Each directory containing agent.cordis.yml is a candidate.
 */
export function scanPresets(profileDirectory) {
    const root = join(profileDirectory, 'agent-presets');
    if (!existsSync(root))
        return [];
    const out = [];
    for (const name of readdirSync(root)) {
        if (name.startsWith('.') || SKIP_DIRS.has(name))
            continue;
        const dir = join(root, name);
        if (!isDir(dir))
            continue;
        const ymlPath = join(dir, PRESET_YML);
        if (!existsSync(ymlPath) || !statSync(ymlPath).isFile())
            continue;
        let displayName = name;
        let description = '';
        try {
            const text = readFileSync(ymlPath, 'utf8');
            const lines = text.split(/\r?\n/);
            for (const line of lines) {
                const idx = line.indexOf(':');
                if (idx <= 0 || line.startsWith(' ') || line.startsWith('#'))
                    continue;
                const key = line.slice(0, idx).trim();
                const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
                if (key === 'name' && value)
                    displayName = value;
                else if (key === 'description' && value)
                    description = value;
            }
        }
        catch {
            // unreadable yml — still include with defaults
        }
        out.push({
            kind: 'preset',
            dir: `presets/${name}`,
            name,
            displayName,
            description,
            path: dir,
        });
    }
    return out;
}
/**
 * Scan <profile>/skills/ for skill directories (containing SKILL.md).
 * Each directory with a valid frontmatter name is a candidate.
 */
export function scanSkills(profileDirectory) {
    const root = join(profileDirectory, 'skills');
    if (!existsSync(root))
        return [];
    const out = [];
    for (const name of readdirSync(root)) {
        if (name.startsWith('.') || SKIP_DIRS.has(name))
            continue;
        const dir = join(root, name);
        if (!isDir(dir))
            continue;
        const mdPath = join(dir, SKILL_MD);
        if (!existsSync(mdPath) || !statSync(mdPath).isFile())
            continue;
        let displayName = name;
        let description = '';
        try {
            const text = readFileSync(mdPath, 'utf8');
            let inFront = false;
            let started = false;
            for (const line of text.split(/\r?\n/)) {
                if (!started) {
                    if (line.trim() === '---') {
                        started = true;
                        inFront = true;
                    }
                    continue;
                }
                if (inFront) {
                    if (line.trim() === '---')
                        break;
                    const idx = line.indexOf(':');
                    if (idx > 0) {
                        const key = line.slice(0, idx).trim();
                        const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
                        if (key === 'name' && value)
                            displayName = value;
                        else if (key === 'description' && value)
                            description = value;
                    }
                }
            }
        }
        catch {
            // unreadable md — still include with defaults
        }
        out.push({
            kind: 'skill',
            dir: `skills/${name}`,
            name,
            displayName,
            description,
            path: dir,
        });
    }
    return out;
}
