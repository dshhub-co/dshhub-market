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
import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dshHome, presetsRoot } from './preset-install.js';
const PRESET_YML = 'agent.cordis.yml';
const PRESET_META = 'preset.yml';
const SKILL_MD = 'SKILL.md';
/** 市场安装的状态目录：preset 在 <preset-root>/.dshhub/，skill 在 ~/.dsh/skills/.dshhub/ */
const INSTALL_STATE_DIR = '.dshhub';
/** Hidden state dirs that should never be scanned as publishable content. */
const SKIP_DIRS = new Set(['.dshhub', '.git', 'node_modules', '__MACOSX']);
/**
 * 来源指纹：解析状态目录下所有 .dshhub/*.json，收集「市场安装过的目录名」。
 * 状态文件名是包名（如 dshhub-auto-cut.json），但里面 presets/skills 字段才是
 * 实际安装的目录名（如 ["auto-cut"]）——按目录名查同名状态文件会失配（0.8.48 bug）。
 */
function marketInstalledDirs(stateDir, dirField) {
    const out = new Set();
    try {
        for (const f of readdirSync(stateDir)) {
            if (!f.endsWith('.json'))
                continue;
            const rec = JSON.parse(readFileSync(join(stateDir, f), 'utf8'));
            const dirs = rec[dirField];
            if (Array.isArray(dirs)) {
                for (const d of dirs)
                    if (typeof d === 'string' && d !== '')
                        out.add(d);
            }
        }
    }
    catch {
        /* 无状态目录 = 没有市场安装过 */
    }
    return out;
}
function isDir(path) {
    try {
        return statSync(path).isDirectory();
    }
    catch {
        return false;
    }
}
/** 极简 YAML 顶层标量解析：取 name / description 两个键，读不到返回空。 */
function readYamlKeys(file) {
    try {
        const text = readFileSync(file, 'utf8');
        const out = {};
        for (const line of text.split(/\r?\n/)) {
            const idx = line.indexOf(':');
            if (idx <= 0 || line.startsWith(' ') || line.startsWith('#'))
                continue;
            const key = line.slice(0, idx).trim();
            const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
            if (key === 'name' && out.name === undefined && value)
                out.name = value;
            else if (key === 'description' && out.description === undefined && value)
                out.description = value;
        }
        return out;
    }
    catch {
        return {};
    }
}
/**
 * 一个 profile 可发布的预设来源：
 *   - <dsh-home>/.agent-presets/ DSH 全局预设库（市场安装位 + 创作者自调模式）
 *   - <profile>/agent-presets/   0.8.14 之前的遗留安装位（迁移后应为空）
 * 默认布局 <home>/profiles/<name> → <home>/.agent-presets；显式目录主机
 * （desktop 自管 profile 位置）若猜不到库路径，由 existsSync 兜底跳过。
 */
function presetRoots(profileDirectory) {
    // DSH's user preset root first — the real location the market installs into
    // and DSH's picker reads. The legacy profile-local root is scanned second
    // for pre-migration residue, so a duplicate there never shadows the root.
    const roots = [presetsRoot(profileDirectory)];
    roots.push(join(profileDirectory, 'agent-presets'));
    return roots.filter(existsSync);
}
/**
 * Scan preset roots for preset directories (each containing agent.cordis.yml).
 * 元数据：preset.yml（DSH 原生作者元数据）优先，其次 agent.cordis.yml 顶层
 * name/description，最后回退目录名——创作者不需要为发布额外写任何文件。
 */
export function scanPresets(profileDirectory) {
    const out = [];
    const seen = new Set();
    const marketPresets = marketInstalledDirs(join(presetsRoot(profileDirectory), INSTALL_STATE_DIR), 'presets');
    for (const root of presetRoots(profileDirectory)) {
        for (const name of readdirSync(root)) {
            if (name.startsWith('.') || SKIP_DIRS.has(name))
                continue;
            if (seen.has(name))
                continue; // 库根优先，遗留 profile 根同名不重复
            const dir = join(root, name);
            if (!isDir(dir))
                continue;
            const ymlPath = join(dir, PRESET_YML);
            if (!existsSync(ymlPath) || !statSync(ymlPath).isFile())
                continue;
            const meta = { ...readYamlKeys(ymlPath), ...readYamlKeys(join(dir, PRESET_META)) };
            seen.add(name);
            out.push({
                kind: 'preset',
                dir: `presets/${name}`,
                name,
                displayName: meta.name ?? name,
                description: meta.description ?? '',
                path: dir,
                installSource: marketPresets.has(name) ? 'market' : 'user',
            });
        }
    }
    return out;
}
/**
 * DSH skill roots that can yield publishable skills:
 *   - <dsh-home>/skills — DSH's user-level skill root (user-dsh source, rank
 *     400): the official home for personal skills, visible to any session.
 *     User-authored skills (e.g. koubo-cover) live here.
 *   - <profile>/skills/ — the market's install location for kind=skill
 *     packages (manifest v2 §5 copies each skill dir here).
 * The user root is scanned first, so a same-name skill in the profile root
 * never shadows the official one.
 */
function skillRoots(profileDirectory) {
    const roots = [join(dshHome(), 'skills')];
    roots.push(join(profileDirectory, 'skills'));
    return roots.filter(existsSync);
}
/**
 * Scan both skill roots for skill directories (containing SKILL.md).
 * Each directory with a valid frontmatter name is a candidate.
 */
export function scanSkills(profileDirectory) {
    const out = [];
    const seen = new Set();
    const marketSkills = marketInstalledDirs(join(dshHome(), 'skills', INSTALL_STATE_DIR), 'skills');
    for (const root of skillRoots(profileDirectory)) {
        for (const name of readdirSync(root)) {
            if (name.startsWith('.') || SKIP_DIRS.has(name))
                continue;
            if (seen.has(name))
                continue; // 用户级根优先，profile 根同名不重复
            const dir = join(root, name);
            if (!isDir(dir))
                continue;
            const mdPath = join(dir, SKILL_MD);
            if (!existsSync(mdPath) || !statSync(mdPath).isFile())
                continue;
            seen.add(name);
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
                installSource: marketSkills.has(name) ? 'market' : 'user',
            });
        }
    }
    return out;
}
