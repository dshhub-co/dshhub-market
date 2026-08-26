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
 * 只读 zip 的 manifest kind（旧解锁卡片条目 kind 缺失时，判定该走拷贝
 * 安装还是 pnpm）。本地条目只可能是 preset/skill（pnpm 类插件走
 * github/npm 源，kind 在建包时就带上），读不到或异常返回 null。
 */
export declare function zipKind(url: string): Promise<string | null>;
/**
 * Materialize the entry's zip into a cached tarball path for `dsh plugin add`.
 * Content-addressed: the same zip maps to the same file, a new version maps
 * to a new one (which cleanly replaces the old file: spec in the profile).
 *
 * `opts.token` — dshhub session access token (paid-marketplace-design.md
 * §4.3 方式 B): passed as `Authorization: Bearer` so the download endpoint
 * can verify the License for paid entries. Free entries ignore it.
 *
 * `opts.expectedSha256` — 哈希存证：平台直传条目在 registry 携带
 * file_sha256（checksum），下载字节比对不一致即拒绝安装（防下载被篡改）；
 * GitHub 导入条目字节实时重建不稳定、不携带，传 undefined 跳过校验。
 */
export declare function materializeTgz(entry: RegistryPlugin, opts?: {
    token?: string;
    expectedSha256?: string;
}): Promise<string>;
