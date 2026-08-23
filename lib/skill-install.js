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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';
import { marketFetch } from './net.js';
import { dshHome } from './preset-install.js';
/** Bookkeeping dir inside the skills root (hidden from the agent's skill scan). */
export const SKILL_STATE_DIR = '.dshhub';
/** DSH user skills root ~/.dsh/skills (may not exist yet). */
export function skillsRoot(_profileDirectory) {
    return join(dshHome(), 'skills');
}
function statePath(_profileDirectory, name) {
    return join(dshHome(), 'skills', SKILL_STATE_DIR, `${name}.json`);
}
function safeName(value) {
    return value.replace(/[^A-Za-z0-9._-]/g, '-');
}
/** Installed skill packages: package name → record. */
export function readInstalledSkills(_profileDirectory) {
    const dir = join(dshHome(), 'skills', SKILL_STATE_DIR);
    if (!existsSync(dir))
        return {};
    const out = {};
    for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json'))
            continue;
        try {
            const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'));
            if (typeof parsed.name === 'string' && parsed.name !== '')
                out[parsed.name] = parsed;
        }
        catch {
            // corrupted record — ignore, it only hides an installed state
        }
    }
    return out;
}
/** Installed-map entries for skill packages: name → `skill:<url>` spec. */
export function skillSpecMap(profileDirectory) {
    const out = {};
    for (const [name, skill] of Object.entries(readInstalledSkills(profileDirectory))) {
        out[name] = `skill:${skill.url}`;
    }
    return out;
}
/** Parse the `name:` line of a SKILL.md frontmatter (minimal key: value). */
export function skillFrontmatterName(md) {
    const lines = md.split(/\r?\n/);
    let started = false;
    let inFront = false;
    for (const line of lines) {
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
                if (key === 'name') {
                    return line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
                }
            }
        }
    }
    return '';
}
/** Locate manifest.json at the zip root or under a single wrapper dir. */
function locateManifest(entries) {
    const atRoot = entries['manifest.json'];
    if (atRoot !== undefined) {
        return { manifest: JSON.parse(new TextDecoder().decode(atRoot)), rooted: entries };
    }
    const topDirs = new Set();
    for (const name of Object.keys(entries)) {
        if (name.includes('/'))
            topDirs.add(name.split('/')[0]);
    }
    if (topDirs.size === 1) {
        const dir = [...topDirs][0];
        const mf = entries[`${dir}/manifest.json`];
        if (mf !== undefined) {
            const rooted = {};
            for (const [name, data] of Object.entries(entries)) {
                if (name.startsWith(`${dir}/`) && name.length > dir.length + 1) {
                    rooted[name.slice(dir.length + 1)] = data;
                }
            }
            return { manifest: JSON.parse(new TextDecoder().decode(mf)), rooted };
        }
    }
    throw new Error('压缩包缺少根目录 manifest.json');
}
function assertSafePath(name) {
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
        throw new Error(`压缩包含非法路径：${name}`);
    }
}
/**
 * Install a kind=skill catalog entry: download → validate → copy skill dirs
 * into the profile skills root. Throws with a Chinese error on failure.
 */
export async function installSkill(_profileDirectory, entry) {
    if (typeof entry.zip !== 'string' || entry.zip === '') {
        throw new Error('该技能包没有可下载的 zip 源');
    }
    let zipBytes;
    try {
        const response = await marketFetch(entry.zip, { signal: AbortSignal.timeout(180_000) });
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        zipBytes = Buffer.from(await response.arrayBuffer());
    }
    catch (error) {
        throw new Error(`下载技能包失败（${entry.zip}）：${error instanceof Error ? error.message : String(error)}`);
    }
    if (zipBytes.byteLength < 22)
        throw new Error('技能包无效（空文件）');
    const entries = unzipSync(new Uint8Array(zipBytes));
    const { manifest, rooted } = locateManifest(entries);
    if (manifest.kind !== 'skill') {
        throw new Error(`该包 kind=${String(manifest.kind ?? '')}，不是技能包（skill）`);
    }
    if (typeof manifest.name !== 'string' || manifest.name === '')
        throw new Error('manifest.json 缺少 name');
    const skillDirs = Array.isArray(manifest.skills)
        ? manifest.skills.filter((s) => typeof s === 'string' && s.trim() !== '').map(s => s.replace(/^\.?\//, '').replace(/\/+$/, ''))
        : ['skills'];
    const skillNames = [];
    const copied = [];
    for (const dir of skillDirs) {
        let mdText = null;
        for (const n of ['SKILL.md', 'skill.md']) {
            const data = rooted[`${dir}/${n}`];
            if (data !== undefined) {
                mdText = new TextDecoder().decode(data);
                break;
            }
        }
        if (mdText === null)
            throw new Error(`技能目录缺少 SKILL.md：${dir}`);
        const skillName = skillFrontmatterName(mdText);
        if (skillName === '')
            throw new Error(`${dir}/SKILL.md 的 frontmatter 缺少 name`);
        skillNames.push(skillName);
        // Copy every file under the skill dir into <user-skills-root>/<skillName>/
        const dest = join(dshHome(), 'skills', skillName);
        rmSync(dest, { recursive: true, force: true });
        let count = 0;
        for (const [name, data] of Object.entries(rooted)) {
            if (name === dir || !name.startsWith(`${dir}/`))
                continue;
            if (name.endsWith('/'))
                continue; // directory entry
            const base = name.split('/').pop() ?? '';
            if (name.startsWith('__MACOSX/') || base === '.DS_Store' || base.startsWith('._'))
                continue;
            const rel = name.slice(dir.length + 1);
            assertSafePath(rel);
            const target = join(dest, rel);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, data);
            count++;
        }
        if (count === 0)
            throw new Error(`技能目录为空：${dir}`);
        copied.push(skillName);
    }
    // Record installed state for uninstall / listing.
    const record = {
        name: safeName(manifest.name),
        version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
        skills: copied,
        skillNames,
        url: entry.url,
        installedAt: new Date().toISOString(),
    };
    mkdirSync(join(dshHome(), 'skills', SKILL_STATE_DIR), { recursive: true });
    writeFileSync(statePath(dshHome(), record.name), JSON.stringify(record, null, 2));
    return record;
}
/** Remove every skill dir a package brought in, then its state record. */
export function uninstallSkill(_profileDirectory, name) {
    const record = readInstalledSkills(dshHome())[name];
    if (record === undefined)
        return false;
    for (const dir of record.skills) {
        rmSync(join(dshHome(), 'skills', dir), { recursive: true, force: true });
    }
    rmSync(statePath(dshHome(), name), { force: true });
    return true;
}
/** Skill-installed lookup used by the uninstall guard. */
export function isInstalledSkill(profileDirectory, name) {
    return readInstalledSkills(profileDirectory)[name] !== undefined;
}
