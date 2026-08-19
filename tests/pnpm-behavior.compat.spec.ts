/**
 * Real-pnpm compat matrix (`npm run test:compat`): pins the failure
 * signatures behind issues #20/#21/#22 against actual pnpm 9/10/11 in
 * throwaway profile fixtures, and proves the market's argv decision works on
 * every combination. Needs network; several minutes on a cold npx cache.
 *
 * Publish dates in the minimumReleaseAge tests are immutable npm history
 * (is-odd@3.0.0 → 2018-05-30, 3.0.1 → 2018-05-31), so the derived age
 * window is deterministic forever.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyPnpmFailure, pluginArgsFor } from '../src/pnpm-compat.ts'

/** Last release of each major the market supports; behavior is per-major. */
const PNPM = { 9: '9.15.9', 10: '10.28.2', 11: '11.21.0' } as const

const dirs: string[] = []
afterEach(() => { while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true }) })

/** Profile fixture mirroring the stock web profile template (workspace root) or a bare one. */
function profileFixture(options: { workspace: boolean; extraWorkspaceYaml?: string }): string {
  const dir = mkdtempSync(join(tmpdir(), 'dshm-compat-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'package.json'), '{"name":"dsh-profile-fixture","private":true}')
  if (options.workspace) {
    writeFileSync(join(dir, 'pnpm-workspace.yaml'),
      `packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n${options.extraWorkspaceYaml ?? ''}`)
  }
  return dir
}

function pnpm(version: string, args: string[], cwd: string): { code: number | null; out: string } {
  const r = spawnSync('npx', ['-y', `pnpm@${version}`, ...args], {
    cwd, encoding: 'utf8', timeout: 240_000,
    env: { ...process.env, CI: 'true', COREPACK_ENABLE_STRICT: '0' },
  })
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

function installedVersion(dir: string, name: string): string | null {
  const manifest = join(dir, 'node_modules', name, 'package.json')
  if (!existsSync(manifest)) return null
  return (JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }).version ?? null
}

describe('#20 bug 1 — workspace-root add without -w', () => {
  it('pnpm 9 refuses with ERR_PNPM_ADDING_TO_ROOT (why the market injects -w at all)', () => {
    const dir = profileFixture({ workspace: true })
    const { code, out } = pnpm(PNPM[9], ['add', 'is-odd@3.0.1'], dir)
    expect(code).not.toBe(0)
    expect(out).toContain('ERR_PNPM_ADDING_TO_ROOT')
    expect(classifyPnpmFailure(out)?.code).toBe('adding-to-root')
  })

  it('pnpm 10 and 11 accept it (the refusal is a pnpm-9-only behavior)', () => {
    for (const version of [PNPM[10], PNPM[11]]) {
      const dir = profileFixture({ workspace: true })
      const { code } = pnpm(version, ['add', 'is-odd@3.0.1'], dir)
      expect(code, `pnpm ${version}`).toBe(0)
    }
  })
})

describe('#20 — -w outside a workspace is a hard error on EVERY major', () => {
  it('all three majors refuse --workspace-root without pnpm-workspace.yaml', () => {
    for (const version of Object.values(PNPM)) {
      const dir = profileFixture({ workspace: false })
      const { code, out } = pnpm(version, ['add', '-w', 'is-odd@3.0.1'], dir)
      expect(code, `pnpm ${version}`).not.toBe(0)
      expect(out).toMatch(/workspace-root may only be used inside a workspace/i)
      expect(classifyPnpmFailure(out)?.code).toBe('not-a-workspace')
    }
  })
})

describe('the market argv decision works on every pnpm major × profile shape', () => {
  it('pluginArgsFor-derived add succeeds everywhere', () => {
    for (const version of Object.values(PNPM)) {
      for (const workspace of [true, false]) {
        const dir = profileFixture({ workspace })
        const args = pluginArgsFor(dir, ['add', 'is-odd@3.0.1'])
        const { code, out } = pnpm(version, args, dir)
        expect(code, `pnpm ${version} workspace=${String(workspace)} args=${args.join(' ')}\n${out.slice(-400)}`).toBe(0)
        expect(installedVersion(dir, 'is-odd')).toBe('3.0.1')
      }
    }
  })
})

describe('#20 bug 2 — modules dir built by pnpm 9, mutated by pnpm 11', () => {
  it('fails with ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF, and one `install` + retry recovers', () => {
    const dir = profileFixture({ workspace: true })
    const seed = pnpm(PNPM[9], ['add', '-w', 'is-odd@3.0.1'], dir)
    expect(seed.code, seed.out.slice(-400)).toBe(0)

    const drift = pnpm(PNPM[11], ['add', '-w', 'is-even@1.0.0'], dir)
    expect(drift.code).not.toBe(0)
    expect(drift.out).toContain('ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF')
    const failure = classifyPnpmFailure(drift.out)
    expect(failure?.code).toBe('hoist-pattern-diff')
    expect(failure?.recoverable).toBe(true)

    // pnpm's documented remedy — the exact recovery the market automates.
    // --no-frozen-lockfile: under CI=true the old major's lockfile is refused.
    const rebuild = pnpm(PNPM[11], ['install', '--no-frozen-lockfile'], dir)
    expect(rebuild.code, rebuild.out.slice(-400)).toBe(0)
    const retry = pnpm(PNPM[11], ['add', '-w', 'is-even@1.0.0'], dir)
    expect(retry.code, retry.out.slice(-400)).toBe(0)
    expect(installedVersion(dir, 'is-even')).toBe('1.0.0')
  })
})

/** Minutes such that is-odd@3.0.1 (2018-05-31) is "too young" but 3.0.0 (2018-05-30) is mature. */
function ageWindowMinutes(): number {
  const cutoff = Date.parse('2018-05-31T07:00:00Z') // between the two publish instants
  return Math.round((Date.now() - cutoff) / 60_000)
}

describe('#21/#22 — minimumReleaseAge resolution traps', () => {
  it('a dist-tag add silently resolves to an OLD version and exits 0 (the #21/#22 silent trap)', () => {
    const dir = profileFixture({ workspace: true, extraWorkspaceYaml: `minimumReleaseAge: ${String(ageWindowMinutes())}\n` })
    const { code } = pnpm(PNPM[11], ['add', 'is-odd'], dir)
    expect(code).toBe(0) // clean exit…
    expect(installedVersion(dir, 'is-odd')).toBe('3.0.0') // …but NOT the latest (3.0.1)
  })

  it('an exact too-young version fails loudly with ERR_PNPM_NO_MATURE_MATCHING_VERSION', () => {
    const dir = profileFixture({ workspace: true, extraWorkspaceYaml: `minimumReleaseAge: ${String(ageWindowMinutes())}\n` })
    const { code, out } = pnpm(PNPM[11], ['add', 'is-odd@3.0.1'], dir)
    expect(code).not.toBe(0)
    expect(out).toContain('ERR_PNPM_NO_MATURE_MATCHING_VERSION')
  })
})

describe('#39 — a too-young lockfile entry blocks every later mutation', () => {
  it('remove fails ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION on pnpm 11; the one-shot override recovers', () => {
    const dir = profileFixture({ workspace: true, extraWorkspaceYaml: `minimumReleaseAge: ${String(ageWindowMinutes())}\n` })
    // A young release lands in the lockfile via the bypass (force-update path).
    const seed = pnpm(PNPM[11], ['add', '-w', '--config.minimumReleaseAge=0', 'is-odd@3.0.1'], dir)
    expect(seed.code, seed.out.slice(-400)).toBe(0)

    // pnpm verifies the WHOLE lockfile before applying the mutation — even
    // removing the young package itself fails.
    const blocked = pnpm(PNPM[11], ['remove', '-w', 'is-odd'], dir)
    expect(blocked.code).not.toBe(0)
    expect(blocked.out).toContain('ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION')
    expect(classifyPnpmFailure(blocked.out)?.code).toBe('release-age-violation')

    // The recovery the market automates: same command + the one-shot override.
    const recovered = pnpm(PNPM[11], ['remove', '-w', '--config.minimumReleaseAge=0', 'is-odd'], dir)
    expect(recovered.code, recovered.out.slice(-400)).toBe(0)
    expect(installedVersion(dir, 'is-odd')).toBeNull()
  })

  it('the override flag is harmless on pnpm 9/10 remove', () => {
    for (const version of [PNPM[9], PNPM[10]]) {
      const dir = profileFixture({ workspace: true })
      expect(pnpm(version, ['add', '-w', 'is-odd@3.0.0'], dir).code, `pnpm ${version} add`).toBe(0)
      const removed = pnpm(version, ['remove', '-w', '--config.minimumReleaseAge=0', 'is-odd'], dir)
      expect(removed.code, `pnpm ${version}: ${removed.out.slice(-300)}`).toBe(0)
    }
  })
})
