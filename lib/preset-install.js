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
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';
import { marketFetch } from './net.js';
/** Bookkeeping dir inside the presets root (hidden from DSH's own scan). */
export const PRESET_STATE_DIR = '.dshhub';
/** DSH home: the root DSH resolves preset dirs against (mirrors profile.ts). */
export function dshHome() {
    return process.env.DSH_HOME ?? join(homedir(), '.dsh');
}
/**
 * DSH user preset root — the directory DSH's Agent preset picker scans for
 * user-authored presets (dshHomePath(".agent-presets")). May not exist yet.
 */
export function presetsRoot(_profileDirectory) {
    return join(dshHome(), '.agent-presets');
}
/** Legacy root (<profile>/agent-presets/) used by clients before 0.8.14. */
function legacyPresetsRoot(profileDirectory) {
    return join(profileDirectory, 'agent-presets');
}
function statePathAt(root, name) {
    return join(root, PRESET_STATE_DIR, `${name}.json`);
}
/** Installed preset packages: package name → record, read from one root. */
function readInstalledPresetsAt(root) {
    const dir = join(root, PRESET_STATE_DIR);
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
            // corrupted record — ignore
        }
    }
    return out;
}
/**
 * One-time migration from the legacy profile-local root (≤0.8.13) into DSH's
 * user preset root. The old location was never scanned by DSH, so presets
 * installed there never appeared in the Agent picker. Each state record and
 * the preset dirs it tracks move to the new root; the legacy state dir and an
 * emptied legacy root are removed. Untracked files left behind are untouched.
 * State is written AFTER the dirs so an interrupted migration self-heals: a
 * dir without state is just "not installed" and the next install overwrites
 * it; state without a dir would make uninstall delete nothing.
 */
function migrateLegacyPresets(profileDirectory) {
    const legacy = legacyPresetsRoot(profileDirectory);
    if (!existsSync(join(legacy, PRESET_STATE_DIR)))
        return;
    const root = presetsRoot(profileDirectory);
    const records = readInstalledPresetsAt(legacy);
    for (const record of Object.values(records)) {
        if (existsSync(statePathAt(root, record.name)))
            continue; // newer state already there
        for (const dir of record.presets) {
            const src = join(legacy, dir);
            if (!existsSync(src))
                continue;
            const dest = join(root, dir);
            rmSync(dest, { recursive: true, force: true });
            try {
                renameSync(src, dest);
            }
            catch {
                // rename failure (e.g. cross-device) — copy then remove instead
                rmSync(dest, { recursive: true, force: true });
                cpSync(src, dest, { recursive: true });
                rmSync(src, { recursive: true, force: true });
            }
        }
        mkdirSync(join(root, PRESET_STATE_DIR), { recursive: true });
        writeFileSync(statePathAt(root, record.name), JSON.stringify(record, null, 2));
    }
    rmSync(join(legacy, PRESET_STATE_DIR), { recursive: true, force: true });
    try {
        // Finder's .DS_Store residue doesn't count as content worth keeping.
        if (readdirSync(legacy).every(name => name.startsWith('.'))) {
            rmSync(legacy, { recursive: true, force: true });
        }
    }
    catch { /* legacy root unreadable — leave it */ }
}
function safeName(value) {
    return value.replace(/[^A-Za-z0-9._-]/g, '-');
}
/** Installed preset packages: package name → record (new root, post-migration). */
export function readInstalledPresets(profileDirectory) {
    migrateLegacyPresets(profileDirectory);
    return readInstalledPresetsAt(presetsRoot(profileDirectory));
}
/** Installed-map entries for preset packages: name → `preset:<url>` spec. */
export function presetSpecMap(profileDirectory) {
    const out = {};
    for (const [name, preset] of Object.entries(readInstalledPresets(profileDirectory))) {
        out[name] = `preset:${preset.url}`;
    }
    return out;
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
 * Install a kind=preset catalog entry: download → validate → copy preset dirs
 * into <dsh-home>/.agent-presets/. Throws with a Chinese error on failure.
 */
export async function installPreset(profileDirectory, entry) {
    migrateLegacyPresets(profileDirectory);
    const root = presetsRoot(profileDirectory);
    if (typeof entry.zip !== 'string' || entry.zip === '') {
        throw new Error('该预设包没有可下载的 zip 源');
    }
    let zipBytes;
    try {
        const response = await marketFetch(entry.zip, { signal: AbortSignal.timeout(180_000) });
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        zipBytes = Buffer.from(await response.arrayBuffer());
    }
    catch (error) {
        throw new Error(`下载预设包失败（${entry.zip}）：${error instanceof Error ? error.message : String(error)}`);
    }
    if (zipBytes.byteLength < 22)
        throw new Error('预设包无效（空文件）');
    const entries = unzipSync(new Uint8Array(zipBytes));
    const { manifest, rooted } = locateManifest(entries);
    if (manifest.kind !== 'preset') {
        throw new Error(`该包 kind=${String(manifest.kind ?? '')}，不是预设包（preset）`);
    }
    if (typeof manifest.name !== 'string' || manifest.name === '')
        throw new Error('manifest.json 缺少 name');
    const presetDirs = Array.isArray(manifest.presets)
        ? manifest.presets.filter((s) => typeof s === 'string' && s.trim() !== '').map(s => s.replace(/^\.?\//, '').replace(/\/+$/, ''))
        : ['presets'];
    const copied = [];
    for (const dir of presetDirs) {
        const ymlData = rooted[`${dir}/agent.cordis.yml`];
        if (ymlData === undefined)
            throw new Error(`预设目录缺少 agent.cordis.yml：${dir}`);
        // Use the directory basename as the installed preset name (matches DSH convention).
        const presetName = dir.split('/').pop() ?? dir;
        const dest = join(root, presetName);
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
            throw new Error(`预设目录为空：${dir}`);
        copied.push(presetName);
    }
    // Record installed state for uninstall / listing.
    const record = {
        name: safeName(manifest.name),
        version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
        presets: copied,
        url: entry.url,
        installedAt: new Date().toISOString(),
    };
    mkdirSync(join(root, PRESET_STATE_DIR), { recursive: true });
    writeFileSync(statePathAt(root, record.name), JSON.stringify(record, null, 2));
    return record;
}
/** Remove every preset dir a package brought in, then its state record. */
export function uninstallPreset(profileDirectory, name) {
    const record = readInstalledPresets(profileDirectory)[name];
    if (record === undefined)
        return false;
    const root = presetsRoot(profileDirectory);
    for (const dir of record.presets) {
        rmSync(join(root, dir), { recursive: true, force: true });
    }
    rmSync(statePathAt(root, name), { force: true });
    return true;
}
/** Preset-installed lookup used by the uninstall guard. */
export function isInstalledPreset(profileDirectory, name) {
    return readInstalledPresets(profileDirectory)[name] !== undefined;
}
