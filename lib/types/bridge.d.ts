/**
 * fork (dshhub): embedded local HTTP bridge on 127.0.0.1:3750-3754 so the
 * dshhub.co website can one-click install plugins into the running DSH.
 * Ported from the legacy dshhub-market plugin (market-plugin/lib/bridge.js);
 * the install itself now goes through the fork's own engine (registry lookup
 * by dshhubId → zip materialization or standard source → `dsh plugin add`).
 *
 * Contract (kept byte-compatible with the legacy bridge so the website's
 * InstallHarnessButton keeps working):
 *   GET  /health   → { ok, bridge: 'dshhub-market', version, profile }
 *   POST /install  → body { id: <dshhub plugin uuid> } → { ok, message|error }
 *   GET  /dsh-market/publish/scan  → { presets, skills }（本机扫描，供发布页勾选）
 *   POST /dsh-market/publish/upload → body { items, token, accountId, authorName, demoUrl? }
 *        → 打包选中项 → POST 平台 /api/creator/upload（Bearer token 鉴权）
 */
import { createServer } from 'node:http';
import { type PublishResult } from './publish.ts';
export declare const PORTS: number[];
/** 发布上传请求体：items 只带 kind+name，实际路径由本机重扫得到（不信任客户端路径）。 */
export interface PublishUploadBody {
    items?: Array<{
        kind?: string;
        name?: string;
    }>;
    token?: string;
    accountId?: string;
    authorName?: string;
    demoUrl?: string;
}
export declare function createBridgeServer(opts: {
    profile: string;
}): ReturnType<typeof createServer>;
/**
 * 打包发布：重扫本机 profile，把 body.items 里 kind+name 匹配到的项
 * 交给 publishItems（客户端打包 zip → 上传平台 /api/creator/upload）。
 */
export declare function publishUpload(body: PublishUploadBody, profile: string): Promise<PublishResult>;
/**
 * Start the bridge on the first free port (3750-3754). When another DSH
 * instance already runs one, reuse it silently. Idempotent per process.
 */
export declare function startBridge(profile: string): Promise<{
    ok: boolean;
    port?: number;
    reused?: boolean;
}>;
