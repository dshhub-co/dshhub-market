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
export declare const PORTS: number[];
export declare function createBridgeServer(opts: {
    profile: string;
}): ReturnType<typeof createServer>;
/**
 * Start the bridge on the first free port (3750-3754). When another DSH
 * instance already runs one, reuse it silently. Idempotent per process.
 */
export declare function startBridge(profile: string): Promise<{
    ok: boolean;
    port?: number;
    reused?: boolean;
}>;
