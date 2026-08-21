/**
 * Zip-hosted install path (fork, dshhub): catalog entries without an npm or
 * GitHub source carry a `zip` URL pointing at the hosted plugin zip. This
 * module downloads the zip, validates its manifest.json, and materializes a
 * gzipped ustar tarball into a content-addressed cache so the standard
 * `dsh plugin add <tgz>` spawn layer (dsh-cli.ts) can install it like any
 * other package. Ported from the legacy dshhub-market bridge
 * (market-plugin/lib/bridge.js), minus the HTTP server.
 */
import type { RegistryPlugin } from './registry.ts';
export declare function entryNeedsZip(entry: RegistryPlugin): boolean;
/**
 * Materialize the entry's zip into a cached tarball path for `dsh plugin add`.
 * Content-addressed: the same zip maps to the same file, a new version maps
 * to a new one (which cleanly replaces the old file: spec in the profile).
 *
 * `opts.token` — dshhub session access token (paid-marketplace-design.md
 * §4.3 方式 B): passed as `Authorization: Bearer` so the download endpoint
 * can verify the License for paid entries. Free entries ignore it.
 */
export declare function materializeTgz(entry: RegistryPlugin, opts?: {
    token?: string;
}): Promise<string>;
