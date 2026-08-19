/**
 * A real npm registry, served from disk, plus the market's curated catalog.
 *
 * Why this exists: the install route only accepts sources present in the
 * curated registry (a deliberate control — see routes.ts), and
 * `installTargetFor` maps an entry to an npm name or a `github:` spec. So a
 * fixture cannot be driven through the real install path as a local tarball;
 * it has to be a package pnpm can genuinely RESOLVE. Serving a packument and
 * tarball over localhost makes it exactly that — the market, pnpm and cordis
 * all take the ordinary code path, and nothing has to be published.
 *
 * Unknown packages redirect upstream so pnpm can still replay the rest of
 * the dependency tree (the market's own deps) when it verifies the lockfile.
 */

import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Registry, RegistryPlugin } from '../../src/registry.ts'

// fileURLToPath, not .pathname — see the note in scaffold.ts: a Windows
// pathname keeps its leading slash and resolves to a nonexistent directory.
const FIXTURE_ROOT = fileURLToPath(new URL('./fixtures', import.meta.url))
const UPSTREAM = 'https://registry.npmjs.org'

export interface ServedPackage {
  name: string
  tarball: string
  manifest: Record<string, unknown>
}

/**
 * Pack a fixture directory into `destination` and describe it for the
 * registry. Uses `npm pack` so the tarball layout is the real thing.
 */
export function packFixture(dir: string, destination: string): ServedPackage {
  const source = join(FIXTURE_ROOT, dir)
  // execSync, not execFileSync: on Windows `npm` is npm.cmd, a batch shim
  // that cannot be spawned without a shell — the same trap the market's own
  // tool spawning handles (#2/#3/#5/#80). Node reports it as ENOENT on
  // `npm`, which reads like a missing install rather than a missing shell.
  execSync(`npm pack --pack-destination ${JSON.stringify(destination)}`, { cwd: source, stdio: 'pipe' })
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as Record<string, unknown>
  const prefix = `${String(manifest.name)}-${String(manifest.version)}`
  const file = readdirSync(destination).find(entry => entry.startsWith(prefix) && entry.endsWith('.tgz'))
  if (file === undefined) throw new Error(`npm pack produced no tarball for ${dir}`)
  return { name: String(manifest.name), tarball: join(destination, file), manifest }
}

/** A catalog entry pointing at a served package, shaped like a real one. */
export function catalogEntry(pkg: ServedPackage): RegistryPlugin {
  return {
    name: pkg.name,
    owner: 'dshm-e2e',
    // Never fetched: `npm` takes precedence in installTargetFor. It only has
    // to parse as a source url so the entry passes the route's checks.
    url: `https://github.com/dshm-e2e/${pkg.name}`,
    npm: pkg.name,
    category: 'testing',
    description: { en: `e2e fixture ${pkg.name}`, zh: `e2e 夹具 ${pkg.name}` },
    install: pkg.name,
    added: '2026-01-01',
  }
}

export interface FixtureRegistry {
  /** Value for the profile's `registry=` — pnpm resolves fixtures here. */
  npmUrl: string
  /** Value for DSHM_REGISTRY_URL — the market's curated catalog. */
  catalogUrl: string
  close(): Promise<void>
}

export async function startFixtureRegistry(packages: ServedPackage[]): Promise<FixtureRegistry> {
  const catalog: Registry = {
    updated: '2026-01-01',
    count: packages.length,
    categories: { testing: { en: 'Testing', zh: '测试' } },
    plugins: packages.map(catalogEntry),
  }

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/plugins.json') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(catalog))
      return
    }
    const tarball = packages.find(pkg => url.pathname === `/${pkg.name}/-/${basename(pkg.tarball)}`)
    if (tarball !== undefined) {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.end(readFileSync(tarball.tarball))
      return
    }
    const pkg = packages.find(
      candidate => url.pathname === `/${candidate.name}` || url.pathname === `/${encodeURIComponent(candidate.name)}`,
    )
    if (pkg === undefined) {
      response.writeHead(302, { location: `${UPSTREAM}${url.pathname}` })
      response.end()
      return
    }
    const bytes = readFileSync(pkg.tarball)
    const port = addressPort(server)
    const version = String(pkg.manifest.version)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      name: pkg.name,
      'dist-tags': { latest: version },
      versions: {
        [version]: {
          ...pkg.manifest,
          dist: {
            tarball: `http://127.0.0.1:${String(port)}/${pkg.name}/-/${basename(pkg.tarball)}`,
            shasum: createHash('sha1').update(bytes).digest('hex'),
            integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
          },
        },
      },
    }))
  })

  await new Promise<void>(done => server.listen(0, '127.0.0.1', () => { done() }))
  const base = `http://127.0.0.1:${String(addressPort(server))}`
  return {
    npmUrl: `${base}/`,
    catalogUrl: `${base}/plugins.json`,
    close: () => new Promise<void>(done => { server.close(() => { done() }) }),
  }
}

function addressPort(server: Server): number {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('registry server has no port')
  return address.port
}
